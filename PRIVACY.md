# Privacy Policy — Pointee

**Last updated:** September 6, 2026

## Overview

Pointee is a browser extension that lets developers inspect and copy element information from web pages. Your privacy is important to us, and this extension is designed to operate entirely on your device with no data collection whatsoever.

## Data Collection

Pointee does **not** collect, store, transmit, or share any data. Specifically:

- **No personal information** is collected
- **No browsing history** is recorded or transmitted
- **No page content** is sent to any server
- **No analytics or tracking** of any kind is used
- **No cookies** are set or read by the extension
- **No accounts or sign-ups** are required
- **No page content, URLs, or element data** is ever stored — the only things saved are your own settings (see *Data Storage*)

## How the Extension Works

All processing happens locally in your browser:

1. When you activate Point Mode, the extension reads the DOM of the active tab to display element information (tag names, CSS classes, computed styles, dimensions)
2. When you copy an element, the information is written directly to your system clipboard using the browser's Clipboard API
3. When you capture a screenshot, the element is rendered to a canvas locally using the bundled html2canvas library, then copied to your clipboard

4. When you open the Edit panel, the extension reads the page's stylesheets to work out which design tokens it uses. A stylesheet served from another origin cannot be read by a script running in the page, so for those the extension re-requests the file — see *Stylesheet fetching* below.

**Nothing about you, and nothing about the pages you visit, is sent anywhere.** The
extension has no servers, no analytics, and no API keys. The only outbound requests it
makes are for stylesheet files the page you are looking at already loaded, and they are
described in full below.

## Permissions

The extension requests the following permissions, used solely for its core functionality:

- **activeTab** — to read element information on the current page when you activate Point Mode
- **clipboardWrite** — to copy element information and screenshots to your clipboard
- **storage** — to remember your settings on this device: the theme and your measuring, editing and copying preferences. Nothing else is stored, and none of it ever leaves your browser. See *Data Storage* below.
- **scripting** — to inject the inspector into tabs that were already open when the extension was installed or updated. Without it, those tabs need a reload before Point Mode works.
- **Content script matches (`<all_urls>`)** — to allow the inspector to run on any webpage you choose to inspect
- **host_permissions (`<all_urls>`)** — to re-request stylesheets the page itself is not allowed to read, so the Edit panel can name the design tokens they define. Only ever used for that. See *Stylesheet fetching* below.

## Stylesheet fetching

The Edit panel reports which of your design tokens an element is using — that a heading
is on `--title-sm` rather than merely 18px. To do that it has to read the page's CSS.

A stylesheet served from a different origin to the page (a CDN, an assets subdomain)
cannot be read by any script running in that page: the browser refuses, and a content
script's own request is refused the same way. So when the Edit panel meets one, the
extension's background worker requests that file separately, where the browser does
allow it.

What that means concretely:

- **Only stylesheets the page already links.** The URL is taken from the page's own
  stylesheet list. The extension never invents a URL, follows a link you did not load,
  or requests anything that is not CSS.
- **Only while the Edit panel is open.** Nothing is fetched during ordinary browsing,
  during Point Mode, or in the background.
- **Without your cookies.** The request is made with `credentials: "omit"`, so it cannot
  become an authenticated request made on your behalf, and the server sees no session.
- **Nothing is sent.** It is a plain GET for a file. No page content, no URL history, no
  identifiers.
- **Nothing is kept.** The CSS text is parsed in memory to find token names and
  discarded when you leave the Edit panel. It is never stored, and never forwarded.
- Responses are capped (12 stylesheets, 4 MB, 4-second timeout) and anything that is not
  CSS is discarded unread.

If the fetch fails, the panel says so and simply offers fewer tokens.

## Shader tuning

The Edit panel's **Advanced** section can tune a WebGL canvas live. To do that, a small
script (`shader-agent.js`) has to run in the page's own JavaScript context — that is the
only place a page's WebGL objects are visible from. What it does and does not do:

- **Injected on demand.** By default the script is injected only when you select a
  canvas while the Edit panel is open — never during ordinary browsing.
- **Reads numbers, not content.** It reads the names, types and numeric values of one
  shader program's uniforms — the program drawing the canvas you selected. It reads no
  page text, no pixels, no other scripts' data.
- **Everything stays in the page.** The values travel from the page's context to the
  extension's content script in the same tab, and no further. Nothing is stored, and
  nothing leaves the browser.
- **Leaves things as it found them.** Closing the Edit panel restores every uniform it
  changed and removes its hooks. If the extension is reloaded mid-edit, the script
  notices the silence within ten seconds and restores everything itself.
- **Deep shader capture** (off by default, in Settings → Editing) additionally loads the
  same script at page load on every page, so shaders that draw a single frame can still
  be tuned. In that mode it records which canvases receive WebGL contexts — in memory,
  inside that page, discarded when the page closes. It still reads nothing until you
  open the Edit panel on a canvas, still stores nothing, and still sends nothing
  anywhere. The on/off choice is saved locally alongside the extension's other settings.

## Third-Party Services

None. The typefaces the extension draws its own interface in (Geist and Geist Mono, under
the SIL Open Font License) ship inside the extension package and are never fetched from a
font host. No third-party services, APIs, or external resources are used. The extension
sends no telemetry and has no backend.

## Data Storage

Pointee stores exactly one kind of thing: **your own settings**, saved with `chrome.storage.local` as a handful of short preference values:

- **`theme`** — which colour scheme you picked, e.g. `dark`.
- **Measuring preferences** — the `redline*` keys from Settings → Measuring: unit, precision, pill placement, guides, overlay quieting, zero pills.
- **Editing preferences** — the `edit*` keys from Settings → Editing: which groups the panel shows, how design tokens are displayed, and the off-by-default deep shader capture toggle.
- **Copying preferences** — the `copy*` keys from Settings → Copying: which header fields ride along in a copied payload, and how much HTML comes with them.

Every value is a short option identifier such as `on`, `off`, `px` or `adaptive`, and all of them together are:

- Stored **locally on this device only**. `chrome.storage.local` does not sync to your Google account or to your other browsers.
- **Never transmitted anywhere**. The extension makes no network requests with them.
- **Free of information about you, the pages you visit, or anything you inspect or edit** — they record only which options you picked on the settings page.
- Removable by uninstalling the extension, or by clearing the extension's data from `chrome://extensions`.

Nothing else is stored: no localStorage, no IndexedDB, no cookies, and no record of the pages you inspect, the elements you copy, or the edits you make.

*History:* versions before 1.3.0 used no storage at all; 1.3.0 added the theme; later releases added the settings-page preferences described above.

## Changes to This Policy

If this privacy policy is updated, the changes will be posted to this page with an updated date. As the extension collects no data, meaningful changes to this policy are unlikely.

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/Jingquank/pointee/issues
