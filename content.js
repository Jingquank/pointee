(() => {
  "use strict";

  // ===== State =====
  let probeActive = false;
  let hoveredElement = null;
  let selectedElement = null;
  let overlayContainer = null;
  let labelEl = null;
  let toolbarEl = null;
  let parentButtonEl = null;
  let tipEl = null; // the tooltip root — one node names every icon-only action
  let toastEl = null;
  let toastTimer = null;
  let rafId = null;
  let viewportRafId = null;
  let settingsButtonEl = null;
  // Redline (held-Option spacing measurements). redlineTarget is deliberately
  // separate from hoveredElement: while something is selected, hoveredElement
  // is aliased to the selection, and redline must never disturb that.
  let redlining = false;
  let redlineTarget = null;
  let lastMouseX = -1;
  let lastMouseY = -1;
  let redlineEl = null;
  let redlineHoverEl = null;
  let redlineLineEls = [];
  let redlineGuideEls = [];
  let redlinePillEls = [];
  // Tether (Edit Mode's association chrome — see the Tether section).
  let tetherEl = null;
  let tetherTickEls = [];
  let tetherSegEls = [];
  let tetherLoud = false;
  let tetherLoudTimer = 0;
  // Edit Mode (live-tuning the selection). A sub-mode of selection, like
  // redline — `editing` is only ever true while selectedElement is set.
  let editing = false;
  let editPanelEl = null;
  let editPanelPos = null;
  // The panel is attached — flush against the selected element's facing edge
  // and following it — until the user drags it, after which it floats where it
  // was put. CONTEXT.md, Edit panel.
  let editPanelAttached = false;
  let editPanelDragged = false;
  let editPopoverEl = null;
  // Which control the open picker belongs to. The picker is its own root now, so
  // it cannot be found by walking the panel — and the swatch that opened it is
  // destroyed on every re-render of the rows, so the anchor has to be re-found
  // by property rather than held onto.
  let editPopoverProp = null;
  let editGesture = null;
  let editFlashTimer = null;
  let tokenIndex = null;
  let editTokenFamilies = null;
  // Composite type styles: the named sources that set several type properties
  // at once (.text-lg carrying size and leading, a --heading-md var stem
  // carrying three). Built per Edit Mode entry like the families above;
  // the claim is re-derived on every refresh because drift moves with edits.
  let editTypeStyles = null;
  let editTypeLadders = null;
  let editTypeClaim = null;
  // Which styles' sources are in force — cached per render because the var
  // half of that answer walks winning declarations, which is too heavy for
  // the per-scrub refresh path.
  let editTypeInForce = null;
  // The long-text editor, a sibling root like the colour picker.
  let textEditorEl = null;
  // Strong element references, deliberately: the undo stack has to hold them
  // anyway, and edits outlive deselection — they are cleared by switching the
  // extension off, or by a page reload. Every path that touches a record
  // re-checks el.isConnected, since a framework can replace a node out from
  // under us.
  const editRegistry = new Map();
  const undoStack = [];
  const redoStack = [];

  // ===== Ours =====
  // One list, one predicate. "Our own chrome is not page data" is a rule this
  // file needs in four unrelated places — hit-testing, counting how unique a
  // string is on the page, reading the page's design tokens, walking its
  // stylesheets — and it used to be written out separately at each of them.
  // That is how --pnt-accent ended up being offered as a fill for the user's
  // elements: the stylesheet walk was the one site nobody remembered.
  //
  // Adding a new injected root means adding it here and nowhere else.
  const OUR_ROOTS = [
    "pnt-overlay-container",
    "pnt-label",
    "pnt-toolbar",
    "pnt-tip",
    "pnt-settings-btn",
    "pnt-toast",
    "pnt-edit-panel",
    "pnt-color-picker",
    "pnt-text-editor",
    "pnt-probe-cell",
  ];
  const OUR_CHROME = OUR_ROOTS.map((id) => `#${id}`).join(",");
  const OUR_PREFIX = "pnt-";

  // Every form of "is this ours?" the file asks, in one place.
  const isOurs = {
    // A node: ours if it is one of our roots or lives inside one. The id test
    // alone is not enough — an unprefixed child (a <span> in a button, an SVG
    // path) only matches through closest().
    node(el) {
      if (!el || !el.closest) return false;
      return Boolean(el.id?.startsWith(OUR_PREFIX) || el.closest(OUR_CHROME));
    },
    // A custom property or class name from the page's CSS.
    name(name) {
      return typeof name === "string" &&
        (name.startsWith(OUR_PREFIX) || name.startsWith(`--${OUR_PREFIX}`));
    },
    // A stylesheet: ours ride along on every page as content scripts, so their
    // tokens are the tool's and not the page's.
    styleSheet(sheet) {
      const href = (sheet && sheet.href) || "";
      if (!href) return false;
      try {
        const base = chrome.runtime?.getURL?.("");
        if (base && href.startsWith(base)) return true;
      } catch { /* getURL is unavailable outside an extension context */ }
      return /\/(tokens|content)\.css(\?|$)/.test(href);
    },
  };

  // ===== Geometry =====
  // The one group of design values that stays in JS instead of moving to
  // tokens.css. computeChromeLayout() is a pure function — test/placement.mjs
  // mirrors it and validates it over 8280 configurations with no DOM at all — so
  // it cannot call getComputedStyle to read a custom property. Keeping these
  // here is what keeps that spec runnable. DESIGN.md records this as the single
  // deliberate exception to "tokens drive both CSS and JS".
  //
  // margin/gap/pair/minLabelHeight are mirrored as M / GAP / PAIR / MIN_LABEL_H
  // in test/placement.mjs:136-153; the redline* trio is mirrored as PILL_OFFSET /
  // GUIDE_OVERSHOOT / PILL_MARGIN in test/redline.mjs; the tether* keys are
  // mirrored as GAP / TICK / TICK_LOUD / THICK / STUB in test/tether.mjs.
  // Change them here and change them there.
  const GEOMETRY = {
    margin: 4,
    gap: 6,
    pair: 6,
    minLabelHeight: 24,
    narrowToolbar: 470, // the .pnt-compact breakpoint
    straddleInset: 6, // On the edge: the pill's left sits this far in from the element's
    radiusFallback: 4, // assumed corner radius when the element is square
    redlinePillOffset: 8, // pill center sits this far perpendicular to its line
    redlineGuideOvershoot: 4, // dashed guide runs this far past the measurement line
    redlinePillMargin: 14, // pill centers are clamped this far inside the viewport
    // The tether works in the ring of space outside the element and never
    // inside it; tetherGap is that clearance, and it is the constraint the
    // whole design exists to honour.
    tetherGap: 8, // ticks sit this far outside the element's box
    tetherTick: 16, // resting tick length
    tetherTickLoud: 26, // tick length while a control is hot
    tetherThick: 2, // tick thickness, and the run's stroke weight
    tetherStub: 10, // the run leaves the panel at least this far before turning
    // An attached panel sits this far outside the tick — close enough that the
    // tick reads as the joint between element and panel, far enough that the
    // tick is not swallowed by the panel's border.
    tetherAttach: 6,
  };

  // ===== Theme =====
  // Stored as a single id in chrome.storage.local and applied by writing
  // data-pnt-theme onto <html>, which every token block in tokens.css keys off.
  // One attribute themes all five injected roots, because custom properties
  // inherit and `all: initial` does not reset them (CSS Cascade 4 §3.2).
  const THEME_KEY = "theme";
  const DEFAULT_THEME = "system";
  // 1.x stored "terracotta-dark" / "terracotta-light"; 2.0 calls the pair
  // "dark" / "light" and defaults to "system". Read through this so an old
  // preference lands on the palette it meant. Mirrored in settings.js and
  // background.js — change all three.
  const LEGACY_THEME_IDS = { "terracotta-dark": "dark", "terracotta-light": "light" };
  const migrateThemeId = (id) => LEGACY_THEME_IDS[id] || id;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  let themePref = DEFAULT_THEME;

  // "system" has no palette of its own — it picks dark or light. Resolving here rather than duplicating every block inside an @media
  // query keeps tokens.css single-source, and lets the settings page preview
  // exactly what the page will render.
  function resolveTheme(pref) {
    if (pref !== "system") return pref;
    return darkQuery.matches ? "dark" : "light";
  }

  function applyTheme() {
    document.documentElement.dataset.pntTheme = resolveTheme(themePref);
  }

  // Read a token from <html>. Only for the handful of values that genuinely have
  // to reach JS: the toast is positioned entirely from script, and the loading
  // state is written as an inline style. Everything else stays in CSS.
  function token(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Fired immediately at script load, not on activate(), so the first paint of
  // the chrome already has the right palette. activate() applies whatever has
  // arrived by then; until it does, the tokens.css :root block is the default,
  // so an unresolved read shows the dark palette rather than an unstyled box.
  chrome.storage?.local.get(THEME_KEY, (stored) => {
    if (stored && typeof stored[THEME_KEY] === "string") themePref = migrateThemeId(stored[THEME_KEY]);
    if (probeActive) applyTheme();
  });

  // Repaints an already-open page when the settings tab changes the theme.
  // storage.onChanged fires in content scripts directly, so this needs no
  // message plumbing through the service worker.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[THEME_KEY]) return;
    themePref = migrateThemeId(changes[THEME_KEY].newValue || DEFAULT_THEME);
    if (probeActive) applyTheme();
  });

  // Follow the OS live, but only while "system" is selected.
  darkQuery.addEventListener("change", () => {
    if (themePref === "system" && probeActive) applyTheme();
  });

  // The toolbar icon follows the browser, not the theme setting: a light
  // browser gets the hand with its ink line, a dark one the drawing as it is.
  // A service worker has no matchMedia, so each page reports the scheme it
  // sees and the worker sets the icon from that (see background.js). Once at
  // load and again whenever the OS flips; the worker ignores repeats. Guarded
  // because the same file runs in the test harness, outside an extension.
  function reportColorScheme() {
    try {
      chrome.runtime?.sendMessage?.({ type: "COLOR_SCHEME", dark: darkQuery.matches })?.catch?.(() => {});
    } catch { /* not running as an extension */ }
  }
  reportColorScheme();
  darkQuery.addEventListener("change", reportColorScheme);

  // ===== Selection layout =====
  // Where the toolbar sits relative to the info label — the one preference
  // that changes the *shape* of the selection chrome rather than a value in
  // it. Chosen in two design rounds (test/selection-chrome-*.html); the four
  // survivors, default first:
  //   edge    a pill of four icons riding the element's bottom edge
  //   beside  a spine of icons down the label's left, one per readout line
  //   under   a strip of icons under the identity line
  //   bottom  a labelled bar along the label's bottom; the card is as wide as it
  // The readout is the same in all four. Mirrored in settings/settings.js —
  // change both.
  const CHROME_PREFS = {
    selectionLayout: ["edge", "beside", "under", "bottom"],
  };
  const chromePrefs = {};
  for (const key of Object.keys(CHROME_PREFS)) chromePrefs[key] = CHROME_PREFS[key][0];

  function setChromePref(key, value) {
    const roster = CHROME_PREFS[key];
    if (roster) chromePrefs[key] = roster.includes(value) ? value : roster[0];
  }

  // The layout lands as pnt-layout-<id> on <html>, which every layout block in
  // content.css keys off — the same shape as the theme attribute. It goes up
  // with activation and comes down with it, so a page is never left classed.
  function applyLayoutClass() {
    const root = document.documentElement;
    for (const id of CHROME_PREFS.selectionLayout) root.classList.remove(`pnt-layout-${id}`);
    if (probeActive) root.classList.add(`pnt-layout-${chromePrefs.selectionLayout}`);
  }

  chrome.storage?.local.get(Object.keys(CHROME_PREFS), (stored) => {
    if (!stored) return;
    for (const key of Object.keys(CHROME_PREFS)) {
      if (key in stored) setChromePref(key, stored[key]);
    }
    applyLayoutClass();
  });

  // A change with something selected redraws that selection in the new
  // layout, in place — the same no-reload contract the theme keeps. The label
  // is rewritten first (its hints move with the layout), then the toolbar is
  // rebuilt and mounted where the new layout says.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.selectionLayout) return;
    setChromePref("selectionLayout", changes.selectionLayout.newValue);
    applyLayoutClass();
    if (probeActive && selectedElement) {
      updateOverlay(selectedElement, { instant: true });
      showToolbar(selectedElement);
    }
  });

  // ===== Redline Preferences =====
  // Six flat storage keys, one per setting — the "theme" convention. Each
  // roster lists the legal values with the default (current shipping
  // behaviour) first; unrecognised stored values fall back to it silently.
  const REDLINE_PREFS = {
    redlineUnit: ["px", "rem"],
    redlinePrecision: ["whole", "tenths"],
    redlinePillPlacement: ["beside", "online"],
    redlineGuides: ["on", "off"],
    redlineQuietOverlay: ["off", "on"],
    redlineZeroPills: ["on", "off"],
  };
  const redlinePrefs = {};
  for (const key of Object.keys(REDLINE_PREFS)) redlinePrefs[key] = REDLINE_PREFS[key][0];

  function setRedlinePref(key, value) {
    const roster = REDLINE_PREFS[key];
    if (roster) redlinePrefs[key] = roster.includes(value) ? value : roster[0];
  }

  // Same fire-and-forget shape as the theme read above: prefs are consumed at
  // render time, and no redline can be active this early.
  chrome.storage?.local.get(Object.keys(REDLINE_PREFS), (stored) => {
    if (!stored) return;
    for (const key of Object.keys(REDLINE_PREFS)) {
      if (key in stored) setRedlinePref(key, stored[key]);
    }
  });

  // A live change mid-gesture restyles the measurements in place — the same
  // no-reload contract the theme keeps.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let touched = false;
    for (const key of Object.keys(REDLINE_PREFS)) {
      if (changes[key]) {
        setRedlinePref(key, changes[key].newValue);
        touched = true;
      }
    }
    if (touched && redlining) {
      applyRedlineQuiet();
      scheduleRedline();
    }
  });

  // ===== Edit Preferences =====
  // Same shape as the redline roster above: flat keys, default first,
  // unrecognised values fall back silently.
  //
  // editGroups decides whether the panel shows every group it can edit or only
  // the ones this element already has — the difference between "give this a
  // border" being one click away and being out of sight until you need it.
  // editTokenControls decides whether a token-bearing value offers its scale,
  // its raw number, or both.
  const EDIT_PREFS = {
    editGroups: ["standard", "adaptive"],
    editTokenControls: ["both", "token", "value"],
    // Consumed by background.js (it registers the document_start agent), not
    // here — carried in this roster so the settings page and the content
    // script keep speaking the same key list.
    editDeepShaderCapture: ["off", "on"],
  };
  const editPrefs = {};
  for (const key of Object.keys(EDIT_PREFS)) editPrefs[key] = EDIT_PREFS[key][0];

  function setEditPref(key, value) {
    const roster = EDIT_PREFS[key];
    if (roster) editPrefs[key] = roster.includes(value) ? value : roster[0];
  }

  chrome.storage?.local.get(Object.keys(EDIT_PREFS), (stored) => {
    if (!stored) return;
    for (const key of Object.keys(EDIT_PREFS)) {
      if (key in stored) setEditPref(key, stored[key]);
    }
  });

  // Changing a preference with the panel open re-renders it in place, the same
  // no-reload contract redline and the theme keep.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let touched = false;
    for (const key of Object.keys(EDIT_PREFS)) {
      if (changes[key]) {
        setEditPref(key, changes[key].newValue);
        touched = true;
      }
    }
    if (touched && editing) renderEditControls();
  });

  // ===== Copy Preferences =====
  // Same shape again: flat keys, default first, unrecognised values fall back
  // silently. What is different here is that the defaults are not a taste — they
  // are the payload this tool shipped before the section existed, reproduced
  // byte for byte. Nobody's clipboard changes until they open the settings page.
  //
  // Two axes. Which header fields ride along (the first twelve keys), and how
  // much of the rendered subtree comes with them (copyHtml and its two
  // qualifiers). The nine field keys default on because buildPointerHeader
  // emitted all nine unconditionally; the three diagnosis fields default off
  // because they did not exist.
  //
  // copyHtml: "root" plus copyHtmlFallback: "on" is exactly the rule the code
  // used to hard-wire — the root tag when a source or component resolved, the
  // full subtree when neither did. Splitting the fallback out of the choice is
  // deliberate: with it welded on, turning `source` and `component` off to slim
  // a payload would silently balloon the HTML block instead.
  const COPY_PREFS = {
    copySource: ["on", "off"],
    copyComponent: ["on", "off"],
    copyPage: ["on", "off"],
    copyAnchor: ["on", "off"],
    copyHandlers: ["on", "off"],
    copySelector: ["on", "off"],
    copyPosition: ["on", "off"],
    copyRepeated: ["on", "off"],
    copyText: ["on", "off"],
    copyLayout: ["off", "on"],
    copyStyles: ["off", "on"],
    copyProps: ["off", "on"],
    copyHtml: ["root", "shape", "full", "none"],
    copyDepth: ["3", "2", "1"],
    copyHtmlFallback: ["on", "off"],
    copyFence: ["on", "off"],
  };
  const copyPrefs = {};
  for (const key of Object.keys(COPY_PREFS)) copyPrefs[key] = COPY_PREFS[key][0];

  function setCopyPref(key, value) {
    const roster = COPY_PREFS[key];
    if (roster) copyPrefs[key] = roster.includes(value) ? value : roster[0];
  }

  chrome.storage?.local.get(Object.keys(COPY_PREFS), (stored) => {
    if (!stored) return;
    for (const key of Object.keys(COPY_PREFS)) {
      if (key in stored) setCopyPref(key, stored[key]);
    }
  });

  // The simplest of the three listeners: nothing on screen is painted from these.
  // They are read at the moment a copy button is pressed, so keeping the object
  // current is the whole job — the next copy is already the new shape.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(COPY_PREFS)) {
      if (changes[key]) setCopyPref(key, changes[key].newValue);
    }
  });

  // The quiet-overlay preference paints entirely from CSS; this class is its
  // only JS surface. Held low (removed) whenever redline itself is off.
  function applyRedlineQuiet() {
    document.documentElement.classList.toggle(
      "pnt-redline-quiet",
      redlining && redlinePrefs.redlineQuietOverlay === "on"
    );
  }

  // ===== SVG Icons =====
  const ICONS = {
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    parent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M12 20v-8"/><polyline points="9 15 12 12 15 15"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };

  // ===== Style formatting helpers =====
  function colorSwatch(rawColor) {
    if (!rawColor) return "";
    const m = rawColor.match(/^rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
    const alpha = m ? parseFloat(m[1]) : 1;
    const cls = alpha < 1 ? "pnt-color-swatch pnt-color-swatch-alpha" : "pnt-color-swatch";
    return `<span class="${cls}" style="background-color:${rawColor}"></span>`;
  }

  function formatColor(c) {
    if (!c) return c;
    const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (!m) return c;
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a === 0) return "transparent";
    const hex = (n) => parseInt(n, 10).toString(16).padStart(2, "0");
    const base = `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    return a < 1 ? `${base}@${Math.round(a * 100)}%` : base;
  }

  function splitShadows(s) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        out.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(s.slice(start).trim());
    return out;
  }

  function formatShadow(s) {
    return splitShadows(s)
      .map((part) => {
        const colorMatch = part.match(/rgba?\([^)]+\)/);
        if (!colorMatch) return part;
        return `${colorSwatch(colorMatch[0])}${formatColor(colorMatch[0])}`;
      })
      .join(", ");
  }

  function hasDirectText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
    }
    return false;
  }

  function getDirectText(el) {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
    }
    return out.trim().replace(/\s+/g, " ");
  }

  // The relevance rule for the typography controls that only make sense on the
  // element the text actually lives on. Named so EDIT_GROUPS reads as a
  // statement about the element rather than as a string-length check.
  const ownsText = (el) => getDirectText(el).length > 0;

  // The looser rule, for colour: setting colour on a wrapper is how an
  // inherited colour is normally written, so it is enough that text lives
  // anywhere beneath — but a canvas, an image or an empty decorative div has
  // no text for a colour to reach, and offering the row there was noise.
  const containsText = (el) =>
    Boolean(el && typeof el.textContent === "string" && el.textContent.trim().length > 0);

  // Read cursor without the probe-mode plain-arrow override.
  // Temporarily strips the override class for a synchronous style read; no paint occurs.
  function getRealCursor(el) {
    const root = document.documentElement;
    const wasActive = root.classList.contains("pnt-point-active");
    if (wasActive) root.classList.remove("pnt-point-active");
    const cursor = getComputedStyle(el).cursor;
    if (wasActive) root.classList.add("pnt-point-active");
    return cursor;
  }

  // ===== Message Listener =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_POINT") {
      if (msg.active && !probeActive) {
        activate();
      } else if (!msg.active && probeActive) {
        deactivate();
      }
    }
  });

  // ===== Activation / Deactivation =====
  function activate() {
    probeActive = true;
    applyTheme();
    applyLayoutClass();
    document.documentElement.classList.add("pnt-point-active");
    createOverlay();
    createSettingsButton();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    // Alt+Tab away must not strand redline: no keyup ever arrives for it
    window.addEventListener("blur", onWindowBlur);
    // Capture, so scrolling any nested container counts too
    document.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    window.addEventListener("resize", onViewportChange);
  }

  function deactivate() {
    probeActive = false;

    // Through deselectElement rather than nulling selectedElement here: that is
    // the one place carrying the invariant that ending a selection also ends
    // Edit Mode and redline. Taking the shortcut is exactly what used to strand
    // the panel on screen with `editing` still true — and with it the five
    // capture-phase pointer guards, which went on swallowing every click on the
    // page until a reload, and made the next activation unable to select
    // anything. It has to run before removeOverlay(): exitEditMode() finishes by
    // repainting the overlay and the gear, and both want their nodes still there.
    deselectElement();

    // Switching off leaves the page as it was found, so nothing the panel wrote
    // outlives the tool. The history goes with it — otherwise switching back on
    // and pressing undo would reinstate the edits just reverted, resetAllEdits()
    // having landed as one more undoable batch.
    resetAllEdits();
    undoStack.length = 0;
    redoStack.length = 0;

    hoveredElement = null;
    lastMouseX = -1;
    lastMouseY = -1;
    document.documentElement.classList.remove("pnt-point-active");
    applyLayoutClass();
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (viewportRafId) {
      cancelAnimationFrame(viewportRafId);
      viewportRafId = null;
    }
    removeOverlay();
    removeToolbar();
    removeSettingsButton();
    removeToast();
  }

  // ===== Settings Button =====
  // Pinned to the viewport's top-right corner for as long as point mode is on.
  // Mounted here rather than in showToolbar() on purpose: #pnt-toolbar is torn
  // down and rebuilt on every click and removed entirely on deselect, so a
  // button living inside it would disappear whenever nothing was selected.
  function createSettingsButton() {
    if (settingsButtonEl) return;
    settingsButtonEl = document.createElement("button");
    settingsButtonEl.id = "pnt-settings-btn";
    settingsButtonEl.type = "button";
    settingsButtonEl.title = "Probe settings";
    settingsButtonEl.setAttribute("aria-label", "Probe settings");
    settingsButtonEl.innerHTML = ICONS.settings;
    // Capture-phase onClick on document swallows every page click, so this has
    // to stop propagation the same way the toolbar's buttons do.
    settingsButtonEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Content scripts cannot call chrome.runtime.openOptionsPage() — only the
      // service worker can, hence the round trip.
      chrome.runtime.sendMessage({ type: "OPEN_SETTINGS" });
    });
    document.documentElement.appendChild(settingsButtonEl);
  }

  function removeSettingsButton() {
    if (settingsButtonEl) {
      settingsButtonEl.remove();
      settingsButtonEl = null;
    }
  }

  // The gear is viewport-anchored, so it never enters computeChromeLayout() and
  // the placement matrix is unaffected. It can still be sat on, though: three of
  // the six strategies dock the label against the visible top edge, which at
  // top-right is exactly where the gear is. The gear yields — same invariant the
  // placement design already uses, where the interactive box wins and the other
  // gives way. Opacity rather than display:none so its rect stays measurable and
  // the collision can be seen to end.
  function updateSettingsButtonVisibility() {
    if (!settingsButtonEl) return;
    const gear = settingsButtonEl.getBoundingClientRect();
    const hit = (el) => {
      if (!el || el.style.display === "none") return false;
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.left < gear.right &&
        r.right > gear.left &&
        r.top < gear.bottom &&
        r.bottom > gear.top
      );
    };
    // During redline the label and toolbar are visibility:hidden but still laid
    // out, so hit() would report a collision with an invisible box — the gear
    // stays put instead. Editing hides them the same way, and puts the panel
    // in their place: it is the interactive box now, so it is what the gear
    // has to yield to.
    const hushed = redlining || editing;
    settingsButtonEl.classList.toggle(
      "pnt-yielded",
      (!hushed && (hit(labelEl) || hit(toolbarEl))) ||
        (editing && (hit(editPanelEl) || hit(editPopoverEl)))
    );
  }

  // ===== Corner radius =====
  const CORNERS = [
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
  ];

  function readRadii(el) {
    const style = getComputedStyle(el);
    const values = CORNERS.map((c) => style[c]);
    const square = values.every((v) => v.split(" ").every((p) => parseFloat(p) === 0));
    return { values, square };
  }

  // Each corner is written as its own longhand. A single calc() on the shorthand
  // cannot offset a multi-value radius like "20px 4px 20px 4px" — it computes to
  // invalid and the radius silently collapses to square.
  function applyRadii(target, radii, offset) {
    CORNERS.forEach((corner, i) => {
      target.style[corner] = radii.square
        ? `${Math.max(0, GEOMETRY.radiusFallback + offset)}px`
        : radii.values[i]
            .split(" ")
            .map((p) => `max(0px, calc(${p} + ${offset}px))`)
            .join(" ");
    });
  }

  // Corner radii in px for the SVG path. Only the horizontal component is used,
  // so a percentage resolves against the width.
  function radiiInPixels(radii, width) {
    if (radii.square) {
      const r = GEOMETRY.radiusFallback;
      return [r, r, r, r];
    }
    return radii.values.map((v) => {
      const horizontal = v.split(" ")[0];
      const n = parseFloat(horizontal) || 0;
      return horizontal.includes("%") ? (n / 100) * width : n;
    });
  }

  // Rounded-rect path with four independent corners, scaled down if adjacent
  // radii would overlap (the same clamp the CSS box model applies).
  function roundedRectPath(w, h, r) {
    const k = Math.min(
      1,
      w / (r[0] + r[1] || 1),
      w / (r[3] + r[2] || 1),
      h / (r[0] + r[3] || 1),
      h / (r[1] + r[2] || 1)
    );
    const [tl, tr, br, bl] = r.map((v) => Math.max(0, v * k));
    return (
      `M ${tl} 0 H ${w - tr} A ${tr} ${tr} 0 0 1 ${w} ${tr}` +
      ` V ${h - br} A ${br} ${br} 0 0 1 ${w - br} ${h}` +
      ` H ${bl} A ${bl} ${bl} 0 0 1 0 ${h - bl}` +
      ` V ${tl} A ${tl} ${tl} 0 0 1 ${tl} 0 Z`
    );
  }

  // ===== Overlay DOM =====
  function createOverlay() {
    if (overlayContainer) return;

    overlayContainer = document.createElement("div");
    overlayContainer.id = "pnt-overlay-container";

    // The three box-model bands. The 1.x sweep ring and bloom are gone: the
    // selection is the same dashed outline as the hover, heavier and crawling.
    const ids = ["pnt-margin-box", "pnt-padding-box", "pnt-content-box"];
    for (const id of ids) {
      const div = document.createElement("div");
      div.id = id;
      overlayContainer.appendChild(div);
    }

    const ants = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ants.id = "pnt-ants";
    ants.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
    overlayContainer.appendChild(ants);

    // Redline layer. The measurement nodes are grandchildren of the container
    // on purpose: the `> div` rule in content.css would give them the container
    // children's glide wholesale, while renderRedline() needs to decide per
    // frame which nodes glide and which snap. The wrapper itself never moves,
    // so it can be a direct child, and it gates display + stacking as one unit.
    // Pool sizes cover the worst cases: containment needs 4 lines + 4 pills,
    // a diagonal needs 2 of each. Pills are appended last so they paint on top.
    // Hidden means opacity 0, not display:none — a shown node must be able to
    // fade and glide, and a transition cannot cross a display flip.
    redlineEl = document.createElement("div");
    redlineEl.id = "pnt-redline";
    const pool = (className, count, into) => {
      for (let i = 0; i < count; i++) {
        const node = document.createElement("div");
        node.className = className;
        node.style.opacity = "0";
        redlineEl.appendChild(node);
        into.push(node);
      }
      return into;
    };
    redlineHoverEl = pool("pnt-redline-hover", 1, [])[0];
    pool("pnt-redline-line", 4, redlineLineEls);
    pool("pnt-redline-guide-h", 4, redlineGuideEls);
    pool("pnt-redline-pill", 4, redlinePillEls);
    overlayContainer.appendChild(redlineEl);

    // Tether layer, built on the same terms as the redline layer above and for
    // the same reason: a wrapper that never moves, holding nodes whose glide
    // renderTether() decides per frame. Four ticks (one per edge) and two run
    // segments (a single-turn L, or one segment when the two ends line up).
    tetherEl = document.createElement("div");
    tetherEl.id = "pnt-tether";
    const tetherPool = (className, count, into) => {
      for (let i = 0; i < count; i++) {
        const node = document.createElement("div");
        node.className = className;
        node.style.opacity = "0";
        tetherEl.appendChild(node);
        into.push(node);
      }
    };
    // Three segments, not two: the single-turn L covers almost everything, but
    // the two-turn fallback that keeps the right angle needs a third.
    tetherPool("pnt-tether-seg", 3, tetherSegEls);
    tetherPool("pnt-tether-tick", 4, tetherTickEls);
    overlayContainer.appendChild(tetherEl);

    labelEl = document.createElement("div");
    labelEl.id = "pnt-label";
    labelEl.style.display = "none";

    // The tooltip root: one node that names whichever icon-only action is
    // under the pointer or focused, positioned from that button's rect. Its
    // own root rather than a child of the card, so showing it can never move
    // the chrome — see showTip().
    tipEl = document.createElement("div");
    tipEl.id = "pnt-tip";
    tipEl.setAttribute("role", "tooltip");

    document.documentElement.appendChild(overlayContainer);
    document.documentElement.appendChild(labelEl);
    document.documentElement.appendChild(tipEl);
  }

  function removeOverlay() {
    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }
    if (labelEl) {
      labelEl.remove();
      labelEl = null;
    }
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
    // The redline and tether nodes went down with the container; drop the refs
    redlineEl = null;
    redlineHoverEl = null;
    redlineLineEls = [];
    redlineGuideEls = [];
    redlinePillEls = [];
    tetherEl = null;
    tetherTickEls = [];
    tetherSegEls = [];
  }

  // ===== Overlay Positioning =====
  function positionBox(id, top, left, width, height) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.width = Math.max(0, width) + "px";
    el.style.height = Math.max(0, height) + "px";
  }

  // `options.keepContent` re-places the chrome without rebuilding the label's
  // markup — used while tracking the viewport, where rewriting innerHTML every
  // frame would restart the breadcrumb marquee and churn layout for nothing.
  function updateOverlay(el, options) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    const margin = {
      top: parseFloat(style.marginTop) || 0,
      right: parseFloat(style.marginRight) || 0,
      bottom: parseFloat(style.marginBottom) || 0,
      left: parseFloat(style.marginLeft) || 0,
    };
    const padding = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
    const border = {
      top: parseFloat(style.borderTopWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
      bottom: parseFloat(style.borderBottomWidth) || 0,
      left: parseFloat(style.borderLeftWidth) || 0,
    };

    // Margin box
    positionBox(
      "pnt-margin-box",
      rect.top - margin.top,
      rect.left - margin.left,
      rect.width + margin.left + margin.right,
      rect.height + margin.top + margin.bottom
    );

    // Padding box
    positionBox(
      "pnt-padding-box",
      rect.top + border.top,
      rect.left + border.left,
      rect.width - border.left - border.right,
      rect.height - border.top - border.bottom
    );

    // Content box
    positionBox(
      "pnt-content-box",
      rect.top + border.top + padding.top,
      rect.left + border.left + padding.left,
      rect.width - border.left - border.right - padding.left - padding.right,
      rect.height - border.top - border.bottom - padding.top - padding.bottom
    );

    applyRadiiToOverlay(el, rect, border);

    // Label content, then one pass that places both it and the toolbar
    if (!options || !options.keepContent) updateLabel(el, rect);
    layoutChrome(el, options);
  }

  function applyRadiiToOverlay(el, rect, border) {
    const radii = readRadii(el);
    const thickest = Math.max(border.top, border.right, border.bottom, border.left);

    const setRadii = (id, offset) => {
      const node = document.getElementById(id);
      if (node) applyRadii(node, radii, offset);
    };
    setRadii("pnt-margin-box", 0);
    setRadii("pnt-padding-box", -thickest);

    // Marching dashes: the svg starts 2px out so a 2px stroke centred on the
    // element's edge is fully inside it
    const ants = document.getElementById("pnt-ants");
    if (!ants) return;
    const w = rect.width;
    const h = rect.height;
    ants.style.top = rect.top - 2 + "px";
    ants.style.left = rect.left - 2 + "px";
    ants.style.width = w + 4 + "px";
    ants.style.height = h + 4 + "px";
    ants.setAttribute("viewBox", `0 0 ${w + 4} ${h + 4}`);
    const path = ants.querySelector("path");
    path.setAttribute("transform", "translate(2,2)");
    path.setAttribute("d", roundedRectPath(w, h, radiiInPixels(radii, w)));
  }

  // ===== Selection chrome placement =====
  //
  // The label and the toolbar are placed in a single pass so they cannot land
  // on top of each other. Each strategy positions every visible box at once and
  // is accepted only if all of them fit on screen and clear each other, which
  // makes collision impossible by construction rather than by luck.
  //
  // Everything anchors to the element's *visible* rect (element ∩ viewport),
  // never the raw rect — an element taller than the screen has a rect.bottom
  // thousands of pixels below the fold, and anchoring to it throws the chrome
  // clean off the page.
  //
  // test/placement.mjs is the executable spec for this function and the harness
  // it powers runs a 23-case matrix against it. The harness's live sweep
  // reconciles the two; run it after changing either.

  function overlapArea(a, b) {
    const x = Math.max(0, Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top));
    return x * y;
  }

  // `toolbar` is null while merely hovering, and in the layouts that mount
  // the actions inside the label — then the label is placed alone.
  // `label.minH` is how far the label may shrink before it hides: with the
  // actions inside, the readout yields and the actions never do.
  // `opts.straddle` is the On-the-edge rule: the toolbar is a pill riding the
  // element's bottom edge, and the label places itself around it.
  function computeChromeLayout(rect, label, toolbar, vw, vh, opts) {
    const M = GEOMETRY.margin, GAP = GEOMETRY.gap, PAIR = GEOMETRY.pair;

    const T = toolbar
      ? { w: toolbar.w, h: toolbar.h, hidden: false }
      : { w: 0, h: 0, hidden: true };

    // The toolbar is interactive — clipping it breaks the tool — so it is the
    // hard constraint and the label yields: first by shrinking, then by
    // disappearing once not even one line will fit.
    const room = vh - 2 * M - (T.hidden ? 0 : T.h + PAIR);
    const labelH = Math.min(label.h, Math.max(0, room));
    const labelHidden = labelH < Math.max(GEOMETRY.minLabelHeight, label.minH || 0);
    const L = { w: label.w, h: labelHidden ? 0 : labelH, hidden: labelHidden };

    // Whichever boxes are actually shown stack into one unit.
    const stack = labelHidden ? 0 : L.h + PAIR;
    const clusterH =
      (labelHidden ? 0 : L.h) + (T.hidden ? 0 : T.h) + (labelHidden || T.hidden ? 0 : PAIR);

    const vis = {
      top: Math.max(rect.top, 0),
      left: Math.max(rect.left, 0),
      bottom: Math.min(rect.bottom, vh),
      right: Math.min(rect.right, vw),
    };

    const clampLeft = (left, w) => Math.max(M, Math.min(left, vw - w - M));
    const fitsV = (top, h) => top >= M && top + h <= vh - M;
    const mk = (box, top, left) =>
      ({ top, left: clampLeft(left, box.w), w: box.w, h: box.h, hidden: box.hidden });

    // A placement is valid only if every box it puts on screen stays on screen.
    const ok = (lb, tb) =>
      (tb.hidden || fitsV(tb.top, T.h)) && (lb.hidden || fitsV(lb.top, L.h));

    // label on top, toolbar beneath it, moving as one unit
    const cluster = (top, strategy, left) => {
      const at = left === undefined ? vis.left : left;
      const lb = mk(L, top, at);
      const tb = mk(T, top + stack, at);
      return ok(lb, tb) ? { strategy: strategy, label: lb, toolbar: tb } : null;
    };

    const dock = (atTop) => {
      const top = atTop ? M : Math.max(M, vh - M - clusterH);
      return cluster(top, "docked") || {
        strategy: "docked",
        label: mk(L, top, vis.left),
        toolbar: mk(T, top + stack, vis.left),
      };
    };

    // Scrolled entirely out of view — dock to the edge it disappeared behind.
    if (vis.bottom < vis.top || vis.right < vis.left) return dock(rect.bottom < 0);

    // On the edge: the pill's centre line on the element's bottom edge, its
    // left a straddleInset in from the element's left — whenever the whole
    // pill is on screen there. The label then goes above the element, else
    // below the pill, else inside the element's top: the first that fits and
    // clears the pill. When none does, or the edge is off screen, the pill
    // takes the slot the toolbar gets below, so it is never clipped.
    if (opts && opts.straddle && !T.hidden) {
      const half = T.h / 2;
      if (rect.bottom - half >= M && rect.bottom + half <= vh - M) {
        const tb = mk(T, rect.bottom - half, rect.left + GEOMETRY.straddleInset);
        const around = (top, left, strategy) => {
          const lb = mk(L, top, left);
          return ok(lb, tb) && (lb.hidden || overlapArea(lb, tb) === 0)
            ? { strategy: strategy, label: lb, toolbar: tb } : null;
        };
        const r =
          around(vis.top - GAP - L.h, vis.left, "straddle-above") ||
          around(tb.top + T.h + GAP, vis.left, "straddle-below") ||
          around(vis.top + GAP, vis.left + GAP, "straddle-inside");
        if (r) return r;
      }
    }

    // The ordinary case, and the one that reads best: label above, actions below.
    const outsideSplit = () => {
      const lb = mk(L, vis.top - GAP - L.h, vis.left);
      const tb = mk(T, vis.bottom + GAP, vis.left);
      return ok(lb, tb) ? { strategy: "outside-split", label: lb, toolbar: tb } : null;
    };

    // Element is bigger than the viewport: hug its visible top and bottom edges.
    const insideSplit = () => {
      const lb = mk(L, vis.top + GAP, vis.left + GAP);
      const tb = mk(T, vis.bottom - GAP - T.h, vis.left + GAP);
      return ok(lb, tb) && overlapArea(lb, tb) === 0
        ? { strategy: "inside-split", label: lb, toolbar: tb } : null;
    };

    // In order of how little they intrude on the element itself.
    return (
      outsideSplit() ||
      cluster(vis.bottom + GAP, "cluster-below") ||
      cluster(vis.top - GAP - clusterH, "cluster-above") ||
      insideSplit() ||
      cluster(vis.top + GAP, "cluster-inside-top", vis.left + GAP) ||
      dock(false)
    );
  }

  // Widths are locked after layout so the buttons don't shift when a label
  // swaps to "COPIED"; they have to be cleared first or we re-measure the lock.
  function lockButtonWidths() {
    if (!toolbarEl) return;
    const buttons = toolbarEl.querySelectorAll("button");
    for (const button of buttons) button.style.minWidth = "";
    for (const button of buttons) button.style.minWidth = button.offsetWidth + "px";
  }

  // Along the bottom, the card is exactly as wide as its bar: the bar is
  // measured at its natural width and the label locked to it, so the readout
  // clips inside the bar's width rather than the bar stretching to the
  // readout's. Cleared in every other layout, where the readout sets the width.
  function lockCardWidth() {
    if (!labelEl) return;
    labelEl.style.width = "";
    if (chromePrefs.selectionLayout !== "bottom" || !toolbarEl || toolbarEl.parentNode !== labelEl) return;
    const bar = toolbarEl.querySelector(".pnt-bar");
    bar.style.width = "max-content";
    const w = bar.offsetWidth;
    bar.style.width = "";
    // Plus the label's own border, which sits outside the bar (border-box).
    labelEl.style.width = (w + labelEl.offsetWidth - labelEl.clientWidth) + "px";
  }

  // Below the breakpoint the buttons collapse to icons, which changes their
  // natural width — so the locks have to be recomputed when it flips.
  function updateToolbarDensity(vw) {
    if (!toolbarEl) return;
    const narrow = vw < GEOMETRY.narrowToolbar;
    if (toolbarEl.classList.contains("pnt-compact") === narrow) return;
    toolbarEl.classList.toggle("pnt-compact", narrow);
    lockButtonWidths();
    lockCardWidth();
  }

  // `instant` skips the glide on both boxes — for viewport tracking, where
  // animating would smear the chrome across the screen as you scroll.
  // `newToolbar` skips it on the toolbar alone: a toolbar that was just created
  // has no previous position worth animating from, while the label does and
  // should glide from wherever hover left it.
  function layoutChrome(el, options) {
    if (!labelEl || !el) return;

    const instant = !!(options && options.instant);
    const toolbarInstant = instant || !!(options && options.newToolbar);
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    updateToolbarDensity(vw);

    // Measure at natural size. The label has to be shown to be measurable — a
    // pass that hid it must not leave it unmeasurable, or it could never come
    // back when the viewport grows — and a max-height left over from an earlier
    // pass would be mistaken for its real height.
    labelEl.style.display = "";
    labelEl.style.maxHeight = "";
    labelEl.style.overflow = "";
    hideTip(); // it named a button that is about to move

    // With the actions mounted inside the card the solver sees one box, and
    // the readout is what yields: the label may shrink to everything but its
    // body, and no further, so the buttons are never the part that clips.
    const inside = !!toolbarEl && toolbarEl.parentNode === labelEl;
    const body = inside ? labelEl.querySelector(".pnt-label-content") : null;
    const label = {
      w: labelEl.offsetWidth,
      h: labelEl.offsetHeight,
      minH: body ? labelEl.offsetHeight - body.offsetHeight : 0,
    };
    const toolbar = toolbarEl && !inside
      ? { w: toolbarEl.offsetWidth, h: toolbarEl.offsetHeight }
      : null;

    const layout = computeChromeLayout(el.getBoundingClientRect(), label, toolbar, vw, vh, {
      straddle: !!toolbar && chromePrefs.selectionLayout === "edge",
    });

    if (instant) labelEl.classList.add("pnt-no-transition");
    if (toolbarInstant && toolbarEl) toolbarEl.classList.add("pnt-no-transition");

    labelEl.style.display = layout.label.hidden ? "none" : "";
    if (!layout.label.hidden) {
      labelEl.style.top = layout.label.top + "px";
      labelEl.style.left = layout.label.left + "px";
      // Only cap when the label actually had to give up height; the stylesheet
      // clips it in every case, so the glass edge and shadow stay uncut.
      if (layout.label.h < label.h) {
        labelEl.style.maxHeight = layout.label.h + "px";
        labelEl.style.overflow = "hidden";
      }
    }

    if (toolbarEl && !inside) {
      toolbarEl.style.top = layout.toolbar.top + "px";
      toolbarEl.style.left = layout.toolbar.left + "px";
    }

    if (instant || toolbarInstant) {
      void labelEl.offsetWidth; // flush the jump before re-enabling the glide
      labelEl.classList.remove("pnt-no-transition");
      if (toolbarEl) toolbarEl.classList.remove("pnt-no-transition");
    }

    // Last, once both boxes are where they finally sit: hide the gear if either
    // one landed on top of it.
    updateSettingsButtonVisibility();
  }

  function updateLabel(el, rect) {
    if (!labelEl) return;

    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = Array.from(el.classList)
      .filter((c) => !isOurs.name(c))
      .slice(0, 3)
      .map((c) => `.${c}`)
      .join("");
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const style = getComputedStyle(el);

    // Line 1: tag, id, classes, dimensions
    let line1 =
      `<span class="pnt-label-tag">${tag}</span>` +
      (id ? `<span class="pnt-label-id">${id}</span>` : "") +
      (classes ? `<span class="pnt-label-class">${classes}</span>` : "") +
      `<span class="pnt-label-size">${w} x ${h}</span>`;

    const elHasText = hasDirectText(el);

    // Text preview line: first ~40 chars of direct text content
    let lineT = "";
    if (elHasText) {
      const text = getDirectText(el);
      const preview = text.length > 40 ? text.slice(0, 40) + "\u2026" : text;
      const escaped = preview.replace(/[&<>"']/g, (ch) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
      ));
      lineT = `<div class="pnt-label-line pnt-line-text"><span class="pnt-label-text">"${escaped}"</span></div>`;
    }

    // Line 2: key computed properties
    const props = [];
    const display = style.display;
    const position = style.position;
    if (display && display !== "block") props.push(display);
    if (position && position !== "static") props.push(`pos:${position}`);
    // Font props only when element has direct text content
    if (elHasText) {
      if (style.fontSize) props.push(style.fontSize);
      if (style.fontWeight && style.fontWeight !== "400" && style.fontWeight !== "normal") {
        props.push(`w:${style.fontWeight}`);
      }
    }
    // Accessibility hints
    const role = el.getAttribute("role");
    if (role) props.push(`role="${role}"`);
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) props.push(`aria="${ariaLabel.slice(0, 20)}"`);
    // Children count for containers
    const childCount = el.children.length;
    if (childCount > 0) props.push(`${childCount} child${childCount > 1 ? "ren" : ""}`);

    let line2 = "";
    if (props.length > 0) {
      line2 = `<div class="pnt-label-line pnt-line-meta"><span class="pnt-label-prop">${props.join('<span class="pnt-label-sep"> · </span>')}</span></div>`;
    }

    // Visual line: background, text color, border, radius, shadow, opacity, cursor, transform, z-index
    const visuals = [];

    // Background color
    const bg = style.backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      visuals.push(`bg:${colorSwatch(bg)}${formatColor(bg)}`);
    }

    // Text color (only when element has direct text)
    if (elHasText && style.color) {
      visuals.push(`color:${colorSwatch(style.color)}${formatColor(style.color)}`);
    }

    // Border (stroke)
    const bw = {
      top: parseFloat(style.borderTopWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
      bottom: parseFloat(style.borderBottomWidth) || 0,
      left: parseFloat(style.borderLeftWidth) || 0,
    };
    const anyBorderWidth = bw.top || bw.right || bw.bottom || bw.left;
    if (anyBorderWidth && style.borderTopStyle !== "none") {
      const allWidthsEqual = bw.top === bw.right && bw.right === bw.bottom && bw.bottom === bw.left;
      const allStylesEqual =
        style.borderTopStyle === style.borderRightStyle &&
        style.borderRightStyle === style.borderBottomStyle &&
        style.borderBottomStyle === style.borderLeftStyle;
      const allColorsEqual =
        style.borderTopColor === style.borderRightColor &&
        style.borderRightColor === style.borderBottomColor &&
        style.borderBottomColor === style.borderLeftColor;
      if (allWidthsEqual && allStylesEqual && allColorsEqual) {
        visuals.push(
          `border:${bw.top}px ${style.borderTopStyle} ${colorSwatch(style.borderTopColor)}${formatColor(style.borderTopColor)}`
        );
      } else {
        visuals.push(`border:${bw.top}/${bw.right}/${bw.bottom}/${bw.left}px`);
      }
    }

    // Border radius
    const radii = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ];
    if (radii.some((v) => v && v !== "0px")) {
      const allSame = radii.every((v) => v === radii[0]);
      visuals.push(allSame ? `radius:${radii[0]}` : `radius:${radii.join(" ")}`);
    }

    // Box shadow
    if (style.boxShadow && style.boxShadow !== "none") {
      visuals.push(`shadow:${formatShadow(style.boxShadow)}`);
    }

    // Opacity (when < 1)
    const opacity = parseFloat(style.opacity);
    if (!Number.isNaN(opacity) && opacity < 1) {
      visuals.push(`opacity:${opacity}`);
    }

    // Cursor (read without probe-mode override)
    const cursor = getRealCursor(el);
    if (cursor && cursor !== "auto" && cursor !== "default") {
      visuals.push(`cursor:${cursor}`);
    }

    // Transform (when present)
    if (style.transform && style.transform !== "none") {
      visuals.push(`transform:${style.transform}`);
    }

    // Z-index (when explicitly set)
    if (style.zIndex && style.zIndex !== "auto") {
      visuals.push(`z:${style.zIndex}`);
    }

    let lineV = "";
    if (visuals.length > 0) {
      lineV = `<div class="pnt-label-line pnt-line-visual"><span class="pnt-label-prop">${visuals.join('<span class="pnt-label-sep"> · </span>')}</span></div>`;
    }

    // Line 3: breadcrumb path (up to 4 ancestors)
    const crumbs = [];
    let ancestor = el.parentElement;
    while (ancestor && ancestor !== document.documentElement && crumbs.length < 4) {
      const aTag = ancestor.tagName.toLowerCase();
      const aId = ancestor.id ? `#${ancestor.id}` : "";
      const aClass = Array.from(ancestor.classList)
        .filter((c) => !isOurs.name(c))
        .slice(0, 1)
        .map((c) => `.${c}`)
        .join("");
      crumbs.unshift(aTag + aId + aClass);
      if (ancestor.id) break; // ID is unique enough, stop
      ancestor = ancestor.parentElement;
    }
    // The keyboard hints travel with the layout, as prototyped: the strip
    // carries its own (see showToolbar), the bar's ride the breadcrumb row,
    // and the pill's and the spine's are a caption under the readout — which
    // is also where the bar's go when there is no breadcrumb to ride.
    const selected = el === selectedElement;
    const layout = chromePrefs.selectionLayout;
    const hintsInCrumb = selected && layout === "bottom" && crumbs.length > 0;
    const hintsInCaption = selected && (layout === "edge" || layout === "beside" ||
      (layout === "bottom" && crumbs.length === 0));

    let line3 = "";
    if (crumbs.length > 0) {
      const path = crumbs.join('<span class="pnt-label-sep"> › </span>');
      line3 = `<div class="pnt-label-line pnt-line-breadcrumb"><span class="pnt-label-marquee"><span class="pnt-label-breadcrumb pnt-marquee-inner">${path}<span class="pnt-label-sep">&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;</span>${path}</span></span>${hintsInCrumb ? `<span class="pnt-hints">${HINTS_HTML}</span>` : ""}</div>`;
    }

    // Three parts — head, body, caption — rather than one wrapper, so the
    // toolbar can mount between them (the strip sits under the identity) and
    // survive every rewrite: a Select Parent hop rewrites the readout while
    // the buttons stay exactly where they are. The nodes the layout pass
    // measures are created once and kept.
    const part = (cls, after) => {
      let node = labelEl.querySelector(`:scope > .${cls}`);
      if (!node) {
        node = document.createElement("div");
        node.className = cls;
        if (after) after.after(node); else labelEl.appendChild(node);
      }
      return node;
    };
    const head = part("pnt-label-head");
    const body = part("pnt-label-content", head.nextElementSibling?.id === "pnt-toolbar" ? head.nextElementSibling : head);
    head.innerHTML = `<div class="pnt-label-line pnt-line-identity">${line1}</div>`;
    body.innerHTML = lineT + line2 + lineV + line3;

    const caption = labelEl.querySelector(":scope > .pnt-label-hints");
    if (hintsInCaption) {
      (caption || part("pnt-label-hints", body)).innerHTML = HINTS_HTML;
    } else if (caption) {
      caption.remove();
    }

    // Visible so it can be measured; layoutChrome does the placing.
    labelEl.style.display = "";
  }

  // ===== Redline =====
  // Held-Option spacing measurements between the selected element and the
  // element under the cursor, Figma-style: solid accent lines across each gap
  // with a px readout, dashed guides extending an edge when the two boxes
  // don't align. The label and toolbar hush while the key is down (CSS, via
  // .pnt-redlining on <html>) so the page around the selection stays readable.

  // Pure, like computeChromeLayout() and for the same reason — test/redline.mjs
  // mirrors it and sweeps it with no DOM. Rects are {top,left,width,height}
  // (a DOMRect works); output is a paint-ordered list of primitives in
  // viewport coordinates that renderRedline() writes into pooled nodes:
  //   {kind:"line",  x, y, w, h, value}  solid segment; w or h is 0
  //   {kind:"guide", x, y, w, h}         dashed segment along a hov edge
  //   {kind:"pill",  x, y, value}        px readout; (x,y) is the pill CENTER
  // `value` is the raw fractional px distance — the renderer formats it.
  // `opts` is how user preferences enter without breaking purity:
  //   pillOffset — perpendicular pill offset (0 = the pill rides its line)
  //   guides     — emit dashed extension guides on diagonal measurements
  //   zeroPills  — emit a pill for flush (sub-half-pixel) edges
  function computeRedline(sel, hov, vw, vh, opts) {
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const s = { l: sel.left, t: sel.top, r: sel.left + sel.width, b: sel.top + sel.height };
    const h = { l: hov.left, t: hov.top, r: hov.left + hov.width, b: hov.top + hov.height };

    // Per-axis relation between the two intervals: a gap carries the span
    // between the facing edges plus which hov edge faces it; an overlap
    // carries the shared region.
    const relate = (sLo, sHi, hLo, hHi) => {
      if (hLo >= sHi) return { gap: true, lo: sHi, hi: hLo, hovEdge: hLo };
      if (sLo >= hHi) return { gap: true, lo: hHi, hi: sLo, hovEdge: hHi };
      return { gap: false, lo: Math.max(sLo, hLo), hi: Math.min(sHi, hHi) };
    };
    const x = relate(s.l, s.r, h.l, h.r);
    const y = relate(s.t, s.b, h.t, h.b);

    const lines = [];
    const guides = [];
    const pills = [];

    // One measurement along `axis` ("x" = a horizontal segment) from lo to hi
    // at the given cross coordinate. A flush edge (distance rounding to zero —
    // nothing to draw a line across) keeps its pill unless zeroPills is off.
    // Values stay fractional; the renderer's formatter decides the readout.
    // Returns 0 for flush measurements so the guide check can gate on it.
    const measure = (axis, lo, hi, cross) => {
      const value = hi - lo;
      const flush = Math.round(value) === 0;
      const mid = (lo + hi) / 2;
      if (!flush) {
        lines.push(axis === "x"
          ? { kind: "line", x: lo, y: cross, w: value, h: 0, value }
          : { kind: "line", x: cross, y: lo, w: 0, h: value, value });
      }
      // Pill hangs perpendicular to its line (below / to the right), clamped
      // into the viewport so a measurement to an offscreen box stays readable.
      if (!flush || opts.zeroPills) {
        const m = GEOMETRY.redlinePillMargin;
        pills.push({
          kind: "pill",
          x: clamp(axis === "x" ? mid : cross + opts.pillOffset, m, vw - m),
          y: clamp(axis === "x" ? cross + opts.pillOffset : mid, m, vh - m),
          value,
        });
      }
      return flush ? 0 : value;
    };

    if (x.gap || y.gap) {
      // Separated (one axis gapped) or diagonal (both). One measurement per
      // gapped axis, at the selected element's center — clamped into the shared
      // region when the cross axis overlaps, which lands both endpoints on real
      // edges. When it doesn't (diagonal), the line floats at sel's center and
      // a dashed guide extends hov's facing edge out to meet it.
      if (x.gap) {
        const cy = y.gap ? (s.t + s.b) / 2 : clamp((s.t + s.b) / 2, y.lo, y.hi);
        const value = measure("x", x.lo, x.hi, cy);
        if (y.gap && opts.guides && value > 0) {
          const corner = cy < h.t ? h.t : h.b;
          const past = cy + (cy < h.t ? -1 : 1) * GEOMETRY.redlineGuideOvershoot;
          guides.push({
            kind: "guide",
            x: x.hovEdge,
            y: Math.min(corner, past),
            w: 0,
            h: Math.abs(corner - past),
          });
        }
      }
      if (y.gap) {
        const cx = x.gap ? (s.l + s.r) / 2 : clamp((s.l + s.r) / 2, x.lo, x.hi);
        const value = measure("y", y.lo, y.hi, cx);
        if (x.gap && opts.guides && value > 0) {
          const corner = cx < h.l ? h.l : h.r;
          const past = cx + (cx < h.l ? -1 : 1) * GEOMETRY.redlineGuideOvershoot;
          guides.push({
            kind: "guide",
            x: Math.min(corner, past),
            y: y.hovEdge,
            w: Math.abs(corner - past),
            h: 0,
          });
        }
      }
    } else {
      // Both axes overlap. Containment and partial overlap take the same rule:
      // per axis, measure the two same-side edge pairs. For a contained box
      // that degenerates to exactly the four insets; never any guides, because
      // the clamped cross coordinate always lies inside both spans.
      const cy = clamp((s.t + s.b) / 2, y.lo, y.hi);
      const cx = clamp((s.l + s.r) / 2, x.lo, x.hi);
      measure("x", Math.min(s.l, h.l), Math.max(s.l, h.l), cy);
      measure("x", Math.min(s.r, h.r), Math.max(s.r, h.r), cy);
      measure("y", Math.min(s.t, h.t), Math.max(s.t, h.t), cx);
      measure("y", Math.min(s.b, h.b), Math.max(s.b, h.b), cx);
    }

    return [...lines, ...guides, ...pills];
  }

  function clearRedline() {
    if (redlineHoverEl) redlineHoverEl.style.opacity = "0";
    for (const arr of [redlineLineEls, redlineGuideEls, redlinePillEls]) {
      for (const node of arr) node.style.opacity = "0";
    }
  }

  // Formats a solver distance for the pill readout — the one place px leaves
  // the geometry. remBase is the page's root font-size, read once per frame.
  // Mirrored in settings/settings.js for the preview rail; change both.
  function formatRedlineValue(px, unit, precision, remBase) {
    if (unit === "rem") {
      return (px / remBase).toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + "rem";
    }
    if (precision === "tenths") {
      return (Math.round(px * 10) / 10).toFixed(1).replace(/\.0$/, "");
    }
    return String(Math.round(px));
  }

  // One frame of redline paint. Nodes glide between hover targets on the same
  // curve as the selection overlay; three cases snap instead of gliding:
  //   - options.instant (scroll/resize): measurements must track the page
  //     rigidly, exactly like updateOverlay's instant mode
  //   - a node fading back in: it would otherwise fly in from its stale spot
  //   - a guide changing orientation: -h to -v is a new shape, not a move
  // Snapped nodes take .pnt-no-transition, every write lands, one flush
  // commits the jumps, the class lifts, and opacity fades the rest in place.
  function renderRedline(options) {
    if (!redlining || !selectedElement || !redlineEl) return;
    const hov = redlineTarget;
    // Hovering the selection itself measures nothing; the chrome stays hushed
    // (the key is still down) but every measurement node goes dark.
    if (!hov || hov === selectedElement || !hov.isConnected) {
      clearRedline();
      return;
    }

    const instant = !!(options && options.instant);
    const selRect = selectedElement.getBoundingClientRect();
    const hovRect = hov.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const prims = computeRedline(selRect, hovRect, vw, vh, {
      pillOffset: redlinePrefs.redlinePillPlacement === "online" ? 0 : GEOMETRY.redlinePillOffset,
      guides: redlinePrefs.redlineGuides === "on",
      zeroPills: redlinePrefs.redlineZeroPills === "on",
    });
    const remBase = redlinePrefs.redlineUnit === "rem"
      ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      : 16;

    const used = new Set();
    const snapped = [];
    // Rounded so 1px strokes land on device pixels instead of straddling two.
    // Pills pass w = null: they size to their text, only their center moves.
    const place = (node, x, y, w, h, reshape) => {
      used.add(node);
      if (instant || reshape || node.style.opacity !== "1") {
        node.classList.add("pnt-no-transition");
        snapped.push(node);
      }
      node.style.left = Math.round(x) + "px";
      node.style.top = Math.round(y) + "px";
      if (w !== null) {
        node.style.width = Math.max(0, Math.round(w)) + "px";
        node.style.height = Math.max(0, Math.round(h)) + "px";
      }
    };

    // The hover box carries the hovered element's own corner radii, exactly as
    // the selection overlay does (square elements share the same px fallback),
    // and morphs between them via the border-radius transition.
    applyRadii(redlineHoverEl, readRadii(hov), 0);
    place(redlineHoverEl, hovRect.left, hovRect.top, hovRect.width, hovRect.height, false);

    let li = 0;
    let gi = 0;
    let pi = 0;
    for (const p of prims) {
      if (p.kind === "line" && li < redlineLineEls.length) {
        // Zero-thickness axis renders as a 1px stroke
        place(redlineLineEls[li++], p.x, p.y, Math.max(p.w, 1), Math.max(p.h, 1), false);
      } else if (p.kind === "guide" && gi < redlineGuideEls.length) {
        const node = redlineGuideEls[gi++];
        // Horizontal guides dash via border-top, vertical via border-left.
        // className must land before place() so it can't wipe the snap class.
        const cls = p.h === 0 ? "pnt-redline-guide-h" : "pnt-redline-guide-v";
        const reshape = !node.classList.contains(cls);
        node.className = cls;
        place(node, p.x, p.y, p.w, p.h, reshape);
      } else if (p.kind === "pill" && pi < redlinePillEls.length) {
        const node = redlinePillEls[pi++];
        node.textContent = formatRedlineValue(
          p.value, redlinePrefs.redlineUnit, redlinePrefs.redlinePrecision, remBase
        );
        place(node, p.x, p.y, null, null, false);
      }
    }

    if (snapped.length) {
      void redlineEl.offsetWidth; // flush the jumps before re-enabling the glide
      for (const node of snapped) node.classList.remove("pnt-no-transition");
    }
    for (const node of used) node.style.opacity = "1";
    for (const arr of [redlineLineEls, redlineGuideEls, redlinePillEls]) {
      for (const node of arr) {
        if (!used.has(node)) node.style.opacity = "0";
      }
    }
  }

  function scheduleRedline() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (redlining && probeActive) renderRedline();
    });
  }

  function startRedline() {
    if (redlining || !probeActive || !selectedElement) return;
    redlining = true;
    // The class must land before the target resolves: it turns the label and
    // toolbar visibility:hidden, which drops them out of elementFromPoint, so
    // the page underneath them becomes measurable immediately.
    document.documentElement.classList.add("pnt-redlining");
    applyRedlineQuiet();
    redlineTarget = lastMouseX < 0
      ? null
      : getTargetElement({ clientX: lastMouseX, clientY: lastMouseY }, null);
    updateSettingsButtonVisibility();
    scheduleRedline();
  }

  function stopRedline() {
    if (!redlining) return;
    redlining = false;
    redlineTarget = null;
    document.documentElement.classList.remove("pnt-redlining");
    applyRedlineQuiet();
    clearRedline();
    // Label and toolbar reappear where layoutChrome kept them all along; the
    // gear re-checks its collision against the now-visible chrome.
    updateSettingsButtonVisibility();
  }

  // ===== Tether =====
  // Edit Mode's association chrome: what says "this panel edits that element"
  // once the selection ring has been taken away.
  //
  // The ring had to go. It is drawn 2px outside the element, and the panel
  // writes border-width, border-color, border-radius and box-shadow — so the
  // one piece of chrome guaranteed to be on screen sat exactly on top of the
  // four things being judged. You cannot read a 2px stroke through an accent
  // stroke. "Which element" is already settled by the time the panel is open;
  // "what does it look like now" is the open question, and the ring was
  // answering the wrong one.
  //
  // What replaces it works only in the ring of space OUTSIDE the element:
  //
  //   · four ticks, one at each edge's midpoint, sitting tetherGap out. The
  //     midpoint is the point on an edge furthest from any corner, which is
  //     where radius work needs the room. Four points imply the rectangle
  //     without tracing it, so the extent survives without a box.
  //   · one dashed run from the panel to the tick on the facing edge, turning
  //     once. Dashed because that is Redline's guide vocabulary and this is the
  //     same kind of statement; solid ticks against a dashed run also say which
  //     end is the subject and which is the reference.
  //
  // Chosen from twelve alternatives in test/edit-association-prototypes.html —
  // a synthesis of 02 (elbow tether) and 07 (edge ticks), which turn out to be
  // one idea: the run's terminal IS a tick.
  //
  // computeTether is pure, like computeChromeLayout and computeRedline, and is
  // transcribed into test/tether.mjs. Viewport coordinates in, paint rects out,
  // no DOM.

  // Which edge of `r` faces (tx, ty), and the outward normal of that edge.
  // Weighted by the rect's aspect so a wide rect prefers its long edges, then
  // slid along the edge toward the target: pinning to the midpoint makes a tall
  // panel reach out from far below a short element, which reads as two
  // unrelated things joined by a detour.
  function tetherSide(r, tx, ty, inset) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const slide = (lo, len, v) => {
      const i = Math.min(inset, Math.max(0, len / 2 - 1));
      return Math.max(lo + i, Math.min(lo + len - i, v));
    };
    if (Math.abs(tx - cx) * r.h >= Math.abs(ty - cy) * r.w) {
      const y = slide(r.y, r.h, ty);
      return tx >= cx
        ? { x: r.x + r.w, y, nx: 1, ny: 0 }
        : { x: r.x, y, nx: -1, ny: 0 };
    }
    const x = slide(r.x, r.w, tx);
    return ty >= cy
      ? { x, y: r.y + r.h, nx: 0, ny: 1 }
      : { x, y: r.y, nx: 0, ny: -1 };
  }

  // The tick the run lands on: the midpoint of whichever edge of the clearance
  // box faces (ax, ay), exactly.
  //
  // Not tetherSide(). Its slide along the edge is right for the panel end,
  // where the anchor should track the far end of the run, and wrong here,
  // where the anchor IS a tick's centre — and its inset arithmetic leaves the
  // result up to a pixel off the true midpoint on a short edge, which on a
  // 16px tick is visibly not the middle.
  function tetherFacingTick(box, ax, ay) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (Math.abs(ax - cx) * box.h >= Math.abs(ay - cy) * box.w) {
      return ax >= cx
        ? { x: box.x + box.w, y: cy, nx: 1, ny: 0 }
        : { x: box.x, y: cy, nx: -1, ny: 0 };
    }
    return ay >= cy
      ? { x: cx, y: box.y + box.h, nx: 0, ny: 1 }
      : { x: cx, y: box.y, nx: 0, ny: -1 };
  }

  // Does the axis-aligned segment a→b touch `box`? Segments are strokes, not
  // areas, so this is a plain interval overlap on both axes.
  function tetherSegHits(a, b, box) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return x1 > box.x && x0 < box.x + box.w && y1 > box.y && y0 < box.y + box.h;
  }

  // An L from a to b turning at `corner`, as up to two axis-aligned rects.
  // Collinear runs collapse to one segment rather than emitting a zero-length
  // stub that would render as a stray dot.
  function tetherLeg(a, b, corner) {
    const segs = [];
    const push = (p, q) => {
      const w = Math.abs(q.x - p.x);
      const h = Math.abs(q.y - p.y);
      if (w < 0.5 && h < 0.5) return;
      segs.push({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w, h });
    };
    push(a, corner);
    push(corner, b);
    return segs;
  }

  // rect: the element. panel: the edit panel. Both viewport-relative.
  function computeTether(rect, panel, vw, vh, opts) {
    const o = opts || {};
    const gap = o.gap !== undefined ? o.gap : GEOMETRY.tetherGap;
    const len = o.tick !== undefined ? o.tick : GEOMETRY.tetherTick;
    const th = o.thick !== undefined ? o.thick : GEOMETRY.tetherThick;

    // The box nothing may enter: the element plus its clearance.
    const box = {
      x: rect.left - gap,
      y: rect.top - gap,
      w: rect.width + gap * 2,
      h: rect.height + gap * 2,
    };
    const bcx = box.x + box.w / 2;
    const bcy = box.y + box.h / 2;

    // Ticks are centred on each edge midpoint, lying ALONG the edge. A tick
    // that stuck out perpendicular would reach back toward the element as the
    // element grew; lying flat, it can only ever be tangent to the clearance.
    const half = len / 2;
    const ht = th / 2;
    const ticks = [
      { x: bcx - half, y: box.y - ht, w: len, h: th },
      { x: bcx - half, y: box.y + box.h - ht, w: len, h: th },
      { x: box.x - ht, y: bcy - half, w: th, h: len },
      { x: box.x + box.w - ht, y: bcy - half, w: th, h: len },
    ];

    const result = { box, ticks, segs: [] };
    if (!panel) return result;

    // A run bridges distance. When the panel overlaps the element's clearance
    // there is no distance to bridge, and any run would have to start inside
    // the overlap and cross what it is pointing at. The ticks say it instead.
    // This is common rather than exotic: placeEditPanel() anchors the panel to
    // the element, so a tall panel beside a short element starts out on top of
    // it, and only a drag separates them.
    if (panel.x < box.x + box.w && panel.x + panel.w > box.x &&
        panel.y < box.y + box.h && panel.y + panel.h > box.y) return result;

    // An attached panel needs no run: the tick it sits against is the
    // association (CONTEXT.md, Tether). Attached is geometric — the panel abuts
    // one edge of the clearance box, within a stub of it along that edge's
    // normal, overlapping the edge's span — so it holds for an element wider
    // than the panel's reach, where any centre-facing heuristic would pick a
    // side that faces nothing. Mirrored in test/tether.mjs — change both.
    const near = GEOMETRY.tetherStub + th;
    const spanX = panel.x < box.x + box.w && panel.x + panel.w > box.x;
    const spanY = panel.y < box.y + box.h && panel.y + panel.h > box.y;
    const gapR = panel.x - (box.x + box.w);
    const gapL = box.x - (panel.x + panel.w);
    const gapB = panel.y - (box.y + box.h);
    const gapT = box.y - (panel.y + panel.h);
    const abuts =
      (spanY && ((gapR >= 0 && gapR <= near) || (gapL >= 0 && gapL <= near))) ||
      (spanX && ((gapB >= 0 && gapB <= near) || (gapT >= 0 && gapT <= near)));
    if (abuts) return result;

    const a = tetherSide(panel, bcx, bcy, GEOMETRY.tetherStub);
    // The far end is a tick's centre, exactly — the run has to land on the
    // middle of the tick, not near it.
    const s = tetherFacingTick(box, a.x, a.y);
    const b = { x: s.x, y: s.y };

    // The run has to arrive PERPENDICULAR to the tick and stop at its middle,
    // so the junction reads as a T. A tick lies along its edge, so a final leg
    // parallel to it would lie on top of the tick's near half, swallow it, and
    // come out looking like it started at the tick's end — the endpoint would
    // still be the centre, and it would still look wrong.
    //
    // Perpendicular means the last leg runs along the tick's normal, so the
    // turn goes on the OTHER axis from the normal: a horizontal normal (the
    // left and right ticks, which are vertical bars) wants a horizontal final
    // leg, so the corner takes the panel's x and the tick's y.
    //
    // This is clear of the element for the same reason the ticks are: `s` is
    // the edge of the clearance box facing `a`, so `a` is already on that
    // edge's outward side, and the corner inherits it. tetherSegHits stays as
    // the proof rather than the argument.
    const perp = s.nx !== 0 ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
    if (!tetherSegHits(a, perp, box) && !tetherSegHits(perp, b, box)) {
      result.segs = tetherLeg(a, b, perp);
      return result;
    }

    // Where one turn cannot do it, take two rather than give up the right
    // angle — pushing the turn out onto the tick's own normal ray guarantees
    // the last leg approaches along that ray. A parallel arrival is never the
    // fallback; that is the thing being removed.
    const out = {
      x: b.x + s.nx * GEOMETRY.tetherStub,
      y: b.y + s.ny * GEOMETRY.tetherStub,
    };
    const elbow = s.nx !== 0 ? { x: out.x, y: a.y } : { x: a.x, y: out.y };
    const legs = [[a, elbow], [elbow, out], [out, b]];
    if (!legs.some(([p, q]) => tetherSegHits(p, q, box))) {
      result.segs = [...tetherLeg(a, out, elbow), ...tetherLeg(out, b, out)];
    }
    return result;
  }

  // Where an attached panel goes: flush against the element's facing edge, a
  // tick's clearance plus tetherAttach out, top-aligned with the element and
  // pulled inside the viewport. Right, then left, then below, then above; null
  // when no side has room, and the caller floats it instead. Pure, like
  // computeTether, and mirrored in test/tether.mjs — change both.
  function computeEditPanelPlacement(rect, panel, vw, vh) {
    const M = GEOMETRY.margin;
    const off = GEOMETRY.tetherGap + GEOMETRY.tetherThick + GEOMETRY.tetherAttach;
    const clampTop = (t) => Math.max(M, Math.min(t, vh - panel.h - M));
    const clampLeft = (l) => Math.max(M, Math.min(l, vw - panel.w - M));
    const tall = panel.h > vh - 2 * M;
    // A side is usable only when the whole panel lands inside the viewport
    // margins: an element hanging off one edge must not drag the panel off
    // with it. The sweep in test/tether.mjs found the case.
    const right = { side: "right", top: clampTop(rect.top), left: rect.left + rect.width + off };
    if (!tall && right.left >= M && right.left + panel.w <= vw - M) return right;
    const left = { side: "left", top: clampTop(rect.top), left: rect.left - off - panel.w };
    if (!tall && left.left >= M && left.left + panel.w <= vw - M) return left;
    const below = { side: "bottom", top: rect.top + rect.height + off, left: clampLeft(rect.left) };
    if (below.top >= M && below.top + panel.h <= vh - M) return below;
    const above = { side: "top", top: rect.top - off - panel.h, left: clampLeft(rect.left) };
    if (above.top >= M && above.top + panel.h <= vh - M) return above;
    return null;
  }

  // Paint it. The pooling, the per-node snap-vs-glide decision, the `used` Set
  // and the single reflow flush are renderRedline()'s, for the same reasons.
  function renderTether(options) {
    if (!editing || !selectedElement || !tetherEl) return;
    if (!selectedElement.isConnected) {
      clearTether();
      return;
    }
    // An attached panel goes where the element goes — a scroll, a reflow, a
    // padding write that changed its size. Re-placed before the tether is
    // measured, so the ticks and the panel move as one.
    if (editPanelEl && editPanelAttached && !editPanelDragged) placeEditPanel();

    const instant = !!(options && options.instant);
    const rect = selectedElement.getBoundingClientRect();
    const panel = editPanelEl && editPanelPos
      ? { x: editPanelPos.left, y: editPanelPos.top, w: editPanelEl.offsetWidth, h: editPanelEl.offsetHeight }
      : null;

    const layout = computeTether(
      rect, panel,
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
      { tick: tetherLoud ? GEOMETRY.tetherTickLoud : GEOMETRY.tetherTick }
    );

    const used = new Set();
    const snapped = [];
    const place = (node, r) => {
      used.add(node);
      if (instant || node.style.opacity !== "1") {
        node.classList.add("pnt-no-transition");
        snapped.push(node);
      }
      node.style.left = Math.round(r.x) + "px";
      node.style.top = Math.round(r.y) + "px";
      node.style.width = Math.max(0, Math.round(r.w)) + "px";
      node.style.height = Math.max(0, Math.round(r.h)) + "px";
    };

    layout.ticks.forEach((t, i) => {
      if (i < tetherTickEls.length) place(tetherTickEls[i], t);
    });
    layout.segs.forEach((s, i) => {
      if (i >= tetherSegEls.length) return;
      const node = tetherSegEls[i];
      // Horizontal runs dash via border-top, vertical via border-left, exactly
      // as the redline guides do. The class has to land before place() so it
      // cannot wipe the snap class.
      const cls = s.h === 0 ? "pnt-tether-seg pnt-tether-seg-h" : "pnt-tether-seg pnt-tether-seg-v";
      if (node.className !== cls) {
        node.className = cls;
        node.classList.add("pnt-no-transition");
        if (!snapped.includes(node)) snapped.push(node);
      }
      place(node, s);
    });

    if (snapped.length) {
      void tetherEl.offsetWidth; // flush the jumps before re-enabling the glide
      for (const node of snapped) node.classList.remove("pnt-no-transition");
    }
    for (const node of used) node.style.opacity = "1";
    for (const arr of [tetherTickEls, tetherSegEls]) {
      for (const node of arr) {
        if (!used.has(node)) node.style.opacity = "0";
      }
    }
  }

  function clearTether() {
    for (const arr of [tetherTickEls, tetherSegEls]) {
      for (const node of arr) node.style.opacity = "0";
    }
  }

  // Quiet by default, amplified while a control is live: a row under the
  // pointer, an open gesture, or the beat just after a value lands. The ticks
  // lengthen and the run brightens; nothing moves closer to the element.
  function setTetherLoud(on) {
    if (tetherLoud === on) return;
    tetherLoud = on;
    document.documentElement.classList.toggle("pnt-tether-loud", on);
    renderTether();
  }

  // A committed value goes loud for a beat and settles, so a change you made
  // without touching the panel (a token step, an undo) still announces itself.
  function bumpTether() {
    clearTimeout(tetherLoudTimer);
    setTetherLoud(true);
    tetherLoudTimer = setTimeout(() => {
      if (!editGesture && !(editPanelEl && editPanelEl.querySelector(".pnt-edit-row:hover"))) {
        setTetherLoud(false);
      }
    }, 700);
  }

  // ===== Edit Tokens =====
  // Reverse-lookup: given an element and a property, which design token is the
  // value sitting on — a utility class (text-lg, p-4) or a custom property
  // (var(--title-sm))? Knowing that turns a scrub into a step along the page's
  // own scale, and lets the delta block name the token instead of a pixel
  // count, which is what the source actually contains.
  //
  // The rule throughout: only claim a token when its resolved value equals the
  // computed value. A wrong claim would send Claude Code editing a token that
  // isn't there, so no-match reports raw px and the panel falls back to a plain
  // scrub. The pure half is transcribed into test/edit-tokens.mjs — change it
  // there and change it here.

  // "16px" → 16. rem/em resolve against the roots the caller measured. Anything
  // whose value depends on layout (%, calc, nested var, auto) is null: it cannot
  // be compared against a computed pixel value, so it never becomes a token.
  function parseCssLength(value, remBase, emBase) {
    if (typeof value !== "string") return null;
    const s = value.trim().toLowerCase();
    if (s === "0") return 0;
    const m = s.match(/^(-?[\d.]+)(px|rem|em)$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    if (m[2] === "px") return n;
    if (m[2] === "rem") return typeof remBase === "number" ? n * remBase : null;
    return typeof emBase === "number" ? n * emBase : null;
  }

  // [id, class, type] counts, per CSS Selectors 4 §17. Needed because the
  // element's value comes from whichever rule wins, and only that rule's text
  // can tell us whether a var() is involved.
  function computeSpecificity(selector) {
    if (typeof selector !== "string") return [0, 0, 0];

    // Functional pseudo-classes first: their arguments count, but by their own
    // rules — :where() contributes nothing, :is()/:not()/:has() contribute
    // their most specific argument.
    let s = selector;
    let carried = [0, 0, 0];
    const fn = /:(where|is|not|has|matches|any)\(/gi;
    let guard = 0;
    for (;;) {
      fn.lastIndex = 0;
      const m = fn.exec(s);
      if (!m || guard++ > 32) break;
      // Walk to the matching close paren so nested functions survive.
      let depth = 1, i = m.index + m[0].length;
      for (; i < s.length && depth > 0; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") depth--;
      }
      const inner = s.slice(m.index + m[0].length, i - 1);
      if (m[1].toLowerCase() !== "where") {
        for (const branch of inner.split(",")) {
          const b = computeSpecificity(branch);
          if (b[0] > carried[0] ||
              (b[0] === carried[0] && b[1] > carried[1]) ||
              (b[0] === carried[0] && b[1] === carried[1] && b[2] > carried[2])) {
            carried = b;
          }
        }
      }
      s = s.slice(0, m.index) + " " + s.slice(i);
    }

    // Attribute values can contain anything, including "#" and "."; blank them
    // before counting, keeping the brackets so the selector still counts as one.
    s = s.replace(/\[[^\]]*\]/g, "[]");
    // Pseudo-elements count as type selectors and must not be seen as classes.
    const pseudoElements = (s.match(/::[\w-]+/g) || []).length;
    s = s.replace(/::[\w-]+/g, " ");

    const ids = (s.match(/#[\w-]+/g) || []).length;
    const classes = (s.match(/\.[\w-]+/g) || []).length;
    const attrs = (s.match(/\[\]/g) || []).length;
    const pseudoClasses = (s.match(/:[\w-]+/g) || []).length;
    // Type selectors: a bare name at the start or after a combinator/space.
    const types = (s.match(/(^|[\s>+~(,])([a-z][\w-]*)/gi) || []).length;

    return [
      ids + carried[0],
      classes + attrs + pseudoClasses + carried[1],
      types + pseudoElements + carried[2],
    ];
  }

  function compareSpecificity(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  // "text-lg" → { prefix: "text", step: "lg" }, "--space-4" → { prefix:
  // "--space", step: "4" }, "brand" → null. The step is the last dash-separated
  // segment; everything before it names the family.
  //
  // The step used to have to *look* like a scale position — numeric, or one of
  // thirty-one words we had written down. That was a guess about naming, and it
  // was wrong about most of the field: --radius, --color-primary, --space-small,
  // --gap-xxs and --spacingHorizontalM were all invisible, and the guess failed
  // silently, so a page full of tokens simply reported none. What makes a scale
  // a scale is having steps you can walk, not being named in a vocabulary we
  // anticipated — so the vocabulary is gone and groupTokenFamilies decides, by
  // looking at the values.
  function splitTokenName(name) {
    if (typeof name !== "string") return null;
    const cut = name.lastIndexOf("-");
    // A leading "--" is the custom-property sigil, not a separator.
    if (cut <= 0 || (name.startsWith("--") && cut < 3)) return null;
    const step = name.slice(cut + 1);
    const prefix = name.slice(0, cut);
    if (!step) return null;
    return { prefix, step };
  }

  // [{ name, resolved }] → [{ prefix, members: [{ name, step, resolved }] }]
  // sorted by resolved value.
  //
  // Two members at two different values is the whole bar. A family of one is
  // dropped, because a scale you cannot step along is not a scale — and so is a
  // family whose members all resolve to the same number, which is the same
  // statement made in values rather than in names: --gap-sm and --gap-md both
  // at 8px offer a stepper with nowhere to go. Aliases collapse onto the rung
  // they share rather than sitting on it twice, so one press of the stepper
  // always moves the page.
  function groupTokenFamilies(entries) {
    const byPrefix = new Map();
    for (const e of entries || []) {
      if (!e || typeof e.resolved !== "number" || !isFinite(e.resolved)) continue;
      const split = splitTokenName(e.name);
      if (!split) continue;
      if (!byPrefix.has(split.prefix)) byPrefix.set(split.prefix, []);
      byPrefix.get(split.prefix).push({ name: e.name, step: split.step, resolved: e.resolved });
    }

    const families = [];
    for (const [prefix, members] of byPrefix) {
      // Same name twice (two sheets, same token) keeps the first resolution.
      const seenName = new Set();
      const unique = members.filter((m) => (seenName.has(m.name) ? false : seenName.add(m.name)));
      unique.sort((a, b) => a.resolved - b.resolved || a.name.localeCompare(b.name));
      // One rung per distinct value; the first name at that value wins it.
      const seenValue = new Set();
      const rungs = unique.filter((m) => (seenValue.has(m.resolved) ? false : seenValue.add(m.resolved)));
      if (rungs.length < 2) continue;
      families.push({ prefix, members: rungs });
    }
    families.sort((a, b) => a.prefix.localeCompare(b.prefix));
    return families;
  }

  // Which member sits exactly on this value? Sub-pixel tolerance only — a
  // half-pixel is rounding, a whole pixel is a different token.
  function matchToken(members, resolved, tolerance) {
    if (!members || typeof resolved !== "number") return null;
    const tol = typeof tolerance === "number" ? tolerance : 0.5;
    let best = null, bestD = Infinity;
    for (const m of members) {
      const d = Math.abs(m.resolved - resolved);
      if (d <= tol && d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  // One rung up or down, clamped at the ends. Off-scale values step to the
  // neighbour in the direction of travel, so a stepper always does something
  // predictable even when the current value is between rungs.
  function stepToken(members, resolved, dir) {
    if (!members || members.length === 0) return null;
    const exact = matchToken(members, resolved);
    if (exact) {
      const i = members.indexOf(exact);
      const next = Math.min(members.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)));
      return members[next];
    }
    if (dir > 0) return members.find((m) => m.resolved > resolved) || members[members.length - 1];
    for (let i = members.length - 1; i >= 0; i--) {
      if (members[i].resolved < resolved) return members[i];
    }
    return members[0];
  }

  // --- DOM-bound half ---
  // Everything below reads the page. It runs once per Edit Mode entry and the
  // result is cached in tokenIndex, so a heavy stylesheet is paid for once.

  // Single-class rules are what a utility framework is made of. Anything more
  // specific belongs to the page's own design and stepping it would edit
  // unrelated elements.
  const SINGLE_CLASS_RE = /^\.((?:[\w-]|\\.)+)$/;

  // Property -> the shorthand that also sets it. A padding utility declares
  // `padding`, so looking only at `padding-top` would find nothing.
  const SHORTHAND_OF = {
    "padding-top": "padding", "padding-right": "padding",
    "padding-bottom": "padding", "padding-left": "padding",
    "margin-top": "margin", "margin-right": "margin",
    "margin-bottom": "margin", "margin-left": "margin",
    "border-top-left-radius": "border-radius", "border-top-right-radius": "border-radius",
    "border-bottom-right-radius": "border-radius", "border-bottom-left-radius": "border-radius",
    "border-top-width": "border-width", "border-right-width": "border-width",
    "border-bottom-width": "border-width", "border-left-width": "border-width",
    "row-gap": "gap", "column-gap": "gap",
  };

  // The same relation read the other way, and it is not decoration.
  //
  // CSSOM lists `padding: 16px` as its four longhands, so a utility rule like
  // `.p-4 { padding: 1rem }` is indexed under `padding-top` and never under
  // `padding` — while the linked padding control asks about `padding`. The two
  // could not meet, so no shorthand-setting utility class was ever detected or
  // ever formed a family: every Tailwind spacing class, silently. `.text-lg`
  // worked only because font-size is already a longhand, which is what made
  // the gap look like partial support rather than a missing edge.
  const FIRST_LONGHAND_OF = {
    padding: "padding-top",
    margin: "margin-top",
    "border-radius": "border-top-left-radius",
    "border-width": "border-top-width",
    gap: "row-gap",
  };

  // Walking every rule of a large site is the one genuinely expensive thing
  // Edit Mode does. Past this many rules the token layer switches itself off
  // rather than stalling the panel — raw scrubbing still works, so the cost of
  // giving up is small and the cost of jank is not.
  const TOKEN_RULE_BUDGET = 50000;

  // One traversal of everything the page has to say about style, offered to a
  // visitor. Two callers want it for different reasons — the token index, which
  // reads every rule once per Edit Mode entry, and the copy payload's `styles:`
  // field, which wants only the handful that match one element and is built
  // outside Edit Mode, when tokenIndex is null. The walk itself is the same
  // walk, and it is the part with the sharp edges: cross-origin sheets that
  // throw, conditions that do not currently apply, nesting, constructed sheets.
  //
  // `visit(rule, order, sheet)` sees each style rule in document order. Return
  // false to stop the whole traversal — how a caller that only needs a few
  // matches avoids paying for a large site.
  // Stylesheet text the service worker fetched for us, by href. Populated by
  // topUpBlockedSheets() and consulted by the walk, so a sheet the page cannot
  // read is walked from a constructed copy instead of counted as a loss.
  const fetchedSheets = new Map();

  function walkPageRules(visit, budget) {
    const stats = {
      disabled: false, stopped: false, blocked: 0, readable: 0, offered: 0,
      blockedHrefs: [],
    };

    let order = 0;
    const seenSheets = new Set();
    const walk = (rules, sheet, layered) => {
      for (const rule of rules) {
        if (stats.stopped) return;
        if (order > budget) { stats.disabled = true; return; }

        // An @import is a door, not a group: CSSImportRule carries `.styleSheet`
        // and no `.cssRules`, so the recursion below walks straight past it and
        // the imported file is never read. A design system behind one entry
        // stylesheet — an extremely ordinary arrangement — was therefore
        // completely invisible to the class and winning-declaration halves.
        if (isImportRule(rule)) {
          let imported = null;
          try { imported = rule.styleSheet; } catch { imported = null; }
          if (!imported) { stats.blocked++; continue; }
          // A sheet can be imported from more than one place; walking it twice
          // would double every rule's weight in the source-order comparison.
          if (seenSheets.has(imported)) continue;
          seenSheets.add(imported);
          if (isOurs.styleSheet(imported)) continue;
          try {
            if (imported.cssRules) {
              stats.readable++;
              stats.offered += imported.cssRules.length;
              walk(imported.cssRules, imported, layered);
            }
          } catch { stats.blocked++; }
          continue;
        }

        // Conditional groups: only descend into conditions that currently
        // apply, so a token is never claimed from a media query that is not in
        // effect. Detected by type rather than by "has cssRules" — see below.
        if (isMediaRule(rule)) {
          let matches = true;
          try { matches = window.matchMedia(rule.conditionText).matches; } catch { matches = false; }
          if (!matches) continue;
        } else if (isSupportsRule(rule)) {
          try { if (!CSS.supports(rule.conditionText)) continue; } catch { continue; }
        } else if (isContainerRule(rule)) {
          // A container query is a condition like the other two, but there is
          // no way to ask whether it currently holds without knowing which
          // element is being queried against. It used to be descended
          // unconditionally, which indexed declarations that are not in effect
          // as though they were. Skipping is the safer error: a token we did
          // not offer is a stepper that is missing, and a token claimed from a
          // rule that is not applying is a delta line that is wrong.
          continue;
        }

        // Everything inside an @layer loses to everything outside one, at equal
        // importance — so the flag travels down with the walk and settles ties
        // in findWinningDeclaration. Ordering *between* named layers needs the
        // @layer statement that declares them, which is not modelled: this
        // distinguishes layered from unlayered and no finer.
        if (isLayerBlockRule(rule)) {
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, sheet, true);
          continue;
        }

        // A style rule carries declarations, and — since CSS Nesting shipped —
        // may carry child rules as well. So this is not an either/or, and it
        // cannot be decided by testing `rule.cssRules` for truthiness: every
        // CSSStyleRule now has a cssRules list, empty or not. Reading that as
        // "this is a group" skips the rule's own declarations, which quietly
        // empties the whole token index and takes the !important escalation
        // down with it, since both read from index.rules.
        if (rule.selectorText && rule.style) {
          order++;
          if (visit(rule, order, sheet, Boolean(layered)) === false) { stats.stopped = true; return; }
        }

        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, sheet, layered);
      }
    };

    // Shadow roots carry their own stylesheets, which are not in
    // document.styleSheets and never were walked — so a page built out of web
    // components offered nothing, and did not even count as blocked. Only open
    // roots can be reached; a closed one is genuinely private.
    const shadowSheets = [];
    try {
      const treeWalker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      for (let node = treeWalker.currentNode; node; node = treeWalker.nextNode()) {
        const root = node.shadowRoot;
        if (!root) continue;
        for (const sheet of Array.from(root.styleSheets || [])) shadowSheets.push(sheet);
        for (const sheet of Array.from(root.adoptedStyleSheets || [])) shadowSheets.push(sheet);
      }
    } catch { /* a hostile document is a reason to collect less, not to throw */ }

    for (const sheet of Array.from(document.styleSheets)) {
      // Our own stylesheets are injected into every page we run on, and their
      // tokens are the tool's, not the page's. Offering --pnt-accent as a fill
      // for someone's card would be inventing a design system they never had.
      if (isOurs.styleSheet(sheet)) continue;
      let rules = null;
      // Cross-origin sheets without CORS throw on access. Nothing can be done
      // about it, but it is worth counting: it is the difference between "this
      // page has no design tokens" and "this page's design tokens are behind a
      // door", and the panel says so.
      try { rules = sheet.cssRules; } catch { rules = null; }
      // Blocked, but perhaps not for long: if the worker has already fetched
      // this href, walk the copy in its place. Substituting here rather than
      // appending afterwards is what keeps source order intact — the rules land
      // at the position the real sheet occupies, which is what the cascade
      // comparison in findWinningDeclaration reads.
      if (!rules) {
        const substitute = sheet.href && fetchedSheets.get(sheet.href);
        if (substitute) {
          try { rules = substitute.cssRules; } catch { rules = null; }
        }
        if (!rules) {
          stats.blocked++;
          if (sheet.href) stats.blockedHrefs.push(sheet.href);
          continue;
        }
      }
      if (rules) {
        stats.readable++;
        stats.offered += rules.length;
        walk(rules, sheet);
      }
      if (stats.disabled || stats.stopped) break;
    }
    // Constructed sheets (CSS-in-JS runtimes) live outside document.styleSheets,
    // and so does everything inside an open shadow root.
    for (const sheet of Array.from(document.adoptedStyleSheets || []).concat(shadowSheets)) {
      if (isOurs.styleSheet(sheet) || seenSheets.has(sheet)) continue;
      seenSheets.add(sheet);
      try {
        if (sheet.cssRules) {
          stats.readable++;
          stats.offered += sheet.cssRules.length;
          walk(sheet.cssRules, sheet, false);
        }
      } catch { stats.blocked++; }
      if (stats.disabled || stats.stopped) break;
    }

    return stats;
  }

  function collectTokenSources() {
    const index = {
      disabled: false,       // gave up: the page is too large to walk
      blocked: 0,            // stylesheets we were not allowed to read
      readable: 0,           // stylesheets we were
      offered: 0,            // rules those sheets actually contained
      suspect: false,        // we read sheets full of rules and collected none
      classRules: new Map(), // property -> [{ className, value, order }]
      varNames: new Set(),
      rules: [],             // { selectorText, style, order } for the winner walk
      typeStyles: [],        // { name, kind: "class", decls } — see Type Styles
    };

    const stats = walkPageRules((rule, order, sheet, layered) => {
      index.rules.push({ selectorText: rule.selectorText, style: rule.style, order, layered });
      collectRule(rule, index);
    }, TOKEN_RULE_BUDGET);

    index.disabled = stats.disabled;
    index.blocked = stats.blocked;
    index.readable = stats.readable;
    index.offered = stats.offered;
    index.blockedHrefs = stats.blockedHrefs;

    if (index.disabled) {
      index.classRules.clear();
      index.varNames.clear();
      index.rules.length = 0;
      index.typeStyles.length = 0;
    }

    // The sanity check. Not "did we find tokens" — plenty of pages have none,
    // and that is a fact about the page. This asks something a working
    // collector can never answer yes to: we were handed stylesheets full of
    // rules, and came back with nothing at all.
    //
    // That is exactly the shape the CSS-Nesting bug had. Every style rule
    // acquired a cssRules list, the walk read each one as a group, recursed
    // into an empty list, and collected zero declarations — silently, for
    // weeks. A collector that cannot notice it collected nothing will keep
    // failing that way.
    index.suspect = !index.disabled && index.readable > 0 && index.offered > 0 &&
      index.rules.length === 0;

    return index;
  }

  // The blocked sheets, fetched through the service worker and folded back in.
  //
  // Deliberately after the fact rather than before it. The panel opens on what
  // the page could read on its own, which is instant; this arrives a moment
  // later and rebuilds. Waiting for the network instead would mean a slow CDN
  // holding the panel shut, which is a worse trade than a stepper that appears
  // a beat late.
  let tokenTopUpToken = 0;
  async function topUpBlockedSheets(el) {
    if (!tokenIndex || !tokenIndex.blockedHrefs || tokenIndex.blockedHrefs.length === 0) return;
    const wanted = tokenIndex.blockedHrefs.filter((href) => !fetchedSheets.has(href));
    if (wanted.length === 0) return;

    const ticket = ++tokenTopUpToken;
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: "FETCH_STYLESHEETS", urls: wanted });
    } catch {
      return; // the worker is asleep or the context is gone; the panel is still usable
    }
    // Edit Mode ended, or moved to another element, while we were waiting.
    if (ticket !== tokenTopUpToken || !editing || selectedElement !== el) return;
    if (!reply || !Array.isArray(reply.sheets)) return;

    let gained = 0;
    for (const entry of reply.sheets) {
      if (!entry || !entry.text) continue;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(entry.text);
        fetchedSheets.set(entry.url, sheet);
        gained++;
      } catch { /* not parseable as CSS; it stays counted as blocked */ }
    }
    if (!gained) return;

    // Rebuild rather than merge: the walk puts the recovered rules back at the
    // document position their sheet occupies, and source order is what the
    // cascade comparison reads.
    tokenIndex = collectTokenSources();
    editTokenFamilies = buildTokenFamilies(el);
    editTypeStyles = collectTypeStyleUniverse(el);
    editTypeLadders = groupTypeStyleLadders(editTypeStyles);
    editTypeClaim = detectTypeStyle(el);
    renderEditControls();
    paintDegradedMarker();
  }

  // The walk's second caller: the authored rules that apply to one element,
  // for the copy payload's `styles:` field (see getMatchedCss). It stops at the
  // first handful, which is why it can afford to run on a click rather than
  // once per Edit Mode entry — the interesting rules are the specific ones and
  // they are rarely deep in a framework's reset.
  //
  // A nested rule's selectorText is relative to its parent (`&:hover`, or a
  // bare `.foo` under `.bar`), so matches() throws on it. Those are skipped
  // rather than guessed at: reporting a rule that does not actually apply is
  // worse than reporting one fewer that does.
  const MATCH_RULE_BUDGET = 20000;
  const MATCH_RULE_LIMIT = 6;

  function collectMatchedRules(el) {
    const found = [];
    walkPageRules((rule, order, sheet) => {
      let hit = false;
      try { hit = el.matches(rule.selectorText); } catch { return; }
      if (!hit) return;
      found.push({
        selectorText: rule.selectorText,
        declarations: rule.style.cssText,
        origin: sheetOrigin(sheet),
      });
      if (found.length >= MATCH_RULE_LIMIT) return false;
    }, MATCH_RULE_BUDGET);
    return found;
  }

  // Where a rule came from, in the shortest form that still identifies it: the
  // file name for a linked sheet, and an honest label for the two kinds that
  // have no file.
  function sheetOrigin(sheet) {
    if (!sheet) return "";
    if (sheet.href) {
      try { return new URL(sheet.href).pathname.split("/").pop() || sheet.href; }
      catch { return sheet.href; }
    }
    if (sheet.ownerNode && sheet.ownerNode.tagName === "STYLE") return "<style>";
    return "constructed sheet";
  }

  const isMediaRule = (rule) =>
    typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule;
  const isSupportsRule = (rule) =>
    typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule;
  const isContainerRule = (rule) =>
    typeof CSSContainerRule !== "undefined" && rule instanceof CSSContainerRule;
  const isImportRule = (rule) =>
    typeof CSSImportRule !== "undefined" && rule instanceof CSSImportRule;
  const isLayerBlockRule = (rule) =>
    typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule;

  // One rule's contribution: every custom property it declares, and — when the
  // selector is a single bare class — the utility values it defines.
  function collectRule(rule, index) {
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      if (prop.startsWith("--") && !isOurs.name(prop)) index.varNames.add(prop);
    }

    // A grouped selector is still a list of utility rules — `.lead-snug,
    // .leading-snug { … }` defines two of them. Matching the whole selector
    // against a single-class pattern rejected the lot, and minifiers group
    // aggressively, so a build step alone could hide a page's whole scale.
    for (const part of rule.selectorText.split(",")) {
      const m = part.trim().match(SINGLE_CLASS_RE);
      if (!m) continue;
      // The captured text is CSS-escaped ("p-1\.5"); the DOM class is not.
      const className = m[1].replace(/\\(.)/g, "$1");
      if (isOurs.name(className)) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        if (prop.startsWith("--")) continue;
        if (!index.classRules.has(prop)) index.classRules.set(prop, []);
        index.classRules.get(prop).push({
          className,
          value: rule.style.getPropertyValue(prop),
          order: index.rules.length,
        });
      }

      // A single class that sets several type properties at once is a type
      // style — text-lg carrying size and leading, .type-heading-md carrying
      // four. CSSOM has already expanded any font: shorthand into these
      // longhands, so that source costs nothing extra to read.
      const typeDecls = {};
      let typeCount = 0;
      for (const prop of TYPE_STYLE_PROPS) {
        const v = rule.style.getPropertyValue(prop);
        if (v) {
          typeDecls[prop] = v.trim();
          typeCount++;
        }
      }
      if (typeCount >= 2) {
        index.typeStyles.push({ name: className, kind: "class", decls: typeDecls });
      }
    }
  }

  // The declaration that actually paints this property on this element:
  // highest importance, then specificity, then source order — with inline
  // style above all of it. Its text is the only place a var() can be seen.
  // `opts.ignoreInline` answers a different question: not "what is painting this
  // property now" but "what would paint it if we were not here". Escalation has
  // to ask the second one — see neededPriority.
  function findWinningDeclaration(el, prop, index, opts) {
    if (!el || !index || index.disabled) return null;
    const ignoreInline = Boolean(opts && opts.ignoreInline);

    const inlineValue = !ignoreInline && el.style && el.style.getPropertyValue(prop);
    const inlineImportant = el.style && el.style.getPropertyPriority(prop) === "important";
    if (inlineValue && inlineImportant) {
      return { value: inlineValue, important: true, fromInline: true, selectorText: null };
    }

    let best = null;
    for (const rule of index.rules) {
      let matches = false;
      try { matches = el.matches(rule.selectorText); } catch { continue; }
      if (!matches) continue;
      const value = rule.style.getPropertyValue(prop);
      if (!value) continue;
      const important = rule.style.getPropertyPriority(prop) === "important";
      const spec = computeSpecificity(rule.selectorText);
      const cand = {
        value, important, spec, order: rule.order,
        layered: Boolean(rule.layered), selectorText: rule.selectorText,
      };
      if (!best) { best = cand; continue; }
      if (cand.important !== best.important) { if (cand.important) best = cand; continue; }
      // Layer order sits above specificity in the cascade, not below it: an
      // unlayered declaration beats a layered one however specific the layered
      // one is. Ignoring this picked the wrong winner on any Tailwind v4 or
      // shadcn page — and a wrong winner means the var() read out of it names
      // the wrong token, which is worse than naming none.
      if (cand.layered !== best.layered) { if (!cand.layered) best = cand; continue; }
      const bySpec = compareSpecificity(cand.spec, best.spec);
      if (bySpec > 0 || (bySpec === 0 && cand.order >= best.order)) best = cand;
    }

    if (inlineValue && (!best || !best.important)) {
      return { value: inlineValue, important: false, fromInline: true, selectorText: null };
    }
    return best ? { ...best, fromInline: false } : null;
  }

  // Which token — if any — is this element's computed value sitting on?
  // Utility class first (it is what the source contains), then a var() in the
  // winning declaration. Both are verified against the computed value before
  // being claimed.
  function detectPropertyToken(el, prop, computedValue, index) {
    if (!el || !index || index.disabled) return null;
    const target = resolveLength(computedValue, tokenRemBase(), tokenEmBase(el));
    // Not a length. It may still be a colour, and a colour is a token as much
    // as a spacing step is — this used to be where every colour gave up, which
    // is why the before side of a colour edit always read as a bare hex.
    if (target === null) return detectColorToken(el, prop, computedValue, index);

    // Up to the shorthand for a side control, and down to a representative
    // longhand for a linked one — CSSOM indexes a shorthand declaration under
    // its longhands, so asking only for "padding" finds nothing.
    const props = [prop];
    if (SHORTHAND_OF[prop]) props.push(SHORTHAND_OF[prop]);
    if (FIRST_LONGHAND_OF[prop]) props.push(FIRST_LONGHAND_OF[prop]);

    for (const p of props) {
      for (const cls of Array.from(el.classList)) {
        const candidates = index.classRules.get(p);
        if (!candidates) continue;
        // Last, not first: two sheets declaring .p-4 differently is the
        // cascade choosing the later one, and `find` chose the earlier.
        const hit = lastClassRule(candidates, cls);
        if (!hit) continue;
        const resolved = resolveLength(hit.value, tokenRemBase(), tokenEmBase(el));
        if (resolved !== null && Math.abs(resolved - target) <= 0.5) {
          return { kind: "class", name: cls, resolved };
        }
      }
    }

    const winner = findWinningDeclaration(el, prop, index);
    const varMatch = winner && winner.value.match(/var\(\s*(--[\w-]+)/);
    if (varMatch) {
      const resolved = resolveLength(
        getComputedStyle(el).getPropertyValue(varMatch[1]), tokenRemBase(), tokenEmBase(el));
      if (resolved !== null && Math.abs(resolved - target) <= 0.5) {
        return { kind: "var", name: varMatch[1], resolved };
      }
    }
    return null;
  }

  // The declaration for this class that the cascade would actually use: the
  // last one indexed, since equal-specificity single-class rules are settled by
  // source order and the walk records them in it.
  function lastClassRule(candidates, cls) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i].className === cls) return candidates[i];
    }
    return null;
  }

  // Two colours are the same colour. A byte of slack per channel because the
  // wide-gamut syntaxes arrive through a rasteriser, and a value that has been
  // through sRGB once can land a unit off where the arithmetic would put it.
  function sameColor(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 &&
      Math.abs(a.b - b.b) <= 1 && Math.abs(a.a - b.a) <= 0.01;
  }

  // The colour half of detection, and deliberately the same shape as the length
  // half: a token is claimed only when the declaration that won actually names
  // one. A colour that merely *equals* --ink is not written as --ink in the
  // source, and reporting it as though it were would send the agent to change a
  // token this element never referenced. Matching by value alone would find far
  // more tokens and be wrong about most of them.
  function detectColorToken(el, prop, computedValue, index) {
    const target = resolveColor(computedValue);
    if (!target) return null;

    const candidates = index.classRules.get(prop);
    if (candidates) {
      for (const cls of Array.from(el.classList)) {
        const hit = lastClassRule(candidates, cls);
        if (hit && sameColor(resolveColor(hit.value), target)) {
          return { kind: "class", name: cls };
        }
      }
    }

    const winner = findWinningDeclaration(el, prop, index);
    const varMatch = winner && winner.value.match(/var\(\s*(--[\w-]+)/);
    if (varMatch) {
      const resolved = resolveColor(getComputedStyle(el).getPropertyValue(varMatch[1]));
      if (sameColor(resolved, target)) return { kind: "var", name: varMatch[1] };
    }
    return null;
  }

  function tokenRemBase() {
    const v = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return isFinite(v) ? v : 16;
  }

  function tokenEmBase(el) {
    const v = parseFloat(getComputedStyle(el).fontSize);
    return isFinite(v) ? v : tokenRemBase();
  }

  // ===== Resolving values the pure parsers cannot =====
  // parseCssLength and parseCssColor are pure, mirrored into the test suites,
  // and swept there — so they stay pure. What they cannot do is evaluate CSS,
  // and modern token systems are full of CSS that needs evaluating: Tailwind v4
  // alone declares its spacing as calc(var(--spacing) * 4) and its palette in
  // oklch(). Both were read as "not a length" and "not a colour", which is why
  // a fully-tokenised v4 site reported nothing at all.
  //
  // So the browser is asked instead. These two wrappers try the pure parser
  // first — it is exact, and it covers the common case — and fall back to
  // making the engine do the work only when it cannot.

  let probeCell = null;

  // A cell that participates in layout but paints nothing, so a length can be
  // assigned to it and read back in pixels. visibility:hidden rather than
  // display:none on purpose: a display:none box has no computed width to read.
  function tokenProbeCell() {
    if (probeCell && probeCell.isConnected) return probeCell;
    probeCell = document.createElement("div");
    probeCell.id = "pnt-probe-cell";
    probeCell.style.position = "fixed";
    probeCell.style.top = "-9999px";
    probeCell.style.left = "-9999px";
    probeCell.style.height = "0";
    probeCell.style.visibility = "hidden";
    probeCell.style.pointerEvents = "none";
    probeCell.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(probeCell);
    return probeCell;
  }

  function releaseTokenProbes() {
    if (probeCell) {
      probeCell.remove();
      probeCell = null;
    }
    probeCanvas = null;
  }

  // "calc(0.25rem * 4)" → 16. Percentages are refused rather than guessed at:
  // they resolve against a containing block this cell does not share with the
  // element, so a number derived here would be confidently wrong. An
  // unsubstituted var() is refused for the same reason — it has no value yet.
  function resolveLength(value, remBase, emBase) {
    const pure = parseCssLength(value, remBase, emBase);
    if (pure !== null) return pure;
    if (typeof value !== "string") return null;
    const s = value.trim();
    if (!s || s.includes("%") || s.includes("var(")) return null;
    // Nothing else is worth a reflow: a bare keyword ("auto", "inherit") has no
    // pixel value, and only these produce one the engine has to compute.
    if (!/^-?[\d.]|^(calc|clamp|min|max|round)\(/i.test(s)) return null;

    const cell = tokenProbeCell();
    // em inside the value has to resolve against the element being edited, not
    // against whatever this cell inherited from <html>.
    cell.style.fontSize = typeof emBase === "number" ? `${emBase}px` : "";
    cell.style.width = "";
    cell.style.width = s;
    // An unparseable value leaves width at its cleared state rather than throwing.
    if (!cell.style.width) return null;
    const px = parseFloat(getComputedStyle(cell).width);
    return isFinite(px) ? px : null;
  }

  let probeCanvas = null;

  // Every colour syntax the browser can paint, reduced to sRGB bytes.
  //
  // Neither computed style nor canvas fillStyle converts the CSS Color 4
  // functions — Chrome round-trips `oklch(0.7 0.15 200)` back out unchanged
  // through both — so the only thing that actually resolves one is painting it
  // and reading the pixel. That is what this does, and it is why the picker can
  // now offer an oklch palette at all.
  function resolveColor(value) {
    const pure = parseCssColor(value);
    if (pure) return pure;
    if (typeof value !== "string" || !value.trim()) return null;

    if (!probeCanvas) {
      const cv = document.createElement("canvas");
      cv.width = 1;
      cv.height = 1;
      probeCanvas = cv.getContext("2d", { willReadFrequently: true });
    }
    const ctx = probeCanvas;
    if (!ctx) return null;

    // An invalid fillStyle is *ignored*, leaving the previous one in place — so
    // assigning it over two different sentinels is what tells the difference
    // between "this is black" and "this is not a colour". Without this, every
    // unparseable value reports as opaque black.
    try {
      ctx.fillStyle = "#000000";
      ctx.fillStyle = value;
      const overBlack = ctx.fillStyle;
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = value;
      if (ctx.fillStyle !== overBlack) return null;

      // copy, so the alpha written is the alpha read rather than the result of
      // compositing onto whatever the cell held before.
      ctx.globalCompositeOperation = "copy";
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch {
      // A tainted or unavailable canvas is a reason to claim no colour, not to
      // take the page down.
      return null;
    }
  }

  // ===== Edit Color =====
  // Pure conversions for the edit panel's colour picker. HSV is the picker's
  // native space — a saturation square is linear in S and V, which HSL's is
  // not — and rgb/hex is the page's. All four functions are transcribed into
  // test/edit-color.mjs; change them there and change them here.

  // 0–255 channels → { h: 0–360, s: 0–1, v: 0–1 }
  function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) h = 60 * (((gn - bn) / d) % 6);
      else if (max === gn) h = 60 * ((bn - rn) / d + 2);
      else h = 60 * ((rn - gn) / d + 4);
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  // { h, s, v } → { r, g, b } 0–255 integers
  function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    const [r, g, b] =
      h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
      h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  // #rgb(a) / #rrggbb(aa) / rgb() / rgba() → { r, g, b, a } or null. Covers
  // everything getComputedStyle emits for colours plus what a hex field takes;
  // anything else (keywords, color(), oklch()) is a null and the caller keeps
  // its previous value.
  function parseCssColor(str) {
    if (typeof str !== "string") return null;
    const s = str.trim().toLowerCase();

    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      const hex = m[1];
      if (hex.length === 3 || hex.length === 4) {
        const [r, g, b, a] = hex.split("").map((c) => parseInt(c + c, 16));
        return { r, g, b, a: hex.length === 4 ? a / 255 : 1 };
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        };
      }
      return null;
    }

    m = s.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
    if (m) {
      const clampByte = (n) => Math.min(255, Math.max(0, Math.round(parseFloat(n))));
      const a = m[4] === undefined ? 1
        : m[4].endsWith("%") ? parseFloat(m[4]) / 100
        : parseFloat(m[4]);
      return { r: clampByte(m[1]), g: clampByte(m[2]), b: clampByte(m[3]), a: Math.min(1, Math.max(0, a)) };
    }

    return null;
  }

  // { r, g, b, a? } → #rrggbb, or #rrggbbaa when alpha is meaningfully < 1
  function formatHex(c) {
    const h = (n) => Math.round(n).toString(16).padStart(2, "0");
    const base = "#" + h(c.r) + h(c.g) + h(c.b);
    return c.a === undefined || c.a >= 1 ? base : base + h(c.a * 255);
  }

  // ===== Type Styles =====
  // Composite typography tokens. A design system rarely hands out font-size
  // alone: .text-lg carries size and leading together, a --heading-md stem
  // carries three values, and the panel treating those as unrelated numbers
  // was a lie of omission. A type style is one named source setting several
  // type properties at once:
  //
  //   { name: "text-lg" | "--heading-md", kind: "class" | "var",
  //     decls: { "font-size": "18px", "line-height": "28px", ... },
  //     constituents: { "font-size": 18, "line-height": 28, ... } }
  //
  // Three sources, equal citizens: multi-declaration single-class rules
  // (collected by the stylesheet walk, font: shorthand pre-expanded by
  // CSSOM), and custom-property stems grouped by naming role. Styles sit
  // ABOVE the per-property families, and the values a style owns are carved
  // OUT of those families — one value, one owner.
  //
  // The claiming rule extends the house rule: a style is claimed only when
  // its source is in force (the class actually worn; the vars actually
  // referenced by winning declarations) — full constituent match claims
  // "on", a deviation claims "modified" and names the drift, and a value
  // that merely coincides with a style nobody applied claims nothing.
  //
  // The pure half is mirrored in test/type-styles.mjs — change both.

  const TYPE_STYLE_PROPS = ["font-size", "font-weight", "line-height", "letter-spacing"];

  function typeStyleClassNames(index) {
    const names = new Set();
    for (const s of (index && index.typeStyles) || []) {
      if (s && s.kind === "class") names.add(s.name);
    }
    return names;
  }

  // "--heading-md-size" → { stem: "--heading-md", prop: "font-size" }.
  // Role vocabulary covers the common spellings; a name that matches no role
  // is not part of a stem. Pure — mirrored in test/type-styles.mjs.
  function splitVarStem(name) {
    if (typeof name !== "string" || !name.startsWith("--")) return null;
    const ROLES = [
      ["font-size", /-(font-size|size)$/i],
      ["font-weight", /-(font-weight|weight)$/i],
      ["line-height", /-(line-height|lineheight|leading)$/i],
      ["letter-spacing", /-(letter-spacing|letterspacing|tracking)$/i],
    ];
    for (const [prop, re] of ROLES) {
      const m = name.match(re);
      if (m && name.length - m[0].length > 2) {
        return { stem: name.slice(0, name.length - m[0].length), prop };
      }
    }
    return null;
  }

  // Declared strings → resolved numbers. A unitless line-height multiplies
  // the style's own size (the CSS meaning, when the style declares one);
  // "normal" letter-spacing is exactly 0; weights accept the two keywords.
  // Anything unresolvable is simply absent — a constituent we cannot compare
  // is a constituent we must not claim. Pure — mirrored in
  // test/type-styles.mjs.
  function resolveTypeStyle(decls, remBase, emBase) {
    const out = {};
    const d = decls || {};
    const size = d["font-size"] !== undefined
      ? parseCssLength(d["font-size"], remBase, emBase)
      : null;
    if (typeof size === "number") out["font-size"] = size;

    if (d["font-weight"] !== undefined) {
      const w = d["font-weight"].trim();
      const n = w === "normal" ? 400 : w === "bold" ? 700 : parseFloat(w);
      if (isFinite(n) && /^(normal|bold|[\d.]+)$/.test(w)) out["font-weight"] = n;
    }

    if (d["line-height"] !== undefined) {
      const raw = d["line-height"].trim();
      const asLength = parseCssLength(raw, remBase, typeof size === "number" ? size : emBase);
      if (asLength !== null) out["line-height"] = asLength;
      else if (/^[\d.]+$/.test(raw) && typeof size === "number") {
        const unitless = parseFloat(raw);
        if (isFinite(unitless)) out["line-height"] = Math.round(unitless * size * 100) / 100;
      }
    }

    if (d["letter-spacing"] !== undefined) {
      const raw = d["letter-spacing"].trim();
      if (raw === "normal") out["letter-spacing"] = 0;
      else {
        const n = parseCssLength(raw, remBase, typeof size === "number" ? size : emBase);
        if (n !== null) out["letter-spacing"] = n;
      }
    }
    return out;
  }

  // Styles into ladders: same source kind only (stepping must never switch
  // write mechanisms mid-climb), font-size present (the axis and the sort
  // key), aliases collapsing onto their rung, two rungs to count — every
  // rule the single-value families already live by, lifted to composites.
  // Pure — mirrored in test/type-styles.mjs.
  function groupTypeStyleLadders(styles) {
    const byKey = new Map();
    for (const s of styles || []) {
      if (!s || !s.constituents || typeof s.constituents["font-size"] !== "number") continue;
      const split = splitTokenName(s.name);
      if (!split) continue;
      const key = s.kind + " " + split.prefix;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(s);
    }
    const ladders = [];
    for (const [key, members] of byKey) {
      const seenName = new Set();
      const unique = members.filter((m) => (seenName.has(m.name) ? false : seenName.add(m.name)));
      unique.sort((a, b) =>
        a.constituents["font-size"] - b.constituents["font-size"] || a.name.localeCompare(b.name));
      const seenSize = new Set();
      const rungs = unique.filter((m) =>
        (seenSize.has(m.constituents["font-size"]) ? false : seenSize.add(m.constituents["font-size"])));
      if (rungs.length < 2) continue;
      ladders.push({ kind: rungs[0].kind, prefix: key.split(" ")[1], rungs });
    }
    ladders.sort((a, b) => a.prefix.localeCompare(b.prefix));
    return ladders;
  }

  // Which constituents hold and which have drifted, against the element's
  // computed numbers. Half a pixel is rounding; anything more is a different
  // value. Pure — mirrored in test/type-styles.mjs.
  function matchTypeStyleConstituents(constituents, computed) {
    const matched = [];
    const drifted = [];
    for (const [prop, want] of Object.entries(constituents || {})) {
      const got = computed ? computed[prop] : undefined;
      if (typeof got === "number" && isFinite(got) && Math.abs(got - want) <= 0.5) matched.push(prop);
      else drifted.push(prop);
    }
    return { matched, drifted };
  }

  // --- DOM-bound half ---

  // The element's own type numbers, in the same shape the constituents use.
  // line-height "normal" has no fixed number and stays absent — a style that
  // declares leading can never claim an element the browser is leading.
  function computedTypeValues(el) {
    const style = getComputedStyle(el);
    const out = {};
    const size = parseFloat(style.fontSize);
    if (isFinite(size)) out["font-size"] = size;
    const weight = parseFloat(style.fontWeight);
    if (isFinite(weight)) out["font-weight"] = weight;
    if (style.lineHeight !== "normal") {
      const lh = parseFloat(style.lineHeight);
      if (isFinite(lh)) out["line-height"] = lh;
    }
    out["letter-spacing"] = style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing) || 0;
    return out;
  }

  // Var stems in scope on this element. Scoped to the element rather than
  // the page for the same reason the token layer asks the element: the stem
  // that matters is the one whose values actually reach here.
  function collectVarStemStyles(el) {
    const byStem = new Map();
    for (const { name, value } of collectElementTokens(el)) {
      const split = splitVarStem(name);
      if (!split) continue;
      if (!byStem.has(split.stem)) byStem.set(split.stem, { decls: {}, vars: {} });
      const entry = byStem.get(split.stem);
      entry.decls[split.prop] = value;
      // The var's own name survives, because stepping a stem writes
      // font-size: var(--heading-sm-size) — the reference, not the number.
      entry.vars[split.prop] = name;
    }
    const out = [];
    for (const [stem, entry] of byStem) {
      if (entry.decls["font-size"] === undefined || Object.keys(entry.decls).length < 2) continue;
      out.push({ name: stem, kind: "var", decls: entry.decls, vars: entry.vars });
    }
    return out;
  }

  // Every style that could apply here, constituents resolved. Class styles
  // come from the walk (first declaration of a name wins, like the cascade
  // walk's own dedupe); var stems come from the element.
  function collectTypeStyleUniverse(el) {
    const rem = tokenRemBase();
    const em = tokenEmBase(el);
    const out = [];
    const seen = new Set();
    for (const s of (tokenIndex && tokenIndex.typeStyles) || []) {
      if (seen.has("c:" + s.name)) continue;
      seen.add("c:" + s.name);
      const constituents = resolveTypeStyle(s.decls, rem, em);
      if (Object.keys(constituents).length >= 2 && constituents["font-size"] !== undefined) {
        out.push({ name: s.name, kind: "class", decls: s.decls, constituents });
      }
    }
    for (const s of collectVarStemStyles(el)) {
      if (seen.has("v:" + s.name)) continue;
      seen.add("v:" + s.name);
      const constituents = resolveTypeStyle(s.decls, rem, em);
      if (Object.keys(constituents).length >= 2 && constituents["font-size"] !== undefined) {
        out.push({ name: s.name, kind: "var", decls: s.decls, vars: s.vars, constituents });
      }
    }
    return out;
  }

  // The claim. In force + all constituents matching → on the style; in force
  // + deviation → modified, drift named; coincidence → nothing. When several
  // sources are in force, the fullest match wins, classes before stems —
  // the class is the more literal fact about the source.
  function detectTypeStyle(el) {
    if (!el || !el.isConnected || !editTypeStyles || editTypeStyles.length === 0) return null;
    const computed = computedTypeValues(el);
    const worn = new Set(classListOf(el));
    let best = null;

    const consider = (style, inForce) => {
      if (!inForce) return;
      const { matched, drifted } = matchTypeStyleConstituents(style.constituents, computed);
      if (matched.length === 0) return; // in force but nothing holds: not a claim
      const cand = { style, on: drifted.length === 0, drifted };
      if (!best) { best = cand; return; }
      if (cand.drifted.length < best.drifted.length) best = cand;
      else if (cand.drifted.length === best.drifted.length &&
               best.style.kind === "var" && cand.style.kind === "class") best = cand;
    };

    for (const style of editTypeStyles) {
      if (style.kind === "class") {
        // Worn is cheap; ask live every time.
        consider(style, worn.has(style.name));
      } else {
        // A stem is in force when a winning declaration actually references
        // it — consumption, not coincidence. That answer walks the rules, so
        // the per-scrub refresh path reads the render-time cache instead.
        let referenced;
        if (editTypeInForce) {
          referenced = editTypeInForce.has("v:" + style.name);
        } else {
          referenced = varStemInForce(el, style);
        }
        consider(style, referenced);
      }
    }
    return best;
  }

  function varStemInForce(el, style) {
    for (const prop of Object.keys(style.constituents)) {
      const winner = findWinningDeclaration(el, prop, tokenIndex);
      if (winner && typeof winner.value === "string" &&
          winner.value.includes("var(" + style.name)) {
        return true;
      }
    }
    return false;
  }

  // Render-time snapshot of the expensive half of "in force". Class styles
  // are never cached — worn is one Set lookup.
  function computeTypeInForce(el) {
    const set = new Set();
    for (const style of editTypeStyles || []) {
      if (style.kind === "var" && varStemInForce(el, style)) set.add("v:" + style.name);
    }
    return set;
  }

  // The ladder a claimed style steps along, if it has one.
  function typeLadderFor(claim) {
    if (!claim || !editTypeLadders) return null;
    for (const ladder of editTypeLadders) {
      if (ladder.kind === claim.style.kind &&
          ladder.rungs.some((r) => r.name === claim.style.name)) {
        return ladder;
      }
    }
    return null;
  }

  // A constituent as a written declaration: weights are bare numbers,
  // lengths are pixels. Pure — mirrored in test/type-styles.mjs.
  function formatTypePx(prop, value) {
    return prop === "font-weight" ? String(value) : value + "px";
  }

  // A style's values as a compact reading — "20px/28px · 600" — for the
  // delta's fallback case, where values were written because a class swap
  // did not take. Pure — mirrored in test/type-styles.mjs.
  function formatTypeCss(constituents) {
    const c = constituents || {};
    const parts = [];
    if (typeof c["font-size"] === "number") {
      parts.push(typeof c["line-height"] === "number"
        ? c["font-size"] + "px/" + c["line-height"] + "px"
        : c["font-size"] + "px");
    }
    if (typeof c["font-weight"] === "number") parts.push(String(c["font-weight"]));
    if (typeof c["letter-spacing"] === "number" && c["letter-spacing"] !== 0) {
      parts.push(c["letter-spacing"] + "px");
    }
    return parts.join(" · ");
  }

  // The gesture's "before" for the style row: the claim as it stands, plus
  // the current inline state of every constituent, so a revert puts the
  // exact declarations back.
  function readTypeStyleValue(el) {
    const claim = detectTypeStyle(el);
    const decls = {};
    for (const p of TYPE_STYLE_PROPS) decls[p] = el.style.getPropertyValue(p) || null;
    if (!claim) {
      return {
        css: formatTypeCss(computedTypeValues(el)), inline: null, priority: "",
        cls: null, token: null, styleDecls: decls,
        style: { name: null, values: computedTypeValues(el) },
      };
    }
    return {
      css: claim.style.name + (claim.on ? "" : " (modified)"),
      inline: null, priority: "",
      cls: claim.style.kind === "class" ? claim.style.name : null,
      token: { kind: "style", name: claim.style.name },
      styleDecls: decls,
      style: { name: claim.style.name, values: computedTypeValues(el) },
    };
  }

  // Step the claimed style along its ladder: adopt the rung's source, clear
  // the overrides so it shows through, and verify it took — the page
  // outranking its own utility class is common enough that the single-prop
  // stepper already carries the same fallback.
  function stepTypeStyle(claim, ladder, dir) {
    const el = selectedElement;
    if (!el || !el.isConnected) return;
    const i = ladder.rungs.findIndex((r) => r.name === claim.style.name);
    const next = ladder.rungs[Math.min(ladder.rungs.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))];
    if (!next || next.name === claim.style.name) return;

    beginEditGesture(el, "type-style");
    const before = editGesture ? editGesture.from : null;
    const decls = {};
    for (const p of Object.keys(next.constituents)) {
      decls[p] = next.kind === "var" ? "var(" + next.vars[p] + ")" : null;
    }
    setEditValue(el, "type-style", {
      css: next.name, inline: null, priority: "",
      cls: next.kind === "class" ? next.name : null,
      token: { kind: "style", name: next.name },
      styleDecls: decls,
      style: { name: next.name, values: next.constituents },
    });

    const got = computedTypeValues(el)["font-size"];
    if (!(typeof got === "number" && Math.abs(got - next.constituents["font-size"]) <= 0.5)) {
      // The swap did nothing the eye can see. Take the source back and write
      // the rung's values instead — reported as values, because that is what
      // the source edit will actually be.
      const inline = {};
      for (const [p, v] of Object.entries(next.constituents)) inline[p] = formatTypePx(p, v);
      setEditValue(el, "type-style", {
        css: formatTypeCss(next.constituents), inline: null, priority: "",
        cls: before ? before.cls : null,
        token: null,
        styleDecls: inline,
        style: { name: null, values: next.constituents },
      });
    }
    commitEditGesture();
    editTypeClaim = detectTypeStyle(el);
    renderEditControls();
  }

  // Conform a drifted element back to its claimed style: every drifted
  // constituent written to the style's value, one gesture, one delta line.
  // Works whoever shipped the drift — that is the point.
  function conformTypeStyle(claim) {
    const el = selectedElement;
    if (!el || !el.isConnected || !claim || claim.on) return;
    const s = claim.style;
    beginEditGesture(el, "type-style");
    const decls = {};
    for (const p of claim.drifted) {
      decls[p] = s.kind === "var" && s.vars && s.vars[p]
        ? "var(" + s.vars[p] + ")"
        : formatTypePx(p, s.constituents[p]);
    }
    setEditValue(el, "type-style", {
      css: s.name, inline: null, priority: "",
      cls: s.kind === "class" ? s.name : null,
      token: { kind: "style", name: s.name },
      styleDecls: decls,
      style: { name: s.name, values: { ...computedTypeValues(el), ...s.constituents } },
    });
    commitEditGesture();
    editTypeClaim = detectTypeStyle(el);
    renderEditControls();
  }

  // ===== Edit Mode =====
  // A sub-mode of selection, in the same shape as redline: it cannot be
  // reached without a selection, every deselection path leaves it, and its
  // entire CSS surface is one class on <html>.
  //
  // Where it differs from redline is the pointer. Redline is a held modifier
  // and the page underneath stays live; Edit Mode owns the mouse for as long
  // as it lasts. While editing, the page is inert — clicks, double-clicks and
  // context menus over it are swallowed, and hover tracking stays dead — so
  // that dragging a value across a page full of links cannot navigate away
  // mid-scrub. Changing which element you are tuning is deliberate: back out
  // to selection, click the next one, edit again.

  function enterEditMode() {
    if (!probeActive || !selectedElement || editing) return;
    editing = true;
    document.documentElement.classList.add("pnt-editing");

    // One walk of the page's stylesheets per entry, so a token step knows the
    // scales. Rebuilt each time rather than cached across entries: single-page
    // apps inject styles as you navigate, and a stale index would offer tokens
    // that no longer exist.
    tokenIndex = collectTokenSources();
    editTokenFamilies = buildTokenFamilies(selectedElement);
    // Type styles ride the same lifecycle: universe and ladders once per
    // entry, the claim re-derived on refresh because drift moves with edits.
    editTypeStyles = collectTypeStyleUniverse(selectedElement);
    editTypeLadders = groupTypeStyleLadders(editTypeStyles);
    editTypeClaim = detectTypeStyle(selectedElement);
    // Anything the page was not allowed to read is chased through the service
    // worker and folded in when it lands. Not awaited: the panel opens now.
    topUpBlockedSheets(selectedElement);

    // The Advanced section's detection. The CSS half is synchronous and is in
    // the first render; the shader half needs the MAIN-world agent and a frame
    // observation, so its rows fold in a beat later — the CDN-stepper trade
    // again. Before showEditPanel, so the panel's first paint already carries
    // whatever is cheap to know.
    beginAdvancedProbe(selectedElement);

    // Capture phase, on document, so the page never sees these at all.
    document.addEventListener("pointerdown", onEditPointerGuard, true);
    document.addEventListener("mousedown", onEditPointerGuard, true);
    document.addEventListener("mouseup", onEditPointerGuard, true);
    document.addEventListener("dblclick", onEditPointerGuard, true);
    document.addEventListener("contextmenu", onEditPointerGuard, true);

    showEditPanel();
    // The panel has to be measured and placed before the run has somewhere to
    // start from, so the tether is drawn after showEditPanel(), not with it.
    renderTether({ instant: true });
    updateSettingsButtonVisibility();
  }

  function exitEditMode() {
    if (!editing) return;
    commitEditGesture();
    editing = false;
    document.documentElement.classList.remove("pnt-editing");

    document.removeEventListener("pointerdown", onEditPointerGuard, true);
    document.removeEventListener("mousedown", onEditPointerGuard, true);
    document.removeEventListener("mouseup", onEditPointerGuard, true);
    document.removeEventListener("dblclick", onEditPointerGuard, true);
    document.removeEventListener("contextmenu", onEditPointerGuard, true);

    // Uniform edits end with the session — the agent's teardown puts the
    // page's values back, so the registry and history stop claiming them
    // first. CSS edits (custom properties included) outlive this, as always.
    // Safe in either order with the teardown below: PNT_SHADER_TEARDOWN
    // itself restores every original, so clears that arrive after it land in
    // a dormant agent as no-ops.
    dropUniformEdits();
    teardownShaderBridge();

    removeEditPanel();
    clearTimeout(tetherLoudTimer);
    setTetherLoud(false);
    clearTether();
    tokenIndex = null;
    editTokenFamilies = null;
    editTypeStyles = null;
    editTypeLadders = null;
    editTypeClaim = null;
    // The measuring cell is scaffolding for the index, so it leaves with it
    // rather than sitting in the page for the rest of the session.
    releaseTokenProbes();

    // The label's readout is built from computed styles, so it would otherwise
    // still be quoting the values the element had before it was tuned.
    if (selectedElement && selectedElement.isConnected) updateOverlay(selectedElement);
    updateSettingsButtonVisibility();
  }

  // Anything aimed at our own chrome passes; everything else dies here.
  function onEditPointerGuard(e) {
    if (!editing) return;
    if (isOwnEditChrome(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function isOwnEditChrome(node) {
    return Boolean(
      (editPanelEl && editPanelEl.contains(node)) ||
      // Not a descendant of the panel any more, so it has to be named here in
      // its own right — without this the guard below preventDefaults every
      // pointerdown on the picker and all three drag surfaces go dead.
      (editPopoverEl && editPopoverEl.contains(node)) ||
      (textEditorEl && textEditorEl.contains(node)) ||
      (settingsButtonEl && settingsButtonEl.contains(node)) ||
      (toastEl && toastEl.contains(node))
    );
  }

  // ===== Edit Panel =====
  // The panel opens where the toolbar was. That spot is already solved for
  // "interactive chrome that must not be clipped", so rather than inventing a
  // second placement rule, computeChromeLayout is asked the same question with
  // the panel's dimensions in the toolbar's place and a zero-height label —
  // which rides the solver's existing label-hidden branch. The solver is not
  // modified, so its 8,280-config sweep still covers this.
  //
  // After that the panel is the user's: drag it anywhere, and it stays there
  // for the rest of the edit session. Entering Edit Mode again re-solves, so
  // the panel always starts beside the element it is about to tune.

  // The inventory, in the order the panel stacks it. Each control names the CSS
  // property it edits, so the delta block and the registry key off the same
  // string the source will contain.
  //
  // `writes` is for properties whose longhands are what actually paint: editing
  // "padding" linked means writing one shorthand, but reading has to come off a
  // longhand, because the computed shorthand is "16px 8px 16px 8px" the moment
  // the sides differ. `when` is the relevance rule from the settings decision —
  // typography only where there is text of its own, gap only where it can act.
  const EDIT_GROUPS = [
    {
      key: "typography",
      label: "Typography",
      // The text guard sits on the controls rather than the group, because the
      // five metric controls and `color` want different answers. Setting a size
      // on a wrapper that holds no text of its own is a mistake; setting a
      // colour on one is how an inherited colour is normally written, and the
      // wrapper is usually where the source edit belongs. groupsFor() already
      // hides a group whose controls all filter out, so the five behave exactly
      // as they did when the guard was one level up.
      controls: [
        // The content itself, not a style — but it lives where the eye is
        // already looking when tuning type. Only where the text is the
        // element's own: writing into a wrapper would be ambiguous about
        // which descendant's words were meant.
        { prop: "text", label: "text", kind: "text", when: ownsText },
        { prop: "font-size", label: "size", unit: "px", step: 1, min: 1, max: 400, when: ownsText },
        { prop: "font-weight", label: "weight", unit: "", step: 100, min: 100, max: 900, when: ownsText },
        // line-height's "normal" has no fixed numeric equivalent — it depends
        // on the font's own metrics — so returning to the displayed number is
        // a real declaration and gets reported as one. letter-spacing's does:
        // "normal" is exactly 0, so landing back on 0 writes the keyword and
        // leaves no edit behind.
        { prop: "line-height", label: "leading", unit: "px", step: 1, min: 0, max: 400, autoWord: "normal", when: ownsText },
        { prop: "letter-spacing", label: "tracking", unit: "px", step: 0.1, decimals: 2, min: -20, max: 40, autoWord: "normal", autoEquals: 0, when: ownsText },
        {
          prop: "text-align", label: "align", kind: "segment", options: ["left", "center", "right"],
          // Unset text-align computes to "start", which is "left" in every
          // left-to-right document — without this the row reads as though
          // nothing were selected at all.
          equivalents: { start: "left", end: "right" },
          when: ownsText,
        },
        // The loose guard, not ownsText: a wrapper is usually where an
        // inherited colour is authored, so text anywhere beneath is enough.
        // No text at all — a canvas, an icon, an empty div — and there is
        // nothing on the element for a colour to paint.
        { prop: "color", label: "colour", kind: "color", when: containsText },
      ],
    },
    {
      key: "spacing",
      label: "Spacing",
      controls: [
        {
          prop: "padding", label: "padding", unit: "px", step: 1, min: 0, max: 400,
          sides: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
          sideLabels: ["top", "right", "bottom", "left"],
        },
        {
          prop: "margin", label: "margin", unit: "px", step: 1, min: -400, max: 400,
          sides: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
          sideLabels: ["top", "right", "bottom", "left"],
        },
        {
          prop: "gap", label: "gap", unit: "px", step: 1, min: 0, max: 400, reads: "row-gap",
          when: (el) => /flex|grid/.test(getComputedStyle(el).display),
        },
      ],
    },
    {
      key: "size",
      label: "Size",
      controls: [
        { prop: "width", label: "width", unit: "px", step: 1, min: 0, max: 4000, auto: true },
        { prop: "height", label: "height", unit: "px", step: 1, min: 0, max: 4000, auto: true },
      ],
    },
    {
      key: "surface",
      label: "Surface",
      controls: [
        { prop: "background-color", label: "fill", kind: "color" },
        { prop: "opacity", label: "opacity", unit: "%", step: 1, min: 0, max: 100, scale: 100 },
      ],
    },
    {
      key: "border",
      label: "Border",
      // Adaptive mode hides a group that has nothing to show and offers to add
      // it instead; standard mode always shows it, so a border can be given to
      // an element that has none without going looking for the affordance.
      has: (el) => parseFloat(getComputedStyle(el).borderTopWidth) > 0,
      add: { "border-width": "1px", "border-style": "solid" },
      controls: [
        { prop: "border-width", label: "stroke", unit: "px", step: 1, min: 0, max: 40, reads: "border-top-width" },
        { prop: "border-color", label: "tint", kind: "color", reads: "border-top-color" },
        {
          prop: "border-radius", label: "radius", unit: "px", step: 1, min: 0, max: 400,
          sides: ["border-top-left-radius", "border-top-right-radius",
                  "border-bottom-right-radius", "border-bottom-left-radius"],
          sideLabels: ["↖", "↗", "↘", "↙"],
        },
      ],
    },
    {
      key: "shadow",
      label: "Shadow",
      has: (el) => getComputedStyle(el).boxShadow !== "none",
      add: { "box-shadow": "0 2px 8px rgb(0 0 0 / 0.15)" },
      // box-shadow is one property but four decisions, so the panel edits the
      // parts and writes the whole thing back. Reading works the same way:
      // the computed shadow is parsed once and the parts are pulled out of it.
      shadow: true,
      controls: [
        { prop: "shadow-y", label: "y", unit: "px", step: 1, min: -80, max: 80, shadowPart: "y" },
        { prop: "shadow-blur", label: "blur", unit: "px", step: 1, min: 0, max: 200, shadowPart: "blur" },
        { prop: "shadow-spread", label: "spread", unit: "px", step: 1, min: -80, max: 80, shadowPart: "spread" },
        { prop: "shadow-color", label: "tint", kind: "color", shadowPart: "color" },
      ],
    },
  ];

  const controlsOf = (group, el) => group.controls.filter((c) => !c.when || c.when(el));
  const groupsFor = (el) =>
    EDIT_GROUPS.filter((g) => (!g.when || g.when(el)) && controlsOf(g, el).length > 0);

  // Which linked controls the user has opened up into their four sides. Panel
  // state, not element state: it is a way of looking at the element, so it
  // resets with the panel rather than following the element around.
  const editSplit = new Set();

  // ===== box-shadow parts =====
  // One property, four decisions. The panel edits the parts and writes the
  // whole declaration back, which means parsing the computed value first.
  // Chrome emits "rgb(0, 0, 0) 0px 2px 8px 0px", colour first, and a
  // comma-separated list when there is more than one shadow — only the first
  // is editable here, and the rest are preserved untouched.
  function parseBoxShadow(value) {
    if (!value || value === "none") return null;
    const shadows = splitTopLevel(value);
    const first = shadows[0];
    const colorMatch = first.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i);
    const color = colorMatch ? colorMatch[1] : "rgb(0, 0, 0)";
    const numbers = first.replace(/rgba?\([^)]*\)/gi, " ").match(/-?[\d.]+px/g) || [];
    const n = (i, fallback) => (numbers[i] !== undefined ? parseFloat(numbers[i]) : fallback);
    return {
      color,
      x: n(0, 0),
      y: n(1, 0),
      blur: n(2, 0),
      spread: n(3, 0),
      inset: /\binset\b/.test(first),
      rest: shadows.slice(1),
    };
  }

  function formatBoxShadow(parts) {
    const body = `${parts.color} ${parts.x}px ${parts.y}px ${parts.blur}px ${parts.spread}px`;
    const one = parts.inset ? `inset ${body}` : body;
    return [one, ...(parts.rest || [])].join(", ");
  }

  // Split on commas that are not inside parentheses, so rgb(0, 0, 0) survives.
  function splitTopLevel(value) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
    }
    out.push(value.slice(start).trim());
    return out.filter(Boolean);
  }

  function currentShadow(el) {
    return parseBoxShadow(getComputedStyle(el).boxShadow) ||
      { color: "rgb(0, 0, 0)", x: 0, y: 0, blur: 0, spread: 0, inset: false, rest: [] };
  }

  // A shadow part reads out of the parsed shadow and writes the whole property
  // back, so the registry only ever holds one entry: "box-shadow".
  function applyShadowPart(control, value) {
    const el = selectedElement;
    if (!el || !el.isConnected) return;
    const parts = currentShadow(el);
    if (control.shadowPart === "color") parts.color = value;
    else parts[control.shadowPart === "y" ? "y" : control.shadowPart] = parseFloat(value) || 0;
    const css = formatBoxShadow(parts);
    setEditValue(el, "box-shadow", {
      css, inline: css, priority: neededPriority(el, "box-shadow"), cls: null, token: null,
    });
  }

  function shadowPartValue(el, control) {
    const parts = currentShadow(el);
    return control.shadowPart === "color" ? parts.color : parts[control.shadowPart];
  }

  // ===== colour values =====
  function readColorValue(el, control) {
    if (control.uniform) {
      // 0–1 floats to a css colour, so the swatch and the picker can carry a
      // vec3 the way they carry any other colour.
      const vec = currentUniformValue(control.uniform.name) || [0, 0, 0, 1];
      const byte = (v) => Math.round(Math.min(1, Math.max(0, v || 0)) * 255);
      const alpha = control.uniform.comps === 4 ? Math.min(1, Math.max(0, vec[3])) : 1;
      return `rgb(${byte(vec[0])} ${byte(vec[1])} ${byte(vec[2])}${alpha < 1 ? ` / ${alpha}` : ""})`;
    }
    if (control.shadowPart) return shadowPartValue(el, control);
    return getComputedStyle(el).getPropertyValue(control.reads || control.prop).trim();
  }

  function applyColorValue(control, cssColor) {
    if (control.shadowPart) { applyShadowPart(control, cssColor); return; }
    applyEditProp(control, cssColor);
  }

  // ===== Token families for the panel =====
  // Built once per Edit Mode entry from whatever the stylesheet walk found.
  // A property gets a stepper only when its own value sits on a scale with
  // somewhere to step to, which is why families of one are dropped upstream.

  // Every custom property in scope on this element, with the value it resolves
  // to *there*.
  //
  // This is the inversion the whole token layer turns on. The first design
  // asked the stylesheets which names existed and then hoped each one reached
  // the element; a name that did not — because it was declared on `.dark`, or
  // on a component root, or in a sheet we were not allowed to read — resolved
  // to "" and was dropped, so which tokens the panel could see depended on
  // what you happened to have clicked.
  //
  // The element already knows. Custom properties inherit, so asking it directly
  // costs nothing and answers correctly regardless of where the declaration
  // came from: a cross-origin sheet, an @import we never followed, a shadow
  // root, a theme scope. A name that survives this has a value here, which is
  // the only kind worth offering.
  function collectElementTokens(el) {
    if (!el || !el.isConnected) return [];
    const style = getComputedStyle(el);
    const names = [];
    const seen = new Set();
    const take = (name) => {
      if (typeof name !== "string" || !name.startsWith("--")) return;
      // Our own tokens ride along on every page as content scripts. They are
      // the tool's, not the page's — see the regression in test/cdp.mjs.
      if (seen.has(name) || isOurs.name(name)) return;
      seen.add(name);
      names.push(name);
    };

    // computedStyleMap has enumerated custom properties since Chrome 66;
    // getComputedStyle only since 141. Trying it first is what keeps this
    // working on the older half. test/cdp.mjs asserts both, so a browser that
    // changes its mind reports it there rather than as silence here.
    if (el.computedStyleMap) {
      try {
        for (const [name] of el.computedStyleMap()) take(name);
      } catch { /* fall through to the declaration list */ }
    }
    if (names.length === 0) {
      try {
        for (const name of style) take(name);
      } catch { /* neither enumerates: the walk below is the floor */ }
    }
    // Older still. The stylesheet-derived names are what this used to be, so a
    // browser that enumerates nothing degrades to the previous behaviour
    // rather than to no tokens at all.
    if (names.length === 0 && tokenIndex) {
      for (const name of tokenIndex.varNames) take(name);
    }

    const out = [];
    for (const name of names) {
      const value = style.getPropertyValue(name).trim();
      if (value) out.push({ name, value });
    }
    return out;
  }

  function buildTokenFamilies(el) {
    if (!tokenIndex || tokenIndex.disabled) return [];
    const rem = tokenRemBase();
    const em = tokenEmBase(el);
    const entries = [];

    for (const { name, value } of collectElementTokens(el)) {
      const resolved = resolveLength(value, rem, em);
      if (resolved !== null) entries.push({ name, resolved });
    }
    // Utility classes are scales too — text-sm and text-lg are rungs whether
    // or not the page also declares a custom property for them.
    //
    // Except the multi-property ones. A class that sets several type
    // properties is a type style, and its values belong to the style row —
    // pouring them in here is how text-sm's line-height once sat as a fake
    // rung in the font-size ladder. One value, one owner.
    const styleOwned = typeStyleClassNames(tokenIndex);
    for (const [prop, candidates] of tokenIndex.classRules) {
      // Either the property itself is a scale, or it is one side of one — the
      // side is how a shorthand utility actually arrives (see FIRST_LONGHAND_OF).
      // The four sides of a .p-4 all carry the same class name and value, and
      // groupTokenFamilies de-duplicates by name, so this adds rungs rather
      // than repeats.
      if (!TOKEN_SCALE_PROPS.has(prop) && !TOKEN_SCALE_PROPS.has(SHORTHAND_OF[prop])) continue;
      for (const candidate of candidates) {
        if (styleOwned.has(candidate.className)) continue;
        const resolved = resolveLength(candidate.value, rem, em);
        if (resolved !== null) entries.push({ name: candidate.className, resolved, kind: "class" });
      }
    }
    return groupTokenFamilies(entries);
  }

  // Which properties a class-based scale is allowed to be read from. Without
  // this, a .p-4 that also sets margin would offer padding rungs for margin.
  const TOKEN_SCALE_PROPS = new Set([
    "font-size", "padding", "margin", "gap", "row-gap", "column-gap",
    "border-radius", "border-width", "line-height", "letter-spacing",
  ]);

  // The family a control should step along: the one its current value sits on,
  // or — when the value is off-scale — the one whose name matches the property
  // most closely. Never a guess: if nothing matches, there is no stepper.
  function familyForControl(el, control) {
    if (!editTokenFamilies || editTokenFamilies.length === 0) return null;
    const detected = detectPropertyToken(el, control.reads || control.prop,
      getComputedStyle(el).getPropertyValue(control.reads || control.prop).trim(), tokenIndex);
    if (detected) {
      const owner = editTokenFamilies.find((f) => f.members.some((m) => m.name === detected.name));
      if (owner) return owner;
    }
    return null;
  }

  // Colour tokens in scope on this element, for the picker's palette. Only
  // names that resolve to a colour are offered — a --space-4 has no business in
  // a swatch row.
  //
  // In scope on *this element*, not declared somewhere on the page: selecting
  // inside a themed subtree offers that theme's colours, because those are the
  // ones the element would actually get.
  function paletteTokens(el) {
    const out = [];
    for (const { name, value } of collectElementTokens(el)) {
      const parsed = resolveColor(value);
      if (parsed) out.push({ name, css: value, hex: formatHex(parsed) });
      if (out.length >= 24) break;
    }
    return out;
  }

  function showEditPanel() {
    removeEditPanel();

    editPanelEl = document.createElement("div");
    editPanelEl.id = "pnt-edit-panel";

    const head = document.createElement("div");
    head.className = "pnt-edit-head";

    const back = document.createElement("button");
    back.className = "pnt-edit-back";
    back.innerHTML = ICONS.back;
    back.title = "Back to selection";
    back.setAttribute("aria-label", "Back to selection");
    back.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitEditMode();
    });

    const identity = document.createElement("span");
    identity.className = "pnt-edit-id";
    identity.innerHTML = editPanelIdentity(selectedElement);

    const degraded = document.createElement("span");
    degraded.className = "pnt-edit-degraded";
    degraded.setAttribute("aria-hidden", "true");

    const copy = document.createElement("button");
    copy.className = "pnt-edit-act pnt-edit-copy";
    // origHtml is what setButtonSuccess puts back, and without it the button
    // never came back at all: it stayed disabled, wearing its success state,
    // for as long as the panel was open. The count badge lives inside the
    // markup being saved, and paintEditCounts writes to whichever <i> is on
    // screen, so the restored copy picks the number up again.
    copy.dataset.origHtml = `${ICONS.code}<i class="pnt-edit-count"></i>`;
    copy.innerHTML = copy.dataset.origHtml;
    copy.title = "Copy every edit";
    copy.setAttribute("aria-label", "Copy every edit");
    copy.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyEdits(copy);
    });

    const resetAll = document.createElement("button");
    resetAll.className = "pnt-edit-act pnt-edit-resetall";
    resetAll.textContent = "↺";
    resetAll.title = "Reset every edit";
    resetAll.setAttribute("aria-label", "Reset every edit");
    resetAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetAllEdits();
      refreshEditControls();
    });

    head.appendChild(back);
    head.appendChild(identity);
    head.appendChild(degraded);
    head.appendChild(copy);
    head.appendChild(resetAll);
    head.addEventListener("pointerdown", onEditDragStart);

    const body = document.createElement("div");
    body.className = "pnt-edit-body";

    // Delegated rather than per-row: the rows are rebuilt whenever the panel
    // re-renders, and listeners hung on them would have to be rebuilt with
    // them. pointerover/pointerout bubble, so the body can watch for all of
    // them. A row under the pointer is the earliest honest signal that the
    // user is about to change something, so it is what wakes the tether.
    body.addEventListener("pointerover", (e) => {
      if (e.target.closest(".pnt-edit-row")) setTetherLoud(true);
    });
    body.addEventListener("pointerout", (e) => {
      const row = e.target.closest(".pnt-edit-row");
      if (!row || row.contains(e.relatedTarget)) return;
      if (!editGesture) setTetherLoud(false);
    });

    // The rows scroll inside the panel while the picker is anchored in viewport
    // coordinates, so without this the swatch slides out from under its own
    // picker.
    body.addEventListener("scroll", repositionColorPicker, { passive: true });

    editPanelEl.appendChild(head);
    editPanelEl.appendChild(body);

    // The keyboard ladder for this mode, made visible — and only what is
    // bound: one undo timeline, its redo, and Escape back to the selection.
    const foot = document.createElement("div");
    foot.className = "pnt-edit-foot";
    foot.setAttribute("aria-hidden", "true");
    foot.innerHTML =
      `<span><kbd class="pnt-kbd">⌘Z</kbd>undo</span>` +
      `<span><kbd class="pnt-kbd">⇧⌘Z</kbd>redo</span>` +
      `<span><kbd class="pnt-kbd">esc</kbd>back</span>`;
    editPanelEl.appendChild(foot);
    document.documentElement.appendChild(editPanelEl);

    seedSplitControls(selectedElement);
    renderEditControls();
    paintDegradedMarker();
    placeEditPanel();
  }

  // A control whose four sides already disagree opens showing all four. The
  // linked row reads one longhand and would otherwise display a number that is
  // true of one side and false of three — and a single drag would then write
  // that number to all four, flattening spacing nobody asked to flatten.
  function seedSplitControls(el) {
    editSplit.clear();
    if (!el || !el.isConnected) return;
    const style = getComputedStyle(el);
    for (const group of EDIT_GROUPS) {
      for (const control of group.controls) {
        if (!control.sides) continue;
        if (sidesDiffer(style, control)) editSplit.add(control.prop);
      }
    }
  }

  function sidesDiffer(style, control) {
    const values = control.sides.map((prop) => style.getPropertyValue(prop).trim());
    return new Set(values).size > 1;
  }

  // Collapse four sides onto the first one's value, as one undoable step. The
  // first side is the one the linked row would have shown, so what the user
  // gets is what the row was already claiming.
  function mergeSides(control) {
    const el = selectedElement;
    if (!el || !el.isConnected) return;
    const value = getComputedStyle(el).getPropertyValue(control.sides[0]).trim();
    if (!value) return;
    commitEditGesture();
    beginEditGesture(el, control.prop);
    // The sides were edited as longhands; they have to stop being edits, or
    // the shorthand and its own longhands would both sit in the delta saying
    // different things.
    const record = editRegistry.get(el);
    if (record) for (const side of control.sides) record.props.delete(side);
    setEditValue(el, control.prop, {
      css: value,
      inline: value,
      priority: neededPriority(el, control.prop),
      cls: null,
      token: null,
    });
    commitEditGesture();
  }

  // What the panel can say about why a scale is not on offer. Only failures —
  // a page that simply has no design tokens is not a problem to report, and
  // saying so on every ordinary page would train the marker into wallpaper.
  function degradedReason() {
    if (!editing || !tokenIndex) return null;
    if (tokenIndex.disabled) {
      return "This page has too many CSS rules to scan, so its design tokens aren't offered here.";
    }
    if (tokenIndex.suspect) {
      return "This page's stylesheets could be read but nothing came back, so design tokens aren't offered here.";
    }
    if (tokenIndex.blocked > 0) {
      const n = tokenIndex.blocked;
      const pending = (tokenIndex.blockedHrefs || []).some((href) => !fetchedSheets.has(href));
      // Blocked to the page is no longer the same as lost: the worker fetches
      // what it can, so this says which of the two states we are actually in.
      return pending
        ? `${n} stylesheet${n > 1 ? "s" : ""} on this page can't be read from a script ` +
          `(they're served from another origin). Fetching ${n > 1 ? "them" : "it"} separately — ` +
          `any design tokens ${n > 1 ? "they define" : "it defines"} will appear once ${n > 1 ? "they arrive" : "it arrives"}.`
        : `${n} stylesheet${n > 1 ? "s" : ""} on this page couldn't be read or fetched, ` +
          `so any design tokens ${n > 1 ? "they define" : "it defines"} aren't offered here.`;
    }
    return null;
  }

  function paintDegradedMarker() {
    if (!editPanelEl) return;
    const marker = editPanelEl.querySelector(".pnt-edit-degraded");
    if (!marker) return;
    const reason = degradedReason();
    marker.classList.toggle("pnt-edit-on", Boolean(reason));
    marker.title = reason || "";
  }

  // ===== Edit Controls =====
  // Stacked sections, one row per property: a dirty dot, a label, and the
  // control. The dot is both the "this is edited" mark and the way to take one
  // property back, which is why it sits with the row rather than in a menu.

  function renderEditControls() {
    if (!editPanelEl || !selectedElement) return;
    const body = editPanelEl.querySelector(".pnt-edit-body");
    body.textContent = "";

    for (const group of groupsFor(selectedElement)) {
      // Typography wears the grid: the group the panel spends most of its
      // height on, and the one with a composite style to name. Everything
      // else keeps the classic rows.
      if (group.key === "typography") {
        body.appendChild(renderTypographySection(group));
        continue;
      }
      const section = document.createElement("div");
      section.className = "pnt-edit-group";

      const legend = document.createElement("p");
      legend.className = "pnt-edit-legend";
      legend.textContent = group.label;
      section.appendChild(legend);

      // A group whose property the element does not have yet. In standard mode
      // it offers to add one, so the affordance is always in the same place;
      // in adaptive mode the group is simply not there, and the panel is only
      // as tall as this element needs.
      if (group.add && group.has && !group.has(selectedElement) &&
          !isEditedProp(selectedElement, Object.keys(group.add)[0])) {
        if (editPrefs.editGroups === "adaptive") continue;
        section.appendChild(buildAddRow(group));
        body.appendChild(section);
        continue;
      }

      for (const control of controlsOf(group, selectedElement)) {
        section.appendChild(buildEditRow(control));
        if (control.sides && editSplit.has(control.prop)) {
          for (let i = 0; i < control.sides.length; i++) {
            section.appendChild(buildEditRow(sideControl(control, i), true));
          }
        }
      }
      body.appendChild(section);
    }

    // Advanced sits last and only when detection found something — never an
    // empty shell. It ignores the editGroups preference on purpose: a section
    // that exists only when relevant is already adaptive.
    const advanced = renderAdvancedSection();
    if (advanced) body.appendChild(advanced);

    refreshEditControls();
    // This render just destroyed every swatch, the open picker's anchor among
    // them — reachable from a theme change, the reset dot, a split link, or an
    // undo taken mid-pick. Re-find the anchor, or close if its row is gone.
    repositionColorPicker();
  }

  // ===== Typography Grid =====
  // The round-three design: text row (with the long-text editor's ⤢), the
  // style row when a composite is in force, then a three-up grid of
  // micro-labelled cells. The tick vocabulary: a filled corner tick means
  // the value comes from the claimed style, a hollow one means the cell sits
  // on its own single-prop token, a dashed border means covered-but-drifted.
  // The caption line under the grid names whatever the pointer touches.

  const TYPE_CELL_LABEL = {
    "font-size": "size", "font-weight": "weight", "line-height": "leading",
    "letter-spacing": "tracking", "text-align": "align", color: "colour",
  };

  function renderTypographySection(group) {
    const el = selectedElement;
    const section = document.createElement("div");
    section.className = "pnt-edit-group pnt-type";

    const legend = document.createElement("p");
    legend.className = "pnt-edit-legend";
    legend.textContent = group.label;
    section.appendChild(legend);

    const controls = controlsOf(group, el);

    // The words, with a way out for long ones.
    const textControl = controls.find((c) => c.kind === "text");
    if (textControl) {
      const row = buildEditRow(textControl);
      const expand = document.createElement("button");
      expand.className = "pnt-edit-expand";
      expand.textContent = "⤢";
      expand.title = "Edit the full text";
      expand.setAttribute("aria-label", "Edit the full text");
      expand.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (textEditorEl) closeTextEditor();
        else openTextEditor(textControl);
      });
      row.appendChild(expand);
      section.appendChild(row);
    }

    // The composite, when one is in force.
    editTypeInForce = computeTypeInForce(el);
    editTypeClaim = detectTypeStyle(el);
    if (editTypeClaim) section.appendChild(buildTypeStyleRow(editTypeClaim));

    // The grid.
    const grid = document.createElement("div");
    grid.className = "pnt-type-grid";
    for (const control of controls) {
      if (control.kind === "text") continue;
      grid.appendChild(buildTypeCell({ ...control, gridCell: true }));
    }
    section.appendChild(grid);

    const cap = document.createElement("p");
    cap.className = "pnt-type-cap";
    section.appendChild(cap);
    section.addEventListener("pointerover", (e) => {
      const named = e.target.closest("[data-cap]");
      if (named) cap.innerHTML = named.dataset.cap;
    });
    section.addEventListener("pointerout", () => paintTypeCaption());

    refreshTypographyState();
    return section;
  }

  // A cell: micro-label above the control, the label doubling as the reset
  // the dot is elsewhere — it colours when the property is edited and takes
  // the edit back on click.
  function buildTypeCell(control) {
    const cell = document.createElement("div");
    cell.className = "pnt-edit-row pnt-type-cell";
    cell.dataset.prop = control.shadowPart ? "box-shadow" : control.prop;
    cell.dataset.control = control.prop;

    const k = document.createElement("button");
    k.className = "pnt-type-k";
    k.textContent = TYPE_CELL_LABEL[control.prop] || control.label;
    k.title = `Reset ${control.label}`;
    k.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const owner = controlTarget(control);
      if (!owner || !isEditedProp(owner, cell.dataset.prop)) return;
      resetEditProp(owner, cell.dataset.prop);
      renderEditControls();
    });
    cell.appendChild(k);

    cell.appendChild(
      control.kind === "color" ? buildColorControl(control)
        : control.kind === "segment" ? buildSegmentControl(control)
        : buildNumericControl(control)
    );

    // Loose tokenized values step on the wheel — the grid has no room for
    // the ‹ › stepper, and the caption carries the naming.
    const family = editPrefs.editTokenControls === "value"
      ? null
      : familyForControl(selectedElement, control);
    if (family && !control.kind) {
      cell.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        stepControlToken(control, family, e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }
    return cell;
  }

  function buildTypeStyleRow(claim) {
    const row = document.createElement("div");
    row.className = "pnt-edit-row pnt-type-stylerow";
    row.dataset.prop = "type-style";
    row.dataset.control = "type-style";

    const dot = document.createElement("button");
    dot.className = "pnt-edit-dot";
    dot.title = "Reset style";
    dot.setAttribute("aria-label", "Reset style");
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedElement || !isEditedProp(selectedElement, "type-style")) return;
      resetEditProp(selectedElement, "type-style");
      renderEditControls();
    });

    const label = document.createElement("span");
    label.className = "pnt-edit-label";
    label.textContent = "style";

    const chip = document.createElement("span");
    chip.className = "pnt-type-chip";
    const ladder = typeLadderFor(claim);

    if (ladder) {
      const down = document.createElement("button");
      down.className = "pnt-type-st";
      down.textContent = "‹";
      down.title = "Step the style down";
      down.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        stepTypeStyle(claim, ladder, -1);
      });
      chip.appendChild(down);
    }

    const name = document.createElement("b");
    name.className = "pnt-type-name";
    name.textContent = claim.style.name;
    chip.appendChild(name);

    if (!claim.on) {
      const mod = document.createElement("i");
      mod.className = "pnt-type-mod";
      mod.textContent = "· modified";
      chip.appendChild(mod);
      chip.classList.add("pnt-type-drifted");
      chip.title = `Conform to ${claim.style.name}`;
      chip.addEventListener("click", (e) => {
        if (e.target.closest(".pnt-type-st")) return;
        e.preventDefault();
        e.stopPropagation();
        conformTypeStyle(detectTypeStyle(selectedElement) || claim);
      });
    }

    if (ladder) {
      const up = document.createElement("button");
      up.className = "pnt-type-st";
      up.textContent = "›";
      up.title = "Step the style up";
      up.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        stepTypeStyle(claim, ladder, 1);
      });
      chip.appendChild(up);
    }

    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(chip);
    return row;
  }

  // Live state the generic refresh loop cannot know: the claim (drift moves
  // with every scrub), the ticks it implies, and the caption's idle text.
  function refreshTypographyState() {
    if (!editPanelEl || !selectedElement || !selectedElement.isConnected) return;
    const el = selectedElement;
    if (!editPanelEl.querySelector(".pnt-type")) return;
    editTypeClaim = detectTypeStyle(el);
    const claim = editTypeClaim;

    for (const cell of editPanelEl.querySelectorAll(".pnt-type-cell")) {
      const prop = cell.dataset.control;
      cell.classList.remove("pnt-type-fromstyle", "pnt-type-drift", "pnt-type-owntok");
      if (claim && claim.style.constituents[prop] !== undefined) {
        const drifted = claim.drifted.includes(prop);
        const safe = escapeHtml(claim.style.name);
        cell.classList.add(drifted ? "pnt-type-drift" : "pnt-type-fromstyle");
        cell.dataset.cap = drifted
          ? `<b>${TYPE_CELL_LABEL[prop]}</b> — drifted from ${safe}`
          : `<b>${TYPE_CELL_LABEL[prop]}</b> — from ${safe}`;
      } else {
        const control = typeControlFor(prop);
        const family = control && !control.kind && editPrefs.editTokenControls !== "value"
          ? familyForControl(el, control)
          : null;
        if (family) {
          cell.classList.add("pnt-type-owntok");
          const onRung = matchToken(family.members, numericState(el, control).value);
          cell.dataset.cap = onRung
            ? `<b>${escapeHtml(onRung.name)}</b> — wheel steps the ${escapeHtml(family.prefix)} scale`
            : `off the <b>${escapeHtml(family.prefix)}</b> scale — wheel steps to a rung`;
        } else {
          delete cell.dataset.cap;
        }
      }
    }

    const styleRow = editPanelEl.querySelector(".pnt-type-stylerow");
    if (styleRow) {
      const edited = isEditedProp(el, "type-style");
      styleRow.classList.toggle("pnt-edit-dirty", edited);
      const dot = styleRow.querySelector(".pnt-edit-dot");
      if (dot) dot.classList.toggle("pnt-edit-on", edited);
      if (claim) {
        const safe = escapeHtml(claim.style.name);
        styleRow.dataset.cap = claim.on
          ? `on <b>${safe}</b> — ${Object.keys(claim.style.constituents)
              .map((p) => TYPE_CELL_LABEL[p]).join(" + ")}`
          : `<b>${safe}</b> — drifted: ${claim.drifted
              .map((p) => TYPE_CELL_LABEL[p]).join(", ")} · click to conform`;
      }
    }
    paintTypeCaption();
  }

  function typeControlFor(prop) {
    const group = EDIT_GROUPS.find((g) => g.key === "typography");
    const control = group && group.controls.find((c) => c.prop === prop);
    return control ? { ...control, gridCell: true } : null;
  }

  function paintTypeCaption() {
    const cap = editPanelEl && editPanelEl.querySelector(".pnt-type-cap");
    if (!cap) return;
    const claim = editTypeClaim;
    cap.innerHTML = claim
      ? (claim.on
        ? `<b>${escapeHtml(claim.style.name)}</b>`
        : `<b>${escapeHtml(claim.style.name)}</b> · modified`)
      : "";
  }

  // ===== Long-text editor =====
  // The colour picker's move, for words: its own root beside the panel, so
  // the field's truncation never has the last word. Live like the field —
  // every keystroke lands — with the same exits.
  function openTextEditor(control) {
    closeTextEditor();
    const el = selectedElement;
    if (!el || !el.isConnected) return;

    const pop = document.createElement("div");
    pop.id = "pnt-text-editor";
    const head = document.createElement("div");
    head.className = "pnt-txted-head";
    const title = document.createElement("span");
    title.textContent = "Text";
    const close = document.createElement("button");
    close.textContent = "×";
    close.title = "Close";
    close.setAttribute("aria-label", "Close text editor");
    close.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTextEditor();
    });
    head.appendChild(title);
    head.appendChild(close);

    const area = document.createElement("textarea");
    area.spellcheck = false;
    area.value = readTextEditValue(el).text;
    area.addEventListener("input", () => {
      const target = selectedElement;
      if (!target || !target.isConnected) return;
      beginEditGesture(target, "text");
      setEditValue(target, "text", {
        css: area.value.trim().replace(/\s+/g, " "),
        inline: null, priority: "", cls: null, token: null,
        text: area.value,
      });
      refreshEditControls();
    });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        closeTextEditor();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const target = selectedElement;
        if (target && editGesture && editGesture.el === target && editGesture.prop === "text") {
          setEditValue(target, "text", editGesture.from);
        }
        closeTextEditor();
        return;
      }
      e.stopPropagation();
    });

    const count = document.createElement("p");
    count.className = "pnt-txted-count";
    const paintCount = () => {
      count.textContent = `${area.value.length} chars · Enter commits · Esc abandons`;
    };
    area.addEventListener("input", paintCount);
    paintCount();

    pop.appendChild(head);
    pop.appendChild(area);
    pop.appendChild(count);

    // After the panel in the document, so it paints above it — the same
    // ordering rule the picker documents.
    document.documentElement.appendChild(pop);
    textEditorEl = pop;
    positionTextEditor();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function positionTextEditor() {
    if (!textEditorEl || !editPanelEl) return;
    const panel = editPanelEl.getBoundingClientRect();
    const rect = textEditorEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const right = panel.right + GEOMETRY.gap;
    const left = right + rect.width + GEOMETRY.margin <= vw
      ? right
      : Math.max(GEOMETRY.margin, panel.left - GEOMETRY.gap - rect.width);
    const top = Math.min(Math.max(GEOMETRY.margin, panel.top),
      Math.max(GEOMETRY.margin, vh - rect.height - GEOMETRY.margin));
    textEditorEl.style.left = `${Math.round(left)}px`;
    textEditorEl.style.top = `${Math.round(top)}px`;
  }

  function closeTextEditor() {
    if (!textEditorEl) return;
    textEditorEl.remove();
    textEditorEl = null;
    commitEditGesture();
    if (editPanelEl) refreshEditControls();
  }

  // Each side of a linked control is a full control in its own right, so it
  // reads, writes and reports as its own property — which is what the source
  // will contain once only one side has changed.
  function sideControl(control, i) {
    return {
      ...control,
      sides: null,
      prop: control.sides[i],
      reads: control.sides[i],
      label: control.sideLabels[i],
      isSide: true,
    };
  }

  function buildAddRow(group) {
    const row = document.createElement("div");
    row.className = "pnt-edit-row pnt-edit-addrow";
    const button = document.createElement("button");
    button.className = "pnt-edit-add";
    button.textContent = `+ add ${group.label.toLowerCase()}`;
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = selectedElement;
      if (!el || !el.isConnected) return;
      for (const [prop, value] of Object.entries(group.add)) {
        beginEditGesture(el, prop);
        setEditValue(el, prop, {
          css: value, inline: value, priority: neededPriority(el, prop), cls: null, token: null,
        });
        commitEditGesture();
      }
      renderEditControls();
    });
    row.appendChild(button);
    return row;
  }

  function buildEditRow(control, isSide) {
    const row = document.createElement("div");
    row.className = "pnt-edit-row" + (isSide ? " pnt-edit-side" : "");
    // Shadow parts all write box-shadow, and a vec uniform's components all
    // write the whole uniform — so the row's dirty state and its reset both
    // key off the one property the registry actually holds.
    const resetProp = control.shadowPart ? "box-shadow" : (control.uniformKey || control.prop);
    row.dataset.prop = resetProp;
    row.dataset.control = control.prop;

    const dot = document.createElement("button");
    dot.className = "pnt-edit-dot";
    dot.title = `Reset ${control.label}`;
    dot.setAttribute("aria-label", `Reset ${control.label}`);
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // A uniform's edits live on the probed canvas, not the selection.
      const owner = controlTarget(control);
      if (!owner || !isEditedProp(owner, resetProp)) return;
      resetEditProp(owner, resetProp);
      renderEditControls();
    });

    const label = document.createElement("span");
    label.className = "pnt-edit-label";
    label.textContent = control.label;

    row.appendChild(dot);
    row.appendChild(label);

    // The link toggle turns one value into four and back. It sits before the
    // control so the row still lines up down the same edge either way.
    if (control.sides) {
      const split = editSplit.has(control.prop);
      const differ = selectedElement && selectedElement.isConnected &&
        sidesDiffer(getComputedStyle(selectedElement), control);
      const link = document.createElement("button");
      link.className = "pnt-edit-link";
      link.textContent = split ? "⊟" : "⊞";
      // Going back to a single value when the sides disagree is not a change
      // of view, it is an edit — it throws three of them away. The button says
      // which one it is about to do.
      link.title = !split ? "Edit each side"
        : differ ? "Merge the four sides into one value"
        : "Link all sides";
      link.setAttribute("aria-label", link.title);
      link.setAttribute("aria-pressed", String(split));
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!split) {
          editSplit.add(control.prop);
        } else {
          if (differ) mergeSides(control);
          editSplit.delete(control.prop);
        }
        renderEditControls();
      });
      row.appendChild(link);
    }

    if (control.sides && editSplit.has(control.prop)) {
      // Split: the parent row is a heading for the four beneath it.
      row.classList.add("pnt-edit-parent");
      return row;
    }

    row.appendChild(
      control.kind === "color" ? buildColorControl(control)
        : control.kind === "segment" ? buildSegmentControl(control)
        : control.kind === "text" ? buildTextControl(control)
        : buildNumericControl(control)
    );
    return row;
  }

  // The words themselves. Live like a scrub — every keystroke lands on the
  // page — with the same three exits typing a number has: Enter commits,
  // Escape abandons back to where this gesture started, blur commits.
  function buildTextControl(control) {
    const wrap = document.createElement("span");
    wrap.className = "pnt-edit-textwrap";

    const input = document.createElement("input");
    input.className = "pnt-edit-textin";
    input.type = "text";
    input.spellcheck = false;
    input.setAttribute("aria-label", control.label);

    input.addEventListener("input", () => {
      const el = selectedElement;
      if (!el || !el.isConnected) return;
      beginEditGesture(el, "text");
      setEditValue(el, "text", {
        css: input.value, inline: null, priority: "", cls: null, token: null,
        text: input.value,
      });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitEditGesture();
        input.blur();
        refreshEditControls();
        return;
      }
      if (e.key === "Escape") {
        // Abandon the typing, not the mode: put back what this gesture
        // started from, and let the commit-on-blur see nothing moved.
        e.preventDefault();
        e.stopPropagation();
        const el = selectedElement;
        if (el && editGesture && editGesture.el === el && editGesture.prop === "text") {
          setEditValue(el, "text", editGesture.from);
        }
        input.blur();
        refreshEditControls();
        return;
      }
      // Everything else is typing; it must not reach the page's shortcuts.
      e.stopPropagation();
    });
    input.addEventListener("blur", () => {
      commitEditGesture();
      refreshEditControls();
    });

    wrap.appendChild(input);
    return wrap;
  }

  function buildColorControl(control) {
    const wrap = document.createElement("span");
    wrap.className = "pnt-edit-color";

    const swatch = document.createElement("button");
    swatch.className = "pnt-edit-swatch";
    swatch.title = `Change ${control.label}`;
    swatch.setAttribute("aria-label", `Change ${control.label}`);
    const fill = document.createElement("i");
    swatch.appendChild(fill);

    const readout = document.createElement("span");
    readout.className = "pnt-edit-hex";

    swatch.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Clicking the open swatch shuts the picker. It used to reopen it: the
      // first thing openColorPicker does is close, so the picker was torn down
      // and rebuilt identically and the gesture looked like it did nothing.
      if (editPopoverEl && editPopoverProp === control.prop) {
        closeColorPicker();
        return;
      }
      openColorPicker(control, swatch);
    });

    wrap.appendChild(swatch);
    wrap.appendChild(readout);
    return wrap;
  }

  // Type, arrow, or scrub — the same three ways Figma offers, because each
  // suits a different question: typing when you know the number, arrows when
  // you are counting steps, scrubbing when you are judging by eye.
  function buildNumericControl(control) {
    const wrap = document.createElement("span");
    wrap.className = "pnt-edit-num";
    wrap.dataset.prop = control.prop;

    const input = document.createElement("input");
    input.className = "pnt-edit-input";
    input.type = "text";
    input.inputMode = "decimal";
    input.spellcheck = false;
    input.setAttribute("aria-label", control.label);

    wrap.appendChild(input);
    if (control.unit) {
      const unit = document.createElement("i");
      unit.className = "pnt-edit-unit";
      unit.textContent = control.unit;
      wrap.appendChild(unit);
    }

    input.addEventListener("keydown", (e) => onNumericKey(e, control));
    input.addEventListener("blur", () => commitNumericInput(control, input));
    // A scrub starts on the wrapper, so the drag surface is the whole chip
    // rather than only the digits.
    wrap.addEventListener("pointerdown", (e) => onNumericScrubStart(e, control, input));

    // "token" hides the raw number once a scale is available: the whole point
    // of a design system is that the pixel count is not the decision. A grid
    // cell keeps its number regardless — with no stepper beside it, hiding
    // the value would leave the cell blank.
    if (!control.gridCell && editPrefs.editTokenControls === "token" &&
        familyForControl(selectedElement, control)) {
      wrap.classList.add("pnt-edit-quiet");
    }

    const extra = [];
    if (control.auto) {
      const auto = document.createElement("button");
      auto.className = "pnt-edit-auto";
      auto.textContent = "auto";
      auto.title = `Let ${control.label} size itself`;
      auto.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleAuto(control);
      });
      extra.push(auto);
    }

    // The stepper only exists when this element's value is actually sitting on
    // one of the page's scales. Offering "‹ — ›" over a value that belongs to
    // no scale would promise a move that cannot happen. Grid cells have no
    // room for it — there, the wheel steps and the caption names.
    const family = control.gridCell || editPrefs.editTokenControls === "value"
      ? null
      : familyForControl(selectedElement, control);
    if (family) {
      const stepper = document.createElement("span");
      stepper.className = "pnt-edit-tok";
      stepper.dataset.family = family.prefix;
      const down = document.createElement("button");
      down.textContent = "‹";
      down.title = `Step ${control.label} down the ${family.prefix} scale`;
      const name = document.createElement("b");
      const up = document.createElement("button");
      up.textContent = "›";
      up.title = `Step ${control.label} up the ${family.prefix} scale`;
      down.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation(); stepControlToken(control, family, -1);
      });
      up.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation(); stepControlToken(control, family, 1);
      });
      stepper.appendChild(down);
      stepper.appendChild(name);
      stepper.appendChild(up);
      extra.push(stepper);
    }

    if (extra.length === 0) return wrap;
    const holder = document.createElement("span");
    holder.className = "pnt-edit-numwrap";
    holder.appendChild(wrap);
    for (const node of extra) holder.appendChild(node);
    return holder;
  }

  // A step along a scale, not an arithmetic nudge. When the target rung is a
  // utility class the element already wears, the edit is a class swap — that
  // is what the source contains, so that is what the delta should say.
  function stepControlToken(control, family, dir) {
    const el = selectedElement;
    if (!el || !el.isConnected) return;
    const prop = control.reads || control.prop;
    const current = resolveLength(
      getComputedStyle(el).getPropertyValue(prop).trim(), tokenRemBase(), tokenEmBase(el));
    if (current === null) return;
    const next = stepToken(family.members, current, dir);
    if (!next) return;

    const detected = detectPropertyToken(el, prop, getComputedStyle(el).getPropertyValue(prop).trim(), tokenIndex);
    const isVar = next.name.startsWith("--");
    const asClass = detected && detected.kind === "class" && !isVar;

    // A var rung is applied as the var() itself, so the source keeps its
    // indirection instead of being flattened to a pixel count. Inline always
    // outranks a stylesheet, so this always takes.
    //
    // `cls` stays whatever the element already wore: this path overrides the
    // value, it does not take the element's class away. Without that, falling
    // back from a class step would strip the class it started with.
    const keepClass = detected && detected.kind === "class" ? detected.name : null;
    const valueEdit = {
      css: `${next.resolved}px`,
      inline: isVar ? `var(${next.name})` : `${next.resolved}px`,
      priority: neededPriority(el, control.prop),
      cls: keepClass,
      token: isVar ? { kind: "var", name: next.name } : null,
    };

    beginEditGesture(el, control.prop);
    if (asClass) {
      // A class swap carries the value on the class, so nothing is written
      // inline — which also means the class has to win the cascade to have any
      // effect at all.
      setEditValue(el, control.prop, {
        css: `${next.resolved}px`, inline: null, priority: "",
        cls: next.name, token: { kind: "class", name: next.name },
      });
      const got = resolveLength(
        getComputedStyle(el).getPropertyValue(prop).trim(), tokenRemBase(), tokenEmBase(el));
      if (got === null || Math.abs(got - next.resolved) > 0.5) {
        // The page outranks its own utility class — `.card p` beats `.text-lg`
        // on specificity, and this is common. Reporting "text-sm → text-base"
        // would be advice that does nothing in the source either, so take the
        // class back off and change the value instead.
        setEditValue(el, control.prop, valueEdit);
      }
    } else {
      setEditValue(el, control.prop, valueEdit);
    }
    commitEditGesture();
    renderEditControls();
  }

  function buildSegmentControl(control) {
    const seg = document.createElement("span");
    seg.className = "pnt-edit-seg";
    seg.dataset.prop = control.prop;
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", control.label);

    for (const option of control.options) {
      const button = document.createElement("button");
      button.dataset.value = option;
      button.setAttribute("role", "radio");
      button.title = option;
      button.textContent = { left: "≡", center: "≡", right: "≡" }[option] || option;
      button.classList.add(`pnt-edit-align-${option}`);
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyEditProp(control, option);
        commitEditGesture();
        refreshEditControls();
      });
      seg.appendChild(button);
    }
    return seg;
  }

  // ===== Edit Colour Picker =====
  // A saturation square, a hue rail and an alpha rail — the react-colorful
  // shape, rebuilt on our own tokens rather than pulled in as a dependency.
  // HSV rather than HSL because the square is only linear in S and V, which is
  // what makes dragging it feel like picking a colour instead of solving one.
  //
  // Above the square sits whatever colour tokens the page declares: those are
  // the values the source can actually name, so they get first offer.

  function openColorPicker(control, anchor) {
    closeColorPicker();
    const el = selectedElement;
    if (!el || !el.isConnected) return;

    // resolveColor, not parseCssColor: an element whose colour is authored in
    // oklch() would otherwise open the picker on black and lose the value the
    // moment anything was dragged.
    const parsed = resolveColor(readColorValue(el, control)) || { r: 0, g: 0, b: 0, a: 1 };
    let hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    let alpha = parsed.a;

    const pop = document.createElement("div");
    // Its own root, so it is no longer clipped by the panel's overflow, no
    // longer width-locked to it, and no longer painted over the rows it is
    // meant to be tuning. The class stays for the styling and for the tests
    // that find it by class.
    pop.id = "pnt-color-picker";
    pop.className = "pnt-edit-pop";
    pop.innerHTML = `
      <div class="pnt-edit-pophead">
        <span class="pnt-edit-poptitle"></span>
        <button class="pnt-edit-popclose" title="Close" aria-label="Close colour picker">×</button>
      </div>
      <div class="pnt-edit-sat"><i class="pnt-edit-sat-dot"></i></div>
      <div class="pnt-edit-rails">
        <div class="pnt-edit-hue"><i class="pnt-edit-rail-dot"></i></div>
        <div class="pnt-edit-alpha"><span></span><i class="pnt-edit-rail-dot"></i></div>
      </div>
      <div class="pnt-edit-popfoot">
        <input class="pnt-edit-hexin" type="text" spellcheck="false" aria-label="Hex colour">
        <button class="pnt-edit-drop" title="Pick a colour from the page" aria-label="Pick a colour from the page">◎</button>
      </div>`;

    const sat = pop.querySelector(".pnt-edit-sat");
    const satDot = pop.querySelector(".pnt-edit-sat-dot");
    const hue = pop.querySelector(".pnt-edit-hue");
    const hueDot = hue.querySelector(".pnt-edit-rail-dot");
    const alphaRail = pop.querySelector(".pnt-edit-alpha");
    const alphaFill = alphaRail.querySelector("span");
    const alphaDot = alphaRail.querySelector(".pnt-edit-rail-dot");
    const hexIn = pop.querySelector(".pnt-edit-hexin");
    const drop = pop.querySelector(".pnt-edit-drop");

    // The picker no longer sits under the row it belongs to, so it has to say
    // which property it is editing.
    pop.querySelector(".pnt-edit-poptitle").textContent = control.label;
    pop.querySelector(".pnt-edit-popclose").addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeColorPicker();
    });

    const tokens = paletteTokens(el);
    if (tokens.length) {
      const palette = document.createElement("div");
      palette.className = "pnt-edit-palette";

      // The swatches are 14px of colour and nothing else: without this the row
      // neither says what it is nor which token any square stands for. The
      // title attribute carried the name, but a native tooltip takes about a
      // second and the target is smaller than the cursor — a name you have to
      // wait for is a name most people never see. The caption is always
      // present, so naming a swatch costs no layout and the row cannot jump
      // under the pointer.
      const caption = document.createElement("div");
      caption.className = "pnt-edit-palcap";
      const capName = document.createElement("b");
      const capValue = document.createElement("span");
      caption.appendChild(capName);
      caption.appendChild(capValue);

      const idleCaption = () => {
        capName.textContent = "";
        capValue.textContent = "page tokens";
      };
      const nameCaption = (token) => {
        capName.textContent = token.name;
        capValue.textContent = token.hex;
      };
      idleCaption();

      for (const token of tokens) {
        const swatch = document.createElement("button");
        swatch.className = "pnt-edit-pal";
        swatch.style.backgroundColor = token.hex;
        // Kept as well as the caption: it is what a screen reader reads, and
        // what survives if the pointer never enters at all.
        swatch.title = `${token.name} — ${token.hex}`;
        swatch.setAttribute("aria-label", `${token.name}, ${token.hex}`);
        swatch.addEventListener("pointerenter", () => nameCaption(token));
        swatch.addEventListener("pointerleave", idleCaption);
        // Keyboard reaches these too, and a caption that only answers to the
        // mouse would leave tabbing through the row silent.
        swatch.addEventListener("focus", () => nameCaption(token));
        swatch.addEventListener("blur", idleCaption);
        swatch.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // A token pick names the token, so the delta can say so.
          const rgb = parseCssColor(token.hex);
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          alpha = rgb.a;
          commit({ kind: "var", name: token.name });
          paint();
        });
        palette.appendChild(swatch);
      }
      // Still first offer, but below the title bar rather than above it: the
      // header names what is being edited and carries the way out, so it stays
      // the top edge of the surface.
      pop.querySelector(".pnt-edit-pophead").after(palette);
      palette.after(caption);
    }

    const currentCss = () => {
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      return alpha >= 1
        ? formatHex({ ...rgb })
        : `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${Number(alpha.toFixed(3))})`;
    };

    // Direct assignments rather than setProperty, deliberately: setProperty is
    // one of the verbs test/edit-audit.mjs reserves for the Edit Apply section,
    // and keeping it out of here is what lets that audit stay a simple, exact
    // rule instead of one that has to reason about receivers. The gradients
    // themselves stay in content.css; only the colour under them comes from JS.
    function paint() {
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      const hex = formatHex(rgb);
      sat.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`;
      satDot.style.left = `${hsv.s * 100}%`;
      satDot.style.top = `${(1 - hsv.v) * 100}%`;
      satDot.style.backgroundColor = hex;
      hueDot.style.left = `${(hsv.h / 360) * 100}%`;
      alphaDot.style.left = `${alpha * 100}%`;
      alphaFill.style.backgroundImage = `linear-gradient(to right, transparent, ${hex})`;
      if (document.activeElement !== hexIn) hexIn.value = hex;
      // Re-found rather than held: the swatch this picker opened from is
      // destroyed by every re-render of the rows, and the captured node would
      // then take the live preview with it into a detached tree.
      const swatchFill = editPanelEl && editPanelEl.querySelector(
        `.pnt-edit-row[data-control="${control.prop}"] .pnt-edit-swatch i`
      );
      if (swatchFill) swatchFill.style.background = currentCss();
    }

    function commit(token) {
      const el2 = controlTarget(control);
      if (!el2 || !el2.isConnected) return;
      const css = currentCss();
      if (control.uniform) {
        // The picker's rgb back to 0–1 floats; a vec4's fourth lane is the
        // alpha rail.
        beginEditGesture(el2, control.uniformKey);
        const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
        const vec = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
        if (control.uniform.comps === 4) vec.push(Math.min(1, Math.max(0, alpha)));
        setUniformValue(control, vec, token || null);
      } else if (control.shadowPart) {
        beginEditGesture(el2, "box-shadow");
        applyShadowPart(control, css);
      } else {
        beginEditGesture(el2, control.prop);
        setEditValue(el2, control.prop, {
          css, inline: css,
          priority: control.forceImportant ? "important" : neededPriority(el2, control.prop),
          cls: null,
          token: token || null,
        });
      }
      refreshEditControls();
    }

    // One drag handler for all three surfaces: they differ only in what a
    // position means.
    const dragSurface = (node, onMove) => {
      node.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rect = node.getBoundingClientRect();
        const apply = (e2) => {
          const x = Math.min(1, Math.max(0, (e2.clientX - rect.left) / rect.width));
          const y = Math.min(1, Math.max(0, (e2.clientY - rect.top) / rect.height));
          onMove(x, y);
          paint();
          commit(null);
        };
        node.setPointerCapture(ev.pointerId);
        apply(ev);
        const move = (e2) => apply(e2);
        const up = () => {
          node.removeEventListener("pointermove", move);
          node.removeEventListener("pointerup", up);
          node.removeEventListener("pointercancel", up);
          commitEditGesture();
          refreshEditControls();
        };
        node.addEventListener("pointermove", move);
        node.addEventListener("pointerup", up);
        node.addEventListener("pointercancel", up);
      });
    };

    dragSurface(sat, (x, y) => { hsv = { h: hsv.h, s: x, v: 1 - y }; });
    dragSurface(hue, (x) => { hsv = { h: x * 360, s: hsv.s, v: hsv.v }; });
    dragSurface(alphaRail, (x) => { alpha = x; });

    hexIn.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key !== "Enter") return;
      const rgb = parseCssColor(hexIn.value.trim());
      if (!rgb) { paint(); return; }
      hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      alpha = rgb.a;
      paint();
      commit(null);
      commitEditGesture();
    });

    // Chromium only, and only from a user gesture — so it is offered when it
    // exists and simply absent when it does not, rather than failing on click.
    if (window.EyeDropper) {
      drop.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const result = await new window.EyeDropper().open();
          const rgb = parseCssColor(result.sRGBHex);
          if (!rgb) return;
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          alpha = 1;
          paint();
          commit(null);
          commitEditGesture();
        } catch { /* the user pressed Escape; nothing to report */ }
      });
    } else {
      drop.remove();
    }

    // Appended to the root, after the panel. --pnt-z-chrome is already
    // 2147483647, so the picker cannot outrank the panel by z-index — being
    // later in the document is what puts it on top, and is why this append
    // cannot become an insertBefore.
    document.documentElement.appendChild(pop);
    editPopoverEl = pop;
    editPopoverProp = control.prop;
    positionColorPicker(pop, anchor);
    paint();
  }

  // Beside the panel rather than over it: the picker's whole reason for moving
  // out was that the rows it edits have to stay visible while it is open. Right
  // of the panel by preference, left when the panel is parked against the right
  // edge, and clamped into the viewport either way.
  function positionColorPicker(pop, anchor) {
    if (!editPanelEl) return;
    const panel = editPanelEl.getBoundingClientRect();
    const rect = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    const right = panel.right + GEOMETRY.gap;
    const left = right + rect.width + GEOMETRY.margin <= vw
      ? right
      : Math.max(GEOMETRY.margin, panel.left - GEOMETRY.gap - rect.width);

    // Level with the swatch that opened it, so the eye can pair the two even
    // once they are no longer nested.
    const wanted = anchor.getBoundingClientRect().top;
    const top = Math.min(
      Math.max(GEOMETRY.margin, wanted),
      Math.max(GEOMETRY.margin, vh - rect.height - GEOMETRY.margin)
    );

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  // The anchor swatch is rebuilt on every render of the rows, so the picker
  // cannot hold a reference to it. Re-find it by property; if the row it edits
  // has gone, the picker has nothing left to point at.
  function repositionColorPicker() {
    if (!editPopoverEl) return;
    const anchor = editPanelEl && editPanelEl.querySelector(
      `.pnt-edit-row[data-control="${editPopoverProp}"] .pnt-edit-swatch`
    );
    if (!anchor) {
      closeColorPicker();
      return;
    }
    positionColorPicker(editPopoverEl, anchor);
  }

  function closeColorPicker() {
    if (!editPopoverEl) return;
    editPopoverEl.remove();
    editPopoverEl = null;
    editPopoverProp = null;
    commitEditGesture();
  }

  // ===== Edit Control values =====

  function readComputed(el, control) {
    // A uniform has no computed style; its display form comes off the bridge
    // state. This is what the segment control's refresh compares against.
    if (control.uniform) {
      const vec = currentUniformValue(control.uniform.name);
      return vec ? formatUniformValue(vec, control.uniform.type) : "";
    }
    return getComputedStyle(el).getPropertyValue(control.reads || control.prop).trim();
  }

  // The number a control shows. `autoWord` covers the properties whose computed
  // value can be a keyword rather than a length (line-height and letter-spacing
  // both report "normal" when nothing has set them), where the honest display
  // is that there is no number yet.
  function numericState(el, control) {
    if (control.uniform) {
      const vec = currentUniformValue(control.uniform.name);
      return { auto: false, value: vec ? vec[Math.max(0, control.uniform.part)] || 0 : 0 };
    }
    if (control.shadowPart) return { auto: false, value: shadowPartValue(el, control) };
    const raw = readComputed(el, control);
    if (control.autoWord && raw === control.autoWord) {
      const base = parseFloat(getComputedStyle(el).fontSize) || 16;
      return { auto: true, value: control.prop === "line-height" ? Math.round(base * 1.2) : 0 };
    }
    const n = parseFloat(raw);
    const value = isFinite(n) ? n : 0;
    // opacity is the one control whose displayed unit is not its CSS unit:
    // people say 60%, the property says 0.6.
    return { auto: false, value: control.scale ? value * control.scale : value };
  }

  // The stepper is 60px wide and the family prefix is already its title, so
  // only the step itself needs to fit: "--title-lg" reads as "lg".
  function shortTokenName(name) {
    const split = splitTokenName(name);
    return split ? split.step : name;
  }

  const roundTo = (n, decimals) => {
    const f = Math.pow(10, decimals || 0);
    return Math.round(n * f) / f;
  };

  const formatNumeric = (n, control) =>
    String(roundTo(n, control.decimals || 0));

  function applyEditProp(control, cssValue) {
    // A uniform is not a declaration; its write path is the bridge, behind
    // the same door (see the uniform branch in applyEditValue).
    if (control.uniform) {
      applyUniformCss(control, cssValue);
      return;
    }
    const el = selectedElement;
    if (!el || !el.isConnected) return;
    setEditValue(el, control.prop, {
      css: cssValue,
      inline: cssValue,
      // A custom property a CSS animation is driving needs !important from
      // the first write: the animation outranks plain inline, and the
      // verify-and-escalate check cannot see that — the animated value moves
      // between its two reads on its own, which reads as success.
      priority: control.forceImportant ? "important" : neededPriority(el, control.prop),
      cls: null,
      token: null,
    });
  }

  function applyNumeric(control, next) {
    const clamped = Math.min(control.max, Math.max(control.min, next));
    if (control.uniform) {
      applyUniformPart(control, clamped);
      refreshEditControls();
      return clamped;
    }
    if (control.shadowPart) {
      applyShadowPart(control, clamped);
      refreshEditControls();
      return clamped;
    }
    const isKeyword = control.autoWord && control.autoEquals === clamped;
    const css = control.scale
      ? String(roundTo(clamped / control.scale, 3))
      : formatNumeric(clamped, control) + (control.unit || "");
    applyEditProp(control, isKeyword ? control.autoWord : css);
    refreshEditControls();
    return clamped;
  }

  function toggleAuto(control) {
    const el = selectedElement;
    if (!el || !el.isConnected) return;
    const record = editRegistry.get(el);
    const entry = record && record.props.get(control.prop);
    const isAuto = entry ? entry.after.css === "auto" : !el.style.getPropertyValue(control.prop);
    if (isAuto) {
      applyNumeric(control, numericState(el, control).value);
    } else {
      applyEditProp(control, "auto");
      refreshEditControls();
    }
    commitEditGesture();
    refreshEditControls();
  }

  function onNumericKey(e, control) {
    const input = e.currentTarget;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const step = control.step * (e.shiftKey ? 10 : 1);
      const current = parseFloat(input.value);
      const target = controlTarget(control);
      if (!target || !target.isConnected) return;
      const base = isFinite(current) ? current : numericState(target, control).value;
      beginEditGesture(target, control.prop);
      const applied = applyNumeric(control, roundTo(base + dir * step, control.decimals || 0));
      // The field keeps focus while arrowing, and refreshEditControls leaves
      // focused fields alone so it cannot type over you — so stepping has to
      // write the new number itself. Without this the field shows the old
      // value and the eventual blur commits it, undoing every step taken.
      input.value = formatNumeric(applied, control);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitNumericInput(control, input);
      input.blur();
      return;
    }
    if (e.key === "Escape") {
      // Escape in a field abandons the typing, not the mode — the panel's own
      // Escape stage only applies once the field has given the key back.
      e.stopPropagation();
      e.preventDefault();
      refreshEditControls();
      input.blur();
      return;
    }
    // Everything else is typing; it must not reach the page's shortcuts.
    e.stopPropagation();
  }

  function commitNumericInput(control, input) {
    const el = controlTarget(control);
    if (!el || !el.isConnected) return;
    const typed = parseFloat(input.value);
    if (!isFinite(typed)) { refreshEditControls(); return; }
    beginEditGesture(el, control.prop);
    applyNumeric(control, typed);
    commitEditGesture();
    refreshEditControls();
  }

  // Pointer-down on a value is ambiguous until it moves: a click means "let me
  // type", a drag means "let me judge". So the gesture stays undecided for a
  // few pixels, and only then takes the focus away and starts scrubbing.
  function onNumericScrubStart(e, control, input) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = controlTarget(control);
    if (!el || !el.isConnected) return;

    const startX = e.clientX;
    const start = numericState(el, control).value;
    const wrap = e.currentTarget;
    let scrubbing = false;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!scrubbing) {
        if (Math.abs(dx) < 3) return;
        scrubbing = true;
        wrap.classList.add("pnt-edit-scrubbing");
        beginEditGesture(el, control.prop);
        suppressTransitions(el);
        if (document.activeElement === input) input.blur();
      }
      // Two pixels per step keeps a full-width drag inside a sane range while
      // still landing on every value; Shift multiplies the step, not the speed.
      const step = control.step * (ev.shiftKey ? 10 : 1);
      applyNumeric(control, roundTo(start + Math.round(dx / 2) * step, control.decimals || 0));
    };
    const up = () => {
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", up);
      wrap.removeEventListener("pointercancel", up);
      wrap.classList.remove("pnt-edit-scrubbing");
      if (scrubbing) {
        releaseTransitions(el);
        commitEditGesture();
        refreshEditControls();
      } else {
        input.focus();
        input.select();
      }
    };

    wrap.setPointerCapture(e.pointerId);
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
  }

  // Repaint every control from the element's current state. Called after any
  // change, including undo, so what the panel shows is never a guess.
  function refreshEditControls() {
    if (!editPanelEl || !selectedElement || !selectedElement.isConnected) return;
    const el = selectedElement;

    // Every row, including the four sides a split control expands into, plus
    // whatever the Advanced section put up this render.
    const allControls = [];
    for (const group of EDIT_GROUPS) {
      for (const control of group.controls) {
        allControls.push(control);
        if (control.sides) {
          for (let i = 0; i < control.sides.length; i++) allControls.push(sideControl(control, i));
        }
      }
    }
    for (const control of advancedControls) allControls.push(control);

    for (const control of allControls) {
      {
        const row = editPanelEl.querySelector(`.pnt-edit-row[data-control="${control.prop}"]`);
        if (!row) continue;

        // A uniform's edits live on the probed canvas rather than on the
        // selection; everything the row reads has to look there.
        const target = control.uniform ? (advancedState && advancedState.canvasEl) : el;
        if (!target) continue;

        const edited = isEditedProp(target, row.dataset.prop);
        row.classList.toggle("pnt-edit-dirty", edited);
        const dot = row.querySelector(".pnt-edit-dot");
        if (dot) dot.classList.toggle("pnt-edit-on", edited);

        if (control.kind === "color") {
          const raw = readColorValue(target, control);
          const parsed = resolveColor(raw);
          const fill = row.querySelector(".pnt-edit-swatch i");
          if (fill) fill.style.background = raw || "transparent";
          const hex = row.querySelector(".pnt-edit-hex");
          if (hex) {
            const entry = editRegistry.get(target)?.props.get(row.dataset.prop);
            const token = entry && entry.after && entry.after.token;
            hex.textContent = token ? token.name : parsed ? formatHex(parsed) : raw;
            hex.classList.toggle("pnt-edit-token", Boolean(token));
          }
          continue;
        }

        if (control.kind === "segment") {
          const raw = readComputed(target, control);
          const value = (control.equivalents && control.equivalents[raw]) || raw;
          for (const button of row.querySelectorAll(".pnt-edit-seg button")) {
            button.setAttribute("aria-checked", String(button.dataset.value === value));
          }
          continue;
        }

        if (control.kind === "text") {
          const input = row.querySelector(".pnt-edit-textin");
          // Typing must never be overwritten mid-keystroke — same rule the
          // numeric fields keep.
          if (input && document.activeElement !== input) {
            input.value = getDirectText(target);
          }
          continue;
        }

        const input = row.querySelector(".pnt-edit-input");
        if (!input) continue;
        const record = editRegistry.get(target);
        const entry = record && record.props.get(control.prop);
        const isAuto = entry
          ? entry.after.css === "auto"
          : control.auto && !target.style.getPropertyValue(control.prop);
        const state = numericState(target, control);
        // Typing must never be overwritten mid-keystroke.
        if (document.activeElement !== input) {
          input.value = formatNumeric(state.value, control);
        }
        const wrap = row.querySelector(".pnt-edit-num");
        if (wrap) wrap.classList.toggle("pnt-edit-untouched", isAuto || state.auto);
        const auto = row.querySelector(".pnt-edit-auto");
        if (auto) auto.setAttribute("aria-checked", String(Boolean(isAuto)));

        // The stepper reads out where the value sits now — a rung's name, or a
        // dash when a raw scrub has left it between rungs.
        const stepper = row.querySelector(".pnt-edit-tok");
        if (stepper) {
          const family = editTokenFamilies &&
            editTokenFamilies.find((f) => f.prefix === stepper.dataset.family);
          const onRung = family ? matchToken(family.members, state.value) : null;
          stepper.querySelector("b").textContent = onRung ? shortTokenName(onRung.name) : "—";
          stepper.classList.toggle("pnt-edit-offscale", !onRung);
          stepper.title = onRung ? onRung.name : `Off the ${stepper.dataset.family} scale`;
        }
      }
    }

    // The typography grid carries state the sweep cannot know: the style
    // claim moves with every scrub, and the ticks and caption move with it.
    refreshTypographyState();

    // The vec heading rows are not controls, so the sweep above never reaches
    // their dots; they key off the whole uniform the same way their component
    // rows do.
    if (advancedState && advancedState.canvasEl) {
      for (const head of editPanelEl.querySelectorAll("[data-adv-parent]")) {
        const edited = isEditedProp(advancedState.canvasEl, head.dataset.advParent);
        head.classList.toggle("pnt-edit-dirty", edited);
        const dot = head.querySelector(".pnt-edit-dot");
        if (dot) dot.classList.toggle("pnt-edit-on", edited);
      }
    }

    // Both header actions are global, so the badge counts elements rather than
    // properties: it answers "how much is this copy about to carry", which is
    // the question you have when several elements have been tuned.
    const touched = editedElements().length;
    const badge = editPanelEl.querySelector(".pnt-edit-count");
    if (badge) badge.textContent = touched ? String(touched) : "";
    const resetAll = editPanelEl.querySelector(".pnt-edit-resetall");
    if (resetAll) resetAll.classList.toggle("pnt-edit-on", touched > 0);
    paintDegradedMarker();
  }

  // ===== Copy the delta block =====
  function copyEdits(btnEl) {
    commitEditGesture();
    const text = buildEditsBlock();
    // Empty with nothing selected is the button having nothing to say. Empty
    // with something selected can only mean the payload was configured down to
    // nothing, and a button that silently does nothing is a bug report.
    if (!text) {
      if (selectedElement) showToast(EMPTY_PAYLOAD_NOTE, true);
      return;
    }
    const overwritten = editedElements().filter((el) => staleEdits(el).length > 0).length;
    navigator.clipboard.writeText(text).then(
      () => {
        // A tick, not "Copied!": this button is a 20px square beside the
        // panel's title, and the toolbar's word would stretch the header.
        setButtonSuccess(btnEl, "✓");
        // The block says so too, but a note buried in a payload the user is
        // about to paste elsewhere is not the same as being told.
        if (overwritten > 0) {
          showToast(overwritten === 1
            ? "Copied — but the page has overwritten one edit"
            : `Copied — but the page has overwritten edits on ${overwritten} elements`);
        }
      },
      () => showToast("Clipboard blocked — check the page's permissions")
    );
  }

  function removeEditPanel() {
    if (!editPanelEl) return;
    closeColorPicker();
    closeTextEditor();
    editPanelEl.remove();
    editPanelEl = null;
    editPanelPos = null;
    editPanelAttached = false;
    editPanelDragged = false;
    editSplit.clear();
  }

  // tag + the first thing that identifies it, coloured the way the info label
  // colours the same parts, so the panel reads as the same tool.
  function editPanelIdentity(el) {
    if (!el) return "";
    const tag = el.tagName.toLowerCase();
    let rest = "";
    if (el.id && !isOurs.name(el.id)) {
      rest = `<b class="pnt-edit-id-id">#${escapeHtml(el.id)}</b>`;
    } else {
      const cls = Array.from(el.classList).find((c) => !isOurs.name(c));
      if (cls) rest = `<b class="pnt-edit-id-class">.${escapeHtml(cls)}</b>`;
    }
    return `<b class="pnt-edit-id-tag">${tag}</b>${rest}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function placeEditPanel() {
    if (!editPanelEl || !selectedElement) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = editPanelEl.offsetWidth;
    const h = editPanelEl.offsetHeight;

    if (editPanelPos && editPanelDragged) {
      // Already dragged: keep the user's spot, only pulling it back into view.
      const { top, left } = clampEditPanel(editPanelPos.top, editPanelPos.left, w, h, vw, vh);
      editPanelPos = { top, left };
    } else {
      const rect = selectedElement.getBoundingClientRect();
      const spot = computeEditPanelPlacement(rect, { w, h }, vw, vh);
      if (spot) {
        editPanelPos = { top: spot.top, left: spot.left };
        editPanelAttached = true;
      } else {
        // No side has room — float it where the toolbar would have gone, and
        // let the tether draw the run.
        const layout = computeChromeLayout(rect, { w: 0, h: 0 }, { w, h }, vw, vh);
        editPanelPos = { top: layout.toolbar.top, left: layout.toolbar.left };
        editPanelAttached = false;
      }
    }
    editPanelEl.style.top = editPanelPos.top + "px";
    editPanelEl.style.left = editPanelPos.left + "px";
  }

  function clampEditPanel(top, left, w, h, vw, vh) {
    const M = GEOMETRY.margin;
    return {
      top: Math.max(M, Math.min(top, Math.max(M, vh - h - M))),
      left: Math.max(M, Math.min(left, Math.max(M, vw - w - M))),
    };
  }

  function onEditDragStart(e) {
    // Buttons in the header are buttons first; only the bar itself drags.
    if (!editPanelEl || e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = editPanelEl.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const head = e.currentTarget;

    const move = (ev) => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const { top, left } = clampEditPanel(
        ev.clientY - offsetY, ev.clientX - offsetX,
        editPanelEl.offsetWidth, editPanelEl.offsetHeight, vw, vh
      );
      editPanelPos = { top, left };
      editPanelDragged = true;
      editPanelAttached = false;
      editPanelEl.style.top = top + "px";
      editPanelEl.style.left = left + "px";
      // The panel deliberately has no positional transition, so the run must
      // not glide either or it would trail behind the drag.
      renderTether({ instant: true });
      // The picker is placed against the panel's edge, so it has to travel with
      // it rather than being left behind at the old coordinates. The text
      // editor keeps the same station.
      repositionColorPicker();
      positionTextEditor();
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      head.classList.remove("pnt-edit-dragging");
    };

    head.setPointerCapture(e.pointerId);
    head.classList.add("pnt-edit-dragging");
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  }

  // Undo walks one timeline across every element edited this session, so it can
  // land on something that is not the element in front of you — and a change
  // you cannot see is worse than no change at all. The element gets a flash
  // where it stands, and a toast says which way to look if it is off screen.
  function onEditHistoryApplied(el) {
    if (el && el !== selectedElement) {
      flashElementBox(el);
      showToast("Undid an edit on another element");
    }
    if (selectedElement && selectedElement.isConnected) updateOverlay(selectedElement);
    renderEditControls();
  }

  function flashElementBox(el) {
    if (!overlayContainer || !el || !el.isConnected) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;

    let flash = document.getElementById("pnt-edit-flash");
    if (!flash) {
      flash = document.createElement("div");
      flash.id = "pnt-edit-flash";
      overlayContainer.appendChild(flash);
    }
    flash.style.top = rect.top + "px";
    flash.style.left = rect.left + "px";
    flash.style.width = rect.width + "px";
    flash.style.height = rect.height + "px";
    // Restart the animation on a repeat undo: without the reflow between the
    // two class writes the browser coalesces them and nothing replays.
    flash.classList.remove("pnt-edit-flashing");
    void flash.offsetWidth;
    flash.classList.add("pnt-edit-flashing");
    // Cleared on a timer rather than on animationend, because under reduced
    // motion there is no animation to end — the ring simply holds and then
    // goes, so both paths finish the same way.
    clearTimeout(editFlashTimer);
    editFlashTimer = setTimeout(() => {
      flash.classList.remove("pnt-edit-flashing");
    }, 700);
  }

  // ===== Edit Apply =====
  // THE ONLY SECTION IN THIS FILE THAT WRITES TO AN ELEMENT OF THE HOST PAGE.
  //
  // Everything else the extension does is additive — it appends its own chrome
  // and reads the page. Edit Mode is the first feature that reaches in and
  // changes it, so every such write is funnelled through here and nowhere else.
  // test/edit-audit.mjs enforces that by parsing this file's section banners:
  // setProperty, removeProperty, and setAttribute/removeAttribute of "style" or
  // "class" may appear between this banner and the next one, and may not appear
  // anywhere else. If you need to restyle a page element from another section,
  // call one of these functions rather than reaching past them.
  //
  // What is recorded per element, at first touch and never again: the exact
  // style attribute string and the exact class attribute string. Restoring
  // means putting those two back verbatim — a page that shipped
  // style="color:red" gets that attribute back, not a normalised rewrite of it.

  function ensureEditRecord(el) {
    let record = editRegistry.get(el);
    if (!record) {
      record = {
        el,
        originalStyleAttr: el.getAttribute("style"),
        originalClassAttr: el.getAttribute("class"),
        props: new Map(),
      };
      editRegistry.set(el, record);
    }
    return record;
  }

  function classListOf(el) {
    return (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }

  function writeClassList(el, classes) {
    if (classes.length === 0 && el.getAttribute("class") === null) return;
    el.setAttribute("class", classes.join(" "));
  }

  // Utility-class steps replace one class with another in place, so the source
  // edit Claude Code has to make is a one-word swap and the element keeps its
  // position in whatever order the framework wrote.
  function swapUtilityClass(el, from, to) {
    const classes = classListOf(el);
    const i = from ? classes.indexOf(from) : -1;
    if (i === -1) {
      if (to && !classes.includes(to)) {
        classes.push(to);
        writeClassList(el, classes);
      }
      return;
    }
    if (!to) classes.splice(i, 1);
    else if (classes.includes(to)) classes.splice(i, 1);
    else classes[i] = to;
    writeClassList(el, classes);
  }

  function applyDeclaration(el, prop, value, priority) {
    if (value === null || value === undefined || value === "") {
      el.style.removeProperty(prop);
    } else {
      el.style.setProperty(prop, value, priority === "important" ? "important" : "");
    }
  }

  // Put an element back exactly as it was found, attribute strings and all.
  //
  // The double removal is not redundant. Once an inline declaration block has
  // been written through CSSOM, Chrome's first removeAttribute empties the
  // block but leaves the attribute node in place, so the element keeps a
  // visible style="" — residue on the user's page from a tool that promised to
  // leave none. A second removal takes the node with it. Verified directly in
  // the browser; do not tidy this away.
  // Put the element back and then check that it went back, rather than
  // trusting the calls. The check is not paranoia about the API: once an
  // inline declaration block has been written through CSSOM, Chrome's first
  // removeAttribute empties the block but leaves the attribute node in place,
  // so a single removal leaves a visible style="" on an element the tool had
  // finished with. Repeating until the attribute reads back as the snapshot
  // turns a known browser quirk into an invariant that holds whatever the
  // browser does next — and would have caught that quirk on the day it landed.
  //
  // The attribute names are written out literally rather than passed in, and
  // that is load-bearing: test/edit-audit.mjs recognises a write to the page by
  // matching setAttribute("style"|"class") as text. Threading the name through
  // a variable makes those writes invisible to the audit, which is a hole in
  // the one check that keeps page mutation confined to this section.
  function restoreElement(record) {
    const el = record.el;
    untilStable(
      () => {
        if (record.originalStyleAttr === null) el.removeAttribute("style");
        else el.setAttribute("style", record.originalStyleAttr);
      },
      () => el.getAttribute("style") === record.originalStyleAttr
    );
    untilStable(
      () => {
        if (record.originalClassAttr === null) el.removeAttribute("class");
        else el.setAttribute("class", record.originalClassAttr);
      },
      () => el.getAttribute("class") === record.originalClassAttr
    );
    // Words go back the same way attributes do: the exact original bytes,
    // written until they read back. Only when the text was ever touched, and
    // only while the node the edit landed on is still the page's.
    if (record.originalTextData !== undefined &&
        record.textNode && record.textNode.isConnected) {
      untilStable(
        () => { record.textNode.nodeValue = record.originalTextData; },
        () => record.textNode.nodeValue === record.originalTextData
      );
    }
  }

  function untilStable(write, settled) {
    for (let attempt = 0; attempt < 3; attempt++) {
      write();
      if (settled()) return;
    }
  }

  // The single write path. `next` is an EditValue:
  //   { css, inline, priority, cls, token }
  // css     — the value as it should read in a delta ("18px", "#d97757")
  // inline  — what to write to the style attribute, or null to remove it
  // cls     — the utility class realising this value, or null
  // token   — { kind: "class" | "var", name } when the value sits on a token
  // `prev` is what is on the element right now, and it has to be passed in
  // rather than looked up: callers record the new value before applying it, so
  // a lookup here would return the value being written and conclude that the
  // class had not changed — leaving a token step recorded but never performed.
  function applyEditValue(el, prop, next, prev) {
    // The second thing behind this door. A uniform write never touches the
    // DOM — it crosses to the MAIN-world agent over the bridge — but it is
    // still a host-page write, so its two message types are sent from here
    // and nowhere else, and test/edit-audit.mjs pins the literals to this
    // section the same way it pins setProperty. An EditValue carrying a
    // `uniform` array is a set; one without (the driven sentinel) hands the
    // value back to the page's own loop.
    if (prop.startsWith("uniform:")) {
      const name = prop.slice(8);
      if (next && next.uniform) postShaderSet(name, next.uniform);
      else postShaderClear(name);
      return;
    }
    // The third thing behind the door: the element's own words. Not a
    // declaration and not an attribute, so it has its own verb — nodeValue —
    // which test/edit-audit.mjs pins to this section the same way it pins
    // setProperty. Text reflows the element, so the tether re-measures.
    if (prop === "text") {
      writeTextValue(el, next);
      if (editing && el === selectedElement) renderTether({ instant: true });
      return;
    }
    // The composite door. One type-style EditValue can carry a class swap
    // and a set of constituent declarations; applying it as one write is
    // what lets undo and the delta treat a style step as a single action.
    if (prop === "type-style") {
      applyTypeStyleValue(el, next, prev);
      if (editing && el === selectedElement) renderTether({ instant: true });
      return;
    }
    const record = ensureEditRecord(el);
    const entry = record.props.get(prop);
    const current = prev !== undefined ? prev : (entry ? entry.after : null);
    const prevCls = current ? current.cls || null : null;
    if (prevCls !== (next.cls || null)) swapUtilityClass(el, prevCls, next.cls || null);

    // Verify rather than assume. neededPriority already asks the cascade
    // whether an !important page rule is in the way, but it can only see
    // stylesheets it was allowed to read — a cross-origin sheet throws, and the
    // rule inside it is invisible. So the write is checked against the only
    // authority that cannot be wrong: whether the computed value actually
    // moved. If we meant to change something and nothing changed, the page
    // outranks us, and there is exactly one thing left to try.
    //
    // Only the plain path is checked. An already-escalated write has nothing
    // above it, and a null inline (a class swap, or a removal) is verified by
    // the caller that understands what it meant.
    const worthChecking =
      next.inline && next.priority !== "important" && (!current || current.css !== next.css);
    const beforeComputed = worthChecking ? getComputedStyle(el).getPropertyValue(prop) : null;

    applyDeclaration(el, prop, next.inline, next.priority);

    if (worthChecking && getComputedStyle(el).getPropertyValue(prop) === beforeComputed) {
      applyDeclaration(el, prop, next.inline, "important");
    }

    // The live-rect hook. There is no ResizeObserver anywhere in this
    // extension — tracking is scroll, resize and a throttled mousemove — so
    // padding or width scrubbed here would resize the element with nothing to
    // tell the tether about it, and the ticks would sit at a stale rect
    // precisely while the user is watching them. This is the one place that
    // knows for certain the geometry just changed.
    //
    // Last, not before the escalation above: that retry is what makes a
    // blocked padding or width write actually land, so measuring ahead of it
    // would tether to a rect that is about to move.
    if (editing && el === selectedElement) renderTether({ instant: true });
  }

  // A type-style write: swap the class if the source changed, then apply the
  // constituent declarations — null clears an override so the new source
  // shows through, a value writes inline with the same verify-and-escalate
  // the main path keeps. All through this section's own verbs.
  function applyTypeStyleValue(el, next, prev) {
    ensureEditRecord(el);
    const prevCls = prev ? prev.cls || null : null;
    const nextCls = (next && next.cls) || null;
    if (prevCls !== nextCls) swapUtilityClass(el, prevCls, nextCls);
    const decls = (next && next.styleDecls) || null;
    if (!decls) return;
    for (const [p, v] of Object.entries(decls)) {
      const writing = v !== null && v !== undefined && v !== "";
      const beforeComputed = writing ? getComputedStyle(el).getPropertyValue(p) : null;
      applyDeclaration(el, p, v, "");
      if (writing && getComputedStyle(el).getPropertyValue(p) === beforeComputed) {
        applyDeclaration(el, p, v, "important");
      }
    }
  }

  // The senders for the two bridge verbs. Defined here so the audit's rule —
  // these string literals appear in Edit Apply and nowhere else — makes the
  // write path as un-movable as the setProperty one.
  function postShaderSet(name, value) {
    postShaderMessage("PNT_SHADER_SET", { name, value });
  }

  function postShaderClear(name) {
    postShaderMessage("PNT_SHADER_CLEAR", { name });
  }

  // The text node an edit lands on: the first direct child with words of its
  // own. Never a descendant's — the field only offers itself where ownsText
  // holds — and never a new node, so there is nothing to clean up beyond
  // putting the original characters back.
  function firstDirectTextNode(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return node;
    }
    return null;
  }

  // Write the words, remembering the exact original once — nodeValue is
  // byte-preserving in both directions, so leading whitespace a formatter put
  // there goes back exactly as found.
  function writeTextValue(el, next) {
    const record = ensureEditRecord(el);
    const node = record.textNode && record.textNode.isConnected
      ? record.textNode
      : firstDirectTextNode(el);
    if (!node) return;
    if (record.originalTextData === undefined) {
      record.textNode = node;
      record.originalTextData = node.nodeValue;
    }
    const wanted = next && typeof next.text === "string" ? next.text : (next && next.css) || "";
    untilStable(
      () => { node.nodeValue = wanted; },
      () => node.nodeValue === wanted
    );
  }

  // The element's current words as an EditValue. css carries the collapsed
  // display form (what the field shows, what a delta prints); text carries
  // the raw node data, which is what a revert writes back.
  function readTextEditValue(el) {
    const node = firstDirectTextNode(el);
    const raw = node ? node.nodeValue : "";
    return {
      css: raw.trim().replace(/\s+/g, " "),
      inline: null, priority: "", cls: null, token: null,
      text: raw,
    };
  }

  // Read the element's current state for a property as an EditValue. This is
  // what `before` is captured from, once, at first touch.
  function readEditValue(el, prop) {
    // getComputedStyle cannot answer for a uniform; the bridge state can, and
    // a driven uniform's honest "before" is the page's own loop, not a number.
    if (prop.startsWith("uniform:")) return readUniformEditValue(prop);
    if (prop === "text") return readTextEditValue(el);
    if (prop === "type-style") return readTypeStyleValue(el);
    const computed = getComputedStyle(el).getPropertyValue(prop).trim();
    const token = detectPropertyToken(el, prop, computed, tokenIndex);
    return {
      css: computed,
      inline: el.style.getPropertyValue(prop) || null,
      priority: el.style.getPropertyPriority(prop) || "",
      cls: token && token.kind === "class" ? token.name : null,
      token,
    };
  }

  // A page rule marked !important outranks a plain inline declaration, so the
  // edit would silently do nothing. Ask the cascade first rather than writing
  // and hoping: if the winning declaration is important and is not ours, match
  // it. Checked once per property per element, at first touch.
  // The question is about the page, not about us: "does a page rule outrank a
  // plain inline declaration?" Asking it of the live cascade makes the answer
  // depend on what we already wrote — the second write to a property finds our
  // own !important sitting there, concludes no escalation is needed, and takes
  // it back off. That is not hypothetical: committing a typed value fires once
  // on Enter and again on the blur that follows, so every typed edit to an
  // !important-covered property was escalated and then immediately downgraded.
  // Ignoring inline entirely makes the answer stable however many times it is
  // asked.
  function neededPriority(el, prop) {
    const winner = findWinningDeclaration(el, prop, tokenIndex, { ignoreInline: true });
    return winner && winner.important ? "important" : "";
  }

  // A page that animates the property being scrubbed makes the element chase
  // the pointer half a second behind, which reads as the tool being slow
  // rather than the page being animated. Transitions are suppressed for the
  // length of a gesture and restored when it commits — recorded on the record,
  // so a gesture interrupted by anything at all still gives them back.
  function suppressTransitions(el) {
    const record = ensureEditRecord(el);
    if (record.heldTransition !== undefined) return;
    record.heldTransition = el.style.getPropertyValue("transition") || null;
    el.style.setProperty("transition", "none", "important");
  }

  function releaseTransitions(el) {
    const record = editRegistry.get(el);
    if (!record || record.heldTransition === undefined) return;
    if (record.heldTransition === null) el.style.removeProperty("transition");
    else el.style.setProperty("transition", record.heldTransition);
    delete record.heldTransition;
  }

  function pruneRecord(el) {
    const record = editRegistry.get(el);
    if (!record) return;
    if (record.props.size === 0) {
      restoreElement(record);
      editRegistry.delete(el);
    }
  }

  // ===== Edit History =====
  // One chronological stack across every element touched this session, because
  // a mistake is undone when it is noticed, not when its element happens to be
  // selected again. Undo landing on some other element flashes that element's
  // box so the change is never invisible.
  //
  // Continuous gestures — a scrub, a held arrow key, a drag in the colour
  // picker — repaint many times and must land as one entry. beginEditGesture
  // captures `before` at the start, commitEditGesture pushes once at the end.

  function isEditedProp(el, prop) {
    const record = editRegistry.get(el);
    return Boolean(record && record.props.has(prop));
  }

  // Two different "before"s, and conflating them is what makes an undo stack
  // wrong. `origin` is the value at first touch and belongs to the delta —
  // the block should report where the property started, however many times it
  // was nudged since. `from` is the value this particular gesture is leaving,
  // and belongs to the undo entry, because one Cmd+Z should give back one
  // change rather than the whole session's worth.
  function beginEditGesture(el, prop) {
    if (editGesture && editGesture.el === el && editGesture.prop === prop) return;
    commitEditGesture();
    const record = ensureEditRecord(el);
    const entry = record.props.get(prop);
    const current = entry ? entry.after : readEditValue(el, prop);
    editGesture = {
      el,
      prop,
      origin: entry ? entry.before : current,
      from: current,
      hadEntry: Boolean(entry),
    };
    clearTimeout(tetherLoudTimer);
    setTetherLoud(true);
  }

  // Write a value as part of the open gesture. No history until it commits.
  function setEditValue(el, prop, next) {
    beginEditGesture(el, prop);
    const record = ensureEditRecord(el);
    const entry = record.props.get(prop);
    const before = entry ? entry.before : editGesture.origin;
    // On the first touch the element still wears whatever it started with, so
    // that is what a class swap has to replace.
    const prev = entry ? entry.after : before;
    applyEditValue(el, prop, next, prev);
    record.props.set(prop, { before, after: next });
  }

  function commitEditGesture() {
    const g = editGesture;
    editGesture = null;
    if (!g) return;
    // The gesture is over; the tether settles a beat later rather than snapping
    // quiet under the pointer that was just scrubbing it.
    if (editing) bumpTether();
    // Whatever ended the gesture — a pointerup, Escape, a deselect — the page's
    // own transitions come back before anything else happens.
    releaseTransitions(g.el);
    const record = editRegistry.get(g.el);
    const entry = record && record.props.get(g.prop);
    if (!entry) return;
    if (sameEditValue(entry.before, entry.after)) {
      // Scrubbed away and back again: not an edit, and not history.
      record.props.delete(g.prop);
      applyEditValue(g.el, g.prop, entry.before, entry.after);
      pruneRecord(g.el);
      return;
    }
    // Nothing moved during this gesture — a scrub that ended where it started.
    if (sameEditValue(g.from, entry.after)) return;
    pushUndo({ kind: "single", el: g.el, prop: g.prop, before: g.from, after: entry.after });
  }

  // Two values are the same edit when they render the same, from the same
  // token — the value, not the mechanism that achieves it. Comparing the
  // inline string instead would call "no inline declaration, 0px from a
  // stylesheet" and "inline 0px" different, so scrubbing a property away and
  // back would leave a dirty dot and a delta line for a change nobody can see.
  function sameEditValue(a, b) {
    if (!a || !b) return a === b;
    return a.css === b.css && (a.cls || null) === (b.cls || null);
  }

  function pushUndo(entry) {
    undoStack.push(entry);
    // A new edit forks the timeline; anything undone past this point is gone.
    redoStack.length = 0;
  }

  // Revert one property to what it was at first touch — itself an undoable
  // step, so the timeline stays strictly chronological.
  function resetEditProp(el, prop) {
    const record = editRegistry.get(el);
    const entry = record && record.props.get(prop);
    if (!entry) return;
    commitEditGesture();
    record.props.delete(prop);
    applyEditValue(el, prop, entry.before, entry.after);
    pushUndo({ kind: "single", el, prop, before: entry.after, after: entry.before, isReset: true });
    pruneRecord(el);
  }

  // Every element, every property, back to how it was found — one entry.
  function resetAllEdits() {
    commitEditGesture();
    if (editRegistry.size === 0) return;
    const items = [];
    for (const record of editRegistry.values()) {
      items.push({
        el: record.el,
        styleAttr: record.originalStyleAttr,
        classAttr: record.originalClassAttr,
        props: new Map(record.props),
      });
      // Uniforms are not attributes, so the attribute restore below cannot
      // reach them; each goes back through the door on its own. After a
      // bridge teardown these land in a dormant agent as no-ops, which is
      // correct — the teardown already restored the values itself.
      for (const [prop, entry] of record.props) {
        if (prop.startsWith("uniform:")) applyEditValue(record.el, prop, entry.before, entry.after);
      }
      restoreElement(record);
    }
    editRegistry.clear();
    pushUndo({ kind: "batch", items });
  }

  function applyUndoEntry(entry, direction) {
    if (entry.kind === "batch") {
      if (direction === "undo") {
        // Put every element's edits back.
        for (const item of entry.items) {
          const record = ensureEditRecord(item.el);
          record.originalStyleAttr = item.styleAttr;
          record.originalClassAttr = item.classAttr;
          record.props = new Map(item.props);
          // The element was restored to its original state by the reset this
          // is undoing, so that original is what each value is replacing.
          for (const [prop, e] of record.props) applyEditValue(item.el, prop, e.after, e.before);
        }
      } else {
        for (const item of entry.items) {
          const record = editRegistry.get(item.el);
          if (record) restoreElement(record);
          editRegistry.delete(item.el);
        }
      }
      return entry.items.length ? entry.items[0].el : null;
    }

    const value = direction === "undo" ? entry.before : entry.after;
    const other = direction === "undo" ? entry.after : entry.before;
    const record = ensureEditRecord(entry.el);
    const original = record.props.get(entry.prop);
    const baseline = original ? original.before : other;
    // Undo and redo swap between exactly two states, so the one being left is
    // always the other side of this entry.
    applyEditValue(entry.el, entry.prop, value, other);
    if (sameEditValue(value, baseline) && !record.props.has(entry.prop)) {
      // Back at the untouched state: the property is no longer an edit.
      record.props.delete(entry.prop);
    } else if (sameEditValue(value, baseline)) {
      record.props.delete(entry.prop);
    } else {
      record.props.set(entry.prop, { before: baseline, after: value });
    }
    pruneRecord(entry.el);
    return entry.el;
  }

  function performUndo() {
    commitEditGesture();
    const entry = undoStack.pop();
    if (!entry) return null;
    const el = applyUndoEntry(entry, "undo");
    redoStack.push(entry);
    return el;
  }

  function performRedo() {
    commitEditGesture();
    const entry = redoStack.pop();
    if (!entry) return null;
    const el = applyUndoEntry(entry, "redo");
    undoStack.push(entry);
    return el;
  }

  // ===== Edit Deltas =====
  // What the panel copies: the same pointer header Copy Code emits, plus what
  // changed. The before-value earns its place — in a utility-class or token
  // codebase the old value is how you find the declaration to edit, and
  // "14px → 18px" is a far weaker instruction than "text-base → text-lg".

  // Properties read out in a fixed order, so the same set of edits always
  // produces the same block no matter what order they were made in.
  const EDIT_PROP_ORDER = [
    "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "color",
    "padding", "margin", "gap",
    "width", "height",
    "background-color", "opacity",
    "border-width", "border-color", "border-radius",
    "box-shadow",
  ];

  // A side longhand sorts where its shorthand sorts, so opening padding into
  // its four sides does not scatter them through the block — padding-top
  // belongs next to margin, not after box-shadow.
  function editPropRank(prop) {
    const i = EDIT_PROP_ORDER.indexOf(prop);
    if (i !== -1) return i;
    const shorthand = SHORTHAND_OF[prop];
    const j = shorthand ? EDIT_PROP_ORDER.indexOf(shorthand) : -1;
    return j === -1 ? EDIT_PROP_ORDER.length : j;
  }

  // Colours are shown as hex on both sides of the arrow. getComputedStyle
  // hands back rgb() and the picker hands back hex, so a delta would otherwise
  // read "rgb(255, 255, 255) → #a94f30" and make the reader convert one of
  // them in their head to see how far the colour moved. Anything that is not a
  // colour passes through untouched.
  function displayCss(css) {
    const colour = parseCssColor(css);
    return colour ? formatHex(colour) : css;
  }

  // A token name is what the source contains, so it leads; the pixel value
  // follows in parentheses because it is what the eye was actually judging.
  function formatEditSide(value) {
    if (!value) return "";
    const shown = displayCss(value.css);
    if (value.token && value.token.name) return `${value.token.name} (${shown})`;
    return shown;
  }

  // [{ prop, before, after }] → the "# edits:" lines. Style entries first,
  // exactly as they always read; uniform entries — registry keys starting
  // "uniform:" — get their own block, because "set this uniform" is a
  // different instruction from "apply this declaration". Pure — mirrored in
  // test/edit-deltas.mjs.
  function buildEditLines(entries, shaderMeta) {
    const all = (entries || []).filter((e) => e && e.prop);
    const texts = all.filter((e) => e.prop === "text");
    const typeStyles = all.filter((e) => e.prop === "type-style");
    const styles = all.filter((e) =>
      e.prop !== "text" && e.prop !== "type-style" && !e.prop.startsWith("uniform:"));
    const uniforms = all.filter((e) => e.prop.startsWith("uniform:"));
    const sorted = styles
      .slice()
      .sort((a, b) => editPropRank(a.prop) - editPropRank(b.prop) || a.prop.localeCompare(b.prop));
    const lines = [];
    // Content first: it is not a style change, and it is the loudest thing
    // that can happen to an element. The before side is a finder, so it may
    // truncate; the after side is the instruction, so it never does.
    for (const e of texts) {
      lines.push(`# text: ${formatTextSide(e.before, 80)} → ${formatTextSide(e.after)}`);
    }
    // Then the composite: one action, one line, changed constituents echoed.
    lines.push(...buildTypeStyleLines(typeStyles));
    if (sorted.length > 0) {
      lines.push(
        "# edits: apply these style changes to this element in the source",
        ...sorted.map((e) => `#   ${e.prop}: ${formatEditSide(e.before)} → ${formatEditSide(e.after)}`)
      );
    }
    if (uniforms.length > 0) lines.push(...buildShaderLines(uniforms, shaderMeta || null));
    return lines;
  }

  // The composite's own grammar: the name leads because the source edit is
  // that one name; the parenthetical echoes only the constituents that
  // actually moved, because those numbers are what the eye was judging.
  // Pure — mirrored in test/edit-deltas.mjs.
  function typeStyleEcho(before, after) {
    const LABELS = [
      ["font-size", "size"], ["font-weight", "weight"],
      ["line-height", "leading"], ["letter-spacing", "tracking"],
    ];
    const a = (before && before.style && before.style.values) || {};
    const b = (after && after.style && after.style.values) || {};
    const parts = [];
    for (const [prop, label] of LABELS) {
      const x = a[prop];
      const y = b[prop];
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (Math.abs(x - y) <= 0.001) continue;
      const f = (n) => String(Math.round(n * 100) / 100);
      parts.push(`${label} ${f(x)}→${f(y)}`);
    }
    return parts.length ? ` (${parts.join(", ")})` : "";
  }

  // Pure — mirrored in test/edit-deltas.mjs.
  function buildTypeStyleLines(entries) {
    return (entries || [])
      .filter((e) => e && e.prop === "type-style")
      .map((e) => `# type style: ${e.before && e.before.css ? e.before.css : ""} → ` +
        `${e.after && e.after.css ? e.after.css : ""}${typeStyleEcho(e.before, e.after)}`);
  }

  // One side of a text delta: quoted so its edges are visible, escaped so a
  // quote inside the words cannot fake the format, capped only when a cap is
  // given. Pure — mirrored in test/edit-deltas.mjs.
  function formatTextSide(value, cap) {
    const s = value && typeof value.css === "string" ? value.css : "";
    const shown = cap && s.length > cap ? s.slice(0, cap - 1) + "…" : s;
    return JSON.stringify(shown);
  }

  // The shader half of a delta. Names lead — the uniform name is the greppable
  // anchor into the shader source and the upload site — and a driven value's
  // before side is honest about what it was: the page's own loop, not a
  // number. Pure — mirrored in test/edit-deltas.mjs.
  function buildShaderLines(entries, meta) {
    const sorted = (entries || [])
      .filter((e) => e && e.prop && e.prop.startsWith("uniform:"))
      .slice()
      .sort((a, b) => a.prop.localeCompare(b.prop));
    if (sorted.length === 0) return [];
    const kind = meta && meta.contextType === "webgl2" ? "WebGL2" : "WebGL";
    const lines = [
      `# shader edits: this canvas is drawn by a ${kind} program — set these uniforms where the page uploads them`,
    ];
    for (const e of sorted) {
      const name = e.prop.slice(8);
      const driven = Boolean(e.before && e.before.driven);
      const before = driven ? "page-driven" : e.before ? e.before.css : "";
      const after = driven ? `held at ${e.after ? e.after.css : ""}` : e.after ? e.after.css : "";
      lines.push(`#   ${name}: ${before} → ${after}`);
    }
    if (meta && meta.probedFrom) {
      lines.push(`# note: this canvas was probed as a descendant of the selected ${meta.probedFrom}`);
    }
    return lines;
  }

  function editEntriesFor(el) {
    const record = editRegistry.get(el);
    if (!record) return [];
    return Array.from(record.props, ([prop, e]) => ({ prop, before: e.before, after: e.after }));
  }

  // Elements that still carry an edit, in the order they appear on the page —
  // so a block describing several of them reads top to bottom the way the page
  // does, rather than in the order the user happened to click.
  function editedElements() {
    const live = [];
    for (const [el, record] of editRegistry) {
      if (record.props.size > 0) live.push(el);
    }
    return live.sort((a, b) => {
      if (a === b) return 0;
      const rel = a.compareDocumentPosition(b);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  // Has the page taken our edit back? A framework that re-renders the subtree
  // replaces the node's attributes wholesale, and the registry would go on
  // reporting a change that is no longer there. Checked at the only moment it
  // matters: when the block is about to be handed to someone who will act on
  // it.
  function staleEdits(el) {
    const record = editRegistry.get(el);
    if (!record || !el.isConnected) return [];
    const computed = getComputedStyle(el);
    const stale = [];
    for (const [prop, entry] of record.props) {
      // A uniform cannot be read back through computed style, so this check
      // has nothing true to say about it; while its session lives the agent
      // enforces the value at every draw.
      if (prop.startsWith("uniform:")) continue;
      // A style claim is re-derived on every refresh, which is a better
      // staleness check than any string compare could be here.
      if (prop === "type-style") continue;
      // Words are checked against the words: a framework re-render replaces
      // text nodes as readily as attributes.
      if (prop === "text") {
        const now = getDirectText(el);
        if (now !== String(entry.after.css || "").trim().replace(/\s+/g, " ")) {
          stale.push({ prop, now });
        }
        continue;
      }
      const now = computed.getPropertyValue(prop).trim();
      // Compare what renders, not how it was written — the same test
      // sameEditValue makes.
      if (displayCss(now) !== displayCss(entry.after.css)) stale.push({ prop, now });
    }
    return stale;
  }

  function buildElementSection(el) {
    const { header, located } = buildPointerHeader(el);
    const lines = buildEditLines(editEntriesFor(el), advancedMeta.get(el) || null);
    const html = buildCopyHtml(el, located);
    const notes = [];
    if (!el.isConnected) {
      notes.push("# note: this element is no longer on the page — it was replaced or removed after being edited");
    }
    for (const { prop, now } of staleEdits(el)) {
      notes.push(`# note: ${prop} now reads ${displayCss(now)} on the page — something overwrote this edit`);
    }
    return [header, ...notes, ...lines, html].filter(Boolean).join("\n");
  }

  // One block for everything edited this session. With a single element it is
  // byte-identical to what a per-element copy produced; with none it is the
  // selected element's pointer, which is exactly Copy Code — so the button
  // always has something true to say.
  //
  // The delta block obeys the fence preference but not the HTML-block one's
  // unfenced spelling: with several sections, each carrying its own notes, edit
  // lines and markup, there is no single HTML block to lift into a ```html
  // block of its own. Fence off means no wrapper, and that is all it means here.
  function buildEditsBlock() {
    const elements = editedElements();
    if (elements.length === 0) {
      return selectedElement ? fenceBlock(copyPrefs, buildElementSection(selectedElement)) : "";
    }
    return fenceBlock(copyPrefs, elements.map(buildElementSection).join("\n\n"));
  }

  // ===== Advanced Detection =====
  // What the Advanced section is about: values that drive an element's visuals
  // through a mechanism the main panel cannot see — a WebGL program's uniforms
  // behind a <canvas>, or custom properties consumed by gradients, filters,
  // masks and paint worklets. Detection is scoped on purpose: "everything that
  // parses as a number" would pour the page's whole token universe in here,
  // and the token layer already owns that.

  // The selected element itself when it is a canvas; otherwise the largest
  // visible canvas among its descendants. The common arrangement on real pages
  // is a wrapper div over a pointer-events:none canvas, so insisting on a
  // direct hit would make the feature look broken exactly where it matters.
  // Cross-origin iframes never enter: querySelectorAll cannot see into them.
  const PROBE_CANVAS_LIMIT = 50;
  function findProbeCanvas(el) {
    if (!el || !el.isConnected) return null;
    if (el.tagName === "CANVAS") return el;
    let best = null;
    let bestArea = 0;
    let seen = 0;
    for (const canvas of el.querySelectorAll("canvas")) {
      if (++seen > PROBE_CANVAS_LIMIT) break;
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = canvas;
        bestArea = area;
      }
    }
    return bestArea > 0 ? best : null;
  }

  // Which visual channels count as a mechanism. Deliberately not
  // background-color and not plain lengths: a var() there is an ordinary
  // design token, and the token layer already offers it with a stepper. These
  // are the properties whose value is a recipe — a gradient, a filter chain, a
  // paint() — where the interesting numbers live in the custom properties
  // feeding it.
  const ADVANCED_VISUAL_PROPS = [
    "background", "background-image", "filter", "backdrop-filter",
    "mask", "mask-image", "clip-path", "transform", "box-shadow",
  ];

  // A custom property earns a control two ways: it is visibly consumed by a
  // var() in the winning declaration of a visual property above, or it is
  // declared on the element itself — inline or by an element-scoped rule —
  // which is the standard shape of a JS-driven effect (script writes
  // --wave-amp onto the node, CSS reads it). The local fallback is what keeps
  // an unreadable stylesheet from silently emptying the section; its cost is
  // the occasional local property nothing consumes, which tunes to no effect
  // rather than hiding one that would.
  function collectAdvancedCssProps(el) {
    if (!el || !el.isConnected) return [];
    const style = getComputedStyle(el);
    const found = new Map();
    const take = (name) => {
      if (typeof name !== "string" || !name.startsWith("--")) return;
      if (found.has(name) || isOurs.name(name)) return;
      const css = style.getPropertyValue(name).trim();
      if (!css) return;
      const parsed = advancedCssKind(css);
      if (!parsed) return;
      found.set(name, { name, kind: parsed.kind, value: parsed.value, unit: parsed.unit || "", css, driven: false });
    };

    for (const prop of ADVANCED_VISUAL_PROPS) {
      const texts = [];
      const winner = findWinningDeclaration(el, prop, tokenIndex);
      if (winner && winner.value) texts.push(winner.value);
      const inline = el.style && el.style.getPropertyValue(prop);
      if (inline) texts.push(inline);
      for (const text of texts) {
        for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) take(m[1]);
      }
    }

    if (el.style) {
      for (let i = 0; i < el.style.length; i++) {
        const name = el.style[i];
        if (name.startsWith("--")) take(name);
      }
    }
    if (tokenIndex && !tokenIndex.disabled) {
      for (const rule of tokenIndex.rules) {
        let hit = false;
        try { hit = el.matches(rule.selectorText); } catch { continue; }
        if (!hit) continue;
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i];
          if (name.startsWith("--")) take(name);
        }
      }
    }

    // A property a CSS animation is rewriting is driven, the same cluster as a
    // shader's u_time: the read-out is the page's until the user takes over.
    // (Overriding one rides the existing escalate-to-!important path — a plain
    // inline declaration loses to an animation, an important one beats it.)
    try {
      for (const anim of el.getAnimations()) {
        if (!anim.effect || typeof anim.effect.getKeyframes !== "function") continue;
        for (const frame of anim.effect.getKeyframes()) {
          for (const key of Object.keys(frame)) {
            const entry = found.get(key);
            if (entry) entry.driven = true;
          }
        }
      }
    } catch { /* getAnimations can throw in odd embedding contexts; stay quiet */ }

    return Array.from(found.values());
  }

  // A slider needs a range and GLSL declares none, so it is inferred from the
  // values actually seen: a headroom decade over the largest magnitude,
  // opening below zero only when a sample has been there. Pure — mirrored in
  // test/advanced.mjs; change both.
  function uniformRange(samples, isInt) {
    let peak = 0;
    let negative = false;
    for (const v of samples || []) {
      if (!isFinite(v)) continue;
      if (Math.abs(v) > peak) peak = Math.abs(v);
      if (v < 0) negative = true;
    }
    if (isInt) {
      const top = Math.max(10, Math.pow(10, Math.ceil(Math.log10((peak || 1) * 1.5))));
      return { min: negative ? -top : 0, max: top, step: 1, decimals: 0 };
    }
    if (peak === 0) return { min: -1, max: 1, step: 0.01, decimals: 2 };
    const top = Math.pow(10, Math.ceil(Math.log10(peak * 1.5)));
    const raw = top / 200;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = raw / magnitude;
    const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * magnitude;
    return {
      min: negative ? -top : 0,
      max: top,
      step,
      decimals: Math.max(0, -Math.floor(Math.log10(step))),
    };
  }

  // "u_amplitude" reads as "amplitude" in a 248px panel; the full name is kept
  // on the control and is what the delta block prints, because the full name
  // is the greppable one. Pure — mirrored in test/advanced.mjs; change both.
  function uniformLabel(name) {
    let s = String(name || "").replace(/\[0\]$/, "");
    const underscored = s.match(/^[ui]_(.+)$/);
    if (underscored) s = underscored[1];
    else if (/^[ui][A-Z]/.test(s)) s = s.slice(1);
    return s ? s[0].toLowerCase() + s.slice(1) : String(name || "");
  }

  // A vec3 in [0,1] whose name says colour gets the picker; everything else
  // gets per-component numbers. Both gates matter — the range alone would call
  // every normalised direction a colour. Pure — mirrored in test/advanced.mjs;
  // change both.
  function isColorUniform(name, type, value) {
    if (type !== "vec3" && type !== "vec4") return false;
    if (!Array.isArray(value) || !value.every((v) => isFinite(v) && v >= 0 && v <= 1)) return false;
    return /color|colour|tint|albedo|diffuse|emissive/i.test(String(name || ""));
  }

  // What kind of control a custom property's value can carry. Anything that
  // parses as neither a number nor a colour is not offered — a keyword or a
  // whole gradient is not a dial. Pure — mirrored in test/advanced.mjs; change
  // both.
  function advancedCssKind(value) {
    const s = String(value || "").trim();
    if (!s) return null;
    const m = s.match(/^(-?\d*\.?\d+)(px|deg|%|rem|em|vh|vw|s|ms)?$/);
    if (m) return { kind: "number", value: parseFloat(m[1]), unit: m[2] || "" };
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: "color" };
    if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(s)) return { kind: "color" };
    return null;
  }

  // How a uniform value reads in the panel and the delta block: GLSL-shaped,
  // so the line can be pasted next to the shader it describes. Pure — mirrored
  // in test/advanced.mjs; change both.
  function formatUniformValue(value, type) {
    const isIntKind = /^(int|uint|ivec[234]|uvec[234])$/.test(type);
    const one = (v) => {
      if (!isFinite(v)) return "0";
      if (isIntKind) return String(Math.round(v));
      if (v === 0) return "0.00";
      const a = Math.abs(v);
      if (a >= 100) return String(Math.round(v * 10) / 10);
      if (a < 0.01) return String(Number(v.toPrecision(2)));
      return v.toFixed(2);
    };
    if (type === "bool") return (value && value[0]) >= 0.5 ? "on" : "off";
    const nums = (value || []).map(one);
    if (nums.length <= 1) return nums[0] || "0";
    return `${type}(${nums.join(", ")})`;
  }

  // ===== Shader Bridge =====
  // The isolated world's half of the conversation with shader-agent.js, which
  // runs in the page's MAIN world (see that file's header for why it must).
  // Elements cannot cross worlds, so the target canvas is marked with a
  // one-shot data attribute carrying a nonce; every message echoes it, and a
  // stale nonce is a message from a selection that no longer exists.
  //
  // Nothing here writes a uniform. The two message types that do —
  // PNT_SHADER_SET and PNT_SHADER_CLEAR — are sent from the Edit Apply section
  // and nowhere else, and test/edit-audit.mjs pins those literals there the
  // same way it pins setProperty.
  let shaderNonce = null;
  let advancedMarkedCanvas = null;
  let advancedTicket = 0;
  let advancedKeepalive = 0;

  // file:// documents have an opaque origin, which postMessage rejects as a
  // target; the message never leaves this window either way.
  const shaderTarget = () => (location.origin === "null" ? "*" : location.origin);

  function postShaderMessage(type, payload) {
    if (!shaderNonce) return;
    window.postMessage({ pnt: "shader", v: 1, nonce: shaderNonce, type, ...payload }, shaderTarget());
  }

  // Fire-and-forget on purpose: if the agent is gone (the extension was
  // reloaded under us), the send vanishes and the agent's own dead-man switch
  // has already put the page back.
  function beginAdvancedProbe(el) {
    advancedTicket++;
    advancedState = {
      forEl: el,
      cssProps: collectAdvancedCssProps(el),
      canvasEl: null,
      contextType: null,
      live: false,
      gone: false,
      truncated: false,
      uniforms: new Map(),
    };
    scheduleCssDrivenResample(el);
    const canvas = findProbeCanvas(el);
    if (canvas) injectAndProbe(el, canvas, advancedTicket);
  }

  async function injectAndProbe(el, canvas, ticket) {
    const nonce = (crypto.randomUUID && crypto.randomUUID()) ||
      String(Math.random()).slice(2) + Date.now();
    canvas.setAttribute("data-pnt-probe", nonce);
    advancedMarkedCanvas = canvas;
    try {
      await chrome.runtime.sendMessage({ type: "INJECT_SHADER_AGENT" });
    } catch { /* no worker (harness, or mid-reload): the agent may still be resident */ }
    // Edit Mode ended, or moved on, while the worker was injecting.
    if (ticket !== advancedTicket || !editing || selectedElement !== el) {
      if (canvas.isConnected) canvas.removeAttribute("data-pnt-probe");
      if (advancedMarkedCanvas === canvas) advancedMarkedCanvas = null;
      return;
    }
    shaderNonce = nonce;
    postShaderMessage("PNT_SHADER_PROBE", { observeMs: 700, maxUniforms: 64 });
    clearInterval(advancedKeepalive);
    advancedKeepalive = setInterval(() => postShaderMessage("PNT_SHADER_KEEPALIVE", {}), 4000);
  }

  // The uniform roster the panel will trust, held to what it can render:
  // recognised types only, capped counts, finite numbers. A hostile page can
  // only mislabel rows in its own panel, but a degenerate one (10,000
  // uniforms, names by the kilobyte) should cost nothing either.
  const ADVANCED_UNIFORM_COMPS = {
    float: 1, vec2: 2, vec3: 3, vec4: 4,
    int: 1, ivec2: 2, ivec3: 3, ivec4: 4,
    uint: 1, uvec2: 2, uvec3: 3, uvec4: 4,
    bool: 1,
  };

  function sanitizeShaderInventory(msg) {
    const out = new Map();
    const list = Array.isArray(msg.uniforms) ? msg.uniforms.slice(0, 64) : [];
    for (const u of list) {
      if (!u || typeof u.name !== "string" || !u.name) continue;
      const name = u.name.slice(0, 128);
      const comps = ADVANCED_UNIFORM_COMPS[u.type];
      if (!comps || out.has(name)) continue;
      const value = Array.isArray(u.value) ? u.value.slice(0, comps).map(Number) : null;
      if (!value || value.length !== comps || value.some((v) => !isFinite(v))) continue;
      const peak = Number(u.peak);
      out.set(name, {
        name,
        type: u.type,
        comps,
        value,
        peak: isFinite(peak) ? Math.abs(peak) : Math.max(...value.map(Math.abs)),
        driven: Boolean(u.driven),
      });
    }
    return out;
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || msg.pnt !== "shader" || msg.v !== 1) return;
    if (!shaderNonce || msg.nonce !== shaderNonce) return;
    if (!advancedState) return;

    if (msg.type === "PNT_SHADER_INVENTORY") {
      if (advancedMarkedCanvas) {
        if (advancedMarkedCanvas.isConnected) advancedMarkedCanvas.removeAttribute("data-pnt-probe");
        advancedState.canvasEl = advancedMarkedCanvas;
        advancedMarkedCanvas = null;
      }
      advancedState.contextType = msg.contextType === "webgl2" ? "webgl2" : "webgl";
      advancedState.live = Boolean(msg.live);
      advancedState.truncated = Boolean(msg.truncated);
      advancedState.uniforms = sanitizeShaderInventory(msg);
      if (advancedState.canvasEl && advancedState.uniforms.size > 0) {
        advancedMeta.set(advancedState.canvasEl, {
          contextType: advancedState.contextType,
          probedFrom: advancedState.canvasEl === selectedElement
            ? null
            : describeProbeOrigin(selectedElement),
        });
      }
      // The section folds in a beat late, the same way a slow CDN's token
      // stepper does — better than the panel waiting on a frame observation.
      renderEditControls();
      // The panel was measured and clamped before this section existed;
      // growing it can push the new rows past the viewport bottom, where
      // they are not merely clipped but unreachable. Same remedy as a
      // window resize: pull the panel back into view, and the tether with it.
      if (editing) {
        placeEditPanel();
        renderTether({ instant: true });
        repositionColorPicker();
      }
      if (advancedOpen) postShaderMessage("PNT_SHADER_WATCH", { on: hasDrivenUniforms() });
      return;
    }

    if (msg.type === "PNT_SHADER_ERROR") {
      if (advancedMarkedCanvas) {
        if (advancedMarkedCanvas.isConnected) advancedMarkedCanvas.removeAttribute("data-pnt-probe");
        advancedMarkedCanvas = null;
      }
      // Not an error worth a marker: most canvases are not shaders, and the
      // section simply doesn't claim one. The CSS half may still render.
      return;
    }

    if (msg.type === "PNT_SHADER_TICK") {
      applyShaderTick(msg.values);
      return;
    }

    if (msg.type === "PNT_SHADER_GONE") {
      advancedState.gone = true;
      advancedState.live = false;
      renderEditControls();
    }
  });

  function teardownShaderBridge() {
    advancedTicket++;
    if (shaderNonce) postShaderMessage("PNT_SHADER_TEARDOWN", {});
    shaderNonce = null;
    clearInterval(advancedKeepalive);
    advancedKeepalive = 0;
    if (advancedMarkedCanvas) {
      if (advancedMarkedCanvas.isConnected) advancedMarkedCanvas.removeAttribute("data-pnt-probe");
      advancedMarkedCanvas = null;
    }
    advancedState = null;
    advancedControls = [];
  }

  // ===== Advanced Controls =====
  // The collapsible section at the bottom of the panel. It renders only when
  // something was actually detected — never an empty shell with a disabled
  // face, for the same reason the panel never claims a token that isn't there.
  // Collapsed by default; whether it is open is remembered for the session,
  // because it is a way of looking at the panel rather than element state.
  let advancedState = null;
  let advancedOpen = false;
  let advancedControls = [];
  // What the delta block needs to say about a canvas after the panel has
  // moved on: which kind of program drew it, and whether it was probed as a
  // descendant of something else. Keyed weakly — it lives exactly as long as
  // the canvas does.
  const advancedMeta = new WeakMap();

  function describeProbeOrigin(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList).find((c) => !isOurs.name(c));
    return cls ? `<${tag} class="${cls}">` : `<${tag}>`;
  }

  function advancedHasContent() {
    return Boolean(advancedState &&
      (advancedState.uniforms.size > 0 || advancedState.cssProps.length > 0));
  }

  function hasDrivenUniforms() {
    if (!advancedState) return false;
    for (const rec of advancedState.uniforms.values()) {
      if (rec.driven) return true;
    }
    return false;
  }

  function controlTarget(control) {
    if (control && control.uniform) return advancedState ? advancedState.canvasEl : null;
    return selectedElement;
  }

  // The uniform's value as the panel believes it right now: the edit if there
  // is one, the live inventory value otherwise.
  function currentUniformValue(name) {
    const st = advancedState;
    if (!st) return null;
    const el = st.canvasEl;
    const entry = el && editRegistry.get(el)?.props.get("uniform:" + name);
    if (entry && entry.after && entry.after.uniform) return entry.after.uniform.slice();
    const rec = st.uniforms.get(name);
    return rec ? rec.value.slice() : null;
  }

  // The gesture's "before" for a uniform, built here because getComputedStyle
  // cannot answer for one. A driven uniform's before is the page's own loop —
  // the sentinel, not a number — so undoing the takeover hands the value back
  // rather than pinning yesterday's time.
  function readUniformEditValue(prop) {
    const name = prop.slice(8);
    const rec = advancedState ? advancedState.uniforms.get(name) : null;
    if (rec && rec.driven) {
      return { css: "page-driven", inline: null, priority: "", cls: null, token: null, uniform: null, driven: true };
    }
    const vec = rec ? rec.value.slice() : null;
    return {
      css: vec ? formatUniformValue(vec, rec.type) : "",
      inline: null, priority: "", cls: null, token: null,
      uniform: vec,
    };
  }

  function setUniformValue(control, vec, token) {
    const el = controlTarget(control);
    if (!el || !el.isConnected) return;
    const u = control.uniform;
    setEditValue(el, control.uniformKey, {
      css: formatUniformValue(vec, u.type),
      inline: null, priority: "", cls: null,
      token: token || null,
      uniform: vec.slice(),
    });
  }

  function applyUniformPart(control, value) {
    const u = control.uniform;
    const vec = currentUniformValue(u.name) || new Array(u.comps).fill(0);
    vec[Math.max(0, u.part)] = value;
    setUniformValue(control, vec, null);
  }

  // The segment control's path: a bool uniform arrives here as "on"/"off".
  function applyUniformCss(control, cssValue) {
    setUniformValue(control, [cssValue === "on" ? 1 : 0], null);
  }

  // Driven read-outs, fed by the agent's ≤10 Hz tick. Direct textContent
  // writes rather than refreshEditControls: this runs continuously and only
  // has to move numbers, not rebuild state.
  function applyShaderTick(values) {
    const st = advancedState;
    if (!st || !st.canvasEl || !editPanelEl || !values || typeof values !== "object") return;
    for (const [name, raw] of Object.entries(values)) {
      const rec = st.uniforms.get(name);
      if (!rec || !rec.driven) continue;
      const vec = Array.isArray(raw) ? raw.slice(0, rec.comps).map(Number) : null;
      if (!vec || vec.length !== rec.comps || vec.some((v) => !isFinite(v))) continue;
      rec.value = vec;
      // Taken over: the row shows the override, not the page's stream.
      if (isEditedProp(st.canvasEl, "uniform:" + name)) continue;
      const rows = editPanelEl.querySelectorAll(`.pnt-edit-row[data-prop="uniform:${name}"]`);
      for (const row of rows) {
        const control = advancedControls.find((c) => c.prop === row.dataset.control);
        if (!control) continue;
        const input = row.querySelector(".pnt-edit-input");
        if (input && document.activeElement !== input) {
          input.value = formatNumeric(vec[Math.max(0, control.uniform.part)], control);
        }
        const fill = row.querySelector(".pnt-edit-swatch i");
        if (fill) fill.style.background = readColorValue(st.canvasEl, control);
      }
    }
  }

  // CSS animations that drive a custom property do not always announce
  // themselves through getAnimations (a hue spun by script, a Houdini worklet
  // ticking its own input). One re-sample a beat later catches the movers; an
  // open gesture skips it, so a user's own scrub is never read as the page's.
  function scheduleCssDrivenResample(el) {
    const ticket = advancedTicket;
    const before = new Map();
    for (const p of advancedState.cssProps) {
      if (!p.driven) before.set(p.name, p.css);
    }
    if (before.size === 0) return;
    setTimeout(() => {
      if (ticket !== advancedTicket || !editing || selectedElement !== el || editGesture) return;
      if (!el.isConnected || !advancedState) return;
      const style = getComputedStyle(el);
      let moved = false;
      for (const p of advancedState.cssProps) {
        const was = before.get(p.name);
        if (was === undefined) continue;
        if (style.getPropertyValue(p.name).trim() !== was) {
          p.driven = true;
          moved = true;
        }
      }
      if (moved) renderEditControls();
    }, 180);
  }

  // State → control objects, in the same dialect EDIT_GROUPS speaks, so the
  // rows reuse the numeric chip, the segment and the picker unchanged. A
  // uniform control carries `uniform` metadata and a registry key; its
  // components write the whole vector back the way shadow parts write the
  // whole box-shadow.
  function buildAdvancedControls() {
    const st = advancedState;
    const params = [];
    const driven = [];
    if (!st) return { params, driven };

    const AXES = ["x", "y", "z", "w"];
    for (const rec of st.uniforms.values()) {
      const bucket = rec.driven ? driven : params;
      const key = "uniform:" + rec.name;
      const intish = /^(int|uint|ivec[234]|uvec[234])$/.test(rec.type);
      const range = uniformRange(rec.value.concat([rec.peak]), intish);
      if (rec.type === "bool") {
        bucket.push({
          prop: key + ".0", uniformKey: key, label: uniformLabel(rec.name),
          kind: "segment", options: ["off", "on"],
          uniform: { name: rec.name, type: rec.type, comps: 1, part: 0 },
        });
      } else if (isColorUniform(rec.name, rec.type, rec.value)) {
        bucket.push({
          prop: key, uniformKey: key, label: uniformLabel(rec.name),
          kind: "color",
          uniform: { name: rec.name, type: rec.type, comps: rec.comps, part: -1 },
        });
      } else if (rec.comps === 1) {
        bucket.push({
          prop: key + ".0", uniformKey: key, label: uniformLabel(rec.name),
          unit: "", ...range,
          uniform: { name: rec.name, type: rec.type, comps: 1, part: 0 },
        });
      } else {
        for (let i = 0; i < rec.comps; i++) {
          bucket.push({
            prop: `${key}.${i}`, uniformKey: key, label: AXES[i],
            unit: "", ...range, vecHead: i === 0 ? uniformLabel(rec.name) : null,
            uniform: { name: rec.name, type: rec.type, comps: rec.comps, part: i },
          });
        }
      }
    }

    for (const p of st.cssProps) {
      const bucket = p.driven ? driven : params;
      if (p.kind === "color") {
        bucket.push({
          prop: p.name, label: p.name.replace(/^--/, ""), kind: "color",
          forceImportant: p.driven,
        });
      } else {
        bucket.push({
          prop: p.name, label: p.name.replace(/^--/, ""), unit: p.unit,
          ...uniformRange([p.value], false),
          forceImportant: p.driven,
        });
      }
    }
    return { params, driven };
  }

  function advancedSummaryText() {
    const st = advancedState;
    const parts = [];
    const n = st.uniforms.size;
    if (n > 0) {
      parts.push(`${n} shader value${n > 1 ? "s" : ""}${st.live ? "" : " (read-only)"}`);
    }
    const c = st.cssProps.length;
    if (c > 0) parts.push(`${c} css prop${c > 1 ? "s" : ""}`);
    return parts.join(" · ");
  }

  // The vec heading row: a dot for the whole uniform above its component
  // rows, the same arrangement a split padding control draws.
  function buildAdvancedVecHead(control) {
    const row = document.createElement("div");
    row.className = "pnt-edit-row pnt-edit-parent";
    row.dataset.prop = control.uniformKey;
    row.dataset.advParent = control.uniformKey;

    const dot = document.createElement("button");
    dot.className = "pnt-edit-dot";
    dot.title = `Reset ${control.vecHead}`;
    dot.setAttribute("aria-label", `Reset ${control.vecHead}`);
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const owner = controlTarget(control);
      if (!owner || !isEditedProp(owner, control.uniformKey)) return;
      resetEditProp(owner, control.uniformKey);
      renderEditControls();
    });

    const label = document.createElement("span");
    label.className = "pnt-edit-label";
    label.textContent = control.vecHead;

    row.appendChild(dot);
    row.appendChild(label);
    return row;
  }

  function appendAdvancedRows(body, controls) {
    for (const control of controls) {
      if (control.vecHead) body.appendChild(buildAdvancedVecHead(control));
      body.appendChild(buildEditRow(control, Boolean(control.uniform && control.uniform.comps > 1 && control.uniform.part >= 0)));
    }
  }

  function renderAdvancedSection() {
    if (!advancedHasContent()) {
      advancedControls = [];
      return null;
    }
    const st = advancedState;
    const { params, driven } = buildAdvancedControls();
    advancedControls = params.concat(driven);

    const section = document.createElement("div");
    section.className = "pnt-edit-group pnt-adv-group";

    const details = document.createElement("details");
    details.className = "pnt-adv";
    details.open = advancedOpen;
    details.addEventListener("toggle", () => {
      advancedOpen = details.open;
      postShaderMessage("PNT_SHADER_WATCH", { on: details.open && hasDrivenUniforms() });
      // Opening grows the panel; a panel that grew past the viewport bottom
      // leaves its new rows unreachable, so re-clamp exactly as a resize
      // does. After the glide, because the clamp needs the final height.
      setTimeout(() => {
        if (!editing) return;
        placeEditPanel();
        renderTether({ instant: true });
        repositionColorPicker();
      }, 220);
    });

    const summary = document.createElement("summary");
    summary.className = "pnt-adv-summary";
    const caret = document.createElement("i");
    caret.className = "pnt-adv-caret";
    caret.setAttribute("aria-hidden", "true");
    const legend = document.createElement("p");
    legend.className = "pnt-edit-legend pnt-adv-legend";
    legend.textContent = "Advanced";
    const count = document.createElement("span");
    count.className = "pnt-adv-count";
    count.textContent = advancedSummaryText();
    summary.appendChild(caret);
    summary.appendChild(legend);
    summary.appendChild(count);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "pnt-adv-body";

    if (st.canvasEl && st.uniforms.size > 0 && st.canvasEl !== selectedElement) {
      const note = document.createElement("p");
      note.className = "pnt-adv-note";
      note.innerHTML = `shader on ${editPanelIdentity(st.canvasEl)} inside the selection`;
      body.appendChild(note);
    }
    if (st.gone) {
      const note = document.createElement("p");
      note.className = "pnt-adv-note";
      note.textContent = "the page rebuilt its shader — these controls have let go";
      body.appendChild(note);
    } else if (st.uniforms.size > 0 && !st.live) {
      const note = document.createElement("p");
      note.className = "pnt-adv-note";
      note.textContent = "this shader drew once and stopped — values shown, not tunable";
      body.appendChild(note);
    }

    appendAdvancedRows(body, params);

    if (driven.length > 0) {
      const cluster = document.createElement("div");
      cluster.className = "pnt-adv-driven";
      const micro = document.createElement("p");
      micro.className = "pnt-adv-driven-legend";
      micro.textContent = "driven by the page";
      cluster.appendChild(micro);
      appendAdvancedRows(cluster, driven);
      body.appendChild(cluster);
    }

    // Read-only inventories keep their rows honest: visible, valued, inert.
    if ((st.uniforms.size > 0 && !st.live) || st.gone) {
      body.classList.add("pnt-adv-readonly");
      for (const node of body.querySelectorAll("input, button")) node.disabled = true;
    }

    details.appendChild(body);
    section.appendChild(details);
    return section;
  }

  // Uniform edits are session-bound in a way CSS edits are not: without a live
  // agent session there is nothing on the page carrying them, so leaving Edit
  // Mode hands every uniform back (the agent's teardown restores the values)
  // and the registry and history must stop claiming them.
  function dropUniformEdits() {
    for (const [el, record] of Array.from(editRegistry)) {
      let dropped = false;
      for (const prop of Array.from(record.props.keys())) {
        if (prop.startsWith("uniform:")) {
          record.props.delete(prop);
          dropped = true;
        }
      }
      if (dropped) pruneRecord(el);
    }
    const survives = (entry) => {
      if (entry.kind === "batch") {
        for (const item of entry.items) {
          for (const prop of Array.from(item.props.keys())) {
            if (prop.startsWith("uniform:")) item.props.delete(prop);
          }
        }
        entry.items = entry.items.filter((item) => item.props.size > 0);
        return entry.items.length > 0;
      }
      return !(entry.prop && entry.prop.startsWith("uniform:"));
    };
    const keptUndo = undoStack.filter(survives);
    undoStack.length = 0;
    undoStack.push(...keptUndo);
    const keptRedo = redoStack.filter(survives);
    redoStack.length = 0;
    redoStack.push(...keptRedo);
  }

  // ===== Event Handlers =====
  function onMouseMove(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Hover tracking stays dead while something is selected — except for
    // redline, which needs to know what the cursor is over. Modifier state is
    // re-read from every event on purpose: a keyup we never saw (released
    // during Alt+Tab, or over an iframe) can neither strand nor miss the mode.
    if (selectedElement) {
      if (redlining && !e.altKey) stopRedline();
      else if (!redlining && e.altKey) startRedline();
      if (!redlining) return;

      const target = getTargetElement(e, redlineTarget);
      if (target === redlineTarget) return;
      redlineTarget = target;
      scheduleRedline();
      return;
    }

    const target = getTargetElement(e);
    if (target === hoveredElement) return;

    hoveredElement = target;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (hoveredElement && probeActive) {
        updateOverlay(hoveredElement);
      }
    });
  }

  // The chrome is position:fixed, so anything that moves the element relative to
  // the viewport invalidates every box we've drawn. Hover repairs itself on the
  // next mousemove, but a selection would otherwise sit frozen at stale
  // coordinates until you clicked something else.
  function onViewportChange() {
    if (!probeActive || viewportRafId) return;
    viewportRafId = requestAnimationFrame(() => {
      viewportRafId = null;
      const el = selectedElement || hoveredElement;
      if (!probeActive || !el) return;
      updateOverlay(el, { instant: true, keepContent: true });
      // Measurements are viewport-relative too, so they track in the same
      // frame — instant, because chasing a scroll with a glide reads as lag
      if (redlining) renderRedline({ instant: true });
      // The panel is viewport-anchored, not element-anchored: a resize can
      // strand it off-screen, so pull it back without moving it otherwise.
      // The tether joins the two, so it redraws after the panel has settled.
      if (editing) {
        placeEditPanel();
        renderTether({ instant: true });
        repositionColorPicker();
        positionTextEditor();
      }
    });
  }

  function onClick(e) {
    if (!probeActive) return;

    // Ignore clicks on our own chrome. Everything interactive we inject has to be
    // listed here — this handler preventDefaults and stops propagation on every
    // other click on the page, so anything missing gets its clicks eaten and
    // selects the element behind it instead.
    if (toolbarEl && toolbarEl.contains(e.target)) return;
    if (settingsButtonEl && settingsButtonEl.contains(e.target)) return;
    if (toastEl && toastEl.contains(e.target)) return;
    if (editPanelEl && editPanelEl.contains(e.target)) return;
    if (editPopoverEl && editPopoverEl.contains(e.target)) return;
    if (textEditorEl && textEditorEl.contains(e.target)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // The page is inert while editing: no re-selecting, and no Option+click
    // re-anchoring either, since that path runs through selection. Measuring
    // still works — it just cannot move the thing being edited.
    if (editing) return;

    const target = getTargetElement(e);
    if (!target) return;

    // If already selected, deselect first
    if (selectedElement) {
      deselectElement();
    }

    selectedElement = target;
    hoveredElement = target;
    updateOverlay(target);

    if (overlayContainer) {
      overlayContainer.classList.add("pnt-selected");
    }

    showToolbar(target);

    // Clicking while measuring re-anchors: deselectElement() above ended the
    // previous redline, so re-enter from the event's own modifier state. The
    // new selection is also the element under the cursor, so nothing draws
    // until the pointer moves onto something else.
    if (e.altKey) startRedline();
  }

  function onKeyDown(e) {
    // Option/Alt arms redline — only in select mode, and only bare Alt so
    // browser Alt-combos keep working. No e.repeat re-entry: startRedline()
    // is a no-op while active, but skipping the call keeps intent obvious.
    if (e.key === "Alt" && !e.repeat && !e.ctrlKey && !e.metaKey && selectedElement) {
      e.preventDefault();
      startRedline();
      return;
    }

    // Undo walks one chronological timeline across every element edited this
    // session. It only claims the key when there is something to undo — with
    // an empty stack the page keeps its own Cmd+Z, which matters on the kind
    // of page (an editor, a form) people are most likely to be tuning.
    if (editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      if (isTextEntry(e.target)) return; // let a field undo its own typing
      const el = e.shiftKey ? performRedo() : performUndo();
      if (el) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onEditHistoryApplied(el);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      hideTip();

      // Stages out: text editor → picker → editing → selected → probe off.
      // Each Escape gives back exactly one layer, so nothing is ever lost by
      // more than a step.
      if (textEditorEl) {
        closeTextEditor();
      } else if (editPopoverEl) {
        closeColorPicker();
      } else if (editing) {
        exitEditMode();
      } else if (selectedElement) {
        deselectElement();
      } else {
        // Notify background to update badge
        chrome.runtime.sendMessage({ type: "DEACTIVATE" });
        deactivate();
      }
    }
  }

  function isTextEntry(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable === true;
  }

  function onKeyUp(e) {
    if (e.key === "Alt" && redlining) {
      // A bare-Alt keyup focuses the browser's menu bar on Windows; the key
      // was consumed as a mode hold, so suppress that.
      e.preventDefault();
      stopRedline();
    }
  }

  function onWindowBlur() {
    stopRedline();
  }

  // `keep` is what a hit on our own chrome resolves to — the hover path keeps
  // its current element, redline keeps its current target.
  function getTargetElement(e, keep = hoveredElement) {
    // Use elementFromPoint to ignore our overlay
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return null;
    // Skip our own elements — see isOurs, which is the only place the roster
    // of injected roots lives.
    if (isOurs.node(el)) return keep;
    return el;
  }

  function deselectElement() {
    exitEditMode(); // and every deselection path ends editing — same reason
    stopRedline(); // every deselection path ends redline — it has no anchor
    selectedElement = null;
    if (overlayContainer) {
      overlayContainer.classList.remove("pnt-selected");
    }
    removeToolbar();
  }

  // ===== Toolbar =====
  // The keyboard ladder, made visible. Only what is actually bound: Option
  // measures from the selection, Escape steps back out. Copy, Screenshot and
  // Edit have no shortcut, so they carry no chip — a hint that lies is worse
  // than none. Where the chips sit is the layout's business (see updateLabel).
  const HINTS_HTML = `<kbd class="pnt-kbd">⌥</kbd><span>measure</span><kbd class="pnt-kbd">esc</kbd>`;

  // The four actions, in the one order they ever appear. Edit and Select
  // Parent are in the accent: one opens a mode, the other moves the
  // selection — neither copies anything. Actions read selectedElement at
  // click time so they follow Select Parent hops.
  const ACTIONS = [
    { id: "copy", label: "Copy Code", icon: "code", run: (btnEl) => copyElement(selectedElement, btnEl) },
    { id: "shot", label: "Screenshot", icon: "camera", run: (btnEl) => copyScreenshot(selectedElement, btnEl) },
    { id: "edit", label: "Edit", icon: "edit", accent: true, run: () => enterEditMode() },
    { id: "parent", label: "Select Parent", icon: "parent", accent: true, run: () => selectParent() },
  ];

  // One node, built once per selection; the layout decides where it mounts.
  // Every button carries its label as a <span> — content.css shows it only in
  // the bar above the compact breakpoint — and as data-tip for the tooltip,
  // so an icon-only button still names itself.
  function showToolbar(el) {
    removeToolbar(true);

    toolbarEl = document.createElement("div");
    toolbarEl.id = "pnt-toolbar";

    const bar = document.createElement("div");
    bar.className = "pnt-bar";

    for (const action of ACTIONS) {
      const button = document.createElement("button");
      button.dataset.action = action.id;
      button.dataset.tip = action.label;
      button.setAttribute("aria-label", action.label);
      if (action.accent) button.className = "pnt-accent-btn";
      button.dataset.origHtml = ICONS[action.icon] + `<span>${action.label}</span>`;
      button.innerHTML = button.dataset.origHtml;
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        action.run(button);
      });
      bar.appendChild(button);
      if (action.id === "parent") parentButtonEl = button;
    }

    // The strip's hints, at its right end. Present in every layout, shown
    // only Under the name — the others put theirs in the label.
    const hints = document.createElement("span");
    hints.className = "pnt-hints";
    hints.setAttribute("aria-hidden", "true");
    hints.innerHTML = HINTS_HTML;
    bar.appendChild(hints);

    toolbarEl.appendChild(bar);

    // Tooltips: delegated, so the four buttons share one pair of listeners
    // and the tip root can be positioned from whichever fired.
    const over = (e) => {
      const button = e.target.closest("button[data-tip]");
      if (button) showTip(button);
    };
    const out = (e) => {
      const button = e.target.closest("button[data-tip]");
      if (button && !button.contains(e.relatedTarget)) hideTip();
    };
    toolbarEl.addEventListener("pointerover", over);
    toolbarEl.addEventListener("pointerout", out);
    toolbarEl.addEventListener("focusin", over);
    toolbarEl.addEventListener("focusout", out);

    mountToolbar();
    updateParentButton();

    // Lock widths before placing: the toolbar has to be measured at its final
    // size, or it gets positioned against a width that then changes under it.
    updateToolbarDensity(document.documentElement.clientWidth);
    lockButtonWidths();
    lockCardWidth();
    layoutChrome(el, { newToolbar: true });
  }

  // Where the node goes is the whole difference between the layouts. Inside
  // the label for the spine, the strip and the bar — so the solver sees one
  // box and the buttons ride with the readout — and its own fixed root for the
  // pill, which is placed on the element's edge by the solver's straddle rule.
  function mountToolbar() {
    const layout = chromePrefs.selectionLayout;
    const head = labelEl && labelEl.querySelector(":scope > .pnt-label-head");
    labelEl.classList.toggle("pnt-with-actions", layout !== "edge");
    if (layout === "beside") labelEl.prepend(toolbarEl);
    else if (layout === "under" && head) head.after(toolbarEl);
    else if (layout === "under" || layout === "bottom") labelEl.appendChild(toolbarEl);
    else document.documentElement.appendChild(toolbarEl);
  }

  // ===== Tooltip =====
  // Shown for a button whose label is not on screen — an icon in the pill,
  // the spine, the strip, or the bar at compact density. Above the button,
  // centred, kept inside the viewport, or below it when the top has no room;
  // beside a spine button — to its right, else its left — so it covers no
  // readout line. Never inside the card, so it never moves the chrome.
  function showTip(button) {
    const text = button.dataset.tip;
    if (!tipEl || !text) return;
    const label = button.querySelector("span");
    if (label && label.offsetWidth > 0) return hideTip(); // the label already says it

    const M = GEOMETRY.margin, GAP = GEOMETRY.gap;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    tipEl.textContent = text;
    tipEl.classList.add("pnt-tip-on");
    const r = button.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let top, left, side;
    if (chromePrefs.selectionLayout === "beside") {
      top = Math.max(M, Math.min(r.top + r.height / 2 - h / 2, vh - M - h));
      left = r.right + GAP;
      side = "right";
      if (left + w > vw - M) {
        left = Math.max(M, r.left - GAP - w);
        side = "left";
      }
    } else {
      top = r.top - GAP - h;
      side = "above";
      if (top < M) {
        top = Math.min(r.bottom + GAP, vh - M - h);
        side = "below";
      }
      left = Math.max(M, Math.min(r.left + r.width / 2 - w / 2, vw - w - M));
    }
    tipEl.style.top = top + "px";
    tipEl.style.left = left + "px";
    tipEl.dataset.side = side;
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove("pnt-tip-on");
  }

  // ===== Select Parent =====
  function getSelectableParent(el) {
    const parent = el?.parentElement;
    // Stop at <body> — <html> has no meaningful selector or screenshot
    if (!parent || parent === document.documentElement) return null;
    return parent;
  }

  function updateParentButton() {
    if (!parentButtonEl) return;
    const disabled = !getSelectableParent(selectedElement);
    parentButtonEl.disabled = disabled;
    parentButtonEl.classList.toggle("pnt-button-disabled", disabled);
    parentButtonEl.dataset.tip = disabled ? "No parent element to select" : "Select Parent";
  }

  function selectParent() {
    const parent = getSelectableParent(selectedElement);
    if (!parent) return;

    selectedElement = parent;
    hoveredElement = parent;
    updateOverlay(parent); // glides both boxes to the parent's geometry
    updateParentButton();
    // The bar may have moved under the pointer; the tip it named is stale.
    hideTip();
  }

  // `rebuilding` is showToolbar's own call: the label was just rewritten for
  // the new selection, hints included, and keeps them. Every other caller is
  // ending the selection, and the label outlives it as the hover readout —
  // so the hints and the width lock, which were the selection's, go too.
  function removeToolbar(rebuilding) {
    hideTip();
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
    parentButtonEl = null;
    if (labelEl && !rebuilding) {
      labelEl.classList.remove("pnt-with-actions");
      labelEl.style.width = "";
      for (const node of labelEl.querySelectorAll(".pnt-hints, .pnt-label-hints")) node.remove();
    }
  }

  // ===== Selector Builder =====
  function buildSelector(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body") return tag;

    let selector = tag;
    if (el.id) {
      return `${tag}#${el.id}`;
    }

    // A test id identifies far better than a pile of utility classes
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (testId) {
      return `${tag}[data-testid="${testId}"]`;
    }

    const classes = Array.from(el.classList)
      .filter((c) => !isOurs.name(c))
      .slice(0, 2);
    if (classes.length > 0) {
      selector += classes.map((c) => `.${c}`).join("");
    }

    // Add nth-child if selector isn't unique among siblings
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === el.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    return selector;
  }

  function buildSelectorPath(el) {
    // An id or test id on the element itself already resolves — no path needed
    if (el.id) return `#${el.id}`;
    const ownTestId = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (ownTestId && document.querySelectorAll(`[data-testid="${ownTestId}"]`).length === 1) {
      return buildSelector(el);
    }

    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const sel = buildSelector(current);
      parts.unshift(sel);
      // Stop early if we hit an element with an ID (already unique)
      if (current.id) break;
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  // ===== Resolve background color =====
  function resolveBackgroundColor(el) {
    let current = el;
    while (current && current !== document.documentElement) {
      const bg = getComputedStyle(current).backgroundColor;
      // Skip transparent / rgba with 0 alpha
      if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
        return bg;
      }
      current = current.parentElement;
    }
    // Not a design value and not themed: this is the browser's own default page
    // background, reported as a fact about the page being inspected. Theming it
    // would make the tool misreport what it is looking at.
    return "#ffffff";
  }

  // ===== Skeleton HTML Builder =====
  // Attributes are reproduced whole \u2014 on a utility-CSS project the class list is
  // the construct being pointed at, so eliding the middle of it removes the edit target.
  // Source-tooling attributes are dropped: they are already reported as `source:`.
  const TOOLING_ATTR = /^(data-inspector|data-source|data-v-inspector)/;

  function formatAttrs(el) {
    return Array.from(el.attributes)
      .filter((a) => !isOurs.name(a.name) && a.name !== "style" && !TOOLING_ATTR.test(a.name))
      .map((a) => ` ${a.name}="${a.value}"`)
      .join("");
  }

  const SELF_CLOSING = ["img", "br", "hr", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"];

  function buildSkeletonHTML(el, depth = 0, maxDepth = 3) {
    const tag = el.tagName.toLowerCase();
    const attrs = formatAttrs(el);

    if (SELF_CLOSING.includes(tag)) {
      return `<${tag}${attrs} />`;
    }

    const indent = "  ".repeat(depth);
    const childIndent = "  ".repeat(depth + 1);

    // Collect children: text nodes + elements
    const parts = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.trim();
        if (text) {
          parts.push(text.length > 50 ? text.slice(0, 47) + "\u2026" : text);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (depth + 1 >= maxDepth) {
          const n = child.children.length;
          const childTag = child.tagName.toLowerCase();
          parts.push(`<${childTag}${formatAttrs(child)}>${n > 0 ? `<!-- ${n} children -->` : "\u2026"}</${childTag}>`);
        } else {
          parts.push(buildSkeletonHTML(child, depth + 1, maxDepth));
        }
      }
    }

    if (parts.length === 0) {
      return `<${tag}${attrs}></${tag}>`;
    }

    // If only a single short text node, keep inline
    if (parts.length === 1 && !parts[0].startsWith("<") && parts[0].length < 60) {
      return `<${tag}${attrs}>${parts[0]}</${tag}>`;
    }

    return `<${tag}${attrs}>\n${parts.map((p) => childIndent + p).join("\n")}\n${indent}</${tag}>`;
  }

  // ===== Source-discovery helpers =====
  function getVisibleText(el) {
    const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    return raw.length > 200 ? raw.slice(0, 197) + "\u2026" : raw;
  }

  function isDevOrigin() {
    const h = window.location.hostname;
    if (!h) return false;
    if (h === "localhost" || h === "0.0.0.0") return true;
    if (h === "127.0.0.1" || h === "::1") return true;
    if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  }

  function getPageString() {
    const loc = window.location;
    const path = loc.pathname || "/";
    const tail = (loc.search || "") + (loc.hash || "");
    return isDevOrigin() ? `${loc.origin}${path}${tail}` : `${path}${tail}`;
  }

  // ===== Pointer fields =====
  // The payload's job is to point at a source construct, not to describe the DOM.
  // Each helper returns a string, an array of lines, or null to be omitted.

  // Trim an absolute path down to something that reads as project-relative.
  function toProjectPath(p) {
    const m = p.match(/\/(?:src|app|pages|components|lib|routes)\//);
    if (m) return p.slice(p.indexOf(m[0]) + 1);
    const parts = p.split("/");
    return parts.length > 2 ? parts.slice(-2).join("/") : p;
  }

  // Source location, read from whatever the dev tooling already emits as attributes.
  function readSourceAttrs(node) {
    const relPath = node.getAttribute("data-inspector-relative-path");
    if (relPath) {
      const line = node.getAttribute("data-inspector-line");
      const col = node.getAttribute("data-inspector-column");
      return relPath + (line ? `:${line}` : "") + (line && col ? `:${col}` : "");
    }
    const inspector = node.getAttribute("data-v-inspector") || node.getAttribute("data-inspector");
    if (inspector) return toProjectPath(inspector);

    const loc = node.getAttribute("data-source-loc");
    if (loc) return toProjectPath(loc);

    const file = node.getAttribute("data-source-file");
    if (file) {
      const line = node.getAttribute("data-source-line");
      return toProjectPath(file) + (line ? `:${line}` : "");
    }
    return null;
  }

  function getSourceLocation(el) {
    const own = readSourceAttrs(el);
    if (own) return own;

    // Fall back to the nearest annotated ancestor, said out loud so the pointer isn't
    // mistaken for the element's own location.
    let node = el.parentElement;
    for (let i = 0; node && i < 3; i++, node = node.parentElement) {
      const found = readSourceAttrs(node);
      if (found) return `${found} (nearest annotated ancestor: ${briefName(node)})`;
    }
    return null;
  }

  // Component ancestry. Reading fibers needs page-world access — see README.
  function getComponentChain(el, max = 3) {
    const names = [];
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (fiberKey) {
      let fiber = el[fiberKey];
      while (fiber && names.length < max) {
        const t = fiber.type;
        const name =
          t && (typeof t === "function" || typeof t === "object")
            ? t.displayName || t.name || (t.render && (t.render.displayName || t.render.name))
            : null;
        if (name && /^[A-Z]/.test(name) && names[names.length - 1] !== name) names.push(name);
        fiber = fiber.return;
      }
    }
    if (names.length === 0) {
      let c = el.__vueParentComponent;
      while (c && names.length < max) {
        const n = c.type && (c.type.__name || c.type.name);
        if (n && names[names.length - 1] !== n) names.push(n);
        c = c.parent;
      }
    }
    if (names.length === 0) {
      const host = el.closest("[data-component]");
      if (host) names.push(host.getAttribute("data-component"));
    }
    return names.length > 0 ? names.join(" <- ") : null;
  }

  // The function names bound to the element — names only, never values.
  function getHandlers(el) {
    const out = [];
    for (const attr of el.attributes) {
      if (!/^on[a-z]+$/i.test(attr.name) || !attr.value) continue;
      const called = attr.value.match(/([A-Za-z_$][\w$]*)\s*\(/);
      out.push(`${attr.name}=${called ? called[1] : attr.value.slice(0, 24)}`);
    }
    const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    if (propsKey) {
      const props = el[propsKey] || {};
      for (const k of Object.keys(props)) {
        if (!/^on[A-Z]/.test(k) || typeof props[k] !== "function") continue;
        out.push(`${k}=${props[k].name || "anonymous"}`);
      }
    }
    return out.length > 0 ? out.join(", ") : null;
  }

  function cssAttrSelector(name, value) {
    return `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
  }

  function countMatches(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  // First non-empty text node inside the element — what a grep for source would hit.
  function firstTextNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.replace(/\s+/g, " ").trim();
      if (t) return t;
    }
    return "";
  }

  // How many text nodes elsewhere in the page carry exactly this string. Ancestors and
  // descendants are excluded by walking text nodes rather than elements.
  function countTextElsewhere(el, target) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let n = 0;
    while ((node = walker.nextNode())) {
      if (el.contains(node)) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(OUR_CHROME)) continue;
      if (node.textContent.replace(/\s+/g, " ").trim() === target) n++;
      if (n > 99) break;
    }
    return n;
  }

  // The best search target on the element, with a verdict on whether it actually resolves.
  function getAnchor(el) {
    const lines = [];
    for (const name of ["data-testid", "data-test", "data-cy", "data-component", "id"]) {
      const v = el.getAttribute(name);
      if (!v) continue;
      const n = countMatches(name === "id" ? cssAttrSelector("id", v) : cssAttrSelector(name, v));
      lines.push(`${name}="${v}" ${n === 1 ? "(unique in page)" : `(${n} matches)`}`);
      break;
    }

    const text = firstTextNode(el);
    if (text) {
      const shown = text.length > 40 ? text.slice(0, 40) + "\u2026" : text;
      const n = countTextElsewhere(el, text);
      lines.push(
        n === 0
          ? `text "${shown}" (unique in page)`
          : `text "${shown}" (also on ${n} other element${n > 1 ? "s" : ""} - weak grep target)`
      );
    }
    return lines.length > 0 ? lines : null;
  }

  function briefName(node) {
    if (!node) return null;
    const tag = node.tagName.toLowerCase();
    if (node.id) return `${tag}#${node.id}`;
    const cls = Array.from(node.classList).filter((c) => !isOurs.name(c))[0];
    return cls ? `${tag}.${cls}` : tag;
  }

  function siblingLabel(node) {
    if (!node) return null;
    const text = firstTextNode(node);
    const hint = text ? ` "${text.length > 20 ? text.slice(0, 20) + "\u2026" : text}"` : "";
    return briefName(node) + hint;
  }

  // Where the element sits — what "insert after this" needs in order to resolve.
  function getPosition(el) {
    const parent = el.parentElement;
    if (!parent || parent === document.documentElement) return null;

    const kids = Array.from(parent.children);
    const lines = [`child ${kids.indexOf(el) + 1} of ${kids.length} in ${briefName(parent)}`];

    const after = siblingLabel(el.previousElementSibling);
    const before = siblingLabel(el.nextElementSibling);
    const neighbours = [after && `after ${after}`, before && `before ${before}`].filter(Boolean);
    if (neighbours.length > 0) lines.push(neighbours.join(", "));

    return lines;
  }

  // Tag + sorted class list: two siblings sharing one are almost always one template.
  function signatureOf(node) {
    const cls = Array.from(node.classList)
      .filter((c) => !isOurs.name(c))
      .sort()
      .join(".");
    return node.tagName + (cls ? "." + cls : "");
  }

  function getRepetition(el) {
    const parent = el.parentElement;
    if (!parent) return null;
    const sig = signatureOf(el);
    const twins = Array.from(parent.children).filter((c) => signatureOf(c) === sig);
    if (twins.length < 2) return null;
    return [
      `${twins.indexOf(el) + 1} of ${twins.length} identical siblings - likely one template; change`,
      `the component or the data unless this instance alone is meant`,
    ];
  }

  // ===== The diagnosis fields =====
  // Three optional header fields, all off by default. Unlike everything above
  // them they do not point at a construct — they describe what the browser
  // ended up doing with it, which is what you want when the question is "why
  // does this look wrong" rather than "change this".

  // Lengths here go through the same formatter the measuring pills use, and read
  // the same two preferences: a tool that writes "24px" in one place and "1.5rem"
  // in another is describing two different pages.
  function copyLength(px) {
    return formatRedlineValue(px, redlinePrefs.redlineUnit, redlinePrefs.redlinePrecision, tokenRemBase());
  }

  // Box, display, and the spacing that is actually set — plus the parent's
  // layout context, because half of "why is this here" is answered one level up.
  function getLayout(el) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const bits = [`box ${copyLength(rect.width)}x${copyLength(rect.height)}`, `display ${displayOf(cs)}`];
    if (cs.position !== "static") bits.push(`position ${cs.position}`);

    const pad = edgeSummary(cs, "padding");
    if (pad) bits.push(`padding ${pad}`);
    const margin = edgeSummary(cs, "margin");
    if (margin) bits.push(`margin ${margin}`);
    if (cs.display.includes("flex") || cs.display.includes("grid")) {
      const gap = parseFloat(cs.rowGap) || parseFloat(cs.columnGap) || 0;
      if (gap > 0) bits.push(`gap ${copyLength(gap)}`);
    }

    const lines = [bits.join(" - ")];

    const parent = el.parentElement;
    if (parent && parent !== document.documentElement) {
      const ps = getComputedStyle(parent);
      let context = `parent display ${displayOf(ps)}`;
      if (ps.display.includes("grid")) {
        const cols = ps.gridTemplateColumns.split(" ").filter(Boolean).length;
        if (cols > 0) context += `, ${cols} col${cols > 1 ? "s" : ""}`;
      } else if (ps.display.includes("flex")) {
        context += `, ${ps.flexDirection}`;
      }
      lines.push(context);
    }

    return lines;
  }

  // "flex column" reads better than "flex" plus a separate line nobody joins up.
  function displayOf(cs) {
    if (cs.display.includes("flex") && cs.flexDirection === "column") return `${cs.display} column`;
    return cs.display;
  }

  // One value when all four edges agree, "16px 24px" when the axes do, all four
  // otherwise, and nothing at all when every edge is zero.
  function edgeSummary(cs, prop) {
    const [top, right, bottom, left] = ["Top", "Right", "Bottom", "Left"]
      .map((side) => parseFloat(cs[prop + side]) || 0);
    if (!top && !right && !bottom && !left) return "";
    if (top === right && right === bottom && bottom === left) return copyLength(top);
    if (top === bottom && right === left) return `${copyLength(top)} ${copyLength(right)}`;
    return [top, right, bottom, left].map(copyLength).join(" ");
  }

  // The authored rules that apply, and where each came from. Not computed
  // values: those are what the element ended up with, and this field exists to
  // say which line of which stylesheet decided it.
  function getMatchedCss(el) {
    const rules = collectMatchedRules(el);
    if (rules.length === 0) return null;
    return rules.map((r) => {
      const decls = r.declarations.replace(/;\s*$/, "");
      const body = decls.length > 110 ? decls.slice(0, 107) + "…" : decls;
      const origin = r.origin ? r.origin + "  " : "";
      return `${origin}${r.selectorText} { ${body} }`;
    });
  }

  // The one field in this tool that can carry the page's own data out of it.
  // Everything else names things — files, components, functions, selectors —
  // and getHandlers goes out of its way to report a handler's name and never
  // its value. This reports values, which is the entire point of it and also
  // the reason it is off by default and absent from every preset.
  //
  // Shallow only: a nested object is a shape, not a value, and printing it
  // would be the fastest way to paste a whole API response into a prompt.
  const PROPS_LIMIT = 8;

  function getProps(el) {
    const props = readFrameworkProps(el);
    if (!props) return null;

    const out = [];
    for (const key of Object.keys(props)) {
      if (out.length >= PROPS_LIMIT) break;
      if (key === "children" || /^on[A-Z]/.test(key)) continue;
      const value = props[key];
      const shown = showProp(value);
      if (shown === null) continue;
      out.push(`${key}: ${shown}`);
    }
    return out.length > 0 ? out.join(" - ") : null;
  }

  function readFrameworkProps(el) {
    const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    if (propsKey && el[propsKey]) return el[propsKey];
    const vue = el.__vueParentComponent;
    if (vue && vue.props) return vue.props;
    return null;
  }

  function showProp(value) {
    if (value === null) return "null";
    if (typeof value === "string") {
      return `"${value.length > 40 ? value.slice(0, 37) + "…" : value}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.length}]`;
    if (typeof value === "object") return "{…}";
    return null; // functions and undefined: nothing worth a line
  }

  // The element's own tag, whole, with its children summarised rather than reproduced.
  function buildRootTag(el) {
    const tag = el.tagName.toLowerCase();
    const attrs = formatAttrs(el);
    if (SELF_CLOSING.includes(tag)) return `<${tag}${attrs} />`;

    const n = el.children.length;
    if (n > 0) return `<${tag}${attrs}> \u2026 ${n} child${n > 1 ? "ren" : ""} </${tag}>`;

    const text = getDirectText(el);
    const inner = text.length > 60 ? text.slice(0, 57) + "\u2026" : text;
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  // ===== The child shape =====
  // The root tag, then one condensed line per child, then the close. Between
  // the root tag alone (which does not say what is inside) and the full subtree
  // (which repeats what the agent is about to read in the real source): enough
  // to know which data instance and which conditional branch was pointed at.
  function buildChildShape(el) {
    const tag = el.tagName.toLowerCase();
    const attrs = formatAttrs(el);
    if (SELF_CLOSING.includes(tag)) return `<${tag}${attrs} />`;

    const lines = [];
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) lines.push(shapeText(text));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        lines.push(shapeLine(node));
      }
    }

    // Nothing inside worth a line of its own — the root tag already says that,
    // and better, because it carries the text.
    if (lines.length === 0) return buildRootTag(el);

    return [`<${tag}${attrs}>`, ...lines.map((l) => "  " + l), `</${tag}>`].join("\n");
  }

  // One child as a path. Single-child wrappers are walked through, so the line
  // names the node that actually carries the content rather than the div around
  // it; a short row of leaves at the end is spelled out, because "the icon or
  // the label" is exactly the distinction that gets lost otherwise.
  function shapeLine(child) {
    const parts = [shapeSegment(child)];
    let node = child;
    while (node.children.length === 1) {
      node = node.children[0];
      parts.push(shapeSegment(node));
    }

    const leaves = Array.from(node.children);
    if (leaves.length > 1 && leaves.length <= 3 && leaves.every((c) => c.children.length === 0)) {
      parts.push(leaves.map(shapeSegment).join(" + "));
    }

    let line = parts.join(" > ");
    const text = getDirectText(child) || getVisibleText(child);
    if (text) line += " " + shapeText(text);
    const handler = firstHandler(node) || firstHandler(child);
    if (handler) line += " " + handler;
    return line;
  }

  // Tag and classes, no :nth-child — the shape describes, it does not locate.
  // Locating is what the selector field is for.
  function shapeSegment(el) {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).filter((c) => !isOurs.name(c)).slice(0, 3);
    return tag + classes.map((c) => "." + c).join("");
  }

  function shapeText(text) {
    const flat = text.replace(/\s+/g, " ").trim();
    return `"${flat.length > 40 ? flat.slice(0, 37) + "…" : flat}"`;
  }

  // getHandlers writes "onClick=openInvoice" for the header's own field; inside
  // an HTML block the JSX spelling is the one that reads as markup.
  function firstHandler(el) {
    const all = getHandlers(el);
    if (!all) return null;
    const first = all.split(", ")[0];
    const eq = first.indexOf("=");
    return eq > 0 ? `${first.slice(0, eq)}={${first.slice(eq + 1)}}` : null;
  }

  // ===== Build Structured Element Info =====
  // Emission order, and the preference gating each field. Fixed here rather
  // than at the call sites so the payload's shape is one list to read, and so
  // turning fields on cannot reorder the ones already there.
  // Mirrored in settings/settings.js for the preview rail; change both.
  const COPY_ORDER = [
    ["source", "copySource"],
    ["component", "copyComponent"],
    ["page", "copyPage"],
    ["anchor", "copyAnchor"],
    ["handlers", "copyHandlers"],
    ["selector", "copySelector"],
    ["position", "copyPosition"],
    ["repeated", "copyRepeated"],
    ["layout", "copyLayout"],
    ["styles", "copyStyles"],
    ["props", "copyProps"],
    ["text", "copyText"],
  ];

  // The comment dialect itself: "# key: " opens a field, "#   " continues it.
  // Mirrored in settings/settings.js for the preview rail; change both.
  function renderCopyHeader(fields) {
    return fields
      .map((f) => f.lines.map((l, i) => (i === 0 ? `# ${f.key}: ` : "#   ") + l).join("\n"))
      .join("\n");
  }

  // The pointer header alone, shared by Copy Code and the Edit Mode delta block so
  // both name an element in exactly the same dialect. `located` reports whether a
  // source file or component chain was found — the caller's cue for how much of
  // the rendered subtree the payload still needs to carry.
  //
  // A field that is switched off is never even computed: `styles` walks every
  // stylesheet on the page, and it is off by default precisely because most
  // copies should not pay for that.
  function buildPointerHeader(el) {
    const source = copyPrefs.copySource === "on" ? getSourceLocation(el) : null;
    const component = copyPrefs.copyComponent === "on" ? getComponentChain(el) : null;

    const value = {
      source: () => source,
      component: () => component,
      page: () => getPageString(),
      anchor: () => getAnchor(el),
      handlers: () => getHandlers(el),
      selector: () => buildSelectorPath(el),
      position: () => getPosition(el),
      repeated: () => getRepetition(el),
      layout: () => getLayout(el),
      styles: () => getMatchedCss(el),
      props: () => getProps(el),
      text: () => getVisibleText(el),
    };

    const fields = [];
    for (const [key, pref] of COPY_ORDER) {
      if (copyPrefs[pref] !== "on") continue;
      const v = value[key]();
      if (!v || (Array.isArray(v) && v.length === 0)) continue;
      fields.push({ key, lines: Array.isArray(v) ? v : [v] });
    }

    // Found *and* emitted. The rule the fallback below enforces is about the
    // payload the agent reads, not about what this function happened to find.
    return { header: renderCopyHeader(fields), located: Boolean(source || component) };
  }

  // ===== Payload assembly =====
  // These three take the preference object rather than reading the module's,
  // for the reason computeRedline takes its opts: it makes them pure, so the
  // shape of the payload can be swept in a test and previewed on the settings
  // page without either one having to reproduce the rule.
  // All three are mirrored in test/copy-format.mjs and settings/settings.js.

  // Which HTML block the settings ask for, once the fallback has had its say.
  // With a file or component to open, the agent reads the real source and a
  // rendered subtree is a lossy copy of it; with neither, that subtree is the
  // only concrete description the payload has — which is what the fallback
  // restores, whatever was chosen.
  function copyTrim(prefs, located) {
    return (!located && prefs.copyHtmlFallback === "on") ? "full" : prefs.copyHtml;
  }

  // The fence does two jobs: it delimits the block from the sentence the user
  // wrote around it, and it stops "#" from rendering as a markdown heading
  // anywhere the prompt is rendered rather than shown raw. Eight characters.
  function fenceBlock(prefs, body) {
    if (!body) return "";
    return prefs.copyFence === "on" ? "```\n" + body + "\n```" : body;
  }

  // Unfenced, the HTML takes a block of its own: with the outer fence gone it
  // is the only thing left telling a renderer this part is markup, not prose.
  function assemblePayload(prefs, header, html) {
    if (prefs.copyFence === "on") {
      return fenceBlock(prefs, [header, html].filter(Boolean).join("\n"));
    }
    return [header, html && "```html\n" + html + "\n```"].filter(Boolean).join("\n\n");
  }

  const EMPTY_PAYLOAD_NOTE = "Nothing to copy — every field is off in Settings → Copying";

  function buildCopyHtml(el, located) {
    const trim = copyTrim(copyPrefs, located);
    if (trim === "none") return "";
    if (trim === "root") return buildRootTag(el);
    if (trim === "shape") return buildChildShape(el);
    return buildSkeletonHTML(el, 0, Number(copyPrefs.copyDepth));
  }

  function buildElementInfo(el) {
    const { header, located } = buildPointerHeader(el);
    return assemblePayload(copyPrefs, header, buildCopyHtml(el, located));
  }

  // ===== Screenshot Capture =====
  async function captureElementScreenshot(el) {
    const canvas = await html2canvas(el, {
      backgroundColor: resolveBackgroundColor(el),
      logging: false,
      useCORS: true,
      scale: window.devicePixelRatio || 1,
    });

    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
  }

  async function writeImageToClipboard(blob) {
    try {
      const item = new ClipboardItem({
        "image/png": Promise.resolve(blob),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Clipboard writes need a focused document and can be denied outright;
      // fall back to handing the user the file instead of losing the capture.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "element-screenshot.png";
      a.click();
      URL.revokeObjectURL(url);
      return false;
    }
  }

  // ===== Button State Helpers =====
  function setButtonLoading(btnEl) {
    if (!btnEl) return;
    btnEl.innerHTML = `<span class="pnt-spinner" aria-hidden="true"></span><span>Copying…</span>`;
    btnEl.disabled = true;
    btnEl.style.opacity = token("--pnt-opacity-loading", "0.7");
  }

  // The restore is guarded on origHtml, so a caller that never recorded one
  // leaves its button disabled and wearing this state permanently. Every caller
  // records one; this refuses rather than trusting that to stay true.
  function setButtonSuccess(btnEl, message) {
    if (!btnEl || !btnEl.dataset.origHtml) return;
    // The check in front so an icon-only button (every layout but the bar)
    // still shows that something happened once the label is hidden.
    btnEl.innerHTML = ICONS.check + `<span>${message}</span>`;
    btnEl.disabled = true;
    setTimeout(() => {
      if (btnEl && btnEl.dataset.origHtml) {
        btnEl.innerHTML = btnEl.dataset.origHtml;
        btnEl.disabled = false;
        btnEl.style.opacity = "";
      }
    }, 1500);
  }

  function resetButton(btnEl) {
    if (!btnEl) return;
    if (btnEl.dataset.origHtml) {
      btnEl.innerHTML = btnEl.dataset.origHtml;
    }
    btnEl.disabled = false;
    btnEl.style.opacity = "";
  }

  // ===== Clipboard Actions =====
  async function copyElement(el, btnEl) {
    try {
      const info = buildElementInfo(el);
      if (!info) {
        resetButton(btnEl);
        showToast(EMPTY_PAYLOAD_NOTE, true);
        return;
      }
      await navigator.clipboard.writeText(info);
      setButtonSuccess(btnEl, "Copied!");
    } catch (err) {
      resetButton(btnEl);
      showToast("Failed to copy: " + err.message, true);
    }
  }

  async function copyScreenshot(el, btnEl) {
    try {
      setButtonLoading(btnEl);
      const blob = await captureElementScreenshot(el);
      const ok = await writeImageToClipboard(blob);
      setButtonSuccess(btnEl, ok ? "Copied!" : "Downloaded!");
    } catch (err) {
      resetButton(btnEl);
      showToast("Failed to capture: " + err.message, true);
    }
  }

  // ===== Toast =====
  // A toast is a sentence and a mark: a check for success, an alert for an
  // error. The loading affordance lives on the button itself (setButtonLoading),
  // so there is no loading toast.
  function showToast(message, isError = false) {
    if (toastTimer) clearTimeout(toastTimer);

    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "pnt-toast";
    }

    toastEl.replaceChildren();
    const mark = document.createElement("span");
    mark.className = "pnt-toast-icon";
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = isError ? ICONS.alert : ICONS.check;
    const text = document.createElement("span");
    text.textContent = message;
    toastEl.append(mark, text);
    toastEl.className = isError ? "pnt-toast-error" : "";

    const z = token("--pnt-z-chrome", "2147483647");

    // Position next to toolbar if visible, otherwise fixed bottom-right
    if (toolbarEl && toolbarEl.parentElement) {
      document.documentElement.appendChild(toastEl);
      const toolbarRect = toolbarEl.getBoundingClientRect();
      const gap = parseFloat(token("--pnt-gap-section", "8px")) || 8;
      toastEl.style.position = "fixed";
      toastEl.style.top = toolbarRect.top + "px";
      toastEl.style.left = (toolbarRect.right + gap) + "px";
      toastEl.style.height = toolbarRect.height + "px";
      toastEl.style.zIndex = z;
    } else {
      const inset = token("--pnt-toast-inset", "24px");
      document.documentElement.appendChild(toastEl);
      toastEl.style.position = "fixed";
      toastEl.style.bottom = inset;
      toastEl.style.right = inset;
      toastEl.style.top = "";
      toastEl.style.left = "";
      toastEl.style.zIndex = z;
    }

    // Force reflow for transition
    toastEl.offsetHeight;
    toastEl.classList.add("pnt-toast-visible");

    toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.classList.remove("pnt-toast-visible");
        toastTimer = setTimeout(() => {
          if (toastEl) {
            toastEl.remove();
            toastEl = null;
          }
        }, 300);
      }
    }, 2000);
  }

  // A toast fades on its own after ~2.3s, which is longer than the extension
  // exists once it is switched off. Takes the pending timer with it, so the
  // fade-out cannot resurrect a node the teardown already removed.
  function removeToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }
})();
