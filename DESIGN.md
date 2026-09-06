# Pointee — the design system

How Pointee looks, and why. Every colour, typeface, radius, shadow and duration
in the chrome is a token in `tokens.css`; every surface is drawn from those
tokens and nothing else; and a handful of rules underneath do not move whatever
the surfaces do. This document is the contract for all of it. `CONTEXT.md` holds
the vocabulary; `docs/adr/` the decisions that were hard enough to reverse to
deserve a record; `docs/POINTEE-PLAN.md` the plan the 2.0 overhaul followed.

---

## 1. Brand

Pointee is the thing a pointer points at. You point at an element on a page,
and your coding agent gets the pointee — a source pointer it can act on. The
name says the mechanism; nothing about it says whose agent, and nothing in the
chrome, the payload or the settings ever does. Claude Code, Cursor and Codex
appear in the README as examples of what reads the pointer, and nowhere else.

The identity is one colour and one material. **Vermilion** is the accent —
`#d13a1d` on the light theme, `#f0452b` on the dark — a saturated red-orange
chosen in the second round of the 2.0 brand directions, and kept deliberately
clear of the muted clay of the tool's previous life: it reads as a signal, not
a brand it used to borrow. It colours exactly the things that mean something —
the selection, the tag in a readout, the one button that changes what the
chrome is, the pressed state, the badge — and nothing decorative. Everything
else is near-neutral, warmed slightly toward the accent so the neutrals belong
to it.

The material is glass: surface-0 at 82% behind a 16px blur, a hairline border,
a short soft shadow, a 14px corner. Every floating piece of chrome is made of
it — the info label, the toolbar's two capsules, the gear, the toast, the edit
panel, the colour picker, the long-text editor — so the page ghosts through
and the chrome reads as one family laid over it rather than as boxes stuck on.

There is no mascot. The extension icon is the mark: a cream hand pointing
up and to the right, with a vermilion cuff — the two colours of the identity
and nothing else, no face. The drawing is `assets/icon.png`, at 1254px on a
transparent ground. It ships as two sets, named for the browser they are
drawn for, not for Pointee's theme: on a light toolbar the cream hand is next
to invisible, so the light set draws a 1px ink line around it; on a dark
toolbar the line would be a smudge, so the dark set is the drawing as it is.
`icons/generate-icons.mjs` makes both, and `background.js` swaps them by the
colour scheme the pages report — Chrome's manifest can name only one.

## 2. Type

Two faces from one family, bundled in `fonts/` under the OFL and never fetched
(ADR 0001): **Geist** for words — labels, controls, legends, prose — and
**Geist Mono** for values — numbers, tokens, selectors, hex. The rule is that
simple: if it is something a person reads as a word, sans; if it is something
they compare or copy, mono.

Four sizes, in pixels because the chrome sits on pages whose root size it does
not control:

| token | px | where |
|---|---|---|
| `--pnt-text-lg` | 13 | the identity line, panel and section titles — bold, tight leading, `-0.01em` |
| `--pnt-text-base` | 12 | labels, controls, values |
| `--pnt-text-sm` | 11 | secondary readouts, legends, captions |
| `--pnt-text-micro` | 10 | tracked-caps micro-labels only — the typography grid's cell labels, the settings sheet's category labels, keyboard chips. Never prose. |

Weights 400, 500 and 600; leading 1.3 for a line that stands alone and 1.45
for a block; `0.06em` of tracking on caps and `0.01em` on numbers. The hierarchy
is made of size, weight and tone together, which is what let the 1.x 10px grey
retire: nothing in the chrome now asks a reader to make out small text in a
colour below AA.

## 3. Colour and themes

Eight themes; every one a block of **21 declarations** in `tokens.css`, ordered
surfaces → borders → text ramp → accent → syntax → status → shadows → swatch
so the blocks diff cleanly.

**Light** was designed first and **Dark** derived from it — the order that
suits a tool whose users mostly inspect light pages. **System** is the default
and resolves to one of them in JavaScript (§4). The five editor themes —
Dracula, Monokai, Nord, Solarized Dark, Tokyo Night — are re-derived from their
published palettes onto the same roster: the accent is the palette's signature
colour, the two syntax roles its id and class colours, and the info label,
which already colours tag, `#id` and `.class` separately, comes out looking like
the editor it is named after rather than an approximation of it.

The roster, per theme:

| group | tokens | what they are |
|---|---|---|
| surfaces | `surface-0` `surface-1` `surface-2` | the ground, a raised chip, a hover fill |
| borders | `border-1` `border-2` `border-3` | hairline, default, strong |
| text | `text-1` `text-2` `text-3` `text-4` | primary, secondary, tertiary; and a disabled tone that is never prose |
| accent | `accent` `accent-hover` `on-accent` | the brand, its hover, the ink on it |
| syntax | `syntax-id` `syntax-class` | the label's `#id` and `.class` |
| status | `danger` `on-danger` `ok` | a crimson, its ink, a green — crimson rather than red so nothing is mistaken for the accent |
| shadows | `shadow-1` `shadow-2` | the glass's, and a deeper one for a docked surface |
| swatch | `swatch-border` | the ring around a swatch showing the *page's* colour |

