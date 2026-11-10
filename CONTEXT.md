# Context

The vocabulary this codebase uses for itself. Terms here are the ones that turn
out to be load-bearing — where using the wrong word leads to the wrong design,
or where two things that sound alike are not the same thing.

This is a glossary, not a spec. How anything works lives in `DESIGN.md`,
`test/PLACEMENT-PLAN.md`, or the code.

## Product

**Pointee** — the extension. Named for what a pointer points at: you point at
an element, and the agent gets the pointee. It names no agent — Claude Code,
Cursor and Codex are examples in the README, never part of the name, the
chrome, or the payload.
_Avoid_: Claude Code Probe, the probe — the name until 2.0.

**Icon** — the toolbar icon: the mark with a 1px ink line around the cream
hand, the one set that ships, whatever the browser's mode. The drawing without
the line is kept in `assets/` and not shipped.
_Avoid_: the light set, the dark set — briefly the two sets the icon shipped
as, swapped by the browser's mode, before the line became the default.

## Modes

**Point Mode** — the extension is switched on for a tab. Hovering outlines
whatever is under the pointer; clicking selects. Everything below happens inside
it. Signalled by `pnt-point-active` on `<html>`.
_Avoid_: Probe Mode — the name until 2.0, when the product became Pointee.

**Selection** — one element is locked in, and the toolbar is showing. The
extension has exactly one selection at a time. Its truthiness *is* the state:
there is no separate flag. Drawn as *slow ants* since 2.0: the hover's dashed
outline come up to the accent at the ring weight and crawling — chosen in
round two of the brand directions over a ring, corner brackets and a glow.

**Selection chrome** — everything drawn for a selection besides the outline:
the inspector and the toolbar, placed together by one solver so they cannot
collide. Whether they are one card or two pieces is a design choice, not a
change of meaning.

**Inspector** — the readout of what was *designed* on the element under the
pointer: its visual properties, nothing about how it is built. Two levels.
On hover, the *readout*: the name, the size, the typeface and size (only when
the element is text), the opacity, the corner radius, and every colour used
anywhere inside the element. On selection, the *picture*: the same things and
no others, drawn rather than written — the typeface's name set in that
typeface, a frame drawn with the element's radius and stroke, the colours as
swatches to copy, each pointing back at the part of the element that wears it.
Spacing is left out on purpose, because Redline measures it; so are display,
position and child counts, which describe construction, not design. Each fact
is said once (the rendered face, not the face and its stack). Renamed in 3.0.
Both levels are laid out as a *sheet*: the name — a code name, so it is held
to a fixed width and ellipsized — then one row per fact (Size, Radius,
Opacity, Type, Colour), an icon and a label before each. Selection adds a
*pane* to the sheet's left holding the picture and the switch between its two
forms: **Map**, a live scaled copy of the element, and **Layers**, one tilted
plane per kind of paint (shadow, fill, image, stroke, text, icon), where the
sheet's last row becomes one row per layer.

**Layer aid** — how Layers keeps paint readable on a clear plane, where white
text would otherwise vanish on a light card. One setting
(`inspectorLayerAid`), three values: *ghost fill* (the default: the element's
own fill, faint, under the text, icon and stroke planes), *plate* (a grey
plate under a plane whose paint would be lost, toned for that paint), and
*halo* (the plane stays clear; only the paint that would be lost is outlined).
_Avoid_: info label (the name until 3.0), info panel (a panel is the thing that
edits), tooltip.

**Toolbar** — the selection's actions: Copy Code, Screenshot, Edit, Select
Parent. Shown only while something is selected; never clipped, whatever the
viewport. Since 3.0, a separate capsule directly under the inspector — the two
are placed as one unit but stay two surfaces.
_Avoid_: action bar, bar.

**Selection layout** — retired in 3.0. There were four (pill on the element's
edge, spine, strip, bar) and a preference to choose between them; now there is
one arrangement and no preference: the toolbar is its own capsule directly
under the inspector, so on a large element the actions are where the readout
is, not somewhere along its edge.
_Avoid_: as a live term — there is nothing left to choose.

