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

  // Flood-fill from the edges, clearing pixels close to the background colour.
  function removeBackground(canvas, bg, tol = 48) {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, w, h); const d = im.data;
    const seen = new Uint8Array(w * h);
    const stack = [];
    const near = (p) => { const i = p * 4; return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < tol; };
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue; seen[p] = 1;
      if (!near(p)) continue;
      seen[p] = 2;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
    }
    for (let p = 0; p < w * h; p++) {
      if (seen[p] === 2) d[p * 4 + 3] = 0;
    }
    // soften the cut edge by one pixel
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (seen[p] === 2) continue;
      const n = (seen[p - 1] === 2) + (seen[p + 1] === 2) + (seen[p - w] === 2) + (seen[p + w] === 2);
      if (n) d[p * 4 + 3] = Math.min(d[p * 4 + 3], 255 - n * 45);
    }
    ctx.putImageData(im, 0, 0);
  }

  function prepare(img, removeBgPref) {
    const canvas = toCanvas(img);
    const bg = detectSolidBackground(canvas);
    const removeBg = removeBgPref === null || removeBgPref === undefined ? !!bg : removeBgPref;
    if (removeBg && bg) removeBackground(canvas, bg);
    return { canvas, bgDetected: !!bg, removeBg: removeBg && !!bg };
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

  FC.imageProcess = { prepare, sampleLidColor, defaultPoints, pointsFromLandmarks, detectSolidBackground };
})();