**Contrast is a floor, not a warning.** `test/tokens.mjs` computes WCAG 2.1
ratios for eleven foreground/background pairs per theme. `text-1`, `text-2`,
`text-3`, both syntax colours, `on-accent` on `accent` and `on-danger` on
`danger` must clear **4.5:1**; `text-4`, `accent`, `ok` on the surface and
`on-accent` on `accent-hover` must clear the **3:1** non-text bar. A pair under
its floor fails the run. The 1.x contract carried a WARN tier for a 10px grey
that sat at 3.4:1 in seven of eight themes and said fixing it would take a
redesign of the hierarchy; §2 is that redesign, and the tier is gone.

## 4. Tokens

**Two tiers, and only one of them is themed.** `tokens.css` is a `:root` block
of 55 theme-invariant scales — type, space, radius, the glass material,
motion, layers, opacities, the never-themed constants and the alpha variants
derived from whichever theme is active — followed by one block per theme
holding the 21 semantic colours and shadows. A theme cannot change a scale,
which is the point: Dracula should recolour the chrome, not resize it. The
split is what makes the contract checkable: "every theme declares exactly
these 21" is a test; "the theme looks right" is not.

**Alpha variants are derived, never declared.** The glass, the accent's soft
fill, the focus ring and the inert-page scrim are computed once in `:root` —
`rgb(from var(--pnt-surface-0) r g b / var(--pnt-glass-alpha))`,
`color-mix(in srgb, var(--pnt-accent) 14%, transparent)` — so a theme cannot
have a glass that disagrees with its own surface or a focus ring that disagrees
with its own accent, and a theme stays at 21 lines instead of thirty-five.
Relative colour syntax and `color-mix()` are available unconditionally: the
Firefox target was dropped in 1.2.0.

**One attribute, because custom properties survive `all: initial`.**
`data-pnt-theme` on `<html>`, and every token block keys off it. All the
injected roots inherit from there with no per-root plumbing, because four of
them set `all: initial` and `all` does not reset custom properties (CSS Cascade
4 §3.2). Regular inherited properties *are* reset, which is why `font-family`
and `box-sizing` are re-declared on the bar, its buttons and the panel — that
redundancy is load bearing. Theme blocks are keyed on `[data-pnt-theme="…"]`
rather than `:root[…]`, so a theme can be scoped to any subtree: the settings
page's theme pills each carry their own and draw their swatches from it. The
swatch is not a picture of the palette; it is the palette.

**`system` resolves in JS, not in a media query.** `matchMedia("(prefers-
color-scheme: dark)")` picks `dark` or `light` and writes the *resolved* id
into the attribute, with a `change` listener so it follows the OS live.
Wrapping every block in `@media` would double the file and put two copies of
each palette one edit apart; resolving in JS also means the settings preview
and the page agree by construction. A 1.x preference — `terracotta-dark`,
`terracotta-light` — is read through `migrateThemeId` in all three scripts, so
an old choice lands on the palette it meant.

**Radius** is four steps: 4 for swatches and keyboard chips, 8 for cells and
fields, 10 for buttons and chips, 14 for every surface that floats. **Space**
is 4 / 6 / 10 / 14 / 16 with a handful of named gaps. **Blur** is 16px and the
glass alpha 0.82, one material in every palette; only the tint under it
changes.

## 5. Motion

Restrained: eased, never sprung, and a departure always shorter than an
arrival. Chosen in round two of the brand directions with three spring presets
played beside it on the real chrome (ADR 0003 records why the spring library
that had been vendored for the alternative was withdrawn).

| token | value | used for |
|---|---|---|
| `--pnt-duration` | 180 ms | entrances, glides, state changes |
| `--pnt-duration-exit` | 140 ms | departures |
| `--pnt-duration-fast` | 120 ms | crossfades that follow the pointer |
| `--pnt-duration-slow` | 260 ms | the undo flash, the settings entrance |
| `--pnt-ease` | `cubic-bezier(.2, .7, .2, 1)` | everything that arrives |
| `--pnt-ease-exit` | `cubic-bezier(.4, 0, 1, 1)` | everything that leaves |

The trick that makes one rule pair do both: a transition is read from the
state being *entered*, so the toast's resting rule carries the exit timing and
its visible rule the entrance, and nothing needs a class to say which way it
is going.

**The inventory.** Things that move on their own: the selection's ants
(`#pnt-ants path`, 1.6s), the label's breadcrumb marquee, the copy button's
loading spinner, the undo flash. Things that glide: the overlay boxes, the
label and toolbar between placements, the redline nodes and the tether nodes
between targets, the edit panel's Advanced section opening. Everything in the
first list is in the `prefers-reduced-motion` block of `content.css` and stops
dead; the glides are positional and are not disabled, with one exception — the
tether's, listed so a stated preference for stillness also stops the glide —
and the undo flash stays *visible* and still rather than vanishing, because it
is the only way an undo on an off-screen element announces itself. The
settings page keeps its own inventory under the same contract at the end of
`settings/settings.css`. Anything animated must be listed; nothing checks this,
which makes it the weakest link in the contract.

