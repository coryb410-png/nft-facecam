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

  // --- quaternion helpers (x, y, z, w) ---
  const Q = {
    fromMat(m) { // column-major 3x3
      const m00 = m[0], m10 = m[1], m20 = m[2], m01 = m[3], m11 = m[4], m21 = m[5], m02 = m[6], m12 = m[7], m22 = m[8];
      const tr = m00 + m11 + m22; let x, y, z, w;
      if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (m21 - m12) / S; y = (m02 - m20) / S; z = (m10 - m01) / S; }
      else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
      else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S; }
      else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S; }
      return Q.norm([x, y, z, w]);
    },
    toMat([x, y, z, w]) {
      return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
    },
    norm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(v => v / l); },
    inv(q) { return [-q[0], -q[1], -q[2], q[3]]; },
    mul(a, b) {
      return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    },
    slerp(a, b, t) {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
      if (d < 0) { b = b.map(v => -v); d = -d; }
      if (d > 0.9995) return Q.norm(a.map((v, i) => v + (b[i] - v) * t));
      const th = Math.acos(d), s = Math.sin(th);
      const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
      return a.map((v, i) => v * wa + b[i] * wb);
    },
    // limit the total rotation angle
    clampAngle(q, maxRad) {
      const w = clamp(Math.abs(q[3]), 0, 1), ang = 2 * Math.acos(w);
      return ang <= maxRad ? q : Q.slerp([0, 0, 0, 1], q, maxRad / ang);
    }
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
    reset() { this.f = {}; this.expr = null; this.pose = null; this.eyeBase = null; this.q0 = null; this.qs = null; this.lastT = 0; }

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
      const top = S(10), chin = S(152);
      const faceC = v3.mid(top, chin);
      const faceW = v3.len(v3.sub(S(234), S(454))), faceH = v3.len(v3.sub(top, chin));

      // head orientation basis
      const cheekA = T(234), cheekB = T(454);
      let xAxis = mirror ? v3.sub(cheekA, cheekB) : v3.sub(cheekB, cheekA);
      let yAxis = v3.sub(T(10), T(152));

      const s = clamp(o.smoothing ?? 0.5);
      const minC = lerp(5.0, 0.35, s), beta = lerp(0.05, 0.008, s);
      const ax = this.filt('ax', anchor[0], t, minC, beta * 0.02);
      const ay = this.filt('ay', anchor[1], t, minC, beta * 0.02);
      const ss = this.filt('s', sU, t, minC * 0.7, beta * 0.01);
      const face = {
        cx: this.filt('fx', faceC[0], t, minC, beta * 0.02), cy: this.filt('fy', faceC[1], t, minC, beta * 0.02),
        w: this.filt('fw', faceW, t, minC * 0.7, beta * 0.01), h: this.filt('fh', faceH, t, minC * 0.7, beta * 0.01)
      };
      xAxis = xAxis.map((v, i) => this.filt('x' + i, v / sU, t, minC, beta));
      yAxis = yAxis.map((v, i) => this.filt('y' + i, v / sU, t, minC, beta));

      const X = v3.norm(xAxis);
      const Z = v3.norm(v3.cross(X, yAxis));
      const Y = v3.cross(Z, X);
      let R = [X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]]; // column-major mat3

      // Auto-straighten: learn how the camera/phone is usually held and treat that as
      // "facing forward", so the NFT stays head-on; only real head movements are added on top.
      const q = Q.fromMat(R);
      const dt = this.lastT ? Math.min(0.2, Math.max(0.001, (t - this.lastT) / 1000)) : 0.033;
      this.lastT = t;
      if (o.straighten !== false) {
        if (!this.q0) { this.q0 = q; this.t0 = t; }
        const tau = t - this.t0 < 1200 ? 0.25 : 3.5; // lock on fast at start, then adapt slowly
        this.q0 = Q.norm(Q.slerp(this.q0, q, 1 - Math.exp(-dt / tau)));
        let rel = Q.mul(Q.inv(this.q0), q);
        rel = Q.slerp([0, 0, 0, 1], rel, clamp(o.motion ?? 0.6, 0, 1.5));
        rel = Q.clampAngle(rel, 0.55);
        this.qs = this.qs ? Q.slerp(this.qs, rel, 1 - Math.exp(-dt / lerp(0.05, 0.16, s))) : rel;
        R = Q.toMat(this.qs);
      } else {
        this.q0 = null;
        this.qs = this.qs ? Q.slerp(this.qs, q, 1 - Math.exp(-dt / lerp(0.03, 0.12, s))) : q;
        R = Q.toMat(this.qs);
      }

      // --- expressions ---
      const bs = det.blendshapes || {};
      const g = o.exprGain ?? 1;
      const b = (k) => bs[k] || 0;
      // "image-left" = left side of the screen (= NFT's image-left eye)
      const L = mirror ? 'Left' : 'Right', Rt = mirror ? 'Right' : 'Left';
      if (!this.eyeBase) this.eyeBase = { Left: 0.3, Right: 0.3 };
      for (const side of ['Left', 'Right']) {
        const v = b('eyeBlink' + side);
        // baseline follows the open-eye value: drops instantly, rises slowly
        this.eyeBase[side] = v < this.eyeBase[side] ? lerp(this.eyeBase[side], v, 0.3) : this.eyeBase[side] + 0.0015;
      }
      const blinkFor = (side) => {
        const v = b('eyeBlink' + side), base = Math.min(this.eyeBase[side], 0.55);
        return clamp((v - base - 0.12) / Math.max(0.2, (0.85 - base) * 0.6) * (0.6 + 0.4 * g));
      };
      const gazeSubjLeft = (b('eyeLookOutLeft') + b('eyeLookInRight') - b('eyeLookInLeft') - b('eyeLookOutRight')) / 2;
      const target = {
        blinkL: blinkFor(L),
        blinkR: blinkFor(Rt),
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
        anchor: [ax, ay], scale: ss, face, R, expr: { ...this.expr },
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
