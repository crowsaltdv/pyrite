# Hosting pyrite: the site on GitHub Pages, the games in S3

```
visitor ─▶ https://crowsaltdv.github.io/pyrite/      the site itself: about 150 KB, published by GitHub Pages
                │
                │  opens each game in a frame from the address in the GAMES_BASE repository variable
                ▼
           your S3 bucket, folder games/               the games: 3.5 GB, about 14,000 files
```

GitHub Pages can't hold 3.5 GB (its limit is 1 GB), so the games live in an S3 bucket. The site learns where they are from a **repository variable** called `GAMES_BASE`, set once on GitHub, so the address is never written into a file. If you ever move the games (to CloudFront, Cloudflare or anywhere else), you change that one variable and run the workflow again.

About 45 minutes the first time, most of it waiting for the upload. **Skip any step you've already done.** Each step says what you should see afterwards.

You need:
- your AWS account, with the S3 bucket you made (you need its **name** and **region**)
- the AWS command line (you have it) and Node.js (you have it)
- the games folder on your PC: `C:\Users\sawye\Downloads\pyrite\pyrite\games`
- this repository: `C:\Users\sawye\Documents\GitHub\peyrite\pyrite`

---

# Part 1 · Get ready

**1. Open a terminal in this repository's folder.**
Open `C:\Users\sawye\Documents\GitHub\peyrite\pyrite` in File Explorer, click the address bar, type `cmd`, press **Enter**. Everything below that looks like a code block is typed there, then **Enter**.

**2. Log in to AWS.**
```
aws login
```
A browser tab opens. Sign in to your AWS account and allow it. Back in the black window you should see that you're logged in. (This login expires after a while; if a later step says your session expired, run this again.)

**3. Check it worked.**
```
aws sts get-caller-identity
```
You should see a few lines with your `Account` number. If you see "session has expired" or an error, repeat step 2.

**4. Find your bucket's name and region.**
In the AWS website go to **S3 → General purpose buckets**. The list shows each bucket's **Name** and **AWS Region** (for example "US East (N. Virginia) us-east-1"). Write both down; below, `YOUR-BUCKET` means the name and `YOUR-REGION` means the region code like `us-east-1`.

---

# Part 2 · Put the games in the bucket

**5. Rehearse first (changes nothing).**
```
powershell -ExecutionPolicy Bypass -File scripts\games-to-s3.ps1 -Bucket YOUR-BUCKET -Region YOUR-REGION -Games "C:\Users\sawye\Downloads\pyrite\pyrite\games" -DryRun
```
It checks your login and the bucket, shows the folders it found (`gn-math, html, noah, selenite`), then lists what it *would* upload. You should end on "Dry run finished: nothing was changed" and the address of your games folder. If it complains, the message says what to fix.

**6. Do it for real.**
Same command without `-DryRun`:
```
powershell -ExecutionPolicy Bypass -File scripts\games-to-s3.ps1 -Bucket YOUR-BUCKET -Region YOUR-REGION -Games "C:\Users\sawye\Downloads\pyrite\pyrite\games"
```
- It first shows a small **bucket policy** and asks **"Make games/ readable by everyone? (y/N)"**. Type `y` and press Enter. This lets visitors' browsers download the games. It lets anyone **read** files under `games/` and nothing else: no listing, no changing or deleting, and everything else in the bucket stays private. Only keep game files in this bucket.
- Then it uploads, showing progress. 3.5 GB can take a while. You can stop with **Ctrl + C** and run it again later; it carries on and only sends what's missing.
- It sets the correct file type on scripts, pages, styles and so on (Windows can get these wrong, and a browser then refuses to run the game), and tells browsers they may keep game files for a day.
- At the end you should see **Upload finished** and your address, like:
  ```
  https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/
  ```
  **Copy that address.**

