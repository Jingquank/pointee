# Selection chrome — round one

The info label and the toolbar, redesigned. Written 2026-09-06 after a short
interview; the vocabulary it uses is in `GLOSSARY.md` (*selection chrome*,
*info label*, *toolbar*). This is the first design round for this surface —
the six rounds before it touched the edit panel, the settings page and the
brand.

## The defect

Two boxes bracket the selected element and neither knows the other's width:
the label is content-width up to 460px, the toolbar is content-width around
500px with its hints, and both hang off the element's left edge, so the pair
reads as two unrelated things stuck above and below. The toolbar mixes four
registers in one strip — two labelled buttons, an icon-only Edit, a run of
hint chips, and a second capsule for Select Parent. On a wide heading with a
long breadcrumb, the label's marquee, the italic text preview, the readouts
and the crawling outline all compete at once.

## What holds in every direction

- **The four actions, with these names** — Copy Code, Screenshot, Edit, Select
  Parent — all reachable from the chrome. How they are drawn is free.
- **The keyboard hints stay visible somewhere** on this surface: Option to
  measure, Escape to step back. Where, and how quiet, is free.
- **All five readout lines at rest** — identity, text preview, layout, paint,
  breadcrumb. Directions may reshape them, not hide them.
- **The placement rules under it** — anchor to the visible rect, choose whole
  layouts, the toolbar is never clipped, the readout yields — carry over to
  whatever shape wins. A one-box shape simplifies the solver; a shape that
  moves the actions away from the element reopens it. Either way the spec and
  its sweep are revised, not bypassed.

## What varies

| axis | values |
|---|---|
| structure | one card with the actions as its footer · one card with the actions in its header · two pieces in one column · a card beside the element · a compact toolbar at the outline's corner · an identity tab on the outline · a card with a vertical action rail · a command line under the element with the readout beneath · a dock at the viewport edge · a ribbon above the element |
| actions | icon + label · icons with tooltips · text only with dividers · one primary and three secondary · vertical list |
| hints | in the action row · a caption line · inside the identity row · inside the breadcrumb row · under a rail |
| breadcrumb | marquee, as today · clamped with an ellipsis · wrapped to two lines · trimmed to the last two ancestors with the rest on hover |
| outline and material | the 2px ants on glass, as shipped · 1.5px ants · a 1px solid ring · an opaque card · no shadow |

## The directions

Fourteen. Handles are for the review, not the product.

| # | handle | structure | actions | hints | breadcrumb | outline / material |
|---|---|---|---|---|---|---|
| 01 | Stack | one card, footer | icon + label | footer, right end | clamped | as shipped |
| 02 | Header | one card, identity row carries the actions | icons, tooltips | last line, quiet | clamped | as shipped |
| 03 | Column | two pieces, one width | four equal icon + label segments | in the breadcrumb row | marquee | as shipped |
| 04 | Beside | card attached to the element's edge | vertical list | under the list | wrapped | as shipped |
| 05 | Corner | label above; icon toolbar at the outline's bottom-right corner | icons, tooltips | footnote in the label | clamped | 1.5px ants |
| 06 | Tab | identity tab on the outline; detail card below | icon + label | beside the actions | trimmed | 1px solid ring |
| 07 | Rail | one card, two columns | vertical rail, icon + label | under the rail | wrapped | as shipped |
| 08 | Command line | bar under the element; readout card beneath | text only, dividers | middle of the bar | clamped | as shipped |
| 09 | Dock | fixed to the viewport's right edge | vertical list | bottom of the dock | wrapped | opaque |
| 10 | Primary | one card, footer | Copy Code filled, three ghosts | caption | clamped | as shipped |
| 11 | Ledger | two pieces, one width | text only, dividers | underlined keys in the row | two-column key/value | opaque, 1px ring, no shadow |
| 12 | Strip | one card, readouts as chips | icon + label strip | inside the breadcrumb row | clamped | as shipped |
| 13 | Overlay | icon cluster over the element's top edge; label below | icons, tooltips | caption under the label | marquee | 1.5px ants |
| 14 | Ribbon | one wide ribbon above: identity, text, actions on one row; the rest beneath | icon + label | right end of the ribbon | clamped | as shipped |

## What every direction shows

Three mocks at real scale, each a 560×380 stage:

1. **Hover and selected, side by side** — the readout-only state next to the
   full chrome on the same card element, so the transition is judged too.
2. **The hard case** — a wide heading with a long breadcrumb and a long text
   preview, the case from the author's screenshot that made the shipped
   layout fall apart.
3. **Element at the top of the viewport** — no room above, so the structure
   has to work below the element or beside it.

Every mock in the light theme over a light page, in the shipped Vermilion
tokens, with the real type scale. The page is published as an artifact and
committed as `test/selection-chrome-prototypes.html`.

## Choosing

Name a number, or a hybrid — "01's card with 08's action bar". The winner's
structure decides how much of `computeChromeLayout` and `test/placement.mjs`
is revised; the winner's action register decides the toolbar markup; the
GLOSSARY.md entries for *info label* and *toolbar* are updated if the winner
changes what either one is.
