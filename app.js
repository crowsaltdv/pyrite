(() => {
  "use strict";

  const BATCH = 60;       // cards added per step
  const LOOKAHEAD = 1400; // px of cards to keep ready below the fold

  // where the game folders live (see config.js)
  const BASE = ((window.PYRITE && window.PYRITE.gamesBase) || "games/").replace(/\/*$/, "/");

  // These pages break out of frames or refuse to run inside one, so they open in their own tab.
  const NOFRAME = new Set([
    "selenite/cuttherope-holiday", "selenite/madalincars",
    "selenite/motox3m", "selenite/motox3m-pool", "selenite/motox3m-spooky", "selenite/motox3m-winter",
    "gn-math/316", "gn-math/263",
  ]);

  // ~80 of the emulator pages call this on whichever page frames them
  window.maeExportApis_ = () => {};

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const sentinel = $("sentinel");
  const glow = $("glow");
  const mark = $("wordmark");
  const input = $("q");
  const clearBtn = $("clear");
  const count = $("count");
  const empty = $("empty");
  const sortBox = document.querySelector(".sort");
  const sortBtns = [...sortBox.querySelectorAll("[data-sort]")];
  const gilt = [...document.querySelectorAll(".gilt")];

  const root = document.documentElement;
  const gated = () => root.classList.contains("gated"); // cover page still up
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- data, search, sort ---------- */

  // lowercase, drop accents/punctuation so "funkin'" or "pokemon" still find "Funkin’" / "Pokémon"
  const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const alpha = (typeof GAMES !== "undefined" ? GAMES : [])
    .map((g) => ({ ...g, key: norm(g.name) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const byId = new Map(alpha.map((g) => [g.id, g]));

  let shuffled = alpha;
  let mode = "az";
  let shown = alpha;
  let next = 0;

  function reshuffle() {
    const a = alpha.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    shuffled = a;
  }

  const fmt = (n) => n.toLocaleString("en-US");

  function apply() {
    const terms = norm(input.value).split(" ").filter(Boolean);
    const base = mode === "az" ? alpha : shuffled;
    shown = terms.length ? base.filter((g) => terms.every((t) => g.key.includes(t))) : base;

    grid.replaceChildren();
    next = 0;
    empty.hidden = shown.length > 0;
    count.textContent = countText();
    fill();
  }

  const countText = () => (norm(input.value)
    ? fmt(shown.length) + " of " + fmt(alpha.length)
    : fmt(alpha.length) + " projects");

  // a short message in the count line, then back to the count
  let flashTimer = 0;
  function flash(msg) {
    clearTimeout(flashTimer);
    count.textContent = msg;
    flashTimer = setTimeout(() => { count.textContent = countText(); }, 3500);
  }

  /* ---------- cards + endless scroll ---------- */

  // ids and image paths can hold subfolders, spaces and emoji
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  const gameDir = (g) => BASE + enc(g.id) + "/";
  const gameUrl = (g) => gameDir(g) + "index.html";

  function card(game, i) {
    const a = document.createElement("a");
    a.className = "card";
    if (NOFRAME.has(game.id)) {
      a.href = gameUrl(game);
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      a.href = "#/" + enc(game.id); // opens in the in-page player
    }
    a.style.setProperty("--d", (i % 12) * 28 + "ms");

    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.draggable = false;
    img.addEventListener("load", () => {
      // favicon-sized art looks soft stretched across a whole tile
      if (img.naturalWidth && Math.min(img.naturalWidth, img.naturalHeight) < 130) a.classList.add("icon");
      a.classList.add("ready");
    }, { once: true });
    img.addEventListener("error", () => a.classList.add("missing"), { once: true });
    img.src = gameDir(game) + enc(game.img);

    const mono = document.createElement("span");
    mono.className = "mono";
    mono.setAttribute("aria-hidden", "true");
    mono.textContent = (game.name.trim()[0] || "?");

    const name = document.createElement("div");
    name.className = "name";
    const label = document.createElement("span");
    label.textContent = game.name;
    name.appendChild(label);

    a.append(img, mono, name);
    return a;
  }

  function more() {
    const end = Math.min(next + BATCH, shown.length);
    const frag = document.createDocumentFragment();
    for (let i = next; i < end; i++) frag.appendChild(card(shown[i], i - next));
    next = end;
    grid.appendChild(frag);
  }

  function fill() {
    while (next < shown.length && sentinel.getBoundingClientRect().top < innerHeight + LOOKAHEAD) more();
  }

  // once everything is rendered `fill` returns before touching layout, so this stays cheap
  addEventListener("scroll", fill, { passive: true });
  addEventListener("resize", fill);

  /* ---------- search + sort controls ---------- */

  const searchBox = input.closest(".search");

  input.addEventListener("input", () => {
    searchBox.classList.toggle("has-value", input.value !== "");
    apply();
  });

  function clearSearch() {
    input.value = "";
    searchBox.classList.remove("has-value");
    apply();
  }
  clearBtn.addEventListener("click", () => { clearSearch(); input.focus(); });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.value ? clearSearch() : input.blur(); }
    else if (e.key === "Enter") input.blur(); // dismisses the phone keyboard
  });

  // "/" jumps to the search box
  addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || current || gated()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  let rolls = 0;
  sortBox.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    const choice = btn.dataset.sort;
    if (choice === "random") {
      reshuffle(); // clicking Shuffle again deals a fresh order
      sortBox.style.setProperty("--rot", ++rolls * 360 + "deg");
    }
    mode = choice;
    sortBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    sortBox.style.setProperty("--shift", mode === "az" ? "0%" : "100%");
    apply();
  });

  /* ---------- in-page player ---------- */

  const player = $("player");
  const pFrame = $("p-frame");
  const pTitle = $("p-title");
  const pIcon = $("p-icon");
  const pNewTab = $("p-newtab");
  const pFull = $("p-full");
  const pClose = $("p-close");
  const pUnfull = $("p-unfull");
  const pLoading = $("p-loading");
  const home = [document.querySelector(".top"), document.querySelector("main")];

  let current = null;   // game being played
  let frameEl = null;   // its <iframe>
  let lastFocus = null; // card to hand focus back to
  let inApp = false;    // true once we have navigated inside the page, so "back" lands on the grid
  let loadTimer = 0;
  let lastFs = 0;

  const fsActive = () => document.fullscreenElement || document.webkitFullscreenElement;

  function teardown() {
    clearTimeout(loadTimer);
    if (!frameEl) return;
    frameEl.src = "about:blank"; // silences audio right away
    frameEl.remove();
    frameEl = null;
  }

  function open(game) {
    if (current === game) return;
    teardown();
    current = game;
    if (!lastFocus) lastFocus = document.activeElement;

    pTitle.textContent = game.name;
    pNewTab.href = gameUrl(game);
    pIcon.hidden = true;
    pIcon.onload = () => { pIcon.hidden = false; };
    pIcon.onerror = () => { pIcon.hidden = true; };
    pIcon.src = gameDir(game) + enc(game.img);

    player.classList.remove("theater", "is-full");
    pLoading.classList.remove("done");
    player.hidden = false;
    // the page keeps its scrollbar gutter while locked; mirror it on the left so the player stays centred
    root.style.setProperty("--sbw", Math.max(0, innerWidth - root.clientWidth) + "px");
    root.classList.add("playing");
    home.forEach((el) => { el.inert = true; });

    frameEl = document.createElement("iframe");
    frameEl.title = game.name;
    frameEl.setAttribute("allow", "autoplay; fullscreen; gamepad; clipboard-write; accelerometer; gyroscope; microphone; camera");
    frameEl.setAttribute("allowfullscreen", "");
    const reveal = () => { pLoading.classList.add("done"); };
    frameEl.addEventListener("load", () => { reveal(); if (frameEl) frameEl.focus(); });
    loadTimer = setTimeout(reveal, 10000); // some games never fire `load`; don't hide them forever
    frameEl.src = gameUrl(game);
    pFrame.appendChild(frameEl);
    frameEl.focus();
  }

  function close() {
    if (!current) return;
    if (fsActive()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    teardown();
    current = null;
    player.hidden = true;
    player.classList.remove("theater", "is-full");
    root.classList.remove("playing");
    home.forEach((el) => { el.inert = false; });
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
    kick(); // restart the cursor-light loop
  }

  // "#/html/0-fa" -> that game
  function route() {
    if (gated()) return; // nothing opens behind the cover page
    const m = location.hash.match(/^#\/(.+)$/);
    let game = null;
    if (m) {
      try { game = byId.get(m[1].split("/").map(decodeURIComponent).join("/")); } catch (_) { /* bad escape */ }
    }
    if (game && !NOFRAME.has(game.id)) { open(game); return; }
    if (m) history.replaceState(null, "", location.pathname + location.search); // unknown id: tidy the URL
    close();
  }

  // x button / Esc: go back to the grid. After in-page navigation that is just "back",
  // so the browser history stays tidy; for a direct link we replace the entry instead.
  function leave() {
    if (inApp) history.back();
    else {
      history.replaceState(null, "", location.pathname + location.search);
      route();
    }
  }

  function toggleFull() {
    if (fsActive()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (player.classList.contains("theater")) { player.classList.remove("theater"); return; }
    const req = pFrame.requestFullscreen || pFrame.webkitRequestFullscreen;
    if (!req) { player.classList.add("theater"); return; } // e.g. iPhone
    const r = req.call(pFrame);
    if (r && r.catch) r.catch(() => player.classList.add("theater"));
    // if the browser neither goes fullscreen nor refuses, don't leave the button looking dead
    setTimeout(() => { if (current && !fsActive()) player.classList.add("theater"); }, 900);
  }

  const onFullChange = () => {
    lastFs = performance.now();
    player.classList.toggle("is-full", !!fsActive());
    if (frameEl) frameEl.focus();
  };
  document.addEventListener("fullscreenchange", onFullChange);
  document.addEventListener("webkitfullscreenchange", onFullChange);

  pClose.addEventListener("click", leave);
  pFull.addEventListener("click", toggleFull);
  pUnfull.addEventListener("click", () => player.classList.remove("theater"));
  // the game keeps running in the frame, so once it is popped out we head back to the grid
  pNewTab.addEventListener("click", () => setTimeout(leave, 0));

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !current) return;
    if (fsActive() || performance.now() - lastFs < 400) return; // that Esc belongs to fullscreen
    if (player.classList.contains("theater")) { player.classList.remove("theater"); return; }
    leave();
  });

  addEventListener("hashchange", () => { inApp = true; route(); });

  /* ---------- light that follows the cursor ---------- */

  const hoverCard = (e) => {
    const c = e.target.closest(".card");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", e.clientX - r.left + "px");
    c.style.setProperty("--my", e.clientY - r.top + "px");
  };
  grid.addEventListener("pointermove", hoverCard, { passive: true });

  let ptr = null; // pointer position while it is over the page
  const track = (e) => { ptr = { x: e.clientX, y: e.clientY }; };
  addEventListener("pointermove", track, { passive: true });
  addEventListener("pointerdown", track, { passive: true });
  addEventListener("pointercancel", () => { ptr = null; });
  addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") ptr = null; });
  root.addEventListener("pointerleave", () => { ptr = null; });

  const t0 = performance.now();
  let raf = 0;
  let last = t0;
  let p = 0, hi = 0, hx = 0, hy = 0; // gold band offset, hotspot strength, hotspot position
  let hot = false, lit = false;

  function frame(now) {
    raf = 0;
    if (current) return; // a game is running: leave the CPU to it (close() restarts this)

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = still ? 1 : 1 - Math.exp(-dt * 9);

    // with no pointer the bands drift on their own, the way the old timed sweep did
    let tp = still ? 0.3 : 0.5 - 0.5 * Math.cos(((now - t0) / 1000) * Math.PI * 2 / 18);
    let th = 0, tx = hx, ty = hy;

    const r = mark.getBoundingClientRect();
    if (ptr) {
      tp = clamp(ptr.x / innerWidth, 0, 1);
      const dx = Math.max(r.left - ptr.x, 0, ptr.x - r.right);
      const dy = Math.max(r.top - ptr.y, 0, ptr.y - r.bottom);
      th = 0.3 + 0.7 * clamp(1 - Math.hypot(dx, dy) / (innerHeight * 0.6), 0, 1);
      tx = clamp(ptr.x - r.left, -0.15 * r.width, 1.15 * r.width);
      ty = clamp(ptr.y - r.top, -0.2 * r.height, 1.2 * r.height);
      if (!hot) { hx = tx; hy = ty; } // first touch of the page: appear under the cursor, don't fly in
    }
    hot = !!ptr;

    p += (tp - p) * k;
    hi += (th - hi) * k;
    hx += (tx - hx) * k;
    hy += (ty - hy) * k;

    mark.style.setProperty("--p", (p * 100).toFixed(2) + "%");
    mark.style.setProperty("--hx", hx.toFixed(1) + "px");
    mark.style.setProperty("--hy", hy.toFixed(1) + "px");
    mark.style.setProperty("--hi", hi.toFixed(3));

    if (ptr) {
      for (const el of gilt) {
        const b = el.getBoundingClientRect();
        el.style.setProperty("--mx", ptr.x - b.left + "px");
        el.style.setProperty("--my", ptr.y - b.top + "px");
      }
      lit = true;
      glow.style.setProperty("--px", ptr.x + "px");
      glow.style.setProperty("--py", ptr.y + "px");
    } else if (lit) {
      for (const el of gilt) { el.style.removeProperty("--mx"); el.style.removeProperty("--my"); }
      lit = false;
    }

    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  /* ---------- cover page ---------- */

  // Every visit starts on the cover page (see index.html). Clicking anywhere on it opens pyrite.
  const gate = $("gate");
  if (gate && !gated()) gate.remove(); // embedded: no cover page
  if (gate && gated()) {
    gate.addEventListener("click", () => {
      root.classList.remove("gated");
      gate.remove();
      fill();
      route(); // a shared link like /#/html/0-fa opens now, not behind the cover
    }, { once: true });
  }

  /* ---------- shield: open pyrite inside an about:blank tab ---------- */

  const shield = $("shield");
  function cloak() {
    const w = window.open("about:blank", "_blank");
    if (!w) { flash("allow pop-ups to open in about:blank"); return; }
    const d = w.document;
    d.title = document.title;
    const icon = document.querySelector('link[rel~="icon"][sizes="32x32"]') || document.querySelector('link[rel~="icon"]');
    if (icon) {
      const l = d.createElement("link");
      l.rel = "icon";
      l.href = icon.href; // resolved to an absolute address, so it works from about:blank
      d.head.appendChild(l);
    }
    d.documentElement.style.background = "#050505";
    d.body.style.cssText = "margin:0;height:100vh;overflow:hidden;background:#050505";
    const f = d.createElement("iframe");
    f.src = location.href.split("#")[0]; // the cover page is skipped when pyrite is embedded
    f.style.cssText = "display:block;width:100%;height:100%;border:0";
    f.setAttribute("allow", "autoplay; fullscreen; gamepad; clipboard-write; accelerometer; gyroscope; microphone; camera");
    f.setAttribute("allowfullscreen", "");
    d.body.appendChild(f);
  }
  shield.addEventListener("click", cloak);

  kick();
  apply();
  route(); // a shared link like /#/html/0-fa opens straight into the game (after the cover page)
})();
