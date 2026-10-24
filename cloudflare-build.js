// Cloudflare "Build command":  node cloudflare-build.js
//
// Cloudflare serves static files up to 25 MiB each, and a deploy with a bigger file fails outright.
// This leaves any game that has such a file out of the Cloudflare copy, drops it from the games list,
// and puts the site into ./dist (what wrangler.jsonc deploys).
//
// It never deletes or moves anything: ./dist is made of links to your files, so your repo and your
// local copy keep every game. Run it with --dry to just print what it would do.
"use strict";
const fs = require("fs");
const path = require("path");

const LIMIT = 25 * 1024 * 1024;   // Cloudflare's per-file limit
const FILE_CAP = 20000;           // files per deploy on the free plan
const DRY = process.argv.includes("--dry");
const ROOT = process.cwd();
const GAMES = path.join(ROOT, "games");
const DIST = path.join(ROOT, "dist");
const SITE_FILES = ["index.html", "style.css", "gate.css", "app.js", "config.js", "favicon.ico"];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// 1. game folders that contain a file over the limit ("selenite/rocketleague", "html/0-fa", ...)
const tooBig = new Map();
const files = walk(GAMES);
for (const f of files) {
  const size = fs.statSync(f).size;
  if (size <= LIMIT) continue;
  const id = path.relative(GAMES, f).split(path.sep).slice(0, 2).join("/");
  if (!tooBig.has(id)) tooBig.set(id, []);
  tooBig.get(id).push((size / 1048576).toFixed(1) + " MB  " + path.basename(f));
}

// 2. the games list without them
const list = new Function(fs.readFileSync(path.join(ROOT, "games.js"), "utf8") + ";return GAMES;")();
const kept = list.filter((g) => !tooBig.has(g.id));
const dropped = list.filter((g) => tooBig.has(g.id));
const orphans = [...tooBig.keys()].filter((id) => !list.some((g) => g.id === id));

console.log(`games listed: ${list.length}, kept: ${kept.length}, left out (file over 25 MiB): ${dropped.length}`);
for (const g of dropped) console.log(`  - ${g.name}  [${g.id}]  ${tooBig.get(g.id).join(", ")}`);
if (orphans.length) console.log("  also removing unlisted folders:", orphans.join(", "));

const removedFiles = [...tooBig.keys()].reduce((n, id) => n + files.filter((f) => path.relative(GAMES, f).split(path.sep).slice(0, 2).join("/") === id).length, 0);
const distFiles = files.length - removedFiles + SITE_FILES.length + 1;
console.log(`files to upload: ${distFiles}` + (distFiles > FILE_CAP ? `  (over the ${FILE_CAP} free-plan limit!)` : `  (limit ${FILE_CAP})`));

if (DRY) { console.log("dry run: nothing changed"); process.exit(0); }

// 3. build ./dist: hard links (instant, no extra disk); falls back to copying if the disk won't link
function mirror(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      const id = path.relative(GAMES, s).split(path.sep);
      if (id.length === 2 && tooBig.has(id.join("/"))) continue; // a game that is too big for Cloudflare
      mirror(s, d);
    } else if (e.isFile()) {
      try { fs.linkSync(s, d); } catch (err) { fs.copyFileSync(s, d); }
    }
  }
}
fs.rmSync(DIST, { recursive: true, force: true });
mirror(GAMES, path.join(DIST, "games"));
for (const f of SITE_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
fs.writeFileSync(path.join(DIST, "games.js"), "var GAMES=" + JSON.stringify(kept) + ";\n");
console.log("built ./dist");
