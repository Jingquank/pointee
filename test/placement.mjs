// Shared placement model for the probe-chrome harness.
//
// The two `placeLabel` / `placeToolbar` functions are transcribed from the
// extension so the harness can evaluate the whole matrix with no browser and
// no extension installed:
//
//   label   -> the tail of updateLabel, as it stood in 1.1.0
//   toolbar -> positionToolbar, as it stood in 1.1.0
//
// Neither function exists in content.js any more — both were replaced by the
// single computeChromeLayout() pass, which runSimV2 below mirrors. They are kept
// only as the "before" column in test/sim.mjs. (This comment used to cite
// content.js:587 and :773; those line numbers went stale the moment the
// functions were removed, so they are not repeated here.)
//
// They are deliberately verbatim, warts included. Live mode measures the real
// #pnt-label / #pnt-toolbar and is the check that this transcription is honest.
//
// GEOMETRY in content.js is the other half of this mirror: M / GAP / PAIR /
// MIN_LABEL_H below must match GEOMETRY.margin / .gap / .pair /
// .minLabelHeight.

// ===== Current algorithms =====

export function placeLabel(rect, box, vw, vh) {
  const gap = 6;
  let top = rect.top - box.h - gap;
  if (top < 4) top = rect.bottom + gap; // note: no vertical clamp, ever
  let left = rect.left;
  if (left + box.w > vw - 4) left = vw - box.w - 4;
  if (left < 4) left = 4;
  return { top, left, w: box.w, h: box.h };
}

export function placeToolbar(rect, box, vw, vh) {
  const gap = 8;
  let top;
  if (rect.bottom + gap + box.h < vh) top = rect.bottom + gap;
  else if (rect.top - gap - box.h > 0) top = rect.top - gap - box.h;
  else top = Math.max(4, vh - box.h - 4);
  let left = rect.left;
  if (left + box.w > vw - 4) left = vw - box.w - 4;
  if (left < 4) left = 4;
  return { top, left, w: box.w, h: box.h };
}

// Measured from content.css: the label is max-width 460 and runs 1–5 lines;
// the toolbar is COPY CODE + SCREENSHOT + SELECT PARENT on a single rail.
export const BOX = {
  label: { w: 460, h: 92 },
  toolbar: { w: 430, h: 46 },
};

// ===== Case matrix =====
// Element geometry expressed relative to the viewport. Every field is a
// function of (vw, vh) so the cases hold at any window size.