## 6. Surfaces

One entry per piece of chrome: what it is for, how it is placed, what it may
never cover.

**Hover outline and bands.** A 1.5px dashed path in the accent at 70%, drawn
as SVG so the dashes follow the element's own corner radii, with two box-model
bands: margin dashed in a neutral, padding dashed in the accent. Placed by
`updateOverlay()`; drawn in the overlay container, which is pointer-events:
none.

**Selection.** The same path, come up to the full accent at the ring weight
(2px) and crawling — *slow ants*. The bands stand down. The 1.x sweep ring and
bloom are gone: a rotating gradient behind the thing you are judging was
motion competing with it. In Edit Mode the outline goes entirely, because the
panel writes the four properties it would sit on top of.

**Info label.** Glass. The identity line is the title step — tag in the
accent, `#id` and `.class` in the syntax colours, dimensions in mono at the
tertiary tone on the right — then the text preview, the layout and paint
readouts at 11px, and the breadcrumb, which marquees when it is longer than the
label. Placed by `computeChromeLayout()` together with the toolbar so the two
stay on screen and off each other for any element geometry, and hidden while
measuring or editing.

**Toolbar.** Four actions — Copy Code, Screenshot, the Edit pencil in the
accent because it opens a mode rather than performing an action, and Select
Parent in the accent because it moves the selection rather than copying it —
drawn in the chosen *selection layout*, a preference since 2.0 with four
values. **On the edge**, the default: a glass pill of four icons riding the
element's bottom edge, its centre line on the edge and its left six pixels
in, so the readout sits above and the actions below with nothing between the
words and the thing they describe. **Beside the lines**: a spine of icons
down the label's left, each roughly level with the line it acts on. **Under
the name**: a strip of icons under the identity line, the keyboard hints at
its end. **Along the bottom**: a labelled bar behind a hairline along the
card's foot, and the card is never wider than the bar — labels in
sentence-case sans at 12px, dropping to icons under 470px. The readout is
the same in all four; only the actions move. The keyboard ladder goes with
them — **⌥** to measure, **esc** to step back, and nothing else, because
nothing else is bound; a hint that lies is worse than none — as a caption
under the readout for the pill and the spine, in the strip, or on the
breadcrumb row for the bar.

**Tooltip.** The name of an icon-only action, in its own glass root beside
the label — never inside the card, so showing it can never move the chrome.
Positioned from the button it names: above, centred, or below when the top
has no room; beside a spine button. It appears only when the button's label
is off screen, so the bar above the compact breakpoint never shows one.

**Gear.** A 28px glass square pinned to the viewport's top-right for as long as
Point Mode is on. It yields — fades, but stays in layout — when the label or
toolbar docks over it.

**Toast.** A sentence on glass with a mark in front: a check in `ok`, an alert
in `danger` with the border tinted to match. Positioned from script beside the
toolbar, or in the corner when there is none; arrives on the standard curve,
leaves on the exit.

**Edit panel.** Glass, 248px, an inspector column of titled groups. Since 2.0
it opens *attached*: `computeEditPanelPlacement()` puts it a tick's clearance
outside the selected element — right, then left, then below, then above —
top-aligned and pulled inside the viewport, and it follows the element through
scrolls and reflows until the user drags it, after which it floats where it was
put. When no side has room it floats from the start. Legends are sentence-case
sans at the secondary tone; every value, token and colour is mono; chips are
raised on surface-1 with hairline borders and the 8px radius; the dirty dot is
the accent with a soft halo. The footer shows the mode's real keys — **⌘Z**,
**⇧⌘Z**, **esc** — and nothing else.

**Tether.** Four 2px ticks in the accent at the element's edge midpoints,
lying along their edge a `tetherGap` outside it so they can only ever be
tangent to the clearance, never inside it. A dashed run from the panel to the
tick on the facing edge appears *only while the panel floats*: an attached
panel abuts one edge of the clearance within a stub, and the tick it sits
against is the association. `test/tether.mjs` sweeps both properties.

**Colour picker and long-text editor.** Their own roots beside the panel, in
the same glass, so neither is clipped by the panel's overflow or paints over
the rows it is tuning. The picker's saturation square, hue rail and alpha rail
are never themed — they are the colour space, not decoration.

**Redlines.** Held-Option measurements: 1px lines in the accent, dashed guides
at 60%, value pills in the accent with mono numbers. Nothing here self-
animates; the nodes glide between targets and snap when tracking scroll.

