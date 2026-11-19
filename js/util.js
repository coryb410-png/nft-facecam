/* Small math + helper utilities */
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // One Euro filter: smooth when still, responsive when moving fast.
  class OneEuro {
    constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
      this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
      this.x = null; this.dx = 0; this.t = null;
    }
    static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    reset() { this.x = null; this.t = null; this.dx = 0; }
    filter(value, tMs) {
      if (this.x === null) { this.x = value; this.t = tMs; return value; }
      const dt = Math.max(1e-3, (tMs - this.t) / 1000); this.t = tMs;
      const d = (value - this.x) / dt;
      this.dx = lerp(this.dx, d, OneEuro.alpha(this.dCutoff, dt));
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
      this.x = lerp(this.x, value, OneEuro.alpha(cutoff, dt));
      return this.x;
    }
  }

  const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  };

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not read that image'));
      img.src = src;
    });
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function toast(msg, kind = 'info', ms = 3800) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, ms);
  }

  FC.util = { clamp, lerp, OneEuro, v3, hexToRgb, rgbToHex, loadImage, uid, toast };
})();
