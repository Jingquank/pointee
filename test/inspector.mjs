// Inspector helpers: the pure half of the 3.0 inspector.
//
// Transcribed from content.js's Inspector section — mirror-drift.mjs keeps the
// copies identical. The DOM half (collectDesign, the snapshot copy, the two
// pictures) is covered by cdp.mjs and by the live-site sweep.
//
// Run: node test/inspector.mjs   (exit 1 on any failure)

const INSPECTOR = {
  walkCap: 600,      // descendants read for colours and faces
  cloneCap: 240,     // descendants copied into the picture
  cloneBudgetMs: 40, // and no longer than this; the rest of the tree is left out
  hoverSwatches: 24, // swatches on the hover readout before "+n"
  gridAt: 6,         // more colours than this: a grid of swatches, not a list
  gridCols: 6,       // and the grid is this many across, as many rows as it takes
  weak: 2.5,         // paint under this contrast against the pane needs help in Layers
  maxWidth: 420,
};

function parseColorList(value) {
  if (!value || value === "none") return [];
  const re = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-fA-F]{3,8}\b/g;
  return value.match(re) || [];
}

function normalizeColour(raw) {
  if (!raw) return null;
  const m = raw.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(a > 0)) return null;
    a = Math.round(a * 100) / 100;
    const hex = "#" + [m[1], m[2], m[3]]
      .map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))).toString(16).padStart(2, "0"))
      .join("").toUpperCase();
    const css = a < 1 ? `rgb(${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)} / ${a})` : hex;
    return { key: a < 1 ? `${hex}/${a}` : hex, hex, alpha: a, css, copy: a < 1 ? `${hex}${Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase()}` : hex };
  }
  if (/^transparent$/i.test(raw)) return null;
  const alpha = raw.match(/\/\s*([\d.]+%?)\s*\)$/);
  const a = alpha ? (alpha[1].endsWith("%") ? parseFloat(alpha[1]) / 100 : parseFloat(alpha[1])) : 1;
  if (!(a > 0)) return null;
  return { key: raw, hex: raw, alpha: 1, css: raw, copy: raw };
}

function firstFamily(stack) {
  const first = String(stack || "").split(",")[0] || "";
  return first.trim().replace(/^["']|["']$/g, "") || "serif";
}

function radiusLabel(r) {
  return r.every((v) => v === r[0]) ? String(r[0]) : r.join(" ");
}

function relLuminance(rgb) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function contrastRatio(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function seenOn(c, bg) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(c.hex)) return null;
  const a = c.alpha == null ? 1 : c.alpha;
  const over = [1, 3, 5].map((i, k) => parseInt(c.hex.slice(i, i + 2), 16) * a + bg[k] * (1 - a));
  return contrastRatio(relLuminance(over), relLuminance(bg));
}

function plateTone(cols) {
  let best = 0, at = 128;
  for (let v = 30; v <= 225; v += 5) {
    let worst = Infinity;
    for (const c of cols) { const s = seenOn(c, [v, v, v]); if (s !== null && s < worst) worst = s; }
    if (worst > best) { best = worst; at = v; }
  }
  return at;
}

// ===== checks =====
let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`  FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`  ok    ${name}`);
};

eq("rgb → hex", normalizeColour("rgb(255, 36, 66)")?.hex, "#FF2442");
eq("rgba keeps alpha", normalizeColour("rgba(0, 0, 0, 0.06)")?.key, "#000000/0.06");
eq("alpha copies as 8-digit hex", normalizeColour("rgba(0, 0, 0, 0.5)")?.copy, "#00000080");
eq("transparent is no colour", normalizeColour("rgba(0, 0, 0, 0)"), null);
eq("the word transparent is no colour", normalizeColour("transparent"), null);
eq("space syntax", normalizeColour("rgb(10 20 30 / 50%)")?.key, "#0A141E/0.5");
eq("wide gamut kept as written", normalizeColour("oklch(0.7 0.1 30)")?.hex, "oklch(0.7 0.1 30)");
eq("wide gamut with zero alpha", normalizeColour("color(display-p3 1 0 0 / 0)"), null);
eq("gradient stops", parseColorList("linear-gradient(120deg, rgb(255, 122, 69), rgb(255, 36, 66))"),
  ["rgb(255, 122, 69)", "rgb(255, 36, 66)"]);
eq("shadow list", parseColorList("rgba(0, 0, 0, 0.06) 0px 2px 8px 0px, rgb(1, 2, 3) 0px 0px 0px 1px"),
  ["rgba(0, 0, 0, 0.06)", "rgb(1, 2, 3)"]);
eq("none has no colours", parseColorList("none"), []);
eq("nested function in a colour", parseColorList("linear-gradient(color-mix(in srgb, red, blue), oklch(0.5 0.1 20))").length >= 1, true);
eq("first family, quoted", firstFamily('"PingFang SC", -apple-system, sans-serif'), "PingFang SC");
eq("first family, bare", firstFamily("Inter, system-ui"), "Inter");
eq("first family, empty", firstFamily(""), "serif");
eq("radius, uniform", radiusLabel([16, 16, 16, 16]), "16");
eq("radius, mixed", radiusLabel([16, 16, 0, 0]), "16 16 0 0");
eq("grid threshold is six", INSPECTOR.gridAt, 6);
eq("the grid is six across", INSPECTOR.gridCols, 6);
const white = { hex: "#FFFFFF", alpha: 1 }, ink = { hex: "#333333", alpha: 1 };
eq("white on white cannot be seen", seenOn(white, [255, 255, 255]), 1);
eq("black on white is 21:1", Math.round(seenOn({ hex: "#000000", alpha: 1 }, [255, 255, 255])), 21);
eq("alpha is composited before it is judged", seenOn({ hex: "#000000", alpha: 0 + 0.5 }, [255, 255, 255]) < seenOn({ hex: "#000000", alpha: 1 }, [255, 255, 255]), true);
eq("a wide-gamut string is not guessed at", seenOn({ hex: "oklch(0.7 0.1 30)", alpha: 1 }, [255, 255, 255]), null);
eq("white text is weak on a light pane", seenOn(white, [244, 244, 245]) < INSPECTOR.weak, true);
eq("ink is not weak on a light pane", seenOn(ink, [244, 244, 245]) >= INSPECTOR.weak, true);
eq("white text gets a dark plate", plateTone([white]), 30);
eq("ink gets a light plate", plateTone([ink]), 225);
eq("a mixed layer gets a tone between", plateTone([white, ink]) > 30 && plateTone([white, ink]) < 225, true);
eq("the plate serves its worst-read colour", seenOn(white, Array(3).fill(plateTone([white, ink]))) > 2 && seenOn(ink, Array(3).fill(plateTone([white, ink]))) > 2, true);

if (failures) { console.log(`inspector: ${failures} FAILURES`); process.exit(1); }
console.log("inspector: all checks passed");
