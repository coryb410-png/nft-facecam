/* NFT FaceCam — app configuration.
 * Change APP_NAME (and anything else here) to rebrand the app.
 * Everything runs locally in the browser; the URLs below only download
 * the open-source tracking libraries and models (no video is ever sent anywhere).
 */
window.FC = window.FC || {};

FC.config = {
  APP_NAME: 'NFT FaceCam',
  TAGLINE: 'Become your NFT',

  // Libraries (loaded on demand from public CDNs)
  MEDIAPIPE_VERSION: '0.10.14',
  get MEDIAPIPE_BUNDLE() { return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.MEDIAPIPE_VERSION}/vision_bundle.mjs`; },
  get MEDIAPIPE_WASM() { return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.MEDIAPIPE_VERSION}/wasm`; },
  FACE_MODEL: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  SEGMENT_MODEL: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  // three.js is mapped in index.html's importmap (only loaded for 3D avatars)

  // Gateways used when importing ipfs:// or ar:// links
  IPFS_GATEWAY: 'https://ipfs.io/ipfs/',
  ARWEAVE_GATEWAY: 'https://arweave.net/',

  // Output window title — this is the window you pick in OBS
  OUTPUT_WINDOW_TITLE: 'NFT FaceCam Output',

  // Future wallet support (see js/wallet.js)
  WALLET_CHAINS: ['Ethereum', 'Polygon', 'Base', 'Solana'],
  NFT_INDEXER_URL: '' // e.g. your own API that returns [{name,image,chain}] for an address
};
