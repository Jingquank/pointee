// Headless runner for the placement matrix.
//   node test/sim.mjs                 compare current vs proposed (the beside rule)
//   node test/sim.mjs 1440x900 390x844   pick viewports
//   node test/sim.mjs --detail        per-case geometry for failures
//
// The "current" column is the 1.1.0 two-positioner kept as the before
// picture; "proposed" is what ships — computeChromeLayout, mirrored as
// layoutChrome — run once per selection layout. Any failure in a proposed
// column fails the run.

import { runSim, runSimV2, LAYOUTS } from "./placement.mjs";

const argv = process.argv.slice(2);
const detail = argv.includes("--detail");
const sizes = argv.filter((a) => /^\d+x\d+$/.test(a));

const VIEWPORTS = sizes.length
  ? sizes.map((s) => s.split("x").map(Number))
  : [
      [1440, 900],   // laptop
      [1440, 500],   // laptop, short window
      [1280, 720],
      [1024, 1366],  // tablet portrait
      [390, 844],    // phone
      [1440, 240],   // pathologically short
    ];

const pad = (s, n) => String(s).padEnd(n);
const tally = { before: {}, after: {} };
let totals = { before: 0, after: 0, cases: 0 };
const perLayout = Object.fromEntries(LAYOUTS.map((l) => [l, { fail: 0, cases: 0 }]));

for (const [vw, vh] of VIEWPORTS) {
  const before = runSim(vw, vh);
  const after = runSimV2(vw, vh, "side");
  const byId = Object.fromEntries(before.map((r) => [r.id, r]));

  const bFail = before.filter((r) => r.verdict === "FAIL").length;
  const aFail = after.filter((r) => r.verdict === "FAIL").length;
  totals.before += bFail; totals.after += aFail; totals.cases += after.length;

  for (const r of before) for (const f of r.flags) tally.before[f] = (tally.before[f] || 0) + 1;
  for (const r of after) for (const f of r.flags) tally.after[f] = (tally.after[f] || 0) + 1;

  console.log(`\n${"=".repeat(84)}`);
  console.log(`VIEWPORT ${vw}x${vh}    current ${before.length - bFail}/${before.length} pass` +
              `    proposed (side) ${after.length - aFail}/${after.length} pass`);
  console.log("=".repeat(84));
  console.log(`${pad("case", 20)} ${pad("current", 34)} ${pad("proposed", 20)} strategy`);
  console.log("-".repeat(84));

  for (const r of after) {
    const b = byId[r.id];
    const mark = r.verdict === "PASS" ? " " : "!";
    console.log(
      `${mark}${pad(r.id, 19)} ${pad(b.verdict === "PASS" ? "ok" : b.flags.join(","), 34)} ` +
      `${pad(r.verdict === "PASS" ? "ok" : r.flags.join(","), 20)} ${r.strategy}`
    );
    if (detail && r.verdict !== "PASS") {
      const f = (n) => Math.round(n);
      console.log(`      element top=${f(r.rect.top)} h=${f(r.rect.height)} | ` +
                  `label top=${f(r.label.top)} h=${f(r.label.h)} vis=${Math.round(r.labelVisible * 100)}% | ` +
                  `bar top=${f(r.toolbar.top)} vis=${Math.round(r.toolbarVisible * 100)}%`);
    }
  }

  // The other three layouts are one card each; only their failures are listed.
  for (const layout of LAYOUTS) {
    const res = runSimV2(vw, vh, layout);
    const fails = res.filter((r) => r.verdict === "FAIL");
    perLayout[layout].fail += fails.length;
    perLayout[layout].cases += res.length;
    if (layout !== "side") {
      console.log(`  ${pad(layout, 8)} ${res.length - fails.length}/${res.length} pass` +
        (fails.length ? `   ! ${fails.map((r) => `${r.id} ${r.flags.join(",")} (${r.strategy})`).join("; ")}` : ""));
    }
  }
}

console.log(`\n${"=".repeat(84)}`);
console.log(`TOTAL   current ${totals.cases - totals.before}/${totals.cases} pass` +
            `    proposed (side) ${totals.cases - totals.after}/${totals.cases} pass`);
for (const layout of LAYOUTS) {
  const { fail, cases } = perLayout[layout];
  console.log(`        ${pad(layout, 8)} ${cases - fail}/${cases} pass`);
}
console.log("=".repeat(84));
const flags = [...new Set([...Object.keys(tally.before), ...Object.keys(tally.after)])];
for (const f of flags.sort()) {
  console.log(`  ${pad(f, 20)} current ${pad(tally.before[f] || 0, 5)} proposed ${tally.after[f] || 0}`);
}

// Which strategy each case ended up needing, at a representative size
console.log(`\nSTRATEGY MIX @ 1440x900 (side)`);
const mix = {};
for (const r of runSimV2(1440, 900, "side")) mix[r.strategy] = (mix[r.strategy] || 0) + 1;
for (const [s, n] of Object.entries(mix).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(s, 20)} ${n}`);

const failed = LAYOUTS.reduce((n, l) => n + perLayout[l].fail, 0);
if (failed) {
  console.log(`\nsim: ${failed} proposed placements fail`);
  process.exit(1);
}