**Settings page.** A sticky sidebar that maps the five sections — the current
one marked by an accent dot as you scroll, a pointer over a link previewing
its section in the rail — sections as cards on surface-1 with dotted-leader
rows, and a preview rail that renders the *real* chrome through `content.css`
and `tokens.css`, so it cannot drift from what the extension draws. Controls
are sentence case: pills carrying the theme's own swatch, pills carrying a
glyph of each selection layout, a sunken segmented control with the chosen
value raised, switches on the theme's tones. The Selection preview is a
selection itself — the label and the four actions over an outlined card,
redrawn in the layout under the pointer's last click.

---

## 7. Standing rules

These held before the 2.0 overhaul and hold after it. Each is enforced by a
test where a test can reach it, and stated here where one cannot.

### Geometry stays in JS — the one deliberate exception

`GEOMETRY` in `content.js` keeps `margin`, `gap`, `pair`, `minLabelHeight`,
`narrowToolbar`, `straddleInset`, `radiusFallback`, `redlinePillOffset`, `redlineGuideOvershoot`,
`redlinePillMargin`, `tetherGap`, `tetherTick`, `tetherTickLoud`, `tetherThick`,
`tetherStub` and `tetherAttach` as JavaScript numbers.

Not an oversight. `computeChromeLayout()` is a **pure function**, mirrored in
`test/placement.mjs` and validated over 8280 configurations with no DOM present.
A pure function cannot call `getComputedStyle`, so a CSS custom property is
unreachable from the place these values are actually consumed. Moving them would
buy tidiness and cost the spec. `computeRedline()` follows the same arrangement:
pure, mirrored in `test/redline.mjs`, swept over ten thousand element pairs. So
does `computeTether()`, mirrored in `test/tether.mjs` — and there the sweep is
not just a regression net but the safety argument itself, since `tetherGap` is
the clearance that keeps Edit Mode's chrome off the border it is editing. So,
since 2.0, does `computeEditPanelPlacement()`, which puts the panel a tick's
clearance outside the element and is swept in the same file for the same
property: an attached panel never enters the clearance, never leaves the
viewport, and never needs a run.

The rule, stated once: **values the layout algorithm reasons about live in
`GEOMETRY`; values that only paint live in `tokens.css`.** `--pnt-ring: 2px` is a
token because it draws a stroke; `GEOMETRY.gap: 6` is not because the solver does
arithmetic on it. The redline's 1px stroke is CSS; its pill offset is `GEOMETRY`,
because the solver adds and clamps it.

`test/placement.mjs` mirrors five of them, `test/redline.mjs` the three
`redline*` keys, `test/tether.mjs` the six `tether*` keys and `margin`. Change one, change
both — the harness's live sweep, the redline sweep and the tether sweep are what
catch the drift.

User preferences reach the solver the same way the constants do: as arguments.
`computeRedline()` takes an `opts` parameter (pill offset, guides, zero pills)
built by the caller from `redlinePrefs` — the solver itself never reads storage,
a token, or a global, so the sweep can parameterize it freely.

### Never themed, on purpose

Each carries a comment at its definition, or the next sweep absorbs it.

| value | why it stays fixed |
|---|---|
| `--pnt-checker` | the chequerboard behind a translucent swatch. The swatch reports the *page's* colour, so its backdrop must stay a neutral reference or the tool misreports what it is inspecting |
| `--pnt-mask` | a stencil, not a colour — `mask-image` reads only its alpha. Theming it could do nothing useful and could break the mask |
| `resolveBackgroundColor()`'s `#ffffff` | the browser's default page background, reported as a fact about the page |
| `--pnt-picker-white` / `--pnt-picker-black` / `--pnt-hue-ramp` | the edit panel's colour space, not its decoration. The saturation square is white toward one edge and black toward the other because that is what saturation and value *mean*, and the rail runs the spectrum because that is what hue is. Tinting any of them would make the picker report a colour the page will not get |

The colour swatch's *fill* is written inline from JS for the same reason. Only
its border follows the theme.

### The badge is the one place a hex is legitimately duplicated

`chrome.action.setBadgeBackgroundColor` is browser chrome. It cannot read
`tokens.css`, so `background.js` holds a `BADGE_ACCENT` map. That is real
duplication, so `test/tokens.mjs` asserts it matches every theme's `--pnt-accent`
and that neither side has an entry the other lacks. A new theme with a forgotten
badge fails the run.

---

## The payload is a pointer, and props is the one exception

Everything the copy payload reports **names** something: a file and line, a
component chain, a greppable anchor, a selector, a position among siblings.
`getHandlers` is the sharpest case — it reports `onClick=handleUpgrade`, the
function's *name*, and never the expression bound to it. That is not squeamishness
about size. A pointer that names constructs can be pasted anywhere; a payload
carrying values is carrying whatever happened to be on the page.

The props snapshot breaks that rule on purpose, because sometimes the value is
the question — which of twelve identical rows, and what is actually in it. So it
exists, and it is fenced off accordingly: **off by default, in none of the three
presets, never computed unless asked for, and shallow** — a nested object prints
as `{…}` rather than as its contents, which is the difference between a shape and
an API response. The settings row says all of this in the sheet, where the
decision is being made, rather than in a document nobody reads first.

