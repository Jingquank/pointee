# Edit panel, round four — plan

Written 2026-09-06 after a 23-question interview about the Edit panel: a
horizontal scrollbar that should not exist, a layout and colour treatment that
reads flat, type that feels small everywhere, a token layer that is silent on
most production pages, a token stepper that cannot be used from a trackpad,
and a hard cut between Selection and Edit Mode. Three prototype galleries come
out of it, one bug fix goes in first, and the token layer gains a second kind
of scale. ADR 0004 records the token decision.

The three earlier rounds this builds on: `test/edit-ui-prototypes.html` chose
the inspector column, `test/edit-association-prototypes.html` chose the
tether, `test/typography-grid-prototypes.html` chose the micro-labelled grid
for Typography only. Round four asks whether that last choice should spread,
retreat, or stay.

## What we agreed

| Decision | Answer |
|---|---|
| Visual world | **Kept.** Vermilion, Geist, glass, the four radii, eight themes at 21 tokens each. Everything inside the panel is open; derived tokens may be added in `:root`; no new per-theme token unless a prototype proves it needs one. |
| Diagnosis | Eleven problems, all in scope. Flat hierarchy (titles and labels both 11px text-2; fields invisible on glass). Two languages (grid vs rows, tracked caps vs sentence case, label-reset vs dot-reset). Accent spread over five roles; the checkerboard is the loudest thing in the panel; `px` repeated on every row. Ragged right edge (62 / 82 / 68px controls) and 248px too narrow for the grid. Height is the normal state, so the scrollbar is a permanent part. Three disclosure vocabularies (dashed add-button, details caret, ⊞⊟ link). Header and footer chrome (a text `↺` beside an SVG icon, no drag affordance, a 9px degraded dot, 10px footer). Swatch chrome (the checkerboard shows as a frame around opaque colours). Missing states (no row hover, no focus-visible on inputs, no rest-state hint that a chip scrubs). Sibling surfaces (colour picker, long-text editor) must follow. No entrance. |
| Structure | The gallery explores **four** directions: everything as cells, everything as rows, the hybrid with one language, and a collapsing or paged variant. The author decides on seeing them. |
| Token model | **Page values beside token families** (ADR 0004). Harvest gives every field a ladder on any page; the source model alone lends a name; a value that equals a token is a suggestion, on demand, never a claim. |
| Harvest coverage | Type (size, weight, leading, tracking, and the size/weight/leading triples as observed type styles), colour (text, fill, stroke, shadow; capped at 24, by frequency), radius and stroke width. **Not spacing.** |
| Stepping | **One stepper for the whole panel.** Clickable ‹ › wherever a ladder exists, cells included; ↑↓ nudges the number, ⌥↑↓ walks the ladder; the wheel only scrolls. Wheel stepping is retired. |
| Token form on a field | Three forms prototyped side by side: (1) one control, two registers — arrows at the chip's ends on hover, page-value ladders plain, token names in the accent after the number; (2) two controls — the number and a separate capsule, neutral for page values, accent for tokens; (3) Figma's — the name replaces the number, value on hover, click opens the rung list, ‹ › still steps. |
| Value coincidence | Shown **on demand** in the field's rung list under the page values, as Figma's Suggested variables. Choosing one writes the `var()` and only then counts as a claim. |
| Edited mark | **The label is the mark.** Edited → the property name turns accent and resets on click, with a small ↺ on hover. The dirty-dot column retires. |
| Label register | **Sentence case everywhere.** Tracked micro-caps retire from the panel. Hierarchy by size, weight and tone. |
| Type scale | **+1 across the board and redistributed:** micro 11, sm 12, base 13, lg 14. Labels and values on base; section titles lg medium; units and captions sm; micro only for keyboard chips. Every literal size (9, 10.5, 11, 14px) folds into a token. Tokens are global, so the info label, toolbar, toast and settings page move with it. |
| Width | Up to **280px**; the gallery toggles 264 / 280. The placement solver reads `offsetWidth`, so no JavaScript changes. |
| Scrollbar | Three mechanisms prototyped: a 6px `::-webkit-scrollbar` rail with `scrollbar-gutter: stable`; a 3px hairline flush to the border, thumb visible only while the panel is hovered; a script-drawn overlay rail that fades in on scroll. The standard `scrollbar-width: thin` is the control group, not a candidate. |
| Scrollbar scope | **One definition, every scrolling surface**: the panel body, the long-text editor's textarea, the settings page, the coming rung list. Parameters in `tokens.css`; a Scrollbar entry in DESIGN.md §6. |
| Truncation cue | **Scroll shadows.** The header grows a short shadow once `scrollTop > 0`, the footer once the body is not at its end; both vanish at the ends. |
| Transition | Three narratives prototyped: the ants gather into the tether's four ticks and the panel rises from the facing edge; the toolbar pill grows into the panel; a staggered crossfade as the baseline. |
| Transition rules | Existing tokens only (180 / 140 / 120, overlapping, never past 260ms in total). Escape plays the same choreography backwards on the exit curve at 140ms. Under `prefers-reduced-motion` nothing moves or morphs; a crossfade remains, listed in the reduced-motion block. |
| Blocked-sheet fetch | **Kept this round.** Stepping no longer needs it; naming still does. Revisit when page values have shipped and its hit rate is known. |
| Packaging | **Three galleries in `test/`, each also published as an artifact.** Built in parallel, reviewed in order — scrollbar, panel, transition — because each winner wears the previous one. |
| Baseline | The current panel, rendered in the harness in Light and Dark, embedded at the top of each gallery. |
| Docs | ADR 0004 written. `GLOSSARY.md` gains *Page values*. DESIGN.md updated after the winners are built, not before. |

