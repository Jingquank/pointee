# Selection layouts — plan

Written 2026-09-06 after two design rounds for the selection chrome
(`test/selection-chrome-prototypes.html`, `test/selection-chrome-round-two.html`)
and a short interview. Four layouts survive and become a preference; "On the
edge" is the default.

## What we agreed

| Decision | Answer |
|---|---|
| The four | **On the edge** (round two's 13C, pill at the bottom-*left*, aligned with the readout) — default. **Beside the lines** (02C, the spine). **Under the name** (02D, the icon strip). **Along the bottom** (12A, the labelled bar; the card is never wider than it). |
| Names | Phrases, each with an icon, in settings. In code: `edge`, `beside`, `under`, `bottom`. |
| Where it lives | A new **Selection** section between Appearance and Measuring, one row of four icon + phrase pills, with its own preview in the rail: the real label and actions rendered through `content.css`, redrawn in the chosen layout as you click. |
| Tooltips | Every icon-only action names itself. One tooltip root — `#pnt-tip`, beside the label like the colour picker — positioned from the hovered or focused button's rect, flipped when there is no room. Never inside the card, so it can never move the chrome. |
| Edge rule | The pill's centre line sits on the element's bottom edge, its left edge 6px in from the element's left. When that edge is below the fold the pill takes the slot the solver gives the toolbar today, so it is never clipped. The placement spec gains the straddle and is re-swept; the harness's live sweep covers it. |
| Narrow viewports | "Along the bottom" drops its labels to icons under the existing 470px breakpoint; the card narrows with its bar. The other three are icons already. |
| Hints | As prototyped, per layout: a caption line for Beside and Edge; the strip's right end for Under; the breadcrumb row for Bottom. |
| Hover | The readout alone, identical in every layout. Beside shows no spine column on hover — the column exists only while selected. |

## Vocabulary (to `GLOSSARY.md`)

**Selection layout** — where the toolbar sits relative to the info label:
on the element's edge as a pill, beside the readout's lines as a spine, under
the identity as a strip, or along the card's bottom as a bar. A preference;
the readout is the same in all four.
_Avoid_: mode (a mode changes what the tool does; a layout changes where it is).

**Tooltip** — the name of an icon-only action, drawn in its own root beside
the label and positioned from the button it names. Never part of the card.

The *Toolbar* entry gains: "drawn in the chosen selection layout".

## The build

**1. Preference.** `selectionLayout` in a new `CHROME_PREFS` roster —
`["edge", "beside", "under", "bottom"]`, default first — declared in
`content.js` and mirrored in `settings/settings.js`, read and watched like the
others through `ALL_PREFS`. The value lands as `pnt-layout-<id>` on `<html>`;
a change with something selected rebuilds the selection chrome in place.

**2. One toolbar, four mounts.** `showToolbar()` keeps building the four
buttons once; the layout decides where the `#pnt-toolbar` node mounts. For
`beside`, `under` and `bottom` it mounts *inside* `#pnt-label` — a spine
column at the left, a strip under the identity line, a bar along the bottom —
so the solver sees one box. For `edge` it stays its own fixed root, drawn as
a pill of four icons. Buttons carry `data-action` so tests and the tooltip
root address them by name in every layout. The Bottom card's width is set from
the bar's natural width after mount, the way widths are locked today.

**3. Placement.** The one-card layouts call `computeChromeLayout(rect, label,
null)` — the actions ride inside the label — with the label's minimum height
raised to the action row's while selected, so the readout clips first and the
actions never do. `edge` calls the solver with the toolbar as the pill and a
new `straddle` option: `outside-split` places it on the bottom edge at the
element's left; every other strategy places it where the toolbar goes today.
`test/placement.mjs` mirrors the option, runs its matrix in both modes, and
`test/harness.html` gains a key to cycle layouts so the live sweep reconciles
each one against the simulation.

**4. Tooltips.** `#pnt-tip`: created with the overlay, shown on `pointerenter`
and `focusin` of any `[data-tip]` in our chrome, positioned above the button's
rect or below it when the top is out of room, hidden on leave, blur, Escape
and any layout pass. Glass, 10.5px, the same material as everything else.
`isOurs` learns the root so hit-testing ignores it.

**5. CSS.** `content.css` gains one block per layout keyed on
`html.pnt-layout-*`: the spine grid, the strip row, the bar with the compact
rule, the pill. The hints move with the layout as prototyped. The readout's
rules do not change.

**6. Settings.** A **Selection** section in `settings/index.html`: a
sentence, four pills each with an inline monoline icon and its phrase, the
saved note. `settings.js` adds the roster, paints the pills, and writes
`data-layout` onto a new rail mock — the real label and toolbar markup in all
four arrangements, one shown at a time — under a new rail mode `select`.

**7. Tests.** `placement.mjs` and `sim.mjs` for the straddle; `cdp.mjs` gains
one check per layout (the actions mount where the layout says, Edit is
reachable by `data-action`, the label's box does not change when a tooltip
shows) and one for the fallback (an element taller than the viewport still
shows the pill). `tokens.mjs` keeps the settings page honest.

**8. Docs.** `GLOSSARY.md` as above; `README.md`'s How-it-works and Settings;
`DESIGN.md`'s Toolbar and Tether entries and the placement rule;
`test/PLACEMENT-PLAN.md` gains the straddle strategy.

## Verification

- `npm test` green, browser suite included.
- In the harness: each layout in each of the 23 placement cases matches the
  simulation; an element taller than the window shows the pill at the visible
  bottom; a tooltip on the last icon at the right edge flips inward.
- Switching the layout in settings redraws a selection already open in
  another tab, no reload.

## Out of scope

Per-site layouts. A layout for Edit Mode — the panel is its own surface.
Re-ordering the four actions.