export const CASES = [
  { id: "in-view", name: "Fully in view, room above + below",
    w: () => 320, h: () => 200, top: (vw, vh, h) => Math.round((vh - h) / 2), left: () => 60 },

  { id: "flush-top", name: "Top edge flush with viewport top",
    w: () => 320, h: () => 200, top: () => 0, left: () => 60 },

  { id: "near-top", name: "20px from top — label cannot fit above",
    w: () => 320, h: () => 200, top: () => 20, left: () => 60 },

  { id: "top-cut", name: "Top cut off by viewport",
    w: () => 320, h: (vw, vh) => Math.round(vh * 0.8), top: () => -150, left: () => 60 },

  { id: "bottom-cut", name: "Bottom cut off, room above  <- reported overlap",
    w: () => 320, h: (vw, vh) => vh, top: () => 200, left: () => 60 },

  { id: "bottom-cut-tight", name: "Bottom cut off, no room above",
    w: () => 320, h: (vw, vh) => vh, top: () => 10, left: () => 60 },

  { id: "both-cut", name: "Taller than viewport, both edges cut",
    w: () => 320, h: (vw, vh) => vh * 3, top: (vw, vh) => -vh, left: () => 60 },

  { id: "near-bottom", name: "20px from bottom — toolbar cannot fit below",
    w: () => 320, h: () => 200, top: (vw, vh, h) => vh - h - 20, left: () => 60 },

  { id: "flush-bottom", name: "Bottom edge flush with viewport bottom",
    w: () => 320, h: () => 200, top: (vw, vh, h) => vh - h, left: () => 60 },

  { id: "overflow-right", name: "Overflows the right edge",
    w: () => 320, h: () => 180, top: (vw, vh, h) => Math.round((vh - h) / 2), left: (vw) => vw - 90 },

  { id: "wider-than-vp", name: "Wider than the viewport",
    w: (vw) => Math.round(vw * 1.5), h: () => 180, top: (vw, vh, h) => Math.round((vh - h) / 2), left: () => -100 },

  { id: "narrow", name: "Element narrower than the label",
    w: () => 40, h: () => 40, top: (vw, vh, h) => Math.round((vh - h) / 2), left: () => 60 },

  { id: "narrow-right", name: "Narrow, hard against the right edge",
    w: () => 40, h: () => 40, top: (vw, vh, h) => Math.round((vh - h) / 2), left: (vw) => vw - 50 },

  { id: "tiny", name: "Tiny 8x8 target",
    w: () => 8, h: () => 8, top: (vw, vh, h) => Math.round((vh - h) / 2), left: () => 60, degenerate: true },

  { id: "zero-height", name: "Zero-height element",
    w: () => 320, h: () => 0, top: (vw, vh) => Math.round(vh / 2), left: () => 60, degenerate: true },

  { id: "corner-br", name: "Bottom-right corner",
    w: () => 200, h: () => 120, top: (vw, vh, h) => vh - h - 8, left: (vw) => vw - 208 },

  { id: "corner-tr", name: "Top-right corner",
    w: () => 200, h: () => 120, top: () => 8, left: (vw) => vw - 208 },

  { id: "short-vp", name: "Element fills all but 30px of the viewport",
    w: () => 320, h: (vw, vh) => vh - 30, top: () => 15, left: () => 60 },

  { id: "doc-end", name: "Last element in the document",
    w: () => 320, h: () => 200, top: (vw, vh, h) => vh - h - 40, left: () => 60, atEnd: true },

  { id: "fixed-bar", name: "position:fixed bar pinned to viewport bottom",
    fixed: true, w: () => 260, h: () => 52, top: (vw, vh, h) => vh - h, left: () => 44 },

  { id: "page", name: "Whole page (<body>)",
    body: true, w: (vw) => vw - 44, h: (vw, vh) => vh * 5, top: () => 0, left: () => 44 },

  // Only reachable by selecting and then scrolling away, so live mode skips
  // them — but once layout runs on scroll they stop being hypothetical.
  { id: "off-above", name: "Selected, then scrolled below it", simOnly: true,
    w: () => 320, h: () => 200, top: () => -400, left: () => 60 },

  { id: "off-below", name: "Selected, then scrolled above it", simOnly: true,
    w: () => 320, h: () => 200, top: (vw, vh) => vh + 100, left: () => 60 },
];

// ===== Proposed algorithm =====
//
// One layout pass that places both boxes together, so they cannot collide.
// Two ideas do the work:
//
//   1. Anchor to the *visible* rect (element ∩ viewport), never the raw rect.
//      Every "label flew 6000px off-screen" bug comes from anchoring to a
//      rect.bottom that is far below the fold.
//   2. Try whole layouts, not per-box positions. Each strategy places the pair
//      at once and is accepted only if both boxes land inside the viewport and
//      clear each other.
//
// Strategies are ordered by how little they intrude: keep the element clear if
// at all possible, and only lie on top of it when it is bigger than the screen.

export const M = 4;     // viewport margin
export const GAP = 6;   // gap between chrome and the element edge
export const PAIR = 6;  // gap between label and toolbar when they are stacked

// The label is capped by CSS max-width; both must also survive a narrow window.
export function boxesFor(vw, labelH = BOX.label.h, toolbarH = BOX.toolbar.h) {
  return {
    label:   { w: Math.min(BOX.label.w, vw - 2 * M), h: labelH },
    toolbar: { w: Math.min(BOX.toolbar.w, vw - 2 * M), h: toolbarH },
  };
}

const clampLeft = (left, w, vw) => Math.max(M, Math.min(left, vw - w - M));
const fitsV = (top, h, vh) => top >= M && top + h <= vh - M;

