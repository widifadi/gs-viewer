# CLAUDE.md — 3DGS Thematic Viewer

## Project overview

A static web application that loads a 3D Gaussian Splatting scene and lets users toggle between the photorealistic view and one or more thematic overlays (e.g. temperature, elevation, land cover) derived from raster data projected onto the Gaussians. Hosted on GitHub Pages. Splat and thematic data files served from Hugging Face Datasets.

**Target build time:** ~5 hours  
**Stack:** Vanilla JS (ES modules) + Three.js + Spark.js · No build tool · No framework · GitHub Pages

---

## Repository layout

```
/
├── index.html          # Single-page app entry point
├── CLAUDE.md           # This file
├── src/
│   ├── main.js         # Scene setup, render loop
│   ├── loader.js       # Fetch splat + thematic JSON from HF
│   ├── thematic.js     # PackedSplats color injection logic
│   └── ui.js           # Layer selector + blend slider
├── public/
│   └── colormap.js     # Plasma/viridis LUT as Float32Array
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Pages deploy action
```

---

## Data architecture

### Hugging Face Dataset structure

```
hf://datasets/<your-org>/<repo>/
├── scene.ply                  # Trained 3DGS file (original photorealistic)
└── thematics/
    ├── manifest.json          # Lists available thematic layers
    ├── temperature.json       # Per-splat scalar values + metadata
    └── elevation.json         # Per-splat scalar values + metadata
```

### `manifest.json` schema

```json
{
  "splatUrl": "https://huggingface.co/datasets/<org>/<repo>/resolve/main/scene.ply",
  "layers": [
    {
      "id": "temperature",
      "label": "Surface Temperature",
      "unit": "°C",
      "url": "https://huggingface.co/datasets/<org>/<repo>/resolve/main/thematics/temperature.json",
      "colormap": "plasma",
      "min": 15.0,
      "max": 45.0
    },
    {
      "id": "elevation",
      "label": "Elevation",
      "unit": "m",
      "url": "https://huggingface.co/datasets/<org>/<repo>/resolve/main/thematics/elevation.json",
      "colormap": "viridis",
      "min": 0.0,
      "max": 500.0
    }
  ]
}
```

### Thematic layer JSON schema

```json
{
  "id": "temperature",
  "splatCount": 1500000,
  "values": [23.4, 31.2, 18.9, ...]   // Float array, one scalar per Gaussian, same order as PLY
}
```

The scalar array index maps 1-to-1 with Gaussian index in the PLY. This is produced by the Python preprocessing pipeline (see Preprocessing section below).

---

## Implementation phases

### Phase 1 — Scaffold + scene loads (45 min)

**Goal:** Blank Three.js + Spark scene renders the photorealistic splat from Hugging Face.

**Files to create:**
- `index.html` — importmap for Three.js and Spark, loads `src/main.js`
- `src/main.js` — SparkRenderer + SplatMesh + camera + render loop
- `src/loader.js` — fetches `manifest.json`, then fetches `scene.ply` from the URL it contains

**Key implementation notes:**

Use these exact CDN versions in the importmap:
```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
    "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/2.1.0/spark.module.js"
  }
}
</script>
```

`src/main.js` skeleton:
```js
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { loadManifest } from "./loader.js";
import { buildUI } from "./ui.js";

const MANIFEST_URL = "https://huggingface.co/datasets/<org>/<repo>/resolve/main/thematics/manifest.json";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
const scene = new THREE.Scene();
scene.add(spark);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(0, 0, 3);

const manifest = await loadManifest(MANIFEST_URL);
const splatMesh = new SplatMesh({ url: manifest.splatUrl });
scene.add(splatMesh);

buildUI(manifest, splatMesh);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

**Acceptance criteria:** Photorealistic splat renders in browser via `npx serve .` or equivalent.

---

### Phase 2 — Thematic color injection (90 min)

**Goal:** Given a loaded thematic JSON, recolor all Gaussians using a colormap, toggling between photorealistic and thematic view.

**Files to create/modify:**
- `src/thematic.js` — core logic
- `public/colormap.js` — LUT tables

`public/colormap.js`:
```js
// Plasma colormap LUT — 256 RGB entries, each in [0, 1]
export const PLASMA = [
  [0.050383, 0.029803, 0.527975],
  // ... 256 entries
  [0.940015, 0.975158, 0.131326]
];

export const VIRIDIS = [ /* 256 entries */ ];

