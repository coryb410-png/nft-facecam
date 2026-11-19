/* NFT FaceCam — main app controller */
(function () {
  const { toast, loadImage, uid, clamp } = FC.util;
  const $ = (id) => document.getElementById(id);
  const IS_MOBILE = document.documentElement.classList.contains('mobile');

  const DEFAULTS = {
    size: 1, offX: 0, offY: 0, roll: 0, smoothing: 0.5, exprGain: 1, depth: 0.35, oval: false,
    mirror: true, bg: 'none', hideBody: false, res: IS_MOBILE ? '640x480' : '1280x720', facing: 'user', recAudio: true, cameraId: '', avatarId: 'demo-neon-cat',
    showFps: false, holdOnLost: true, builtinOverrides: {}
  };
  const ADJ_KEYS = ['size', 'offX', 'offY', 'roll', 'smoothing', 'exprGain', 'depth'];
  const FMT = {
    size: v => Math.round(v * 100) + '%', offX: v => (v > 0 ? '+' : '') + Math.round(v * 100), offY: v => (v > 0 ? '+' : '') + Math.round(v * 100),
    roll: v => (v > 0 ? '+' : '') + v + '°', smoothing: v => Math.round(v * 100) + '%', exprGain: v => Math.round(v * 100) + '%', depth: v => Math.round(v * 100) + '%'
  };

  class App {
    constructor() {
      this.settings = FC.storage.settings.load(DEFAULTS);
      this.tracker = new FC.Tracker();
      this.trackerP = null;
      this.solver = new FC.PoseSolver();
      this.out = $('out');
      this.outCtx = this.out.getContext('2d');
      this.video = $('video');
      this.bg = new FC.Background(this.tracker);
      this.output = new FC.Output(this.out);
      this.clock = new FC.FrameClock(() => this.frame());
      this.av2 = new FC.Avatar2D(document.createElement('canvas'));
      this.av3 = null;
      this.mode = '2d';
      this.records = [];
      this.cache = {}; // id -> {url, img, prepared}
      this.stream = null; this.devices = [];
      this.fpsT = performance.now(); this.fpsN = 0;
      this.editor = new FC.FaceEditor(this);
      this.recorder = new FC.Recorder(this.out);
    }

    save() { FC.storage.settings.save(this.settings); }

    async init() {
      const name = FC.config.APP_NAME;
      document.title = name; $('appName').textContent = name; $('heroTitle').textContent = FC.config.TAGLINE;
      this.bindUI();
      if (IS_MOBILE) $('camBtn').querySelector('.lbl').textContent = 'Start';
      this.renderObsSteps();
      $('chainChips').innerHTML = FC.config.WALLET_CHAINS.map(c => `<span class="chip">${c}</span>`).join('');

      const demos = FC.demoAvatars.map(d => {
        const o = this.settings.builtinOverrides[d.id] || {};
        return { ...d, points: o.points || d.points, lidColor: o.lidColor || d.lidColor };
      });
      const mine = await FC.storage.avatars.list();
      this.records = [...mine, ...demos];
      this.renderCollection();
      const start = this.records.find(r => r.id === this.settings.avatarId) || demos[0];
      await this.selectAvatar(start.id);
    }

    /* ---------------- avatars ---------------- */
    rec(id) { return this.records.find(r => r.id === id); }

    asset(rec) {
      if (!this.assetP) this.assetP = {};
      if (this.assetP[rec.id]) return this.assetP[rec.id];
      const blob = rec.svg ? new Blob([rec.svg], { type: 'image/svg+xml' }) : rec.blob;
      const url = URL.createObjectURL(blob);
      const c = { url };
      this.cache[rec.id] = c;
      const p = (rec.kind === 'image' ? loadImage(url).then(img => { c.img = img; return c; }) : Promise.resolve(c));
      this.assetP[rec.id] = p.catch(e => { delete this.assetP[rec.id]; delete this.cache[rec.id]; throw e; });
      return this.assetP[rec.id];
    }

    prepare(rec, c) {
      const p = FC.imageProcess.prepare(c.img, rec.removeBg);
      c.prepared = p.canvas; c.bgDetected = p.bgDetected; c.removeBg = p.removeBg; c.risky = p.risky;
      return c;
    }

    async selectAvatar(id, opts = {}) {
      const rec = this.rec(id);
      if (!rec) return;
      try {
        const c = await this.asset(rec);
        if (rec.kind === 'model') {
          this.setLoading('Loading 3D avatar…');
          if (!this.av3) this.av3 = new FC.Avatar3D(document.createElement('canvas'));
          const info = await this.av3.load(c.url);
          rec.info = info;
          this.mode = '3d';
          if (!info.morphCount) toast('3D model loaded. It has no facial blendshapes, so it will follow your head but not blink or talk.', 'info', 6000);
        } else {
          this.prepare(rec, c);
          if (!rec.points) rec.points = FC.imageProcess.defaultPoints(c.prepared.width, c.prepared.height);
          if (!rec.lidColor) rec.lidColor = FC.imageProcess.sampleLidColor(c.prepared, rec.points);
          this.av2.setAvatar(c.prepared, rec.points, rec.lidColor);
          this.mode = '2d';
        }
        this.current = rec;
        this.settings.avatarId = id; this.save();
        this.renderCurrent(); this.renderCollection();
        if (rec.kind === 'image' && !rec.builtin && !rec.pointsSet && !rec.promptedPoints && !opts.skipPrompt) {
          if (!rec.opts) rec.opts = { headOnly: true, crop: 1.25, eyes: true, mouth: true };
          this.promptPoints(rec);
        }
      } catch (e) {
        console.error(e);
        toast(rec.kind === 'model' ? '3D avatars need an internet connection the first time, and a valid .glb file: ' + e.message : e.message, 'error', 6000);
      } finally { this.setLoading(null); }
    }

    async addFile(file) {
      const isModel = /\.(glb|gltf)$/i.test(file.name) || /gltf/.test(file.type);
      if (!isModel && !/^image\//.test(file.type)) { toast('Please choose a PNG, JPG, WebP image or a .glb 3D model.', 'error'); return; }
      const rec = { id: uid(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'My NFT', kind: isModel ? 'model' : 'image', blob: file, created: Date.now(), points: null, removeBg: null, lidColor: null, opts: { headOnly: true, crop: 1.25, eyes: true, mouth: true } };
      await this.addRecord(rec);
    }

    async addRecord(rec) {
      if (rec.kind === 'image') {
        // validate it decodes before saving
        try { await loadImage(URL.createObjectURL(rec.blob)); } catch { toast('That image could not be read.', 'error'); return; }
      }
      await FC.storage.avatars.put(rec);
      this.records.unshift(rec);
      await this.selectAvatar(rec.id, { skipPrompt: true });
      toast(`Added "${rec.name}" to your collection`, 'ok');
      if (rec.kind === 'image') this.autoPoints(rec);
    }

    // Try to find the NFT's eyes & mouth automatically after upload.
    async autoPoints(rec) {
      try {
        await this.ensureTracker(false);
        const c = this.cache[rec.id];
        const lm = await this.tracker.detectInImage(c.prepared);
        if (lm) {
          rec.points = FC.imageProcess.pointsFromLandmarks(lm, c.prepared.width, c.prepared.height);
          rec.lidColor = FC.imageProcess.sampleLidColor(c.prepared, rec.points);
          this.onPointsSaved(rec, true);
          toast('Found the face in your NFT — blinking and talking are lined up.', 'ok');
          return;
        }
      } catch (e) { console.warn('auto-detect failed', e); }
      this.promptPoints(rec);
    }

    // Cartoon characters usually need a quick tap on the eyes & mouth.
    promptPoints(rec) {
      const c = this.cache[rec.id];
      if (!c || !c.prepared || rec.kind !== 'image') return;
      rec.promptedPoints = true;
      if (!rec.builtin) FC.storage.avatars.put(rec);
      this.closeSheet();
      toast('Quick setup: tap your NFT\'s eyes and mouth so it lines up with your face.', 'info', 6000);
      this.editor.open(rec, c.prepared, true);
    }

    onPointsSaved(rec, silent) {
      if (rec.builtin) {
        this.settings.builtinOverrides[rec.id] = { points: rec.points, lidColor: rec.lidColor }; this.save();
      } else FC.storage.avatars.put(rec);
      if (this.current && this.current.id === rec.id && this.mode === '2d') this.av2.setPoints(rec.points, rec.lidColor);
      if (!silent) toast('Face points saved', 'ok');
    }

    async importUrl(raw) {
      let url = raw.trim();
      if (!url) return;
      if (url.startsWith('ipfs://')) url = FC.config.IPFS_GATEWAY + url.slice(7).replace(/^ipfs\//, '');
      else if (url.startsWith('ar://')) url = FC.config.ARWEAVE_GATEWAY + url.slice(5);
      if (!/^https?:\/\//i.test(url)) { toast('Please paste a full link starting with https://, ipfs:// or ar://', 'error'); return; }
      this.setLoading('Importing…');
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const isModel = /\.(glb|gltf)(\?|$)/i.test(url) || /gltf/.test(blob.type);
        if (!isModel && !/^image\//.test(blob.type) && blob.type) throw new Error('That link is not an image');
        const name = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[^.]+$/, '').slice(0, 40) || 'Imported NFT';
        $('urlInput').value = '';
        await this.addRecord({ id: uid(), name, kind: isModel ? 'model' : 'image', blob, created: Date.now(), points: null, removeBg: null, lidColor: null, opts: { headOnly: true, crop: 1.25, eyes: true, mouth: true } });
      } catch (e) {
        console.warn(e);
        toast("Couldn't import that link (the site may block direct downloads). Save the image to your device and upload it instead.", 'error', 7000);
      } finally { this.setLoading(null); }
    }

    async removeRecord(id) {
      const rec = this.rec(id);
      if (!rec || rec.builtin) return;
      await FC.storage.avatars.remove(id);
      this.records = this.records.filter(r => r.id !== id);
      if (this.cache[id]) { URL.revokeObjectURL(this.cache[id].url); delete this.cache[id]; delete this.assetP[id]; }
      if (this.current && this.current.id === id) await this.selectAvatar(this.records[0].id);
      else this.renderCollection();
    }

    /* ---------------- camera ---------------- */
    async ensureTracker(showUi = true) {
      if (!this.trackerP) {
        this.trackerP = this.tracker.init().catch(e => { this.trackerP = null; throw e; });
      }
      if (showUi) this.setLoading('Loading face tracking… (first time only)');
      try { await this.trackerP; } finally { if (showUi) this.setLoading(null); }
    }

    async startCamera(deviceId) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Camera access is not available here. Open the app in Chrome, Edge or Firefox.', 'error', 7000); return;
      }
      this.stopCamera(true);
      let [w, h] = this.settings.res.split('x').map(Number);
      // phones held upright deliver portrait video — ask for it so the picture fills the screen
      if (IS_MOBILE && window.innerHeight > window.innerWidth) [w, h] = [h, w];
      const video = { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } };
      if (deviceId && !IS_MOBILE) video.deviceId = { exact: deviceId };
      else video.facingMode = { ideal: this.settings.facing || 'user' };
      this.setLoading('Waiting for camera permission…');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (e) {
        this.setLoading(null);
        const msg = e.name === 'NotAllowedError' ? 'Camera permission was blocked. Click the camera icon in the address bar to allow it, then try again.'
          : e.name === 'NotFoundError' ? 'No camera was found. Plug one in and try again.'
          : e.name === 'NotReadableError' ? 'Your camera is busy in another app (Zoom, OBS…). Close it there and try again.'
          : 'Could not start the camera: ' + e.message;
        toast(msg, 'error', 8000);
        return;
      }
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      const track = this.stream.getVideoTracks()[0];
      this.settings.cameraId = (track.getSettings && track.getSettings().deviceId) || deviceId || ''; this.save();
      await this.listCameras();
      this.setLive(true);
      try { await this.ensureTracker(true); }
      catch (e) {
        console.error(e);
        toast("Face tracking couldn't load. An internet connection is needed the first time. (" + e.message + ')', 'error', 9000);
      }
      if (this.settings.bg !== 'none' || this.settings.hideBody) this.bg.ensure();
      this.solver.reset();
      this.clock.start();
    }

    stopCamera(silent) {
      if (this.recorder.recording) this.toggleRecord();
      this.clock.stop();
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null; this.video.srcObject = null;
      if (!silent) { this.setLive(false); this.outCtx.clearRect(0, 0, this.out.width, this.out.height); }
    }

    async listCameras() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        this.devices = all.filter(d => d.kind === 'videoinput');
        $('camSelect').innerHTML = this.devices.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`).join('');
        $('camSelect').value = this.settings.cameraId;
        $('switchBtn').disabled = !IS_MOBILE && this.devices.length < 2;
      } catch { /* ignore */ }
    }

    switchCamera() {
      if (IS_MOBILE) {
        const s = this.settings;
        s.facing = s.facing === 'environment' ? 'user' : 'environment';
        s.mirror = s.facing === 'user';
        this.save(); this.syncControls(); this.solver.reset();
        toast(s.facing === 'user' ? 'Front camera' : 'Back camera — point it at a friend to turn them into your NFT!');
        this.startCamera();
        return;
      }
      if (this.devices.length < 2) { toast('Only one camera found'); return; }
      const i = this.devices.findIndex(d => d.deviceId === this.settings.cameraId);
      const next = this.devices[(i + 1) % this.devices.length];
      this.startCamera(next.deviceId);
    }

    setLive(on) {
      const p = $('camStatus');
      p.classList.toggle('live', on);
      p.lastElementChild.textContent = on ? 'Camera on · live' : 'Camera off';
      $('empty').style.display = on ? 'none' : '';
      $('out').style.visibility = on ? 'visible' : 'hidden';
      const b = $('camBtn');
      b.classList.toggle('primary', !on); b.classList.toggle('danger', on);
      b.querySelector('.lbl').textContent = IS_MOBILE ? (on ? 'Stop' : 'Start') : (on ? 'Stop camera' : 'Start camera');
      b.title = on ? 'Stop camera' : 'Start camera';
      if (!on) $('trackStatus').classList.add('hidden');
    }

    setLoading(text) {
      $('loading').classList.toggle('show', !!text);
      if (text) $('loadingText').textContent = text;
    }

    /* ---------------- render loop ---------------- */
    frame() {
      const v = this.video;
      if (!this.stream || v.readyState < 2 || !v.videoWidth) return;
      const W = v.videoWidth, H = v.videoHeight, s = this.settings;
      if (this.out.width !== W || this.out.height !== H) { this.out.width = W; this.out.height = H; }
      const ts = performance.now();
      const ctx = this.outCtx;
      ctx.clearRect(0, 0, W, H);
      this.bg.compose(ctx, v, W, H, { mode: s.bg, hideBody: s.hideBody, mirror: s.mirror }, ts);

      let det = null;
      if (this.tracker.video) { try { det = this.tracker.detect(v, ts); } catch (e) { console.warn(e); } }
      const pose = det ? this.solver.update(det, { W, H, mirror: s.mirror, smoothing: s.smoothing, exprGain: s.exprGain }, ts) : this.solver.lost(ts, s.holdOnLost);
      $('trackStatus').classList.toggle('hidden', !!det || !this.tracker.video);

      if (pose && pose.visible > 0) {
        const r = this.mode === '3d' ? this.av3 : this.av2;
        if (r && r.ready) {
          const o = (this.current && this.current.opts) || {};
          const expr = { ...pose.expr };
          if (o.eyes === false) { expr.blinkL = expr.blinkR = expr.gazeX = expr.gazeY = 0; }
          if (o.mouth === false) { expr.jaw = expr.smileL = expr.smileR = expr.pucker = 0; }
          r.render({
            W, H, anchor: pose.anchor, R: pose.R, faceSize: pose.scale, opacity: pose.visible, expr,
            headOnly: !!o.headOnly, crop: o.crop,
            blendshapes: pose.blendshapes3d, exprGain: s.exprGain,
            size: s.size, offX: s.offX, offY: s.offY, roll: s.roll, depth: s.depth, oval: s.oval
          });
          ctx.drawImage(r.canvas, 0, 0);
        }
      }

      this.fpsN++;
      if (ts - this.fpsT > 1000) {
        $('fps').textContent = `${Math.round(this.fpsN * 1000 / (ts - this.fpsT))} fps · ${W}×${H}`;
        this.fpsN = 0; this.fpsT = ts;
      }
    }

    /* ---------------- UI ---------------- */
    renderCurrent() {
      const r = this.current, c = this.cache[r.id];
      const thumb = r.kind === 'model' ? `<div class="glb">3D</div>` : `<img src="${c.url}" alt="">`;
      const sub = r.kind === 'model'
        ? `3D avatar · ${r.info && r.info.morphCount ? r.info.morphCount + ' facial shapes' : 'head tracking'}`
        : '2D NFT · animated face';
      $('currentCard').innerHTML = `${thumb}<div class="meta"><b>${escapeHtml(r.name)}</b><small>${sub}</small></div>`;
      $('pointsBtn').style.display = r.kind === 'image' ? '' : 'none';
      const rb = $('removeBgRow');
      rb.style.display = r.kind === 'image' && c.bgDetected ? '' : 'none';
      rb.querySelector('small').textContent = c.risky
        ? 'Off by default — your NFT uses its background colour, so cutting it out could leave holes'
        : 'Cuts out solid-colour backgrounds (artwork untouched)';
      $('removeBg').checked = !!c.removeBg;
      $('heroAvatar').src = r.kind === 'image' ? c.url : this.cache['demo-neon-cat'] ? this.cache['demo-neon-cat'].url : '';
      $('modeChip').innerHTML = `<span class="pill">${r.kind === 'model' ? '3D Avatar mode' : '2D NFT mode'}</span>`;
    }

    async renderCollection() {
      const host = $('collection');
      const tiles = [];
      for (const r of this.records) {
        let inner;
        if (r.kind === 'model') inner = `<div class="glb">GLB</div>`;
        else { const c = await this.asset(r).catch(() => null); inner = c ? `<img src="${c.url}" alt="" loading="lazy">` : '?'; }
        tiles.push(`<button class="tile ${this.current && this.current.id === r.id ? 'selected' : ''}" data-id="${r.id}" title="${escapeHtml(r.name)}">${inner}<span class="tag">${r.kind === 'model' ? '3D' : r.builtin ? 'Demo' : '2D'}</span>${r.builtin ? '' : `<span class="del" data-del="${r.id}" title="Remove">✕</span>`}</button>`);
      }
      host.innerHTML = tiles.join('');
    }

    renderObsSteps() {
      const t = FC.config.OUTPUT_WINDOW_TITLE;
      const html = `
        <li>Install the free <b>OBS Studio</b> from <a href="https://obsproject.com" target="_blank" rel="noopener">obsproject.com</a> (Windows, Mac or Linux).</li>
        <li>Here, start your camera and click <b>Pop-out output</b>. A window called <b>“${t}”</b> opens — keep it open (you can move it aside, but don't minimise it).</li>
        <li>In OBS, under <b>Sources</b> click <b>+</b> → <b>Window Capture</b> (on Mac: <b>macOS Screen Capture</b> → Method: Window) and pick <b>“${t}”</b>. Right-click it → Transform → <b>Fit to screen</b>.</li>
        <li>In OBS click <b>Start Virtual Camera</b> (bottom-right).</li>
        <li>In <b>Zoom, Discord, Google Meet</b> or any video app, open camera settings and choose <b>“OBS Virtual Camera”</b>. For <b>Twitch</b>, just press <b>Start Streaming</b> in OBS.</li>`;
      $('obsSteps').innerHTML = html; $('obsSteps2').innerHTML = html;
    }

    syncControls() {
      const s = this.settings;
      for (const k of ADJ_KEYS) { $(k).value = s[k]; $('o-' + k).textContent = FMT[k](+s[k]); }
      $('oval').checked = s.oval; $('holdOnLost').checked = s.holdOnLost; $('mirror').checked = s.mirror; $('hideBody').checked = s.hideBody;
      $('mirrorBtn').classList.toggle('on', s.mirror);
      $('resSelect').value = s.res;
      document.querySelectorAll('#bgSeg button').forEach(b => b.classList.toggle('active', b.dataset.bg === s.bg));
      $('bgImageRow').style.display = s.bg === 'image' ? '' : 'none';
      $('fps').hidden = !s.showFps; $('fpsBtn').classList.toggle('on', s.showFps);
    }

    setClean(on) {
      document.body.classList.toggle('clean', on);
      if (on) toast('Clean mode: press Esc or double-click to exit');
    }

    bindUI() {
      const s = this.settings;
      this.syncControls();
      document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
        document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
      });

      const toggleCam = () => (this.stream ? this.stopCamera() : this.startCamera(s.cameraId || undefined));
      $('camBtn').onclick = toggleCam;
      $('startBig').onclick = toggleCam;
      $('switchBtn').onclick = () => this.switchCamera();
      $('camSelect').onchange = (e) => this.startCamera(e.target.value);
      $('resSelect').onchange = (e) => { s.res = e.target.value; this.save(); if (this.stream) this.startCamera(s.cameraId); };
      const setMirror = (v) => { s.mirror = v; this.save(); this.solver.reset(); this.syncControls(); };
      $('mirrorBtn').onclick = () => setMirror(!s.mirror);
      $('mirror').onchange = (e) => setMirror(e.target.checked);

      for (const k of ADJ_KEYS) $(k).oninput = (e) => { s[k] = +e.target.value; $('o-' + k).textContent = FMT[k](s[k]); this.save(); };
      $('oval').onchange = (e) => { s.oval = e.target.checked; this.save(); };
      $('holdOnLost').onchange = (e) => { s.holdOnLost = e.target.checked; this.save(); };
      $('resetAdj').onclick = () => { for (const k of [...ADJ_KEYS, 'oval']) s[k] = DEFAULTS[k]; this.save(); this.syncControls(); };

      document.querySelectorAll('#bgSeg button').forEach(b => b.onclick = () => {
        s.bg = b.dataset.bg; this.save(); this.syncControls();
        if (s.bg !== 'none') this.bg.ensure();
        if (s.bg === 'image' && !this.bg.bgImage) $('bgFile').click();
      });
      $('bgFile').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { this.bg.bgImage = await loadImage(URL.createObjectURL(f)); s.bg = 'image'; this.save(); this.syncControls(); }
        catch { toast('Could not read that image', 'error'); }
        e.target.value = '';
      };
      $('hideBody').onchange = (e) => { s.hideBody = e.target.checked; this.save(); if (s.hideBody) this.bg.ensure(); };

      // avatar import
      const drop = $('drop');
      $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) this.addFile(f); e.target.value = ''; };
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) this.addFile(f); });
      // allow dropping a file anywhere on the stage too
      $('stage').addEventListener('dragover', (e) => e.preventDefault());
      $('stage').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.addFile(f); });
      $('urlBtn').onclick = () => this.importUrl($('urlInput').value);
      $('urlInput').onkeydown = (e) => { if (e.key === 'Enter') this.importUrl(e.target.value); };
      $('collection').onclick = (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); this.confirmRemove(del.dataset.del); return; }
        const t = e.target.closest('.tile'); if (t) this.selectAvatar(t.dataset.id);
      };
      $('pointsBtn').onclick = () => {
        const c = this.cache[this.current.id];
        if (this.current.kind === 'image' && c && c.prepared) this.editor.open(this.current, c.prepared, !this.current.pointsSet && !this.current.builtin);
      };
      $('removeBg').onchange = async (e) => {
        const r = this.current; r.removeBg = e.target.checked;
        if (!r.builtin) FC.storage.avatars.put(r);
        await this.selectAvatar(r.id, { skipPrompt: true });
      };

      // output
      const pop = () => {
        if (!this.stream) { toast('Start your camera first'); return; }
        if (this.output.popout()) toast(`Output window opened — select “${FC.config.OUTPUT_WINDOW_TITLE}” in OBS`, 'ok', 6000);
      };
      $('popBtn').onclick = pop; $('popBtn2').onclick = pop;
      $('cleanBtn').onclick = () => this.setClean(true);
      $('cleanBtn2').onclick = () => this.setClean(true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.setClean(false); $('help').classList.remove('show'); $('result').classList.remove('show'); this.closeSheet(); } });
      $('stage').addEventListener('dblclick', () => { if (document.body.classList.contains('clean')) this.setClean(false); });
      $('fsBtn').onclick = () => {
        const st = $('stage');
        if (document.fullscreenElement) document.exitFullscreen();
        else (st.requestFullscreen ? st.requestFullscreen() : Promise.reject()).catch(() => toast('Fullscreen is not available here', 'error'));
      };
      $('fpsBtn').onclick = () => { s.showFps = !s.showFps; this.save(); this.syncControls(); };
      $('helpBtn').onclick = () => $('help').classList.add('show');
      $('helpClose').onclick = () => $('help').classList.remove('show');
      $('help').addEventListener('pointerdown', (e) => { if (e.target.id === 'help') $('help').classList.remove('show'); });
      $('walletBtn').onclick = () => toast('Wallet connection is coming soon. For now, upload your NFT image or paste its link — no wallet needed.', 'info', 6000);
      window.addEventListener('beforeunload', () => this.output.close());

      // record & photo
      $('recAudio').checked = s.recAudio;
      $('recAudio').onchange = (e) => { s.recAudio = e.target.checked; this.save(); };
      $('recBtn').onclick = () => this.toggleRecord();
      $('recBtn2').onclick = () => { this.closeSheet(); this.toggleRecord(); };
      $('snapBtn').onclick = () => this.snap();
      $('snapBtn2').onclick = () => { this.closeSheet(); this.snap(); };
      this.recorder.onLimit = () => { toast('Clips are limited to 3 minutes'); this.toggleRecord(); };
      $('resultClose').onclick = () => $('result').classList.remove('show');
      $('result').addEventListener('pointerdown', (e) => { if (e.target.id === 'result') $('result').classList.remove('show'); });

      // phone bottom sheet
      $('sheetBtn').onclick = () => document.body.classList.toggle('sheet-open');
      $('sheetBackdrop').onclick = () => this.closeSheet();
      $('sheetHandle').onclick = () => this.closeSheet();

      // install as an app
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
      $('installHint').textContent = standalone ? 'Installed — you are using the app version.'
        : isIOS ? 'In Safari, tap the Share button, then “Add to Home Screen”. FaceCam then opens full-screen like an app.'
        : 'Tap Install below (or your browser menu → “Add to Home screen”).';
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); this.installEvt = e; $('installBtn').hidden = false;
      });
      $('installBtn').onclick = async () => {
        if (!this.installEvt) return;
        this.installEvt.prompt(); await this.installEvt.userChoice.catch(() => {}); this.installEvt = null; $('installBtn').hidden = true;
      };
    }

    closeSheet() { document.body.classList.remove('sheet-open'); }

    async toggleRecord() {
      const btns = [$('recBtn'), $('recBtn2')];
      if (this.recorder.recording) {
        clearInterval(this.recTimer);
        $('recBadge').classList.remove('show');
        btns.forEach(b => b.classList.remove('recording'));
        $('recBtn').querySelector('.lbl').textContent = 'Record';
        const blob = await this.recorder.stop();
        if (blob && blob.size) FC.showResult(blob, 'video');
        else toast('Nothing was recorded', 'error');
        return;
      }
      if (!this.stream) { toast('Start your camera first'); return; }
      try { await this.recorder.start(this.settings.recAudio); }
      catch (e) { toast(e.message, 'error', 6000); return; }
      btns.forEach(b => b.classList.add('recording'));
      $('recBtn').querySelector('.lbl').textContent = 'Stop';
      $('recBadge').classList.add('show');
      const tick = () => {
        const sec = Math.floor(this.recorder.elapsed() / 1000);
        $('recTime').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      };
      tick(); this.recTimer = setInterval(tick, 250);
    }

    async snap() {
      if (!this.stream) { toast('Start your camera first'); return; }
      const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      try { FC.showResult(await this.recorder.snap(), 'photo'); }
      catch (e) { toast(e.message, 'error'); }
    }

    confirmRemove(id) {
      const tile = document.querySelector(`.tile[data-id="${id}"] .del`);
      if (tile && tile.dataset.armed) { this.removeRecord(id); return; }
      if (tile) { tile.dataset.armed = '1'; tile.textContent = '?'; tile.style.display = 'block'; tile.style.background = '#ff4d6d'; tile.title = 'Click again to remove'; }
      toast('Click ✕ again to remove it from your collection');
      setTimeout(() => this.renderCollection(), 3000);
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
  }

  window.addEventListener('DOMContentLoaded', () => {
    try {
      FC.app = new App();
      FC.app.init().catch(e => { console.error(e); toast('Startup error: ' + e.message, 'error', 8000); });
    } catch (e) {
      console.error(e);
      document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#07060f;color:#fff;font:16px sans-serif;padding:30px;text-align:center">${escapeHtml(e.message)}<br><br>Please open NFT FaceCam in an up-to-date Chrome, Edge or Firefox.</div>`);
    }
  });
})();
