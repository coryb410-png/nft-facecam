/* Turns raw face landmarks + blendshapes into a smooth head pose and
 * expression values the avatar renderers understand. */
(function () {
  const { OneEuro, v3, clamp, lerp } = FC.util;

  const swapLR = (bs) => {
    const out = {};
    for (const k in bs) {
      const s = k.endsWith('Left') ? k.slice(0, -4) + 'Right' : k.endsWith('Right') ? k.slice(0, -5) + 'Left' : k;
      out[s] = bs[k];
    }
    return out;
  };

  class PoseSolver {
    constructor() {
      this.f = {}; this.expr = null; this.pose = null; this.lastSeen = 0;
    }
    filt(name, v, t, minC, beta) {
      let f = this.f[name];
      if (!f) f = this.f[name] = new OneEuro(minC, beta);
      f.minCutoff = minC; f.beta = beta;
      return f.filter(v, t);
    }
    reset() { this.f = {}; this.expr = null; this.pose = null; }

    /**
     * @param det {landmarks, blendshapes}
     * @param o {W,H,mirror,smoothing(0..1),exprGain(0..2)}
     */
    update(det, o, t) {
      const { W, H, mirror } = o;
      const lm = det.landmarks;
      const sx = (x) => (mirror ? 1 - x : x) * W;
      // screen (y-down) and 3D (y-up, z toward viewer) coordinates
      const S = (i) => [sx(lm[i].x), lm[i].y * H, -lm[i].z * W];
      const T = (i) => { const p = S(i); return [p[0], -p[1], p[2]]; };
      const avg = (...ps) => ps.reduce((a, p) => [a[0] + p[0] / ps.length, a[1] + p[1] / ps.length, a[2] + p[2] / ps.length], [0, 0, 0]);

      const eyeA = avg(S(33), S(133)), eyeB = avg(S(362), S(263));
      const [eL, eR] = eyeA[0] < eyeB[0] ? [eyeA, eyeB] : [eyeB, eyeA];
      const mouth = avg(S(13), S(14));
      const eyeMid = v3.mid(eL, eR);
      const anchor = avg(eL, eR, mouth);
      const sU = (v3.len(v3.sub(eL, eR)) + v3.len(v3.sub(eyeMid, mouth))) / 2;

      // head orientation basis
      const cheekA = T(234), cheekB = T(454);
      let xAxis = mirror ? v3.sub(cheekA, cheekB) : v3.sub(cheekB, cheekA);
      let yAxis = v3.sub(T(10), T(152));

      const s = clamp(o.smoothing ?? 0.5);
      const minC = lerp(5.0, 0.35, s), beta = lerp(0.05, 0.008, s);
      const ax = this.filt('ax', anchor[0], t, minC, beta * 0.02);
      const ay = this.filt('ay', anchor[1], t, minC, beta * 0.02);
      const ss = this.filt('s', sU, t, minC * 0.7, beta * 0.01);
      xAxis = xAxis.map((v, i) => this.filt('x' + i, v / sU, t, minC, beta));
      yAxis = yAxis.map((v, i) => this.filt('y' + i, v / sU, t, minC, beta));

      const X = v3.norm(xAxis);
      const Z = v3.norm(v3.cross(X, yAxis));
      const Y = v3.cross(Z, X);
      const R = [X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]]; // column-major mat3

      // --- expressions ---
      const bs = det.blendshapes || {};
      const g = o.exprGain ?? 1;
      const b = (k) => bs[k] || 0;
      // "image-left" = left side of the screen (= NFT's image-left eye)
      const L = mirror ? 'Left' : 'Right', Rt = mirror ? 'Right' : 'Left';
      const blinkMap = (v) => clamp((v - 0.32) / 0.32 * (0.6 + 0.4 * g));
      const gazeSubjLeft = (b('eyeLookOutLeft') + b('eyeLookInRight') - b('eyeLookInLeft') - b('eyeLookOutRight')) / 2;
      const target = {
        blinkL: blinkMap(b('eyeBlink' + L)),
        blinkR: blinkMap(b('eyeBlink' + Rt)),
        jaw: clamp((b('jawOpen') - 0.04) / 0.45 * g),
        smileL: clamp(b('mouthSmile' + L) * 1.3 * g),
        smileR: clamp(b('mouthSmile' + Rt) * 1.3 * g),
        pucker: clamp(b('mouthPucker') * g),
        browL: clamp((b('browInnerUp') * 0.6 + b('browOuterUp' + L) - b('browDown' + L) * 0.9) * g, -1, 1),
        browR: clamp((b('browInnerUp') * 0.6 + b('browOuterUp' + Rt) - b('browDown' + Rt) * 0.9) * g, -1, 1),
        gazeX: clamp((mirror ? -gazeSubjLeft : gazeSubjLeft) * 1.6, -1, 1),
        gazeY: clamp(((b('eyeLookDownLeft') + b('eyeLookDownRight')) - (b('eyeLookUpLeft') + b('eyeLookUpRight'))) * 0.9, -1, 1)
      };
      if (!this.expr) this.expr = { ...target };
      for (const k in target) {
        const fast = k.startsWith('blink') ? 0.75 : k === 'jaw' ? 0.6 : 0.4;
        this.expr[k] = lerp(this.expr[k], target[k], fast);
      }

      this.lastSeen = t;
      this.pose = {
        anchor: [ax, ay], scale: ss, R, expr: { ...this.expr },
        blendshapes3d: mirror ? swapLR(bs) : bs, visible: 1
      };
      return this.pose;
    }

    // Called when no face is detected this frame: hold, then fade out.
    lost(t, hold) {
      if (!this.pose) return null;
      if (hold) { this.pose.visible = 1; return this.pose; }
      const dt = t - this.lastSeen;
      this.pose.visible = clamp(1 - (dt - 500) / 400);
      return this.pose;
    }
  }

  FC.PoseSolver = PoseSolver;
})();