**Tooltip** — the name of an icon-only action, or the full name of a token
whose capsule had to truncate it, drawn in its own root beside the surface it
serves and positioned from the control it names. Never part of the card or the
panel. Widened to token names on 2026-09-06, when the two-control token form
was chosen knowing that `--spacing-horizontal-m` does not fit a capsule.

**Redline** — held-Option spacing measurement. A sub-mode of Selection: it
cannot be entered without one, and every path that drops the selection ends it.

**Edit Mode** — live-tuning the selected element through a panel. Also a
sub-mode of Selection, and the only feature that writes to the page.

Redline and Edit Mode differ in who owns the pointer. Redline is a held
modifier and the page underneath stays live. Edit Mode owns the mouse for as
long as it lasts — the page is **inert**, meaning clicks, double-clicks and
context menus over it are swallowed so a scrub across a page of links cannot
navigate away mid-drag.

## Editing

**Edit** — one property's before→after on one element. Not "a change to an
element": each property is tracked separately, because each is a separate line
in the block and a separate thing to undo.

**Edit panel** — the control surface. An *inspector column*: one narrow
column of titled groups, chosen over eleven alternatives in
`test/edit-ui-prototypes.html`. Since round four (`test/edit-panel-prototypes.html`)
every group is a grid of labelled *cells*, the label above the value, and
every group title opens and closes its group; a closed group says its values
on one line. The label is the edited mark and the reset — there is no dot
column. Since 2.0 it is *attached*: flush against the selected element's
facing edge, a tick's length away, and it goes where the element goes. It
*floats* — draggable, as it always was — only when there is no room beside
the element.

**Capsule** — the second control under a field: `‹ name ›` for the token
family the value sits on, in the accent because the name exists in the
source; `‹ page ›` for the page's own values, in the field fill because
they have no name. Its arrows step; its name opens the rung list; its
tooltip carries a name the capsule had to cut short.

**Handoff** — the motion between Selection and Edit Mode: the toolbar's
surface grows into the panel and shrinks back. The origin is the toolbar in
its capsule under the inspector.
_Avoid_: transition (too general), morph (the mechanism, not the thing).

**Tether** — what says "this panel edits that element" in Edit Mode, once the
selection box has been taken away. Four ticks at the element's edge midpoints,
and — only while the panel floats — a dashed run from the panel to the tick on
the facing edge. An attached panel needs no run: the tick it sits against is
the association. Chosen over eleven alternatives in
`test/edit-association-prototypes.html`.

The box had to go, and the reason is the whole design: the panel writes
`border-width`, `border-color`, `border-radius` and `box-shadow`, and the box is
a ring drawn 2px outside the element — sitting on exactly the four things being
judged. The tether works only in the ring of space *outside* the element, and
`test/tether.mjs` sweeps that as a property rather than trusting it.

Not the same thing as Redline, though they share a dashed vocabulary on purpose.
Redline measures the distance between two elements and puts a number on it; the
tether asserts a relationship between chrome and an element and carries no
value. A run that is longer means the panel was dragged further away, nothing
more.

They share the dash and not the weight. A redline guide is an aside at 1px — it
extends an edge so a measurement has something to measure against, and should
stay quieter than the number it serves. The run is the only thing saying which
element the panel edits, so it is drawn at the ticks' own 2px: the tether reads
as one object at one weight, rather than two solid stubs joined by a hairline.

**Colour picker** — its own root, not part of the panel. It began as a child of
the panel and that was the bug: it was clipped by the panel's overflow, locked to
the panel's width, and painted over the very rows it was tuning, with no exit but
an Escape nothing advertised. It is now a surface in its own right — named beside
the panel in `OUR_ROOTS`, in `isOwnEditChrome`, and in the click allowlist — which
is what lets it be dismissed the three ways anything else is: its close button,
the swatch that opened it, or Escape.

**Delta block** — what the panel copies: the same source pointer Copy Code
emits, plus one line per edit. This is the product. The panel is how you produce
it.

**Origin vs. from** — two different "before"s, and conflating them makes an undo
stack wrong. *Origin* is the value at first touch and belongs to the delta: the
block should say where a property started, however many times it was nudged
since. *From* is the value a particular gesture is leaving and belongs to the
undo entry, so one ⌘Z gives back one change rather than the whole session.

