/* Streaming output: a clean pop-out window (for OBS Window Capture → OBS Virtual
 * Camera → Zoom / Discord / Meet / Twitch) and a frame clock that keeps running
 * when this window is in the background. */
(function () {
  // A timer that keeps ticking when the tab is hidden (requestAnimationFrame pauses).
  class FrameClock {
    constructor(fn) {
      this.fn = fn; this.running = false; this.worker = null;
      try {
        const src = 'let t=null;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
        this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        this.worker.onmessage = () => { if (this.running && document.hidden) this.fn(); };
      } catch (e) { this.worker = null; }
      document.addEventListener('visibilitychange', () => this.sync());
    }
    start() { if (this.running) return; this.running = true; this.sync(); this.loop(); }
    stop() { this.running = false; if (this.worker) this.worker.postMessage(0); clearInterval(this.fallback); }
    sync() {
      if (!this.running) return;
      if (this.worker) this.worker.postMessage(document.hidden ? 33 : 0);
      else { clearInterval(this.fallback); if (document.hidden) this.fallback = setInterval(() => this.fn(), 33); }
    }
    loop() {
      if (!this.running) return;
      if (!document.hidden) this.fn();
      requestAnimationFrame(() => this.loop());
    }
  }

  class Output {
    constructor(canvas) { this.canvas = canvas; this.win = null; this.stream = null; }

    popout() {
      const title = FC.config.OUTPUT_WINDOW_TITLE;
      const w = window.open('', 'nftfacecam_output', `width=${this.canvas.width / 1.5 | 0},height=${this.canvas.height / 1.5 | 0},menubar=no,toolbar=no,location=no,status=no`);
      if (!w) { FC.util.toast('Your browser blocked the pop-up. Allow pop-ups for this page, or use Clean mode.', 'error', 6000); return false; }
      try {
        w.document.open();
        w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}</style></head><body><video autoplay muted playsinline></video></body></html>`);
        w.document.close();
        if (!this.stream) this.stream = this.canvas.captureStream(30);
        const v = w.document.querySelector('video');
        v.srcObject = this.stream;
        v.play().catch(() => {});
        this.win = w;
        return true;
      } catch (e) {
        console.error(e);
        w.close();
        FC.util.toast('Pop-out window is not supported here — use Clean mode instead.', 'error', 6000);
        return false;
      }
    }
    get open() { return !!(this.win && !this.win.closed); }
    close() { if (this.open) this.win.close(); this.win = null; }
  }

  FC.FrameClock = FrameClock;
  FC.Output = Output;
})();
