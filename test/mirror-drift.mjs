// Mirror drift check.
//
// content.js is a classic script — MV3 content scripts cannot be modules — so
// the pure functions it contains cannot be imported by a test. The repo's
// answer has always been to transcribe them into test/*.mjs and keep the two
// copies in step by hand, with a "change both" comment at each site.
//
// That works exactly as well as everyone's memory. This file replaces the
// memory: it pulls each mirrored declaration out of content.js by name, does
// the same to the copy, normalises away comments and whitespace, and compares.
// Editing one side and forgetting the other stops being something you get away
// with until a bug reports it.
//
// It also fails when a name in the roster below has gone missing from either
// file, so deleting or renaming a mirrored function is a decision rather than
// a silent loss of coverage.
//
// What it deliberately does not do is check the *DOM-bound* halves — those
// have no copy to compare against. test/cdp.mjs covers them by running the
// real thing.
//
// Run: node test/mirror-drift.mjs   (exit 1 on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "content.js"), "utf8");

// Every declaration that exists twice on purpose. Grouped by the file holding
// the copy; the names are identical on both sides by convention, which is what
// makes this check possible at all.
const MIRRORS = [
  {
    file: "redline.mjs",
    names: ["computeRedline"],
  },
  {
    file: "edit-tokens.mjs",
    names: [
      "parseCssLength",
      "computeSpecificity",
      "compareSpecificity",
      "splitTokenName",
      "groupTokenFamilies",
      "matchToken",
      "stepToken",
    ],
  },
  {
    file: "edit-color.mjs",
    names: ["rgbToHsv", "hsvToRgb", "parseCssColor", "formatHex"],
  },
  {
    file: "edit-deltas.mjs",
    // parseCssColor and formatHex appear here as well as in edit-color.mjs:
    // formatEditSide needs them, and a suite file cannot import a sibling that
    // runs its own checks on load. Two copies of the same thing is exactly
    // what this file exists to keep honest.
    names: [
      "EDIT_PROP_ORDER", "SHORTHAND_OF", "editPropRank",
      "parseCssColor", "formatHex", "displayCss",
      "formatEditSide", "buildEditLines", "buildShaderLines", "formatTextSide",
      "typeStyleEcho", "buildTypeStyleLines",
    ],
  },
  {
    file: "advanced.mjs",
    names: [
      "uniformRange", "uniformLabel", "isColorUniform",
      "advancedCssKind", "formatUniformValue",
    ],
  },
  {
    file: "type-styles.mjs",
    // parseCssLength and splitTokenName ride along from edit-tokens.mjs for
    // the same reason parseCssColor rides along in edit-deltas.mjs: a suite
    // cannot import a sibling that exits on load.
    names: [
      "parseCssLength", "splitTokenName",
      "splitVarStem", "resolveTypeStyle", "groupTypeStyleLadders",
      "matchTypeStyleConstituents", "formatTypePx", "formatTypeCss",
    ],
  },
  {
    file: "inspector.mjs",
    names: ["INSPECTOR", "parseColorList", "normalizeColour", "firstFamily", "radiusLabel", "relLuminance", "contrastRatio", "seenOn", "plateTone"],
  },
  {
    file: "copy-format.mjs",
    names: [
      "COPY_PREFS", "COPY_ORDER", "renderCopyHeader",
      "copyTrim", "fenceBlock", "assemblePayload",
    ],
  },
  // Not a test file. The settings page previews the copy payload by assembling
  // a real one, which means the emission order, the comment dialect and the
  // wrapper rules live there too — and a preview that has drifted from what
  // gets copied is worse than no preview, because it is believed. The path is
  // relative because the roster is joined against test/; nothing else about
  // this entry is special.
  {
    file: "../settings/settings.js",
    names: [
      "COPY_PREFS", "COPY_ORDER", "renderCopyHeader",
      "copyTrim", "fenceBlock", "assemblePayload",
      "formatRedlineValue",
    ],
  },
];

