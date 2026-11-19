/* Record clips and snap photos of the avatar feed, then share or save them.
 * Recording happens on-device; nothing is uploaded unless YOU share it. */
(function () {
  const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const MAX_MS = 3 * 60 * 1000;

  function pickType() {
    if (!window.MediaRecorder) return null;
    for (const t of TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* ignore */ } }
    return '';
  }

  class Recorder {
    constructor(canvas) { this.canvas = canvas; this.rec = null; this.mic = null; }
    get supported() { return !!(window.MediaRecorder && this.canvas.captureStream); }
    get recording() { return !!(this.rec && this.rec.state === 'recording'); }

    async start(withAudio) {
      if (!this.supported) throw new Error('Recording is not supported in this browser. Try Chrome or Safari 15+.');
      const stream = new MediaStream(this.canvas.captureStream(30).getVideoTracks());
      if (withAudio) {
        try {
          this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          this.mic.getAudioTracks().forEach(t => stream.addTrack(t));
        } catch (e) { FC.util.toast('Microphone not available — recording without sound.', 'info'); }
      }
      const type = pickType();
      this.type = type || 'video/webm';
      const opts = { videoBitsPerSecond: 4_000_000 };
      if (type) opts.mimeType = type;
      this.chunks = [];
      this.rec = new MediaRecorder(stream, opts);
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.done = new Promise(res => { this.rec.onstop = () => res(); });
      this.rec.start(500);
      this.t0 = performance.now();
      this.limit = setTimeout(() => this.onLimit && this.onLimit(), MAX_MS);
    }

    async stop() {
      clearTimeout(this.limit);
      if (!this.rec) return null;
      if (this.rec.state !== 'inactive') this.rec.stop();
      await this.done;
      this.rec.stream.getTracks().forEach(t => t.stop());
      if (this.mic) { this.mic.getTracks().forEach(t => t.stop()); this.mic = null; }
      this.rec = null;
      const mime = (this.type || 'video/webm').split(';')[0];
      return new Blob(this.chunks, { type: mime });
    }

    elapsed() { return this.recording ? performance.now() - this.t0 : 0; }

    snap() {
      return new Promise((res, rej) => this.canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not take photo'))), 'image/png'));
    }
  }

  // Show the result with Share / Download buttons.
  function showResult(blob, kind) {
    const modal = document.getElementById('result');
    const media = document.getElementById('resultMedia');
    const ext = kind === 'photo' ? 'png' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
    const name = `${FC.config.APP_NAME.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    const file = new File([blob], name, { type: blob.type });
    const url = URL.createObjectURL(blob);
    if (showResult.url) URL.revokeObjectURL(showResult.url);
    showResult.url = url;
    media.innerHTML = kind === 'photo' ? `<img src="${url}" alt="Photo">` : `<video src="${url}" controls playsinline loop autoplay muted></video>`;
    document.getElementById('resultTitle').textContent = kind === 'photo' ? 'Your photo' : 'Your clip';
    const dl = document.getElementById('resultDownload');
    dl.href = url; dl.download = name;
    const share = document.getElementById('resultShare');
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    share.hidden = !canShare;
    share.onclick = async () => {
      try { await navigator.share({ files: [file], title: FC.config.APP_NAME }); }
      catch (e) { if (e.name !== 'AbortError') FC.util.toast('Sharing failed — use Download instead.', 'error'); }
    };
    document.getElementById('resultNote').textContent = canShare
      ? (kind === 'photo' ? 'Tap Share / Save, then "Save Image" to put it in your Photos, or pick an app to post it.' : 'Tap Share / Save, then "Save Video" to put it in your Photos, or pick an app to post it.')
      : 'Saved files go to your Downloads folder.';
    if (ext === 'webm' && /iPhone|iPad|Macintosh/.test(navigator.userAgent)) document.getElementById('resultNote').textContent += ' (WebM video — convert to MP4 if an app won\'t accept it.)';
    modal.classList.add('show');
  }

  FC.Recorder = Recorder;
  FC.showResult = showResult;
})();
