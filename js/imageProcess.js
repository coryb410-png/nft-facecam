/* Image preparation for NFT artwork. The original artwork is never modified —
 * we only work on an in-memory copy (optional solid-background removal). */
(function () {
  const { rgbToHex } = FC.util;
  const MAX = 1024;

  function toCanvas(img) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const k = Math.min(1, MAX / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // Returns the border colour if the artwork sits on a flat, opaque background.
  function detectSolidBackground(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const samples = [];
    const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
    for (let x = 0; x < w; x += step) { samples.push((0 * w + x) * 4, ((h - 1) * w + x) * 4); }
    for (let y = 0; y < h; y += step) { samples.push((y * w + 0) * 4, (y * w + w - 1) * 4); }
    let transparent = 0;
    const cols = [];
    for (const i of samples) {
      if (d[i + 3] < 200) { transparent++; continue; }
      cols.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (transparent > samples.length * 0.3 || cols.length < 8) return null; // already transparent
    // dominant colour = median per channel
    const med = [0, 1, 2].map(k => cols.map(c => c[k]).sort((a, b) => a - b)[cols.length >> 1]);
    const close = cols.filter(c => Math.abs(c[0] - med[0]) + Math.abs(c[1] - med[1]) + Math.abs(c[2] - med[2]) < 45).length;
    return close / cols.length > 0.72 ? med : null;
  }

  const diff = (d, i, bg) => Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));

  // Is it safe to auto-remove? If the artwork itself uses lots of the background
  // colour (e.g. a black shirt on a black background) the cut-out would eat into it.
  function bgIsRisky(canvas, bg) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let n = 0, near = 0;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 120));
    for (let y = Math.floor(h * 0.2); y < h * 0.85; y += step) for (let x = Math.floor(w * 0.25); x < w * 0.75; x += step) {
      const i = (y * w + x) * 4; n++;
      if (diff(d, i, bg) < 40) near++;
    }
    return near / n > 0.05;
  }

  // Flood-fill from the edges, clearing only pixels very close to the background
  // colour, then soften the cut edge so there is no jagged fringe.
  function removeBackground(canvas, bg, tol = 26) {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, w, h); const d = im.data;
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue; seen[p] = 1;
      if (d[p * 4 + 3] > 8 && diff(d, p * 4, bg) >= tol) continue;
      seen[p] = 2;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
    }
    for (let p = 0; p < w * h; p++) if (seen[p] === 2) d[p * 4 + 3] = 0;
    // soft matte on the 2-pixel border: fade pixels by how close they are to the bg colour
    for (let pass = 0; pass < 2; pass++) {
      const prev = pass === 0 ? 2 : 3;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (seen[p] >= 2) continue;
        if (seen[p - 1] === prev || seen[p + 1] === prev || seen[p - w] === prev || seen[p + w] === prev) {
          seen[p] = pass + 3;
          const k = Math.min(1, Math.max(0, (diff(d, p * 4, bg) - tol * 0.4) / (tol * 2.2)));
          d[p * 4 + 3] = Math.round(d[p * 4 + 3] * (pass === 0 ? Math.max(0.15, k) : Math.max(0.6, k)));
        }
      }
    }
    ctx.putImageData(im, 0, 0);
  }

  function prepare(img, removeBgPref) {
    const canvas = toCanvas(img);
    const bg = detectSolidBackground(canvas);
    const risky = bg ? bgIsRisky(canvas, bg) : false;
    const auto = removeBgPref === null || removeBgPref === undefined;
    const removeBg = auto ? (!!bg && !risky) : removeBgPref;
    if (removeBg && bg) removeBackground(canvas, bg);
    const hasAlpha = alphaFraction(canvas) > 0.03;
    if (hasAlpha) smoothEdges(canvas);
    return { canvas, bgDetected: !!bg, removeBg: removeBg && !!bg, risky, hasAlpha };
  }

  function alphaFraction(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let n = 0, t = 0;
    for (let i = 3; i < d.length; i += 16) { n++; if (d[i] < 20) t++; }
    return t / n;
  }

  // "Auto-enhance": smooth jagged cut-out edges (only the outline, never the artwork's colours)
  function smoothEdges(canvas) {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, w, h); const d = im.data;
    const a0 = new Uint8ClampedArray(w * h);
    for (let p = 0; p < w * h; p++) a0[p] = d[p * 4 + 3];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, a = a0[p];
      const mn = Math.min(a0[p - 1], a0[p + 1], a0[p - w], a0[p + w]);
      const mx = Math.max(a0[p - 1], a0[p + 1], a0[p - w], a0[p + w]);
      if (mx - mn < 60) continue; // not an edge
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a0[p + j * w + i] * (i === 0 && j === 0 ? 4 : (i === 0 || j === 0) ? 2 : 1);
      d[p * 4 + 3] = Math.min(a, Math.round(s / 16) + (a > 200 ? 20 : 0));
    }
    ctx.putImageData(im, 0, 0);
  }

  /** Find the character's head in the artwork (NFT pixels): sides, top and a chin cut line.
   *  chinK = how far below the mouth to cut (in eye-to-mouth distances). */
  function headBox(canvas, pts, chinK, hasAlpha) {
    const { width: w, height: h } = canvas;
    const eL = [pts.eL[0] * w, pts.eL[1] * h], eR = [pts.eR[0] * w, pts.eR[1] * h], m = [pts.m[0] * w, pts.m[1] * h];
    const ex = (eL[0] + eR[0]) / 2, ey = (eL[1] + eR[1]) / 2;
    const eyeDist = Math.hypot(eR[0] - eL[0], eR[1] - eL[1]);
    const em = Math.max(4, Math.hypot(m[0] - ex, m[1] - ey));
    const chin = m[1] + em * (chinK ?? 0.9);
    const estHalfW = Math.max(eyeDist * 1.35, em * 1.55);
    let x0 = ex - estHalfW, x1 = ex + estHalfW, y0 = ey - em * 1.5;
    if (hasAlpha) {
      const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      const op = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40; };
      const run = (x, y, dx, dy, max) => { // walk while opaque, allowing small gaps
        let gap = 0, last = 0;
        for (let t = 1; t < max; t++) {
          if (op(x + dx * t, y + dy * t)) { gap = 0; last = t; } else if (++gap > 4) break;
        }
        return last;
      };
      if (op(ex, ey) || op(ex, (ey + m[1]) / 2)) {
        const L = [], R = [];
        for (let k = -2; k <= 2; k++) {
          const y = ey + k * em * 0.15;
          L.push(run(ex, y, -1, 0, em * 4)); R.push(run(ex, y, 1, 0, em * 4));
        }
        const med = a => a.sort((p, q) => p - q)[a.length >> 1];
        let T = 0;
        for (const ox of [-0.3, 0, 0.3]) T = Math.max(T, run(ex + ox * eyeDist, ey, 0, -1, em * 4));
        x0 = ex - Math.max(med(L), eyeDist * 0.8); x1 = ex + Math.max(med(R), eyeDist * 0.8);
        y0 = ey - Math.max(T, em * 0.8);
      }
    }
    return { x0, y0, x1, y1: chin, em };
  }

  // Bounding box of the visible artwork (used to guess where a character's head is)
  function contentBox(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 > x0 ? { x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h } : { x0: 0, y0: 0, x1: 1, y1: 1 };
  }

  // Average colour just above an eye — used as the eyelid colour.
  function sampleLidColor(canvas, pts) {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let r = 0, g = 0, b = 0, n = 0;
    // sample the skin just outside each eye at eye level (avoids brows and hair)
    const spots = [];
    for (const e of [pts.eL, pts.eR]) spots.push([e[0] - pts.erx * 1.45, e[1]], [e[0] + pts.erx * 1.45, e[1]]);
    for (const e of spots) {
      const cx = e[0] * w, cy = e[1] * h;
      const s = Math.max(2, Math.round(pts.erx * w * 0.3));
      const x0 = Math.round(Math.min(w - 1, Math.max(0, cx - s / 2))), y0 = Math.round(Math.min(h - 1, Math.max(0, cy - s / 2)));
      const ww = Math.max(1, Math.min(w - x0, s)), hh = Math.max(1, Math.min(h - y0, s));
      const d = ctx.getImageData(x0, y0, ww, hh).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    if (!n) return '#c08a6a';
    return rgbToHex(r / n * 0.9, g / n * 0.9, b / n * 0.9);
  }

  function defaultPoints(w = 1, h = 1) {
    const a = w / h;
    // typical PFP framing: face centred, eyes ~45% down
    return { eL: [0.39, 0.46], eR: [0.61, 0.46], m: [0.5, 0.66], erx: 0.055, ery: 0.045 * a, mw: 0.075 };
  }

  // Convert MediaPipe landmarks of a detected face IN THE ARTWORK into face points.
  function pointsFromLandmarks(lm, w, h) {
    const P = i => [lm[i].x, lm[i].y];
    const avg = (...ps) => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
    const imgLeftEye = avg(P(33), P(133), P(159), P(145));   // subject's right eye = image left
    const imgRightEye = avg(P(362), P(263), P(386), P(374));
    const mouth = avg(P(13), P(14));
    const ex = Math.hypot((lm[33].x - lm[133].x) * w, (lm[33].y - lm[133].y) * h) / w;
    const ey = Math.hypot((lm[159].x - lm[145].x) * w, (lm[159].y - lm[145].y) * h) / h;
    const mw = Math.hypot((lm[61].x - lm[291].x) * w, (lm[61].y - lm[291].y) * h) / w / 2;
    return { eL: imgLeftEye, eR: imgRightEye, m: mouth, erx: ex * 0.62, ery: Math.max(ey * 0.75, ex * 0.35 * w / h), mw: mw * 1.05 };
  }

  FC.imageProcess = { prepare, contentBox, headBox, sampleLidColor, defaultPoints, pointsFromLandmarks, detectSolidBackground };
})();
