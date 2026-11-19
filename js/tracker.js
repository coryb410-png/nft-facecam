/* MediaPipe Face Landmarker wrapper (runs fully on-device, GPU when available). */
(function () {
  const cfg = FC.config;
  let visionP = null, filesetP = null;

  function vision() {
    if (!visionP) visionP = import(cfg.MEDIAPIPE_BUNDLE);
    return visionP;
  }
  async function fileset() {
    if (!filesetP) filesetP = vision().then(v => v.FilesetResolver.forVisionTasks(cfg.MEDIAPIPE_WASM));
    return filesetP;
  }

  async function createWithFallback(Cls, opts) {
    const fs = await fileset();
    try {
      return await Cls.createFromOptions(fs, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } });
    } catch (e) {
      console.warn('GPU delegate failed, using CPU', e);
      return Cls.createFromOptions(fs, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } });
    }
  }

  class Tracker {
    constructor() { this.video = null; this.image = null; this.seg = null; this.lastTs = -1; }

    async init() {
      const v = await vision();
      this.video = await createWithFallback(v.FaceLandmarker, {
        baseOptions: { modelAssetPath: cfg.FACE_MODEL },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5
      });
    }

    detect(videoEl, ts) {
      if (!this.video) return null;
      if (ts <= this.lastTs) ts = this.lastTs + 1;
      this.lastTs = ts;
      const r = this.video.detectForVideo(videoEl, ts);
      if (!r || !r.faceLandmarks || !r.faceLandmarks.length) return null;
      const bs = {};
      const cats = r.faceBlendshapes && r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories : [];
      for (const c of cats) bs[c.categoryName] = c.score;
      return { landmarks: r.faceLandmarks[0], blendshapes: bs };
    }

    // Find the face inside a piece of NFT artwork (works for many human-like PFPs).
    async detectInImage(canvas) {
      const v = await vision();
      if (!this.image) {
        this.image = await createWithFallback(v.FaceLandmarker, {
          baseOptions: { modelAssetPath: cfg.FACE_MODEL }, runningMode: 'IMAGE', numFaces: 1,
          minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3
        });
      }
      const r = this.image.detect(canvas);
      return r && r.faceLandmarks && r.faceLandmarks.length ? r.faceLandmarks[0] : null;
    }

    async segmenter() {
      if (this.seg) return this.seg;
      const v = await vision();
      this.seg = await createWithFallback(v.ImageSegmenter, {
        baseOptions: { modelAssetPath: cfg.SEGMENT_MODEL }, runningMode: 'VIDEO',
        outputCategoryMask: false, outputConfidenceMasks: true
      });
      return this.seg;
    }
  }

  FC.Tracker = Tracker;
})();
