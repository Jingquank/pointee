# Pointee 2.0 — rebrand and UI overhaul

> **Status, 2026-09-06.** Phases 1–6 are done on `feat/pointee`: both rounds
> ran (`test/brand-direction-prototypes.html`, `test/brand-direction-round-two.html`)
> and chose Vermilion with restrained motion; the rename, the bundled fonts, the
> 21-token themes, every surface, the settings page, the icon pipeline and the
> docs are in, with `npm test` green including the browser suite. The manifest
> and package read 2.0.0. Left for the author: draw the mark and re-run
> `node icons/generate-icons.mjs`; rename the repository; update the store
> listing (§9). The ADRs stand as written, 0002 superseded by 0003.

Branch `feat/pointee`, off `main` at 1.5.0. Written 2026-09-05 after a
decision-by-decision interview; every row in §1 was put to the author and
answered. This document is the plan. `GLOSSARY.md` holds the vocabulary,
`docs/adr/` the two decisions that were hard enough to reverse to deserve a
record, and `DESIGN.md` — rewritten in Phase 6 — becomes the standing contract.

---

## 1. What we agreed

| Decision | Answer |
|---|---|
| Positioning | Agent-agnostic. "Point at any element. Copy it. Paste it into your coding agent." Claude Code, Cursor and Codex appear only as examples in a compatibility line. |
| Name | **Pointee** — what a pointer points at. Checked clear on the Chrome Web Store, GitHub and npm. Nearest neighbour is *Pointa*, a different product. |
| Mode | **Point Mode** replaces Probe Mode. Signalled by `pnt-point-active` on `<html>`. |
| Namespace | `pnt-` replaces `ccp-` for ids, classes, tokens and data attributes; `PNT_` replaces `CCP_` for bridge messages and the `CCP_CHROME` env var. `pt-` and `pe-` were rejected because they are Tailwind spacing utilities this tool reads all day. |
| Mascot | None. Clawd goes; the extension icon is the mark. The toast's loading state becomes a plain indicator and the two mascot tokens leave the theme set. |
| Typeface | **Geist Sans + Geist Mono, bundled.** Sans for labels and controls, mono for values, tokens and selectors. No Google Fonts import, no privacy paragraph, no CSP fallback. ADR 0001. |
| Type scale | **12px base.** 11 secondary, 12 body and controls, 13 titles; 10 survives only as tracked-caps micro-labels in the typography grid. Pixels, never rem — the chrome sits on pages whose root size it does not control. |
| Themes | **Dark, Light, System (default)** designed first, then Dracula, Monokai, Nord, Solarized Dark and Tokyo Night re-derived from their published palettes. Terracotta is retired; stored `terracotta-*` preferences map to the new pair. |
| Accent | **Vermilion** — `#d13a1d` on the light theme, `#f0452b` on the dark. Chosen in round two after the author asked for a red-orange; kept clear of terracotta by saturation, never clay. Danger moves to a crimson so nothing is mistaken for the accent. |
| Scope | Every surface may be restyled *and* re-laid-out, and structure is open (label and toolbar may merge, the panel may dock, settings may become one page). Interactions, the keyboard ladder, storage and the copy payload do not change. A direction that changes the chrome's piece count reopens the placement spec and its sweep — accepted. |
| Fixed qualities | Every direction carries all four: hairline borders over heavy shadows; translucent, blurred panels; near-neutral surfaces with colour only where it means something; monoline icons and visible keyboard hints. |
| Varied axes | Radius, dark surface tone, motion character, selection vocabulary, toolbar form, panel form, label structure, settings architecture, icon, accent. Each value appears in at least two directions. |
| Round format | One gallery page, ten sections, real CSS, both themes, published as an artifact and committed as `test/brand-direction-prototypes.html` — the seventh round in this repo's record. |
| Libraries | **None.** `motion` was vendored on the assumption of springs; the chosen motion is restrained, 180 ms eased, which CSS carries. ADR 0003 supersedes 0002. |
| Release | Rename the existing store listing in place, rename the GitHub repo to `pointee`, ship as **2.0.0**. |
| Docs | `DESIGN.md` rewritten as a design system in the same voice; README re-cut with a POINTEE banner; PRIVACY, CONTEXT and PLACEMENT-PLAN renamed and corrected. |

## 2. What does not move

These are the rules the current codebase already enforces, restated so the
overhaul is judged against them rather than around them.

- **Behaviour is frozen.** Click-to-select, the Escape ladder, held-Option
  measuring, Edit Mode's inertness, undo and redo, the settings rosters, the
  storage keys, and every byte of the copy payload stay as they are.
