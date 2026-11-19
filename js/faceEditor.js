/* "Set face points" editor: tell the app where the NFT's eyes and mouth are. */
(function () {
  const COLORS = { eL: '#22f0d0', eR: '#ff4fd8', m: '#ffd23f' };

  class FaceEditor {
    constructor(app) {
      this.app = app;
      this.modal = document.getElementById('editor');
      this.cv = document.getElementById('edCanvas');
      this.ctx = this.cv.getContext('2d');
      this.prevCanvas = document.getElementById('edPreview');
      this.lidInput = document.getElementById('edLid');
      this.drag = null; this.anim = null;
      this.bind();
    }

    bind() {
      const pos = (e) => {
        const r = this.cv.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width * this.cv.width, (e.clientY - r.top) / r.height * this.cv.height];
      };
      this.cv.addEventListener('pointerdown', (e) => {
        const [x, y] = pos(e);
        const hit = this.hit(x, y);
        if (hit) { this.drag = hit; this.cv.setPointerCapture(e.pointerId); }
      });
      this.cv.addEventListener('pointermove', (e) => {
        const [x, y] = pos(e);
        if (!this.drag) { this.cv.style.cursor = this.hit(x, y) ? 'grab' : 'crosshair'; return; }
        const p = this.pts, w = this.cv.width, h = this.cv.height;
        const nx = FC.util.clamp(x / w), ny = FC.util.clamp(y / h);
        if (this.drag === 'eL' || this.drag === 'eR' || this.drag === 'm') p[this.drag] = [nx, ny];
        else if (this.drag === 'eyeSize') { p.erx = Math.max(0.008, Math.abs(nx - p.eL[0])); p.ery = Math.max(0.006, Math.abs(ny - p.eL[1])); }
        else if (this.drag === 'mouthSize') p.mw = Math.max(0.01, Math.abs(nx - p.m[0]));
        this.draw(); this.updatePreview();
      });
      const end = () => { this.drag = null; };
      this.cv.addEventListener('pointerup', end); this.cv.addEventListener('pointercancel', end);

      document.getElementById('edClose').onclick = () => this.close();
      document.getElementById('edSave').onclick = () => this.save();
      document.getElementById('edReset').onclick = () => { this.pts = FC.imageProcess.defaultPoints(this.cv.width, this.cv.height); this.draw(); this.updatePreview(); };
      document.getElementById('edAuto').onclick = () => this.autoDetect();
      document.getElementById('edLidAuto').onclick = () => { this.lid = FC.imageProcess.sampleLidColor(this.img, this.pts); this.lidInput.value = this.lid; this.updatePreview(); };
      this.lidInput.oninput = () => { this.lid = this.lidInput.value; this.updatePreview(); };
      this.modal.addEventListener('pointerdown', (e) => { if (e.target === this.modal) this.close(); });
    }

    hit(x, y) {
      const p = this.pts, w = this.cv.width, h = this.cv.height;
      const r = Math.max(w, h) * 0.03;
      const near = (a, b) => Math.hypot(a - x, b - y) < r;
      if (near((p.eL[0] + p.erx) * w, (p.eL[1] + p.ery) * h)) return 'eyeSize';
      if (near((p.m[0] + p.mw) * w, p.m[1] * h)) return 'mouthSize';
      for (const k of ['eL', 'eR', 'm']) if (near(p[k][0] * w, p[k][1] * h)) return k;
      return null;
    }

    open(rec, img) {
      this.rec = rec; this.img = img;
      this.cv.width = img.width; this.cv.height = img.height;
      this.pts = JSON.parse(JSON.stringify(rec.points || FC.imageProcess.defaultPoints(img.width, img.height)));
      this.lid = rec.lidColor || FC.imageProcess.sampleLidColor(img, this.pts);
      this.lidInput.value = this.lid;
      this.modal.classList.add('show');
      try {
        if (!this.preview) this.preview = new FC.Avatar2D(this.prevCanvas);
        this.preview.setAvatar(img, this.pts, this.lid);
      } catch (e) { console.warn(e); }
      this.draw();
      this.startPreview();
    }

    close() { this.modal.classList.remove('show'); cancelAnimationFrame(this.anim); this.anim = null; }

    async autoDetect() {
      const btn = document.getElementById('edAuto');
      btn.disabled = true; btn.textContent = 'Detecting…';
      try {
        const lm = await this.app.tracker.detectInImage(this.img);
        if (lm) {
          this.pts = FC.imageProcess.pointsFromLandmarks(lm, this.img.width, this.img.height);
          this.lid = FC.imageProcess.sampleLidColor(this.img, this.pts); this.lidInput.value = this.lid;
          FC.util.toast('Face found! Fine-tune the markers if needed.', 'ok');
        } else FC.util.toast("Couldn't find a face automatically — drag the markers onto the eyes and mouth.", 'info', 5000);
      } catch (e) { FC.util.toast('Auto-detect needs an internet connection the first time: ' + e.message, 'error'); }
      btn.disabled = false; btn.textContent = '✨ Auto-detect face';
      this.draw(); this.updatePreview();
    }

    save() {
      this.rec.points = this.pts; this.rec.lidColor = this.lid;
      this.app.onPointsSaved(this.rec);
      this.close();
    }

    draw() {
      const { ctx, cv, pts: p } = this;
      const w = cv.width, h = cv.height, lw = Math.max(2, w / 260);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(this.img, 0, 0);
      ctx.lineWidth = lw;
      const dot = (x, y, c, r = Math.max(6, w / 90)) => {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = c; ctx.fill();
        ctx.lineWidth = lw; ctx.strokeStyle = '#0b0918'; ctx.stroke();
      };
      const sq = (x, y, c) => { const s = Math.max(9, w / 70); ctx.fillStyle = c; ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.strokeStyle = '#0b0918'; ctx.strokeRect(x - s / 2, y - s / 2, s, s); };
      for (const k of ['eL', 'eR']) {
        ctx.beginPath(); ctx.ellipse(p[k][0] * w, p[k][1] * h, p.erx * w, p.ery * h, 0, 0, 7);
        ctx.strokeStyle = COLORS[k]; ctx.setLineDash([lw * 3, lw * 2]); ctx.stroke(); ctx.setLineDash([]);
        dot(p[k][0] * w, p[k][1] * h, COLORS[k]);
      }
      ctx.beginPath(); ctx.moveTo((p.m[0] - p.mw) * w, p.m[1] * h); ctx.lineTo((p.m[0] + p.mw) * w, p.m[1] * h);
      ctx.strokeStyle = COLORS.m; ctx.lineWidth = lw * 1.5; ctx.stroke();
      dot(p.m[0] * w, p.m[1] * h, COLORS.m);
      sq((p.eL[0] + p.erx) * w, (p.eL[1] + p.ery) * h, '#ffffff');
      sq((p.m[0] + p.mw) * w, p.m[1] * h, '#ffffff');
    }

    updatePreview() { if (this.preview && this.preview.ready) this.preview.setPoints(this.pts, this.lid); }

    startPreview() {
      const t0 = performance.now();
      const tick = () => {
        if (!this.preview || !this.preview.ready) return;
        const t = (performance.now() - t0) / 1000;
        const g = this.preview.g, W = 400, H = 400;
        const k = 340 / Math.max(this.img.width, this.img.height);
        const yaw = Math.sin(t * 0.9) * 0.35;
        const R = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 1, 0, Math.sin(yaw), 0, Math.cos(yaw)];
        const ph = t % 2.6;
        const blink = ph < 0.18 ? Math.sin(ph / 0.18 * Math.PI) : 0;
        const talk = Math.max(0, Math.sin(t * 7) * Math.sin(t * 1.3)) * 0.9;
        this.preview.render({
          W, H, R, opacity: 1, size: 1, depth: this.app.settings.depth,
          anchor: [W / 2 + (g.anchor[0] - this.img.width / 2) * k, H / 2 + (g.anchor[1] - this.img.height / 2) * k],
          faceSize: g.sN * k,
          expr: { blinkL: blink, blinkR: blink, jaw: talk, smileL: 0.2, smileR: 0.2, gazeX: Math.sin(t * 0.7) * 0.6 }
        });
        this.anim = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(this.anim);
      this.anim = requestAnimationFrame(tick);
    }
  }
  FC.FaceEditor = FaceEditor;
})();