**Gesture** — a continuous interaction that repaints many times and must land as
one undo entry: a scrub, a held arrow key, a drag in the colour picker.

**Token family** — a name-prefixed scale a stepper can walk (`--title-sm/md/lg`,
`text-xs…text-2xl`, `p-0…p-96`). Membership is decided by the *values*, not by
the names: any shared prefix with two rungs at two different numbers is a
family, whatever its steps are called. The named scale; page values are the
unnamed one. A build hash (`css-1a2b3c`) is never a step: it names a
component's style, not a rung.

The names were tried first — a step had to be numeric or one of thirty-one words
we had written down — and that was a guess about how other people name things.
It was wrong about most of the field (`--radius`, `--color-primary`,
`--space-small`, `--gap-xxs`), and it failed silently, so a page full of tokens
reported none. What survives from that design is the only part that was load
bearing: a family of one is not a family, because a scale you cannot step along
is not a scale. Two names at the same number are the same statement in values,
and are not a family either.

**Rung** — one distinct value in a family, and the first name that claims it. A
value is *on* a rung when its resolved value matches within half a pixel;
anything else is *off-scale*, and off-scale claims no token. Aliases collapse
onto the rung they share rather than sitting on it twice, so one press of the
stepper always moves the page.

**In scope** — the tokens a *particular element* can see, which is the only set
worth offering. Found by asking the element what custom properties resolve on
it, rather than by reading the stylesheets for names and hoping they reach it.
Custom properties inherit, so the element is the authority — and asking it works
regardless of where the declaration came from, including sheets this extension
is not allowed to read.

That last part is why the stylesheet walk still exists but no longer leads. Two
things an element genuinely cannot report: which *class* means which value
(`.p-4` is 1rem), and the *text of the declaration* that won — the only place a
`var()` can be seen, and so the only way to know a value is a token rather than
merely equal to one.

**Page values** — the distinct values a property actually takes on this page,
read off the elements that carry them: the sizes, weights and leadings of the
text that is here, the colours of the text and the fills that are here. Sorted
and de-duplicated they are a scale too, and a stepper can walk them on any page
whatever its stylesheets say. They have no names. A step that lands on a page
value reports the value; only a token family can lend a name, and only when the
source really references it — a page value that happens to equal a token is
still a value. Decided 2026-09-06, when the source-only layer turned out to be
silent on most production pages.
_Avoid_: observed tokens, harvested tokens (they are not tokens), page scale.

**Rung list** — a field's ladder laid out: every rung with the current one
marked, and beneath it any token in scope that equals the current value. Its
own root beside the panel, like the colour picker. Choosing a rung lands on it;
choosing a match writes the token and only then counts as a claim — the
suggestion on demand that ADR 0004 allows and value coincidence alone never
earns.

**Own chrome** — the DOM this extension injects, all `pnt-`-prefixed. Kept
distinct from the page's own DOM everywhere: in hit-testing, in what the info
label reports, and in which stylesheets the token resolver reads. The
extension's design tokens are not the page's design tokens.

## Copy

**Pointer** — the `# key: value` header naming an element: where it came from in
source, how to find it again, what it says. Shared by Copy Code and the delta
block, so both name an element in the same dialect.

**Skeleton** — the depth-limited HTML fallback, used only when no source file
and no component name could be found. With a pointer, the agent should read the
real source rather than a rendered copy of it.

**Shape** — the middle HTML block: the root tag, then one condensed line per
child (`td > button.btn-ghost "View" onClick={openInvoice}`), then the close. It
describes rather than locates, which is why its segments carry no `:nth-child` —
locating is the selector field's job.

**Located** — whether the payload names a source file or a component. Not
"whether one was found": a field switched off is a field the agent never sees,
so it does not count. This is what decides whether the HTML block falls back to
the full subtree.

**Diagnosis fields** — `layout`, `styles`, `props`. The three that describe what
the browser did rather than naming a construct, off by default, and the only ones
that cost anything to compute. `props` is the sole field in the tool that reports
values rather than names — see DESIGN.md.
