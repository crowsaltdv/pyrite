// Checks that a games address works the way the page will use it: each game page opens, the scripts and styles it
// loads from the same place come with the right file type, and (optionally) that the published site points at it.
//
//   node scripts/check-games-host.mjs https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/games/
//   node scripts/check-games-host.mjs <games address> --local "C:\path\to\games"     (tells "never uploaded" from "never there")
//   node scripts/check-games-host.mjs <games address> --site https://crowsaltdv.github.io/pyrite/
//   node scripts/check-games-host.mjs <games address> --count 40
//
// It checks a spread of games (the first, the last, and evenly between). Many games are small pages that load their real
// files from another website (their <base href> says where); those files are not this host's job, so they are skipped.
// ✖ means the host is wrong (exit code 1). ! is a note about the game itself, such as a missing picture.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args.splice(i, 2)[1];
};
const siteArg = flag("--site");
const localArg = flag("--local");
const count = Math.max(2, Number(flag("--count") ?? 12));
const baseArg = args[0];

const ok = (s) => `\x1b[32m✔\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✖\x1b[0m ${s}`;
const meh = (s) => `\x1b[33m!\x1b[0m ${s}`;
const WANT = { js: /javascript|ecmascript/, mjs: /javascript|ecmascript/, css: /^text\/css/, wasm: /^application\/wasm/, json: /json/ };
const NEED = { js: "a JavaScript type", mjs: "a JavaScript type", css: "text/css", wasm: "application/wasm", json: "a JSON type" };

const typeOf = (res) => (res.headers.get("content-type") ?? "").toLowerCase();
async function request(url, method = "GET") {
  try {
    return await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    return { status: 0, headers: new Headers(), error: err.cause?.code ?? err.message };
  }
}

async function main() {
  if (!baseArg || !/^https?:\/\//.test(baseArg)) {
    console.error("Usage: node scripts/check-games-host.mjs <games address, starting with https://> [--count 12] [--local <games folder>] [--site <published site address>]");
    return 2;
  }
  const base = baseArg.replace(/\/*$/, "/");
  const basePath = new URL(base).pathname;

  // the same list and the same address rules as the page itself (see app.js)
  const games = vm.runInNewContext(fs.readFileSync(path.join(here, "..", "games.js"), "utf8") + "\nGAMES", {});
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  const n = Math.min(count, games.length);
  const sample = [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (games.length - 1)) / (n - 1))))].map((i) => games[i]);

  /** The file on your PC that an address under the games folder stands for, if you gave --local. */
  const localFile = (url) => {
    if (!localArg) return null;
    try {
      return path.join(localArg, decodeURIComponent(new URL(url).pathname.slice(basePath.length)));
    } catch {
      return null;
    }
  };

  let failures = 0;
  let warnings = 0;
  console.log(`Checking ${sample.length} of ${games.length} games at ${base}\n`);

  for (const game of sample) {
    const dir = base + enc(game.id) + "/";
    const pageUrl = dir + "index.html";
    const page = await request(pageUrl);
    const problems = [];
    const notes = [];

    if (page.status !== 200) problems.push(`index.html answered ${page.status || page.error}`);
    else if (!/^text\/html/.test(typeOf(page))) problems.push(`index.html comes as "${typeOf(page) || "nothing"}", not a web page (a browser would show it as text or offer to download it)`);

    if (page.status === 200) {
      const html = await page.text();
      const baseTag = /<base[^>]*\shref\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
      let resolveAgainst = pageUrl;
      try {
        if (baseTag) resolveAgainst = new URL(baseTag, pageUrl).href;
      } catch {
        notes.push(`its <base href> isn't a valid address (${baseTag})`);
      }
      const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+\.(js|mjs|css|wasm|json))(?:\?[^"']*)?["']/gi)]
        .map((m) => ({ ref: m[1], ext: m[2].toLowerCase() }))
        .filter(({ ref }) => !ref.startsWith("data:") && !/^([a-z]+:)?\/\//i.test(ref));

      let elsewhere = 0;
      let checked = 0;
      for (const { ref, ext } of refs) {
        let url;
        try {
          url = new URL(ref, resolveAgainst);
        } catch {
          continue;
        }
        if (!url.href.startsWith(base)) {
          elsewhere += 1; // loaded from another website, or from outside the games folder: not this host's job
          continue;
        }
        if (checked >= 4) continue;
        checked += 1;
        const asset = await request(url.href, "HEAD");
        if (asset.status === 200) {
          if (!WANT[ext].test(typeOf(asset))) problems.push(`${ref} comes as "${typeOf(asset) || "nothing"}"; browsers need ${NEED[ext]}`);
        } else {
          const mine = localFile(url.href);
          if (mine && fs.existsSync(mine)) problems.push(`${ref} answered ${asset.status || asset.error}, but it IS in your games folder: it didn't upload`);
          else notes.push(`${ref} answered ${asset.status || asset.error}${mine ? " and isn't in your games folder either, so the game itself is missing it" : " (use --local to tell whether it was ever uploaded)"}`);
        }
      }
      if (elsewhere && !checked) notes.push(`loads its files from another website${baseTag ? ` (${new URL(resolveAgainst).host})` : ""}, which this host can't affect`);
    }

    const icon = await request(dir + enc(game.img), "HEAD");
    if (icon.status !== 200) notes.push(`its picture (${game.img}) answered ${icon.status || icon.error}`);

    if (problems.length) {
      failures += 1;
      console.log(bad(`${game.id}  ${game.name}`));
      for (const p of problems) console.log(`    ${p}`);
    } else if (notes.some((x) => !x.startsWith("loads its files from another website"))) {
      warnings += 1;
      console.log(meh(`${game.id}  ${game.name}`));
      for (const x of notes) console.log(`    ${x}`);
    } else {
      console.log(ok(`${game.id}  ${game.name}${notes.length ? `   (${notes[0]})` : ""}`));
    }
  }

  if (siteArg) {
    const site = siteArg.replace(/\/*$/, "/");
    console.log(`\nChecking the published site at ${site}`);
    const home = await request(site);
    const config = await request(site + "config.js");
    if (home.status !== 200) {
      failures += 1;
      console.log(bad(`the site answered ${home.status || home.error}`));
    } else if (config.status !== 200) {
      failures += 1;
      console.log(bad(`config.js answered ${config.status || config.error}`));
    } else {
      const code = (await config.text()).split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
      const published = /gamesBase:\s*"([^"]*)"/.exec(code)?.[1] ?? "";
      if (published.replace(/\/*$/, "/") === base) console.log(ok(`the site loads its games from ${base}`));
      else {
        failures += 1;
        console.log(bad(`the site loads its games from "${published}", not from the address you gave. Check the GAMES_BASE repository variable, then run the workflow again.`));
      }
    }
  }

  console.log(`\n${failures ? `${failures} problem${failures === 1 ? "" : "s"} with the host` : "No problems with the host"}${warnings ? `, ${warnings} note${warnings === 1 ? "" : "s"} about games themselves` : ""}.`);
  return failures ? 1 : 0;
}

// let the program end by itself (calling process.exit while requests are closing crashes Node on Windows)
process.exitCode = await main();
