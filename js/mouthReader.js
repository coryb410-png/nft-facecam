/* Reads the real camera pixels inside your open mouth to see whether your
 * teeth (top / bottom) and tongue are showing, plus how open your lips are.
 * Runs on a tiny 48x28 crop each frame — nothing leaves the device. */
(function () {
  // inner-lip outline (MediaPipe face mesh indices)
  const INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
  const CW = 48, CH = 28;

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
    }

    /** lm = raw landmarks (unmirrored, normalised); video = camera element */
    read(lm, video) {
      const W = video.videoWidth, H = video.videoHeight;
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
      return this.v;
    }
  }
  FC.MouthReader = MouthReader;
})();