The same restraint decides `page:`, which has always reported a full URL only on
a dev origin and a bare path everywhere else (`isDevOrigin`). Switching a field
on is consent for that field; it is not consent for the tool to get looser about
everything else.

---

## Edit Mode writes to the page, and that changes the contract

Everything else this extension does is additive: it appends its own chrome and
reads the page. Edit Mode is the first feature that reaches in and changes the
user's DOM, which is a different kind of risk — a stray write that nothing
restores leaves the page altered after the tool is gone. Five rules hold it.

**One door.** Every host-page write goes through the `Edit Apply` section of
`content.js`, and `test/edit-audit.mjs` parses the file's own section banners to
prove it: `setProperty`, `removeProperty`, and `setAttribute`/`removeAttribute`
of `"style"` or `"class"` may appear there and nowhere else. Those verbs were
absent from the file before Edit Mode, which is what makes the rule exact rather
than heuristic — chrome positions itself with direct assignments and
`classList`, and the audit ignores all of it. It also refuses to pass vacuously:
if the section stops using a verb, the audit says so. **This is why the colour
picker writes `node.style.backgroundColor = …` instead of `setProperty`** — a
receiver-aware audit would be fragile, so the picker simply does not need the
verb.

**Restoring is byte-exact.** The `style` and `class` attribute strings are
recorded once at first touch and put back verbatim, so a page that shipped
`style="color:red"` gets that attribute back rather than a normalised rewrite.
The double `removeAttribute` in `restoreElement` is not redundant: once an
inline block has been written through CSSOM, Chrome's first removal empties it
but leaves the attribute node, and an element the tool had finished with would
still carry a visible `style=""`.

**Switching off puts the page back.** Edits outlive deselection and outlive
leaving Edit Mode — that is the point, since the panel is a tuning surface and
the delta block is what you take away from it. They do not outlive the tool.
`deactivate()` runs `resetAllEdits()` and empties the undo and redo stacks, so
the tool leaves nothing behind but the page it found. Note this makes the last
rung of the Escape ladder destructive: Escape steps picker → panel → selection →
off, and that final step reverts. Copy the block before taking it.

`deactivate()` reaches Edit Mode's teardown by calling `deselectElement()` rather
than nulling `selectedElement` itself. That is not tidiness — `deselectElement()`
is the only place carrying "a selection ending ends Edit Mode and redline", and
the shortcut is what once left the panel on screen with `editing` still true, the
five capture-phase pointer guards still attached, and the user's page inert until
they reloaded it.

**Never claim a token that isn't there.** The resolver reports a design token
only when its resolved value equals the computed value; a length that depends on
layout is `null` rather than a guess, a family of one is dropped because a scale
you cannot step along is not a scale, and a value between rungs claims nothing.
A utility-class step is applied and then *checked*: `.card p` outranks
`.text-lg` on specificity often enough that a swap which silently does nothing
is the common case, so when the computed value did not move, the class comes off
and the delta reports the value instead. Claiming the swap would be advice that
does nothing in the source either.

**The extension's own tokens are not the page's.** `tokens.css` and
`content.css` ride along on every page as content scripts, so the stylesheet
walk skips them by URL, with the `pnt-` namespace filtered as a backstop.
Without that, `--pnt-accent` gets offered as a fill for someone's card. The
namespace filter carries more weight now than it did: token discovery asks the
element, and the element cannot tell our custom properties from the page's.

**Ask the element, not the stylesheets.** Discovery used to walk
`document.styleSheets` for `--` names and then resolve each against whatever was
selected. That made the token layer only as good as its read access, and it was
worse than that in practice: a design system behind an `@import`, in a shadow
root, or on a CDN produced nothing at all, silently. Custom properties inherit,
so the element already knows its own token universe — including everything
declared in a sheet no script may read, because the browser applies it
regardless. `collectElementTokens` enumerates that, and the walk is left holding
only the two things an element genuinely cannot report: which class means which
value, and the text of the winning declaration, which is the only place a
`var()` can be seen.

That distinction is what decides how much the fetch below is really worth.

**A blocked stylesheet is fetched, not mourned.** A cross-origin sheet without
CORS throws on `.cssRules`, and a content script's own fetch is refused the same
way, so the service worker's `host_permissions` is the only route. It runs after
the panel has already opened, on what the page could read by itself, and folds
the result in when it lands — a slow CDN costs a stepper that appears a beat
late, not a panel that will not open. The recovered rules are re-walked in place
rather than appended, because source order is what the cascade comparison reads.

What it buys is narrower than it looks, and worth stating so nobody widens the
permission expecting more: the sheet's *custom properties already reached the
element* and needed no fetch. Only class rules and declaration text are actually
recovered. `PRIVACY.md` describes exactly what is requested and what is not.

**The cascade has more than three levels.** `findWinningDeclaration` ranked by
importance, then specificity, then source order. Layers sit above specificity —
an unlayered declaration beats a layered one however specific the layered one is
— and every Tailwind v4 or shadcn page is built out of layers, so the wrong
declaration won and the `var()` read out of it named the wrong token. A wrong
token is worse than no token. Ordering *between* named layers needs the `@layer`
statement that declares them and is not modelled; layered-versus-unlayered is.

