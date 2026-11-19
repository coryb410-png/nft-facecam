/* 3D avatar mode: GLB / glTF models driven by face tracking.
 * Head rotation moves the model; ARKit-style blendshapes (eyeBlinkLeft, jawOpen,
 * mouthSmileLeft, ...) are applied to any matching morph targets — this works with
 * Ready Player Me, many VRoid/VRM conversions and most ARKit-rigged avatars. */
(function () {
  let libsP = null;
  function libs() {
    if (!libsP) libsP = Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js')])
      .then(([THREE, G]) => ({ THREE, GLTFLoader: G.GLTFLoader }));
    return libsP;
  }

  // Common alternative names for a few key shapes (VRM / custom rigs)
  const ALIASES = {
    eyeBlinkLeft: ['blink_l', 'blinkleft', 'eye_blink_l', 'fcl_eye_close_l'],
    eyeBlinkRight: ['blink_r', 'blinkright', 'eye_blink_r', 'fcl_eye_close_r'],
    jawOpen: ['mouthopen', 'mouth_open', 'aa', 'fcl_mth_a', 'viseme_aa'],
    mouthSmileLeft: ['smile_l', 'mouthsmile', 'fcl_mth_joy'],
    mouthSmileRight: ['smile_r', 'mouthsmile', 'fcl_mth_joy']
  };

  class Avatar3D {
    constructor(canvas) { this.canvas = canvas; this.ready = false; }

    async init() {
      const { THREE } = await libs();
      this.THREE = THREE;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 1, 100000);
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
      const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(300, 500, 900); this.scene.add(key);
      const rim = new THREE.DirectionalLight(0xa070ff, 1.2); rim.position.set(-600, 200, -400); this.scene.add(rim);
      this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    }

    async load(url) {
      if (!this.renderer) await this.init();
      const { THREE, GLTFLoader } = await libs();
      const gltf = await new GLTFLoader().loadAsync(url);
      if (this.model) this.pivot.remove(this.model);
      const model = gltf.scene;
      // Find head + morph targets
      let head = null; const morphs = [];
      model.traverse(o => {
        if (!head && (o.isBone || o.type === 'Bone' || o.isObject3D) && /^(head|head_?jnt|j_bip_c_head|mixamorig:?head)$/i.test(o.name)) head = o;
        if (o.isMesh && o.morphTargetDictionary) {
          const dict = {};
          for (const k in o.morphTargetDictionary) dict[k.toLowerCase()] = o.morphTargetDictionary[k];
          morphs.push({ mesh: o, dict });
        }
        if (o.isMesh) o.frustumCulled = false;
      });
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      let center, headSize;
      if (head) {
        center = head.getWorldPosition(new THREE.Vector3());
        // head bone sits at the neck/skull base; shift up to roughly the eyes
        headSize = Math.min(size.y * 0.13, size.x * 0.5) || size.y * 0.13;
        center.y += headSize * 0.35;
      } else {
        center = box.getCenter(new THREE.Vector3());
        headSize = size.y * 0.75;
      }
      model.position.sub(center);
      this.pivot.add(model);
      this.model = model; this.morphs = morphs; this.headSize = headSize;
      this.morphCount = morphs.reduce((n, m) => n + Object.keys(m.dict).length, 0);
      this.ready = true;
      return { morphCount: this.morphCount, hasHead: !!head };
    }

    applyBlendshapes(bs, gain) {
      for (const { mesh, dict } of this.morphs) {
        const inf = mesh.morphTargetInfluences;
        for (const name in bs) {
          const key = name.toLowerCase();
          let i = dict[key];
          if (i === undefined && ALIASES[name]) for (const a of ALIASES[name]) { if (dict[a] !== undefined) { i = dict[a]; break; } }
          if (i !== undefined) inf[i] = Math.min(1, bs[name] * gain);
        }
      }
    }

    /** same state object as Avatar2D.render plus blendshapes */
    render(s) {
      const c = this.canvas;
      if (!this.renderer) return;
      if (c.width !== s.W || c.height !== s.H) this.renderer.setSize(s.W, s.H, false);
      const T = this.THREE;
      this.renderer.clear();
      if (!this.ready || !s.opacity) return;
      const D = s.H / 2 / Math.tan(17.5 * Math.PI / 180);
      this.camera.aspect = s.W / s.H; this.camera.fov = 35; this.camera.position.set(0, 0, D);
      this.camera.near = 1; this.camera.far = D * 10; this.camera.updateProjectionMatrix();

      const Rm = FC.Avatar2D.mul3(s.R, FC.Avatar2D.rotZ((s.roll || 0) * Math.PI / 180));
      const m4 = new T.Matrix4().set(Rm[0], Rm[3], Rm[6], 0, Rm[1], Rm[4], Rm[7], 0, Rm[2], Rm[5], Rm[8], 0, 0, 0, 0, 1);
      this.pivot.quaternion.setFromRotationMatrix(m4);
      const fs = s.faceSize;
      const ox = (s.offX || 0) * fs, oy = (s.offY || 0) * fs;
      this.pivot.position.set(s.anchor[0] - s.W / 2 + Rm[0] * ox + Rm[3] * oy, s.H / 2 - s.anchor[1] + Rm[1] * ox + Rm[4] * oy, 0);
      this.pivot.scale.setScalar(fs * 2.3 / this.headSize * (s.size || 1));
      if (s.blendshapes) this.applyBlendshapes(s.blendshapes, s.exprGain ?? 1);
      if (this.lastOpacity !== s.opacity) {
        this.lastOpacity = s.opacity;
        this.model.traverse(o => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.transparent = s.opacity < 1; m.opacity = s.opacity; }); } });
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  FC.Avatar3D = Avatar3D;
})();