// placement.mjs is not in the roster on purpose. It is not a transcription of
// content.js: it holds several competing placement algorithms plus the case
// matrix, and only layoutChrome corresponds to anything shipped — under a
// different name, with a different signature (the spec takes boxes, the
// implementation measures them). test/sim.mjs is what keeps those two honest,
// by running both over the same matrix and reconciling the results.

// ===== extraction =====

// Comments are stripped before comparison so that documentation can differ —
// it should, since the two copies are read in different contexts — while the
// code itself cannot.
// Where a "/" can begin a regex literal rather than divide. Approximate, but
// the approximation only has to hold for the code being compared.
const REGEX_MAY_FOLLOW = "=(,:[!&|?{};+-*%~^<>";

function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // Skip over string and template literals whole: a // or /* inside one is
    // text, not a comment.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // A regex literal has to be consumed whole as well, and for the same
    // reason strings do — but the failure is nastier. content.js contains
    // /[&<>"']/g; read naively, that quote opens a string that runs to the
    // next quote hundreds of lines away, swallowing real code and leaving
    // real comments behind. The comparison then reports drift that is not
    // there, or worse, compares two things it has mangled identically.
    if (c === "/") {
      const prev = out.replace(/\s+$/, "").slice(-1);
      if (prev === "" || REGEX_MAY_FOLLOW.includes(prev)) {
        out += c;
        i++;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
          if (src[i] === "[") inClass = true;
          else if (src[i] === "]") inClass = false;
          out += src[i];
          if (src[i] === "/" && !inClass) { i++; break; }
          if (src[i] === "\n") { i++; break; } // not a regex after all
          i++;
        }
        continue;
      }
    }

    out += c;
    i++;
  }
  return out;
}