## Vocabulary (to `GLOSSARY.md`)

**Page values** — already added. The distinct values a property actually
takes on this page, read off the elements that carry them. A scale a stepper
can walk on any page; no names; a step that lands on one reports the value.
_Avoid_: observed tokens, harvested tokens, page scale.

Two entries change when the winners are built. *Edit panel* gains the chosen
structure and the note that the label carries the edited mark. *Token family*
gains "the named scale; page values are the unnamed one".

## Fix first

**0. The horizontal scrollbar.** The typography grid's colour cell inherits
the row control's fixed 82px in a 71px column, and the body declares only
`overflow-y: auto`, which makes `overflow-x` compute to `auto` too. The cell
takes `width: auto` and the body `overflow-x: hidden` (`clip` computes to
hidden beside an `auto` axis anyway). `test/cdp.mjs` gains one
check: with every group open, the body's `scrollWidth` never exceeds its
`clientWidth`, in both themes. Committed on its own before any gallery
(`987e0f4`; the check failed by 16px against the previous CSS).

## The galleries

Each is a single file in the house form — numbered prototypes, a thesis, the
trade-offs, theme dots — and each is published as an artifact from the same
file. They inline the token blocks rather than linking the stylesheets, as the
earlier rounds do, so the artifact stands alone. Every gallery opens with the
two baseline captures.

**A. `test/edit-scroll-prototypes.html` — the scrollbar.** The three
mechanisms, each shown on the current panel at a viewport short enough to
scroll, with the scroll shadows on every one so they are judged together.
What to look for: whether the thumb is legible on the glass over a busy page,
whether the content column shifts when the rail appears, whether the rail
reads as part of the panel or as the browser's. A fourth column shows the
long-text editor with the same treatment, since it sits beside the panel.

