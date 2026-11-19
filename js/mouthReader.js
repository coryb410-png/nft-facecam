/* Reads the real camera pixels inside your open mouth to see whether your
 * teeth (top / bottom) and tongue are showing, plus how open your lips are.
 * Runs on a tiny 48x28 crop each frame — nothing leaves the device. */
(function () {
  // inner-lip outline (MediaPipe face mesh indices)
  const INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
  const CW = 48, CH = 28;
  const UPPER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
  const LOWER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
  const K = 17; // samples across the mouth

  // sample a curve of (u, v) points at u = -1 .. 1
  function sample(pts) {
    pts.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (let k = 0; k < K; k++) {
      const u = -1 + 2 * k / (K - 1);
      // smooth Catmull-Rom curve through the lip points (no polygon corners)
      let v = pts[0][1];
      const n = pts.length;
      if (u >= pts[n - 1][0]) v = pts[n - 1][1];
      else for (let i = 0; i < n - 1; i++) {
        const [u1, v1] = pts[i], [u2, v2] = pts[i + 1];
        if (u >= u1 && u <= u2) {
          const v0 = (pts[i - 1] || pts[i])[1], v3 = (pts[i + 2] || pts[i + 1])[1];
          const t = u2 > u1 ? (u - u1) / (u2 - u1) : 0, t2 = t * t, t3 = t2 * t;
          v = 0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
          break;
        }
      }
      out.push(v);
    }
    return out;
  }

  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  class MouthReader {
    constructor() {
      this.cv = document.createElement('canvas'); this.cv.width = CW; this.cv.height = CH;
      this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
      this.v = { teethU: 0, teethL: 0, tongue: 0, open: 0 };
      this.lips = null; this.baseW = 0;
    }

    /** The user's inner-lip outline in mouth-local units (x: corner -1..1, y: down, in half-widths). */
    readLips(lm, W, H, mirror) {
      const S = (i) => [(mirror ? 1 - lm[i].x : lm[i].x) * W, lm[i].y * H];
      let a = S(78), b = S(308);
      if (a[0] > b[0]) [a, b] = [b, a];
      const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 || 1;
      const e = [(b[0] - a[0]) / (2 * half), (b[1] - a[1]) / (2 * half)];
      const toUV = (i) => { const p = S(i), dx = p[0] - c[0], dy = p[1] - c[1]; return [(dx * e[0] + dy * e[1]) / half, (-dx * e[1] + dy * e[0]) / half]; };
      let up = sample(UPPER.map(toUV)), lo = sample(LOWER.map(toUV));
      // closed lips: no opening (avoid flicker from tiny gaps)
      const faceW = Math.hypot((lm[234].x - lm[454].x) * W, (lm[234].y - lm[454].y) * H) || 1;
      const gapMid = lo[8] - up[8];
      if (gapMid < 0.06) { const mid = up.map((v, i) => (v + lo[i]) / 2); up = mid.slice(); lo = mid.slice(); }
      // mouth width vs. your normal width (learned while the mouth is relaxed)
      const ratio = (2 * half) / faceW;
      if (!this.baseW) this.baseW = ratio;
      else if (gapMid < 0.25) this.baseW += (ratio - this.baseW) * 0.01;
      const w = Math.min(1.4, Math.max(0.65, ratio / this.baseW));
      if (!this.lips) this.lips = { up, lo, w };
      else {
        const L = this.lips;
        for (let k = 0; k < K; k++) { L.up[k] += (up[k] - L.up[k]) * 0.55; L.lo[k] += (lo[k] - L.lo[k]) * 0.55; }
        L.w += (w - L.w) * 0.4;
      }
      return this.lips;
    }
    reset() { this.lips = null; this.baseW = 0; }

    /** lm = raw landmarks (unmirrored, normalised); video = camera element */
    read(lm, video, mirror) {
      const W = video.videoWidth, H = video.videoHeight;
      this.readLips(lm, W, H, mirror);
      const P = INNER.map(i => [lm[i].x * W, lm[i].y * H]);
      const faceH = Math.hypot((lm[10].x - lm[152].x) * W, (lm[10].y - lm[152].y) * H) || 1;
      const lip = Math.hypot((lm[13].x - lm[14].x) * W, (lm[13].y - lm[14].y) * H);
      const open = Math.min(1, Math.max(0, (lip / faceH - 0.012) / 0.13));
      let res = { teethU: 0, teethL: 0, tongue: 0, open };
      if (lip / faceH > 0.012) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        const bw = Math.max(4, x1 - x0), bh = Math.max(2, y1 - y0);
        this.ctx.drawImage(video, x0, y0, bw, bh, 0, 0, CW, CH);
        const d = this.ctx.getImageData(0, 0, CW, CH).data;
        const poly = P.map(([x, y]) => [(x - x0) / bw * CW, (y - y0) / bh * CH]);
        // split line between upper and lower half of the opening
        const midY = ((lm[13].y + lm[14].y) / 2 * H - y0) / bh * CH;
        // lighting reference: brightest pixels in the opening
        const pix = [];
        for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
          if (!inside(poly, x + 0.5, y + 0.5)) continue;
          const i = (y * CW + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
          pix.push([r, g, b, y < midY]);
        }
        if (pix.length > 12) {
          const lums = pix.map(p => (p[0] + p[1] + p[2]) / 3).sort((a, b) => a - b);
          const hi = lums[Math.floor(lums.length * 0.92)];
          let up = 0, lo = 0, tU = 0, tL = 0, tg = 0;
          for (const [r, g, b, isUp] of pix) {
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b), lum = (r + g + b) / 3;
            const sat = mx ? (mx - mn) / mx : 0;
            const teeth = lum > Math.max(95, hi * 0.72) && sat < 0.32;
            const tongue = !teeth && r > g * 1.3 && r > b * 1.15 && lum > 55 && sat > 0.28;
            if (isUp) { up++; if (teeth) tU++; } else { lo++; if (teeth) tL++; }
            if (tongue && !isUp) tg++;
          }
          res.teethU = Math.min(1, (tU / Math.max(1, up)) * 2.2);
          res.teethL = Math.min(1, (tL / Math.max(1, lo)) * 2.2);
          res.tongue = Math.min(1, (tg / Math.max(1, lo)) * 1.8) * Math.min(1, open * 3);
        }
      }
      // smooth (quick to appear, a bit slower to fade so it doesn't flicker)
      for (const k in res) {
        const a = res[k] > this.v[k] ? 0.45 : 0.2;
        this.v[k] += (res[k] - this.v[k]) * a;
      }
      return { ...this.v, lips: this.lips };
    }
  }
  FC.MouthReader = MouthReader;
})();
