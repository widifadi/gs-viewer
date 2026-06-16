import * as THREE from "three";

function makeLabel(text, hexColor) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = hexColor;
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
}

export function createGizmo(mainCamera, sceneTarget = new THREE.Vector3(0, 0, 0)) {
  const SIZE = 128;

  const gizmoCanvas = document.createElement("canvas");
  gizmoCanvas.style.cssText = [
    "position:fixed", "top:16px", "right:16px",
    `width:${SIZE}px`, `height:${SIZE}px`,
    "z-index:100", "border-radius:50%",
    "background:rgba(0,0,0,0.35)", "cursor:default",
    "display:none",  // hidden until mouse enters
  ].join(";");
  document.body.appendChild(gizmoCanvas);

  const renderer = new THREE.WebGLRenderer({ canvas: gizmoCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(SIZE, SIZE);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  cam.position.z = 5;

  const group = new THREE.Group();
  scene.add(group);

  const axisDefs = [
    { dir: [ 1, 0, 0], color: "#ff4444", hex: 0xff4444, label: "X"  },
    { dir: [-1, 0, 0], color: "#ff9999", hex: 0xff9999, label: "-X" },
    { dir: [ 0, 1, 0], color: "#44ff44", hex: 0x44ff44, label: "Y"  },
    { dir: [ 0,-1, 0], color: "#99ff99", hex: 0x99ff99, label: "-Y" },
    { dir: [ 0, 0, 1], color: "#4488ff", hex: 0x4488ff, label: "Z"  },
    { dir: [ 0, 0,-1], color: "#99bbff", hex: 0x99bbff, label: "-Z" },
  ];

  const clickTargets = [];

  axisDefs.forEach(def => {
    const dir = new THREE.Vector3(...def.dir);
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 0.75, def.hex, 0.22, 0.11);
    arrow.userData.snapDir = def.dir;
    group.add(arrow);

    const label = makeLabel(def.label, def.color);
    label.position.copy(dir.clone().multiplyScalar(1.05));
    label.scale.set(0.38, 0.38, 0.38);
    label.userData.snapDir = def.dir;
    group.add(label);

    clickTargets.push(arrow.line, arrow.cone);
  });

  // Hover / click
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let snapDir = null;

  const getSnap = e => {
    const rect = gizmoCanvas.getBoundingClientRect();
    mouse.set(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, cam);
    const hits = raycaster.intersectObjects(clickTargets, false);
    return hits.length ? hits[0].object.parent?.userData?.snapDir ?? null : null;
  };

  gizmoCanvas.addEventListener("mousemove", e => {
    snapDir = getSnap(e);
    gizmoCanvas.style.cursor = snapDir ? "pointer" : "default";
  });

  gizmoCanvas.addEventListener("click", () => {
    if (!snapDir) return;
    const dist = mainCamera.position.distanceTo(sceneTarget);
    const [sx, sy, sz] = snapDir;
    mainCamera.position.set(
      sceneTarget.x + sx * dist,
      sceneTarget.y + sy * dist,
      sceneTarget.z + sz * dist
    );
    mainCamera.lookAt(sceneTarget);
  });

  // Show/hide on hover near top-right corner
  const TRIGGER = SIZE + 32;
  window.addEventListener("mousemove", e => {
    const nearRight = window.innerWidth  - e.clientX < TRIGGER;
    const nearTop   = e.clientY < TRIGGER;
    gizmoCanvas.style.display = (nearRight && nearTop) ? "block" : "none";
  });

  return {
    update() {
      group.quaternion.copy(mainCamera.quaternion).invert();
      renderer.render(scene, cam);
    }
  };
}