**B. `test/edit-panel-prototypes.html` — the panel.** The four structural
directions, each a complete panel carrying the same set of states: all six
groups; Typography with a type style in force and one drifted; a linked
padding and a split one; an off-scale value and one on a rung; a page-value
ladder and a token family on the same panel; the token-only, value-only and
both preferences; the add-row for Border; Advanced open with a driven uniform;
the degraded marker with its reason; a value mid-scrub and an input focused;
an edited label. Three toggles ride the whole page: width 264 / 280, base
size 12 / 13, and the theme dots. Inside each direction the three token forms
are a toggle, so form and structure can be judged independently. Each
direction proposes one disclosure vocabulary and one header and footer; the
colour picker and the long-text editor are drawn once in the direction's
language. Colour roles are fixed across all four and stated on the page: the
accent means *exists in the source* (a token name) and *edited* (a label),
plus the one primary action; fields get a derived fill that reads as a field
on glass; the checkerboard shows only through translucency.

**C. `test/edit-transition-prototypes.html` — the handoff.** The three
narratives, each replayable in place with a real element, real ants, real
ticks and a panel drawn in direction B's leading candidate, at real durations
and at quarter speed. The reverse plays on a second button. A reduced-motion
toggle shows the crossfade fallback. Every prototype is CSS; a narrative that
needs script to sequence is disqualified by ADR 0003.

## What the galleries decided

**A, the scrollbar — 03, the overlay rail drawn by script.** Chosen
2026-09-06 over the gutter rail and the hairline. A 3px rail inside the
body's right padding, the thumb sized from `clientHeight / scrollHeight`,
tinted with the accent at 55%, shown while scrolling and gone 800ms after the
last event, with one flash on open so the fact of overflow is announced before
any gesture. The native bar is switched off with `scrollbar-width: none`. It
takes no width, so the content column never shifts, and it is unmistakably
the panel's own rather than the browser's. Accepted costs: the thumb is not
draggable, and it needs about thirty lines of script per scrolling surface,
which the scroll-shadow handler already gives a home to. Chrome 121 or later
for `scrollbar-width`; earlier Chrome would show the native bar beside it.

