# NFT FaceCam

Turn on your camera and become your NFT. Your NFT replaces your face live: it turns with your head, blinks when you blink, talks when you talk, smiles, raises its brows and follows your eyes. You can use it in Zoom, Discord, Google Meet, Twitch and OBS.

Everything runs on your own computer. Your video is never uploaded, saved or recorded, and you don't need an account or a wallet.

---

## Quick start (3 steps)

1. **Open the app**
   - **Windows:** double-click `Start NFT FaceCam (Windows).bat`
   - **Mac:** double-click `Start NFT FaceCam (Mac).command`. If macOS says it can't verify the file, right-click it → **Open** → **Open**. You only need to do this once.
   - **Any computer:** you can also just double-click `index.html` to open it in Chrome or Edge.
2. **Pick your NFT.** Click **Upload NFT image** (PNG, JPG, WebP or transparent PNG), or paste a link (`https://`, `ipfs://` or `ar://`). Two demo avatars are already included.
3. **Click Start camera** and allow camera access. You're the NFT.

You need an internet connection the first time you start the camera, so the app can download the free face-tracking engine (about 5 MB). After that, your browser keeps a copy.

## Lining up blinking and talking

The app tries to find the eyes and mouth in your NFT automatically. If they don't line up, open the **Avatar** tab and click **Set face points**. Drag the colored dots onto the NFT's eyes and mouth, then drag the small white squares to set the eye size and mouth width. A live preview shows the result. Click **Save**.

## Controls

| Where | What it does |
|---|---|
| **Adjust** tab | Size, horizontal and vertical position, rotation, tracking smoothness, expression strength, 3D depth (how much the NFT turns like a real head), soft oval crop, and keeping the avatar on screen when tracking is lost |
| **Camera** tab | Choose camera, resolution, mirror, and background: blur, your own image, green screen, or neon. "Hide my body" shows only the avatar |
| **Avatar** tab | Upload, import from a link, your saved collection, and solid-color background removal for the NFT (the original artwork is never changed) |
| Toolbar | Start/stop camera, switch camera, mirror, pop-out output, clean mode, fullscreen |

## Use it as a webcam in Zoom, Discord, Meet or Twitch

Browsers aren't allowed to create a system webcam on their own. The free **OBS Studio** virtual camera does that part:

1. Install **OBS Studio** from https://obsproject.com (Windows, Mac or Linux).
2. In NFT FaceCam, start your camera and click **Pop-out output**. A clean window called **"NFT FaceCam Output"** opens. Keep it open. You can move it out of the way, but don't minimize it.
3. In OBS, go to **Sources** → **+** → **Window Capture** and select **"NFT FaceCam Output"**. On a Mac, use **macOS Screen Capture** with Method set to **Window**. Then right-click the source → **Transform** → **Fit to screen**.
4. Click **Start Virtual Camera** in OBS.
5. In Zoom, Discord, Google Meet or any other video app, choose **"OBS Virtual Camera"** as your camera. For Twitch, press **Start Streaming** in OBS.

Tips:
- Pick the **Green** background and add a **Chroma Key** filter to the source in OBS. That puts just your avatar over a game, slides or any scene.
- **Clean mode** hides every control in the main window, so you can capture that window instead. Press **Esc** or double-click to get the controls back.
- Open the app with the **Start NFT FaceCam** launcher. It starts the browser with settings that keep the avatar moving smoothly while it's behind other windows.

## 3D avatars (GLB / glTF)

Upload a `.glb` file (or a self-contained `.gltf`) to switch to 3D Avatar mode. The model follows your head. If the model has ARKit-style facial blendshapes (Ready Player Me avatars do, and so do many VRoid/VRM conversions), it also blinks, talks and smiles. Use **Size** and the position sliders to fit the model to your face. Note: 3D mode was written to standard three.js conventions but hasn't been tested with real models yet.

## Wallets (coming soon)

Connecting a wallet is optional and not needed today. `js/wallet.js` sets up the structure for Ethereum, Polygon, Base and Solana. Each chain is a small "provider" with `connect()` and `listNFTs()`. To finish it, plug in an NFT indexer API, and each NFT's image goes through the same import as **Import from link**.

## Rename / rebrand

Open `js/config.js` and change `APP_NAME` (and `TAGLINE`, `OUTPUT_WINDOW_TITLE` if you like).

## Put it online (optional)

The folder is a plain static website with no build step. Drag the whole folder onto https://app.netlify.com/drop (or any static host) to get an `https://` link that also works on phones.

## How it works (for developers)

- **No build step:** plain HTML/CSS/JS that runs straight from disk. MediaPipe Tasks Vision and three.js are loaded on demand from jsDelivr (versions are pinned in `js/config.js` and `index.html`).
- `js/tracker.js`: MediaPipe Face Landmarker (478 landmarks + 52 blendshapes), GPU delegate with CPU fallback, plus the selfie segmenter for backgrounds.
- `js/pose.js`: works out a head basis (rotation), position and scale from the landmarks, applies One-Euro smoothing, and maps blendshapes to expressions, with mirror-aware left/right.
- `js/avatar2d.js`: a WebGL renderer. The NFT sits on a 48×48 mesh that bulges around the head, so it turns with real perspective and soft shading. The fragment shader warps the artwork locally for blinks (eyelids), mouth opening, smiles, puckering, brows and eye gaze.
- `js/avatar3d.js`: a three.js GLTF renderer that maps blendshapes to morph targets.
- `js/background.js`: compositing for blur, image, green screen, neon and hide-body.
- `js/output.js`: the pop-out output window (canvas stream) and a frame clock that keeps rendering while the window is in the background.
- `js/storage.js`: keeps your collection in IndexedDB and settings in localStorage. Both stay on this device.

**Ideas for a later version:** a desktop app (Electron) with a built-in virtual camera driver, so OBS isn't needed. On Windows that means a signed DirectShow / Media Foundation virtual camera. On macOS it means a CoreMediaIO camera extension.