**A shorthand utility is indexed under its longhands.** CSSOM lists
`padding: 1rem` as four `padding-*` declarations, so `.p-4` is stored under
`padding-top` and never under `padding` — while the linked padding control asks
about `padding`. The two could not meet, so no shorthand-setting utility class
was ever detected or ever formed a family. That is every Tailwind spacing class.
`.text-lg` worked the whole time because `font-size` is already a longhand, and
that is what made a missing edge look like partial support. `FIRST_LONGHAND_OF`
is the other half of `SHORTHAND_OF`, and the lookup now goes both ways.

One trap worth naming, because it silently disabled the whole token layer once:
CSS Nesting gave every `CSSStyleRule` a `cssRules` list, so `if (rule.cssRules)`
no longer means "this is a group rule". Detect by rule type, and read a style
rule's own declarations whether or not it also has children.

---

## The Advanced section reaches past CSS, and the door still holds

The panel's Advanced section tunes what the rest of the panel cannot see: a
WebGL program's uniforms behind a `<canvas>`, and the custom properties feeding
a gradient, filter or paint worklet. The CSS half is unremarkable by design —
a custom property override is `setProperty("--wave-amp", …)`, which is the same
door, the same registry, the same delta lines as any other declaration. The
shader half is the second kind of host-page write this extension has, and it
was built to keep the five rules above intact rather than to earn exceptions
from them.

**The agent, and why it exists.** A content script lives in Chrome's isolated
world: it shares the DOM but not the page's objects, so it can see a canvas and
nothing of the context, programs or uniforms behind it. `shader-agent.js` is
injected into the MAIN world on demand — first selection of a canvas in Edit
Mode — and speaks to the content script over `postMessage` with a per-probe
nonce. Overrides are applied at draw time, not by rewriting the page's uniform
calls: just before each draw on the probed context, the agent writes the
overridden values through its own uniform locations. That keeps the hook
surface to `useProgram` plus the draw calls, sidesteps the fact that locations
the page cached before injection can never be mapped back to names, and makes
freezing a page-driven `u_time` the same mechanism as nudging a constant.

**One door, still.** The two bridge messages that perform a write —
`PNT_SHADER_SET` and `PNT_SHADER_CLEAR` — are sent from the Edit Apply section
and nowhere else, and `test/edit-audit.mjs` pins the literals there exactly as
it pins `setProperty`. Undo, the reset dots, reset-all and the delta block all
work off the same registry entries as CSS edits; a driven uniform's `before` is
a sentinel meaning "the page's own loop", so undoing a takeover hands the value
back rather than pinning yesterday's clock.

**Uniform edits are session-bound, and that is honest rather than convenient.**
A CSS edit is parked in the element's style attribute; a uniform override
exists only while the agent enforces it at each draw. So leaving Edit Mode
tears the session down — the agent restores every original — and the registry
and history stop claiming those edits, because a claimed edit the page no
longer wears is exactly the lie `staleEdits` exists to catch, and no computed
style can catch it for a uniform. Copy the block before closing the panel; the
panel's copy button is only reachable while it is open, so the flow enforces
its own rule. Switching the extension off needs no special case at all.

**The failure modes are owned, not hoped away.** An extension reload kills the
isolated world silently and would strand a frozen shader, so the content script
heartbeats and the agent restores everything after ten silent seconds. A page
that wrapped the draw prototypes after us would lose its own wrapper if we
restored ours, so teardown checks the slot still holds our function and
otherwise leaves a delegating no-op behind. A relink invalidates every location
the agent holds, so `linkProgram` is watched and the panel told to let go. Two
limits are accepted and stated: a multi-pass renderer gets its dominant pass
tuned, not all of them; and in lazy mode a shader that drew once before Edit
Mode opened is recovered read-only through `CURRENT_PROGRAM` — or fully, when
the user opts into the `document_start` registration ("deep shader capture"),
which records context creation from page load and does nothing else until
probed. The one residual risk in lazy mode — `getContext("webgl2")` on a canvas
that truly has no context locks it to WebGL — is taken only for the single
canvas the user selected, only after a whole observation window saw no draws.

## Type styles: the composite is the token

The token layer's original sin was pretending a design system hands out one
number at a time. It doesn't: `.text-lg` carries size and leading together, a
`--heading-md` stem carries three values, and treating those as unrelated
dials produced a concrete bug — every value a multi-property class declared
was poured into one name-keyed family, so `text-sm`'s line-height sat as a
fake rung in the font-size ladder. The fix and the feature are the same
change: a **type style** is a first-class entity (name, source kind, resolved
constituents), and the values a style owns are carved out of the per-property
families. One value, one owner.