**7. Check the games are served properly.**
```
node scripts\check-games-host.mjs https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/ --local "C:\Users\sawye\Downloads\pyrite\pyrite\games"
```
It tries 12 games spread across all four collections, the way the page will ask for them. You should end on **No problems with the host**. (Some games say they "load their files from another website"; that's normal, see "Good to know" below.)
- **✖ index.html answered 403:** the games aren't public yet. Redo step 6 and answer `y`.
- **✖ comes as "binary/octet-stream":** a file went up without its type. Run step 6 again.
- **✖ ... it didn't upload:** run step 6 again.

---

# Part 3 · Tell GitHub where the games are

**8. Set the `GAMES_BASE` repository variable.** Either way works.

*In the browser:* open [github.com/crowsaltdv/pyrite/settings/variables/actions](https://github.com/crowsaltdv/pyrite/settings/variables/actions) → **New repository variable** → Name: `GAMES_BASE` → Value: the address from step 6 (with the `https://` and the `/games/` on the end) → **Add variable**.

*Or from the terminal:*
```
gh variable set GAMES_BASE --repo crowsaltdv/pyrite --body "https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/"
```

**9. Check it's saved.**
```
gh variable list --repo crowsaltdv/pyrite
```
You should see `GAMES_BASE` and your address.

---

# Part 4 · Publish the site

GitHub Pages is already set to publish from **GitHub Actions** for this repository, so there's nothing to switch on.

**10. Send the new files to GitHub.** This repository has changes that haven't been saved to GitHub yet (the workflow update, the scripts, this guide):
```
git add .github scripts HOSTING.md .gitignore make-single-file.py
```
```
git commit -m "Host the games in S3 and read their address from GAMES_BASE"
```
```
git push
```
Pushing starts the workflow by itself. (If you only changed the variable and nothing else, you can start it by hand instead: `gh workflow run pages.yml --repo crowsaltdv/pyrite`.)

**11. Watch it publish.**
```
gh run watch --repo crowsaltdv/pyrite
```
Pick the newest run if it asks. After about a minute you should see all steps tick green. Look for the message **"The games host is answering"** in the step "Check the games host answers". If instead you see a yellow warning there, the site still published, but the games address isn't working yet (see "If something goes wrong").

**12. Open your site.**
[https://crowsaltdv.github.io/pyrite/](https://crowsaltdv.github.io/pyrite/): click through the cover page, click a game, and it should open.

**13. Do the full check.**
```
node scripts\check-games-host.mjs https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/ --local "C:\Users\sawye\Downloads\pyrite\pyrite\games" --site https://crowsaltdv.github.io/pyrite/
```
At the end it also checks the published site, and you should see **"the site loads its games from …"** with your address.

You're done. ✦

---

# A single file you can double-click (pyrite.html)

`make-single-file.py` bundles the whole site into one file, `pyrite.html`, that you can double-click, put on a USB stick or send to a friend. The games aren't inside it: it loads them from your S3 bucket, so it needs the internet.

```
python make-single-file.py
```

That's all. It finds your games address by itself and tells you where it found it:

```
wrote ...\pyrite.html (141 KB)
Games address: https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/
  found in: the GAMES_BASE repository variable on GitHub
  OK: the games host answers.
```

It looks in this order and uses the first that works: an address you type after the command, the `GAMES_BASE` environment variable, the `GAMES_BASE` variable on GitHub (this needs the `gh` tool, which you're logged in to), the address your published site uses, and finally the address it saved last time (in `.games-base`, which git ignores). So it also keeps working offline after the first time.

- **Run it again** whenever you change the site, or move the games to a new host.
- **Games next to the file instead** (no S3): `python make-single-file.py --local`.
- **Give it an address by hand** (it remembers it): `python make-single-file.py https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/`
- `pyrite.html` is rebuilt whenever you like, so git ignores it; don't commit it.
- Everyone who opens the file downloads games from your bucket, which counts towards the download costs below.

---

# Keeping an eye on cost

S3 is cheap to store 3.5 GB, but **you pay when people download games**. AWS says the first 100 GB a month of data out to the internet is free (check your account's current terms), and after that it's about $0.09 per GB. A game can be tens of MB, so a very popular site could pass the free amount.

- **Set a spending alert now.** AWS website → **Billing and Cost Management → Budgets → Create budget → Cost budget**, set it to something like $5, and enter your email. It warns you before a surprise.
- Browsers keep downloaded game files for a day, so repeat visitors cost nothing extra.
- If the site gets popular, put a CDN in front of the bucket (CloudFront once AWS approves your account, or Cloudflare with your own domain). **You won't need to change any code:** change the `GAMES_BASE` variable to the CDN's address and run the workflow again.

# Day to day

- **Added or changed games?** Update `games.js` as you normally do, run step 6 again (it only uploads what's new or changed), then push `games.js`.
- **Moved the games to a different host?** Change the variable: `gh variable set GAMES_BASE --repo crowsaltdv/pyrite --body "NEW-ADDRESS"`, then `gh workflow run pages.yml --repo crowsaltdv/pyrite`, then rebuild the single file with `python make-single-file.py`.
- **Want to take the games offline quickly?** In the S3 console open the bucket → **Permissions → Bucket policy** → delete the `PublicReadGames` statement. The games stop loading at once.
- **Run the site on your own PC** (the games folder next to the site, no internet needed): `python serve.py`, or double-click `start-pyrite.bat`. The `config.js` in the repository still says `games/`, which is what makes that work.

# Good to know

- **About half the games load their files from other websites.** In the `html`, `gn-math` and `noah` collections, many games are tiny pages (an `index.html` and a picture) whose real files come from jsDelivr or similar (their `<base href>` says so). Those games depend on someone else's hosting, so if that disappears they stop working, whatever you do with S3. The big self-contained collection is `selenite` (about 3.1 GB of the 3.5).
- **Games save their progress per site.** Browsers keep a game's saves separately for each website that embeds it, so moving the games to a new host later starts fresh saves.
- **A few games are opened in a new tab on purpose** (like Moto X3M); that's built into the page.

# If something goes wrong

| What you see | What to do |
|---|---|
| The workflow fails with "Set the GAMES_BASE repository variable" | Steps 8–9. The address must start with `https://`. |
| The workflow fails with "GAMES_BASE has a character that isn't allowed" | The variable has a space, a quote or similar in it. Set it again exactly as printed in step 6. |
| A yellow warning "The games host answered 403" | The games aren't public: redo step 6 and answer `y`. If AWS refuses the policy, open S3 → **Block Public Access settings for this account** (left menu) and check "Block public access to buckets and objects granted through new public bucket or access point policies" and the "any" one are **off** at the account level too. |
| A yellow warning with "404" | The games aren't uploaded (or the address is wrong): redo step 6, then check the address in step 8 matches. |
| Opening a game's address in the browser shows XML saying **AccessDenied** | Same as 403 above. |
| Games open but show blank or a download prompt | A file has the wrong type. Run step 6 again; step 7 tells you which files. |
| `aws` says your **session has expired** | Run `aws login` again. |
| `games-to-s3.ps1` says it **can't reach the bucket** | The name or region is wrong. Check them in the S3 list (step 4). |
| The script says the bucket **already has a policy** | It left it alone on purpose. Either add the `PublicReadGames` statement it printed to your existing policy in the S3 console, or run again with `-ReplacePolicy` to replace the whole policy with just that one. |
| PowerShell says running scripts is disabled | Use the exact command in step 5: the `-ExecutionPolicy Bypass` part is what allows it. |
| The site still shows old games or an old look after a deploy | Hard-refresh the page (Ctrl + F5). The workflow stamps the file links so this is rare. |
| The site opens, but no games or pictures load (cards show only gold letters), and the page's `config.js` says `gamesBase: "games/"` | Two things published the site and GitHub's own built-in one finished last, putting the raw files live. This can happen when you set up a custom domain while Pages is still on "Deploy from a branch". In **Settings → Pages**, make sure **Source** says **GitHub Actions**, then rebuild with `gh workflow run pages.yml --repo crowsaltdv/pyrite`. You can see what's live at `https://YOUR-SITE/config.js`: it should show your S3 address. |
| Git says your push was **rejected** after you changed settings on GitHub | GitHub itself added a commit (setting a custom domain makes it add a file called `CNAME`). Run `git pull`, then push again. |

```
.github/workflows/pages.yml    builds the site and publishes it, reading GAMES_BASE
scripts/games-to-s3.ps1        uploads the games and makes games/ readable
scripts/check-games-host.mjs   checks an address serves the games properly
config.js                      where the games are (games/ for your PC; replaced by the variable when published)
games.js                       the list of games
```