// Below this the label has no room to say anything useful, so it steps aside.
export const MIN_LABEL_H = 24;

// ===== The selection layout =====
// Since 3.0 there is one: the inspector beside the element and the toolbar
// pill under the inspector, placed as one unit. The selection layout
// preference and its four mounts were retired with it. Measured at 1440 wide:
// a selected inspector is around 260×300 (it hugs its content, up to 420
// wide), the scrolling part of it below its picture is what yields — `minH`
// is the card with that part gone — and the pill is 132×34.
export const LAYOUTS = ["side"];

export function boxesForLayout(vw) {
  const w = (max) => Math.min(max, vw - 2 * M);
  return { label: { w: w(300), h: 300, minH: 210 }, toolbar: { w: 132, h: 34 } };
}

export const optsForLayout = () => ({ side: true });

// `boxes.toolbar` is null while merely hovering, and in the layouts that
// mount the actions inside the label — then the label is placed alone.
// `boxes.label.minH` is how far the label may shrink before it hides: with
// the actions inside, the readout yields and the actions never do.
// `opts.side` is the 3.0 rule: inspector beside the element, toolbar under it.
export function layoutChrome(rect, vw, vh, boxes = boxesFor(vw), opts = {}) {
  const T = boxes.toolbar
    ? { ...boxes.toolbar, hidden: false }
    : { w: 0, h: 0, hidden: true };

  // The toolbar is interactive — clipping it breaks the tool — so it is the
  // hard constraint and the label yields: first by shrinking (CSS max-height +
  // overflow), then by disappearing when even one line will not fit.
  const room = vh - 2 * M - (T.hidden ? 0 : T.h + PAIR);
  const labelH = Math.min(boxes.label.h, Math.max(0, room));
  const hidden = labelH < Math.max(MIN_LABEL_H, boxes.label.minH || 0);
  const L = { ...boxes.label, h: hidden ? 0 : labelH, hidden };

  // Whichever boxes are actually shown stack into one unit.
  const stack = hidden ? 0 : L.h + PAIR;
  const clusterH = (hidden ? 0 : L.h) + (T.hidden ? 0 : T.h) + (hidden || T.hidden ? 0 : PAIR);

  const vis = {
    top: Math.max(rect.top, 0),
    left: Math.max(rect.left, 0),
    bottom: Math.min(rect.bottom, vh),
    right: Math.min(rect.right, vw),
  };

  const mk = (box, top, left) =>
    ({ top, left: clampLeft(left, box.w, vw), w: box.w, h: box.h, hidden: !!box.hidden });

  // A placement is only valid if every box it puts on screen stays on screen.
  const ok = (label, toolbar) =>
    (toolbar.hidden || fitsV(toolbar.top, T.h, vh)) &&
    (label.hidden || fitsV(label.top, L.h, vh));

  // label on top, toolbar beneath it, moving as one unit
  const cluster = (top, strategy, left = vis.left) => {
    const label = mk(L, top, left);
    const toolbar = mk(T, top + stack, left);
    return ok(label, toolbar) ? { strategy, label, toolbar } : null;
  };

  const dock = (atTop) => {
    const top = atTop ? M : Math.max(M, vh - M - clusterH);
    return cluster(top, "docked", vis.left) ?? {
      strategy: "docked",
      label: mk(L, top, vis.left),
      toolbar: mk(T, top + stack, vis.left),
    };
  };

  // Scrolled entirely out of view — dock to the edge it disappeared behind.
  if (vis.bottom < vis.top || vis.right < vis.left) return dock(rect.bottom < 0);

  // Beside: the inspector to the element's right with the toolbar a pair-gap
  // under it, one unit, left-aligned. Its top follows the element's visible
  // top and slides up to keep the bottom on screen. No room on the right: the
  // left. No room on either side: inside the element's top-right corner, then
  // the stacking strategies, clusters only — the two never split.
  if (opts.side) {
    const unitW = Math.max(L.hidden ? 0 : L.w, T.hidden ? 0 : T.w);
    const top = Math.max(M, Math.min(vis.top, vh - M - clusterH));
    const unit = (left, strategy) => {
      if (left < M || left + unitW > vw - M) return null;
      const label = { top, left, w: L.w, h: L.h, hidden: !!L.hidden };
      const toolbar = { top: top + stack, left, w: T.w, h: T.h, hidden: T.hidden };
      return ok(label, toolbar) ? { strategy, label, toolbar } : null;
    };
    const r =
      unit(rect.right + GAP, "side-right") ||
      unit(rect.left - GAP - unitW, "side-left");
    if (r) return r;
    const inside = cluster(Math.max(M, Math.min(vis.top + GAP, vh - M - clusterH)), "side-inside", vis.right - GAP - unitW);
    if (inside && vis.right - vis.left >= unitW + 2 * GAP && vis.bottom - vis.top >= clusterH + 2 * GAP) return inside;
    return (
      cluster(vis.bottom + GAP, "cluster-below") ||
      cluster(vis.top - GAP - clusterH, "cluster-above") ||
      cluster(Math.max(M, vis.top + GAP), "cluster-inside-top", vis.left + GAP) ||
      dock(false)
    );
  }

  const strategies = [
    // The good case, and the one that reads best: label above, actions below.
    () => {
      const label = mk(L, vis.top - GAP - L.h, vis.left);
      const toolbar = mk(T, vis.bottom + GAP, vis.left);
      return ok(label, toolbar) ? { strategy: "outside-split", label, toolbar } : null;
    },
    // Both on one side, stacked — still leaves the element itself unobscured.
    () => cluster(vis.bottom + GAP, "cluster-below"),
    () => cluster(vis.top - GAP - clusterH, "cluster-above"),
    // Element is bigger than the viewport: hug its visible top and bottom edges.
    () => {
      const label = mk(L, vis.top + GAP, vis.left + GAP);
      const toolbar = mk(T, vis.bottom - GAP - T.h, vis.left + GAP);
      return ok(label, toolbar) && intersectArea(label, toolbar) === 0
        ? { strategy: "inside-split", label, toolbar } : null;
    },
    // Too short to split inside — stack against the visible top edge.
    () => cluster(vis.top + GAP, "cluster-inside-top", vis.left + GAP),
  ];

  for (const s of strategies) {
    const r = s();
    if (r) return r;
  }
  return dock(false);
}

