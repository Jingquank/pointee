// Edit Mode integration suite — the real content.js, in a real browser.
//
// Every other test in this repo checks something *about* the source: the pure
// sweeps run a transcribed copy, edit-audit reads the file as text, tokens.mjs
// parses the CSS. None of them execute the shipped content script. That gap is
// not academic — five bugs shipped through it, and four of them were real
// browser behaviours no hand-written stub would have reproduced:
//
//   · CSS Nesting gives every CSSStyleRule a cssRules list, so the collector's
//     "is this a group rule?" test matched everything and read nothing.
//   · Chrome keeps an empty attribute node after the first removeAttribute,
//     so every reset left a style="" behind.
//
// A stub would have encoded the same wrong assumptions and passed. So this file
// drives an actual Chromium over the DevTools Protocol, loads the harness, and
// asserts against computed styles the browser really produced.
//
// Zero dependencies, deliberately — the repo has none and should keep none.
// Node 24 ships WebSocket and fetch globally, which is the whole client.
//
// Run: node test/cdp.mjs   (exit 1 on any failure)
//      node test/cdp.mjs --headful   to watch it happen

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADFUL = process.argv.includes("--headful");
const PORT = 8791;
const DEBUG_PORT = 9333;
const PROFILE = join(tmpdir(), "pnt-cdp-profile");

// browser.kill() returns before Chrome has finished letting go of its profile,
// so removing the directory straight afterwards loses a race often enough to
// turn a green run red — in the teardown, after every assertion has already
// passed. rmSync retries ENOTEMPTY and EBUSY when asked to; it just has to be
// asked. Two seconds of patience, and only when it is actually needed.
const RM_PROFILE = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 };

// Any Chromium will do — the extension targets Chrome but the protocol is the
// same everywhere, and a contributor may well not have Chrome installed. The
// list is ordered by "most likely to be the browser this extension is
// developed against".
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

function findBrowser() {
  if (process.env.PNT_CHROME) return process.env.PNT_CHROME;
  const found = BROWSERS.find((p) => existsSync(p));
  if (!found) {
    console.error(
      "No Chromium-based browser found. Install Chrome, or point PNT_CHROME at a binary:\n" +
      "  PNT_CHROME='/path/to/browser' node test/cdp.mjs"
    );
    process.exit(1);
  }
  return found;
}

// ===== static server =====
// file:// cannot be used: a file:// stylesheet throws on .cssRules exactly like
// a cross-origin one, which would disable the token layer under test.

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try {
      const body = await readFile(join(ROOT, path));
      const headers = {
        "content-type": MIME[extname(path)] || "application/octet-stream",
        // The harness rewrites stylesheet URLs to dodge caching; belt and
        // braces, so a stale content.css can never make a run lie.
        "cache-control": "no-store",
      };
      // The whole point of the remote-sheet fixture: a cross-origin <link> is
      // refused, while a fetch of the same URL is allowed. That is the exact
      // asymmetry the extension lives with — the page cannot read a CDN
      // stylesheet, the service worker's host permissions can fetch it — and
      // it is reproduced here by answering on Sec-Fetch-Dest rather than by
      // running a second server.
      if (req.headers["sec-fetch-dest"] !== "style") {
        headers["access-control-allow-origin"] = "*";
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

// ===== CDP client =====

let nextId = 1;
const pending = new Map();

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    });
  });
}

function send(ws, method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

// Evaluate in the page and hand back the value. Errors inside the page become
// errors here rather than an undefined that quietly passes an assertion.
async function evaluate(ws, expression) {
  const result = await send(ws, "Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const e = result.exceptionDetails;
    throw new Error(e.exception?.description || e.text || "page threw");
  }
  return result.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 5000) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

// ===== harness driving =====
// Written as page-side helpers so each case reads as the user's actions rather
// than as DOM plumbing.

const HELPERS = `
  window.__t = {
    panel: () => document.getElementById("pnt-edit-panel"),
    row: (name) => document.querySelector('#pnt-edit-panel .pnt-edit-row[data-control="' + name + '"]'),
    probeOn: () => window.__pntHarness.setState(true),
    probeOff: () => window.__pntHarness.setState(false),
    select: (sel, dx = 5, dy = 5) => {
      const el = document.querySelector(sel);
      // Selection resolves its target with elementFromPoint, so a click aimed
      // below the fold lands on nothing. The headless window is smaller than
      // this fixture, so anything past the first screen has to be brought into
      // view before its rect means anything.
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + dx, clientY: r.top + dy }));
      return el;
    },
    edit: () => document.querySelector('#pnt-toolbar button[data-action="edit"]').click(),
    esc: () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    undo: (shift) => document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: !!shift, bubbles: true })),
    // One stepper since round four: the capsule under the field carries the
    // ‹ › in rows and cells alike. The wheel only scrolls.
    step: (name, dir) => {
      const tok = window.__t.row(name).querySelector(".pnt-edit-tok");
      tok.querySelectorAll("button")[dir > 0 ? 1 : 0].click();
    },
    // ...and one reset: the label is the edited mark and takes the edit back.
    resetProp: (name) => {
      window.__t.row(name).querySelector(".pnt-edit-label").click();
    },
    type: (name, value) => {
      const input = window.__t.row(name).querySelector(".pnt-edit-input");
      input.focus();
      input.value = String(value);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    },
    pop: () => document.getElementById("pnt-color-picker"),
    swatch: (name) => window.__t.row(name).querySelector(".pnt-edit-swatch").click(),
    css: (sel, prop) => getComputedStyle(document.querySelector(sel)).getPropertyValue(prop).trim(),
    // The edit guards sit capture-phase on document and swallow these five, so
    // whether one arrives is the direct measurement of "is the page still
    // inert" — which is what a half-finished teardown leaves behind.
    reaches: (sel, type) => {
      const el = document.querySelector(sel);
      let got = false;
      const spy = () => { got = true; };
      el.addEventListener(type, spy);
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      el.removeEventListener(type, spy);
      return got;
    },
    // A copy button holds its success state — disabled — for 1500ms, so a case
    // that copies twice would silently measure one click and one nothing.
    // Skipping the wait rather than serving it: this is exactly what the
    // button's own timeout does, and ten of them would add fifteen seconds to
    // the suite to prove a delay nobody is testing.
    press: async (sel) => {
      const btn = document.querySelector(sel);
      if (!btn) throw new Error("no button at " + sel);
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
      btn.disabled = false;
      let text = null;
      const real = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (t) => { text = t; return Promise.resolve(); };
      btn.click();
      await new Promise((r) => setTimeout(r, 30));
      navigator.clipboard.writeText = real;
      return text;
    },
    copy: () => window.__t.press("#pnt-edit-panel .pnt-edit-copy"),
    // The toolbar's first labelled button is Copy Code.
    copyCode: () => window.__t.press("#pnt-toolbar .pnt-bar button"),
    // The storage stub fires the content script's onChanged listener
    // synchronously, so a pref written here is in force by the time the click
    // lands — no wait, and no polling for one.
    prefs: (obj) => chrome.storage.local.set(obj),
    // The stub is backed by localStorage, so preferences outlive a reload the
    // way the real ones outlive a tab. Every copy case starts from the shipped
    // defaults, or it would be reading the previous case's settings.
    copyDefaults: () => window.__t.prefs({
      copySource: "on", copyComponent: "on", copyPage: "on", copyAnchor: "on",
      copyHandlers: "on", copySelector: "on", copyPosition: "on", copyRepeated: "on",
      copyText: "on", copyLayout: "off", copyStyles: "off", copyProps: "off",
      copyHtml: "root", copyDepth: "3", copyHtmlFallback: "on", copyFence: "on",
    }),
    // The pointer's own fields, told apart from their continuations by what
    // follows the hash — "# key: " opens one, "#   " continues it.
    keys: (payload) => (payload || "").split("\\n")
      .map((l) => l.match(/^# ([a-z]+): /)).filter(Boolean).map((m) => m[1]),
    // Everything after the header: the HTML block, fences stripped.
    block: (payload) => (payload || "").split("\\n")
      .filter((l) => !l.startsWith("#") && !l.startsWith("\`\`\`") && l.trim())
      .join("\\n"),
  };
  return true;
`;

async function loadHarness(ws) {
  await send(ws, "Page.navigate", { url: `http://127.0.0.1:${PORT}/test/edit-harness.html` });
  await waitFor(
    async () => await evaluate(ws, "return !!(window.__pntHarness && window.__pntProbe)"),
    "the harness to boot"
  );
  // The harness re-fetches its stylesheets with a cache-busting query, so the
  // token collector must not run until they have parsed — otherwise it reads
  // an empty document.styleSheets and every token case fails for the wrong
  // reason. This waits for the real signal rather than guessing at a delay.
  await waitFor(
    async () => await evaluate(ws, "return window.__pntProbe.stylesheetsReady()"),
    "stylesheets to parse"
  );
  await evaluate(ws, HELPERS);
}

// ===== harness =====

const rows = [];
let failures = 0;

// PNT_ONLY=handoff node test/cdp.mjs runs only the checks whose name contains it.
const ONLY = process.env.PNT_ONLY;
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const errs = [];
  try {
    await fn((msg) => errs.push(msg));
  } catch (err) {
    errs.push(String(err.message || err));
  }
  failures += errs.length;
  rows.push({ case: name, result: errs.length ? "FAIL" : "ok", detail: errs.slice(0, 3).join("; ") });
}

// ===== the run =====

const server = await serve();
const browserPath = findBrowser();
rmSync(PROFILE, RM_PROFILE);

const browser = spawn(browserPath, [
  ...(HEADFUL ? [] : ["--headless=new"]),
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
], { stdio: "ignore" });

