```
██████╗  ██████╗ ██╗███╗   ██╗████████╗███████╗███████╗
██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝
██████╔╝██║   ██║██║██╔██╗ ██║   ██║   █████╗  █████╗
██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║   ██╔══╝  ██╔══╝
██║     ╚██████╔╝██║██║ ╚████║   ██║   ███████╗███████╗
╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝
```

Point at any element. Copy it. Paste it into your coding agent.

Pointee names no agent. Claude Code, Cursor, Codex — anything that reads a prompt reads
the pointer it copies.

## Install

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/igboajiogegaabhkjehjmdgmfkcopogj?utm_source=item-share-cb)**

### From source

```sh
git clone https://github.com/Jingquank/pointee.git
cd pointee
npm install
```

Then load it: `chrome://extensions` → Developer mode → Load unpacked → select the folder.

## How it works

1. Click the extension icon to enter Point Mode
2. Hover over elements — a dashed outline and the box-model bands show what you're pointing at
3. Click to select — the outline starts to crawl and the four actions appear, in
   whichever layout you picked in settings (a pill on the element's edge, by default)
4. Pick what to copy:

| | What you get |
|---|---|
| **Copy Code** | Where the element came from in your source, and how to find it again |
| **Screenshot** | PNG of the element |
| **Edit** | Opens a panel that tunes the element live, and copies what changed |
| **Select Parent** | Moves the selection up one level in the DOM — click again to keep climbing |

Paste it into your agent and it knows exactly which element you mean.

### Editing an element

The pencil opens a panel attached to the element's edge — an inspector column of
the properties worth reaching for: type, spacing, size, fill, border, shadow.
Every number can be typed, arrow-keyed, or dragged sideways to scrub, and the
page updates under your hands. The panel follows the element until you drag it
by its header, after which it floats where you put it and a dashed run ties it
back; `‹` goes back to the selection. The footer shows the keys that work here:
**⌘Z** undo, **⇧⌘Z** redo, **Esc** back.

**It steps your design tokens, not just pixels.** If a heading is set to
`var(--title-sm)`, the panel says so and offers the rungs either side — press
`›` and it writes `var(--title-lg)`, keeping the indirection your source has
rather than flattening it to a pixel count. It reads utility classes the same
way, and when a class would lose the cascade (a page rule outranking
`.text-lg`, which is ordinary) it changes the value instead and says so, rather
than claiming a swap that would do nothing in your source either.

It finds them by asking the element what it can actually see, so where they were
declared does not matter: a theme scope, a shadow root, an `@import`, or a
stylesheet on a CDN your page is not allowed to read. Values are read the way
the browser reads them, so a Tailwind v4 scale in `calc()` and a palette in
`oklch()` are tokens like any other. A scale is anything with two rungs at two
different values — `--gap-xxs`, `--space-small` and `--radius-DEFAULT` count,
because the names were never the point.

Colours are named too, on both sides of the arrow: an element whose colour comes
from `var(--ink)` reports `--ink`, not the hex it happened to resolve to. A
colour that merely *equals* a token still reports the hex — your source does not
say `--ink` there, and the block should not either.

Nothing is applied blind:

- Each edited property gets a dot — click it to take that one property back.
- **⌘Z** walks one timeline across every element you've touched this session,
  giving back one change at a time. **⇧⌘Z** redoes.
- The reset button in the header puts every element back exactly as it was
  found — attribute strings and all.

Then **copy**, and you get the usual source pointer plus what changed:

```
# source: src/components/SkillCard.tsx
# selector: main > .cards > article.card:first-child
# edits: apply these style changes to this element in the source
#   font-size: --title-sm (18px) → --title-lg (28px)
#   padding-top: 16px → 24px
#   background-color: #ffffff → --terra (#a94f30)
<article class="card">…</article>
```

The before-value is there on purpose: it's how the agent finds the
declaration to change.

While the panel is open the page is inert — clicks and menus over it are
swallowed, so scrubbing a value across a page full of links can't navigate away
mid-drag. **Esc** steps back out one layer at a time: picker, then panel, then
selection, then Point Mode. Measuring still works throughout — hold **Option**
and the panel steps aside exactly as the toolbar does.

The colour picker opens beside the panel rather than over it, so the rows it is
tuning stay readable. Close it with its **×**, by clicking the same swatch again,
or with **Esc**.

Edits live in the page until you undo them, reset them, switch the extension off,
or reload — switching off puts every element back the way it was found. Nothing
is written to your files; the copied block is the instruction to make them real.

### What the outline tells you

Hovering is useful on its own. The outline draws the element's box model — margin,
border and padding bands, with its real corner radii — and the panel beside it reads out:

- **Identity** — tag, `#id`, classes, and pixel dimensions
- **Text** — the first of the element's own text, when it has any
- **Layout** — display, position, font size and weight, `role`, `aria-label`, child count.
  Only the parts that aren't the default, so the line stays short.
- **Paint** — background, color, border, radius, shadow, opacity, cursor, transform,
  z-index, with a swatch next to each color
- **Breadcrumb** — the ancestor path, scrolling if it's longer than the panel

The panel and the toolbar are placed together in one pass, so they stay on screen and
off each other whatever the element's geometry — including elements taller than the
window, and `<body>` itself.

### Measuring spacing

With an element selected, hold **Option** (Alt on Windows/Linux) and point at any other
element — Figma-style redlines appear in the theme's accent: a line across each gap with
the distance in pixels, dashed guides extending an edge when the two boxes don't line
up, four inset measurements when one contains the other. The hovered element's outline
carries its real corner radii, and everything glides between targets as you sweep. The
panel and toolbar step aside while the key is down and return where they were when you
release it.

Clicking while holding re-selects: the clicked element becomes the new anchor, and
measuring continues from it — walk a row of siblings without ever releasing the key.

### Settings

A gear sits in the top-right corner for as long as Point Mode is on — whether or not
anything is selected. It opens the settings page in a tab.

The page has a sidebar that maps its five sections, cards of dotted-leader rows, and a
preview rail that answers whichever section you're in: Pointee's own chrome while you
pick a theme, a selection redrawn in each layout while you pick one, a measuring
vignette while you tune redlines, the edit panel while you tune editing, the clipboard
payload itself while you tune copying. Hovering a row spotlights the part of the
preview that row controls; pointing at a sidebar link previews its section.

**Appearance** — the theme. Eight of them.

| | |
|---|---|
| System | the default — follows your OS, and switches when it does |
| Light · Dark | Pointee's own pair: warm neutrals under a vermilion accent |
| Dracula · Monokai · Nord · Solarized Dark · Tokyo Night | |

The info panel already colours tag, `#id` and `.class` separately, which is the same
thing an editor theme defines — so these map onto real palette roles rather than being
approximations of them.

**Selection** — where the four actions sit once you select an element. The readout is
the same in every layout; only the actions move.

| | |
|---|---|
| On the edge | the default — a pill of four icons riding the element's bottom edge, its left lined up with the readout |
| Beside the lines | a spine of icons down the readout's left, each level with the line it acts on |
| Under the name | a strip of icons directly under the identity line, the keyboard hints at its end |
| Along the bottom | a labelled bar along the card's bottom; the card is never wider than the bar |

Icon-only actions name themselves in a tooltip. Changing the layout redraws a
selection already open in another tab.

**Measuring** — six controls over the held-Option redlines, defaults matching what
ships: readout unit (`px` / `rem`, against the page's root font-size), precision
(whole / tenths), where the value pill sits (beside its line / on the line), the
dashed extension guides (on / off), a quiet overlay that hides the box-model
tints while measuring (off by default), and whether flush edges are marked with
a `0`.

**Editing** — two controls over the panel the pencil opens: whether it shows
every group it can edit or only the ones this element already has, and whether a
value sitting on a design token offers its scale, its raw number, or both. The
preview here is the panel itself, at its real scale, so both settings act on it
exactly as they act on the live one.

**Copying** — what both copy buttons put on the clipboard, along two axes.

*Which fields ride along.* Nine switches over the pointer header — source, component,
page, anchor, handlers, selector, position, repetition, text — all on, which is what
shipped before there was a switch. Three more are off: **layout diagnosis** (the box,
display, spacing, and the parent's flex or grid context), **matched CSS** (the authored
rules that apply and the stylesheet each came from), and **props snapshot**. Three
presets write a set at once; the field order in the payload never changes, whichever
are on.

Props is the one field that reports *values*. Everything else in this tool names
things — files, components, function names — and it goes out of its way to report a
handler's name and never what it does. Props is the exception, so it is off by default,
it is in no preset, and the row says so.

*How much of the element rides along.* Four HTML blocks — the root tag alone, one
condensed line per child, the full subtree (at depth 3, 2, or 1), or nothing — plus the
rule that puts the full subtree back when nothing in the payload points at the source.
That rule is itself a switch, so slimming the header can't quietly fatten the markup.
Last, the fence: `#` starts a markdown heading, so anywhere a prompt is rendered rather
than shown raw, an unfenced header turns every line of the pointer into an H1.

The preview is the payload — a real one, for a real element, reassembled on every
change, with its character and token count. The **pointer resolves** chips flip the one
thing the payload can't demonstrate about itself.

Everything is stored on this device with `chrome.storage.local` and never leaves it.
Changes repaint tabs that are already open — including a measurement you're holding
at that moment, or an edit panel already open; no reload.

The gear hides itself when the info panel or the toolbar lands on top of it — three of
the six placement strategies dock the panel to the top edge, which is where the gear
lives. It comes back as soon as the panel moves.

### What "Copy Code" outputs

A pointer, not a description — it tells the agent which construct you mean, then gets out
of the way so your own instruction is the loudest thing in the prompt.

````
```
# source: src/components/PlanCard.tsx:42:6
# page: localhost:5173/pricing
# anchor: data-testid="plan-card" (unique in page)
#   text "Pro Plan" (unique in page)
# selector: div[data-testid="plan-card"]
# position: child 2 of 3 in div.grid
#   after div.card "Starter", before div.card "Team"
# repeated: 2 of 3 identical siblings - likely one template; change
#   the component or the data unless this instance alone is meant
# text: Pro Plan For teams that need more. Upgrade
<div class="card flex flex-col gap-3 rounded-xl border p-6 shadow-sm" data-testid="plan-card"> … 3 children </div>
```
````

Notes on the fields:

- **source** is best-effort. It reads the attributes dev tooling already emits —
  `data-inspector-*` (react-dev-inspector), `data-v-inspector` (vite-plugin-vue-inspector),
  `data-source-loc` / `data-source-file`. No plugin, no line.
- **repeated** only appears when the element has identical siblings. It's the difference
  between editing one card and editing the component that renders all of them.
- The **HTML** is the element's own tag with its children summarised, because with a source
  pointer the agent should read the real JSX rather than a rendered copy of it. When neither
  a source location nor a component name resolves, the full skeleton comes back instead —
  it's the only concrete description left.

That is the default. Every field above can be switched off, three more can be switched on,
and the HTML block has four sizes — see **Copying** in the settings. The block the edit
panel copies is the same payload with the edits spliced in, so both speak one dialect and
one section configures them.

## Development

```sh
npm install     # fetches html2canvas into lib/
npm run build   # writes dist/chrome, and a zip of it ready for the Web Store
```

Load unpacked from the repo root while you work — `dist/` is build output and every
build starts by deleting it. Changes to `content.js` or `content.css` need an extension
reload in `chrome://extensions` before the page will pick them up; reloading the page
alone isn't enough.

### The placement harness

The info panel and the toolbar have to stay inside the viewport and off each other for
any element geometry — near an edge, taller than the window, scrolled halfway out of
view. `test/` holds the rig that proves it:

| | |
|---|---|
| `test/placement.mjs` | the executable spec — placement algorithms, the straddle rule, and a 23-case geometry matrix |
| `test/sim.mjs` | headless runner — the matrix across viewports, once per selection layout |
| `test/redline.mjs` | the redline solver's spec — named cases plus a 10,000-config sweep |
| `test/edit-tokens.mjs` | Edit Mode's token resolver — specificity, scale families, stepping |
| `test/edit-color.mjs` | Edit Mode's colour conversions — round trips bounded by 8-bit quantisation |
| `test/edit-deltas.mjs` | the delta block's shape — token-first sides, fixed order, stable output |
| `test/edit-audit.mjs` | proves every host-page write still lives in one section of `content.js` |
| `test/tether.mjs` | the tether solver and the panel's attachment — nothing may enter the element's box |
| `test/tokens.mjs` | the token contract — no literals, every theme complete, every text token above AA |
| `test/harness.html` | browser harness: simulate, or sweep the real extension and reconcile |
| `test/edit-harness.html` | runs the real `content.js` against a fake page — Edit Mode without a rebuild |
| `test/PLACEMENT-PLAN.md` | why the placement works the way it does |

```sh
node test/sim.mjs                        # the matrix, across six viewports
node test/sim.mjs 1440x900 --detail      # one viewport, with per-case geometry
node test/redline.mjs                    # spacing-measurement geometry
node test/edit-tokens.mjs                # design-token reverse lookup
node test/edit-color.mjs                 # picker colour maths
node test/edit-deltas.mjs                # what the Edit panel copies
node test/edit-audit.mjs                 # host-page writes stay in one place
node test/tether.mjs                     # tether geometry and panel attachment
node icons/generate-icons.mjs            # icons/ light and dark sets from assets/icon.png, via headless Chromium

python3 -m http.server 8765              # then open /test/harness.html
                                         # or /test/edit-harness.html — press "p"
```

The harness is keyboard-driven — `s` simulates, `r` sweeps the live extension, `n`/`p`
walk the cases, `l` cycles the simulated layout — because Point Mode captures every
click on the page, including on the harness's own buttons. The live sweep reads which
layout the extension is in and reconciles against that one. Serve it over HTTP: `file://` works only if the extension has
"Allow access to file URLs".

`content.js` can't import the spec — MV3 content scripts are classic scripts — so the
algorithm lives in two places. The live sweep is what keeps them honest: it measures the
real `#pnt-label` and `#pnt-toolbar` and reports any case where they disagree with the
simulation. Run it after touching placement.

### Design tokens

Every colour, typeface, radius, shadow and duration lives in `tokens.css` as a CSS
custom property. A theme is one block of 21 declarations; nothing else changes. The
typefaces — Geist Sans for words, Geist Mono for values — ship in `fonts/` and are
never fetched. [DESIGN.md](DESIGN.md) is the design system: the brand, the type scale,
the palettes, the tokens, the motion, each surface, and the rules that don't move.

```sh
node test/tokens.mjs    # 88 checks
```

It fails the run on a colour literal left in `content.css`, a theme missing one of the
21, a `var(--pnt-…)` nothing declares, a badge colour that has drifted from its theme,
or a text token that can't be read against its own surface — every text tone clears
WCAG AA, as a floor rather than a target.

## Privacy

No data collected. Everything runs locally. [Details](PRIVACY.md).

## License

MIT