Three sources, equal citizens: multi-declaration single-class rules (CSSOM
pre-expands `font:` shorthand into longhands, so that third source costs
nothing), and custom-property stems grouped by a role vocabulary
(`--heading-md-size/-weight/-leading`). Ladders hold the familiar family
rules, lifted: same source kind only — stepping must never switch write
mechanisms mid-climb — font-size as the axis and sort key, aliases collapsing,
two rungs to step. A solo style is named but grows no arrows: a family of one
is still not a scale, but silence about the most designed thing on the
element would be the wrong kind of modesty.

**Claiming extends the house rule.** A style is claimed only when its source
is *in force* — the class actually worn, the vars actually referenced by
winning declarations — never on value coincidence, exactly as a colour that
merely equals a token claims nothing. In force with every constituent
matching computed reads "on"; in force with deviation reads "modified" and
names the drifted properties. The var half of "in force" walks winning
declarations, so it is cached per render; the class half is a Set lookup and
stays live.

**Two ways back, two controls.** A cell's reset keeps its sacred meaning —
revert *my* edit to its found state, even when found means drifted. The style
chip, when drifted, conforms: every drifted constituent written back to the
style's value in one gesture, meaningful precisely when the page shipped the
drift and no dot is lit. Stepping and conforming ride one registry entry
under the pseudo-property `type-style` — the same arrangement text and
uniforms use — so a composite step is one undo entry and one delta line:

    # type style: text-lg → text-xl (size 18→20)
    # type style: text-lg (modified) → text-lg (leading 32→28)

The name leads because the source edit is that name; the parenthetical echoes
only the constituents that moved. When a class swap doesn't take (the page
outranking its own utility class, the same case the single-prop stepper
guards), the step falls back to writing the rung's values and the line
reports values, not the name — a claimed swap that did nothing would be
advice that does nothing in the source either.

The typography group is the only consumer so far, wearing the round-three
grid: micro-labelled cells, filled ticks for style-owned values, hollow for a
cell's own single-prop token, a dashed border for covered-but-drifted, and a
caption that names whatever the pointer touches. Loose tokenized cells step
on the wheel — the grid has no room for the ‹ › stepper, and the caption
carries the naming. The model is deliberately property-agnostic: shadow and
spacing composites are the same entity with different constituents, waiting
on nothing but their own UI round.

---

## 8. History

**1.3 — the token layer.** Before it, the palette existed in five places at
once: 59 colour literals in `content.css`, 25 more baked into SVG strings in
`content.js`, the badge colour in `background.js`, a stale copy in the harness,
and an icon generator still carrying a purple from an identity before the last
one. The font stack was written out six times and the motion curve eight. The
refactor replaced all of it with two tiers of custom properties — 40 scales
and 19 themed values — added seven themes for the price of 19 lines each, and
wrote `test/tokens.mjs` to keep it so. It recorded one shortfall rather than
hiding it: a 10px de-emphasised grey below AA in seven themes, which it said
would take a redesign of the label's hierarchy to fix.

**2.0 — Pointee.** The extension shed the name, mascot and colour it had
borrowed from one vendor's brand and became agent-agnostic. A ten-direction
round (`test/brand-direction-prototypes.html`) chose a light-first direction
with soft corners, an attached panel, slow ants and a pill toolbar; a second
round (`test/brand-direction-round-two.html`) settled the accent at Vermilion
and the motion at restrained, with springs played beside it and declined. The
roster grew from 19 to 21, the text ramp was rebuilt so every prose tone clears
AA and the WARN tier could go, the sweep and bloom left, the fonts came
in-package, and the panel learned to attach. The plan that carried it is
`docs/POINTEE-PLAN.md`.

## 9. Verification

```sh
node test/tokens.mjs       # 88 checks: literals, completeness, undeclared vars,
                           # badge drift, contrast floors — 0 warnings
node test/sim.mjs          # 138/138 per selection layout — the placement spec against the implementation
node test/tether.mjs       # tether geometry, 6912 configs; panel attachment, 265 placements
node test/edit-audit.mjs   # host-page writes still live in one section
node test/edit-tokens.mjs  # the token resolver, over three real corpora
node test/edit-color.mjs   # picker round trips, bounded by 8-bit quantisation
node test/edit-deltas.mjs  # the shape of the block the panel copies
node test/cdp.mjs          # everything DOM-bound, in a real browser — 37 checks
npm test                   # all of it; `-- --fast` skips the browser
```

`cdp.mjs` is where the token layer is actually tested, because every interesting
failure it has ever had was a browser behaviour rather than a logic error. The
fixture (`test/edit-harness.html`) is deliberately built out of the shapes that
used to report nothing — a `calc()` scale, an `oklch()` palette, a theme scope,
an `@import`, a grouped selector, a cross-origin sheet — because for a long time
it contained only the one shape that worked, and a fixture like that cannot fail.

When adding to it, check the new case fails before the fix as well as passing
after it. Several of these were written, seen green, and only then discovered to
be asserting something that was already true.

Then, in the browser — a `content.js` or `content.css` edit needs an *extension*
reload, not just a page reload:

1. **System follows the OS.** Flip light and dark; Light and Dark render the
   Vermilion pair and an open tab re-themes with no reload.
2. Switch to an editor theme in the options tab — the label's tag, `#id` and
   `.class` take the palette's own roles; the swatches still show *page*
   colours; light-theme shadows read as shadows.
3. Fonts: on a strict-CSP page (github.com), the chrome renders in Geist, not
   the fallback stack. `document.fonts` lists both faces as loaded.
4. Reduced motion at the OS level: the ants hold still, the spinner holds
   still, the undo flash holds still and stays visible.
5. Edit Mode, in `test/edit-harness.html`: the panel opens attached to the
   element's right edge with no run; drag it and the run appears; tune
   something, Escape back out, and confirm the element carries no `style`
   attribute — through undo, the per-property dot, and Reset All alike.

## 10. Adding a theme

1. Copy any block in `tokens.css` and change the 21 values. Order them
   surfaces → borders → text ramp → accent → syntax → status → shadows →
   swatch, as the others do, so the blocks diff cleanly.
2. Add `{ id, name }` to `THEMES` in `settings/settings.js`. No colours — the
   pill's swatch reads them from the block you just wrote.
3. Add the accent to `BADGE_ACCENT` in `background.js`.
4. `node test/tokens.mjs`. It will tell you which of the 21 you missed and
   which pairs are unreadable — and it fails, rather than warns, on a text
   tone under 4.5:1.

Light themes need their **shadows re-tuned, not inverted**. The dark themes'
blacks read as a smudge on a light surface, which is why `shadow-1` and
`shadow-2` are themed values rather than derived from the surface.

## Adding a setting

The measuring preferences set the pattern; a new setting is four sites, all flat:

1. One `chrome.storage.local` key per setting — the `theme` convention. Add its
   roster (legal values, default first) to `REDLINE_PREFS` in `content.js` — or a
   sibling map for a new group — and to its mirror in `settings/settings.js`.
2. Consume it where it acts. Values the redline solver reasons about enter
   `computeRedline()` through the `opts` parameter, which is what keeps the
   function pure and the `test/redline.mjs` sweep honest (§7, *Geometry stays in JS*). Paint-only values
   should be a class toggled on `<html>` and a rule in `content.css`, like the
   quiet overlay.
3. A row in the settings sheet: label, leader, control — a segmented group for
   named values, switch for booleans — plus a `data-hi` hook if the section's
   preview can show the effect. The segmented control takes any number of
   options: its arrow keys walk the roster in the direction pressed and wrap,
   which is the same behaviour for a pair and the correct one for the Editing
   section's three.
4. The `storage.onChanged` listeners on both sides keep open tabs and second
   settings windows in step; a redline setting must also repaint a measurement
   the user is holding at that moment (`scheduleRedline()` on change), and an
   edit setting re-renders an open panel (`renderEditControls()`).

Everything that spans the sheets — storage reads, painting, keyboard, live sync
— runs off `ALL_PREFS`, so a new setting gets all four for free once its roster
is in the map. There are three rosters now: `REDLINE_PREFS`, `EDIT_PREFS` and
`COPY_PREFS`. Only the last needs no repaint on change — copy preferences are
read at the moment a button is pressed, so keeping the object current is the
whole of its listener.

The settings page never learns the extension's logic. The measuring vignette is
hand-drawn geometry and the only shared code is `formatRedlineValue`, mirrored
with a change-both comment, same as the placement spec. The Editing specimen
goes one step further and *is* the panel — the real markup rendered through
`content.css` — so the two settings act on it exactly as they act on the live
one, and it cannot drift into showing chrome that no longer exists.

The Copying preview is the third answer to the same problem, for a preview made
of text rather than pixels. It assembles a real payload, which means the parts
that decide a payload's *shape* — `COPY_ORDER`, `renderCopyHeader`, `copyTrim`,
`fenceBlock`, `assemblePayload` — live there too, mirrored and checked by
`test/mirror-drift.mjs` (its roster reaches `settings/settings.js` as well as
`test/`). What is *not* mirrored is any of the code that finds those values: the
fixture hands over literal strings, the same seam the vignette keeps.

Those five are pure because they take the preference object rather than reading
the module's own, exactly as `computeRedline` takes its `opts` (§7, *Geometry stays in JS*). That is
what lets `test/copy-format.mjs` sweep all 96 combinations of the shape settings
and lets the settings page preview them without either one reproducing the rule.
A new copy setting that changes the payload's shape belongs in one of those five,
or it will have to be written three times.

---

## Out of scope

- Custom user-authored themes, or a colour picker for the chrome's own accent.
- Per-site theme overrides — the preference is global.
- A High Contrast theme. Every prose tone now clears AA, but a theme built to
  AAA needs contrast *targets* driving the palette, not a palette hoping to
  clear them.
- Theming inside cross-origin iframes.
- Tokenising `test/select-parent-fixture.html`. It stands in for an arbitrary
  website under inspection; if its colours followed the theme it would stop
  being a fair test of what the info panel reports.
