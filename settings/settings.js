"use strict";

// Settings page: the theme, plus the six measuring (redline) preferences.
//
// The theme roster carries no colours — each pill's swatch is stamped with its
// own data-pnt-theme and styled through the --pnt-* tokens, so the palette on
// screen is literally the palette that gets applied. Adding a theme means one
// block in tokens.css and one line here.
//
// The measuring rosters mirror REDLINE_PREFS in content.js: same keys, same
// values, default first. Storage is flat — one chrome.storage.local key per
// setting, the "theme" convention.

const THEMES = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "dracula", name: "Dracula" },
  { id: "monokai", name: "Monokai" },
  { id: "nord", name: "Nord" },
  { id: "solarized-dark", name: "Solarized Dark" },
  { id: "tokyo-night", name: "Tokyo Night" },
];

const THEME_KEY = "theme";
const DEFAULT_THEME = "system";
// 1.x stored "terracotta-dark" / "terracotta-light"; 2.0 calls the pair
// "dark" / "light" and defaults to "system". Read through this so an old
// preference lands on the palette it meant. Mirrored in settings.js and
// background.js — change all three.
const LEGACY_THEME_IDS = { "terracotta-dark": "dark", "terracotta-light": "light" };
const migrateThemeId = (id) => LEGACY_THEME_IDS[id] || id;

// Mirror of REDLINE_PREFS in content.js — change both.
const REDLINE_PREFS = {
  redlineUnit: ["px", "rem"],
  redlinePrecision: ["whole", "tenths"],
  redlinePillPlacement: ["beside", "online"],
  redlineGuides: ["on", "off"],
  redlineQuietOverlay: ["off", "on"],
  redlineZeroPills: ["on", "off"],
};

// Mirror of EDIT_PREFS in content.js — change both.
const EDIT_PREFS = {
  editGroups: ["standard", "adaptive"],
  editTokenControls: ["both", "token", "value"],
  // Read by background.js, which registers the document_start shader agent;
  // content.js carries the key so the rosters stay mirrors.
  editDeepShaderCapture: ["off", "on"],
};

// Mirror of COPY_PREFS in content.js — change both.
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

// Mirror of CHROME_PREFS in content.js — change both. Where the toolbar
// sits relative to the info label; the ids are what is stored, the phrases
// are what the pills say.
const CHROME_PREFS = {
  selectionLayout: ["edge", "beside", "under", "bottom"],
};
const LAYOUT_NAMES = {
  edge: "On the edge",
  beside: "Beside the lines",
  under: "Under the name",
  bottom: "Along the bottom",
};

// One roster for everything the sheet writes, so a new setting only has to be
// added to the map above to get storage, keyboard, and live-sync for free.
const ALL_PREFS = { ...REDLINE_PREFS, ...EDIT_PREFS, ...COPY_PREFS, ...CHROME_PREFS };

const prefs = {};
for (const key of Object.keys(ALL_PREFS)) prefs[key] = ALL_PREFS[key][0];

// The vignette's two sample gaps — the blueprint's vertical and horizontal
// measurements. Fractional on purpose, so flipping precision or unit visibly
// changes the readout; the drawn lines round to the same px the extension's
// renderer would.
const VIG_A = 70.4;
const VIG_B = 86.6;

