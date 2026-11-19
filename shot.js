// Pointee — the shot.
//
// How a screenshot is presented: the captured element, framed on a backdrop
// and drawn into one canvas. The capture itself (real pixels from the tab, or
// html2canvas when there are none) lives in content.js; this file only takes
// the element's pixels and the preferences and paints the picture that goes on
// the clipboard.
//
// A classic script shared by the content script and the settings page, the way
// rail.js is — listed before content.js in the manifest, in background.js's
// injection list, linked from settings/index.html, and loaded by every harness
// that loads content.js. One renderer for both, so the settings preview is the
// shot itself rather than a drawing of it. It never touches the page.
//
// Chosen in the screenshot round (Pointee Screenshot Lab, round six): the
// default is the element on a backdrop sampled from its own colour, small
// padding, a soft shadow, the element's own corners, and a 12px corner on the
// backdrop.

(function () {
  "use strict";

  // Flat keys, default first, unrecognised values fall back — the shape every
  // other preference roster in the extension has. content.js and settings.js
  // both read this one, so there is no mirror to drift.
  const PREFS = {
    shotBackdrop: ["colour", "grid", "plate", "window", "none"],
    shotTone: ["light", "dark"],
    shotPadding: ["s", "m", "l"],
    shotCorners: ["match", "0", "8", "12", "20"],
    shotFrameCorners: ["12", "0", "20", "28"],
    shotShadow: ["soft", "none", "subtle", "deep", "float"],
    shotScale: ["2", "1", "3"],
    shotIsolate: ["on", "off"],
    shotStudio: ["on", "off"],
  };

  const PAD = { s: 24, m: 48, l: 80 };
  // The window frame: title bar height and the page margin inside it.
  const WIN_BAR = 30;
  const WIN_INSET = 22;
  // The spec plate: room for the dimension lines above and beside, and the
  // selector caption below.
  const PLATE_SIDE = 22;
  const PLATE_FOOT = 30;

  // Chromium refuses a canvas over 65535 device pixels a side or 16384² in
  // area: drawing becomes a no-op and toBlob hands back null. A step inside
  // each, so rounding cannot tip over.
  const MAX_SIDE = 65535 * 0.99;
  const MAX_AREA = 16384 * 16384 * 0.99;

  // Each level is one or two drop shadows: [offsetY, blur, alpha]. Light and
  // dark grounds carry different alphas — the same shadow on a dark ground
  // has to be denser to read at all.
  const SHADOWS = {
    none: [],
    subtle: [[1, 2, 0.08, 0.4], [0, 0, 0, 0]],
    soft: [[1, 2, 0.1, 0.4], [14, 34, 0.3, 0.7]],
    deep: [[2, 4, 0.12, 0.5], [24, 48, 0.42, 0.85]],
    float: [[4, 8, 0.08, 0.4], [40, 80, 0.48, 0.9]],
  };
  // subtle is a hairline plus a contact shadow; the hairline is drawn as a
  // stroke because a canvas shadow has no spread.
  const HAIRLINE = { subtle: true };

  function normalize(prefs) {
    const out = {};
    for (const key of Object.keys(PREFS)) {
      const v = prefs && prefs[key];
      out[key] = PREFS[key].includes(v) ? v : PREFS[key][0];
    }
    return out;
  }

  // The picture's geometry in CSS pixels, before any scale. `el` is where the
  // element's own pixels go.
  function layout(meta, prefs) {
    const p = normalize(prefs);
    const pad = PAD[p.shotPadding];
    const w = meta.w, h = meta.h;
    if (p.shotBackdrop === "window") {
      const ww = w + WIN_INSET * 2, wh = h + WIN_INSET * 2 + WIN_BAR;
      return { W: ww + pad * 2, H: wh + pad * 2, win: { x: pad, y: pad, w: ww, h: wh }, el: { x: pad + WIN_INSET, y: pad + WIN_BAR + WIN_INSET, w, h } };
    }
    if (p.shotBackdrop === "plate") {
      const sx = pad + PLATE_SIDE, sy = pad + PLATE_SIDE;
      return { W: w + sx * 2, H: h + sy + pad + PLATE_FOOT, el: { x: sx, y: sy, w, h } };
    }
    return { W: w + pad * 2, H: h + pad * 2, el: { x: pad, y: pad, w, h } };
  }

  // The largest scale at or under `want` that Chromium will still export.
  function fitScale(W, H, want) {
    return Math.max(0.01, Math.min(want, MAX_SIDE / W, MAX_SIDE / H, Math.sqrt(MAX_AREA / (W * H))));
  }

  // Whether a scale exports as asked, for disabling the sizes that cannot.
  function scaleFits(meta, prefs, scale) {
    const L = layout(meta, prefs);
    return fitScale(L.W, L.H, scale) >= scale - 1e-6;
  }

  // ===== Colour =====
  // The backdrop's colour comes from the element's own pixels: the most common
  // colour in a small downsample, ignoring what is transparent. A two-colour
  // card should tint toward the colour it has the most of, not toward the mud
  // an average of the two would be.
  function sample(src) {
    const N = 32;
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(src, 0, 0, N, N);
      const px = ctx.getImageData(0, 0, N, N).data;
      const buckets = new Map();
      let opaque = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;
        opaque++;
        const key = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4);
        const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n++;
        b.r += px[i];
        b.g += px[i + 1];
        b.b += px[i + 2];
        buckets.set(key, b);
      }
      if (opaque < N * N * 0.15) return null;
      let best = null;
      for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
      return [best.r / best.n, best.g / best.n, best.b / best.n];
    } catch {
      return null; // a tainted source cannot be read; the backdrop goes neutral
    }
  }

  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;

  // Two stops for the backdrop's gradient: the sampled hue, desaturated, at a
  // light or a dark lightness. No sample means a near-neutral grey.
  function backdropStops(rgb, tone) {
    const [h, s] = rgb ? toHsl(rgb) : [240, 0];
    const sat = rgb ? Math.min(0.55, s * 0.6) : 0.04;
    return tone === "dark" ? [hsl(h, sat, 0.2), hsl(h, sat, 0.12)] : [hsl(h, sat, 0.91), hsl(h, sat, 0.83)];
  }

  // ===== Drawing =====
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Array.isArray(r) ? r : [r, r, r, r];
    const lim = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = rr.map((v) => Math.max(0, Math.min(lim, v || 0)));
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.arcTo(x + w, y, x + w, y + tr, tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
  }

  function drawGrid(ctx, W, H, tone) {
    ctx.fillStyle = tone === "dark" ? "#151518" : "#fafafb";
    ctx.fillRect(0, 0, W, H);
    const fine = tone === "dark" ? "rgba(255,255,255,0.05)" : "rgba(28,27,34,0.07)";
    const bold = tone === "dark" ? "rgba(255,255,255,0.1)" : "rgba(28,27,34,0.13)";
    for (const [step, color] of [[16, fine], [64, bold]]) {
      ctx.fillStyle = color;
      for (let x = 0; x <= W; x += step) ctx.fillRect(x, 0, 1, H);
      for (let y = 0; y <= H; y += step) ctx.fillRect(0, y, W, 1);
    }
  }

  function drawChecker(ctx, W, H, tone) {
    // Only the preview shows transparency this way; the exported PNG is
    // genuinely transparent. See compose({ checker }).
    ctx.fillStyle = tone === "dark" ? "#2a2a30" : "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = tone === "dark" ? "#33333a" : "#e9e9ee";
    for (let y = 0; y < H; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x < W; x += 16) ctx.fillRect(x, y, 8, 8);
  }

  function elementRadii(meta, prefs) {
    if (prefs.shotCorners === "match") return meta.radii || [0, 0, 0, 0];
    const n = Number(prefs.shotCorners);
    return [n, n, n, n];
  }

  // Paint the shot. `src` is the element's pixels (canvas or bitmap) at
  // `meta.srcScale` device pixels per CSS pixel; `meta` carries the element's
  // CSS size, its own corner radii, its selector, the page's host and
  // background. Returns { canvas, scale, layout } — the scale may come in
  // under the one asked for, when the asked one would not export.
  function compose(src, meta, prefsIn, opts = {}) {
    const p = normalize(prefsIn);
    const L = layout(meta, p);
    const want = opts.scale != null ? opts.scale : Number(p.shotScale);
    const scale = fitScale(L.W, L.H, want);
    const canvas = opts.canvas || document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(L.W * scale));
    canvas.height = Math.max(1, Math.round(L.H * scale));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.imageSmoothingQuality = "high";

    const bd = p.shotBackdrop, tone = p.shotTone;
    const frameR = bd === "none" ? 0 : Number(p.shotFrameCorners);

    ctx.save();
    if (frameR) {
      roundRect(ctx, 0, 0, L.W, L.H, frameR);
      ctx.clip();
    }

    // Backdrop
    if (bd === "colour") {
      const [a, b] = backdropStops(meta.sample !== undefined ? meta.sample : sample(src), tone);
      const g = ctx.createRadialGradient(L.W / 2, L.H * 0.35, 0, L.W / 2, L.H * 0.35, Math.hypot(L.W, L.H) * 0.65);
      g.addColorStop(0, a);
      g.addColorStop(1, b);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, L.W, L.H);
    } else if (bd === "grid" || bd === "plate") {
      drawGrid(ctx, L.W, L.H, tone);
    } else if (bd === "window") {
      const g = ctx.createLinearGradient(0, 0, L.W * 0.4, L.H);
      g.addColorStop(0, tone === "dark" ? "#26252c" : "#e9e7ef");
      g.addColorStop(1, tone === "dark" ? "#1a191f" : "#dcdbe5");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, L.W, L.H);
    } else if (opts.checker) {
      drawChecker(ctx, L.W, L.H, tone);
    }

    const shadow = SHADOWS[p.shotShadow] || [];
    const dark = tone === "dark";
    // Only the shadow lands: the shape that casts it is drawn far off the
    // canvas and its shadow offset brings it back. Filling the shape in place
    // left solid black under the element, and any column the capture did not
    // cover — an edge clipped by an overflow:hidden parent — showed as a black
    // line down the shot's side. Offsets are in device pixels, the translate in
    // CSS ones, hence the scale on one and not the other.
    const SHADOW_THROW = 100000;
    const castShadow = (path) => {
      for (const [y, blur, aLight, aDark] of shadow) {
        if (!blur && !y) continue;
        ctx.save();
        ctx.shadowColor = dark ? `rgba(0,0,0,${aDark})` : `rgba(20,16,30,${aLight})`;
        ctx.shadowBlur = blur * scale;
        ctx.shadowOffsetX = SHADOW_THROW * scale;
        ctx.shadowOffsetY = y * scale;
        ctx.translate(-SHADOW_THROW, 0);
        path();
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.restore();
      }
    };

    // The window frame: the page sits inside it, the element on the page.
    if (bd === "window") {
      const wn = L.win;
      castShadow(() => roundRect(ctx, wn.x, wn.y, wn.w, wn.h, 12));
      ctx.save();
      roundRect(ctx, wn.x, wn.y, wn.w, wn.h, 12);
      ctx.clip();
      ctx.fillStyle = meta.pageBg || "#ffffff";
      ctx.fillRect(wn.x, wn.y, wn.w, wn.h);
      ctx.fillStyle = dark ? "#27262d" : "#ffffff";
      ctx.fillRect(wn.x, wn.y, wn.w, WIN_BAR);
      ctx.fillStyle = dark ? "#34333b" : "#e8e6ee";
      ctx.fillRect(wn.x, wn.y + WIN_BAR - 1, wn.w, 1);
      ctx.fillStyle = dark ? "#45444d" : "#e2dfe8";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(wn.x + 17 + i * 16, wn.y + WIN_BAR / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (meta.host) {
        ctx.fillStyle = dark ? "#9893a1" : "#77737f";
        ctx.font = "500 11px Geist, system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.host, wn.x + wn.w / 2, wn.y + WIN_BAR / 2 + 0.5, wn.w - 120);
      }
      ctx.restore();
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.1)" : "rgba(20,16,30,0.08)";
      ctx.lineWidth = 1 / scale;
      roundRect(ctx, wn.x + 0.5 / scale, wn.y + 0.5 / scale, wn.w - 1 / scale, wn.h - 1 / scale, 12);
      ctx.stroke();
    }

    // The element: its shadow, then its pixels clipped to its corners. Inside
    // a window the window carries the shadow and the element sits flat.
    const e = L.el, radii = elementRadii(meta, p);
    if (bd !== "window") castShadow(() => roundRect(ctx, e.x, e.y, e.w, e.h, radii));
    ctx.save();
    roundRect(ctx, e.x, e.y, e.w, e.h, radii);
    ctx.clip();
    if (bd !== "none" && meta.fill) {
      // Whatever the capture could not see — a strip never on screen — reads
      // as the page behind the element, which is what was there, rather than
      // as a hole onto the backdrop.
      ctx.fillStyle = meta.fill;
      ctx.fillRect(e.x, e.y, e.w, e.h);
    }
    ctx.drawImage(src, e.x, e.y, e.w, e.h);
    ctx.restore();
    if (HAIRLINE[p.shotShadow] && bd !== "window") {
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.08)" : "rgba(20,16,30,0.1)";
      ctx.lineWidth = 1 / scale;
      roundRect(ctx, e.x - 0.5 / scale, e.y - 0.5 / scale, e.w + 1 / scale, e.h + 1 / scale, radii.map((r) => r + 0.5 / scale));
      ctx.stroke();
    }

    // The spec plate's measurements: width above, height to the left, the
    // selector underneath. Drawn in the accent of the light or dark theme.
    if (bd === "plate") {
      const ink = dark ? "#f0452b" : "#d13a1d";
      const ground = dark ? "#151518" : "#fafafb";
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = 1 / scale;
      ctx.font = "500 11px Geist, system-ui, -apple-system, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const ty = e.y - PLATE_SIDE / 2 - 2;
      const lx = e.x - PLATE_SIDE / 2 - 2;
      ctx.beginPath();
      ctx.moveTo(e.x, ty - 5); ctx.lineTo(e.x, ty + 5);
      ctx.moveTo(e.x + e.w, ty - 5); ctx.lineTo(e.x + e.w, ty + 5);
      ctx.moveTo(e.x, ty); ctx.lineTo(e.x + e.w, ty);
      ctx.moveTo(lx - 5, e.y); ctx.lineTo(lx + 5, e.y);
      ctx.moveTo(lx - 5, e.y + e.h); ctx.lineTo(lx + 5, e.y + e.h);
      ctx.moveTo(lx, e.y); ctx.lineTo(lx, e.y + e.h);
      ctx.stroke();
      const label = (text, x, y, rot) => {
        ctx.save();
        ctx.translate(x, y);
        if (rot) ctx.rotate(-Math.PI / 2);
        const tw = ctx.measureText(text).width + 10;
        ctx.fillStyle = ground;
        ctx.fillRect(-tw / 2, -7, tw, 14);
        ctx.fillStyle = ink;
        ctx.fillText(text, 0, 0.5);
        ctx.restore();
      };
      label(String(Math.round(meta.w)), e.x + e.w / 2, ty);
      label(String(Math.round(meta.h)), lx, e.y + e.h / 2, true);
      if (meta.label) {
        ctx.textAlign = "left";
        ctx.fillStyle = dark ? "#9a96a3" : "#77737f";
        ctx.fillText(meta.label, e.x, e.y + e.h + PLATE_FOOT / 2 + 2, Math.max(40, e.w));
      }
    }

    ctx.restore();
    return { canvas, scale, layout: L };
  }

  window.pntShot = { PREFS, PAD, normalize, layout, fitScale, scaleFits, sample, compose };
})();
