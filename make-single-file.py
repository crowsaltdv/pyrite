"""Bundles the whole site into ONE file, pyrite.html, that you can just double-click.

    python make-single-file.py                                  (uses the address in config.js)
    python make-single-file.py https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/

The games are not inside the file. They are loaded from `gamesBase`, so for double-clicking to give you
working games it must be an online address (your S3 bucket's). The file needs the internet for that,
for the fonts and for the cover-page photos. Run this again whenever you change the site.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pyrite.html")


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def safe_js(js):
    # a literal "</script" inside inlined code would end the <script> block early
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)


html = read("index.html")


def swap(pattern, replacement):
    global html
    html, count = re.subn(pattern, replacement, html, count=1)
    if count != 1:
        sys.exit("could not find this in index.html: " + pattern)


for css in ("style.css", "gate.css"):
    swap(r'<link rel="stylesheet" href="%s">' % re.escape(css), lambda m, c=css: "<style>\n" + read(c) + "\n</style>")

base = sys.argv[1] if len(sys.argv) > 1 else None
config = ('window.PYRITE = { gamesBase: "%s" };\n' % base) if base else read("config.js")
swap(r'<script src="config\.js"></script>', lambda m: "<script>\n" + safe_js(config) + "\n</script>")
swap(r'<script src="games\.js"[^>]*></script>', lambda m: "<script>\n" + safe_js(read("games.js")) + "\n</script>")
swap(r'<script src="app\.js"></script>', lambda m: "<script>\n" + safe_js(read("app.js")) + "\n</script>")

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print("wrote", OUT, "(%d KB)" % (os.path.getsize(OUT) // 1024))

code = "\n".join(line for line in config.splitlines() if not line.lstrip().startswith("//"))  # ignore the example in the comments
m = re.search(r'gamesBase:\s*"([^"]*)"', code)
if not m or not re.match(r"https?://", m.group(1)):
    print("\nNote: gamesBase is '%s', not an online address, so the games will NOT load from this file." % (m.group(1) if m else "?"))
    print("Once your games are online, run:  python make-single-file.py https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/")