// Pull one declaration out by name, from its keyword to the matching close of
// its body. Delimiters inside strings and regexes do not count, or a regex
// containing a brace would truncate the extraction — and a truncated
// extraction that still matched on both sides would be a check that quietly
// compares nothing.
function extract(src, name) {
  const clean = stripComments(src);
  const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(function|const)\\s+${name}\\b`);
  const m = clean.match(re);
  if (!m) return null;

  const start = m.index + m[0].indexOf(m[1]);
  const isFunction = m[1] === "function";

  // Walk forward, skipping anything whose delimiters are not structural.
  // Returns the index just past the declaration, or -1.
  const OPEN = "{([";
  const CLOSE = "})]";
  let depth = 0;
  let sawBody = false;

  for (let i = start; i < clean.length; i++) {
    const c = clean[i];

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < clean.length) {
        if (clean[i] === "\\") { i += 2; continue; }
        if (clean[i] === quote) break;
        i++;
      }
      continue;
    }

    // A regex literal, distinguished from division by what precedes it.
    if (c === "/") {
      const prev = clean.slice(0, i).replace(/\s+$/, "").slice(-1);
      if (prev === "" || "=(,:[!&|?{};+-*%~^".includes(prev)) {
        i++;
        let inClass = false;
        while (i < clean.length) {
          if (clean[i] === "\\") { i += 2; continue; }
          if (clean[i] === "[") inClass = true;
          else if (clean[i] === "]") inClass = false;
          else if (clean[i] === "/" && !inClass) break;
          i++;
        }
        continue;
      }
    }

    if (OPEN.includes(c)) {
      depth++;
      // A function's parameter list closes before its body opens, so "we are
      // done when the depth returns to zero" would end the extraction at the
      // parameters and silently compare a signature instead of an
      // implementation. The body is the first brace at depth 1.
      if (isFunction && c === "{" && depth === 1) sawBody = true;
      continue;
    }

    if (CLOSE.includes(c)) {
      depth--;
      if (depth === 0 && (!isFunction || sawBody)) return clean.slice(start, i + 1);
      continue;
    }

    // A const declaration ends at the first semicolon outside any delimiter.
    if (!isFunction && c === ";" && depth === 0) return clean.slice(start, i + 1);
  }
  return null;
}

// Whitespace and the export keyword are the only differences allowed: the
// copies live at different indentation and one of them has to be exported.
const normalise = (text) =>
  text.replace(/^\s*export\s+/, "").replace(/\s+/g, " ").trim();

// ===== harness =====

const rows = [];
let failures = 0;

function check(name, fn) {
  const errs = [];
  fn((msg) => errs.push(msg));
  failures += errs.length;
  rows.push({ case: name, result: errs.length ? "FAIL" : "ok", detail: errs.slice(0, 2).join("; ") });
}

// Where the two copies first diverge, in words rather than in a diff.
function firstDifference(a, b) {
  const at = [...a], bt = [...b];
  let i = 0;
  while (i < at.length && i < bt.length && at[i] === bt[i]) i++;
  const near = (s, k) => JSON.stringify(s.slice(Math.max(0, k - 30), k + 40));
  return `diverges at ${i}: content.js ${near(a, i)} vs mirror ${near(b, i)}`;
}

for (const { file, names } of MIRRORS) {
  const mirror = readFileSync(join(root, "test", file), "utf8");
  for (const name of names) {
    check(`${file} · ${name}`, (fail) => {
      const shipped = extract(source, name);
      const copied = extract(mirror, name);
      if (!shipped) return fail(`content.js no longer declares ${name}`);
      if (!copied) return fail(`${file} no longer declares ${name}`);
      const a = normalise(shipped);
      const b = normalise(copied);
      if (a !== b) fail(firstDifference(a, b));
    });
  }
}

// computeRedline reads three numbers out of a GEOMETRY object that exists in
// both files. Comparing the function text proves it *uses* them the same way;
// this proves they *are* the same. Whole-object comparison is not possible —
// content.js's GEOMETRY carries the placement constants too — so the shared
// keys are named and checked one by one.
check("redline.mjs · shared GEOMETRY values", (fail) => {
  const mirror = readFileSync(join(root, "test", "redline.mjs"), "utf8");
  const keys = ["redlinePillOffset", "redlineGuideOvershoot", "redlinePillMargin"];
  const valueOf = (text, key) => {
    const m = stripComments(text).match(new RegExp(`\\b${key}\\s*:\\s*(-?[\\d.]+)`));
    return m ? Number(m[1]) : null;
  };
  for (const key of keys) {
    const shipped = valueOf(source, key);
    const copied = valueOf(mirror, key);
    if (shipped === null) fail(`content.js has no ${key}`);
    else if (copied === null) fail(`redline.mjs has no ${key}`);
    else if (shipped !== copied) fail(`${key}: content.js ${shipped}, mirror ${copied}`);
  }
});

// The extractor is the thing everything else here trusts, so it gets its own
// proof: a check that cannot fail is not a check, and a broken extractor would
// return null on both sides and compare nothing.
check("the extractor actually extracts", (fail) => {
  const sample = extract(source, "formatHex");
  if (!sample) return fail("could not extract a function known to exist");
  if (!sample.includes("padStart")) fail("extraction looks truncated");
  if (!/\}$/.test(sample.trim())) fail("extraction did not end at a closing brace");
  // Balanced, which is what proves the brace walk did not stop early.
  const opens = (sample.match(/\{/g) || []).length;
  const closes = (sample.match(/\}/g) || []).length;
  if (opens !== closes) fail(`unbalanced braces: ${opens} open, ${closes} close`);
});

check("drift is detectable", (fail) => {
  const shipped = extract(source, "matchToken");
  if (!shipped) return fail("could not extract matchToken");
  const tampered = shipped.replace("tolerance", "tolerance /* changed */").replace("0.5", "0.75");
  if (normalise(tampered) === normalise(shipped)) {
    fail("a changed constant did not register as drift — the check is vacuous");
  }
});

for (const r of rows) {
  console.log(`${r.result.padEnd(5)} ${r.case}${r.detail ? " — " + r.detail : ""}`);
}
console.log(failures === 0 ? "\nmirror-drift: all copies match" : `\nmirror-drift: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