export function runSimV2(vw, vh, layout = "side") {
  return CASES.map((c) => {
    const rect = caseRect(c, vw, vh);
    const { strategy, label, toolbar } =
      layoutChrome(rect, vw, vh, boxesForLayout(vw, layout), optsForLayout(layout));
    return { id: c.id, name: c.name, rect, label, toolbar, strategy, ...evaluate(label, toolbar, vw, vh) };
  });
}

export function caseRect(c, vw, vh) {
  const w = c.w(vw, vh);
  const h = c.h(vw, vh);
  const top = c.top(vw, vh, h);
  const left = c.left(vw, vh, w);
  return { top, left, width: w, height: h, right: left + w, bottom: top + h };
}

// ===== Evaluation =====

export function intersectArea(a, b) {
  const aw = a.w ?? a.width, ah = a.h ?? a.height;
  const bw = b.w ?? b.width, bh = b.h ?? b.height;
  const x = Math.max(0, Math.min(a.left + aw, b.left + bw) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + ah, b.top + bh) - Math.max(a.top, b.top));
  return x * y;
}

export function visibleFraction(box, vw, vh) {
  const area = (box.w ?? box.width) * (box.h ?? box.height);
  if (area <= 0) return 0;
  return intersectArea(box, { top: 0, left: 0, w: vw, h: vh }) / area;
}

