/* Camera-frame compositor: draws the camera image with optional background
 * blur / replacement / green screen using on-device person segmentation. */
(function () {
  class Background {
    constructor(tracker) {
      this.tracker = tracker;
      this.maskCanvas = document.createElement('canvas');
      this.maskCtx = this.maskCanvas.getContext('2d');
      this.person = document.createElement('canvas');
      this.pctx = this.person.getContext('2d');
      this.bgImage = null; this.loading = false; this.seg = null; this.lastTs = -1;
      this.frame = 0; this.maskImage = null;
    }

    async ensure() {
      if (this.seg || this.loading) return;
      this.loading = true;
      try { this.seg = await this.tracker.segmenter(); }
      catch (e) { console.error(e); FC.util.toast('Background effects could not load: ' + e.message, 'error'); }
      this.loading = false;
    }

    updateMask(video, ts) {
      if (!this.seg) return;
      if (ts <= this.lastTs) ts = this.lastTs + 1;
      this.lastTs = ts;
      const r = this.seg.segmentForVideo(video, ts);
      const m = r && r.confidenceMasks && r.confidenceMasks[0];
      if (!m) return;
      const w = m.width, h = m.height, data = m.getAsFloat32Array();
      if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
        this.maskCanvas.width = w; this.maskCanvas.height = h;
        this.maskImage = this.maskCtx.createImageData(w, h);
      }
      const d = this.maskImage.data;
      for (let i = 0; i < data.length; i++) {
        const a = Math.min(1, Math.max(0, (data[i] - 0.25) / 0.5));
        d[i * 4 + 3] = a * 255;
      }
      this.maskCtx.putImageData(this.maskImage, 0, 0);
      if (r.close) r.close(); else m.close && m.close();
    }

    drawVideo(ctx, video, W, H, mirror, filter) {
      ctx.save();
      if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      if (filter) ctx.filter = filter;
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    }

    drawCover(ctx, img, W, H) {
      const iw = img.width, ih = img.height, k = Math.max(W / iw, H / ih);
      ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    }

    /** opts: {mode:'none'|'blur'|'image'|'green'|'dark', hideBody, mirror} */
    compose(ctx, video, W, H, opts, ts) {
      let mode = opts.mode || 'none';
      if (opts.hideBody && mode === 'none') mode = 'dark';
      if (mode === 'none' && !opts.hideBody) { this.drawVideo(ctx, video, W, H, opts.mirror); return; }
      if (!this.seg && !opts.hideBody) { this.ensure(); }

      // background layer
      if (mode === 'blur') this.drawVideo(ctx, video, W, H, opts.mirror, `blur(${Math.round(W / 70)}px)`);
      else if (mode === 'image' && this.bgImage) this.drawCover(ctx, this.bgImage, W, H);
      else if (mode === 'green') { ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, W, H); }
      else if (mode === 'dark' || mode === 'image') {
        const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.5, W * 0.75);
        g.addColorStop(0, '#2a1258'); g.addColorStop(0.55, '#0d0a24'); g.addColorStop(1, '#05040d');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      } else if (mode === 'none') this.drawVideo(ctx, video, W, H, opts.mirror);
      if (opts.hideBody) return;

      // person layer
      if (!this.seg) { if (mode === 'blur') return; this.drawVideo(ctx, video, W, H, opts.mirror); return; }
      if ((this.frame++ & 1) === 0 || !this.maskImage) this.updateMask(video, ts);
      if (this.person.width !== W || this.person.height !== H) { this.person.width = W; this.person.height = H; }
      const p = this.pctx;
      p.globalCompositeOperation = 'source-over';
      p.clearRect(0, 0, W, H);
      this.drawVideo(p, video, W, H, opts.mirror);
      p.globalCompositeOperation = 'destination-in';
      p.save();
      if (opts.mirror) { p.translate(W, 0); p.scale(-1, 1); }
      p.filter = 'blur(2px)';
      p.drawImage(this.maskCanvas, 0, 0, W, H);
      p.restore();
      p.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.person, 0, 0);
    }
  }
  FC.Background = Background;
})();
