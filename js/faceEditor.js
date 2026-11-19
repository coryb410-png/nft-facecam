/* "Set face points" editor: tell the app where the NFT's eyes and mouth are.
 * Guided mode asks you to tap left eye → right eye → mouth (easy on a phone),
 * then you can fine-tune by dragging. */
(function () {
  const COLORS = { eL: '#22f0d0', eR: '#ff4fd8', m: '#ffd23f' };
  const STEPS = [
    { key: 'eL', text: 'Tap your NFT’s <b>left eye</b> (the one on the left of the picture). Visor or glasses? Tap where the eye would be.' },
    { key: 'eR', text: 'Now tap the <b>right eye</b>' },
    { key: 'm', text: 'Now tap the <b>mouth</b> (the middle of it)' }
  ];

  class FaceEditor {
    constructor(app) {
      this.app = app;
      this.modal = document.getElementById('editor');
      this.cv = document.getElementById('edCanvas');
      this.ctx = this.cv.getContext('2d');
      this.prevCanvas = document.getElementById('edPreview');
      this.lidInput = document.getElementById('edLid');
      this.guide = document.getElementById('edGuide');
      this.drag = null; this.anim = null; this.step = -1;
      this.bind();
    }

    // canvas pixels per screen pixel (so handles stay finger-sized on any image)
    k() { const r = this.cv.getBoundingClientRect(); return r.width ? this.cv.width / r.width : 1; }

    bind() {
      const $ = (id) => document.getElementById(id);
      const pos = (e) => {
        const r = this.cv.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width * this.cv.width, (e.clientY - r.top) / r.height * this.cv.height];
      };
      this.cv.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        if (this.step >= 0) { this.place(x, y); return; }
        const hit = this.hit(x, y);
        if (hit) { this.drag = hit; this.cv.setPointerCapture(e.pointerId); }
      });
      this.cv.addEventListener('pointermove', (e) => {
        const [x, y] = pos(e);
        if (!this.drag) { this.cv.style.cursor = this.step >= 0 ? 'crosshair' : this.hit(x, y) ? 'grab' : 'default'; return; }
        const p = this.pts, w = this.cv.width, h = this.cv.height;
        const nx = FC.util.clamp(x / w), ny = FC.util.clamp(y / h);
        if (this.drag === 'eL' || this.drag === 'eR' || this.drag === 'm') p[this.drag] = [nx, ny];
        else if (this.drag === 'eyeSize') { p.erx = Math.max(0.008, Math.abs(nx - p.eL[0])); p.ery = Math.max(0.006, Math.abs(ny - p.eL[1])); }
        else if (this.drag === 'mouthSize') p.mw = Math.max(0.01, Math.abs(nx - p.m[0]));
        this.draw(); this.updatePreview();
      });
      const end = () => { this.drag = null; };
      this.cv.addEventListener('pointerup', end); this.cv.addEventListener('pointercancel', end);

      $('edClose').onclick = () => this.close();
      $('edSave').onclick = () => this.save();
      $('edGuided').onclick = () => this.startGuided();
      $('edReset').onclick = () => { this.pts = FC.imageProcess.defaultPoints(this.cv.width, this.cv.height); this.endGuided(); this.draw(); this.updatePreview(); };
      $('edAuto').onclick = () => this.autoDetect();
      $('edLidAuto').onclick = () => { this.lid = FC.imageProcess.sampleLidColor(this.img, this.pts); this.lidInput.value = this.lid; this.updatePreview(); };
      this.lidInput.oninput = () => { this.lid = this.lidInput.value; this.updatePreview(); };
      $('edHeadOnly').onchange = (e) => { this.opts.headOnly = e.target.checked; this.syncOpts(); };
      $('edCrop').oninput = (e) => { this.opts.crop = +e.target.value; this.syncOpts(); };
      $('edChin').oninput = (e) => { this.opts.chin = +e.target.value; this.syncOpts(); };
      $('edFit').onchange = (e) => { this.opts.fit = e.target.checked; };
      $('edEyes').onchange = (e) => { this.opts.eyes = e.target.checked; };
      $('edMouth').onchange = (e) => { this.opts.mouth = e.target.checked; };
      this.modal.addEventListener('pointerdown', (e) => { if (e.target === this.modal) this.close(); });
    }

    syncOpts() {
      const $ = (id) => document.getElementById(id);
      $('edHeadOnly').checked = !!this.opts.headOnly;
      $('edCrop').value = this.opts.crop;
      $('edCropOut').textContent = Math.round(this.opts.crop * 100) + '%';
      $('edChin').value = this.opts.chin;
      $('edChinOut').textContent = this.opts.chin < 0.7 ? 'high' : this.opts.chin > 1.4 ? 'low' : 'chin';
      $('edCropRow').style.display = $('edChinRow').style.display = this.opts.headOnly ? '' : 'none';
      $('edFit').checked = this.opts.fit !== false;
      this.updateHead();
      $('edEyes').checked = this.opts.eyes !== false;
      $('edMouth').checked = this.opts.mouth !== false;
      this.draw();
    }

    startGuided() {
      this.step = 0; this.drag = null;
      this.showGuide();
      this.draw();
    }
    endGuided() { this.step = -1; this.guide.classList.remove('show'); }
    showGuide() {
      const st = STEPS[this.step];
      this.guide.innerHTML = `<i style="background:${COLORS[st.key]}"></i>Step ${this.step + 1} of 3 — ${st.text}`;
      this.guide.classList.add('show');
    }
    place(x, y) {
      const w = this.cv.width, h = this.cv.height, p = this.pts;
      const st = STEPS[this.step];
      p[st.key] = [FC.util.clamp(x / w), FC.util.clamp(y / h)];
      if (st.key === 'eR') {
        // keep "left" as the one on the left of the picture
        if (p.eR[0] < p.eL[0]) [p.eL, p.eR] = [p.eR, p.eL];
        const d = Math.hypot((p.eR[0] - p.eL[0]) * w, (p.eR[1] - p.eL[1]) * h);
        p.erx = Math.max(0.01, d * 0.2 / w); p.ery = Math.max(0.008, d * 0.15 / h);
      }
      if (st.key === 'm') {
        const d = Math.hypot((p.eR[0] - p.eL[0]) * w, (p.eR[1] - p.eL[1]) * h);
        p.mw = Math.max(0.012, d * 0.32 / w);
      }
      this.step++;
      if (this.step >= STEPS.length) {
        this.endGuided();
        this.lid = FC.imageProcess.sampleLidColor(this.img, p); this.lidInput.value = this.lid;
        this.guide.innerHTML = '✅ Done! Check the preview. Drag the dots to fine-tune, then tap <b>Save</b>.';
        this.guide.classList.add('show');
      } else this.showGuide();
      this.draw(); this.updatePreview();
    }

    hit(x, y) {
      const p = this.pts, w = this.cv.width, h = this.cv.height;
      const r = 24 * this.k();
      const near = (a, b) => Math.hypot(a - x, b - y) < r;
      if (near((p.eL[0] + p.erx) * w, (p.eL[1] + p.ery) * h)) return 'eyeSize';
      if (near((p.m[0] + p.mw) * w, p.m[1] * h)) return 'mouthSize';
      for (const k of ['eL', 'eR', 'm']) if (near(p[k][0] * w, p[k][1] * h)) return k;
      return null;
    }

    /** guided: start with the tap-the-points flow */
    open(rec, img, guided) {
      this.rec = rec; this.img = img;
      this.cv.width = img.width; this.cv.height = img.height;
      this.pts = JSON.parse(JSON.stringify(rec.points || FC.imageProcess.defaultPoints(img.width, img.height)));
      this.opts = { ...FC.AVATAR_OPTS, ...(rec.opts && rec.opts.v === 2 ? rec.opts : {}) };
      this.lid = rec.lidColor || FC.imageProcess.sampleLidColor(img, this.pts);
      this.lidInput.value = this.lid;
      this.modal.classList.add('show');
      try {
        if (!this.preview) this.preview = new FC.Avatar2D(this.prevCanvas);
        this.preview.setAvatar(img, this.pts, this.lid);
      } catch (e) { console.warn(e); }
      this.guide.classList.remove('show');
      if (guided) this.startGuided(); else this.endGuided();
      this.syncOpts();
      requestAnimationFrame(() => this.draw()); // re-draw once laid out (handle sizes)
      this.startPreview();
    }

    close() { this.endGuided(); this.modal.classList.remove('show'); cancelAnimationFrame(this.anim); this.anim = null; }

    async autoDetect() {
      const btn = document.getElementById('edAuto');
      btn.disabled = true; btn.textContent = 'Detecting…';
      try {
        const lm = await this.app.tracker.detectInImage(this.img);
        if (lm) {
          this.pts = FC.imageProcess.pointsFromLandmarks(lm, this.img.width, this.img.height);
          this.lid = FC.imageProcess.sampleLidColor(this.img, this.pts); this.lidInput.value = this.lid;
          this.endGuided();
          FC.util.toast('Face found! Fine-tune the dots if needed.', 'ok');
        } else {
          FC.util.toast("Couldn't find the face automatically (common for cartoon characters) — just tap the points.", 'info', 5000);
          this.startGuided();
        }
      } catch (e) { FC.util.toast('Auto-detect needs an internet connection the first time: ' + e.message, 'error'); }
      btn.disabled = false; btn.textContent = '✨ Auto-detect face';
      this.draw(); this.updatePreview();
    }

    save() {
      this.rec.points = this.pts; this.rec.lidColor = this.lid; this.rec.opts = { ...this.opts }; this.rec.pointsSet = true;
      this.app.onPointsSaved(this.rec);
      this.close();
    }

    draw() {
      const { ctx, cv, pts: p } = this;
      if (!this.img) return;
      const w = cv.width, h = cv.height, k = this.k(), lw = 2 * k;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(this.img, 0, 0);
      // head-only crop preview
      if (this.opts && this.opts.headOnly && this.box && this.step < 0) {
        const b = this.box, c = this.opts.crop;
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hx = (b.x1 - b.x0) / 2 * c, hy = (b.y1 - b.y0) / 2 * c;
        ctx.save();
        ctx.fillStyle = 'rgba(7,6,15,.72)';
        ctx.beginPath(); ctx.rect(0, 0, w, h);
        if (this.hasAlpha) { const sx = hx * 1.3; ctx.rect(cx + sx, b.y1, -2 * sx, -b.y1); } // keep everything above the neck cut
        else ctx.ellipse(cx, cy, hx * 1.1, hy * 1.1, 0, 0, 7, true);
        ctx.fill('evenodd');
        ctx.setLineDash([8 * k, 6 * k]); ctx.lineWidth = 2 * k; ctx.strokeStyle = '#22f0d0';
        ctx.beginPath(); ctx.moveTo(0, b.y1); ctx.lineTo(w, b.y1); ctx.stroke();
        ctx.restore();
      }
      const set = (key) => this.step < 0 || STEPS.findIndex(s => s.key === key) < this.step;
      const dot = (x, y, c) => {
        ctx.beginPath(); ctx.arc(x, y, 10 * k, 0, 7); ctx.fillStyle = c; ctx.fill();
        ctx.lineWidth = lw * 1.5; ctx.strokeStyle = '#0b0918'; ctx.stroke();
      };
      const sq = (x, y) => { const s = 16 * k; ctx.fillStyle = '#fff'; ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.lineWidth = lw; ctx.strokeStyle = '#0b0918'; ctx.strokeRect(x - s / 2, y - s / 2, s, s); };
      ctx.lineWidth = lw;
      for (const key of ['eL', 'eR']) {
        if (!set(key)) continue;
        ctx.beginPath(); ctx.ellipse(p[key][0] * w, p[key][1] * h, p.erx * w, p.ery * h, 0, 0, 7);
        ctx.strokeStyle = COLORS[key]; ctx.setLineDash([lw * 3, lw * 2]); ctx.stroke(); ctx.setLineDash([]);
        dot(p[key][0] * w, p[key][1] * h, COLORS[key]);
      }
      if (set('m')) {
        ctx.beginPath(); ctx.moveTo((p.m[0] - p.mw) * w, p.m[1] * h); ctx.lineTo((p.m[0] + p.mw) * w, p.m[1] * h);
        ctx.strokeStyle = COLORS.m; ctx.lineWidth = lw * 2; ctx.stroke();
        dot(p.m[0] * w, p.m[1] * h, COLORS.m);
      }
      if (this.step < 0) { sq((p.eL[0] + p.erx) * w, (p.eL[1] + p.ery) * h); sq((p.m[0] + p.mw) * w, p.m[1] * h); }
    }

    updateHead() {
      if (!this.img || !this.pts) return;
      this.hasAlpha = this.app.cache[this.rec.id] ? this.app.cache[this.rec.id].hasAlpha : false;
      this.box = FC.imageProcess.headBox(this.img, this.pts, this.opts.chin, this.hasAlpha);
      if (this.preview && this.preview.ready) this.preview.setHead(this.box, this.hasAlpha);
    }
    updatePreview() { if (this.preview && this.preview.ready) { this.preview.setPoints(this.pts, this.lid); this.updateHead(); this.draw(); } }

    startPreview() {
      const t0 = performance.now();
      const tick = () => {
        if (!this.preview || !this.preview.ready) return;
        const t = (performance.now() - t0) / 1000;
        const g = this.preview.g, W = 400, H = 400, o = this.opts;
        // frame the face (not the whole image) like it will look on camera
        const k = 120 / g.sN * 0.8;
        const yaw = Math.sin(t * 0.9) * 0.35;
        const R = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 1, 0, Math.sin(yaw), 0, Math.cos(yaw)];
        const ph = t % 2.6;
        const blink = o.eyes === false ? 0 : ph < 0.18 ? Math.sin(ph / 0.18 * Math.PI) : 0;
        const talk = o.mouth === false ? 0 : Math.max(0, Math.sin(t * 7) * Math.sin(t * 1.3)) * 0.9;
        this.preview.render({
          W, H, R, opacity: 1, size: 1, depth: this.app.settings.depth,
          anchor: [W / 2, H / 2], faceSize: g.sN * k,
          headOnly: o.headOnly, crop: o.crop, fit: o.headOnly, face: { cx: W / 2, cy: H / 2 + 20, w: 150, h: 175 },
          expr: { blinkL: blink, blinkR: blink, jaw: talk, smileL: 0.2, smileR: 0.2, gazeX: o.eyes === false ? 0 : Math.sin(t * 0.7) * 0.6 }
        });
        this.anim = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(this.anim);
      this.anim = requestAnimationFrame(tick);
    }
  }
  FC.FaceEditor = FaceEditor;
})();