export function evaluate(label, toolbar, vw, vh) {
  const flags = [];
  // A deliberately hidden label is a valid outcome, not a placement failure.
  const shown = label && !label.hidden;
  // No toolbar box means the actions ride inside the label (three of the four
  // layouts), so the label's own verdict is theirs.
  const hasToolbar = toolbar && !toolbar.hidden;
  const lv = shown ? visibleFraction(label, vw, vh) : 1;
  const tv = hasToolbar ? visibleFraction(toolbar, vw, vh) : 1;

  if (shown) {
    if (lv < 0.001) flags.push("LABEL_OFFSCREEN");
    else if (lv < 0.999) flags.push("LABEL_CLIPPED");
  }

  if (hasToolbar) {
    if (tv < 0.001) flags.push("TOOLBAR_OFFSCREEN");
    else if (tv < 0.999) flags.push("TOOLBAR_CLIPPED");
  }

  const overlap = shown && hasToolbar ? intersectArea(label, toolbar) : 0;
  if (overlap > 0) flags.push("OVERLAP");

  return {
    flags,
    verdict: flags.length ? "FAIL" : "PASS",
    labelVisible: +lv.toFixed(3),
    toolbarVisible: +tv.toFixed(3),
    overlapPx: Math.round(overlap),
  };
}

export function runSim(vw, vh, boxes = BOX) {
  return CASES.map((c) => {
    const rect = caseRect(c, vw, vh);
    const label = placeLabel(rect, boxes.label, vw, vh);
    const toolbar = placeToolbar(rect, boxes.toolbar, vw, vh);
    return { id: c.id, name: c.name, rect, label, toolbar, ...evaluate(label, toolbar, vw, vh) };
  });
}

// ===== Self-check =====
// Run directly (`node test/placement.mjs`), the spec proves the beside rule's
// own invariants across the matrix: wherever it placed the unit beside the
// element, the inspector clears the element by one gap, the toolbar sits a
// pair-gap under the inspector at the same left, and the unit is on screen;
// and at the laptop size the right side wins whenever there is room there.
// test/sim.mjs then evaluates the matrix for clipping and overlap.
const isMain = typeof process !== "undefined" && /placement\.mjs$/.test(process.argv[1] || "");
if (isMain) {
  const VIEWPORTS = [[1440, 900], [1440, 500], [1280, 720], [1024, 1366], [390, 844], [1440, 240]];
  const problems = [];
  let beside = 0, checked = 0;
  for (const [vw, vh] of VIEWPORTS) {
    for (const c of CASES) {
      const rect = caseRect(c, vw, vh);
      const boxes = boxesForLayout(vw);
      const r = layoutChrome(rect, vw, vh, boxes, { side: true });
      const unitW = Math.max(boxes.label.w, boxes.toolbar.w);
      const visible = Math.min(rect.bottom, vh) >= Math.max(rect.top, 0) && Math.min(rect.right, vw) >= Math.max(rect.left, 0);
      const roomRight = visible && rect.right + GAP + unitW <= vw - M;
      checked++;
      const at = `${c.id} @ ${vw}x${vh}`;
      if (r.strategy === "side-right" || r.strategy === "side-left") {
        beside++;
        const shownW = Math.max(r.label.hidden ? 0 : boxes.label.w, boxes.toolbar.w);
        const wantLeft = r.strategy === "side-right" ? rect.right + GAP : rect.left - GAP - shownW;
        if (r.label.left !== wantLeft) problems.push(`${at}: inspector left ${r.label.left}, wanted ${wantLeft}`);
        if (r.toolbar.left !== r.label.left) problems.push(`${at}: toolbar not under the inspector`);
        if (!r.label.hidden && r.toolbar.top !== r.label.top + r.label.h + PAIR) problems.push(`${at}: toolbar not a pair-gap under the inspector`);
        if (!r.label.hidden && intersectArea(r.label, rect) > 0) problems.push(`${at}: inspector covers the element`);
      } else if (vw === 1440 && vh === 900 && roomRight && !c.degenerate) {
        problems.push(`${at}: room on the right but placed by ${r.strategy}`);
      }
    }
  }
  if (beside === 0) problems.push("the beside rule never fired");
  for (const p of problems) console.log("  FAIL  " + p);
  console.log(`placement: ${checked} placements checked, ${beside} beside the element, ${problems.length} problems`);
  if (problems.length) process.exit(1);
}