- **Solvers stay pure and in JavaScript.** `computeChromeLayout`,
  `computeRedline` and `computeTether` take their constants from `GEOMETRY`
  and their preferences as arguments. Motion is eased, not sprung, so its
  durations and curve are paint and live in `tokens.css`; nothing in JS reasons
  about them.
- **One door.** Every host-page write stays in the Edit Apply section, and
  `test/edit-audit.mjs` keeps proving it — with `PNT_SHADER_SET` and
  `PNT_SHADER_CLEAR` pinned where `CCP_` was.
- **Never themed.** The swatch chequerboard, the mask stencil, the picker's
  white, black and hue ramp, and the reported page white stay fixed for the
  reasons `tokens.css` already states.
- **Our tokens are not the page's.** The token resolver's namespace filter
  moves from `ccp-` to `pnt-`.
- **Contrast is a floor, not a warning.** The 10px grey that failed AA in
  seven of eight themes is retired with the old hierarchy. Every text token in
  the new set clears 4.5:1 against its surface; `test/tokens.mjs` fails, not
  warns, when one does not.
- **Reduced motion is total.** Every animation — CSS and `motion`-driven alike
  — dies under `prefers-reduced-motion`. The undo flash stays visible and
  still, as it does today.
- **Firefox is not a target** (since 1.2.0), so relative colour syntax,
  `backdrop-filter`, `@starting-style` and `interpolate-size` are available
  unconditionally.

---

## 3. Phase 1 — The round

**Deliverable.** `test/brand-direction-prototypes.html`, also published as an
artifact so it reads on any device. Ten sections behind a jump bar, each a
self-contained direction rendered with its own token block, so the winner's
CSS ports into `tokens.css` rather than being redrawn from a picture.

**Every direction shows**, at real scale and in both its dark and light theme:

1. Palette strip and accent, with the contrast ratio printed under each text token.
2. Type specimen: the four sizes in sans and mono, the weights, a tracked micro-label.
3. The hover outline and box-model tints, the info label and the toolbar, over a
   mock pricing page (the README's `PlanCard` example) — once on a light host
   page, once on a dark one.
4. The edit panel with its tether attached to a selected card, the typography
   grid open, one row dirty.
5. The colour picker, the toast, and the gear.
6. A settings-page thumbnail at one-third scale.
7. The icon at 16, 48 and 128, on light and dark.
8. A one-paragraph thesis: what this direction believes, in the repo's voice.

**The ten.** Names are handles for the review, not the brand.

| # | Handle | Accent | Dark surface | Radius | Selection | Toolbar | Panel | Settings | Motion |
|---|---|---|---|---|---|---|---|---|---|
| 01 | Graphite | signal blue | cool near-black | 6 | solid ring | icon pill | floating | spec sheet | restrained |
| 02 | Obsidian | acid lime | pure black | 4 | corner brackets | command bar + chips | docked right | one column | restrained |
| 03 | Frost | teal | cool, heavy blur | 12 | soft glow | command bar + chips | floating | sidebar nav | springy |
| 04 | Paper | warm rose | warm graphite | 8 | slow ants | labelled segments | floating | spec sheet | restrained |
| 05 | Blueprint | cobalt | cool slate | 4 | corner brackets | labelled segments | attached | one column | restrained |
| 06 | Slate | violet | cool slate | 6 | solid ring | icon pill | floating | sidebar nav | restrained |
| 07 | Mint | mint green | light-first | 10 | slow ants | icon pill | attached | sidebar nav | springy |
| 08 | Coral | coral | warm graphite | 12 | soft glow | command bar + chips | attached | spec sheet | springy |
| 09 | Monochrome | none — inverted white | pure black | 6 | solid ring, dark halo | command bar + chips | floating | one column | restrained |
| 10 | Signal | magenta | cool near-black | 8 | brackets + fill tint | labelled segments | docked right | one column | springy |

Label structure alternates across the ten between stacked rows, chips and a
two-column readout; each icon is a distinct mark that survives 16px. No accent
in the warm-orange band, on purpose.

**Chosen — round two, 2026-09-06.** Direction 07 won round one. The author
asked for a red-orange accent in place of mint, a new handle, each theme paired
with its own kind of page, and the icon left to them; `test/brand-direction-
round-two.html` re-cut 07 accordingly and added a playable motion stage. From
it: **Vermilion** (`#d13a1d` / `#f0452b`), **restrained** motion (180 ms eased
entrances, 140 ms exits, no spring), the direction henceforth called
**Vermilion**. Kept from 07: light designed first, radius 10 / 14, blur 16,
pill toolbar, attached panel, stacked-row label, slow ants, sidebar settings.
Neutrals warmed to lean toward the accent. The icon slot stays empty until the
author draws one.

**Choosing.** A hybrid is a legitimate answer — "03's material with 06's
toolbar" — and is recorded as such. The winner is named in a commit, its
terms enter `GLOSSARY.md`, its values become the reference theme in
`tokens.css`, and the gallery stays in `test/` as the round's record.

---

## 4. Phase 2 — Foundations

### 4.1 The rename

2,647 occurrences of `ccp`/`CCP` outside `lib/` and `dist/`. Mechanical, in
one commit, verified by `npm test`:

- `ccp-` → `pnt-` in ids, classes, tokens, `data-*` attributes; `ccp-probe-active` → `pnt-point-active`.
- `CCP_SHADER_*` → `PNT_SHADER_*`; `CCP_CHROME` → `PNT_CHROME`; `OUR_ROOTS`, `isOwnEditChrome` and the namespace filter follow.
- Names: `manifest.json` (name, description, action title "Toggle Point Mode"), `package.json` (name, description, keywords, repository), `build.sh` (zip name), `scripts/postinstall.js` (banner and usage line), `shader-agent.js` header, `settings/index.html` title and header, every doc.
- The six historical prototype galleries are renamed too. Two of them load
  the live `content.js`, and a record that no longer runs is a worse record.

### 4.2 Fonts

- `fonts/Geist[wght].woff2` and `fonts/GeistMono[wght].woff2` from
  vercel/geist-font v1.7.2, with `fonts/LICENSE-OFL.txt`. Committed, not
  downloaded at install — a clone must work offline and the store zip must be
  reproducible.
- `web_accessible_resources` in the manifest for `fonts/*.woff2`.
- `@font-face` for the injected chrome uses
  `chrome-extension://__MSG_@@extension_id__/fonts/…`, which Chrome
  substitutes in content-script CSS. The settings page is an extension page
  and may not receive that substitution, so it carries a relative-URL
  declaration of its own; if one form proves to work in both contexts, keep
  one. **Verify both before Phase 3.**
- Remove the `@import`, and the Google Fonts paragraph from `PRIVACY.md`.

### 4.3 Motion

- CSS only. Two durations and one curve as tokens: `--pnt-duration` 180 ms for
  entrances and glides, `--pnt-duration-exit` 140 ms for departures, `--pnt-ease`
  `cubic-bezier(.2, .7, .2, 1)`. A departure never overshoots.
- Entrances through `@starting-style` on the label, toolbar, panel, picker and
  toast; glides through transitions on position, as today.
- Every transition and animation listed in the `prefers-reduced-motion` block,
  as today. No library, no `MOTION` object — ADR 0003.

### 4.4 Tokens

`tokens.css` is rewritten in the same two-tier shape:

**Tier 1, theme-invariant.**
Type: `--pnt-font-sans`, `--pnt-font-mono`; `--pnt-text-micro` 10,
`--pnt-text-sm` 11, `--pnt-text-base` 12, `--pnt-text-lg` 13; weights 400, 500,
600; two leadings; caps and numeric tracking. Space, radius, durations, easing,
layers, opacities, and the never-themed constants, as today. Radius and space
values are set by the winning direction.

**Tier 2, per theme — target 28 to 30, roster fixed by the winner:**
three surfaces plus a translucent glass fill; three border weights; three text
steps plus a disabled tone; accent, accent-hover, accent-soft and on-accent; a
focus ring; syntax tag, id and class; danger and on-danger; success; a scrim
for the inert page; two shadows; the swatch border.

**Themes.** `dark`, `light` designed; `system` resolved in JS as today and now
the default; the five editor themes re-derived, keeping the rule that their
syntax colours are the palette's own roles. `BADGE_ACCENT` follows.

**Migration.** On read, `terracotta-dark` → `dark`, `terracotta-light` →
`light`, unset → `system`. One function, called from `content.js`,
`settings.js` and `background.js`.

### 4.5 Tests

- `test/tokens.mjs`: prefix, roster count, reference theme `dark`, contrast
  pairs for the new text and border tokens — with the WARN tier removed,
  because the new set has no text token that is allowed to fail.
- `test/edit-audit.mjs`, `test/mirror-drift.mjs`, `test/cdp.mjs`,
  `test/sim.mjs` and `test/harness.html`: renamed ids and literals.
- `npm test -- --fast` green before Phase 3 starts; the browser suite green
  before Phase 3 ends.

---

## 5. Phase 3 — Surfaces

Apply the winning direction to each surface, in this order, so the pieces the
solvers measure land first:

1. Hover outline and box-model tints, including the plain fallback past
   `maxSweepDiagonal`.
2. Info label — identity line, text, layout, paint, breadcrumb.
3. Toolbar, including the compact breakpoint and the Select Parent state.
4. Edit panel: header, groups, control rows, dirty dots, value chips, token
   steppers, linked sides, the typography grid, the text field and long-text
   editor, the Advanced section.
5. Colour picker.
6. Tether — restyled within `tetherGap`, re-swept by `test/tether.mjs`.
7. Redlines — restyled within the pill and guide constants, re-swept by `test/redline.mjs`.
8. Toast and gear.

Motion is inventoried in `DESIGN.md` as it is added: what animates, on which
preset, and that it is in the reduced-motion block.

**If the winner merges the label and toolbar, or docks the panel:**
`test/placement.mjs` and `test/PLACEMENT-PLAN.md` are revised for the new
piece count, `test/sim.mjs` re-swept across the six viewports, and the live
sweep in `test/harness.html` run against the real chrome. This is the cost
accepted in §1, and it is done before the surface is called finished.

---

## 6. Phase 4 — Settings page

Re-laid-out per the direction. The mechanism stays: the page loads the real
`tokens.css` and `content.css`, and the preview rail renders the real chrome
inline, so it cannot drift. Every transition on the page stays in the
reduced-motion block at the end of `settings.css`. Theme pills keep drawing
their swatches from their own token block.

---

## 7. Phase 5 — Icon and brand assets

- `assets/pointee-mark.svg` — the winner's mark — and `assets/banner.svg` for the README.
- `icons/generate-icons.mjs` replaces `generate-icons.js`: the `canvas`
  module it needs is not installed, so PNGs at 16, 32, 48 and 128 are
  rendered from the SVG with headless Chrome, reusing the browser finder in
  `test/cdp.mjs`.
- README banner re-cut as POINTEE in the same figlet face; the postinstall
  banner matches.

---

## 8. Phase 6 — Docs

**`DESIGN.md`** becomes a design system, same voice, new spine:

1. Brand — name, positioning, what the mark means, what Pointee never says.
2. Type — the pairing, the four sizes and where each is allowed, weights, tracking.
3. Colour and themes — the two tiers, the roster, how a theme is derived, contrast floors.
4. Tokens — naming, the never-themed set, alpha derived not declared.
5. Motion — presets, the reduced-motion contract, the one helper.
6. Surfaces — one entry per surface: what it is for, how it is placed, what it may never cover.
7. Standing rules — one door; geometry stays in JS; ask the element; the payload is a pointer.
8. History — the 1.3 token refactor and the 2.0 round, in two paragraphs each, pointing at the galleries.
9. Verification, and Adding a theme / Adding a setting, carried over.

**`README.md`** — new banner, agent-agnostic first line, a compatibility line,
new screenshots, the store link, `pointee` clone path.
**`PRIVACY.md`** — name, date, fonts bundled, Google Fonts paragraph removed.
**`GLOSSARY.md`** — the winner's terms; any surface that merged or moved.
**`test/PLACEMENT-PLAN.md`** — names, and the revision if the piece count changed.
**`docs/adr/`** — 0001 moved to *accepted* once the strict-CSP check is
observed; 0002 stands; a 0003 if the winner changes the chrome's structure.

---

## 9. Phase 7 — Release

1. `manifest.json` and `package.json` to 2.0.0 (the latter is at 1.4.0 today — out of step).
2. `npm run build`; `npm test` fully green including the browser suite.
3. Manual checklist: fonts render on a strict-CSP page (github.com); theme
   switch repaints an open tab; System follows an OS flip; reduced motion
   stills everything; the edit harness leaves no `style` attribute behind;
   every theme's swatches still show page colours.
4. `gh repo rename pointee` — GitHub redirects the old URL. Confirm before running.
5. Store listing (author): name, description, icon, screenshots, privacy URL.

---

## 10. The library pick

The `/pick-ui-library` step, applied honestly to a vanilla content script with no bundler:

| Task | Pick | Why |
|---|---|---|
| Transitions and entrances | CSS | The chosen motion is eased, not sprung; `@starting-style` and transitions cover it. `motion` was vendored for springs and is withdrawn — ADR 0003. |
| Toasts | keep our own | Sonner is React. One toast, positioned by the solver. |
| Dialogs, menus, popovers | keep our own | base-ui is React; the panel and picker already own focus and dismissal. |
| Command palette | not applicable | No palette in the product. |
| Syntax highlighting | not applicable | The payload is plain text by design. |
| State, className helpers | not applicable | One module, no framework. |

---

## 11. Out of scope

A High Contrast theme (needs contrast targets driving a palette — its own
round). Firefox. User-authored themes. Per-site overrides. Any change to the
payload's fields or shape. A replacement mascot.

## 12. For review

- Hybrids across directions are allowed; say so if you would rather pick one whole.
- The historical galleries get the rename. Object if you want them frozen as-is.
- The repo rename happens at release, not now, so links keep resolving through the branch.
