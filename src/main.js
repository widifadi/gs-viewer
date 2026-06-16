import * as THREE from "three";
import { SparkRenderer, SplatMesh, FpsMovement, PointerControls } from "@sparkjsdev/spark";
import { loadManifest } from "./loader.js";
import { buildUI } from "./ui.js";
import { createGizmo } from "./gizmo.js";

const isMobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
const MANIFEST_URL = window.location.hostname === "localhost"
  ? "./manifest.dev.json"
  : isMobile ? "./manifest.mobile.json" : "./manifest.json";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
const scene = new THREE.Scene();
scene.add(spark);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);

const fpsMovement = new FpsMovement({ moveSpeed: 2.0 });
const pointerControls = new PointerControls({
  canvas: renderer.domElement,
  scrollSpeed: 0.02,
  slideSpeed: isMobile ? 0.006 : 0,  // mobile: two-finger pan; desktop: disabled (middle mouse used instead)
});

// Middle mouse pan (desktop only)
if (!isMobile) {
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  let isPanning = false;
  let lastPanX = 0, lastPanY = 0;
  renderer.domElement.addEventListener("pointerdown", e => {
    if (e.button === 1) { isPanning = true; lastPanX = e.clientX; lastPanY = e.clientY; e.preventDefault(); }
  });
  renderer.domElement.addEventListener("pointermove", e => {
    if (!isPanning) return;
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    lastPanX = e.clientX; lastPanY = e.clientY;
    const panSpeed = camera.position.length() * 0.0002;
    _right.setFromMatrixColumn(camera.matrix, 0);
    _up.setFromMatrixColumn(camera.matrix, 1);
    camera.position.addScaledVector(_right, -dx * panSpeed);
    camera.position.addScaledVector(_up, dy * panSpeed);
  });
  renderer.domElement.addEventListener("pointerup", e => { if (e.button === 1) isPanning = false; });
  renderer.domElement.addEventListener("pointerleave", () => { isPanning = false; });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const manifest = await loadManifest(MANIFEST_URL);

const cam = manifest.camera ?? { position: [0, 100, 80], target: [0, 0, -20] };
if (cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
camera.position.set(...cam.position);
camera.lookAt(...cam.target);

const grid = manifest.grid ?? { size: 200, divisions: 20 };
const gridHelper = new THREE.GridHelper(grid.size, grid.divisions, 0x444444, 0x222222);
const axesHelper = new THREE.AxesHelper(30);
scene.add(gridHelper);
scene.add(axesHelper);

const splatMeshes = {};
for (const s of manifest.scenes) {
  if (s.visible !== false) {
    const mesh = new SplatMesh({ url: s.url });
    scene.add(mesh);
    splatMeshes[s.id] = mesh;
  }
}

const createMesh = (s) => {
  if (splatMeshes[s.id]) return splatMeshes[s.id];
  const mesh = new SplatMesh({ url: s.url });
  scene.add(mesh);
  splatMeshes[s.id] = mesh;
  return mesh;
};

document.getElementById("loading").style.display = "none";

const sceneTarget = new THREE.Vector3(...(manifest.camera?.target ?? [0, 0, -20]));
const gizmo = createGizmo(camera, sceneTarget);

buildUI(manifest, splatMeshes, camera, { grid: gridHelper, axes: axesHelper }, createMesh);

let lastTime = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  fpsMovement.update(delta, camera);
  pointerControls.update(delta, camera);
  renderer.render(scene, camera);
  gizmo.update();
});
