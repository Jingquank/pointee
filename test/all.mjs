// The whole suite, in the order that fails fastest.
//
// Cheap and pure first, then the checks that read the source, then the one
// that drives a browser — so a typo is reported in milliseconds and Chrome is
// only launched once everything else agrees.
//
// Run: npm test          everything
//      npm test -- --fast   everything except the browser
//
// A suite is a file plus a one-line reason it exists. If a run goes green
// nobody reads these; if it goes red, the reason is the first thing worth
// knowing.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FAST = process.argv.includes("--fast");

const SUITES = [
  ["tokens.mjs", "no literal colours, every theme complete, contrast floors"],
  ["mirror-drift.mjs", "the transcribed copies still match content.js"],
  ["edit-audit.mjs", "page writes still confined to one section"],
  ["placement.mjs", "the placement spec's own geometry matrix"],
  ["sim.mjs", "spec and implementation agree across viewports"],
  ["redline.mjs", "measurement geometry, swept over 10,701 configs"],
  ["edit-tokens.mjs", "design-token reverse lookup over three real corpora"],
  ["type-styles.mjs", "composite type tokens: stems, ladders, claiming, formatting"],
  ["edit-color.mjs", "picker round trips, bounded by 8-bit quantisation"],
  ["edit-deltas.mjs", "the shape of the block the panel copies"],
  ["advanced.mjs", "uniform ranges, labels and kinds for the Advanced section"],
  ["inspector.mjs", "colour and typeface parsing for the 3.0 inspector"],
  ["copy-format.mjs", "every copy setting still produces a true payload"],
  ["cdp.mjs", "the real content.js, in a real browser", { browser: true }],
];

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });

let failed = null;
for (const [file, why, opts] of SUITES) {
  if (FAST && opts?.browser) {
    console.log(`\n── ${file} — skipped (--fast): ${why}`);
    continue;
  }
  console.log(`\n── ${file} — ${why}`);
  const code = await run(file);
  if (code !== 0) { failed = file; break; }
}

if (failed) {
  console.log(`\nFAILED in ${failed}`);
  process.exit(1);
}
console.log(FAST ? "\nAll suites passed (browser suite skipped)" : "\nAll suites passed");