export const COLORMAPS = { plasma: PLASMA, viridis: VIRIDIS };
```

Use the standard matplotlib colormap values. Generate them once with Python:
```python
import json, numpy as np, matplotlib.cm as cm
for name in ["plasma", "viridis"]:
    lut = cm.get_cmap(name)(np.linspace(0, 1, 256))[:, :3].tolist()
    print(f'export const {name.upper()} = {json.dumps(lut)};')
```

`src/thematic.js`:
```js
import { COLORMAPS } from "../public/colormap.js";

// originalColors[i] = THREE.Color — saved once when splat first loads
let originalColors = null;

export async function applyThematic(splatMesh, layerConfig) {
  const packed = splatMesh.packedSplats;
  await packed.waitForLoad?.();

  // Save photorealistic colors on first call
  if (!originalColors) {
    originalColors = [];
    packed.forEachSplat((i, center, scales, quat, opacity, color) => {
      originalColors[i] = color.clone();
    });
  }

  const response = await fetch(layerConfig.url);
  const data = await response.json();
  const values = data.values;

  const lut = COLORMAPS[layerConfig.colormap];
  const { min, max } = layerConfig;

  packed.forEachSplat((i, center, scales, quat, opacity, color) => {
    const t = Math.min(1, Math.max(0, (values[i] - min) / (max - min)));
    const lutIdx = Math.floor(t * 255);
    const [r, g, b] = lut[lutIdx];
    packed.setSplat(i, center, scales, quat, opacity, new THREE.Color(r, g, b));
  });

  splatMesh.updateGenerator();
}

export function restorePhotorealistic(splatMesh) {
  if (!originalColors) return;
  const packed = splatMesh.packedSplats;
  packed.forEachSplat((i, center, scales, quat, opacity, _color) => {
    packed.setSplat(i, center, scales, quat, opacity, originalColors[i]);
  });
  splatMesh.updateGenerator();
}
```

**Acceptance criteria:** Calling `applyThematic(splatMesh, manifest.layers[0])` visibly recolors the scene. Calling `restorePhotorealistic` brings it back.

**Performance note:** `forEachSplat` over 1–2M Gaussians takes ~200–400ms on the main thread. This is acceptable for a single layer switch. Do NOT call this per-frame.

---

### Phase 3 — UI (60 min)

**Goal:** A minimal floating panel with a layer dropdown and a blend slider.

**File:** `src/ui.js`

```js
import { applyThematic, restorePhotorealistic } from "./thematic.js";

export function buildUI(manifest, splatMesh) {
  const panel = document.createElement("div");
  panel.id = "ui-panel";
  panel.innerHTML = `
    <label>Layer</label>
    <select id="layer-select">
      <option value="__photo">Photorealistic</option>
      ${manifest.layers.map(l =>
        `<option value="${l.id}">${l.label}</option>`
      ).join("")}
    </select>
    <label>Blend</label>
    <input type="range" id="blend-slider" min="0" max="1" step="0.01" value="1">
    <div id="legend"></div>
  `;
  document.body.appendChild(panel);

  const select = document.getElementById("layer-select");
  let currentLayer = null;

  select.addEventListener("change", async () => {
    const id = select.value;
    if (id === "__photo") {
      restorePhotorealistic(splatMesh);
      currentLayer = null;
      updateLegend(null, manifest);
    } else {
      currentLayer = manifest.layers.find(l => l.id === id);
      await applyThematic(splatMesh, currentLayer);
      updateLegend(currentLayer, manifest);
    }
  });
}

