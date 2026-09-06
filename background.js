const activeTabs = new Set();

const THEME_KEY = "theme";
const DEFAULT_BADGE = "#f0452b"; // the dark theme's accent

// The content script's injection lists are duplicated here for tabs that were
// already open when the extension was installed or reloaded — chrome.scripting
// is the only way to reach those. Keep both in step with manifest.json's
// content_scripts entry, tokens.css first so it wins the cascade order.
const INJECT_JS = ["lib/html2canvas.min.js", "content.js"];
const INJECT_CSS = ["tokens.css", "content.css"];

// The badge is browser chrome, not page chrome, so it can't read tokens.css.
// These mirror --pnt-accent from each theme block; a theme missing from here
// falls back to the default rather than showing no badge colour.
const BADGE_ACCENT = {
  dark: "#f0452b",
  light: "#d13a1d",
  dracula: "#bd93f9",
  monokai: "#f92672",
  nord: "#88c0d0",
  "solarized-dark": "#e5762f",
  "tokyo-night": "#bb9af7",
};

// 1.x stored "terracotta-dark" / "terracotta-light"; 2.0 calls the pair
// "dark" / "light" and defaults to "system". Read through this so an old
// preference lands on the palette it meant. Mirrored in settings.js and
// background.js — change all three.
const LEGACY_THEME_IDS = { "terracotta-dark": "dark", "terracotta-light": "light" };
const migrateThemeId = (id) => LEGACY_THEME_IDS[id] || id;

// ===== Toolbar icon =====
// Two sets, drawn for the browser's own mode rather than Pointee's theme: on
// a light toolbar the cream hand needs its ink line to be seen at all; on a
// dark one the line is a smudge and the drawing stands on its own. Chrome's
// manifest can name only one set (Firefox's theme_icons has no counterpart
// here), so the worker swaps them. A service worker has no matchMedia: each
// page's content script — and the settings page — reports the scheme it
// sees, and the latest report sets the global icon. The manifest's default is
// the light set, which holds up on dark too until the first report lands.
const ICON_SETS = {
  light: { 16: "icons/light-16.png", 32: "icons/light-32.png", 48: "icons/light-48.png", 128: "icons/light-128.png" },
  dark: { 16: "icons/dark-16.png", 32: "icons/dark-32.png", 48: "icons/dark-48.png", 128: "icons/dark-128.png" },
};
// What the action shows now. Null until the first report after the worker
// wakes; Chrome keeps the icon across worker restarts, so a repeat costs one
// redundant setIcon at most.
let iconScheme = null;

function applyIconScheme(dark) {
  const scheme = dark ? "dark" : "light";
  if (scheme === iconScheme) return;
  iconScheme = scheme;
  chrome.action.setIcon({ path: ICON_SETS[scheme] }).catch(() => {});
}

async function badgeColor() {
  try {
    const stored = await chrome.storage.local.get(THEME_KEY);
    let theme = migrateThemeId(stored[THEME_KEY] || "system");
    // "system" has no palette; both halves share an accent family, so the dark
    // one's accent is the right badge in either resolution.
    if (theme === "system") theme = "dark";
    return BADGE_ACCENT[theme] || DEFAULT_BADGE;
  } catch {
    return DEFAULT_BADGE;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const isActive = activeTabs.has(tab.id);

  if (isActive) {
    activeTabs.delete(tab.id);
  } else {
    activeTabs.add(tab.id);
  }

  const nowActive = !isActive;

  chrome.action.setBadgeText({ tabId: tab.id, text: nowActive ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: await badgeColor() });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_POINT",
      active: nowActive,
    });
  } catch {
    // Content script not yet injected — inject it first
    if (nowActive) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: INJECT_JS,
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: INJECT_CSS,
      });
      await chrome.tabs.sendMessage(tab.id, {
        type: "TOGGLE_POINT",
        active: true,
      });
    }
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "DEACTIVATE" && sender.tab) {
    activeTabs.delete(sender.tab.id);
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "" });
  }

  if (msg.type === "COLOR_SCHEME") {
    applyIconScheme(Boolean(msg.dark));
  }

  // The gear in the page can't open the options page itself —
  // chrome.runtime.openOptionsPage() is not exposed to content scripts.
  if (msg.type === "OPEN_SETTINGS") {
    chrome.runtime.openOptionsPage();
  }

  // The shader agent has to run in the page's own JavaScript world — the
  // isolated world can see a <canvas> but nothing of the WebGL context behind
  // it — and only chrome.scripting can cross that boundary. Injected on
  // demand, when Edit Mode selects a canvas, never as a matter of course; the
  // agent itself is re-entry-guarded, so asking twice costs nothing.
  if (msg.type === "INJECT_SHADER_AGENT" && sender.tab) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      injectImmediately: true,
      files: ["shader-agent.js"],
    }).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true; // keeps the message channel open for the async reply
  }

  // A stylesheet the page itself is not allowed to read.
  //
  // A cross-origin <link> without CORS headers throws on .cssRules, so a design
  // system served from a CDN — an entirely ordinary arrangement — was invisible
  // to the token layer. A content script cannot get around that: its fetches
  // carry the page's origin and are refused the same way. The service worker
  // can, because host_permissions applies to it.
  //
  // The text is handed straight back to the content script that asked and is
  // never stored, forwarded, or read here. See PRIVACY.md.
  if (msg.type === "FETCH_STYLESHEETS") {
    const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, MAX_SHEET_FETCH) : [];
    Promise.all(urls.map(fetchStylesheet)).then(
      (sheets) => sendResponse({ sheets }),
      () => sendResponse({ sheets: [] })
    );
    return true; // keeps the message channel open for the async reply
  }
});

