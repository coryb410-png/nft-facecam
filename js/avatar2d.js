/* 2D NFT renderer (WebGL).
 * The flat NFT is drawn on a finely-subdivided mesh that bulges out around the
 * head, so it turns with real perspective and shading instead of looking like a sticker.
 * Blinks, mouth opening, smiles, brows and eye gaze are produced by warping the
 * artwork locally in the fragment shader — the original artwork is never edited. */
(function () {
  const VS = `
attribute vec2 a_pos;
uniform vec2 u_anchorN, u_headC, u_headR, u_anchorS, u_res;
uniform float u_depth, u_scale, u_D;
uniform mat3 u_rot;
varying vec2 v_px;
varying float v_shade;
float bz(vec2 px){ vec2 q=(px-u_headC)/u_headR; return u_depth*u_headR.x*sqrt(max(0.,1.-dot(q,q))); }
void main(){
  vec2 p = a_pos - u_anchorN;
  float z = bz(a_pos) - bz(u_anchorN);
  vec3 v = u_rot * (vec3(p.x, -p.y, z) * u_scale);
  vec3 w = v + vec3(u_anchorS, 0.);
  float k = u_D / max(u_D - w.z, 1.);
  gl_Position = vec4(w.xy * k / (u_res * 0.5), -w.z / (u_D * 2.), 1.);
  v_px = a_pos;
  vec2 q = (a_pos - u_headC) / u_headR;
  float b = 1. - dot(q,q);
  if (b > 0.0 && u_depth > 0.0) {
    float sb = sqrt(max(b, 0.04));
    vec2 g = -u_depth * u_headR.x * (q / u_headR) / sb;
    vec3 n = normalize(vec3(-g.x, g.y, 1.));
    v_shade = clamp(1. + 0.35 * ((u_rot * n).z - n.z), 0.6, 1.1);
  } else {
    v_shade = clamp(1. + 0.25 * (u_rot[2][2] - 1.), 0.7, 1.);
  }
}`;

  const FS = `
precision highp float;
varying vec2 v_px;
varying float v_shade;
uniform sampler2D u_tex;
uniform vec2 u_size, u_eL, u_eR, u_er, u_m, u_blink, u_smile, u_brow, u_gaze, u_headC, u_headR;
uniform float u_mw, u_mh, u_jaw, u_pucker, u_opacity, u_oval, u_crop, u_cut, u_chin, u_fade, u_tongue;
uniform vec2 u_teeth;
uniform float u_lipUp[17];
uniform float u_lipLo[17];
uniform float u_lipOn, u_lipW, u_lipK;
uniform vec4 u_box;
uniform vec3 u_lid;

vec4 tex(vec2 p){
  vec2 uv = p / u_size;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return vec4(0.);
  vec4 c = texture2D(u_tex, uv);
  return vec4(c.rgb / max(c.a, 1e-4), c.a);   // un-premultiply
}
float brow(vec2 p, vec2 e, float amt){
  vec2 c = e - vec2(0., u_er.y * 2.0);
  vec2 d = (p - c) / vec2(u_er.x * 1.8, u_er.y * 1.9);
  float f = exp(-dot(d,d) * 1.6) * (1. - smoothstep(e.y - u_er.y * 1.3, e.y - u_er.y * 0.6, p.y));
  return amt * u_er.y * 0.8 * f;
}
vec2 corner(vec2 p, float side, float amt){
  vec2 c = u_m + vec2(side * u_mw, 0.);
  vec2 d = (p - c) / vec2(u_mw * 0.75, u_mw * 0.6);
  float f = exp(-dot(d,d));
  return vec2(-side * amt * u_mw * 0.15 * f, amt * u_mw * 0.32 * f);
}
vec2 gaze(vec2 p, vec2 e){
  vec2 d = (p - e) / u_er; float r2 = dot(d,d);
  return r2 < 1. ? -u_gaze * u_er * vec2(0.28, 0.22) * (1. - r2) : vec2(0.);
}
vec3 lid(vec2 p, vec2 e, float bl, vec3 col, inout float a){
  if (bl < 0.02) return col;
  float dx = (p.x - e.x) / (u_er.x * 1.08);
  if (abs(dx) >= 1.) return col;
  float h = sqrt(1. - dx*dx) * u_er.y * 1.12;
  float top = e.y - h;
  float edge = top + 2. * h * bl;
  float la = smoothstep(top - 1., top + 1., p.y) * (1. - smoothstep(edge - 1., edge + 1., p.y));
  vec3 lc = u_lid * mix(1.0, 0.82, clamp((p.y - top) / max(2. * h, 1.), 0., 1.));
  col = mix(col, lc, la);
  a = max(a, la);
  float lw = max(u_er.y * 0.11, 1.4);
  float lash = exp(-pow((p.y - edge) / lw, 2.)) * smoothstep(0.15, 0.45, bl) * smoothstep(1., 0.85, abs(dx));
  col = mix(col, vec3(0.06, 0.03, 0.05), lash * 0.9);
  a = max(a, lash);
  return col;
}

void main(){
  vec2 p = v_px;
  vec2 src = p;
  src.y += brow(p, u_eL, u_brow.x) + brow(p, u_eR, u_brow.y);
  src += corner(p, -1., u_smile.x) + corner(p, 1., u_smile.y);
  vec2 dm = (p - u_m) / vec2(u_mw * 1.6, u_mw);
  src.x = u_m.x + (src.x - u_m.x) * (1. + u_pucker * 0.5 * exp(-dot(dm,dm)));

  // mouth opening
  float rel = p.y - u_m.y;
  float mw, shape, topPx, botPx;
  if (u_lipOn > 0.5) {
    // copy the user's real inner-lip outline (9 samples corner -> corner, in mouth half-widths)
    mw = u_mw * u_lipW;
    float uu = (p.x - u_m.x) / mw;
    float f = clamp((uu + 1.) * 8., 0., 16.);
    float top = 0., bot = 0.;
    for (int i = 0; i < 16; i++) {
      if (f >= float(i) && f <= float(i + 1)) {
        float w = f - float(i);
        top = mix(u_lipUp[i], u_lipUp[i + 1], w);
        bot = mix(u_lipLo[i], u_lipLo[i + 1], w);
      }
    }
    float inside = 1. - smoothstep(0.97, 1.0, abs(uu));
    shape = inside * clamp(1. - uu * uu, 0., 1.);
    topPx = top * u_mw * u_lipK * inside;
    botPx = bot * u_mw * u_lipK * inside;
  } else {
    mw = u_mw * (1. + 0.12 * (u_smile.x + u_smile.y) - 0.3 * u_pucker);
    float dx = (p.x - u_m.x) / (mw * 1.05);
    shape = dx*dx < 1. ? pow(1. - dx*dx, 1.5) : 0.;
    float gap = u_jaw * u_mh * (1. + 0.35 * u_tongue);
    topPx = -gap * 0.28 * shape; botPx = gap * 0.72 * shape;
  }
  float gUp = max(0., -topPx), gDn = max(0., botPx);
  bool inGap = botPx - topPx > 0.6 && rel > topPx && rel < botPx;
  if (rel >= gDn) src.y -= gDn * (1. - smoothstep(0., u_mw * 2.6, rel - gDn));
  else if (rel <= -gUp) src.y += gUp * (1. - smoothstep(0., u_mw * 1.2, -rel - gUp));

  src += gaze(p, u_eL) + gaze(p, u_eR);

  vec4 c = tex(src);
  vec3 col = c.rgb;
  float a = c.a;

  if (inGap) {
    float H = botPx - topPx;                   // opening height here (px)
    float yT = rel - topPx, yB = botPx - rel;  // distance from top lip / bottom lip
    float t = yT / max(H, 1e-3);
    // dark mouth cavity, darker towards the back and the corners
    vec3 inner = mix(vec3(0.24, 0.04, 0.07), vec3(0.06, 0.01, 0.02), smoothstep(0., 0.6, t));
    inner *= 0.65 + 0.35 * shape;
    // teeth: white rows along the top / bottom lip with gaps between teeth
    float tw = mw * 0.30;                                   // tooth width
    float cx = (p.x - u_m.x) / tw;
    float gapLine = smoothstep(0.03, 0.09, abs(fract(cx + 0.5) - 0.5));
    float scal = pow(abs(fract(cx + 0.5) - 0.5) * 2., 2.);  // rounded tooth tips
    vec3 toothCol = vec3(0.96, 0.94, 0.89);
    if (u_teeth.y > 0.05) {                                 // bottom row (behind the tongue)
      float hL = min(H * 0.24, mw * 0.24) * smoothstep(0.05, 0.35, u_teeth.y);
      float tooth = 1. - smoothstep(hL - 1.2, hL + 0.6, yB - 0.2 * hL * scal);
      vec3 c2 = toothCol * mix(0.95, 0.75, smoothstep(0., hL, yB)) * mix(0.7, 1., gapLine) * (0.7 + 0.3 * shape);
      inner = mix(inner, c2, tooth);
    }
    // tongue: rounded, rises from the bottom of the mouth, grows with how much tongue shows
    float tg = u_tongue;
    if (tg > 0.04) {
      float th = H * (0.35 + 0.45 * tg);
      vec2 q = vec2((p.x - u_m.x) / (mw * (0.5 + 0.22 * tg)), (yB - th * 0.55) / (th * 0.62));
      float tm = 1. - smoothstep(0.82, 1.0, length(q));
      vec3 tc = mix(vec3(0.90, 0.42, 0.50), vec3(0.66, 0.20, 0.28), smoothstep(-0.7, 0.9, -q.y));
      tc *= 1. - 0.22 * exp(-pow(q.x * 5., 2.)) * smoothstep(-0.3, 0.5, q.y);  // centre groove
      tc += 0.12 * exp(-dot(q - vec2(-0.3, 0.4), q - vec2(-0.3, 0.4)) * 5.);   // highlight
      inner = mix(inner, tc, tm * smoothstep(0.04, 0.2, tg));
    }
    if (u_teeth.x > 0.05) {                                 // top row (in front)
      float hU = min(H * 0.30, mw * 0.30) * smoothstep(0.05, 0.35, u_teeth.x);
      float tooth = 1. - smoothstep(hU - 1.2, hU + 0.6, yT - 0.2 * hU * scal);
      vec3 c2 = toothCol * mix(1.0, 0.8, smoothstep(0., hU, yT)) * mix(0.7, 1., gapLine) * (0.7 + 0.3 * shape);
      inner = mix(inner, c2, tooth);
    }
    float edge = min(yT, yB);
    float ia = smoothstep(0., 1.6, edge);
    col = mix(col, inner, ia);
    a = max(a, ia);
  }
  col = lid(p, u_eL, u_blink.x, col, a);
  col = lid(p, u_eR, u_blink.y, col, a);

  // head-only cut: remove the body below the chin, and anything far to the sides
  if (u_cut > 0.5) {
    a *= 1. - smoothstep(u_chin - u_fade, u_chin + u_fade, p.y);
    vec2 c = vec2((u_box.x + u_box.z) * .5, (u_box.y + u_chin) * .5);
    vec2 hr = vec2((u_box.z - u_box.x) * .5, (u_chin - u_box.y) * .5) * u_crop;
    if (u_cut < 1.5) {
      // transparent artwork: keep hats / halos / fins above, trim far sides
      a *= 1. - smoothstep(-u_fade, u_fade, abs(p.x - c.x) - hr.x * 1.3);
    } else {
      // artwork with a background: soft oval around the head
      vec2 q = (p - c) / (hr * 1.1);
      a *= 1. - smoothstep(0.88, 1.0, length(q));
    }
  } else if (u_oval > 0.5) {
    vec2 q = (p - u_headC) / (u_headR * 1.18);
    a *= 1. - smoothstep(0.86, 1.0, length(q));
  }
  col *= v_shade;
  a *= u_opacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // multiply column-major 3x3 matrices
  function mul3(a, b) {
    const o = new Array(9);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    }
    return o;
  }
  const rotZ = (t) => [Math.cos(t), Math.sin(t), 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 1];

  class Avatar2D {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: true });
      if (!gl) throw new Error('WebGL is not available in this browser');
      this.gl = gl;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      this.prog = prog;
      this.loc = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); this.loc[u.name] = gl.getUniformLocation(prog, u.name); }
      this.aPos = gl.getAttribLocation(prog, 'a_pos');
      this.tex = gl.createTexture();
      this.vbo = gl.createBuffer(); this.ibo = gl.createBuffer();
      this.ready = false;
    }

    setAvatar(img, pts, lidHex) {
      const gl = this.gl;
      const w = img.width, h = img.height;
      this.w = w; this.h = h;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // "auto-enhance": upload as a 1024² power-of-two texture with mipmaps so the NFT
      // stays crisp and smooth (no jaggies) at any size on screen
      const pot = document.createElement('canvas'); pot.width = pot.height = 1024;
      const pc = pot.getContext('2d'); pc.imageSmoothingQuality = 'high'; pc.drawImage(img, 0, 0, 1024, 1024);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pot);
      gl.generateMipmap(gl.TEXTURE_2D);
      const af = gl.getExtension('EXT_texture_filter_anisotropic');
      if (af) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // mesh grid
      const N = 48, verts = [], idx = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) verts.push(i / N * w, j / N * h);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      this.count = idx.length;
      this.setPoints(pts, lidHex);
      this.ready = true;
    }

    setPoints(pts, lidHex) {
      const { w, h } = this;
      const eL = [pts.eL[0] * w, pts.eL[1] * h], eR = [pts.eR[0] * w, pts.eR[1] * h], m = [pts.m[0] * w, pts.m[1] * h];
      const eyeMid = [(eL[0] + eR[0]) / 2, (eL[1] + eR[1]) / 2];
      const eyeDist = Math.hypot(eR[0] - eL[0], eR[1] - eL[1]);
      const eyeMouth = Math.hypot(m[0] - eyeMid[0], m[1] - eyeMid[1]);
      this.g = {
        eL, eR, m, er: [pts.erx * w, pts.ery * h], mw: pts.mw * w,
        anchor: [(eL[0] + eR[0] + m[0]) / 3, (eL[1] + eR[1] + m[1]) / 3],
        headC: [eyeMid[0] + (m[0] - eyeMid[0]) * 0.25, eyeMid[1] + (m[1] - eyeMid[1]) * 0.25],
        headR: [Math.max(eyeDist * 1.45, eyeMouth * 1.9), eyeMouth * 2.3],
        sN: (eyeDist + eyeMouth) / 2,
        mh: eyeMouth * 0.55
      };
      const rgb = FC.util.hexToRgb(lidHex || '#c08a6a');
      this.lid = rgb.map(v => v / 255);
    }

    // head region in artwork pixels (from FC.imageProcess.headBox)
    setHead(box, hasAlpha) { this.box = box; this.hasAlpha = !!hasAlpha; }

    /** s: {W,H, anchor:[x,y] screen px, R (col-major mat3), faceSize, size, offX, offY, roll(deg), depth, oval, opacity, expr} */
    render(s) {
      const gl = this.gl, c = this.canvas;
      if (c.width !== s.W || c.height !== s.H) { c.width = s.W; c.height = s.H; }
      gl.viewport(0, 0, c.width, c.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!this.ready || !s.opacity) return;
      const g = this.g, L = this.loc, e = s.expr;
      const R = mul3(s.R, rotZ((s.roll || 0) * Math.PI / 180));
      const fs = s.faceSize;
      const b = this.box;
      // Auto-fit: size & place the NFT head so it covers the whole human head (forehead to chin,
      // cheek to cheek, plus hair) instead of just lining up eyes & mouth.
      let anchorN = g.anchor, anchorS = s.anchor, scale = fs / g.sN * (s.size || 1), unit = fs;
      if (s.fit && s.face && b) {
        const f = s.face;
        const hw = Math.max(1, b.x1 - b.x0), hh = Math.max(1, b.y1 - b.y0);
        // The face landmarks run forehead→chin and cheek→cheek. A whole human head is bigger:
        // skull + hair above (~0.5 face-heights), beard/jaw below (~0.25), ears at the sides.
        scale = Math.max(f.w * 1.38 / hw, f.h * 1.75 / hh) * (s.size || 1);
        anchorN = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        // centre above the face centre so the extra coverage goes to the top of the head
        const up = f.h * 0.13;
        anchorS = [f.cx + R[3] * up, f.cy - R[4] * up]; // along the head's "up" direction
        unit = f.h;
      }
      const ox = (s.offX || 0) * unit * 0.5, oy = (s.offY || 0) * unit * 0.5;
      const off = [R[0] * ox + R[3] * oy, R[1] * ox + R[4] * oy];
      const D = s.H / 2 / Math.tan(10 * Math.PI / 180); // narrow lens = less stretching

      gl.useProgram(this.prog);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);

      gl.uniform1i(L.u_tex, 0);
      gl.uniform2f(L.u_anchorN, anchorN[0], anchorN[1]);
      gl.uniform2f(L.u_headC, g.headC[0], g.headC[1]);
      gl.uniform2f(L.u_headR, g.headR[0], g.headR[1]);
      gl.uniform2f(L.u_anchorS, anchorS[0] - s.W / 2 + off[0], s.H / 2 - anchorS[1] + off[1]);
      gl.uniform2f(L.u_res, s.W, s.H);
      gl.uniform1f(L.u_depth, s.depth ?? 0.35);
      gl.uniform1f(L.u_scale, scale);
      gl.uniform1f(L.u_D, D);
      gl.uniformMatrix3fv(L.u_rot, false, new Float32Array(R));
      gl.uniform2f(L.u_size, this.w, this.h);
      gl.uniform2f(L.u_eL, g.eL[0], g.eL[1]);
      gl.uniform2f(L.u_eR, g.eR[0], g.eR[1]);
      gl.uniform2f(L.u_er, g.er[0], g.er[1]);
      gl.uniform2f(L.u_m, g.m[0], g.m[1]);
      gl.uniform1f(L.u_mw, g.mw);
      gl.uniform1f(L.u_mh, g.mh);
      gl.uniform2f(L.u_blink, e.blinkL || 0, e.blinkR || 0);
      gl.uniform1f(L.u_jaw, Math.max(e.jaw || 0, e.open || 0));
      gl.uniform2f(L.u_teeth, e.teethU || 0, e.teethL || 0);
      gl.uniform1f(L.u_tongue, e.tongue || 0);
      if (e.lips) {
        gl.uniform1f(L.u_lipOn, 1);
        gl.uniform1fv(L['u_lipUp[0]'] || L.u_lipUp, new Float32Array(e.lips.up));
        gl.uniform1fv(L['u_lipLo[0]'] || L.u_lipLo, new Float32Array(e.lips.lo));
        gl.uniform1f(L.u_lipW, e.lips.w || 1);
        // small cartoon mouths get a slightly bigger opening so it stays readable
        gl.uniform1f(L.u_lipK, Math.min(2.4, Math.max(1.1, 0.75 * g.mh / Math.max(1, g.mw))));
      } else gl.uniform1f(L.u_lipOn, 0);
      gl.uniform2f(L.u_smile, e.smileL || 0, e.smileR || 0);
      gl.uniform1f(L.u_pucker, e.pucker || 0);
      gl.uniform2f(L.u_brow, e.browL || 0, e.browR || 0);
      gl.uniform2f(L.u_gaze, e.gazeX || 0, e.gazeY || 0);
      gl.uniform3f(L.u_lid, this.lid[0], this.lid[1], this.lid[2]);
      gl.uniform1f(L.u_opacity, s.opacity);
      gl.uniform1f(L.u_oval, s.oval ? 1 : 0);
      const cut = s.headOnly && b ? (this.hasAlpha && !s.oval ? 1 : 2) : 0;
      gl.uniform1f(L.u_cut, cut);
      gl.uniform1f(L.u_crop, s.crop || 1);
      gl.uniform4f(L.u_box, b ? b.x0 : 0, b ? b.y0 : 0, b ? b.x1 : 0, b ? b.y1 : 0);
      gl.uniform1f(L.u_chin, b ? b.y1 : 0);
      gl.uniform1f(L.u_fade, b ? Math.max(1.5, b.em * 0.12) : 1);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  Avatar2D.mul3 = mul3; Avatar2D.rotZ = rotZ;
  FC.Avatar2D = Avatar2D;
})();
