import * as THREE from "three";
import { SparkRenderer, SplatMesh, FpsMovement, PointerControls } from "@sparkjsdev/spark";
import { loadManifest } from "./loader.js";
import { buildUI } from "./ui.js";

// TODO: replace with your Hugging Face manifest URL once uploaded
const MANIFEST_URL = "./manifest.dev.json";

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
  1000
);
camera.position.set(0, 0, 3);

const fpsMovement = new FpsMovement({ moveSpeed: 2.0 });
const pointerControls = new PointerControls({
  canvas: renderer.domElement,
  scrollSpeed: 0.6,  // 4× default (0.0015) — faster zoom
  slideSpeed: 0.6,    // 5× default (0.006) — right-click drag to pan
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const manifest = await loadManifest(MANIFEST_URL);

const splatMesh = new SplatMesh({ url: manifest.splatUrl });
scene.add(splatMesh);

document.getElementById("loading").style.display = "none";

buildUI(manifest, splatMesh);

let lastTime = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  fpsMovement.update(delta, camera);
  pointerControls.update(delta, camera);
  renderer.render(scene, camera);
});