let ws;
try {
  let version;
  await waitFor(async () => {
    try {
      version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
      return true;
    } catch { return false; }
  }, "the browser to expose CDP", 15000);

  // /json/version answers before the first tab exists — Aside in particular
  // takes a beat — so wait for a page target rather than taking the first
  // entry of a list that may not have one yet.
  let page;
  await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    page = targets.find((t) => t.type === "page");
    return Boolean(page);
  }, "the browser to open a page target", 15000);
  ws = await connect(page.webSocketDebuggerUrl);
  await send(ws, "Page.enable");
  await send(ws, "Runtime.enable");

  console.log(`${browserPath.split("/").pop()} — ${version.Browser}\n`);

  // ===== 1. Regression: the token layer was entirely dead =====
  // CSS Nesting gave every CSSStyleRule a cssRules list, so the collector
  // treated every ordinary rule as a group, recursed into an empty list, and
  // never read a single declaration. Nothing failed; the feature just silently
  // did nothing. The index size is the direct measurement.

  await loadHarness(ws);

  await check("token index is populated", async (fail) => {
    await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      return true;
    `);
    const size = await evaluate(ws, "return window.__pntProbe.tokenIndexSize()");
    if (!size || size.rules === 0) fail(`collector read ${size && size.rules} rules from the page`);
    if (!size || size.varNames === 0) fail(`collector found ${size && size.varNames} custom properties`);
  });

  await check("palette offers the page's own tokens", async (fail) => {
    const names = await evaluate(ws, `
      window.__t.row("color") || window.__t.row("background-color");
      const row = document.querySelector('#pnt-edit-panel .pnt-edit-row[data-control="color"]')
        || document.querySelector('#pnt-edit-panel .pnt-edit-row[data-control="background-color"]');
      row.querySelector(".pnt-edit-swatch").click();
      const pop = document.querySelector(".pnt-edit-pop");
      return [...pop.querySelectorAll(".pnt-edit-pal")].map((b) => b.title.split(" — ")[0]);
    `);
    if (!names.length) fail("palette was empty");
    if (!names.includes("--terra")) fail(`page tokens missing; got ${JSON.stringify(names.slice(0, 5))}`);
  });

  // ===== 2. Regression: our own tokens leaked into the page's palette =====
  // tokens.css and content.css ride along on every page as content scripts, so
  // the collector was offering --pnt-accent as a fill for the user's elements.

  await check("palette excludes our own chrome tokens", async (fail) => {
    const leaked = await evaluate(ws, `
      const pop = document.querySelector(".pnt-edit-pop");
      return [...pop.querySelectorAll(".pnt-edit-pal")]
        .map((b) => b.title.split(" — ")[0]).filter((n) => n.startsWith("--pnt-"));
    `);
    if (leaked.length) fail(`leaked ${JSON.stringify(leaked.slice(0, 4))}`);
    await evaluate(ws, "window.__t.esc(); return true;"); // close the picker
  });

  // ===== 3. Regression: a token step was recorded but never applied =====
  // applyEditValue read "the current value" back out of the registry, but every
  // caller stored the new value first — so it compared the new value with
  // itself, concluded nothing had changed, and skipped the write. The delta
  // said the step happened; the page disagreed.

  await check("stepping a token moves the page", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      const before = window.__t.css(".card h2", "font-size");
      window.__t.step("font-size", 1);
      const after = window.__t.css(".card h2", "font-size");
      return { before, after };
    `);
    if (seen.before !== "18px") fail(`expected to start at 18px, got ${seen.before}`);
    if (seen.after !== "22px") fail(`step wrote ${seen.after}, not 22px — recorded but not applied`);
  });

  // ===== 4. Regression: undo walked to the beginning instead of stepping =====
  // The registry pins a property's "before" at first touch, which is right for
  // the delta. The undo entry reused it, so every entry meant "back to the
  // original" and two steps collapsed into one undo.

  await check("undo gives back one change at a time", async (fail) => {
    const seen = await evaluate(ws, `
      window.__t.step("font-size", 1);          // 22 -> 28
      const twoSteps = window.__t.css(".card h2", "font-size");
      window.__t.undo();
      const once = window.__t.css(".card h2", "font-size");
      window.__t.undo();
      const twice = window.__t.css(".card h2", "font-size");
      window.__t.undo(true);
      const redone = window.__t.css(".card h2", "font-size");
      return { twoSteps, once, twice, redone };
    `);
    if (seen.twoSteps !== "28px") fail(`two steps reached ${seen.twoSteps}, not 28px`);
    if (seen.once !== "22px") fail(`one undo landed on ${seen.once}, not 22px — jumped past a step`);
    if (seen.twice !== "18px") fail(`two undos landed on ${seen.twice}, not 18px`);
    if (seen.redone !== "22px") fail(`redo landed on ${seen.redone}, not 22px`);
  });

  // ===== 5. Regression: every reset left a style="" behind =====
  // Once an inline block has been written through CSSOM, Chrome's first
  // removeAttribute empties it but leaves the attribute node — so an element
  // the tool had finished with still carried a mark of having been touched.

  await check("every path back leaves no residue", async (fail) => {
    for (const [label, undoExpr] of [
      ["undo", `window.__t.undo();`],
      ["dirty dot", `window.__t.resetProp("font-size");`],
      ["reset all", `document.querySelector("#pnt-edit-panel .pnt-edit-resetall").click();`],
    ]) {
      // A fresh page each time: this asserts "one edit, one way back, nothing
      // left" and would otherwise inherit whatever the previous case left in
      // the undo stack.
      await loadHarness(ws);
      const seen = await evaluate(ws, `
        window.__t.probeOn();
        window.__t.select(".card h2");
        window.__t.edit();
        window.__t.step("font-size", 1);
        ${undoExpr}
        const el = document.querySelector(".card h2");
        return { style: el.getAttribute("style"), size: window.__t.css(".card h2", "font-size") };
      `);
      if (seen.style !== null) fail(`${label} left style=${JSON.stringify(seen.style)}`);
      if (seen.size !== "18px") fail(`${label} left the size at ${seen.size}`);
    }
  });

  // ===== Beyond the five: the escalation the dead index also disabled =====
  // findWinningDeclaration reads the same index, so while it was empty an edit
  // to an !important-covered property silently did nothing.

  await check("an !important page rule is matched, not lost to", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card.stubborn", 3, 60);
      window.__t.edit();
      const before = window.__t.css(".card.stubborn", "padding-top");
      window.__t.type("padding", 44);
      // Typing commits twice — once on Enter, once on the blur that follows.
      // The second commit is what used to strip the escalation, so asserting
      // after it is the whole point.
      window.__t.type("padding", 44);
      const el = document.querySelector(".card.stubborn");
      return { before, after: window.__t.css(".card.stubborn", "padding-top"),
               priority: el.style.getPropertyPriority("padding"),
               styleAttr: el.getAttribute("style") };
    `);
    if (seen.before !== "20px") fail(`fixture changed: expected 20px, got ${seen.before}`);
    if (seen.after !== "44px") fail(`edit was overridden by the page's !important (got ${seen.after})`);
    if (seen.priority !== "important") {
      fail(`escalation lost — style=${JSON.stringify(seen.styleAttr)}`);
    }
  });

  // ===== The loop the whole feature exists for =====

  await check("the delta block reports what changed", async (fail) => {
    const block = await evaluate(ws, `
      await new Promise(r => setTimeout(r, 20));
      return await window.__t.copy();
    `);
    if (!block) return fail("copy produced nothing");
    if (!block.includes("# edits:")) fail("no edits section");
    if (!/padding[^\\n]*20px[^\\n]*→[^\\n]*44px/.test(block)) {
      fail(`padding delta missing from block: ${JSON.stringify(block.slice(0, 200))}`);
    }
  });

  // ===== Regression: switching off left Edit Mode running =====
  // deactivate() nulled selectedElement itself instead of going through
  // deselectElement(), so it never reached exitEditMode(). The panel and the
  // picker stayed on screen, `editing` stayed true, and the five capture-phase
  // pointer guards stayed on document — leaving the user's page inert until a
  // reload and the next activation unable to select anything.

  await check("switching off dismantles Edit Mode", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      window.__t.step("font-size", 1);
      window.__t.swatch("background-color");
      const hadPicker = !!window.__t.pop();
      window.__t.probeOff();
      const el = document.querySelector(".card h2");
      return {
        hadPicker,
        panel: !!window.__t.panel(),
        picker: !!window.__t.pop(),
        editingClass: document.documentElement.classList.contains("pnt-editing"),
        style: el.getAttribute("style"),
        size: window.__t.css(".card h2", "font-size"),
        // The page has to be live again, not just uncluttered.
        mousedown: window.__t.reaches(".card h2", "mousedown"),
        dblclick: window.__t.reaches(".card h2", "dblclick"),
      };
    `);
    if (!seen.hadPicker) fail("fixture never opened a picker to begin with");
    if (seen.panel) fail("the edit panel outlived the switch-off");
    if (seen.picker) fail("the colour picker outlived the switch-off");
    if (seen.editingClass) fail("pnt-editing is still on <html>");
    if (!seen.mousedown) fail("the page is still inert — mousedown never arrived");
    if (!seen.dblclick) fail("the page is still inert — dblclick never arrived");
    if (seen.style !== null) fail(`the page kept style=${JSON.stringify(seen.style)}`);
    if (seen.size !== "18px") fail(`the edit survived at ${seen.size}`);
  });

  // Switching off used to poison the next activation too: `editing` stayed true,
  // so onClick swallowed the click and then returned before selecting anything.

  await check("switching back on can still select", async (fail) => {
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      return { toolbar: !!document.getElementById("pnt-toolbar") };
    `);
    if (!seen.toolbar) fail("nothing was selectable after an off/on cycle");
  });

  // ===== Regression: the colour picker had no visible way out =====
  // It was a child of the panel, painted over the rows it was tuning, and the
  // only exit was an Escape nothing advertised — clicking the swatch again just
  // rebuilt it identically, so the obvious gesture looked broken.

  await check("the picker is its own surface, with a way out", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();

      window.__t.swatch("background-color");
      const pop = window.__t.pop();
      const detached = !!pop && !window.__t.panel().contains(pop);
      const closeBtn = !!pop && !!pop.querySelector(".pnt-edit-popclose");

      // Re-clicking the swatch closes rather than silently rebuilding.
      window.__t.swatch("background-color");
      const afterSecondClick = !!window.__t.pop();

      // ...and a third click brings it back, so the toggle goes both ways.
      window.__t.swatch("background-color");
      const reopened = !!window.__t.pop();
      window.__t.pop().querySelector(".pnt-edit-popclose").click();
      const afterCloseBtn = !!window.__t.pop();

      // Escape still steps out of the picker before it leaves Edit Mode.
      window.__t.swatch("background-color");
      window.__t.esc();
      return {
        detached, closeBtn, afterSecondClick, reopened, afterCloseBtn,
        pickerAfterEsc: !!window.__t.pop(),
        panelAfterEsc: !!window.__t.panel(),
      };
    `);
    if (!seen.detached) fail("the picker is still nested inside the panel");
    if (!seen.closeBtn) fail("the picker has no close button");
    if (seen.afterSecondClick) fail("clicking the open swatch did not close the picker");
    if (!seen.reopened) fail("the swatch stopped reopening the picker");
    if (seen.afterCloseBtn) fail("the close button did not close the picker");
    if (seen.pickerAfterEsc) fail("Escape did not close the picker");
    if (!seen.panelAfterEsc) fail("Escape closed the panel too — the ladder collapsed");
  });

  // ===== Values the pure parsers cannot read =====
  // parseCssLength took px/rem/em and parseCssColor took hex/rgb, so a Tailwind
  // v4 page — calc() spacing, oklch() palette — reported no tokens at all while
  // looking perfectly healthy. resolveLength/resolveColor hand those to the
  // browser instead. Painting the colour and reading the pixel is the only
  // thing that resolves oklch(): Chrome returns it unchanged from both computed
  // style and canvas fillStyle.

  await check("a calc() scale is detected and steppable", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".v4-card", 4, 4);
      window.__t.edit();
      const row = window.__t.row("padding");
      const tok = row && row.querySelector(".pnt-edit-tok");
      const before = window.__t.css(".v4-card", "padding-top");
      if (tok) tok.querySelectorAll("button")[1].click();   // step up one rung
      return {
        stepper: Boolean(tok),
        step: tok ? tok.querySelector("b").textContent : null,
        before,
        after: window.__t.css(".v4-card", "padding-top"),
      };
    `);
    // --pad-4 is calc(var(--spacing) * 4) = 16px. Nothing here is a bare length,
    // so the old parser saw no family and offered no stepper at all.
    if (seen.before !== "16px") fail(`fixture changed: --pad-4 is ${seen.before}, want 16px`);
    if (!seen.stepper) return fail("no stepper on a padding set from a calc() token");
    if (seen.step !== "4") fail(`stepper reads "${seen.step}", want the rung named 4`);
    if (seen.after !== "32px") fail(`stepping up gave ${seen.after}, want 32px (--pad-8)`);
  });

  await check("oklch and friends reach the palette", async (fail) => {
    const seen = await evaluate(ws, `
      window.__t.swatch("background-color");
      const pals = [...window.__t.pop().querySelectorAll(".pnt-edit-pal")];
      return Object.fromEntries(pals.map((b) => {
        const [name, hex] = b.title.split(" — ");
        return [name, hex];
      }));
    `);
    // Each of these is a syntax parseCssColor refuses outright, so each was
    // silently absent from every palette before the rasteriser.
    for (const name of ["--brand-500", "--brand-700", "--surface-raised", "--edge"]) {
      if (!(name in seen)) {
        fail(`${name} missing from the palette; got ${JSON.stringify(Object.keys(seen).slice(0, 14))}`);
      }
    }
    // rebeccapurple is exactly #663399 — a keyword, and a check that the
    // rasteriser is reporting the real colour rather than a plausible one.
    if (seen["--edge"] && seen["--edge"].toLowerCase() !== "#663399") {
      fail(`--edge resolved to ${seen["--edge"]}, want #663399`);
    }
    await evaluate(ws, "window.__t.esc(); return true;"); // close the picker
  });

  // ===== A shorthand utility class is still a scale =====
  // CSSOM lists `padding: 12px` as its four longhands, so `.p-3 { padding: … }`
  // is indexed under padding-top and never under padding — while the linked
  // padding control asks about padding. The two could not meet, so no
  // shorthand-setting utility class was ever detected or ever formed a family.
  // That is every Tailwind spacing class. `.text-lg` worked throughout, because
  // font-size is already a longhand, and that is what made a missing edge look
  // like partial support.

  await check("a spacing utility class is detected and steppable", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".p-3-only", 3, 3);
      window.__t.edit();
      const tok = window.__t.row("padding").querySelector(".pnt-edit-tok");
      const before = window.__t.css(".p-3-only", "padding-top");
      if (tok) tok.querySelectorAll("button")[1].click();   // one rung up
      return {
        step: tok ? tok.querySelector("b").textContent : null,
        before,
        after: window.__t.css(".p-3-only", "padding-top"),
        cls: document.querySelector(".p-3-only").className,
      };
    `);
    if (seen.before !== "12px") fail(`fixture changed: .p-3 is ${seen.before}, want 12px`);
    if (seen.step === null) return fail("no stepper on padding set by a utility class");
    if (seen.step !== "3") fail(`stepper reads "${seen.step}", want the rung named 3`);
    // .p-4 is the next rung at 16px. The swap is applied and then verified by
    // the existing escalation path, so this also proves the class actually won.
    if (seen.after !== "16px") fail(`stepping up gave ${seen.after}, want 16px (.p-4)`);
    if (!seen.cls.includes("p-4")) fail(`the class was not swapped: ${seen.cls}`);
  });

  // ===== A stylesheet the page is forbidden to read =====
  // A cross-origin <link> without CORS throws on .cssRules, and a content
  // script's own fetch is refused the same way, so the service worker's host
  // permissions are the only way through. The harness stands in for the worker
  // (nothing inside a page can grant itself host permissions), so what this
  // proves is the half that lives in content.js: the sheet is noticed as
  // blocked, asked for, parsed, and folded back in.
  //
  // What it buys is narrower than it first appears, and the first version of
  // this case was wrong about it. Custom properties from an unreadable sheet
  // already reach the element — the browser applies them whether or not script
  // may read the rule — so collectElementTokens finds them without any fetch.
  // A *class* rule has no such shadow: nothing about the element reports that
  // .remote-pad-2 means 14px. That, and the declaration text a var() must be
  // read out of, is what is actually recovered here.

  await check("a blocked stylesheet's custom properties need no fetch", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      const remote = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .find((l) => l.href.includes("edit-harness-remote"));
      let readable = null;
      try { readable = Boolean(remote.sheet && remote.sheet.cssRules); }
      catch { readable = false; }
      return {
        linked: Boolean(remote),
        readable,
        resolves: getComputedStyle(document.documentElement)
          .getPropertyValue("--remote-brand").trim(),
      };
    `);
    if (!seen.linked) return fail("fixture broken: the remote stylesheet was never linked");
    // If CORS ever starts allowing this, every case below is testing nothing.
    if (seen.readable) fail("fixture broken: the page CAN read the remote sheet");
    if (seen.resolves !== "#b5179e") {
      fail(`--remote-brand resolves to ${JSON.stringify(seen.resolves)} — the sheet did not apply`);
    }
  });

  await check("a blocked stylesheet's utility classes are fetched and folded in", async (fail) => {
    // A fresh page: the fetched-sheet cache survives Edit Mode entries, so a
    // previous case having already paid for the round trip would make "before"
    // meaningless.
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".remote-pad-2", 4, 4);
      window.__t.edit();
      const stepper = () => {
        const row = window.__t.row("padding");
        const tok = row && row.querySelector(".pnt-edit-tok");
        return tok ? tok.querySelector("b").textContent : null;
      };
      const before = stepper();
      // The top-up is fired from enterEditMode and not awaited, so give the
      // round trip a moment; it re-renders the rows when it lands.
      await new Promise((r) => setTimeout(r, 500));
      return { before, after: stepper(), padding: window.__t.css(".remote-pad-2", "padding-top") };
    `);
    if (seen.padding !== "14px") fail(`fixture changed: .remote-pad-2 is ${seen.padding}, want 14px`);
    if (seen.before !== null) {
      fail(`a class rule from an unreadable sheet was known before the fetch (step "${seen.before}")`);
    }
    if (seen.after === null) fail("the fetched class rule never produced a stepper");
  });

  // ===== A colour delta can name the token it started on =====
  // detectPropertyToken opened with a length parse and returned null for
  // anything else, so no colour ever claimed a token and the before side of a
  // colour edit was always a bare hex — the one side of the block an agent uses
  // to find the declaration to change. The colour branch is deliberately the
  // same shape as the length one: only a declaration that actually names a
  // token may claim it, so a colour that merely equals --ink is still reported
  // as a hex.

  await check("a colour delta names the token, and only when it should", async (fail) => {
    await loadHarness(ws);
    const block = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".themed-title");   // color: var(--ink), which .themed overrides
      window.__t.edit();
      window.__t.swatch("color");
      const hexIn = window.__t.pop().querySelector(".pnt-edit-hexin");
      hexIn.focus();
      hexIn.value = "#112233";
      hexIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      window.__t.esc();
      await new Promise((r) => setTimeout(r, 20));
      return await window.__t.copy();
    `);
    if (!block) return fail("copy produced nothing");
    const line = block.split("\n").find((l) => l.includes("color:"));
    if (!line) return fail(`no colour line in the block: ${JSON.stringify(block.slice(0, 220))}`);
    // .themed sets --ink to #f5f3ee, so the token *and* the value it had there.
    if (!line.includes("--ink")) fail(`before side lost the token: ${line.trim()}`);
    if (!line.includes("#f5f3ee")) fail(`before side lost the value: ${line.trim()}`);
    if (!line.includes("#112233")) fail(`after side wrong: ${line.trim()}`);
  });

  await check("a colour that merely equals a token claims nothing", async (fail) => {
    await loadHarness(ws);
    const block = await evaluate(ws, `
      window.__t.probeOn();
      // .card p is color: #57544c written as a literal — the same value as
      // --ink-dim, but the declaration does not name it.
      window.__t.select(".card p");
      window.__t.edit();
      window.__t.swatch("color");
      const hexIn = window.__t.pop().querySelector(".pnt-edit-hexin");
      hexIn.focus();
      hexIn.value = "#0a0a0a";
      hexIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      window.__t.esc();
      await new Promise((r) => setTimeout(r, 20));
      return { block: await window.__t.copy(), dim: getComputedStyle(document.documentElement).getPropertyValue("--ink-dim").trim() };
    `);
    if (block.dim !== "#57544c") fail(`fixture changed: --ink-dim is ${block.dim}`);
    const line = (block.block || "").split("\n").find((l) => l.includes("color:"));
    if (!line) return fail("no colour line in the block");
    if (line.includes("--ink-dim")) {
      fail(`claimed a token the declaration never named: ${line.trim()}`);
    }
    if (!line.includes("#57544c")) fail(`before side should be the plain hex: ${line.trim()}`);
  });

  // ===== Discovery no longer depends on being able to read the stylesheet =====
  // Tokens used to be found by walking document.styleSheets for names. Anything
  // the walk could not reach was therefore invisible, however well it resolved
  // on the element: a cross-origin sheet, a shadow root, or — the case staged
  // here, because it is the one a fixture can stage honestly — an @import,
  // which is neither a member of document.styleSheets nor reachable through
  // the recursion, since CSSImportRule exposes .styleSheet rather than
  // .cssRules. Asking the element instead makes the source irrelevant.

  await check("tokens the stylesheet walk cannot reach are still offered", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();

      // What a stylesheet walk can see, measured from the page rather than
      // from the extension — the same argument __pntProbe already makes.
      const reachable = new Set();
      const walk = (rules) => {
        for (const r of rules) {
          if (r.selectorText && r.style) {
            for (let i = 0; i < r.style.length; i++) {
              const p = r.style[i];
              if (p.startsWith("--")) reachable.add(p);
            }
          }
          if (r.cssRules && r.cssRules.length) walk(r.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        try { if (sheet.cssRules) walk(sheet.cssRules); } catch { /* blocked */ }
      }

      window.__t.swatch("background-color");
      const palette = [...window.__t.pop().querySelectorAll(".pnt-edit-pal")]
        .map((b) => b.title.split(" — ")[0]);
      const step = window.__t.row("font-size").querySelector(".pnt-edit-tok");
      return {
        walkSees: [...reachable].filter((n) => n.startsWith("--imported")),
        palette,
        resolves: getComputedStyle(document.querySelector(".card h2"))
          .getPropertyValue("--imported-ink").trim(),
      };
    `);

    // The premise: these resolve on the element but the walk cannot find them.
    if (seen.resolves !== "#2b1d4a") {
      fail(`fixture broken: --imported-ink resolves to ${JSON.stringify(seen.resolves)}`);
    }
    if (seen.walkSees.length) {
      fail(`fixture broken: the walk can reach ${JSON.stringify(seen.walkSees)} — it is no longer an @import test`);
    }
    // The claim: the panel offers them anyway.
    if (!seen.palette.includes("--imported-ink")) {
      fail(`--imported-ink missing from the palette; got ${JSON.stringify(seen.palette)}`);
    }
    if (!seen.palette.includes("--imported-accent")) {
      fail("--imported-accent missing — an oklch token behind an @import");
    }
    await evaluate(ws, "window.__t.esc(); return true;");
  });

  // Scope was never the broken part — resolving a name against the selected
  // element has always respected it. This pins that, so the inversion above
  // cannot regress it by reading tokens off the document instead.

  await check("a themed subtree offers its own values", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      const palette = () => Object.fromEntries(
        [...window.__t.pop().querySelectorAll(".pnt-edit-pal")]
          .map((b) => { const [n, h] = b.title.split(" — "); return [n, h.toLowerCase()]; })
      );
      const read = (sel, dx, dy) => {
        window.__t.select(sel, dx, dy);
        window.__t.edit();
        window.__t.swatch("background-color");
        const out = palette();
        window.__t.esc();  // picker
        window.__t.esc();  // edit mode
        window.__t.esc();  // selection
        return out;
      };
      window.__t.probeOn();
      return { root: read(".card h2", 5, 5), themed: read(".themed-title", 5, 5) };
    `);

    // :root says --ink is near-black and --paper is white.
    if (seen.root["--ink"] !== "#1f1e1b") fail(`root --ink is ${seen.root["--ink"]}, want #1f1e1b`);
    if (seen.root["--paper"] !== "#ffffff") fail(`root --paper is ${seen.root["--paper"]}, want #ffffff`);

    // .themed inverts both. The old collector had one --ink in a Set and asked
    // the selected element for it, so this is the case it could not represent.
    if (seen.themed["--ink"] !== "#f5f3ee") {
      fail(`themed --ink is ${seen.themed["--ink"]}, want #f5f3ee — the theme scope was not seen`);
    }
    if (seen.themed["--paper"] !== "#16150f") {
      fail(`themed --paper is ${seen.themed["--paper"]}, want #16150f`);
    }
    // And an overridden oklch token resolves to the override, not to :root's.
    if (seen.themed["--brand-500"] === seen.root["--brand-500"]) {
      fail(`--brand-500 did not change under .themed (both ${seen.root["--brand-500"]})`);
    }
  });

  // ===== The browser fact the token layer is built on =====
  // Token discovery asks the element which custom properties are in scope on it,
  // rather than walking stylesheets to find their names. That is only possible
  // because the platform will enumerate them — and which API does so is a fact
  // about Chrome, not about this code. It is asserted here so that a browser
  // that changes its mind reports it as this line failing, rather than as
  // "tokens quietly stopped working".

  await check("the platform enumerates custom properties in scope", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      const el = document.querySelector(".card h2");
      const want = "--title-sm";   // declared on :root by the fixture

      let viaMap = null;
      if (el.computedStyleMap) {
        try {
          const names = [];
          for (const [prop] of el.computedStyleMap()) names.push(prop);
          viaMap = { total: names.length, custom: names.filter(n => n.startsWith("--")).length, has: names.includes(want) };
        } catch (e) { viaMap = { error: String(e.message || e) }; }
      }

      const cs = getComputedStyle(el);
      const csNames = Array.from(cs);
      const viaComputed = {
        total: csNames.length,
        custom: csNames.filter(n => n.startsWith("--")).length,
        has: csNames.includes(want),
      };

      return { viaMap, viaComputed, resolves: cs.getPropertyValue(want).trim(), ua: navigator.userAgent };
    `);

    // Whichever path wins, the value must still be readable by name — that is
    // what makes an enumerated name useful rather than merely present.
    if (!seen.resolves) fail(`--title-sm does not resolve on .card h2 (got ${JSON.stringify(seen.resolves)})`);

    const mapWorks = Boolean(seen.viaMap && seen.viaMap.has);
    const computedWorks = Boolean(seen.viaComputed && seen.viaComputed.has);
    if (!mapWorks && !computedWorks) {
      fail(
        "neither computedStyleMap() nor getComputedStyle() enumerated --title-sm — " +
        `map=${JSON.stringify(seen.viaMap)} computed=${JSON.stringify(seen.viaComputed)}`
      );
    }
    console.log(
      `      enumeration: computedStyleMap ${mapWorks ? "yes" : "no"}` +
      ` (${seen.viaMap ? seen.viaMap.custom : "n/a"} custom),` +
      ` getComputedStyle ${computedWorks ? "yes" : "no"} (${seen.viaComputed.custom} custom)`
    );
  });

  // ===== The palette says what it is offering =====
  // Sixteen 14px squares of colour and nothing else: the row said neither what
  // it was nor which token any square stood for. The name was on the title
  // attribute, but a native tooltip takes about a second and the target is
  // smaller than the cursor, so it was a name most people never saw.

  await check("the palette names the swatch under the pointer", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      window.__t.swatch("background-color");

      const cap = document.querySelector("#pnt-color-picker .pnt-edit-palcap");
      if (!cap) return { missing: true };
      const read = () => ({
        name: cap.querySelector("b").textContent,
        value: cap.querySelector("span").textContent,
      });
      const pals = [...document.querySelectorAll("#pnt-color-picker .pnt-edit-pal")];
      const terra = pals.find((p) => p.title.startsWith("--terra "));

      const idle = read();
      const height = cap.getBoundingClientRect().height;
      terra.dispatchEvent(new PointerEvent("pointerenter"));
      const hovered = read();
      const hoveredHeight = cap.getBoundingClientRect().height;
      terra.dispatchEvent(new PointerEvent("pointerleave"));
      const afterLeave = read();
      // Keyboard reaches these too.
      terra.dispatchEvent(new FocusEvent("focus"));
      const focused = read();
      return { idle, hovered, afterLeave, focused, height, hoveredHeight, title: terra.title };
    `);

    if (seen.missing) return fail("the palette has no caption");
    if (!seen.idle.value) fail("the caption is blank when nothing is hovered — the row is unlabelled again");
    if (seen.idle.name) fail(`the idle caption claims a token name: ${JSON.stringify(seen.idle)}`);

    if (seen.hovered.name !== "--terra") fail(`hovering gave name ${JSON.stringify(seen.hovered.name)}`);
    if (seen.hovered.value.toLowerCase() !== "#a94f30") {
      fail(`hovering gave value ${JSON.stringify(seen.hovered.value)}`);
    }
    // A caption that appears on hover would resize the picker as the pointer
    // approaches, moving the swatch out from under it.
    if (seen.height !== seen.hoveredHeight) {
      fail(`the caption changed height on hover (${seen.height} → ${seen.hoveredHeight})`);
    }
    if (seen.afterLeave.name !== "" || !seen.afterLeave.value) {
      fail(`leaving did not restore the caption: ${JSON.stringify(seen.afterLeave)}`);
    }
    if (seen.focused.name !== "--terra") fail("focusing a swatch did not name it");
    // The tooltip stays as the accessible fallback.
    if (!seen.title.includes("--terra")) fail(`the title attribute lost the name: ${seen.title}`);
    await evaluate(ws, "window.__t.esc(); return true;");
  });

  // ===== Text colour, and where typography is allowed to appear =====
  // The text guard used to sit on the typography group, so an element holding no
  // text of its own got none of its controls. That is right for size and leading
  // and wrong for colour: colour inherits, and a wrapper is exactly where an
  // inherited colour gets set. The guard now sits on the five metric controls,
  // and colour carries none.

  await check("colour joins typography, and reaches wrappers", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      const rowsFor = (sel, dx, dy) => {
        window.__t.select(sel, dx, dy);
        window.__t.edit();
        const out = [...document.querySelectorAll("#pnt-edit-panel .pnt-edit-row")]
          .map((r) => r.dataset.control);
        window.__t.esc();   // out of Edit Mode
        window.__t.esc();   // and drop the selection
        return out;
      };
      // .card holds only element children, so it is the text-less case. If the
      // click ever lands on a child instead, font-size reappears below and this
      // case fails rather than quietly testing the wrong element.
      return {
        withText: rowsFor(".card h2", 5, 5),
        wrapper: rowsFor(".card", 3, 3),
        // No text anywhere beneath — the arrangement where even colour is noise.
        blank: rowsFor(".glyph-block", 4, 4),
      };
    `);

    if (!seen.withText.includes("color")) fail("no colour row on an element with text");
    if (!seen.withText.includes("text")) fail("no text row on an element with its own words");
    if (seen.wrapper.includes("text")) {
      fail("a text field leaked onto a wrapper whose words belong to descendants");
    }
    if (seen.blank.includes("color")) fail("colour offered on an element with no text beneath");
    if (seen.blank.includes("text")) fail("text field offered on an element with no text at all");
    if (!seen.withText.includes("font-size")) fail("fixture changed: h2 lost its size row");
    // Panel order has to match EDIT_PROP_ORDER, where color follows text-align.
    if (seen.withText.indexOf("color") < seen.withText.indexOf("text-align")) {
      fail(`colour sorts before align: ${JSON.stringify(seen.withText)}`);
    }

    if (!seen.wrapper.includes("color")) fail("no colour row on a text-less wrapper");
    for (const metric of ["font-size", "font-weight", "line-height", "letter-spacing", "text-align"]) {
      if (seen.wrapper.includes(metric)) {
        fail(`${metric} leaked onto a text-less wrapper: ${JSON.stringify(seen.wrapper)}`);
      }
    }
  });

  // ===== The text field edits the words, and puts them back exactly =====
  // The third kind of host-page write. What matters end to end: keystrokes
  // land on the element live, the row carries a dirty dot, the delta reports
  // the change in quotes, and the reset dot restores the original bytes.

  await check("the text field edits the words and puts them back", async (fail) => {
    await loadHarness(ws);
    const r = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2", 5, 5);
      window.__t.edit();
      const el = document.querySelector(".card h2");
      const original = el.textContent;
      const input = window.__t.row("text").querySelector(".pnt-edit-textin");
      const shown = input.value;
      input.focus();
      input.value = "Renamed by the probe";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const after = el.textContent;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const dirty = window.__t.row("text").classList.contains("pnt-edit-dirty");
      const block = await window.__t.copy();
      window.__t.row("text").querySelector(".pnt-edit-label").click();
      const restored = el.textContent;
      window.__t.esc();
      window.__t.esc();
      return { original, shown, after, dirty, block, restored };
    `);
    if (r.shown !== "emil-design-eng") fail(`field shows ${JSON.stringify(r.shown)}, not the element's words`);
    if (r.after !== "Renamed by the probe") fail(`typing did not land: ${JSON.stringify(r.after)}`);
    if (!r.dirty) fail("no edited mark on an edited text cell");
    if (!r.block.includes('# text: "emil-design-eng" → "Renamed by the probe"')) {
      fail(`delta line missing: ${JSON.stringify(r.block.slice(0, 260))}`);
    }
    if (r.restored !== r.original) fail("the reset dot did not put the exact words back");
  });

  // ===== Composite type styles =====
  // The style row is the composite's seat: it claims what is in force, steps
  // the whole source as one action, and conforms drift whoever shipped it.

  await check("a type style claims, steps as one action, and undoes", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".ts-on");
      window.__t.edit();
      const chipName = () => {
        const n = document.querySelector("#pnt-edit-panel .pnt-type-name");
        return n ? n.textContent : null;
      };
      const claimed = chipName();
      // ‹ steps down the ladder: type-lg → type-sm.
      document.querySelector("#pnt-edit-panel .pnt-type-st").click();
      const el = document.querySelector(".ts-on");
      const afterStep = {
        cls: el.getAttribute("class"),
        size: window.__t.css(".ts-on", "font-size"),
        lead: window.__t.css(".ts-on", "line-height"),
        name: chipName(),
      };
      const block = await window.__t.copy();
      window.__t.undo();
      const undone = { cls: el.getAttribute("class"), size: window.__t.css(".ts-on", "font-size") };
      window.__t.esc();
      window.__t.esc();
      return { claimed, afterStep, block, undone };
    `);
    if (seen.claimed !== "type-lg") fail(`claimed ${JSON.stringify(seen.claimed)}, not type-lg`);
    if (!seen.afterStep.cls.includes("type-sm") || seen.afterStep.cls.includes("type-lg")) {
      fail(`step did not swap the class: ${JSON.stringify(seen.afterStep.cls)}`);
    }
    if (seen.afterStep.size !== "14px" || seen.afterStep.lead !== "20px") {
      fail(`one step moved to ${seen.afterStep.size}/${seen.afterStep.lead}, not 14px/20px — the composite did not move together`);
    }
    if (seen.afterStep.name !== "type-sm") fail(`chip reads ${seen.afterStep.name} after the step`);
    if (!seen.block.includes("# type style: type-lg → type-sm (size 18→14, leading 28→20)")) {
      fail(`delta line missing: ${JSON.stringify(seen.block.slice(0, 300))}`);
    }
    if (!seen.undone.cls.includes("type-lg") || seen.undone.size !== "18px") {
      fail(`one undo did not give the whole step back: ${JSON.stringify(seen.undone)}`);
    }
  });

  await check("drift reads modified and the chip conforms", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".ts-drift");
      window.__t.edit();
      const chip = () => document.querySelector("#pnt-edit-panel .pnt-type-chip");
      const wasDrifted = chip().classList.contains("pnt-type-drifted");
      chip().click();
      const lead = window.__t.css(".ts-drift", "line-height");
      const block = await window.__t.copy();
      const stillDrifted = chip().classList.contains("pnt-type-drifted");
      window.__t.esc();
      window.__t.esc();
      return { wasDrifted, lead, block, stillDrifted };
    `);
    if (!seen.wasDrifted) fail("page-shipped drift did not read as modified");
    if (seen.lead !== "28px") fail(`conform left leading at ${seen.lead}`);
    if (seen.stillDrifted) fail("the chip still reads modified after conforming");
    if (!seen.block.includes("# type style: type-lg (modified) → type-lg (leading 32→28)")) {
      fail(`conform delta missing: ${JSON.stringify(seen.block.slice(0, 300))}`);
    }
  });

  await check("a var stem claims solo — named, unsteppable", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".stem-title");
      window.__t.edit();
      const name = document.querySelector("#pnt-edit-panel .pnt-type-name");
      const arrows = document.querySelectorAll("#pnt-edit-panel .pnt-type-st").length;
      window.__t.esc();
      window.__t.esc();
      return { name: name ? name.textContent : null, arrows };
    `);
    if (seen.name !== "--h-md") fail(`stem claimed as ${JSON.stringify(seen.name)}`);
    if (seen.arrows !== 0) fail(`a solo style grew ${seen.arrows} stepper arrows`);
  });

  // ===== The copy payload, against a real element =====
  // test/copy-format.mjs sweeps the pure half — the order, the gating, the
  // fence, the fallback truth table. Everything below is the half that needs a
  // page: the four HTML blocks are built by walking a real subtree, and the
  // three diagnosis fields exist only because a browser computed something.

  await check("copy · the defaults are what shipped before the setting existed", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      const payload = await window.__t.copyCode();
      return { payload, keys: window.__t.keys(payload), block: window.__t.block(payload) };
    `);
    if (!seen.payload) return fail("nothing reached the clipboard");
    if (!seen.payload.startsWith("```\n")) fail("payload is not fenced by default");
    if (!seen.payload.endsWith("\n```")) fail("payload's closing fence is missing");
    for (const key of ["page", "anchor", "selector", "position", "text"]) {
      if (!seen.keys.includes(key)) fail(`default payload is missing ${key}`);
    }
    for (const key of ["layout", "styles", "props"]) {
      if (seen.keys.includes(key)) fail(`${key} rode along without being asked for`);
    }
    // The harness has no source tooling and no framework, so nothing points at
    // the source: the default fallback is the whole reason a subtree is here.
    if (!seen.block.includes("<h2")) fail(`no subtree on an unlocated element: ${seen.block}`);
  });

  await check("copy · a field switched off leaves, and takes nothing with it", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      const before = window.__t.keys(await window.__t.copyCode());
      window.__t.prefs({ copySelector: "off", copyText: "off" });
      const after = window.__t.keys(await window.__t.copyCode());
      return { before, after };
    `);
    if (!seen.before.includes("selector")) return fail("fixture: no selector field to switch off");
    if (seen.after.includes("selector")) fail("selector survived being switched off");
    if (seen.after.includes("text")) fail("text survived being switched off");
    const want = seen.before.filter((k) => k !== "selector" && k !== "text");
    if (seen.after.join(",") !== want.join(",")) {
      fail(`the rest moved: ${seen.after.join(",")} vs ${want.join(",")}`);
    }
  });

  await check("copy · the four HTML blocks are four different sizes", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      const out = {};
      // The fallback would overrule every choice on this unlocated element,
      // which is exactly what the previous case proved. Off, so the choice is
      // the thing under test.
      window.__t.prefs({ copyHtmlFallback: "off" });
      for (const trim of ["root", "shape", "full", "none"]) {
        window.__t.prefs({ copyHtml: trim });
        out[trim] = window.__t.block(await window.__t.copyCode());
      }
      return out;
    `);
    if (seen.none !== "") fail(`"none" still emitted a block: ${seen.none}`);
    if (!/^<(\w+)[^>]*> … \d+ children <\/\1>$/.test(seen.root)) {
      fail(`"root" is not the one-line root tag: ${seen.root}`);
    }
    // Shape names each child on its own line — tag, classes, then the text in
    // quotes — without reproducing any of it as markup.
    const shapeLines = seen.shape.split("\n");
    if (shapeLines.length < 3) fail(`"shape" collapsed to ${shapeLines.length} lines`);
    if (!/^\s+[a-z]+(\.[\w-]+)* "/m.test(seen.shape)) {
      fail(`"shape" did not name a child and its text: ${seen.shape}`);
    }
    if (/^\s+</m.test(seen.shape)) fail(`"shape" reproduced a child as markup: ${seen.shape}`);
    // Full does reproduce them, so it is the longest of the four.
    if (!/<h2[^>]*>/.test(seen.full)) fail(`"full" did not reproduce the child: ${seen.full}`);
    if (seen.full.length <= seen.shape.length) fail("full is no longer than shape");
    if (seen.shape.length <= seen.root.length) fail("shape is no longer than root");
  });

  await check("copy · depth only bites on the full subtree", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      window.__t.prefs({ copyHtmlFallback: "off", copyHtml: "full" });
      const out = {};
      for (const depth of ["3", "2", "1"]) {
        window.__t.prefs({ copyDepth: depth });
        out[depth] = window.__t.block(await window.__t.copyCode());
      }
      return out;
    `);
    if (seen["1"].length >= seen["3"].length) fail("depth 1 is not shorter than depth 3");
    // At depth 1 every child is summarised rather than opened: "…" when it has
    // nothing inside, a child count when it does. Asserted per line rather than
    // on the whole block, because a long text node is truncated with the same
    // ellipsis at every depth and would otherwise pass for an elided subtree.
    const kids = seen["1"].split("\n").slice(1, -1);
    if (kids.length === 0) return fail(`depth 1 produced no child lines: ${seen["1"]}`);
    for (const line of kids) {
      if (!/…<\/|<!-- \d+ children -->/.test(line)) fail(`depth 1 opened a child: ${line}`);
    }
  });

  await check("copy · the fence can be dropped, and the HTML keeps a block", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      window.__t.prefs({ copyFence: "off" });
      const withHtml = await window.__t.copyCode();
      window.__t.prefs({ copyHtml: "none", copyHtmlFallback: "off" });
      const bare = await window.__t.copyCode();
      return { withHtml, bare };
    `);
    if (seen.withHtml.startsWith("```\n")) fail("the outer fence survived being switched off");
    if (!seen.withHtml.includes("\n\n```html\n")) {
      fail("unfenced, the HTML did not take a block of its own");
    }
    if (seen.bare.includes("```")) fail(`nothing to delimit, yet a fence appeared: ${seen.bare}`);
    if (!seen.bare.startsWith("# ")) fail("the bare payload does not start with the header");
  });

  await check("copy · configuring the payload down to nothing says so", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      const off = {};
      for (const key of ["copySource", "copyComponent", "copyPage", "copyAnchor",
                         "copyHandlers", "copySelector", "copyPosition", "copyRepeated",
                         "copyText", "copyLayout", "copyStyles", "copyProps"]) off[key] = "off";
      window.__t.prefs({ ...off, copyHtml: "none", copyHtmlFallback: "off" });
      const payload = await window.__t.copyCode();
      const toast = document.querySelector("#pnt-toast, .pnt-toast");
      return { payload, toast: toast ? toast.textContent : null };
    `);
    if (seen.payload !== null) fail(`wrote ${JSON.stringify(seen.payload)} to the clipboard`);
    if (!seen.toast || !/Copying/.test(seen.toast)) {
      fail(`the button did nothing and said nothing: ${JSON.stringify(seen.toast)}`);
    }
  });

  await check("copy · layout diagnosis reports the box the browser made", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      window.__t.prefs({ copyLayout: "on" });
      const payload = await window.__t.copyCode();
      const line = payload.split("\\n").find((l) => l.startsWith("# layout: ")) || "";
      const rect = document.querySelector(".card").getBoundingClientRect();
      return { line, w: Math.round(rect.width), h: Math.round(rect.height) };
    `);
    if (!seen.line) return fail("no layout line after switching it on");
    if (!seen.line.includes(`box ${seen.w}x${seen.h}`)) {
      fail(`layout disagrees with the real box ${seen.w}x${seen.h}: ${seen.line}`);
    }
    if (!/display \w/.test(seen.line)) fail(`no display in the layout line: ${seen.line}`);
  });

  await check("copy · matched CSS names the rule and where it came from", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      window.__t.prefs({ copyStyles: "on" });
      const payload = await window.__t.copyCode();
      return payload.split("\\n").filter((l, i, a) => {
        const start = a.findIndex((x) => x.startsWith("# styles: "));
        return start >= 0 && i >= start && (i === start || l.startsWith("#   "));
      });
    `);
    if (seen.length === 0) return fail("no styles field after switching it on");
    const body = seen.join(" ");
    if (!body.includes("{")) fail(`no declarations in the styles field: ${body}`);
    if (!/\.card/.test(body)) fail(`the element's own rule is missing: ${body}`);
    // Our own stylesheets ride along on every page; they are never the page's.
    if (/pnt-/.test(body)) fail(`our own chrome leaked into the styles field: ${body}`);
  });

  await check("copy · a page with no framework offers no props", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card");
      window.__t.prefs({ copyProps: "on" });
      const payload = await window.__t.copyCode();
      return { keys: window.__t.keys(payload), payload };
    `);
    // The harness is plain HTML: there is nothing to snapshot, and inventing a
    // field rather than omitting it is the failure mode that matters here.
    if (seen.keys.includes("props")) fail(`props emitted with no framework on the page: ${seen.payload}`);
  });

  await check("copy · the edit panel copies in the same dialect", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.copyDefaults();
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      window.__t.step("font-size", 1);
      const fenced = await window.__t.copy();
      window.__t.prefs({ copyFence: "off", copySelector: "off" });
      const bare = await window.__t.copy();
      return { fenced, bare, keys: window.__t.keys(bare) };
    `);
    if (!seen.fenced.startsWith("```\n")) fail("the delta block lost its fence");
    if (!seen.fenced.includes("# edits:")) fail("the delta block lost its edits");
    if (seen.bare.startsWith("```")) fail("the delta block ignored the fence setting");
    if (!seen.bare.includes("# edits:")) fail("switching a field off dropped the edits too");
    if (seen.keys.includes("selector")) fail("the delta block ignored the field setting");
  });

  // ===== Inspector (3.0) =====
  // The card beside the element, the pill under the card, and the two levels:
  // the hover readout and the selected picture. Geometry beyond "beside, and
  // the pill under it" is the placement spec's business.

  await check("inspector · beside the element, the pill under it", async (fail) => {
    await loadHarness(ws);
    const seen = await evaluate(ws, `
      window.__t.probeOn();
      const el = window.__t.select(".card h2");
      await new Promise((r) => setTimeout(r, 60));
      const label = document.getElementById("pnt-label");
      const tb = document.getElementById("pnt-toolbar");
      const e = el.getBoundingClientRect(), l = label.getBoundingClientRect(), t = tb.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      return {
        own: tb.parentElement === document.documentElement,
        actions: [...tb.querySelectorAll("button")].map((b) => b.dataset.action).join(),
        roomRight: e.right + 6 + l.width <= vw - 4,
        right: Math.round(l.left - e.right), sameLeft: Math.round(t.left - l.left), under: Math.round(t.top - l.bottom),
        live: label.classList.contains("pnt-insp-live"),
        picture: !!label.querySelector(".pnt-insp-pic .pnt-insp-cbox"),
        modes: label.querySelectorAll(".pnt-insp-mode button").length,
        width: Math.round(l.width),
      };
    `);
    if (!seen.own) fail("the pill is not its own root");
    if (seen.actions !== "copy,shot,edit,parent") fail(`actions are ${seen.actions}`);
    if (seen.roomRight && seen.right !== 6) fail(`the card sits ${seen.right}px from the element's right edge`);
    if (seen.sameLeft !== 0) fail(`the pill is ${seen.sameLeft}px off the card's left`);
    if (seen.under !== 6) fail(`the pill is ${seen.under}px under the card`);
    if (!seen.live) fail("the selected card does not take the pointer");
    if (!seen.picture) fail("no picture of the element");
    if (seen.modes !== 2) fail(`${seen.modes} mode buttons`);
    if (seen.width > 420) fail(`the card is ${seen.width}px wide`);
  });

  await check("inspector · Map and Layers, remembered", async (fail) => {
    const seen = await evaluate(ws, `
      const label = document.getElementById("pnt-label");
      label.querySelector('.pnt-insp-mode button[aria-label="Layers"]').click();
      await new Promise((r) => setTimeout(r, 60));
      const layers = { planes: label.querySelectorAll(".pnt-insp-plane").length, rows: label.querySelectorAll(".pnt-insp-lyl").length };
      window.__t.esc();
      window.__t.select(".card h2");
      await new Promise((r) => setTimeout(r, 60));
      const kept = !!label.querySelector(".pnt-insp-stack");
      label.querySelector('.pnt-insp-mode button[aria-label="Map"]').click();
      await new Promise((r) => setTimeout(r, 60));
      return { ...layers, kept, back: !!label.querySelector(".pnt-insp-map") };
    `);
    if (!seen.planes || seen.planes !== seen.rows) fail(`${seen.planes} planes against ${seen.rows} labels`);
    if (!seen.kept) fail("a new selection forgot Layers");
    if (!seen.back) fail("Map did not come back");
  });

  await check("inspector · a lifted layer stays under the pointer", async (fail) => {
    const seen = await evaluate(ws, `
      const label = document.getElementById("pnt-label");
      label.querySelector('.pnt-insp-mode button[aria-label="Layers"]').click();
      await new Promise((r) => setTimeout(r, 260)); // the picture's own entrance first
      const bands = [...label.querySelectorAll(".pnt-insp-band")];
      const out = { bands: bands.length, planes: label.querySelectorAll(".pnt-insp-plane").length, steady: 0, lifted: 0, planeHit: 0 };
      for (const band of bands) {
        const before = band.getBoundingClientRect();
        const x = before.left + before.width / 2, y = before.top + before.height / 2;
        band.dispatchEvent(new PointerEvent("pointerenter"));
        await new Promise((r) => setTimeout(r, 260)); // past the lift transition
        const after = band.getBoundingClientRect();
        const hit = document.elementFromPoint(x, y);
        if (hit === band && after.top === before.top && after.height === before.height) out.steady++;
        else out.why = [hit && (hit.className || hit.tagName), before.top, after.top, before.height, after.height, x, y];
        if (hit && hit.closest(".pnt-insp-plane")) out.planeHit++;
        if (label.querySelector(".pnt-insp-plane.pnt-on")) out.lifted++;
        band.dispatchEvent(new PointerEvent("pointerleave"));
      }
      label.querySelector('.pnt-insp-mode button[aria-label="Map"]').click();
      await new Promise((r) => setTimeout(r, 60));
      return out;
    `);
    if (!seen.bands || seen.bands !== seen.planes) fail(`${seen.bands} bands for ${seen.planes} planes`);
    if (seen.lifted !== seen.bands) fail(`only ${seen.lifted} of ${seen.bands} bands lifted a plane`);
    if (seen.steady !== seen.bands) fail(`only ${seen.steady} of ${seen.bands} bands kept the pointer once lifted (${JSON.stringify(seen.why)})`);
    if (seen.planeHit) fail(`${seen.planeHit} lifted planes took the pointer`);
  });

  await check("inspector · the sheet: a short name, a row per fact, colours in rows of six", async (fail) => {
    const seen = await evaluate(ws, `
      const many = document.createElement("div");
      many.id = "many-fixture";
      many.className = "a-very-long-generated-class-name css-9f3k2a Module_root__x7Qd1";
      many.style.cssText = "width:300px;padding:8px;background:#fafafa;display:flex;flex-wrap:wrap;gap:4px";
      for (let i = 0; i < 14; i++) { const s = document.createElement("i"); s.style.cssText = "width:16px;height:16px;background:rgb(" + (i * 17) + ",80,160)"; many.appendChild(s); }
      document.body.prepend(many);
      window.scrollTo(0, 0);
      window.__t.esc();
      window.__t.select("#many-fixture");
      await new Promise((r) => setTimeout(r, 80));
      const label = document.getElementById("pnt-label");
      const who = label.querySelector(".pnt-insp-who");
      const cells = [...label.querySelectorAll(".pnt-insp-cell")];
      const tops = new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)));
      const perRow = cells.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.round(cells[0].getBoundingClientRect().top)).length;
      const out = {
        whoW: Math.round(who.getBoundingClientRect().width), clipped: (() => { const c = who.querySelector(".pnt-label-class"); return c.scrollWidth > c.clientWidth; })(), title: who.title,
        rows: [...label.querySelectorAll(".pnt-insp-dr > .pnt-insp-k")].map((k) => k.textContent).join(),
        icons: label.querySelectorAll(".pnt-insp-dr .pnt-insp-ki svg").length,
        cells: cells.length, gridRows: tops.size, perRow,
        width: Math.round(label.getBoundingClientRect().width),
        paneLeft: label.querySelector(".pnt-insp-pane").getBoundingClientRect().left < label.querySelector(".pnt-insp-sheet").getBoundingClientRect().left,
      };
      label.querySelector('.pnt-insp-mode button[aria-label="Layers"]').click();
      await new Promise((r) => setTimeout(r, 80));
      const sws = [...label.querySelectorAll(".pnt-insp-lyl .pnt-insp-swb")];
      const firstTop = Math.round(sws[0].getBoundingClientRect().top);
      out.layerPerRow = sws.filter((b) => Math.round(b.getBoundingClientRect().top) === firstTop).length;
      const w0 = label.getBoundingClientRect().width;
      sws[0].dispatchEvent(new PointerEvent("pointerenter"));
      out.read = label.querySelector(".pnt-insp-lsheet .pnt-insp-sect").textContent;
      out.steady = label.getBoundingClientRect().width === w0;
      sws[0].dispatchEvent(new PointerEvent("pointerleave"));
      label.querySelector('.pnt-insp-mode button[aria-label="Map"]').click();
      window.__t.esc();
      many.remove();
      window.__t.select(".card h2");
      await new Promise((r) => setTimeout(r, 60));
      return out;
    `);
    if (seen.whoW > 150) fail(`the name is ${seen.whoW}px wide`);
    if (!seen.clipped) fail("a long name was not ellipsized");
    if (!seen.title.includes("Module_root__x7Qd1")) fail(`the full name is not in the title: ${seen.title}`);
    if (seen.rows !== "Size,Radius,Opacity,Colour") fail(`rows are ${seen.rows}`);
    if (seen.icons !== 4) fail(`${seen.icons} row icons`);
    if (seen.cells !== 15) fail(`${seen.cells} colours in the grid`);
    if (seen.perRow !== 6 || seen.gridRows !== 3) fail(`the grid is ${seen.perRow} across in ${seen.gridRows} rows`);
    if (seen.width > 420) fail(`the card is ${seen.width}px wide`);
    if (!seen.paneLeft) fail("the pane is not left of the sheet");
    if (seen.layerPerRow !== 6) fail(`a layer row holds ${seen.layerPerRow} swatches across`);
    if (!/^#[0-9A-F]{6}/.test(seen.read)) fail(`hovering a layer swatch reads ${JSON.stringify(seen.read)}`);
    if (!seen.steady) fail("the readout changed the card's width");
  });

  await check("inspector · Layers keeps white text readable, three ways", async (fail) => {
    const seen = await evaluate(ws, `
      const btn = document.createElement("div");
      btn.id = "aid-fixture";
      btn.style.cssText = "width:160px;padding:12px;background:#e11d48;color:#fff;font:600 14px sans-serif;border-radius:8px";
      btn.textContent = "Follow";
      document.body.prepend(btn);
      window.scrollTo(0, 0);
      const out = {};
      for (const mode of ["ghost", "plate", "halo"]) {
        window.__t.prefs({ inspectorLayerAid: mode });
        window.__t.esc();
        window.__t.select("#aid-fixture");
        await new Promise((r) => setTimeout(r, 60));
        const label = document.getElementById("pnt-label");
        const layers = label.querySelector('.pnt-insp-mode button[aria-label="Layers"]');
        if (layers.getAttribute("aria-pressed") !== "true") layers.click();
        await new Promise((r) => setTimeout(r, 120));
        const planes = [...label.querySelectorAll(".pnt-insp-plane")];
        const text = planes[planes.length - 1], fill = planes[0];
        out[mode] = {
          planes: planes.length,
          ghostOnText: text.querySelectorAll(".pnt-insp-ghost").length, ghostOnFill: fill.querySelectorAll(".pnt-insp-ghost").length,
          plated: text.classList.contains("pnt-insp-plated"), plate: text.querySelector(".pnt-insp-glass").style.background,
          fillPlated: fill.classList.contains("pnt-insp-plated"),
          halo: [...text.querySelectorAll("[style*='text-shadow']")].filter((n) => getComputedStyle(n).textShadow !== "none").length,
          leaks: [...label.querySelectorAll(".pnt-insp-plane *")].filter((n) => getComputedStyle(n).pointerEvents !== "none").length,
        };
      }
      window.__t.prefs({ inspectorLayerAid: "ghost" });
      document.getElementById("pnt-label").querySelector('.pnt-insp-mode button[aria-label="Map"]').click();
      window.__t.esc();
      btn.remove();
      window.__t.select(".card h2");
      await new Promise((r) => setTimeout(r, 60));
      return out;
    `);
    for (const mode of ["ghost", "plate", "halo"]) {
      if (seen[mode].planes !== 2) fail(`${mode}: ${seen[mode].planes} planes`);
      if (seen[mode].leaks) fail(`${mode}: ${seen[mode].leaks} nodes on the planes take the pointer`);
    }
    if (seen.ghost.ghostOnText !== 1 || seen.ghost.ghostOnFill) fail(`ghost: ${seen.ghost.ghostOnText} under the text, ${seen.ghost.ghostOnFill} under the fill`);
    if (seen.ghost.plated || seen.ghost.halo) fail("ghost also plated or haloed");
    if (!seen.plate.plated || !/rgb/.test(seen.plate.plate)) fail(`plate: the text plane has no plate (${seen.plate.plate})`);
    if (seen.plate.fillPlated) fail("plate: the fill plane, readable as it is, was plated");
    if (seen.plate.ghostOnText) fail("plate also drew a ghost");
    if (!seen.halo.halo) fail("halo: the white text has no halo");
    if (seen.halo.plated || seen.halo.ghostOnText) fail("halo also plated or ghosted");
  });

  await check("inspector · a colour finds its parts and copies", async (fail) => {
    const seen = await evaluate(ws, `
      const label = document.getElementById("pnt-label");
      const chip = label.querySelector(".pnt-insp-chip, .pnt-insp-cell");
      if (!chip) return { none: true };
      chip.dispatchEvent(new PointerEvent("pointerenter"));
      const lit = document.querySelectorAll("#pnt-overlay-container .pnt-insp-hl").length;
      chip.dispatchEvent(new PointerEvent("pointerleave"));
      const cleared = document.querySelectorAll("#pnt-overlay-container .pnt-insp-hl").length;
      let text = null;
      const real = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (t) => { text = t; return Promise.resolve(); };
      chip.click();
      await new Promise((r) => setTimeout(r, 30));
      navigator.clipboard.writeText = real;
      return { lit, cleared, text };
    `);
    if (seen.none) return fail("no colour to hover");
    if (!seen.lit) fail("hovering a colour lit nothing on the page");
    if (seen.cleared) fail("the highlight stayed after the pointer left");
    if (!/^#[0-9A-F]{6}([0-9A-F]{2})?$|\(/.test(seen.text || "")) fail(`copied ${JSON.stringify(seen.text)}`);
  });

  await check("inspector · hover is the readout, and the readout only", async (fail) => {
    const seen = await evaluate(ws, `
      window.__t.esc();
      await new Promise((r) => setTimeout(r, 30));
      const label = document.getElementById("pnt-label");
      return {
        live: label.classList.contains("pnt-insp-live"),
        picture: !!label.querySelector(".pnt-insp-pic"),
        readout: label.querySelectorAll(".pnt-insp-sheet .pnt-insp-dr").length,
        icons: label.querySelectorAll(".pnt-insp-dr .pnt-insp-ki svg").length,
        pane: !!label.querySelector(".pnt-insp-pane"),
        text: label.textContent,
      };
    `);
    if (seen.live) fail("the hover card takes the pointer");
    if (seen.picture) fail("the hover card still draws the picture");
    if (seen.readout < 4) fail(`the hover readout has ${seen.readout} rows`);
    if (seen.icons !== seen.readout) fail(`${seen.icons} row icons for ${seen.readout} rows`);
    if (seen.pane) fail("the hover card has the picture's pane");
    for (const word of ["child", "pos:", "display", "margin", "padding"]) {
      if (seen.text.includes(word)) fail(`the readout says ${word}`);
    }
  });

  await check("inspector · a tooltip names the icon and never moves the card", async (fail) => {
    const seen = await evaluate(ws, `
      window.__t.select(".card h2");
      await new Promise((r) => setTimeout(r, 60));
      const label = document.getElementById("pnt-label");
      const tip = document.getElementById("pnt-tip");
      const before = label.getBoundingClientRect();
      const btn = document.querySelector('#pnt-toolbar button[data-action="shot"]');
      btn.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      const after = label.getBoundingClientRect();
      const tr = tip.getBoundingClientRect(), br = btn.getBoundingClientRect();
      const shown = { on: tip.classList.contains("pnt-tip-on"), text: tip.textContent,
        inside: label.contains(tip), clear: tr.bottom <= br.top || tr.top >= br.bottom,
        moved: before.top !== after.top || before.height !== after.height || before.width !== after.width };
      btn.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
      return { ...shown, hidden: !tip.classList.contains("pnt-tip-on") };
    `);
    if (!seen.on) fail("no tooltip on pointerover");
    if (seen.text !== "Screenshot") fail(`the tooltip says ${JSON.stringify(seen.text)}`);
    if (seen.inside) fail("the tooltip is inside the card");
    if (!seen.clear) fail("the tooltip covers the button it names");
    if (seen.moved) fail("showing the tooltip moved the card");
    if (!seen.hidden) fail("the tooltip stayed after pointerout");
  });

  await check("inspector · Select Parent keeps the pill and rewrites the card", async (fail) => {
    const seen = await evaluate(ws, `
      const label = document.getElementById("pnt-label");
      const tb = document.getElementById("pnt-toolbar");
      const tag = () => label.querySelector(".pnt-label-head .pnt-label-tag").textContent;
      const was = tag();
      tb.querySelector('button[data-action="parent"]').click();
      await new Promise((r) => setTimeout(r, 60));
      return { was, now: tag(), sameNode: document.getElementById("pnt-toolbar") === tb };
    `);
    if (seen.was === seen.now) fail(`the identity still reads ${seen.now}`);
    if (!seen.sameNode) fail("the hop rebuilt the toolbar");
  });

  await check("placement · a tall selection keeps the pill on screen", async (fail) => {
    const seen = await evaluate(ws, `
      window.__t.esc();
      const tall = document.createElement("div");
      tall.id = "tall-fixture";
      tall.style.cssText = "height:300vh;width:240px;margin:24px;background:#eee";
      document.body.prepend(tall);
      window.scrollTo(0, 0);
      const r = tall.getBoundingClientRect();
      tall.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
      await new Promise((r) => setTimeout(r, 80));
      const tb = document.getElementById("pnt-toolbar");
      const b = tb.getBoundingClientRect();
      const vh = document.documentElement.clientHeight;
      const out = { edge: tall.getBoundingClientRect().bottom, vh, top: b.top, bottom: b.bottom,
        onScreen: b.top >= 0 && b.bottom <= vh, selected: document.querySelector(".pnt-selected") !== null };
      window.__t.esc();
      tall.remove();
      return out;
    `);
    if (!seen.selected) fail("the tall element was not selected");
    if (seen.edge <= seen.vh) fail(`the fixture's edge is on screen at ${seen.edge} of ${seen.vh}`);
    if (!seen.onScreen) fail(`the pill sits at ${seen.top}–${seen.bottom} in a ${seen.vh}px viewport`);
  });

  // ===== Screenshot =====
  // Until now the harness loaded content.js without its screenshot library,
  // so the one action that hands a page's computed colours to a CSS parser
  // was the one action the suite never ran. html2canvas 1.4.1 threw on every
  // colour function newer than hsl() — and Chrome reports computed colours in
  // the space they were written in — so a page styled in oklch() failed for
  // every element on it, and a long page at a Retina scale failed on
  // Chromium's canvas cap. Both go through the real button: the toast and the
  // clipboard are what is measured.
  const SHOOT = `
    const btn = document.querySelector('#pnt-toolbar button[data-action="shot"]');
    if (!btn) return { toast: "no toolbar" };
    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    btn.disabled = false;
    const stale = document.getElementById("pnt-toast");
    if (stale) stale.textContent = "";
    let blob = null;
    const real = navigator.clipboard.write;
    navigator.clipboard.write = async (items) => { blob = await items[0].getType("image/png"); };
    const toast = () => { const t = document.getElementById("pnt-toast"); return t ? t.textContent.trim() : ""; };
    btn.click();
    const t0 = Date.now();
    while (!blob && !toast().startsWith("Failed") && Date.now() - t0 < 15000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    navigator.clipboard.write = real;
    const bmp = blob ? await createImageBitmap(blob) : null;
    const shot = { toast: toast(), bytes: blob ? blob.size : 0, w: bmp ? bmp.width : 0, h: bmp ? bmp.height : 0 };
  `;

  await check("screenshot · an element coloured in oklch() copies a PNG", async (fail) => {
    const r = await evaluate(ws, `
      const el = window.__t.select('[style*="brand-500"]');
      await new Promise((r) => setTimeout(r, 80));
      const color = getComputedStyle(el).color;
      ${SHOOT}
      window.__t.esc();
      return { ...shot, color };
    `);
    if (!/^(oklch|oklab|lab|lch|color)\(/.test(r.color)) fail(`the fixture's colour is ${r.color}; the case proves nothing`);
    if (r.toast.startsWith("Failed")) fail(r.toast);
    else if (!r.bytes || !r.h) fail(`no PNG reached the clipboard (${r.bytes} bytes)`);
  });

  await check("screenshot · a 70000px element exports under Chromium's canvas cap", async (fail) => {
    const r = await evaluate(ws, `
      const tall = document.createElement("div");
      tall.id = "tall-shot";
      tall.style.cssText = "height:70000px;width:240px;margin:24px;background:#eee";
      document.body.prepend(tall);
      window.scrollTo(0, 0);
      const rect = tall.getBoundingClientRect();
      tall.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
      await new Promise((r) => setTimeout(r, 80));
      const selected = document.querySelector(".pnt-selected") !== null;
      ${SHOOT}
      window.__t.esc();
      tall.remove();
      return { ...shot, selected };
    `);
    if (!r.selected) fail("the tall element was not selected");
    if (r.toast.startsWith("Failed")) fail(r.toast);
    else if (!r.h) fail("no PNG came back");
    else if (r.h > 65535) fail(`the PNG is ${r.h}px tall`);
    else if (r.h < 60000) fail(`the PNG is only ${r.h}px tall — clamped further than the cap asks`);
  });

  // The button's three states, in order: the click flashes before any work,
  // the lens starts only once the capture has outlasted LOADING_DELAY, and the
  // check replaces it when the PNG lands. The capture is held open so the
  // middle state can be watched arriving rather than inferred.
  await check("screenshot · the click flashes, the lens waits 150 ms, the check follows", async (fail) => {
    const r = await evaluate(ws, `
      window.__t.select('[style*="brand-500"]');
      await new Promise((r) => setTimeout(r, 80));
      const btn = document.querySelector('#pnt-toolbar button[data-action="shot"]');
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
      btn.disabled = false;
      const realCapture = window.html2canvas;
      window.html2canvas = (node, opts) => realCapture(node, opts)
        .then((canvas) => new Promise((r) => setTimeout(() => r(canvas), 500)));
      let blob = null;
      const realWrite = navigator.clipboard.write;
      navigator.clipboard.write = async (items) => { blob = await items[0].getType("image/png"); };
      const state = () => ({
        flash: btn.classList.contains("pnt-flashing"),
        loading: btn.classList.contains("pnt-loading"),
        done: btn.classList.contains("pnt-done"),
        disabled: btn.disabled,
        label: (btn.querySelector("span") || {}).textContent,
      });
      btn.click();
      const at0 = state();
      await new Promise((r) => setTimeout(r, 60));
      const at60 = state();
      await new Promise((r) => setTimeout(r, 240));
      const at300 = state();
      const lens = btn.querySelector("svg circle");
      const lensAnim = lens ? getComputedStyle(lens).animationName : "no lens";
      const t0 = Date.now();
      while (!blob && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 40));
      const after = state();
      window.html2canvas = realCapture;
      navigator.clipboard.write = realWrite;
      window.__t.esc();
      return { at0, at60, at300, lensAnim, after, got: Boolean(blob) };
    `);
    if (!r.at0.flash) fail("the click did not flash");
    if (!r.at0.disabled) fail("the button stayed enabled during the capture");
    if (r.at60.loading) fail("the lens started before 150 ms");
    if (!r.at300.loading) fail("the lens had not started by 300 ms");
    if (r.at300.label !== "Copying…") fail(`the label read ${JSON.stringify(r.at300.label)} while loading`);
    if (r.lensAnim !== "pnt-shutter") fail(`the lens animates ${JSON.stringify(r.lensAnim)}`);
    if (!r.got) fail("no PNG reached the clipboard");
    if (!r.after.done || r.after.loading) fail(`after the capture: done=${r.after.done} loading=${r.after.loading}`);
  });

  // ===== Reduced motion =====
  // DESIGN.md calls the inventory the weakest link in the contract because
  // nothing checked it. This does: with the preference emulated, every rule
  // the block names has to compute to no animation — measured on the real
  // chrome, because a rule declared after the block at the same specificity
  // beats it on source order and nothing else would ever say so.
  await check("reduced motion · everything in the inventory holds still", async (fail) => {
    await send(ws, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const r = await evaluate(ws, `
      const anim = (el) => (el ? getComputedStyle(el).animationName : "missing");
      window.__t.select(".card h2");
      await new Promise((r) => setTimeout(r, 80));
      const out = { pref: matchMedia("(prefers-reduced-motion: reduce)").matches };
      out.ants = anim(document.querySelector("#pnt-overlay-container.pnt-selected #pnt-ants path"));
      // The marquee is built only for a breadcrumb that overflows; stand one up.
      const label = document.getElementById("pnt-label");
      const m = document.createElement("span");
      m.className = "pnt-label-marquee";
      m.innerHTML = '<span class="pnt-label-breadcrumb pnt-marquee-inner">x</span>';
      label.appendChild(m);
      out.marquee = anim(m.firstChild);
      m.remove();
      // The three toolbar states, forced by class.
      const btn = document.querySelector('#pnt-toolbar button[data-action="shot"]');
      btn.classList.add("pnt-loading", "pnt-flashing");
      const lens = btn.querySelector("svg circle");
      out.lens = anim(lens);
      out.lensFill = getComputedStyle(lens).fill;
      out.flash = anim(btn);
      btn.classList.remove("pnt-loading", "pnt-flashing");
      btn.classList.add("pnt-done");
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg><span>Copied!</span>';
      const pl = btn.querySelector("polyline");
      out.check = anim(pl);
      out.checkOffset = getComputedStyle(pl).strokeDashoffset;
      btn.classList.remove("pnt-done");
      btn.innerHTML = btn.dataset.origHtml;
      // The undo flash, in the overlay container where content.js puts it.
      const oc = document.getElementById("pnt-overlay-container");
      let f = document.getElementById("pnt-edit-flash");
      const made = !f;
      if (made) { f = document.createElement("div"); f.id = "pnt-edit-flash"; oc.appendChild(f); }
      f.classList.add("pnt-edit-flashing");
      out.undo = anim(f);
      out.undoOpacity = getComputedStyle(f).opacity;
      f.classList.remove("pnt-edit-flashing");
      if (made) f.remove();
      window.__t.esc();
      return out;
    `);
    await send(ws, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    if (!r.pref) fail("the emulated preference did not reach the page");
    const inventory = [["ants", r.ants], ["marquee", r.marquee], ["lens", r.lens],
      ["click flash", r.flash], ["check", r.check], ["undo flash", r.undo]];
    for (const [what, name] of inventory) {
      if (name !== "none") fail(`${what} still animates (${name})`);
    }
    if (r.checkOffset !== "0px") fail(`the check is not drawn: offset ${r.checkOffset}`);
    if (r.undoOpacity !== "1") fail(`the undo flash is not visible: opacity ${r.undoOpacity}`);
    if (!/^rgb/.test(r.lensFill)) fail(`the lens is not filled: ${r.lensFill}`);
  });
  // ===== The panel never scrolls sideways =====
  // Round four opened on a horizontal scrollbar under the rows. Two things
  // made it: the typography grid's colour cell kept the row control's fixed
  // 82px inside a 71px column, and a body that declares only overflow-y
  // computes overflow-x to auto, so eleven pixels of overflow grew a bar. The
  // cell is now as wide as its column and the body clips sideways. Held in
  // both themes, with the grid and every group on screen.
  await check("the panel body never scrolls sideways", async (fail) => {
    const r = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      const body = document.querySelector("#pnt-edit-panel .pnt-edit-body");
      const out = {};
      for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-pnt-theme", theme);
        out[theme] = {
          scrollWidth: body.scrollWidth,
          clientWidth: body.clientWidth,
          overflowX: getComputedStyle(body).overflowX,
          grid: Boolean(document.querySelector("#pnt-edit-panel .pnt-edit-c3")),
        };
      }
      window.__t.esc();
      return out;
    `);
    for (const theme of ["light", "dark"]) {
      const t = r[theme];
      if (!t.grid) { fail(`${theme}: no typography cells on the heading`); continue; }
      if (t.scrollWidth > t.clientWidth) {
        fail(`${theme}: the body is ${t.scrollWidth - t.clientWidth}px wider than it shows — a horizontal scrollbar`);
      }
      if (t.overflowX !== "hidden") fail(`${theme}: overflow-x is ${t.overflowX}, not hidden`);
    }
  });
  // ===== The rail =====
  // Round four's scrollbar: the native bar goes and rail.js draws the panel's
  // own, and the same script sets the classes the header and footer shadows
  // key off. The window is shrunk so the panel has to scroll; a check that
  // happened to run on a tall window would measure nothing.
  await check("the rail replaces the native bar and drives the shadows", async (fail) => {
    await send(ws, "Emulation.setDeviceMetricsOverride",
      { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false });
    let r;
    try {
      r = await evaluate(ws, `
        window.__t.probeOn();
        window.__t.select(".card h2");
        window.__t.edit();
        const panel = document.getElementById("pnt-edit-panel");
        const body = panel.querySelector(".pnt-edit-body");
        const rail = panel.querySelector(".pnt-rail");
        const out = {
          native: getComputedStyle(body).scrollbarWidth,
          rail: Boolean(rail),
          overflow: body.scrollHeight - body.clientHeight,
        };
        if (rail) {
          out.onAtOpen = rail.classList.contains("pnt-rail-on");
          // Somewhere inside the overflow, not past it: with the groups the
          // element lacks closed by default the panel is short, and 80px
          // could be the end.
          body.scrollTop = Math.max(1, Math.min(80, Math.floor(out.overflow / 2)));
          body.dispatchEvent(new Event("scroll"));
          out.above = panel.classList.contains("pnt-more-above");
          out.below = panel.classList.contains("pnt-more-below");
          out.thumb = rail.querySelector(".pnt-rail-thumb").style.transform;
          body.scrollTop = body.scrollHeight;
          body.dispatchEvent(new Event("scroll"));
          out.belowAtEnd = panel.classList.contains("pnt-more-below");
          out.aboveAtEnd = panel.classList.contains("pnt-more-above");
        }
        // The long-text editor's textarea wears the same rail.
        panel.querySelector(".pnt-edit-expand").click();
        const editor = document.getElementById("pnt-text-editor");
        out.editorRail = Boolean(editor && editor.querySelector(".pnt-rail"));
        out.editorNative = editor
          ? getComputedStyle(editor.querySelector("textarea")).scrollbarWidth : null;
        window.__t.esc(); // closes the editor
        window.__t.esc(); // leaves Edit Mode
        return out;
      `);
    } finally {
      await send(ws, "Emulation.clearDeviceMetricsOverride");
    }
    if (r.overflow <= 0) return fail("the panel did not overflow at 520px — nothing to measure");
    if (r.native !== "none") fail(`the native bar is still on: scrollbar-width is ${r.native}`);
    if (!r.rail) return fail("no rail was drawn in the panel");
    if (!r.onAtOpen) fail("the rail did not flash on open");
    if (!r.above) fail("scrolled in, the header casts no shadow (no pnt-more-above)");
    if (!r.below) fail("scrolled in, the footer casts no shadow (no pnt-more-below)");
    if (!/translateY\((?!0px)/.test(r.thumb)) fail(`the thumb did not move: ${r.thumb || "no transform"}`);
    if (r.belowAtEnd) fail("at the end, the footer still casts a shadow");
    if (!r.aboveAtEnd) fail("at the end, the header casts no shadow");
    if (!r.editorRail) fail("the long-text editor has no rail");
    if (r.editorNative !== "none") fail(`the textarea keeps its native bar: ${r.editorNative}`);
  });
  // ===== Round four's panel =====
  // Collapsing groups, the label as the mark, one stepper, no wheel. Each is a
  // behaviour the gallery promised and the build has to keep.
  await check("groups open and close, and an edit reveals its group", async (fail) => {
    await loadHarness(ws);
    const r = await evaluate(ws, `
      // The shipped defaults: an earlier case may have left another mode on.
      window.__t.prefs({ editTokenControls: "both", editGroups: "standard" });
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      const group = (key) => document.querySelector('#pnt-edit-panel .pnt-edit-group[data-group="' + key + '"]');
      const out = {};
      out.sizeClosed = group("size").classList.contains("pnt-edit-closed");
      out.sizeSummary = group("size").querySelector(".pnt-edit-sum").textContent;
      out.typographyOpen = !group("typography").classList.contains("pnt-edit-closed");
      group("size").querySelector(".pnt-edit-title").click();
      out.sizeAfterClick = !group("size").classList.contains("pnt-edit-closed");
      group("size").querySelector(".pnt-edit-title").click();
      out.sizeAfterSecondClick = group("size").classList.contains("pnt-edit-closed");
      // An edit inside a closed group: Surface is closed on a transparent h2.
      out.surfaceClosed = group("surface").classList.contains("pnt-edit-closed");
      window.__t.type("opacity", 80);
      out.surfaceAfterEdit = !group("surface").classList.contains("pnt-edit-closed");
      out.opacityLabelOn = window.__t.row("opacity").querySelector(".pnt-edit-label").classList.contains("pnt-edit-on");
      window.__t.resetProp("opacity");
      out.opacityAfterReset = window.__t.css(".card h2", "opacity");
      window.__t.esc();
      window.__t.esc();
      return out;
    `);
    if (!r.sizeClosed) fail("Size is open on an auto-sized heading; it should start closed");
    if (!/^\d+ × \d+ · auto$/.test(r.sizeSummary)) fail(`Size's summary reads "${r.sizeSummary}"`);
    if (!r.typographyOpen) fail("Typography starts closed on a heading");
    if (!r.sizeAfterClick) fail("clicking the title did not open Size");
    if (!r.sizeAfterSecondClick) fail("clicking the title again did not close Size");
    if (!r.surfaceClosed) fail("Surface is open on a transparent heading; it should start closed");
    if (!r.surfaceAfterEdit) fail("editing opacity did not open the closed Surface group");
    if (!r.opacityLabelOn) fail("the edited opacity's label is not the mark");
    if (r.opacityAfterReset !== "1") fail(`the label did not reset opacity: ${r.opacityAfterReset}`);
  });

  await check("one stepper: arrows nudge or step, ⌥↑ steps, the wheel does nothing", async (fail) => {
    const r = await evaluate(ws, `
      const out = { at: "start" };
      window.addEventListener("error", (e) => { out.pageError = (out.pageError || "") + " · " + e.message + " @" + e.lineno; });
      try {
        window.__t.prefs({ editTokenControls: "both", editGroups: "standard" });
        window.__t.probeOn();
        window.__t.select(".card h2");
        window.__t.edit();
        const size = () => window.__t.css(".card h2", "font-size");
        const lead = () => window.__t.css(".card h2", "line-height");
        const q = (name, sel) => {
          const row = window.__t.row(name);
          const node = row && row.querySelector(sel);
          if (!node) throw new Error("no " + sel + " in the " + name + " cell");
          return node;
        };
        const snap = (label) => {
          const row = window.__t.row("font-size");
          out["trace_" + label] = [size(), document.querySelector(".card h2").getAttribute("style"),
            Boolean(row && row.querySelector(".pnt-edit-tok")),
            row && row.querySelector(".pnt-edit-num") ? row.querySelector(".pnt-edit-num").dataset.kind : null].join(" | ");
        };
        out.at = "kind";
        snap("0open");
        out.sizeKind = q("font-size", ".pnt-edit-num").dataset.kind;
        // font-size sits on --title-sm: the field's arrow walks the ladder.
        out.at = "arrow";
        q("font-size", ".pnt-edit-arrow.pnt-edit-up").click();
        out.sizeAfterArrow = size();
        snap("1arrow");
        window.__t.undo();
        snap("2undo");
        // line-height sits on no scale: the arrow nudges by the control's step.
        out.at = "nudge";
        out.leadBefore = lead();
        q("line-height", ".pnt-edit-arrow.pnt-edit-up").click();
        out.leadAfterArrow = lead();
        snap("3nudge");
        window.__t.undo();
        snap("4undo");
        // ⌥↑ on the size field steps the ladder from the keyboard.
        out.at = "alt";
        const input = q("font-size", ".pnt-edit-input");
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
        out.sizeAfterAlt = size();
        // The step rebuilt the field under the focus; the value it showed
        // must not have been committed over the step by the blur that fired
        // as it left.
        out.styleAfterAlt = document.querySelector(".card h2").getAttribute("style");
        snap("5alt");
        window.__t.undo();
        snap("6undo");
        // The wheel over a cell scrolls; it no longer steps anything.
        out.at = "wheel";
        window.__t.row("font-size").dispatchEvent(
          new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
        out.sizeAfterWheel = size();
        snap("7wheel");
        // The capsule carries the full name for the tooltip.
        out.at = "tip";
        out.capTip = q("font-size", ".pnt-edit-tok").dataset.tip;
        out.at = "done";
      } catch (err) {
        out.error = String(err.message || err);
      }
      window.__t.esc();
      window.__t.esc();
      return out;
    `);
    if (r.pageError) fail(`the page threw: ${r.pageError}`);
    if (r.error) {
      const trace = Object.keys(r).filter((k) => k.startsWith("trace_")).sort()
        .map((k) => `${k.slice(6)}: ${r[k]}`).join(" ‖ ");
      return fail(`at "${r.at}": ${r.error} — ${trace}`);
    }
    if (r.sizeKind !== "tok") fail(`the size field is not marked as sitting on a token: ${r.sizeKind}`);
    if (r.sizeAfterArrow !== "22px") fail(`the arrow did not step the ladder: ${r.sizeAfterArrow}`);
    if (r.leadAfterArrow === r.leadBefore) fail("the arrow did not nudge a value with no ladder");
    if (r.sizeAfterAlt !== "22px") fail(`⌥↑ did not step the ladder: ${r.sizeAfterAlt}`);
    if (r.styleAfterAlt !== "font-size: var(--title-md);") {
      fail(`after ⌥↑ the element wears ${JSON.stringify(r.styleAfterAlt)} — the rebuilt field's blur wrote over the step`);
    }
    if (r.sizeAfterWheel !== "18px") fail(`the wheel still steps: ${r.sizeAfterWheel}`);
    if (r.capTip !== "--title-sm") fail(`the capsule's tooltip is "${r.capTip}", not the full name`);
  });
  // ===== Page values (ADR 0004) =====
  await check("page values · a value on no token steps through the page's own", async (fail) => {
    await loadHarness(ws);
    const r = await evaluate(ws, `
      window.__t.prefs({ editTokenControls: "both", editGroups: "standard" });
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      const out = {};
      const row = window.__t.row("line-height");
      const num = row.querySelector(".pnt-edit-num");
      out.kind = num.dataset.kind;
      out.state = num.dataset.state;
      const cap = row.querySelector(".pnt-edit-tok");
      out.capsule = cap ? cap.textContent : null;
      out.capsulePage = Boolean(cap && cap.classList.contains("pnt-edit-page"));
      out.tip = cap ? cap.dataset.tip : null;
      out.before = window.__t.css(".card h2", "line-height");
      row.querySelector(".pnt-edit-arrow.pnt-edit-up").click();
      out.after = window.__t.css(".card h2", "line-height");
      // Padding is not harvested: a histogram is not a scale.
      const pad = window.__t.row("padding");
      out.paddingKind = pad.querySelector(".pnt-edit-num").dataset.kind;
      out.paddingCapsule = Boolean(pad.querySelector(".pnt-edit-tok"));
      window.__t.undo();
      window.__t.esc();
      window.__t.esc();
      return out;
    `);
    if (r.kind !== "page") fail(`line-height's field is ${r.kind}, not on a page ladder`);
    if (r.state !== "on") fail(`the heading's own leading is not on the page ladder: ${r.state}`);
    if (!r.capsulePage || !/page/.test(r.capsule || "")) fail(`the capsule reads ${JSON.stringify(r.capsule)}`);
    if (!/leadings on this page/.test(r.tip || "")) fail(`the capsule's tooltip reads ${JSON.stringify(r.tip)}`);
    if (r.after === r.before) fail("the arrow did not step to the next leading on the page");
    if (r.paddingKind !== "none" || r.paddingCapsule) fail("padding grew a page ladder; spacing is not harvested");
  });

  await check("page values · a hashed class is no scale", async (fail) => {
    const r = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".hashed-fixture", 3, 3);
      window.__t.edit();
      const pad = window.__t.row("padding");
      const out = {
        kind: pad.querySelector(".pnt-edit-num").dataset.kind,
        capsule: Boolean(pad.querySelector(".pnt-edit-tok")),
      };
      window.__t.esc();
      window.__t.esc();
      return out;
    `);
    if (r.kind !== "none") fail(`padding on a hashed class reads ${r.kind}`);
    if (r.capsule) fail("a hashed class offered a stepper");
  });

  await check("rung list · every rung, and a match in scope that becomes a claim", async (fail) => {
    const r = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".coincidence", 3, 3);
      window.__t.edit();
      const out = {};
      window.addEventListener("error", (e) => { out.pageError = e.message + " @" + e.lineno; });
      const row = window.__t.row("font-size");
      out.kind = row.querySelector(".pnt-edit-num").dataset.kind;
      row.querySelector(".pnt-edit-tok b").click();
      const list = document.getElementById("pnt-rung-list");
      out.open = Boolean(list);
      if (list) {
        out.rungs = [...list.querySelectorAll(".pnt-rung:not(.pnt-rung-match) b")].map((b) => b.textContent);
        out.current = list.querySelector(".pnt-rung-on b") ? list.querySelector(".pnt-rung-on b").textContent : null;
        out.matches = [...list.querySelectorAll(".pnt-rung-match b")].map((b) => b.textContent);
        const match = list.querySelector(".pnt-rung-match");
        if (match) match.click();
      }
      out.closed = !document.getElementById("pnt-rung-list");
      out.style = document.querySelector(".coincidence").getAttribute("style");
      out.size = window.__t.css(".coincidence", "font-size");
      const after = window.__t.row("font-size");
      out.kindAfter = after.querySelector(".pnt-edit-num").dataset.kind;
      out.capsuleAfter = after.querySelector(".pnt-edit-tok") ? after.querySelector(".pnt-edit-tok b").textContent : null;
      out.labelOn = after.querySelector(".pnt-edit-label").classList.contains("pnt-edit-on");
      out.block = await window.__t.copy();
      return out;
    `);
    if (r.pageError) fail(`the page threw: ${r.pageError}`);
    if (r.kind !== "page") fail(`a raw 22px should sit on the page ladder, not ${r.kind}`);
    if (!r.open) return fail("the capsule's name did not open the rung list");
    if (!r.rungs || r.rungs.length < 2) fail(`the list shows ${JSON.stringify(r.rungs)}`);
    if (r.current !== "22px") fail(`the current rung is marked as ${JSON.stringify(r.current)}`);
    if (!r.matches || !r.matches.includes("--title-md")) fail(`matches in scope: ${JSON.stringify(r.matches)} — --title-md equals 22px`);
    if (!r.closed) fail("choosing a match left the list open");
    if (!/var\(--title-md\)/.test(r.style || "")) fail(`the claim did not write the var(): ${JSON.stringify(r.style)}`);
    if (r.size !== "22px") fail(`the claim changed the size: ${r.size}`);
    if (r.kindAfter !== "tok" || r.capsuleAfter !== "md") fail(`after the claim the field reads ${r.kindAfter} / ${r.capsuleAfter}`);
    if (!r.labelOn) fail("the claim is not marked as an edit on the label");
    if (!/font-size: 22px → (--title-md|var\(--title-md\))/.test(r.block || "")) {
      fail(`the delta does not carry the claim: ${JSON.stringify(((r.block || "").match(/# +font-size:[^\n]*/) || [""])[0])}`);
    }
    await evaluate(ws, "window.__t.esc(); window.__t.esc(); return true;");
  });

  await check("page values · the picker offers the page's colours beside the source's", async (fail) => {
    const r = await evaluate(ws, `
      window.__t.probeOn();
      window.__t.select(".card h2");
      window.__t.edit();
      window.__t.swatch("color");
      const pop = window.__t.pop();
      const out = {
        source: pop.querySelectorAll(".pnt-edit-pal:not(.pnt-edit-pal-page)").length,
        page: pop.querySelectorAll(".pnt-edit-pal-page").length,
        captions: [...pop.querySelectorAll(".pnt-edit-palcap span")].map((s) => s.textContent),
      };
      const first = pop.querySelector(".pnt-edit-pal-page");
      out.firstTitle = first ? first.title : null;
      window.__t.esc();
      window.__t.esc();
      window.__t.esc();
      return out;
    `);
    if (r.source === 0) fail("the source palette is gone");
    if (r.page === 0) fail("no page colours were offered");
    if (!r.captions.includes("in the source") || !r.captions.includes("on the page")) fail(`captions: ${JSON.stringify(r.captions)}`);
    if (!/on this page \d+ time/.test(r.firstTitle || "")) fail(`a page swatch's title reads ${JSON.stringify(r.firstTitle)}`);
  });
  // ===== The handoff =====
  // The toolbar grows into the panel: a surface set at the toolbar's rect on
  // entry, gone with the panel visible 260ms later; back the other way on
  // Escape; and nothing travels under the reduced-motion preference.
  await check("handoff · the toolbar grows into the panel, and shrinks back", async (fail) => {
    await loadHarness(ws);
    const r = await evaluate(ws, `
      const near = (a, b) => Math.abs(a - b) <= 2;
      window.__t.prefs({ selectionLayout: "edge" });
      window.__t.probeOn();
      window.__t.select(".card h2");
      const bar = document.getElementById("pnt-toolbar").getBoundingClientRect();
      window.__t.edit();
      const out = {};
      const morph = document.getElementById("pnt-edit-morph");
      out.morph = Boolean(morph);
      if (morph) {
        const m = morph.getBoundingClientRect();
        out.startsAtToolbar = near(m.left, bar.left) && near(m.top, bar.top) && near(m.width, bar.width);
      }
      const panel = document.getElementById("pnt-edit-panel");
      out.arriving = panel.classList.contains("pnt-edit-arriving");
      out.ticksEnter = document.getElementById("pnt-tether").classList.contains("pnt-tether-enter");
      // Mid-flight: the surface has left the toolbar and not yet reached the
      // panel, and the panel's contents are still fading in.
      await new Promise((r) => setTimeout(r, 90));
      const mid = document.getElementById("pnt-edit-morph");
      const target = panel.getBoundingClientRect();
      if (mid) {
        const m = mid.getBoundingClientRect();
        out.midLeftToolbar = !(near(m.left, bar.left) && near(m.top, bar.top) && near(m.width, bar.width) && near(m.height, bar.height));
        out.midShortOfPanel = !(near(m.left, target.left) && near(m.top, target.top) && near(m.width, target.width) && near(m.height, target.height));
      }
      out.midMorph = Boolean(mid);
      out.midOpacity = getComputedStyle(panel).opacity;
      await new Promise((r) => setTimeout(r, 230));
      out.morphGone = !document.getElementById("pnt-edit-morph");
      out.panelOpacity = getComputedStyle(panel).opacity;
      out.labelHidden = getComputedStyle(document.getElementById("pnt-label")).visibility;
      out.antsOpacity = getComputedStyle(document.getElementById("pnt-ants")).opacity;
      const panelRect = panel.getBoundingClientRect();
      window.__t.esc();
      // The surface is built a frame after Escape and starts moving a frame
      // after that, so a single sample at a fixed delay raced the frame clock
      // (it failed about half the time, before 3.0 too). Poll instead: the
      // claim is that it heads home, not when the first frame lands.
      const t0 = performance.now();
      let back = null;
      while (performance.now() - t0 < 250) {
        await new Promise((r) => requestAnimationFrame(r));
        back = document.getElementById("pnt-edit-morph");
        if (!back) continue;
        out.backMorph = true;
        out.backOut = back.classList.contains("pnt-morph-out");
        const b = back.getBoundingClientRect();
        if (b.width < panelRect.width - 1 || near(b.width, bar.width)) { out.backHeadsHome = true; break; }
      }
      out.backMorph = Boolean(out.backMorph);
      await new Promise((r) => setTimeout(r, 300));
      out.backGone = !document.getElementById("pnt-edit-morph");
      out.labelBack = getComputedStyle(document.getElementById("pnt-label")).visibility;
      window.__t.esc();
      return out;
    `);
    if (!r.morph) return fail("no surface was drawn on entry");
    if (!r.startsAtToolbar) fail("the surface did not start at the toolbar's rect");
    if (!r.arriving) fail("the panel did not hold its contents back for the surface");
    if (!r.ticksEnter) fail("the ticks did not get their entrance");
    if (!r.midMorph) fail("the surface was gone 90ms in");
    else {
      if (!r.midLeftToolbar) fail("90ms in, the surface had not left the toolbar");
      if (!r.midShortOfPanel) fail("90ms in, the surface had already reached the panel");
    }
    if (!(parseFloat(r.midOpacity) < 1)) fail(`90ms in, the panel is already at opacity ${r.midOpacity}`);
    if (!r.morphGone) fail("the surface is still there 320ms in");
    if (r.panelOpacity !== "1") fail(`the panel is at opacity ${r.panelOpacity} after the handoff`);
    if (r.labelHidden !== "hidden") fail(`the label is ${r.labelHidden} while editing`);
    if (r.antsOpacity !== "0") fail(`the ants are at opacity ${r.antsOpacity} while editing`);
    if (!r.backMorph) fail("no surface travelled back on Escape");
    else {
      if (!r.backOut) fail("the way back is not on the exit curve");
      if (!r.backHeadsHome) fail("the surface did not head back toward the toolbar");
    }
    if (!r.backGone) fail("the returning surface is still there 340ms later");
    if (r.labelBack !== "visible") fail(`the label is ${r.labelBack} after the handoff back`);
  });

  await check("handoff · reduced motion crossfades and draws no surface", async (fail) => {
    await send(ws, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    let r;
    try {
      r = await evaluate(ws, `
        window.__t.probeOn();
        window.__t.select(".card h2");
        window.__t.edit();
        const out = { morph: Boolean(document.getElementById("pnt-edit-morph")) };
        await new Promise((r) => setTimeout(r, 300));
        out.panelOpacity = getComputedStyle(document.getElementById("pnt-edit-panel")).opacity;
        out.tickAnimation = getComputedStyle(document.querySelector("#pnt-tether .pnt-tether-tick")).animationName;
        window.__t.esc();
        window.__t.esc();
        return out;
      `);
    } finally {
      await send(ws, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    }
    if (r.morph) fail("a surface travelled under the reduced-motion preference");
    if (r.panelOpacity !== "1") fail(`the panel did not arrive: opacity ${r.panelOpacity}`);
    if (r.tickAnimation !== "none") fail(`the ticks still animate: ${r.tickAnimation}`);
  });
} finally {
  try { if (ws) ws.close(); } catch { /* already gone */ }
  browser.kill();
  server.close();
  rmSync(PROFILE, RM_PROFILE);
}

for (const r of rows) {
  console.log(`${r.result.padEnd(5)} ${r.case}${r.detail ? " — " + r.detail : ""}`);
}
console.log(failures === 0 ? "\ncdp: all checks passed" : `\ncdp: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