// Mirrored from content.js formatRedlineValue — change both. remBase here is
// 16: the vignette previews the common case, not this page's own font-size.
function formatRedlineValue(px, unit, precision, remBase) {
  if (unit === "rem") {
    return (px / remBase).toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + "rem";
  }
  if (precision === "tenths") {
    return (Math.round(px * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }
  return String(Math.round(px));
}

// ===== The copy payload =====
// The rail assembles a real clipboard payload rather than drawing a picture of
// one, which means two pieces of content.js have to live here as well: the
// emission order and the comment dialect. Both are mirrored, both are checked
// by test/mirror-drift.mjs. What is *not* mirrored is any of the extension's
// logic for finding those values — the fixture below supplies them as literal
// strings, the same seam the measuring vignette keeps with its hand-drawn
// geometry.

// Mirror of COPY_ORDER in content.js — change both.
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

// Mirror of renderCopyHeader in content.js — change both.
function renderCopyHeader(fields) {
  return fields
    .map((f) => f.lines.map((l, i) => (i === 0 ? `# ${f.key}: ` : "#   ") + l).join("\n"))
    .join("\n");
}

// Mirror of copyTrim in content.js — change both.
function copyTrim(prefs, located) {
  return (!located && prefs.copyHtmlFallback === "on") ? "full" : prefs.copyHtml;
}

// Mirror of fenceBlock in content.js — change both.
function fenceBlock(prefs, body) {
  if (!body) return "";
  return prefs.copyFence === "on" ? "```\n" + body + "\n```" : body;
}

// Mirror of assemblePayload in content.js — change both.
function assemblePayload(prefs, header, html) {
  if (prefs.copyFence === "on") {
    return fenceBlock(prefs, [header, html].filter(Boolean).join("\n"));
  }
  return [header, html && "```html\n" + html + "\n```"].filter(Boolean).join("\n\n");
}

// One element, as the extension would have found it: the fourth row of an
// invoice table on a dev server. Every line is what the corresponding extractor
// would return for it.
const SAMPLE = {
  source: ["src/components/InvoiceRow.tsx:18:4"],
  component: ["InvoiceRow <- InvoiceTable <- BillingPage"],
  page: ["localhost:5173/billing"],
  anchor: ['data-testid="invoice-row" (12 matches - one per row)', 'text "INV-2043" (unique in page)'],
  handlers: ["onClick=openInvoice"],
  selector: ["main#app > table.invoices > tbody > tr:nth-child(4)"],
  position: ["child 4 of 12 in InvoiceTable <tbody>", "after INV-2042, before INV-2044"],
  repeated: [
    "4 of 12 identical siblings - likely one template; change",
    "the component or the data unless this instance alone is meant",
  ],
  layout: ["box 880x52 - display table-row", "parent display table-row-group"],
  styles: ["invoices.css  tbody tr { border-bottom: 1px solid var(--line) }"],
  props: ['id: "INV-2043" - amount: 124000 - status: "paid"'],
  text: ["INV-2043 $1,240.00 View"],
};

const SAMPLE_HTML = {
  open: '<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors dark:border-slate-800" data-testid="invoice-row">',
  close: "</tr>",
  children: "3 children",
  shape: [
    '  td > div.flex.items-center.gap-2 > span.size-2.rounded-full.bg-emerald-500 + span.font-medium "INV-2043"',
    '  td.px-4.py-3.text-right > span.tabular-nums "$1,240.00"',
    '  td.px-4.py-3 > button.btn.btn-ghost "View" onClick={openInvoice}',
  ],
  full: {
    3: [
      '  <td class="px-4 py-3">',
      '    <div class="flex items-center gap-2">',
      '      <span class="size-2 rounded-full bg-emerald-500"></span>',
      '      <span class="font-medium">INV-2043</span>',
      "    </div>",
      "  </td>",
      '  <td class="px-4 py-3 text-right">',
      '    <span class="tabular-nums">$1,240.00</span>',
      "  </td>",
      '  <td class="px-4 py-3">',
      '    <button class="btn btn-ghost" onclick="openInvoice(id)">View</button>',
      "  </td>",
    ],
    2: [
      '  <td class="px-4 py-3">',
      '    <div class="flex items-center gap-2"><!-- 2 children --></div>',
      "  </td>",
      '  <td class="px-4 py-3 text-right">',
      '    <span class="tabular-nums">$1,240.00</span>',
      "  </td>",
      '  <td class="px-4 py-3">',
      '    <button class="btn btn-ghost">View</button>',
      "  </td>",
    ],
    1: [
      '  <td class="px-4 py-3"><!-- 1 child --></td>',
      '  <td class="px-4 py-3 text-right"><!-- 1 child --></td>',
      '  <td class="px-4 py-3"><!-- 1 child --></td>',
    ],
  },
};

// Every field key, and the three bulk sets the preset row writes.
//
// "+ place" is deliberately the shipped default, so the row reads as a position
// on a dial rather than three unrelated buttons. Props is in no preset: it is
// the one field that can carry the page's own data into a prompt, and reaching
// for a preset is not the same as choosing that.
const FIELD_KEYS = COPY_ORDER.map(([, pref]) => pref);
const PRESET_POINTER = ["copySource", "copyComponent", "copyPage", "copyAnchor", "copyHandlers", "copyText"];
const PRESETS = {
  pointer: PRESET_POINTER,
  pointerplus: [...PRESET_POINTER, "copySelector", "copyPosition", "copyRepeated"],
  all: [...PRESET_POINTER, "copySelector", "copyPosition", "copyRepeated", "copyLayout", "copyStyles"],
};

// Storage is only there when this page is loaded as the extension's options
// page. Opened directly from disk it still renders and previews — it just can't
// persist — which is what makes the page inspectable outside the extension.
const store = {
  available: typeof chrome !== "undefined" && !!chrome.storage?.local,
  get(key, cb) {
    if (!this.available) return cb({});
    chrome.storage.local.get(key, cb);
  },
  set(obj) {
    if (this.available) chrome.storage.local.set(obj);
  },
  onChange(cb) {
    if (this.available) chrome.storage.onChanged.addListener(cb);
  },
};

const pillHost = document.getElementById("theme-pills");
const savedAppearance = document.getElementById("saved-appearance");
const savedSelection = document.getElementById("saved-selection");
const layoutHost = document.getElementById("layout-pills");
const chromeMockEl = document.getElementById("chrome-mock");
const savedMeasuring = document.getElementById("saved-measuring");
const savedEditing = document.getElementById("saved-editing");
const savedCopying = document.getElementById("saved-copying");
const resetEl = document.getElementById("measure-reset");
const copyResetEl = document.getElementById("copy-reset");
const sheetEl = document.getElementById("measure-sheet");
const editSheetEl = document.getElementById("edit-sheet");
const copySheetEl = document.getElementById("copy-sheet");
const editMockEl = document.getElementById("edit-mock");
const payEl = document.getElementById("copy-pay");
const payOutEl = document.getElementById("copy-out");
const payCountEl = document.getElementById("copy-count");
const payNoteEl = document.getElementById("copy-note");
const depthRowEl = document.getElementById("row-depth");
const railEl = document.getElementById("preview-rail");
const vigEl = document.getElementById("measure-vig");
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

// The toolbar icon follows the browser's scheme (see background.js). Pages
// report it as they load; this page reports it too, so a visit here puts the
// icon right even when no page has loaded since the OS flipped.
function reportColorScheme() {
  chrome.runtime.sendMessage({ type: "COLOR_SCHEME", dark: darkQuery.matches }).catch(() => {});
}
reportColorScheme();
darkQuery.addEventListener("change", reportColorScheme);

let current = DEFAULT_THEME;
const savedTimers = new Map();

// Whether the fixture's source pointer resolves. Page state, not a setting:
// it is the one condition the payload cannot show on its own, and it decides
// whether the HTML block falls back to the full subtree.
let pointerResolves = true;

// Same resolution the content script does, so the preview matches what the page
// will actually render.
function resolveTheme(pref) {
  if (pref !== "system") return pref;
  return darkQuery.matches ? "dark" : "light";
}

function swatchMarkup(id) {
  if (id === "system") {
    return (
      '<span class="sp-sw sp-sw-split" aria-hidden="true">' +
      '<span data-pnt-theme="dark"><i></i><i></i></span>' +
      '<span data-pnt-theme="light"><i></i><i></i></span>' +
      "</span>"
    );
  }
  return (
    `<span class="sp-sw" data-pnt-theme="${id}" aria-hidden="true">` +
    "<i></i><i></i><i></i><i></i></span>"
  );
}

function renderPills() {
  pillHost.innerHTML = THEMES.map(
    (t) =>
      `<button type="button" class="sp-pill" role="radio" data-theme="${t.id}" ` +
      `aria-checked="false">${swatchMarkup(t.id)}<span>${t.name}</span></button>`
  ).join("");
}

function paintTheme() {
  document.documentElement.dataset.pntTheme = resolveTheme(current);
  for (const pill of pillHost.querySelectorAll(".sp-pill")) {
    const on = pill.dataset.theme === current;
    pill.setAttribute("aria-checked", String(on));
    // Only the selected pill is a tab stop, which is how a radiogroup should
    // behave — arrow keys move between options, Tab leaves the group.
    pill.tabIndex = on ? 0 : -1;
  }
}

// Which fields the fixture emits, in COPY_ORDER. A pointer that does not
// resolve drops both of the fields that would have named it — that is what
// "does not resolve" means, and it is what the HTML block reacts to.
function payloadFields() {
  const out = [];
  for (const [key, pref] of COPY_ORDER) {
    if (prefs[pref] !== "on") continue;
    if (!pointerResolves && (key === "source" || key === "component")) continue;
    out.push({ key, lines: SAMPLE[key] });
  }
  return out;
}

// The fixture's answer to buildCopyHtml, over literal strings rather than a
// real subtree. The trim decision itself is the shared function, so the
// fallback rule cannot be reproduced here slightly differently.
function sampleHtml(located) {
  const trim = copyTrim(prefs, located);
  if (trim === "none") return "";
  if (trim === "root") return `${SAMPLE_HTML.open} … ${SAMPLE_HTML.children} ${SAMPLE_HTML.close}`;
  if (trim === "shape") return [SAMPLE_HTML.open, ...SAMPLE_HTML.shape, SAMPLE_HTML.close].join("\n");
  return [SAMPLE_HTML.open, ...SAMPLE_HTML.full[prefs.copyDepth], SAMPLE_HTML.close].join("\n");
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const tint = (s) => s.replace(/(&lt;\/?[a-z][a-z0-9-]*)/g, '<span class="sp-pay-tag">$1</span>');
// The wrapper fences are the only lines that are nothing but backticks, so
// they can be found again after assembly rather than threaded through it.
const markFences = (s) =>
  s.replace(/^```(?:html)?$/gm, (m) => `<span data-field="fence" class="sp-pay-fence">${m}</span>`);

// The payload, twice through the same assembly: once over plain strings, for
// the text the clipboard would receive, and once over marked-up ones, so
// hovering a row can light the line it writes. Running it twice rather than
// deriving one from the other is what keeps the marked-up copy honest — both
// are assemblePayload's output, so neither can drift into a different shape.
function paintPayload() {
  if (!payOutEl) return;
  const fields = payloadFields();
  const located = pointerResolves && (prefs.copySource === "on" || prefs.copyComponent === "on");
  const html = sampleHtml(located);

  const text = assemblePayload(prefs, renderCopyHeader(fields), html);
  const marked = markFences(assemblePayload(
    prefs,
    fields.map((f) => `<span data-field="${f.key}">${esc(renderCopyHeader([f]))}</span>`).join("\n"),
    html && `<span data-field="html">${tint(esc(html))}</span>`
  ));

  payOutEl.innerHTML = marked ||
    '<span class="sp-pay-empty">Nothing to copy — every field is off, and the HTML block with them.</span>';
  // innerHTML has just replaced the spans a spotlight was pointing at, so a
  // switch flipped while hovering its own row keeps its line lit.
  spotlightPayload(payHi);
  payCountEl.textContent = text
    ? `${text.length} chars · ~${Math.round(text.length / 3.7)} tokens`
    : "";

  // Two things the payload cannot say about itself.
  if (!located && prefs.copyHtmlFallback === "on") {
    payNoteEl.className = "sp-pay-note";
    payNoteEl.innerHTML = "Nothing points at the source, so <b>the full subtree comes back</b>. " +
      "With no file to open, it is the only concrete description of the element left in the payload.";
  } else if (prefs.copyFence === "off" && !html) {
    payNoteEl.className = "sp-pay-note sp-pay-warn";
    payNoteEl.innerHTML = "Nothing delimits this block now — no fence, no code block. " +
      "It will run straight into the sentence you wrote around it.";
  } else {
    payNoteEl.className = "sp-pay-note";
    payNoteEl.textContent = "";
  }
}

// Which line of the payload the pointer is currently over a control for.
let payHi = null;

function spotlightPayload(key) {
  payHi = key;
  if (!payOutEl) return;
  for (const span of payOutEl.querySelectorAll("[data-field]")) {
    span.classList.toggle("sp-pay-hi", Boolean(key) && span.dataset.field === key);
  }
}

// Which preset the field switches currently spell, if any.
function presetOf() {
  for (const name of Object.keys(PRESETS)) {
    const on = new Set(PRESETS[name]);
    if (FIELD_KEYS.every((key) => (prefs[key] === "on") === on.has(key))) return name;
  }
  return null;
}

// One write and one announce for the whole set: twelve of each would be twelve
// storage round trips and a note nobody could read.
function applyPreset(name) {
  const on = new Set(PRESETS[name]);
  const payload = {};
  for (const key of FIELD_KEYS) {
    const value = on.has(key) ? "on" : "off";
    if (prefs[key] === value) continue;
    prefs[key] = value;
    payload[key] = value;
  }
  paintPrefs();
  if (Object.keys(payload).length > 0) store.set(payload);
  const label = copySheetEl?.querySelector(`[data-preset="${name}"]`)?.textContent || name;
  announce(savedCopying, `Fields · ${label}`);
}

// All three sheets, so a control is painted wherever it lives.
const controlHosts = [sheetEl, editSheetEl, copySheetEl, layoutHost].filter(Boolean);
const eachControl = (selector, fn) => {
  for (const host of controlHosts) for (const node of host.querySelectorAll(selector)) fn(node);
};

// One pass syncs every measuring control and the vignette to `prefs`.
function paintPrefs() {
  eachControl("[data-set]", (btn) => {
    const on = prefs[btn.dataset.set] === btn.dataset.val;
    btn.setAttribute("aria-checked", String(on));
    // Roving tabindex, same as the theme pills: the checked option is the
    // group's one tab stop, arrows move within it.
    btn.tabIndex = on ? 0 : -1;
  });
  eachControl("[data-sw]", (sw) => {
    sw.setAttribute("aria-checked", String(prefs[sw.dataset.sw] === "on"));
  });
  // The editing specimen is the real panel chrome, so the two settings act on
  // it the way they act on the live one.
  if (editMockEl) {
    editMockEl.dataset.groups = prefs.editGroups;
    editMockEl.dataset.tokens = prefs.editTokenControls;
  }
  paintLayout();
  // The preset row is not a stored setting — it reports which bulk set the
  // field switches currently spell, and nothing at all once they spell none.
  const preset = presetOf();
  for (const btn of copySheetEl?.querySelectorAll("[data-preset]") || []) {
    btn.setAttribute("aria-pressed", String(btn.dataset.preset === preset));
  }
  // Depth only means anything for the full subtree; the other three variants
  // have no depth to choose. Hidden rather than disabled — there is no question
  // being asked, so there is nothing to grey out.
  if (depthRowEl) depthRowEl.hidden = prefs.copyHtml !== "full";
  for (const btn of payEl?.querySelectorAll("[data-src]") || []) {
    btn.setAttribute("aria-checked", String((btn.dataset.src === "1") === pointerResolves));
  }

  // Nothing to reset when everything already sits at its default.
  resetEl.disabled = Object.keys(REDLINE_PREFS)
    .every((key) => prefs[key] === REDLINE_PREFS[key][0]);
  if (copyResetEl) {
    copyResetEl.disabled = Object.keys(COPY_PREFS)
      .every((key) => prefs[key] === COPY_PREFS[key][0]);
  }
  paintPayload();
  vigEl.dataset.placement = prefs.redlinePillPlacement;
  vigEl.dataset.guides = prefs.redlineGuides;
  vigEl.dataset.quiet = prefs.redlineQuietOverlay;
  vigEl.dataset.zeros = prefs.redlineZeroPills;
  const fmt = (px) =>
    formatRedlineValue(px, prefs.redlineUnit, prefs.redlinePrecision, 16);
  document.getElementById("vig-pill-a").textContent = fmt(VIG_A);
  document.getElementById("vig-pill-b").textContent = fmt(VIG_B);
  document.getElementById("vig-pill-z").textContent = fmt(0);
  // The caption quotes the checked controls, so it can never disagree with them.
  document.getElementById("vig-caption").textContent =
    ["redlineUnit", "redlinePrecision", "redlinePillPlacement"]
      .map((key) => sheetEl.querySelector(`[data-set="${key}"][aria-checked="true"]`)?.textContent)
      .filter(Boolean)
      .join(" · ");
}

// The selection specimen redraws in the chosen layout the way content.js
// does it: the layout class on <html>, so content.css's layout blocks apply
// to the mock as they do to the page; the toolbar node moved to its mount;
// the hints to their home; and, Along the bottom, the card locked to its
// bar's width. Transcribed by hand from mountToolbar(), updateLabel()'s hints
// and lockCardWidth() — cdp.mjs checks the real ones, this one is checked by
// eye on the page.
const HINTS_HTML = '<kbd class="pnt-kbd">⌥</kbd><span>measure</span><kbd class="pnt-kbd">esc</kbd>';

function paintLayout() {
  const layout = prefs.selectionLayout;
  const root = document.documentElement;
  for (const id of CHROME_PREFS.selectionLayout) root.classList.remove(`pnt-layout-${id}`);
  root.classList.add(`pnt-layout-${layout}`);
  if (!chromeMockEl) return;

  const label = chromeMockEl.querySelector("#pnt-label");
  const toolbar = chromeMockEl.querySelector("#pnt-toolbar");
  const beam = chromeMockEl.querySelector(".sl-el");
  const head = label.querySelector(".pnt-label-head");
  const body = label.querySelector(".pnt-label-content");

  label.querySelector(".pnt-label-hints")?.remove();
  label.querySelector(".pnt-line-breadcrumb .pnt-hints")?.remove();

  label.classList.toggle("pnt-with-actions", layout !== "edge");
  if (layout === "beside") label.prepend(toolbar);
  else if (layout === "under") head.after(toolbar);
  else if (layout === "bottom") label.appendChild(toolbar);
  else beam.appendChild(toolbar);

  if (layout === "edge" || layout === "beside") {
    const caption = document.createElement("div");
    caption.className = "pnt-label-hints";
    caption.innerHTML = HINTS_HTML;
    body.after(caption);
  } else if (layout === "bottom") {
    const hints = document.createElement("span");
    hints.className = "pnt-hints";
    hints.innerHTML = HINTS_HTML;
    label.querySelector(".pnt-line-breadcrumb").appendChild(hints);
  }

  label.style.width = "";
  if (layout === "bottom") {
    const bar = toolbar.querySelector(".pnt-bar");
    bar.style.width = "max-content";
    const w = bar.offsetWidth;
    bar.style.width = "";
    label.style.width = (w + label.offsetWidth - label.clientWidth) + "px";
  }

  const name = document.getElementById("an-layout-name");
  if (name) name.textContent = LAYOUT_NAMES[layout];
}

// Feedback lands in the section where the change happened, and it does not
// claim more than is true: without the extension's storage (this page opened
// straight from disk, say) nothing persists, and the line says so.
function announce(noteEl, text) {
  noteEl.textContent = store.available
    ? `Saved — ${text}`
    : "Preview only — changes aren't saved here.";
  noteEl.classList.add("sp-saved-in");
  clearTimeout(savedTimers.get(noteEl));
  savedTimers.set(noteEl, setTimeout(() => {
    noteEl.classList.remove("sp-saved-in");
    // The text outlives the class by one fade (--pnt-duration), so the note
    // doesn't blank out mid-transition.
    savedTimers.set(noteEl, setTimeout(() => {
      noteEl.textContent = "";
    }, 150));
  }, 2400));
}

function selectTheme(id) {
  if (!THEMES.some((t) => t.id === id)) return;
  current = id;
  paintTheme();
  store.set({ [THEME_KEY]: id });
  announce(savedAppearance, THEMES.find((t) => t.id === id).name);
}

// The announce quotes the row's own label and the control's own text, so what
// is read back is exactly what was clicked — the vocabulary cannot drift.
function announceText(key, value) {
  const control = document.querySelector(`[data-set="${key}"][data-val="${value}"], [data-sw="${key}"]`);
  // The layout pills stand outside a spec row; "Layout" is their label.
  const label = control?.closest(".sp-spec")?.querySelector(".sp-spec-label")?.textContent
    || (key in CHROME_PREFS ? "Layout" : key);
  const valueText = control?.dataset.set ? control.textContent.trim() : value;
  return `${label} · ${valueText}`;
}

// Feedback belongs to the section the control lives in, so it is read where it
// was clicked.
function noteFor(key) {
  if (key in EDIT_PREFS) return savedEditing;
  if (key in COPY_PREFS) return savedCopying;
  if (key in CHROME_PREFS) return savedSelection;
  return savedMeasuring;
}

function setPref(key, value) {
  const roster = ALL_PREFS[key];
  if (!roster || !roster.includes(value)) return;
  prefs[key] = value;
  paintPrefs();
  store.set({ [key]: value });
  announce(noteFor(key), announceText(key, value));
}

renderPills();

pillHost.addEventListener("click", (e) => {
  const pill = e.target.closest(".sp-pill");
  if (pill) selectTheme(pill.dataset.theme);
});

// Arrow-key navigation, per the radiogroup pattern.
pillHost.addEventListener("keydown", (e) => {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
  const i = THEMES.findIndex((t) => t.id === current);
  const next = THEMES[(i + step + THEMES.length) % THEMES.length].id;
  selectTheme(next);
  pillHost.querySelector(`.sp-pill[data-theme="${next}"]`)?.focus();
});

// The sheets: presets write a whole set, segmented radios write their value,
// switches toggle.
for (const host of controlHosts) host.addEventListener("click", (e) => {
  const preset = e.target.closest("[data-preset]");
  if (preset) return applyPreset(preset.dataset.preset);
  const radio = e.target.closest("[data-set]");
  if (radio) return setPref(radio.dataset.set, radio.dataset.val);
  const sw = e.target.closest("[data-sw]");
  if (sw) {
    const key = sw.dataset.sw;
    setPref(key, prefs[key] === "on" ? "off" : "on");
  }
});

function restore(roster, note) {
  const payload = {};
  for (const key of Object.keys(roster)) {
    prefs[key] = roster[key][0];
    payload[key] = prefs[key];
  }
  paintPrefs();
  store.set(payload);
  announce(note, "defaults restored");
}

resetEl.addEventListener("click", () => restore(REDLINE_PREFS, savedMeasuring));
copyResetEl?.addEventListener("click", () => restore(COPY_PREFS, savedCopying));

// The resolved chips are the preview's own state — nothing is stored, and the
// note under the payload explains what flipping them proves.
payEl?.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-src]");
  if (!chip) return;
  pointerResolves = chip.dataset.src === "1";
  paintPrefs();
});

// Arrows walk the roster in the direction pressed and wrap at the ends — the
// standard radiogroup pattern. Written as a cycle rather than "flip to the
// other one" because the Editing section's token control has three values;
// for a pair the two are the same behaviour.
for (const host of controlHosts) host.addEventListener("keydown", (e) => {
  const forward = ["ArrowRight", "ArrowDown"];
  const back = ["ArrowLeft", "ArrowUp"];
  if (!forward.includes(e.key) && !back.includes(e.key)) return;
  const radio = e.target.closest("[data-set]");
  if (!radio) return;
  e.preventDefault();
  const key = radio.dataset.set;
  const roster = ALL_PREFS[key];
  if (!roster) return;
  const step = forward.includes(e.key) ? 1 : -1;
  const next = roster[(roster.indexOf(prefs[key]) + step + roster.length) % roster.length];
  setPref(key, next);
  document.querySelector(`[data-set="${key}"][data-val="${next}"]`)?.focus();
});

// The rail answers whichever section the pointer or focus is in: the chrome
// mock for Appearance, the measuring vignette for the sheet. The guard keeps
// re-entering the same section from restarting the crossfade.
for (const zone of document.querySelectorAll("[data-focus]")) {
  const mode = zone.dataset.focus;
  const setMode = () => {
    if (railEl.dataset.mode !== mode) railEl.dataset.mode = mode;
  };
  zone.addEventListener("pointerenter", setMode);
  zone.addEventListener("focusin", setMode);
}

// Hovering or focusing into a spec row spotlights the part of the vignette it
// controls — keyboard users get the same lesson pointer users do.
for (const row of document.querySelectorAll(".sp-spec")) {
  // Each row spotlights inside whichever preview its section owns. The copy
  // payload is text rather than drawn geometry, so it lights up the line the
  // row writes instead of taking a data-hi of its own.
  const inCopy = Boolean(row.closest('[data-focus="copy"]'));
  const target = row.closest('[data-focus="edit"]') ? editMockEl : vigEl;
  const spotlight = () => {
    if (inCopy) return spotlightPayload(row.dataset.hi || null);
    if (target) target.dataset.hi = row.dataset.hi;
  };
  const unspot = () => {
    if (inCopy) return spotlightPayload(null);
    if (target) delete target.dataset.hi;
  };
  row.addEventListener("pointerenter", spotlight);
  row.addEventListener("pointerleave", unspot);
  row.addEventListener("focusin", spotlight);
  row.addEventListener("focusout", (e) => {
    if (!row.contains(e.relatedTarget)) unspot();
  });
}

// Follow the OS while System is selected, so the preview tracks a light/dark flip.
darkQuery.addEventListener("change", () => {
  if (current === "system") paintTheme();
});

// Keep a second settings tab in step with this one.
store.onChange((changes, area) => {
  if (area !== "local") return;
  if (changes[THEME_KEY]) {
    const next = migrateThemeId(changes[THEME_KEY].newValue || DEFAULT_THEME);
    if (next !== current) {
      current = next;
      paintTheme();
    }
  }
  let touched = false;
  for (const key of Object.keys(ALL_PREFS)) {
    if (!changes[key]) continue;
    const next = changes[key].newValue;
    if (ALL_PREFS[key].includes(next) && next !== prefs[key]) {
      prefs[key] = next;
      touched = true;
    }
  }
  if (touched) paintPrefs();
});

store.get([THEME_KEY, ...Object.keys(ALL_PREFS)], (stored) => {
  if (stored && typeof stored[THEME_KEY] === "string") current = migrateThemeId(stored[THEME_KEY]);
  for (const key of Object.keys(ALL_PREFS)) {
    if (stored && ALL_PREFS[key].includes(stored[key])) prefs[key] = stored[key];
  }
  paintTheme();
  paintPrefs();
});

// The sidebar marks the section most in view. A pointer over a link already
// previews its section in the rail — the link carries the section's data-focus
// and the loop above attached to every [data-focus] alike.
const navLinks = Array.from(document.querySelectorAll(".sp-nav-list a"));
const navSections = navLinks
  .map((a) => document.querySelector(a.getAttribute("href")))
  .filter(Boolean);
if ("IntersectionObserver" in window && navSections.length) {
  const visible = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target, e.intersectionRatio);
    let best = navSections[0];
    for (const s of navSections) {
      if ((visible.get(s) || 0) > (visible.get(best) || 0)) best = s;
    }
    for (const a of navLinks) {
      if (a.getAttribute("href") === "#" + best.id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "-10% 0px -45% 0px" });
  navSections.forEach((s) => observer.observe(s));
}

// The version is the manifest's, when there is a manifest to ask.
const versionEl = document.getElementById("sp-version");
if (versionEl && typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
  versionEl.textContent = chrome.runtime.getManifest().version;
}
