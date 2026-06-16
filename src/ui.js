export function buildUI(manifest, splatMeshes, camera, helpers = {}, createMesh = null) {
  const panel = document.createElement("div");
  panel.id = "ui-panel";
  panel.innerHTML = `
    <div style="font-weight:bold;margin-bottom:4px">Layers</div>
    ${manifest.scenes.map(s => `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" data-id="${s.id}" ${s.visible ? "checked" : ""}>
        ${s.label}
      </label>
    `).join("")}
    <hr style="border-color:#444;margin:4px 0">
    <div style="font-weight:bold;margin-bottom:2px">Scene</div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="toggle-grid" checked> Grid
    </label>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="toggle-axes" checked> Axes
    </label>
  `;
  document.body.appendChild(panel);

  const debug = document.createElement("div");
  debug.style.cssText = "position:fixed;bottom:16px;left:16px;color:#fff;font-family:monospace;font-size:12px;background:rgba(0,0,0,0.65);padding:6px 10px;border-radius:6px;z-index:9999";
  document.body.appendChild(debug);

  const visibilityState = Object.fromEntries(manifest.scenes.map(s => [s.id, s.visible ?? true]));

  const updateDebug = () => {
    const total = manifest.scenes
      .filter(s => visibilityState[s.id])
      .reduce((sum, s) => {
        const n = splatMeshes[s.id]?.packedSplats?.numSplats;
        return sum + (n ?? s.count ?? 0);
      }, 0);
    const p = camera.position;
    debug.textContent = `pos: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}  |  ${total.toLocaleString()} Gaussians`;
  };

  panel.querySelectorAll("input[type=checkbox]").forEach(cb => {
    if (!cb.dataset.id) return;
    cb.addEventListener("change", () => {
      if (cb.checked && !splatMeshes[cb.dataset.id] && createMesh) {
        const s = manifest.scenes.find(s => s.id === cb.dataset.id);
        if (s) createMesh(s);
      }
      const mesh = splatMeshes[cb.dataset.id];
      if (mesh) mesh.visible = cb.checked;
      visibilityState[cb.dataset.id] = cb.checked;
      updateDebug();
    });
  });

  setInterval(updateDebug, 100);

  document.getElementById("toggle-grid")?.addEventListener("change", e => {
    if (helpers.grid) helpers.grid.visible = e.target.checked;
  });
  document.getElementById("toggle-axes")?.addEventListener("change", e => {
    if (helpers.axes) helpers.axes.visible = e.target.checked;
  });
}
