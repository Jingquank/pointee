// Renders the toolbar icon sets in icons/ from assets/icon.png — the mark,
// drawn at 1254px on a transparent ground.
// Run: node icons/generate-icons.mjs
//
// Two sets come out, named for the browser mode each is drawn for:
//   light-{16,32,48,128}.png  the drawing with a 1px ink line around it. On a
//                             white toolbar the cream hand is invisible
//                             without one. The manifest's default.
//   dark-{16,32,48,128}.png   the drawing as it is. On a dark toolbar the
//                             line would be a smudge.
// background.js swaps them by the colour scheme the pages report.
//
// A headless Chromium does the drawing — the same browser finder the test
// suite uses, so this needs nothing installed that the tests do not. The
// master is trimmed to its drawn pixels, then halved step by step until one
// last resize lands on each size; halving keeps the edges clean where a single
// jump from 1254px to 16px would shimmer. Each size sits in a square with a
// 1px margin at 16 and a 6% margin above that. The outline is measured in
// toolbar pixels at 16 and scales with the mark, so it reads the same at every
// size — the way a stroke on an SVG would.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MASTER = join(ROOT, "assets/icon.png");
const SIZES = [16, 32, 48, 128];
const SETS = [
  { name: "light", outline: 1 },
  { name: "dark", outline: 0 },
];
// The light theme's --pnt-text-1: the ink the line is drawn in. Not checked
// against tokens.css the way the badge map is — move it by hand if the token
// moves.
const OUTLINE_COLOR = "#1d1917";
const PORT = 9337;
const PROFILE = join(ROOT, ".pointee-icon-profile");

// Mirrors BROWSERS in test/cdp.mjs — change both.
const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Aside.app/Contents/MacOS/Aside",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const browserPath = process.env.PNT_CHROME || BROWSERS.find((p) => existsSync(p));
if (!browserPath) {
  console.error("No Chromium-based browser found. Point PNT_CHROME at a binary.");
  process.exit(1);
}

// Runs inside the page. Takes the master as a data URL, returns one PNG data
// URL per set and size plus what it measured, so a bad master (a halo, a stray
// pixel far from the mark) shows up in the log rather than in the toolbar.
async function render(src, sizes, sets, outlineColor) {
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const smooth = (ctx) => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; return ctx; };
  const pixels = (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height);

  // The box the drawn pixels occupy, ignoring anything fainter than 16/255.
  const trimBox = (img) => {
    const d = img.data, w = img.width, h = img.height;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  };

  // A line around the mark: its own silhouette in the line colour, stamped at
  // 24 angles on three rings out to the radius, the mark drawn back on top.
  const outlined = (canvas, radius, color) => {
    if (radius <= 0) return canvas;
    const m = Math.ceil(radius) + 2;
    const mask = mk(canvas.width, canvas.height);
    const mc = mask.getContext("2d");
    mc.drawImage(canvas, 0, 0);
    mc.globalCompositeOperation = "source-in";
    mc.fillStyle = color;
    mc.fillRect(0, 0, mask.width, mask.height);
    const out = mk(canvas.width + 2 * m, canvas.height + 2 * m);
    const oc = out.getContext("2d");
    for (const r of [radius, radius * 0.66, radius * 0.33]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        oc.drawImage(mask, m + Math.cos(a) * r, m + Math.sin(a) * r);
      }
    }
    oc.drawImage(mask, m, m);
    oc.drawImage(canvas, m, m);
    return out;
  };

  const resample = (canvas, box, size) => {
    const pad = size === 16 ? 1 : Math.round(size * 0.06);
    const inner = size - pad * 2;
    const scale = inner / Math.max(box.width, box.height);
    const tw = Math.max(1, Math.round(box.width * scale));
    const th = Math.max(1, Math.round(box.height * scale));
    let cur = mk(box.width, box.height);
    cur.getContext("2d").drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    while (cur.width / 2 >= tw && cur.height / 2 >= th) {
      const next = mk(Math.round(cur.width / 2), Math.round(cur.height / 2));
      smooth(next.getContext("2d")).drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
    }
    const icon = mk(size, size);
    smooth(icon.getContext("2d")).drawImage(cur, Math.floor((size - tw) / 2), Math.floor((size - th) / 2), tw, th);
    return icon.toDataURL("image/png");
  };

  const img = new Image();
  img.src = src;
  await img.decode();
  const full = mk(img.naturalWidth, img.naturalHeight);
  full.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
  const master = pixels(full);
  const W = master.width, H = master.height;
  let opaque = 0, partial = 0, clear = 0;
  for (let i = 3; i < master.data.length; i += 4) {
    const a = master.data[i];
    if (a === 0) clear++; else if (a === 255) opaque++; else partial++;
  }
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]
    .map(([x, y]) => master.data[(y * W + x) * 4 + 3]);
  const box = trimBox(master);
  // One toolbar pixel at 16, in master pixels: the mark fills 14 of the 16.
  const unit = Math.max(box.width, box.height) / 14;

  const out = {};
  for (const set of sets) {
    const canvas = outlined(full, set.outline * unit, outlineColor);
    const b = set.outline ? trimBox(pixels(canvas)) : box;
    out[set.name] = {};
    for (const size of sizes) out[set.name][size] = resample(canvas, b, size);
  }
  return { width: W, height: H, box, alpha: { opaque, partial, clear }, corners, out };
}

const master = "data:image/png;base64," + readFileSync(MASTER).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;
const pending = new Map();
const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

rmSync(PROFILE, { recursive: true, force: true });
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars",
], { stdio: "ignore" });

try {
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = targets.find((t) => t.type === "page");
    } catch { /* not up yet */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("the browser opened no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  });
  await send(ws, "Page.enable");
  const loaded = new Promise((r) => ws.addEventListener("message", function onMessage(e) {
    if (JSON.parse(e.data).method !== "Page.loadEventFired") return;
    ws.removeEventListener("message", onMessage);
    r();
  }));
  await send(ws, "Page.navigate", { url: "data:text/html;charset=utf-8,<!doctype html><meta charset=utf-8>" });
  await loaded;

  const { result, exceptionDetails } = await send(ws, "Runtime.evaluate", {
    expression: `(${render.toString()})(${JSON.stringify(master)}, ${JSON.stringify(SIZES)}, ${JSON.stringify(SETS)}, ${JSON.stringify(OUTLINE_COLOR)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  const r = result.value;
  console.log(`Master ${r.width}×${r.height}; drawn box ${r.box.width}×${r.box.height} at ${r.box.x},${r.box.y}; ` +
    `alpha: ${r.alpha.opaque} opaque, ${r.alpha.partial} partial, ${r.alpha.clear} clear; corners ${r.corners.join("/")}`);
  if (r.corners.some((a) => a !== 0)) console.warn("generate-icons: a corner of the master is not transparent — is the ground clean?");
  for (const set of SETS) {
    for (const size of SIZES) {
      const out = join(HERE, `${set.name}-${size}.png`);
      writeFileSync(out, Buffer.from(r.out[set.name][size].split(",")[1], "base64"));
      console.log(`Generated ${out}`);
    }
  }
} catch (err) {
  console.error("generate-icons:", err.message);
  process.exitCode = 1;
} finally {
  // Wait for the browser to be gone before removing its profile: killed while
  // still writing, it can leave a file behind between the rm's readdir and its
  // unlink, and the rm fails on a directory that is not empty.
  await new Promise((r) => { browser.once("exit", r); browser.kill("SIGKILL"); });
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
