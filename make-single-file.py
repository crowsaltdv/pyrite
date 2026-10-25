"""Bundles the whole site into ONE file, pyrite.html, that you can just double-click.

    python make-single-file.py

That's all. It finds your games address by itself, the same one your published site uses, so the games load from
your S3 bucket. It looks in this order and uses the first one that works:

    1. an address you type after the command:
           python make-single-file.py https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/
    2. the GAMES_BASE environment variable
    3. the GAMES_BASE repository variable on GitHub (needs the `gh` tool, logged in)
    4. whatever your published site uses (its config.js on GitHub Pages)
    5. the address it used last time (remembered in the file .games-base)

    python make-single-file.py --local      games next to the file instead (what config.js says); no S3 needed

The games are not inside pyrite.html. The file needs the internet to load them, the fonts and the cover-page
photos. Run this again whenever you change the site or move the games.
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pyrite.html")
SAVED = os.path.join(HERE, ".games-base")

# Only characters that belong in a plain web address (the same rule the publishing workflow uses).
ADDRESS = re.compile(r"^https?://[A-Za-z0-9._~:/%+@=,-]+$")


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def safe_js(js):
    # a literal "</script" inside inlined code would end the <script> block early
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)


def games_base_in(config_js):
    """The gamesBase set in a config.js, ignoring the example in its comments."""
    code = "\n".join(line for line in config_js.splitlines() if not line.lstrip().startswith("//"))
    m = re.search(r'gamesBase:\s*"([^"]*)"', code)
    return m.group(1) if m else None


def clean(address):
    """The address with exactly one slash on the end, or None if it isn't a plain web address."""
    address = (address or "").strip()
    return address.rstrip("/") + "/" if ADDRESS.match(address) else None


# --- where is the games address? ------------------------------------------------------------------------------

def github_repo():
    """('owner', 'name') of the GitHub repository this folder belongs to, or None."""
    try:
        url = subprocess.run(["git", "config", "--get", "remote.origin.url"], cwd=HERE, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.match(r"^(?:https://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    return (m.group(1), m.group(2)) if m else None


def from_github_variable(repo):
    if not repo:
        return None
    try:
        r = subprocess.run(["gh", "variable", "get", "GAMES_BASE", "--repo", "%s/%s" % repo], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def from_published_site(repo):
    if not repo:
        return None
    owner, name = repo
    root = "https://%s.github.io/" % owner
    site = root if name.lower() == owner.lower() + ".github.io" else root + name + "/"
    try:
        request = urllib.request.Request(site + "config.js", headers={"User-Agent": "pyrite-make-single-file"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return games_base_in(response.read().decode("utf-8", "replace"))
    except Exception:
        return None


def from_saved():
    try:
        with open(SAVED, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def find_games_base(typed):
    """(address, where it came from), or (None, None). Anything found by itself must be a secure https:// address."""
    if typed:
        address = clean(typed)
        if not address:
            sys.exit("That doesn't look like a web address: %s\nIt should look like https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/" % typed)
        return address, "the address you typed"
    repo = github_repo()
    for where, get in (
        ("the GAMES_BASE environment variable", lambda: os.environ.get("GAMES_BASE")),
        ("the GAMES_BASE repository variable on GitHub", lambda: from_github_variable(repo)),
        ("your published site", lambda: from_published_site(repo)),
        ("the address saved last time (.games-base)", from_saved),
    ):
        address = clean(get())
        if address and address.startswith("https://"):
            return address, where
    return None, None


def games_host_answers(base):
    """True if the first game's page can be fetched from the address, the status code if it can't, None if unreachable."""
    m = re.search(r'"id":"([^"]+)"', read("games.js"))
    if not m:
        return None
    url = base + urllib.parse.quote(m.group(1), safe="/") + "/index.html"
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "pyrite-make-single-file"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return True if response.status == 200 else response.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception:
        return None


# --- the bundle -----------------------------------------------------------------------------------------------

def bundle(config_js):
    html = read("index.html")

    def swap(pattern, replacement):
        nonlocal html
        html, count = re.subn(pattern, replacement, html, count=1)
        if count != 1:
            sys.exit("could not find this in index.html: " + pattern)

    for css in ("style.css", "gate.css"):
        swap(r'<link rel="stylesheet" href="%s">' % re.escape(css), lambda m, c=css: "<style>\n" + read(c) + "\n</style>")
    swap(r'<script src="config\.js"></script>', lambda m: "<script>\n" + safe_js(config_js) + "\n</script>")
    swap(r'<script src="games\.js"[^>]*></script>', lambda m: "<script>\n" + safe_js(read("games.js")) + "\n</script>")
    swap(r'<script src="app\.js"></script>', lambda m: "<script>\n" + safe_js(read("app.js")) + "\n</script>")
    return html


def main(argv):
    args = argv[1:]
    if "-h" in args or "--help" in args:
        print(__doc__)
        return 0
    local = "--local" in args
    args = [a for a in args if a != "--local"]

    base, where = (None, None) if local else find_games_base(args[0] if args else None)

    if base:
        config = "window.PYRITE = { gamesBase: %s };\n" % json.dumps(base)  # json.dumps quotes it safely for JavaScript
    else:
        config = read("config.js")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(bundle(config))
    print("wrote", OUT, "(%d KB)" % (os.path.getsize(OUT) // 1024))

    if base:
        print("Games address: %s" % base)
        print("  found in: %s" % where)
        try:
            with open(SAVED, "w", encoding="utf-8") as f:
                f.write(base + "\n")  # so it still works later without the internet or GitHub
        except OSError:
            pass
        answer = games_host_answers(base)
        if answer is True:
            print("  OK: the games host answers.")
        elif answer is None:
            print("  Note: couldn't reach the games host just now (are you online?). The file was still made.")
        else:
            print("  Note: the games host answered %s for the first game. Are the games uploaded and public? (see HOSTING.md)" % answer)
        return 0

    current = games_base_in(config)
    if local:
        print("Using --local: the games will be looked for in a folder called %s next to the file." % (current or "games/"))
    else:
        print("\nNote: couldn't find your games address (no GAMES_BASE variable, not logged in to GitHub, site not published, nothing saved).")
        print("The file will look for the games in '%s' next to it, which only works if they are there." % (current or "?"))
        print("Give it your S3 address once, and it remembers it:")
        print("    python make-single-file.py https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