function updateLegend(layer, manifest) {
  const el = document.getElementById("legend");
  if (!layer) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <span>${layer.min} ${layer.unit}</span>
    <div class="colorbar colorbar-${layer.colormap}"></div>
    <span>${layer.max} ${layer.unit}</span>
  `;
}
```

**CSS** (inline in `index.html`):
```css
#ui-panel {
  position: absolute;
  top: 16px;
  left: 16px;
  background: rgba(0,0,0,0.65);
  color: #fff;
  padding: 14px 18px;
  border-radius: 10px;
  font-family: monospace;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 220px;
  backdrop-filter: blur(6px);
}
#ui-panel select, #ui-panel input[type=range] {
  width: 100%;
}
.colorbar {
  height: 12px;
  border-radius: 4px;
}
.colorbar-plasma {
  background: linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89441, #f0f921);
}
.colorbar-viridis {
  background: linear-gradient(to right, #440154, #31688e, #35b779, #fde725);
}
```

**Acceptance criteria:** Dropdown switches layers. Legend colorbar and min/max values update.

---

### Phase 4 — Camera controls + responsiveness (30 min)

**Goal:** Orbit controls so users can navigate the scene. Resize handling.

```js
// In main.js — add after splatMesh creation
import { SparkControls } from "@sparkjsdev/spark";

const controls = new SparkControls({
  canvas: renderer.domElement,
  moveSpeed: 1.0,
  rotateSpeed: 2.0,
});

renderer.setAnimationLoop((_, delta) => {
  controls.update(delta / 1000, {
    position: camera.position,
    quaternion: camera.quaternion
  });
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

**Acceptance criteria:** Click-drag orbits the scene. Window resize does not distort the view.

---

### Phase 5 — GitHub Pages deploy (30 min)

**Goal:** Push to `main` branch triggers automatic deployment to `https://<org>.github.io/<repo>/`.

**File:** `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
          exclude_assets: '.github,CLAUDE.md,*.md'
```

**One-time repo setup:**
1. Go to Settings → Pages → Source: `gh-pages` branch
2. Ensure the HF dataset is set to Public (or use HF token via query param for private)

**Acceptance criteria:** Pushing to `main` deploys. The live URL renders the splat.

---

## Preprocessing pipeline (Python, run once locally)

This runs before any web development. It produces the `thematics/` JSON files uploaded to Hugging Face.

```python
# preprocess.py
import numpy as np
import rasterio
from plyfile import PlyData
import json, sys

def project_raster_to_splats(ply_path, raster_path, output_path, layer_id):
    plydata = PlyData.read(ply_path)
    verts = plydata["vertex"]
    gx = np.array(verts["x"], dtype=np.float64)
    gy = np.array(verts["y"], dtype=np.float64)

    with rasterio.open(raster_path) as src:
        xy = list(zip(gx, gy))
        values = np.array([v[0] for v in src.sample(xy)], dtype=np.float32)

    # Mask nodata
    nodata = src.nodata
    values[values == nodata] = np.nan

    output = {
        "id": layer_id,
        "splatCount": len(gx),
        "values": values.tolist()
    }
    with open(output_path, "w") as f:
        json.dump(output, f)
    print(f"Written {output_path} with {len(gx)} values")

if __name__ == "__main__":
    project_raster_to_splats(
        "scene.ply",
        "temperature.tif",
        "thematics/temperature.json",
        "temperature"
    )
```

Upload to Hugging Face:
```bash
pip install huggingface_hub
huggingface-cli upload <org>/<repo> ./thematics/manifest.json thematics/manifest.json
huggingface-cli upload <org>/<repo> ./thematics/temperature.json thematics/temperature.json
huggingface-cli upload <org>/<repo> ./scene.ply scene.ply
```

---

## Known constraints and decisions

| Concern | Decision |
|---|---|
| No build step | Use browser-native ES modules + importmap. No Webpack/Vite needed. |
| CORS on Hugging Face | HF Dataset files are served with permissive CORS headers when public. No proxy needed. |
| Large PLY files | Spark handles streaming load natively. Do not preload the blob manually. |
| `forEachSplat` latency | Acceptable for layer-switch (one-shot). Do not use in the render loop. |
| Blend slider | Phase 1–4 implement hard-switching (replace colors). A smooth GPU blend via `worldModifier` Dyno can be added post-MVP if needed. |
| SH higher-order bands | The preprocessing Python script should zero out `f_rest_*` bands in the PLY to prevent view-dependent color fighting the thematic overlay. |
| Mobile | Spark targets WebGL2 with 98%+ device coverage. Test on iOS Safari and Android Chrome. |

---

## Key API references

| What | URL |
|---|---|
| Spark overview | https://sparkjs.dev/docs/overview/ |
| SplatMesh | https://sparkjs.dev/docs/splat-mesh/ |
| PackedSplats (forEachSplat / setSplat) | https://sparkjs.dev/docs/packed-splats/ |
| Splat editing (SplatEdit / SplatEditSdf) | https://sparkjs.dev/docs/splat-editing/ |
| Dyno shader graph (advanced GPU blend) | https://sparkjs.dev/docs/dyno-overview/ |
| SparkControls | https://sparkjs.dev/docs/controls/ |
| Spark GitHub | https://github.com/sparkjsdev/spark |

---

## Time budget

| Phase | Task | Est. time |
|---|---|---|
| 1 | Scaffold + scene renders | 45 min |
| 2 | Thematic color injection | 90 min |
| 3 | UI panel (dropdown + legend) | 60 min |
| 4 | Camera controls + resize | 30 min |
| 5 | GitHub Pages deploy | 30 min |
| — | Buffer / debugging | 45 min |
| **Total** | | **~5 hours** |