**B, the panel — 04, collapsing groups, with token form 2.** Chosen
2026-09-06. Every group is a grid of labelled cells (01's cells), and every
group title is a caret row that opens and closes: the groups the element
already has open by default, the rest closed with a one-line summary of their
values in mono at the tertiary tone, so the panel is exactly as tall as what
is open and on most elements never scrolls. The token form is the two-control
one: the number chip, and beside or under it a separate capsule reading
`‹ name ›` — accent-soft with the name for a token family, the field fill at
the tertiary tone reading `on page` for page values, `—` when off the scale.
One rule added on choosing: **a capsule's name may truncate, so every capsule
carries a tooltip with the full name**, drawn in the tooltip root the
selection layouts already use; the rung list never truncates. Accepted costs,
stated in the gallery: a hidden group is two clicks away, and the panel's
height changes as groups open, which an attached panel growing downward can
carry across the fold. Round one declined an accordion; what is different
here is the summary line and the open-by-default rule, and the choice was
made on seeing them.

**C, the handoff — 02, the toolbar grows into the panel.** Chosen 2026-09-06.
The toolbar's surface travels and resizes from its own rect to the panel's
rect over 180ms on the standard curve while its icons fade out by 120ms and
the panel's contents fade in from 100ms; the label fades over 140ms, the ants
fade over 140ms and the ticks fade in over 120ms from 100ms; done by 220ms.
Back reverses on the exit curve. **The origin rect is the toolbar in whichever
selection layout is in force**, and that is the adaptation the build has to
make: on the edge, the pill; beside the lines, under the name and along the
bottom, the toolbar lives inside the label card, so the card itself is the
origin and its identity line hands over to the panel's header — the same
tag and `.class` colouring on both. When the panel floats because no side has
room, it lands on the toolbar's own solved slot and the travel is short. The
gallery gains the four layouts as a section under 02 before the build starts.

## The build, after the winners

**1. Scrollbar.** The chosen mechanism as one rule set keyed by a class the
four surfaces share; its width, thumb colours and radius as tokens; the scroll
shadows as two classes toggled from the body's scroll handler, which already
exists for the picker. Listed under Surfaces in DESIGN.md.

**2. Type scale.** New values in `tokens.css`; the six literal sizes replaced
by tokens; every consumer in `content.css` and `settings/settings.css`
re-read against the redistribution table. `test/tokens.mjs` already forbids
literals and checks contrast; it does not check size, and gains a check that
no `font` or `font-size` declaration carries a bare pixel value.

**3. Panel.** The winning structure replaces the row and grid builders; the
dot column goes and the label carries the edit mark and the reset; sentence
case throughout; the header's two actions become two icons; the footer moves
to sm. The picker and the text editor follow. Whatever the winner does for
disclosure replaces the dashed button, the details caret and the link toggle.

**4. Token layer.** `collectPageValues(el)` walks the document once per Edit
Mode entry: text-owning elements for the four type properties and the size /
weight / leading triple, elements with an opaque fill or text for colour,
elements with a radius or a stroke for those two; distinct values by frequency,
capped. Ladders are built from page values and token families together,
tagged by kind, and `familyForControl` returns whichever the value sits on,
token first. The stepper is one builder used by rows and cells alike; the
wheel listener is removed. The rung list opens from the field and lists the
ladder plus in-scope tokens that equal the current value. Hashed single-class
selectors are excluded from class families by a guard on the class name — a
segment of six or more hex-like characters with no vowels — and the harness
gains an Emotion-shaped fixture that must form no family.

**5. Transition.** The chosen choreography as CSS on the existing mode
classes, with `renderTether` no longer instant on entry; the reverse on exit;
the reduced-motion entries added.

**6. Docs.** DESIGN.md §2 (type), §6 (Edit panel, Scrollbar), the Edit Mode
section (page values, the stepper), §8 (history: round four). `GLOSSARY.md`
as above.

## Verification

```sh
node test/tokens.mjs        # literals, contrast, and the new no-bare-size check
node test/edit-tokens.mjs   # grouping mirror: page values, hashed classes form no family
node test/edit-audit.mjs    # host-page writes still live in one section
node test/cdp.mjs           # no horizontal overflow; a trackpad burst no longer steps;
                            # page values on the harness; the stepper in a cell
npm test
```

Then in the browser, in `test/edit-harness.html` and on one production page
with no tokens: every numeric field steps on both; the panel body scrolls
under the pointer wherever it is; the scrollbar and shadows appear only when
there is more; Light and Dark both read; the handoff plays forward and back;
reduced motion crossfades.

## Shipped

In order, each its own commit on 2026-09-06: the overflow fix (`987e0f4`),
the rail (`adf952e`), the type scale (`4be46f9`), the panel (`d50f1a0`), page
values with the rung list and the hash guard (`27c066a`), and the handoff
(`16938fb`).
DESIGN.md §2, §5, §6 and §8 and the Edit Mode section, and GLOSSARY.md's
*Edit panel*, *Token family*, *Tooltip*, *Page values*, *Capsule*, *Rung
list* and *Handoff*, describe what shipped.

## Deferred on the way

Two items of the harvest coverage did not ship in round four's token step.
The size / weight / leading triples as *observed type styles*: the style chip
names the composite in force and has no register for an unnamed one, so the
triples are not collected until the chip learns to show a page style. The
shadow's tint as a page colour: box-shadow's colour needs its own parse and
the picker already offers the fills. Both are small once wanted.

## Open, left to the galleries

Settled by the choices above: the caret row is the disclosure vocabulary
(04 uses it for every group), and the token form is the two-control one. Still
open: whether the `editTokenControls` preference survives (form 2 shows the
number and the name at once, which is what `both` meant; `token` and `value`
have no form now and probably retire); the exact width, judged in the gallery
at 264 and 280; whether colour page values appear only in the picker's palette
or also in the field's rung list.

## Out of scope

A new visual world. Harvesting spacing. Removing the blocked-sheet fetch. Any
settings-page change beyond the scrollbar and the type scale. The panel's
entrance is in; a redesign of the tether is not.
