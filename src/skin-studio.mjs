import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createElement, Pencil, PaintBucket, Pipette, Eraser, Undo2, Redo2, Grid2X2, FlipHorizontal2, FlipVertical2, RotateCw, RotateCcw, Download, Trash2, Box, Save, Check, LockKeyhole } from "lucide";
import { paintStroke, fillPixels, transformPixels, createHistory } from "./skin-studio-model.mjs";
import "./skin-studio.css";

const icons = { pencil: Pencil, fill: PaintBucket, pick: Pipette, erase: Eraser, undo: Undo2, redo: Redo2, grid: Grid2X2, "flip-h": FlipHorizontal2, "flip-v": FlipVertical2, rotate: RotateCw, camera: RotateCcw, export: Download, reset: Trash2, cube: Box, save: Save, equip: Check, lock: LockKeyhole };
const iconButton = (action, label) => `<button type="button" data-action="${action}" title="${label}" aria-label="${label}"><i data-icon="${action}"></i></button>`;

export function mountSkinStudio(menu, api) {
  const old = menu.querySelector(".pixel-skin-editor");
  const nodes = Object.fromEntries(["pixelPalette", "rgbPaletteEditor", "skinStudioSizeSelect", "skinAccessorySelect", "savePixelSkinButton", "equipPixelSkinButton", "saveAccessoryButton", "equipAccessoryButton", "skinStudioMessage"].map(id => [id, document.getElementById(id)]));
  const root = document.createElement("div"); root.className = "studio-remade";
  root.innerHTML = `
    <header class="ss-header"><div><span class="ss-eyebrow">CREATOR WORKSPACE</span><h3>Skin Studio</h3></div><div class="ss-save-actions"><span data-draft-state></span><div data-save-skin></div><div data-save-accessory hidden></div></div></header>
    <div class="ss-workspace">
      <section class="ss-editor" aria-label="Pixel editor">
        <div class="ss-editor-bar"><div class="ss-tabs" role="tablist" aria-label="Edit layer"><button type="button" role="tab" aria-selected="true" data-mode="skin">Cube skin</button><button type="button" role="tab" aria-selected="false" data-mode="accessory">Accessory</button></div><span class="ss-dimensions" data-dimensions></span></div>
        <div class="ss-tools" role="toolbar" aria-label="Drawing tools">
          <div>${iconButton("pencil", "Pencil (B)")}${iconButton("fill", "Fill (G)")}${iconButton("pick", "Eyedropper (I)")}${iconButton("erase", "Erase accessory pixel (E)")}</div>
          <label class="ss-brush">Brush <select data-brush aria-label="Brush size"><option value="1">1 px</option><option value="2">2 px</option><option value="4">4 px</option></select></label>
          <label class="ss-toggle"><input type="checkbox" data-mirror> Mirror</label>
          <div class="ss-history">${iconButton("undo", "Undo (Ctrl+Z)")}${iconButton("redo", "Redo (Ctrl+Shift+Z)")}</div>
        </div>
        <div class="ss-canvas-viewport"><div class="ss-canvas-wrap"><canvas data-paint width="640" height="640" tabindex="0" aria-label="Skin drawing canvas"></canvas></div><div class="ss-lock" hidden><i data-icon="lock"></i><strong>Custom accessories</strong><span>VIP or Premium required</span></div></div>
        <footer class="ss-canvas-footer"><label>Resolution <span data-size-mount></span></label><div>${iconButton("grid", "Toggle pixel grid")}${iconButton("flip-h", "Flip horizontally")}${iconButton("flip-v", "Flip vertically")}${iconButton("rotate", "Rotate clockwise")}</div><label class="ss-zoom">Zoom <input type="range" min="1" max="3" step="0.5" value="1" data-zoom aria-label="Canvas zoom"><output data-zoom-value>100%</output></label><output data-coordinates>0, 0</output></footer>
      </section>
      <aside class="ss-inspector">
        <section class="ss-preview-section"><div class="ss-section-head"><h4>Live preview</h4>${iconButton("camera", "Reset preview camera")}</div><div class="ss-preview" aria-label="3D cube preview"></div><div class="ss-preview-options"><span>Cube / 64 x 64</span><label class="ss-toggle"><input type="checkbox" data-spin> Rotate</label></div></section>
        <section class="ss-palette-section"><div class="ss-section-head"><h4>Palette</h4><span data-color-label></span></div><div data-palette-mount></div><details class="ss-color-details"><summary>Edit color</summary><div data-rgb-mount></div></details></section>
        <section class="ss-accessories"><div class="ss-section-head"><h4>Accessories</h4><span class="ss-access-badge" data-access></span></div><div data-accessory-mount></div><div data-equip-accessory></div></section>
        <div class="ss-file-actions">${iconButton("export", "Export PNG")}${iconButton("reset", "Reset canvas (undo available)")}</div>
      </aside>
    </div><footer class="ss-status"><span data-status-mount></span><span>MINIGAMEWORLD STUDIO</span></footer>`;
  old.querySelector("#pixelSkinGrid").replaceChildren();
  old.querySelector("#accessoryGrid").replaceChildren();
  old.replaceWith(root);
  for (const element of [...menu.children]) if (element !== root) element.hidden = true;
  const $ = selector => root.querySelector(selector);
  const move = (selector, ...ids) => ids.forEach(id => $(selector).append(nodes[id]));
  move("[data-palette-mount]", "pixelPalette"); move("[data-rgb-mount]", "rgbPaletteEditor");
  move("[data-size-mount]", "skinStudioSizeSelect"); move("[data-accessory-mount]", "skinAccessorySelect");
  move("[data-save-skin]", "savePixelSkinButton", "equipPixelSkinButton");
  move("[data-save-accessory]", "saveAccessoryButton"); move("[data-equip-accessory]", "equipAccessoryButton");
  move("[data-status-mount]", "skinStudioMessage"); nodes.skinStudioMessage.hidden = false;
  nodes.skinStudioMessage.setAttribute("role", "status");
  for (const [id, label, icon] of [["savePixelSkinButton", "Save", Save], ["equipPixelSkinButton", "Equip skin", Check], ["saveAccessoryButton", "Save accessory", Save], ["equipAccessoryButton", "Equip accessory", Check]]) {
    nodes[id].replaceChildren(createElement(icon), document.createTextNode(label));
  }
  root.querySelectorAll("[data-icon]").forEach(node => node.replaceWith(createElement(icons[node.dataset.icon])));
  let mode = "skin", tool = "pencil", brush = 1, mirror = false, grid = true, busy = false, owner = api.read().owner;
  let stroke = null, pointer = null, cursor = [0, 0], drawingFrame = 0, disposed = false;
  const history = { skin: createHistory(), accessory: createHistory() };
  const canvas = $("[data-paint]"), ctx = canvas.getContext("2d");
  const textureCanvas = document.createElement("canvas"); textureCanvas.width = textureCanvas.height = 64;
  const accessoryCanvas = document.createElement("canvas"); accessoryCanvas.width = accessoryCanvas.height = 16;
  const abort = new AbortController(), signal = abort.signal;
  const on = (node, name, fn, options = {}) => node.addEventListener(name, fn, { ...options, signal });
  const data = () => api.read()[mode];
  const canEdit = () => !busy && (mode === "skin" || api.read().access);
  const size = () => mode === "skin" ? 64 : 16;
  const resolution = () => mode === "skin" ? api.read().resolution : 16;
  const write = value => { api.write(mode, value); refresh(); };
  const commit = before => history[mode].commit(before, data());
  const change = operation => { if (!canEdit()) return; finishStroke(); const before = data(); write(operation(before)); commit(before); refresh(); };
  const renderPixels = (target, pixels, palette, n) => {
    const c = target.getContext("2d"); c.clearRect(0, 0, target.width, target.height);
    const cell = target.width / n;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] === ".") continue;
      c.fillStyle = palette[Number(pixels[i])] || palette[0];
      c.fillRect(i % n * cell, Math.floor(i / n) * cell, cell, cell);
    }
  };

  let renderer, scene, camera, orbit, cube, accessoryGroup, texture, accessoryTexture, previewFrame = 0;
  const preview = $(".ss-preview"), previewCache = { skin: "", accessory: "", palette: "", kind: "" };
  const drawPreview = () => { if (renderer && menu.classList.contains("open") && !document.hidden) renderer.render(scene, camera); };
  const schedulePreview = () => {
    if (previewFrame || !renderer || disposed) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!menu.classList.contains("open") || document.hidden) return;
      if ($("[data-spin]").checked) { cube.rotation.y += 0.012; accessoryGroup.rotation.y = cube.rotation.y; }
      drawPreview();
      if ($("[data-spin]").checked) schedulePreview();
    });
  };
  const disposeGroup = group => { while (group.children.length) { const child = group.children[0]; group.remove(child); child.geometry?.dispose(); child.material?.dispose(); } };
  const updatePreview = state => {
    const palette = state.palette.join();
    if (previewCache.skin !== state.skin || previewCache.palette !== palette) { renderPixels(textureCanvas, state.skin, state.palette, 64); if (texture) texture.needsUpdate = true; }
    if (previewCache.accessory !== state.accessory || previewCache.palette !== palette) { renderPixels(accessoryCanvas, state.accessory, state.palette, 16); if (accessoryTexture) accessoryTexture.needsUpdate = true; }
    if (renderer && previewCache.kind !== state.kind) {
      disposeGroup(accessoryGroup);
      const mesh = (geometry, color, position, rotation = [0, 0, 0]) => {
        const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 }));
        object.position.set(...position); object.rotation.set(...rotation); accessoryGroup.add(object); return object;
      };
      if (state.kind === "crown") {
        mesh(new THREE.BoxGeometry(1.7, 0.18, 1.7), "#cfb85b", [0, 1.18, 0]);
        for (const x of [-0.67, 0, 0.67]) mesh(new THREE.ConeGeometry(0.18, 0.48, 4), "#e9ca64", [x, 1.48, 0.72]);
      } else if (state.kind === "halo") mesh(new THREE.TorusGeometry(0.9, 0.065, 8, 32), "#84e9d4", [0, 1.45, 0], [Math.PI / 2, 0, 0]);
      else if (state.kind === "cap") { mesh(new THREE.BoxGeometry(2.08, 0.25, 2.08), "#719cb5", [0, 1.12, 0]); mesh(new THREE.BoxGeometry(1.4, 0.09, 0.8), "#48657f", [0, 1.04, 1.1]); }
      else if (state.kind === "headphones") { mesh(new THREE.TorusGeometry(1.1, 0.1, 6, 24, Math.PI), "#9b8cc7", [0, 0.15, 0]); for (const x of [-1.08, 1.08]) mesh(new THREE.BoxGeometry(0.28, 0.65, 0.7), "#b0a3d4", [x, 0.15, 0]); }
      else if (state.kind === "wings") for (const direction of [-1, 1]) mesh(new THREE.BoxGeometry(0.85, 1.35, 0.14), "#a6d0dc", [direction * 1.3, 0.25, -0.6], [0, 0, direction * -0.5]);
      else if (state.kind === "custom") {
        const accessory = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshStandardMaterial({ map: accessoryTexture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
        accessory.position.set(0, 1.7, 0.1); accessoryGroup.add(accessory);
      }
    }
    Object.assign(previewCache, { skin: state.skin, accessory: state.accessory, palette, kind: state.kind });
    if (renderer) schedulePreview();
    else { const fallback = preview.querySelector("canvas"); if (fallback) renderPixels(fallback, state.skin, state.palette, 64); }
  };
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.domElement.setAttribute("aria-label", "Interactive cube preview"); renderer.domElement.tabIndex = 0;
    renderer.domElement.title = "Drag to rotate; scroll to zoom"; preview.append(renderer.domElement);
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50); camera.position.set(4, 3, 5);
    scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x53615b, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
    texture = new THREE.CanvasTexture(textureCanvas); accessoryTexture = new THREE.CanvasTexture(accessoryCanvas);
    for (const item of [texture, accessoryTexture]) { item.magFilter = item.minFilter = THREE.NearestFilter; item.colorSpace = THREE.SRGBColorSpace; item.generateMipmaps = false; }
    cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78 })); scene.add(cube);
    accessoryGroup = new THREE.Group(); scene.add(accessoryGroup);
    const floor = new THREE.GridHelper(8, 16, 0x35534c, 0x26352f); floor.position.y = -1.12; scene.add(floor);
    orbit = new OrbitControls(camera, renderer.domElement); orbit.target.set(0, 0.25, 0); orbit.enablePan = false; orbit.minDistance = 4; orbit.maxDistance = 10; orbit.update(); orbit.saveState(); orbit.addEventListener("change", schedulePreview);
    on(renderer.domElement, "webglcontextlost", event => { event.preventDefault(); api.message("3D preview paused. Reopen Skin Studio to retry."); });
  } catch {
    renderer?.dispose(); renderer = null;
    const fallback = document.createElement("canvas"); fallback.width = fallback.height = 256; fallback.setAttribute("aria-label", "Flat skin preview"); preview.replaceChildren(fallback);
    $("[data-spin]").disabled = true; $("[data-action=camera]").disabled = true;
  }
  const resize = new ResizeObserver(() => {
    if (renderer && preview.clientWidth && preview.clientHeight) { renderer.setSize(preview.clientWidth, preview.clientHeight, false); camera.aspect = preview.clientWidth / preview.clientHeight; camera.updateProjectionMatrix(); schedulePreview(); }
  }); resize.observe(preview);
  const visibility = new MutationObserver(() => { if (menu.classList.contains("open")) refresh(); else { finishStroke(); cancelAnimationFrame(previewFrame); previewFrame = 0; } }); visibility.observe(menu, { attributes: true, attributeFilter: ["class"] });
  on(document, "visibilitychange", () => { if (document.hidden) finishStroke(); else refresh(); });

  function draw() {
    drawingFrame = 0;
    if (disposed) return;
    const state = api.read(), n = size();
    ctx.clearRect(0, 0, 640, 640);
    renderPixels(canvas, state[mode], state.palette, n);
    if (grid) {
      const step = 640 / resolution(); ctx.strokeStyle = "rgba(12,20,18,0.28)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < resolution(); i++) { ctx.moveTo(i * step + 0.5, 0); ctx.lineTo(i * step + 0.5, 640); ctx.moveTo(0, i * step + 0.5); ctx.lineTo(640, i * step + 0.5); } ctx.stroke();
    }
    updatePreview(state);
  }
  function refresh() {
    if (disposed) return;
    const state = api.read();
    if (owner !== state.owner) { stroke = null; pointer = null; history.skin.clear(); history.accessory.clear(); owner = state.owner; }
    root.dataset.mode = mode;
    $("[data-draft-state]").textContent = busy ? "Saving..." : state.dirty ? "Unsaved changes" : state.signedIn ? "Saved" : "Guest draft";
    $("[data-dimensions]").textContent = `${resolution()} x ${resolution()} px`;
    $("[data-color-label]").textContent = state.palette[state.color].toUpperCase();
    $("[data-access]").textContent = state.access ? "Unlocked" : "VIP / Premium";
    $(".ss-lock").hidden = mode !== "accessory" || state.access;
    canvas.setAttribute("aria-label", `${mode === "skin" ? "Skin" : "Accessory"} drawing canvas`);
    $("[data-save-skin]").hidden = mode !== "skin"; $("[data-save-accessory]").hidden = mode !== "accessory";
    nodes.savePixelSkinButton.disabled = nodes.equipPixelSkinButton.disabled = busy || !state.signedIn;
    nodes.saveAccessoryButton.disabled = busy || !state.signedIn || !state.access;
    nodes.equipAccessoryButton.disabled = busy || !state.signedIn || (state.kind === "custom" && !state.access);
    nodes.skinStudioSizeSelect.disabled = mode === "accessory" || busy;
    nodes.skinStudioSizeSelect.value = String(resolution());
    $("[data-action=undo]").disabled = !canEdit() || !history[mode].canUndo;
    $("[data-action=redo]").disabled = !canEdit() || !history[mode].canRedo;
    $("[data-action=erase]").disabled = mode === "skin" || !canEdit();
    for (const button of root.querySelectorAll("[data-mode]")) button.setAttribute("aria-selected", String(button.dataset.mode === mode));
    for (const name of ["pencil", "fill", "pick", "erase"]) $("[data-action=" + name + "]").setAttribute("aria-pressed", String(tool === name));
    $("[data-action=grid]").setAttribute("aria-pressed", String(grid));
    if (!drawingFrame) drawingFrame = requestAnimationFrame(draw);
  }
  function finishStroke() {
    if (stroke !== null) { commit(stroke); stroke = null; }
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    pointer = null; refresh();
  }
  const coordinates = event => { const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top].map((value, i) => Math.max(0, Math.min(resolution() - 1, Math.floor(value / (i ? rect.height : rect.width) * resolution())))); };
  const paint = (from, to) => write(paintStroke(data(), size(), from, to, tool === "erase" ? "." : String(api.read().color), brush, mirror, resolution()));
  on(canvas, "pointerdown", event => {
    if (event.button !== 0 || !canEdit()) return;
    event.preventDefault(); canvas.focus(); const point = coordinates(event), scale = size() / resolution();
    if (tool === "pick") { const value = data()[point[1] * scale * size() + point[0] * scale]; if (value !== ".") api.color(Number(value)); refresh(); return; }
    if (tool === "fill") { change(value => fillPixels(value, size(), point[0] * scale, point[1] * scale, String(api.read().color))); return; }
    stroke = data(); pointer = event.pointerId; canvas.setPointerCapture(pointer); cursor = point; paint(point, point);
  });
  on(canvas, "pointermove", event => { const point = coordinates(event); $("[data-coordinates]").textContent = point.join(", "); if (pointer !== event.pointerId) return; paint(cursor, point); cursor = point; });
  on(canvas, "pointerup", finishStroke); on(canvas, "pointercancel", finishStroke); on(canvas, "lostpointercapture", () => { if (pointer !== null) finishStroke(); });
  on(window, "blur", finishStroke);
  on(root, "click", event => {
    const tab = event.target.closest("[role=tab][data-mode]");
    if (tab) { finishStroke(); mode = tab.dataset.mode; tool = "pencil"; refresh(); return; }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    finishStroke();
    if (["pencil", "fill", "pick", "erase"].includes(action)) tool = action;
    else if (action === "undo" || action === "redo") { if (canEdit()) write(history[mode][action](data())); }
    else if (action === "grid") grid = !grid;
    else if (["flip-h", "flip-v", "rotate"].includes(action)) change(value => transformPixels(value, size(), action));
    else if (action === "reset") change(() => api.blank(mode));
    else if (action === "camera") { cube.rotation.y = accessoryGroup.rotation.y = 0; orbit.reset(); schedulePreview(); }
    else if (action === "export") {
      const output = document.createElement("canvas"); output.width = output.height = size(); renderPixels(output, data(), api.read().palette, size());
      output.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `minigameworld-${mode}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
    }
    refresh();
  });
  on($("[data-brush]"), "change", event => { brush = Number(event.target.value); });
  on($("[data-mirror]"), "change", event => { mirror = event.target.checked; });
  on($("[data-spin]"), "change", schedulePreview);
  on($("[data-zoom]"), "input", event => { $(".ss-canvas-wrap").style.setProperty("--zoom", event.target.value); $("[data-zoom-value]").textContent = `${Number(event.target.value) * 100}%`; });
  on(root, "keydown", event => {
    if (event.target.matches("input,select,textarea") || busy) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); $(event.shiftKey ? "[data-action=redo]" : "[data-action=undo]").click(); }
    else if (!event.ctrlKey && !event.metaKey && !event.altKey) { const action = { b: "pencil", g: "fill", i: "pick", e: "erase" }[key]; if (action) { event.preventDefault(); $("[data-action=" + action + "]").click(); } }
  });
  refresh();
  return {
    refresh,
    setBusy(value) { finishStroke(); busy = value; root.classList.toggle("ss-busy", value); refresh(); },
    dispose() { disposed = true; abort.abort(); resize.disconnect(); visibility.disconnect(); cancelAnimationFrame(drawingFrame); cancelAnimationFrame(previewFrame); orbit?.dispose(); if (scene) scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }); texture?.dispose(); accessoryTexture?.dispose(); renderer?.dispose(); }
  };
}
