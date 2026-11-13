import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createElement, Save, Trash2, RotateCw, X, Plus, Camera, ChevronDown, ChevronUp, Sofa, Table2, Gamepad2, Leaf, Library, LampFloor, Trophy, LockKeyhole } from "lucide";
import { FURNITURE, ROOM_COLORS, COLOR_NAMES, MAX_FURNITURE, normalizeClubhouse, defaultClubhouse, placementError, findFreePlacement } from "./clubhouse-model.mjs";
export { normalizeClubhouse, defaultClubhouse } from "./clubhouse-model.mjs";

const icon = shape => createElement(shape, { width: 20, height: 20, "aria-hidden": "true", focusable: "false" });
let editorNumber = 0;

export function mountClubhouse(host, options = {}) {
  const abort = new AbortController(), signal = abort.signal, uid = `club-${++editorNumber}`;
  const unlockedTrophy = options.trophies === true;
  let data = options.value ? normalizeClubhouse(options.value, unlockedTrophy) : defaultClubhouse();
  let savedValue = JSON.stringify(data), selected = "", busy = false, disposed = false, frame = 0, renderedFrames = 0, tab = "furniture", collapsed = false;
  let state = "saved", message = "All changes saved", down = null, contextLost = false, cameraFitted = true;
  const dirty = () => JSON.stringify(data) !== savedValue;
  const on = (node, event, callback) => node.addEventListener(event, callback, { signal });
  host.classList.add("mgw-clubhouse");
  host.innerHTML = `<header class="club-toolbar"><div class="club-title"><h2>Clubhouse</h2><span data-club-owner></span></div><div class="club-room-colors" role="group" aria-label="Room color"></div><div class="club-commands"><button type="button" data-club-save title="Save clubhouse" aria-label="Save clubhouse"></button><button type="button" data-club-camera title="Reset camera" aria-label="Reset clubhouse camera"></button><button type="button" data-club-exit title="Return to Adventures" aria-label="Close clubhouse"></button></div></header>
    <section class="club-dock" aria-label="Clubhouse editor"><div class="club-dock-header"><div role="tablist" aria-label="Editor tools"><button type="button" id="${uid}-furniture-tab" role="tab" data-club-tab="furniture" aria-controls="${uid}-furniture">Furniture</button><button type="button" id="${uid}-selection-tab" role="tab" data-club-tab="selection" aria-controls="${uid}-selection">Selected</button></div><span data-club-count></span><button type="button" data-club-collapse title="Collapse editor" aria-label="Collapse editor" aria-expanded="true" aria-controls="${uid}-body"></button></div>
    <div class="club-dock-body" id="${uid}-body"><section class="club-palette" role="tabpanel" id="${uid}-furniture" aria-labelledby="${uid}-furniture-tab"><div data-club-items></div><p class="club-unlock" data-club-unlock></p></section>
    <section class="club-inspector" role="tabpanel" id="${uid}-selection" aria-labelledby="${uid}-selection-tab" hidden><label class="club-item-picker">Furniture <select aria-label="Selected furniture"></select></label><div class="club-item-controls"><label>X <input aria-label="Furniture X" type="number" min="-7" max="7" step="1" inputmode="numeric"></label><label>Z <input aria-label="Furniture Z" type="number" min="-6" max="6" step="1" inputmode="numeric"></label><div class="club-item-colors" role="group" aria-label="Furniture color"></div><button type="button" data-club-rotate title="Rotate furniture" aria-label="Rotate furniture"></button><button type="button" data-club-delete title="Remove furniture" aria-label="Remove furniture"></button></div></section></div>
    <p class="club-status" data-club-status role="status" aria-live="polite" aria-atomic="true"></p></section>`;
  for (const [action, shape] of [["save", Save], ["camera", Camera], ["exit", X], ["rotate", RotateCw], ["delete", Trash2], ["collapse", ChevronDown]]) host.querySelector(`[data-club-${action}]`).append(icon(shape));
  host.querySelector("[data-club-owner]").textContent = options.name || "Guest";
  host.querySelector("[data-club-unlock]").textContent = unlockedTrophy ? "Mastery Trophy unlocked" : "Mastery Trophy locked: complete a game mastery.";
  const status = host.querySelector("[data-club-status]"), dockBody = host.querySelector(".club-dock-body"), picker = host.querySelector('[aria-label="Selected furniture"]');
  const xInput = host.querySelector('[aria-label="Furniture X"]'), zInput = host.querySelector('[aria-label="Furniture Z"]');
  const saveButton = host.querySelector("[data-club-save]"), collapseButton = host.querySelector("[data-club-collapse]");
  const toolbar = host.querySelector(".club-toolbar"), dock = host.querySelector(".club-dock");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" }); }
  catch {
    host.innerHTML = '<section class="club-unavailable"><h2>Clubhouse</h2><p role="status">3D graphics unavailable. Your saved room has not changed.</p><button type="button">Back</button></section>';
    on(host.querySelector("button"), "click", () => options.onExit?.());
    return { snapshot: () => ({ ...normalizeClubhouse(data, unlockedTrophy), available: false, disposed }), dispose() { if (disposed) return; disposed = true; abort.abort(); host.replaceChildren(); host.classList.remove("mgw-clubhouse"); } };
  }
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Clubhouse room. Select furniture; arrow keys move it, R rotates, Delete removes, Escape deselects.");
  canvas.setAttribute("role", "img"); canvas.tabIndex = 0; host.prepend(canvas);
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#9aaead");
  scene.add(new THREE.HemisphereLight("#ecf1f4", "#50635b", 2.5));
  const light = new THREE.DirectionalLight("#fff1dc", 3); light.position.set(6, 14, 8); scene.add(light);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 150), controls = new OrbitControls(camera, canvas);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.minDistance = 10; controls.maxDistance = 120; controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.35; controls.enableDamping = true;
  controls.minAzimuthAngle = 0.08; controls.maxAzimuthAngle = Math.PI / 2 - 0.08;
  controls.cursor.set(0, 2, 0); controls.maxTargetRadius = 8;
  const manualCamera = () => { cameraFitted = false; };
  controls.addEventListener("start", manualCamera);
  const geometries = new Set(), materials = new Set(), textures = new Set(), models = new Map();
  const cube = new THREE.BoxGeometry(1, 1, 1), crystal = new THREE.OctahedronGeometry(0.35); geometries.add(cube); geometries.add(crystal);
  const mat = hex => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 }); materials.add(m); return m; };
  // Geometry and paint are shared; moving/recoloring items never allocates GPU resources.
  const paints = new Map(ROOM_COLORS.map(hex => [hex, mat(hex)]));
  const wall = mat("#d5dfd8"), dark = mat("#273d42"), floorMat = mat("#83938c"), accent = mat(data.accent), gold = mat("#c8a749"), screen = mat("#608ca3"), leafMat = mat("#4a8267"), trim = mat("#bbc5b9");
  const box = (parent, x, y, z, w, h, d, material, paint = false) => {
    const mesh = new THREE.Mesh(cube, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.userData.paint = paint; parent.add(mesh); return mesh;
  };
  const floor = box(scene, 0, -0.12, 0, 16, 0.24, 14, floorMat);
  box(scene, 0, -0.35, 0, 16.4, 0.35, 14.4, dark);
  box(scene, 0, 2.8, -7, 16, 5.6, 0.25, wall); box(scene, -8, 2.8, 0, 0.25, 5.6, 14, wall);
  box(scene, 0, 0.25, -6.82, 16, 0.4, 0.15, accent); box(scene, -7.82, 0.25, 0, 0.15, 0.4, 14, accent);
  box(scene, 0, 5.55, -7, 16.2, 0.18, 0.4, trim); box(scene, -8, 5.55, 0, 0.4, 0.18, 14, trim);
  box(scene, 3, 3.1, -6.81, 6, 2.9, 0.12, screen);
  for (const x of [0, 3, 6]) box(scene, x, 3.1, -6.65, 0.14, 3.05, 0.1, trim);
  for (const y of [1.6, 3.1, 4.6]) box(scene, 3, y, -6.65, 6.15, 0.12, 0.1, trim);
  box(scene, 3, 1.55, -6.6, 6.35, 0.15, 0.55, trim);
  const poster = document.createElement("canvas"); poster.width = 512; poster.height = 256;
  const ctx = poster.getContext("2d"); ctx.fillStyle = "#294039"; ctx.fillRect(0, 0, 512, 256); ctx.fillStyle = "#cae2d4"; ctx.font = "bold 35px Arial"; ctx.textAlign = "center"; ctx.fillText("MINIGAMEWORLD", 256, 100); ctx.font = "25px Arial"; ctx.fillText(String(options.clan || "PLAYER CLUBHOUSE").slice(0, 32), 256, 157, 450);
  const texture = new THREE.CanvasTexture(poster); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
  const posterMat = new THREE.MeshStandardMaterial({ map: texture }); materials.add(posterMat);
  box(scene, -4.2, 3.2, -6.8, 5.2, 2.7, 0.12, dark); box(scene, -4.2, 3.2, -6.7, 5, 2.5, 0.12, posterMat);
  const grid = new THREE.GridHelper(14, 14, "#758d80", "#8b9c90"); grid.position.y = 0.015; scene.add(grid);
  const selection = new THREE.BoxHelper(new THREE.Object3D(), "#f4d982"); selection.visible = false; scene.add(selection);
  geometries.add(grid.geometry); geometries.add(selection.geometry); materials.add(grid.material); materials.add(selection.material);

  function makeFurniture(item) {
    const group = new THREE.Group(), paint = paints.get(item.color); group.userData.id = item.id;
    const painted = (x, y, z, w, h, d) => box(group, x, y, z, w, h, d, paint, true);
    if (item.kind === "sofa") { painted(0, 0.55, 0, 2.8, 0.65, 0.9); painted(0, 1.05, -0.32, 2.8, 0.8, 0.25); for (const x of [-1.3, 1.3]) box(group, x, 0.9, 0, 0.25, 0.75, 0.9, dark); for (const x of [-0.7, 0, 0.7]) painted(x, 0.92, 0.1, 0.65, 0.16, 0.65); }
    if (item.kind === "table") { painted(0, 0.8, 0, 1.8, 0.15, 1.8); for (const x of [-0.65, 0.65]) for (const z of [-0.65, 0.65]) box(group, x, 0.4, z, 0.15, 0.8, 0.15, dark); }
    if (item.kind === "arcade") { painted(0, 0.9, 0, 0.85, 1.8, 0.8); box(group, 0, 1.25, 0.42, 0.65, 0.6, 0.06, screen); box(group, 0, 1.9, 0, 0.95, 0.3, 0.85, dark); box(group, -0.18, 0.92, 0.44, 0.1, 0.12, 0.1, gold); box(group, 0.14, 0.9, 0.44, 0.16, 0.06, 0.1, accent); }
    if (item.kind === "plant") { painted(0, 0.3, 0, 0.6, 0.6, 0.6); box(group, 0, 0.8, 0, 0.12, 0.8, 0.12, dark); for (let i = 0; i < 3; i++) { const leaf = box(group, Math.sin(i * 2) * 0.16, 1 + i * 0.14, Math.cos(i * 2) * 0.16, 0.55, 0.22, 0.55, leafMat); leaf.rotation.z = 0.3; } }
    if (item.kind === "shelf") { for (const y of [0.2, 0.9, 1.6, 2.3]) box(group, 0, y, 0, 1.9, 0.12, 0.8, dark); for (const x of [-0.9, 0.9]) painted(x, 1.25, 0, 0.12, 2.5, 0.8); for (let i = 0; i < 5; i++) { if (i % 2) box(group, -0.65 + i * 0.3, 1.17, 0, 0.19, 0.55, 0.45, gold); else painted(-0.65 + i * 0.3, 1.17, 0, 0.19, 0.45, 0.45); } }
    if (item.kind === "lamp") { box(group, 0, 0.08, 0, 0.65, 0.16, 0.65, dark); box(group, 0, 1.1, 0, 0.1, 2, 0.1, dark); painted(0, 2, 0, 0.7, 0.5, 0.7); box(group, 0, 1.73, 0, 0.55, 0.04, 0.55, gold); }
    if (item.kind === "trophy") { painted(0, 0.5, 0, 0.75, 1, 0.75); box(group, 0, 1.1, 0, 0.4, 0.2, 0.4, gold); box(group, 0, 1.35, 0, 0.12, 0.5, 0.12, gold); const gem = new THREE.Mesh(crystal, gold); gem.position.y = 1.7; group.add(gem); }
    scene.add(group); models.set(item.id, group); return group;
  }
  function invalidate() { if (!disposed && !contextLost && !document.hidden && !frame) frame = requestAnimationFrame(draw); }
  function draw() { frame = 0; if (disposed || contextLost || document.hidden) return; const moving = controls.update(); renderer.render(scene, camera); renderedFrames++; if (moving) invalidate(); }
  controls.addEventListener("change", invalidate);
  function syncScene() {
    for (const [id, group] of models) if (!data.items.some(item => item.id === id)) { scene.remove(group); models.delete(id); }
    for (const item of data.items) {
      const group = models.get(item.id) || makeFurniture(item); group.position.set(item.x, 0, item.z); group.rotation.y = item.rotation * Math.PI / 2;
      group.traverse(node => { if (node.userData.paint) node.material = paints.get(item.color); });
    }
    accent.color.set(data.accent); scene.updateMatrixWorld(true); invalidate();
  }
  function setStatus(next, text) { state = next; message = text; status.textContent = text; status.dataset.state = next; }
  function update() {
    if (disposed) return;
    const item = data.items.find(item => item.id === selected);
    selection.visible = !!item; if (item) selection.setFromObject(models.get(item.id));
    const oldIds = [...picker.options].slice(1).map(option => option.value).join();
    if (!picker.options.length || oldIds !== data.items.map(i => i.id).join()) {
      picker.replaceChildren(new Option("Select furniture", ""));
      for (const [i, furniture] of data.items.entries()) picker.append(new Option(`${FURNITURE.find(f => f.id === furniture.kind).name} ${i + 1}`, furniture.id));
    }
    picker.value = selected; picker.disabled = busy || !data.items.length;
    xInput.value = item?.x ?? ""; zInput.value = item?.z ?? "";
    for (const input of [xInput, zInput]) input.disabled = busy || !item;
    for (const action of ["rotate", "delete"]) host.querySelector(`[data-club-${action}]`).disabled = busy || !item;
    for (const button of host.querySelectorAll("[data-club-color]")) {
      const room = button.dataset.target === "room"; button.disabled = busy || (!room && !item);
      button.setAttribute("aria-pressed", String(button.dataset.clubColor === (room ? data.accent : item?.color)));
    }
    for (const button of host.querySelectorAll("[data-furniture]")) {
      const locked = button.dataset.furniture === "trophy" && !unlockedTrophy;
      button.disabled = busy || locked || data.items.length >= MAX_FURNITURE;
      button.title = locked ? "Complete a game mastery to unlock" : data.items.length >= MAX_FURNITURE ? "Room limit: 24 items" : `Add ${FURNITURE.find(f => f.id === button.dataset.furniture).name}`;
    }
    for (const button of host.querySelectorAll("[data-club-tab]")) { const active = button.dataset.clubTab === tab; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; }
    host.querySelector(".club-palette").hidden = tab !== "furniture";
    host.querySelector(".club-inspector").hidden = tab !== "selection";
    dockBody.hidden = collapsed;
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    collapseButton.setAttribute("aria-label", collapsed ? "Expand editor" : "Collapse editor"); collapseButton.title = collapsed ? "Expand editor" : "Collapse editor";
    collapseButton.replaceChildren(icon(collapsed ? ChevronUp : ChevronDown));
    host.querySelector("[data-club-count]").textContent = `${data.items.length} / ${MAX_FURNITURE}`;
    saveButton.disabled = busy || !dirty(); saveButton.title = busy ? "Saving clubhouse" : dirty() ? "Save clubhouse" : "All changes saved";
    host.querySelector("[data-club-exit]").disabled = busy;
    host.setAttribute("aria-busy", String(busy));
    invalidate();
  }
  function changed() { setStatus(dirty() ? "unsaved" : "saved", dirty() ? "Unsaved changes" : "All changes saved"); syncScene(); update(); }
  function select(id, open = true) { selected = data.items.some(item => item.id === id) ? id : ""; if (open) { tab = "selection"; collapsed = false; } update(); }
  function move(patch) {
    const item = data.items.find(i => i.id === selected); if (!item || busy || disposed) return;
    const next = { ...item, ...patch }, error = placementError(data.items, next);
    if (error) { setStatus("error", error); update(); return; }
    if (next.color && !ROOM_COLORS.includes(next.color)) return;
    Object.assign(item, next); changed();
  }
  function remove() { if (busy || disposed || !selected) return; data.items = data.items.filter(item => item.id !== selected); selected = ""; changed(); }
  function rotate() { const item = data.items.find(item => item.id === selected); if (item) move({ rotation: (item.rotation + 1) % 4 }); }
  for (const target of ["room", "item"]) for (const [i, hex] of ROOM_COLORS.entries()) {
    const button = document.createElement("button"); button.type = "button"; button.className = "club-color"; button.dataset.clubColor = hex; button.dataset.target = target;
    button.style.setProperty("--club-swatch", hex); button.setAttribute("aria-label", `${target === "room" ? "Room" : "Furniture"} color: ${COLOR_NAMES[i]}`); button.title = COLOR_NAMES[i];
    on(button, "click", () => { if (busy) return; if (target === "item") move({ color: hex }); else { data.accent = hex; changed(); } });
    host.querySelector(target === "room" ? ".club-room-colors" : ".club-item-colors").append(button);
  }
  const shapes = [Sofa, Table2, Gamepad2, Leaf, Library, LampFloor, Trophy];
  for (const [i, furniture] of FURNITURE.entries()) {
    const button = document.createElement("button"); button.type = "button"; button.dataset.furniture = furniture.id;
    button.append(icon(shapes[i]), document.createTextNode(furniture.name));
    if (furniture.id === "trophy" && !unlockedTrophy) button.append(icon(LockKeyhole));
    else { const plus = icon(Plus); plus.classList.add("club-add"); button.append(plus); }
    on(button, "click", () => {
      if (busy || disposed || furniture.id === "trophy" && !unlockedTrophy) return;
      if (data.items.length >= MAX_FURNITURE) { setStatus("error", "Room limit: 24 items"); return; }
      const item = findFreePlacement(data.items, { id: `item-${crypto.randomUUID().slice(0, 30)}`, kind: furniture.id, x: 0, z: 0, rotation: 0, color: data.accent });
      if (!item) { setStatus("error", "No free space for this item."); return; }
      data.items.push(item); selected = item.id; tab = "selection"; changed();
    }); host.querySelector("[data-club-items]").append(button);
  }
  on(picker, "change", () => select(picker.value));
  on(xInput, "change", () => move({ x: xInput.value === "" ? NaN : Number(xInput.value) }));
  on(zInput, "change", () => move({ z: zInput.value === "" ? NaN : Number(zInput.value) }));
  on(host.querySelector("[data-club-rotate]"), "click", rotate); on(host.querySelector("[data-club-delete]"), "click", remove);
  for (const button of host.querySelectorAll("[data-club-tab]")) {
    on(button, "click", () => { tab = button.dataset.clubTab; collapsed = false; update(); });
    on(button, "keydown", event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); tab = event.key === "Home" ? "furniture" : event.key === "End" ? "selection" : tab === "selection" ? "furniture" : "selection"; collapsed = false; update(); host.querySelector(`[data-club-tab="${tab}"]`).focus(); } });
  }
  on(collapseButton, "click", () => { collapsed = !collapsed; update(); });
  const roomCorners = [];
  for (const x of [-8.2, 8.2]) for (const y of [-0.6, 5.7]) for (const z of [-7.2, 7.2]) roomCorners.push(new THREE.Vector3(x, y, z));
  let viewport = { top: 0, bottom: 0, width: 0, height: 0 };
  function frameCamera() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const rect = host.getBoundingClientRect(), top = toolbar.getBoundingClientRect().bottom - rect.top + 10;
    const bottom = Math.max(top + 60, dock.getBoundingClientRect().top - rect.top - 10), visibleHeight = bottom - top;
    viewport = { top, bottom, width: w, height: h };
    // Shift the optical center into the unobscured canvas, keeping the canvas full-bleed.
    camera.setViewOffset(w, h, 0, (h - top - bottom) / 2, w, h);
    if (cameraFitted) {
      const target = new THREE.Vector3(0, 2.3, 0), direction = new THREE.Vector3(0.55, 0.9, 1).normalize();
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right);
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      let distance = 10;
      for (const corner of roomCorners) {
        const delta = corner.clone().sub(target), depth = delta.dot(direction);
        distance = Math.max(distance, depth + Math.abs(delta.dot(right)) / (tangent * w / h * 0.93), depth + Math.abs(delta.dot(up)) / (tangent * visibleHeight / h * 0.93));
      }
      controls.maxDistance = Math.max(120, distance * 1.5);
      camera.far = Math.max(150, controls.maxDistance + 30);
      // Flush damping before assigning a deterministic reset position.
      const damping = controls.enableDamping; controls.enableDamping = false; controls.update();
      controls.target.copy(target); camera.position.copy(direction.multiplyScalar(distance).add(target)); controls.update(); controls.enableDamping = damping;
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); invalidate();
  }
  function resetCamera() { cameraFitted = true; frameCamera(); }
  on(host.querySelector("[data-club-camera]"), "click", resetCamera);
  async function save() {
    if (busy || !dirty() || disposed) return;
    const value = normalizeClubhouse(data, unlockedTrophy), savingValue = JSON.stringify(value); busy = true; setStatus("saving", "Saving..."); update();
    try {
      if (typeof options.onSave !== "function") throw new Error("Saving unavailable");
      await options.onSave(value);
      if (!disposed) { savedValue = savingValue; setStatus("saved", "Clubhouse saved"); }
    } catch { if (!disposed) setStatus("error", "Save failed. Your edits are still here; retry."); }
    finally { busy = false; if (!disposed) update(); }
  }
  on(saveButton, "click", save);
  on(host.querySelector("[data-club-exit]"), "click", () => { if (busy) return; if (dirty() && !confirm("Leave without saving clubhouse changes?")) return; options.onExit?.(); });
  on(window, "beforeunload", event => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } });
  on(host, "keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") { event.preventDefault(); save(); return; }
    if (event.target !== canvas || event.ctrlKey || event.metaKey || event.altKey) return;
    const item = data.items.find(item => item.id === selected), directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key] && item) { event.preventDefault(); move({ x: item.x + directions[event.key][0], z: item.z + directions[event.key][1] }); }
    else if (event.code === "KeyR") { event.preventDefault(); rotate(); }
    else if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); remove(); }
    else if (event.key === "Escape") { event.preventDefault(); select("", false); }
  });
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const pointers = new Set();
  const cancelPointer = () => { down = null; pointers.clear(); };
  on(canvas, "pointerdown", event => { pointers.add(event.pointerId); if (event.button === 0 && pointers.size === 1) down = { x: event.clientX, y: event.clientY, id: event.pointerId }; else down = null; });
  on(canvas, "pointermove", event => { if (down && event.pointerId === down.id && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) down = null; });
  on(canvas, "pointercancel", cancelPointer); on(canvas, "lostpointercapture", cancelPointer); on(canvas, "pointerleave", () => { down = null; }); on(window, "blur", cancelPointer);
  on(canvas, "pointerup", event => {
    const click = down; down = null; pointers.delete(event.pointerId);
    if (!click || event.pointerId !== click.id || event.button !== 0 || busy || contextLost || Math.hypot(event.clientX - click.x, event.clientY - click.y) > 6) return;
    const r = canvas.getBoundingClientRect(); pointer.set((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2); ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects([...models.values()], true)[0];
    if (hit) { let node = hit.object; while (node && !node.userData.id) node = node.parent; select(node?.userData.id || ""); }
    else { const point = ray.intersectObject(floor)[0]?.point; if (point && selected) move({ x: Math.round(point.x), z: Math.round(point.z) }); else select("", false); }
    canvas.focus({ preventScroll: true });
  });
  on(canvas, "contextmenu", event => event.preventDefault());
  on(canvas, "webglcontextlost", event => { event.preventDefault(); contextLost = true; controls.enabled = false; cancelPointer(); cancelAnimationFrame(frame); frame = 0; setStatus("error", "3D view interrupted. Your edits can still be saved."); update(); });
  on(canvas, "webglcontextrestored", () => { contextLost = false; controls.enabled = true; setStatus(dirty() ? "unsaved" : "saved", dirty() ? "Unsaved changes" : "All changes saved"); update(); });
  on(document, "visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; down = null; } else invalidate(); });
  let lastPortrait = null;
  const resize = () => {
    if (disposed || !host.clientWidth || !host.clientHeight) return;
    const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    const portrait = w < h * 0.85; if (portrait !== lastPortrait) { lastPortrait = portrait; cameraFitted = true; }
    frameCamera();
  };
  const observer = new ResizeObserver(resize); for (const node of [host, toolbar, dock]) observer.observe(node); syncScene(); setStatus("saved", "All changes saved"); update(); resize();
  return {
    snapshot() {
      const project = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return { x: (v.x + 1) * host.clientWidth / 2, y: (1 - v.y) * host.clientHeight / 2 }; };
      return { ...normalizeClubhouse(data, unlockedTrophy), selected, dirty: dirty(), busy, disposed, available: !contextLost, state, message, tab, collapsed, drawCalls: renderer.info.render.calls, renderedFrames, framePending: !!frame,
        camera: { position: camera.position.toArray(), target: controls.target.toArray(), fitted: cameraFitted }, viewport,
        roomScreens: roomCorners.map(v => project(v.x, v.y, v.z)),
        itemScreens: data.items.map(item => ({ id: item.id, ...project(item.x, 0.8, item.z) })),
        resources: { geometries: geometries.size, materials: materials.size, textures: textures.size, models: models.size, gpuGeometries: renderer.info.memory.geometries, gpuTextures: renderer.info.memory.textures }, contextLost: renderer.getContext().isContextLost(),
        canvas: { width: canvas.width, height: canvas.height, pixelRatio: renderer.getPixelRatio() } };
    },
    dispose() {
      if (disposed) return; disposed = true; abort.abort(); cancelAnimationFrame(frame); frame = 0; observer.disconnect();
      controls.removeEventListener("change", invalidate); controls.removeEventListener("start", manualCamera); controls.dispose(); scene.clear(); models.clear();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); geometries.clear(); materials.clear(); textures.clear();
      renderer.dispose(); renderer.forceContextLoss(); host.replaceChildren(); host.classList.remove("mgw-clubhouse"); host.removeAttribute("aria-busy");
    }
  };
}