// Enough for a design system split across a few files, far short of enough to
// walk a site with. A page that links more than this loses the tail, and the
// panel's degraded marker still reports what could not be read.
const MAX_SHEET_FETCH = 12;
const SHEET_FETCH_TIMEOUT = 4000;
const MAX_SHEET_BYTES = 4 * 1024 * 1024;

async function fetchStylesheet(url) {
  try {
    const parsed = new URL(url);
    // Only what a stylesheet can actually be. Anything else is a URL we were
    // handed, not one we should be dereferencing with host permissions.
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { url, error: "unsupported scheme" };
    }
    const res = await fetch(parsed.href, {
      // No cookies. Reading a page's stylesheet must not become a way of
      // making an authenticated request on the user's behalf.
      credentials: "omit",
      redirect: "follow",
      signal: AbortSignal.timeout(SHEET_FETCH_TIMEOUT),
    });
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") || "";
    if (type && !/text\/css|text\/plain|application\/octet-stream/i.test(type)) {
      return { url, error: `not a stylesheet (${type.split(";")[0]})` };
    }
    const text = await res.text();
    if (text.length > MAX_SHEET_BYTES) return { url, error: "too large" };
    return { url, text };
  } catch (err) {
    return { url, error: String((err && err.message) || err) };
  }
}

// Repaint every active tab's badge when the theme changes, so the badge doesn't
// keep advertising the previous accent until the next toggle.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[THEME_KEY]) return;
  const color = await badgeColor();
  for (const tabId of activeTabs) {
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  }
});

// Deep shader capture (off by default). On, the shader agent is registered as
// a document_start MAIN-world script, so it records which canvases get WebGL
// contexts from page load — the only way to see a shader that draws once and
// stops before Edit Mode ever opens. The registration persists across
// sessions, so the worker only has to converge the registered state with the
// stored preference: once at wake-up, and again whenever the setting changes.
const DEEP_CAPTURE_KEY = "editDeepShaderCapture";
const DEEP_CAPTURE_ID = "pnt-shader-early";

async function syncDeepCapture() {
  try {
    const stored = await chrome.storage.local.get(DEEP_CAPTURE_KEY);
    const wanted = stored[DEEP_CAPTURE_KEY] === "on";
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [DEEP_CAPTURE_ID],
    });
    const has = registered.length > 0;
    if (wanted && !has) {
      await chrome.scripting.registerContentScripts([{
        id: DEEP_CAPTURE_ID,
        js: ["shader-agent.js"],
        matches: ["<all_urls>"],
        runAt: "document_start",
        world: "MAIN",
        persistAcrossSessions: true,
      }]);
    } else if (!wanted && has) {
      await chrome.scripting.unregisterContentScripts({ ids: [DEEP_CAPTURE_ID] });
    }
  } catch {
    // A Chrome too old for MAIN-world registration: the lazy agent still
    // works, this preference simply cannot take effect.
  }
}

syncDeepCapture();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[DEEP_CAPTURE_KEY]) syncDeepCapture();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});
