import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createElement, Pause, Play, RotateCcw, Camera, Maximize, LogOut, Gem, Heart, Timer, ArrowRight } from "lucide";
import { createArcadeSimulation, ARCADE_LEVELS, STEP } from "./arcade-world.mjs";
import { createCustomAccessory } from "./skin-studio-accessory.mjs";
import "./arcade-games.css";

const icons = { pause: Pause, resume: Play, restart: RotateCcw, camera: Camera, fullscreen: Maximize, exit: LogOut, gem: Gem, heart: Heart, timer: Timer, next: ArrowRight };
const clock = time => `${Math.floor(Math.max(0, time) / 60)}:${String(Math.floor(Math.max(0, time) % 60)).padStart(2, "0")}`;

export async function mountArcadeGame(host, options) {
  const sim = await createArcadeSimulation(options.mode, options.levelIndex);
  if (options.signal?.aborted) { sim.dispose(); throw new DOMException("Canceled", "AbortError"); }
  let renderer;
  const quality = Math.max(0, Math.min(3, Math.floor(options.quality) || 0));
  try { renderer = new THREE.WebGLRenderer({ antialias: quality > 0, powerPreference: "high-performance" }); }
  catch (error) { sim.dispose(); throw new Error("3D graphics are unavailable. Enable hardware acceleration and retry.", { cause: error }); }
  const garden = options.mode === "dodger", level = sim.level;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(garden ? "#a3c8c0" : "#b1bdc6");
  scene.fog = new THREE.Fog(scene.background, 50, 135);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][quality]));
  renderer.shadowMap.enabled = quality > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute("aria-label", level.title + " game scene");
  renderer.domElement.title = "WASD / arrows: move. Space: jump. Hold right mouse: rotate camera.";
  host.dataset.arcade = options.mode;
  host.innerHTML = `
    <div class="arcade-hud">
      <div class="arcade-title"><span>${garden ? "THE EMERALD RESERVE" : "SECTOR 07 / CONTAINMENT"}</span><strong>${level.title}</strong><small>${level.index + 1} / 3 &nbsp; ${level.name}</small></div>
      <div class="arcade-counters"><span title="Lives"><i data-icon="heart"></i><output data-lives>3</output></span><span title="Score"><i data-icon="gem"></i><output data-score>0</output></span><span title="Time remaining"><i data-icon="timer"></i><output data-time></output></span></div>
      <div class="arcade-tools">${["camera", "fullscreen", "pause"].map(action => `<button data-action="${action}" title="${action === "camera" ? "Reset camera" : action === "pause" ? "Pause (Escape)" : "Fullscreen"}" aria-label="${action}"><i data-icon="${action}"></i></button>`).join("")}</div>
    </div>
    <div class="arcade-objective"><span data-objective></span><progress data-progress max="${garden ? level.gems.length : level.duration}" value="0"></progress></div>
    <canvas class="arcade-map" width="140" height="140" aria-label="Arena map"></canvas>
    <p class="arcade-notice" role="status" aria-live="polite"></p>
    <dialog class="three-menu arcade-menu" aria-labelledby="arcadeMenuTitle"><h2 id="arcadeMenuTitle">Paused</h2><p data-result></p>
      <button data-action="next" hidden><i data-icon="next"></i>Next Stage</button>
      <button data-action="resume"><i data-icon="resume"></i>Resume</button>
      <button data-action="restart"><i data-icon="restart"></i>Restart Stage</button>
      <label for="arcadeLevelSelect">Stage</label><div class="three-level-picker"><select id="arcadeLevelSelect" aria-label="Stage">${ARCADE_LEVELS[options.mode].map((name, i) => `<option value="${i}" ${i === level.index ? "selected" : ""}>${i + 1}. ${name}</option>`).join("")}</select><button data-action="level" title="Play stage" aria-label="Play stage"><i data-icon="resume"></i></button></div>
      <button data-action="exit"><i data-icon="exit"></i>Return to Games</button>
    </dialog>`;
  host.prepend(renderer.domElement);
  host.querySelectorAll("[data-icon]").forEach(node => node.replaceWith(createElement(icons[node.dataset.icon], { width: 19, height: 19, "aria-hidden": "true" })));
  const abort = new AbortController(), signal = abort.signal;
  const on = (target, type, fn, extra = {}) => target.addEventListener(type, fn, { ...extra, signal });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 180);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false; controls.enableDamping = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE };
  controls.minDistance = 12; controls.maxDistance = 40; controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.15;
  controls.target.set(0, 0, 2);
  let framingDistance = Math.hypot(23, 22);
  const resetCamera = () => { camera.position.copy(controls.target).add(new THREE.Vector3(0, 23, 22).setLength(framingDistance)); controls.update(); };
  resetCamera();
  scene.add(new THREE.HemisphereLight("#edf9ef", garden ? "#536850" : "#4b5a68", 2));
  const sun = new THREE.DirectionalLight("#fff2d4", 3); sun.position.set(-15, 28, 10); sun.castShadow = quality > 0;
  sun.shadow.mapSize.setScalar(quality > 1 ? 2048 : 1024); sun.shadow.bias = -0.001;
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 }); scene.add(sun);
  const materials = new Map(), unitBox = new THREE.BoxGeometry(1, 1, 1);
  const mat = (color, extra = {}) => { const key = color + JSON.stringify(extra); if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra })); return materials.get(key); };
  const mesh = (geometry, color, x, y, z, extra = {}) => { const m = new THREE.Mesh(geometry, mat(color, extra)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const box = (x, y, z, w, h, d, color, extra) => { const m = mesh(unitBox, color, x, y, z, extra); m.scale.set(w, h, d); return m; };
  box(0, -0.5, 0, 24.5, 1, 24.5, garden ? "#7f8f80" : "#657681");
  // Shared tile geometry keeps the full arena floor to one draw call.
  const tiles = new THREE.InstancedMesh(unitBox, mat(garden ? "#b2bca4" : "#d2d8d5"), 144);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 144; i++) { transform.position.set((i % 12 - 5.5) * 2, 0.005, (Math.floor(i / 12) - 5.5) * 2); transform.scale.set(1.96, 0.02, 1.96); transform.updateMatrix(); tiles.setMatrixAt(i, transform.matrix); }
  tiles.receiveShadow = true; scene.add(tiles);
  for (const o of level.obstacles) {
    box(o.x, o.h / 2, o.z, o.w, o.h, o.d, "#849780");
    box(o.x, o.h + 0.05, o.z, o.w + 0.12, 0.12, o.d + 0.12, "#ccd0ab");
    mesh(new THREE.OctahedronGeometry(0.42), "#a681c2", o.x, o.h + 0.65, o.z);
  }
  for (const side of [-1, 1]) {
    box(side * 12, 0.45, 0, 0.45, 0.9, 24, garden ? "#637c69" : "#4c6069");
    box(0, 0.45, side * 12, 24, 0.9, 0.45, garden ? "#637c69" : "#4c6069");
    for (const p of [-10, -5, 0, 5, 10]) {
      for (const [x, z] of [[side * 12, p], [p, side * 12]]) {
        box(x, 1.6, z, 0.6, 3.2, 0.6, garden ? "#d2cba4" : "#71848b");
        box(x, 3.25, z, 0.85, 0.15, 0.85, garden ? "#e2d4a3" : "#b8ebde", garden ? {} : { emissive: "#75bca8", emissiveIntensity: 0.3 });
      }
    }
    // A visible upper rail matches the collision boundary without hiding the arena.
    box(side * 12, 3, 0, 0.16, 0.14, 24, "#759b8e"); box(0, 3, side * 12, 24, 0.14, 0.16, "#759b8e");
  }
  if (garden) {
    box(0, -1.2, 0, 200, 0.1, 200, "#4b9794", { roughness: 0.35, metalness: 0.2 });
    const foliage = new THREE.ConeGeometry(2.2, 4.8, 6), trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.7, 6);
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, radius = 20 + i % 3 * 3, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      box(x, -0.3, z, 5, 1.3, 5, "#647f60"); mesh(trunk, "#7b7960", x, 1.2, z); mesh(foliage, i % 2 ? "#407c62" : "#658c5f", x, 4, z);
    }
    for (let i = 0; i < 9; i++) { const a = i * Math.PI * 2 / 9; mesh(new THREE.ConeGeometry(10, 14 + i % 3 * 5, 5), "#7fa398", Math.cos(a) * 60, 3, Math.sin(a) * 60); }
  } else {
    box(0, -1.2, 0, 180, 0.3, 180, "#6b7b83");
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, x = Math.cos(a) * 32, z = Math.sin(a) * 32, h = 5 + i % 4 * 2;
      box(x, h / 2 - 1, z, 5, h, 5, i % 2 ? "#81959c" : "#566b74");
      box(x, h - 0.8, z, 5.3, 0.3, 5.3, "#b2c5bf");
      for (let n = 0; n < 3; n++) box(x, 1 + n * 1.7, z + 2.53, 3, 0.28, 0.05, "#a3d3c4", { emissive: "#73c1b1", emissiveIntensity: 0.4 });
    }
    const ring = mesh(new THREE.TorusGeometry(4, 0.08, 6, 64), "#78988a", 0, 0.035, 0); ring.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) box(side * 11.5, 0.05, 0, 0.2, 0.04, 22, "#d0b874");
  }
  // Batch immobile scenery by material, including its shadow pass.
  const batches = new Map(), originals = new Set();
  for (const object of [...scene.children]) {
    if (!object.isMesh || object.isInstancedMesh) continue;
    object.updateMatrix();
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrix);
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(geometry);
    originals.add(object.geometry); scene.remove(object);
  }
  for (const [material, geometries] of batches) {
    const scenery = new THREE.Mesh(mergeGeometries(geometries), material);
    scenery.castShadow = scenery.receiveShadow = true; scene.add(scenery);
    geometries.forEach(geometry => geometry.dispose());
  }
  originals.forEach(geometry => { if (geometry !== unitBox) geometry.dispose(); });
  const gems = level.gems.map(g => mesh(new THREE.OctahedronGeometry(0.5), "#50d7ba", g.x, g.y, g.z, { metalness: 0.3, roughness: 0.25, emissive: "#176e67", emissiveIntensity: 0.25 }));
  const guards = Array.from({ length: level.guardCount }, () => {
    const group = new THREE.Group(), shell = new THREE.Mesh(new RoundedBoxGeometry(1.1, 1.1, 1.1, 1, 0.1), mat("#b46379")); shell.castShadow = true; group.add(shell);
    const visor = new THREE.Mesh(unitBox, mat("#f9dd98", { emissive: "#dda877", emissiveIntensity: 0.25 })); visor.scale.set(0.8, 0.18, 0.06); visor.position.set(0, 0.1, 0.56); group.add(visor); scene.add(group); return group;
  });
  const beams = Array.from({ length: level.beamCount }, () => {
    const line = box(0, -20, 0, 23.2, 0.24, 0.24, "#ec5c78", { emissive: "#d63255", emissiveIntensity: 0.65 });
    const marker = box(0, -20, 0, 23.2, 0.04, 0.5, "#dfbd65", { emissive: "#9c751a", emissiveIntensity: 0.25 });
    return { line, marker };
  });
  let gate;
  if (garden) { gate = mesh(new THREE.TorusGeometry(1.2, 0.16, 8, 40), "#8b83a1", level.exit.x, 1.25, level.exit.z); }
  const player = new THREE.Group();
  let playerMaterial = mat(options.color || "#40a6bb");
  if (/^[0-7]{4096}$/.test(options.pixelSkin || "")) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const ctx = canvas.getContext("2d");
    for (let i = 0; i < 4096; i++) { ctx.fillStyle = options.palette?.[Number(options.pixelSkin[i])] || "#40a6bb"; ctx.fillRect(i % 64, Math.floor(i / 64), 1, 1); }
    const texture = new THREE.CanvasTexture(canvas); texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace;
    playerMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }); materials.set("player", playerMaterial);
  }
  const cube = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.9, 0.88, 2, 0.05), playerMaterial); cube.castShadow = cube.receiveShadow = true; player.add(cube);
  for (const x of [-0.19, 0.19]) { const eye = new THREE.Mesh(unitBox, mat("#f7f5e7")); eye.scale.set(0.12, 0.18, 0.05); eye.position.set(x, 0.08, -0.45); player.add(eye); }
  if (options.accessory === "custom" && /^[.0-7]{256}$/.test(options.accessoryPixels || "")) {
    const accessory = createCustomAccessory(options.accessoryPixels, options.palette || []);
    if (accessory) { accessory.scale.setScalar(0.45); accessory.rotation.y = Math.PI; player.add(accessory); materials.set("accessory", accessory.material); }
  }
  scene.add(player); player.position.copy(sim.body.translation());
  const menu = host.querySelector("dialog"), notice = host.querySelector(".arcade-notice"), map = host.querySelector(".arcade-map"), mapCtx = map.getContext("2d");
  const hud = Object.fromEntries(["lives", "score", "time", "objective", "progress", "result"].map(name => [name, host.querySelector(`[data-${name}]`)]));
  const keys = new Set(); let frameId = null, paused = false, ended = false, disposed = false, lastTime = null, accumulator = 0, jump = false, cameraPointer = null;
  let previousGems = 0, previousLives = 3, noticeUntil = 0;
  function releaseCamera() { if (cameraPointer === null) return; const id = cameraPointer; cameraPointer = null; if (renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id); controls.disconnect(); controls.connect(renderer.domElement); renderer.domElement.style.cursor = ""; }
  function render() {
    if (disposed) return;
    player.position.copy(sim.body.translation()); player.visible = sim.state.invulnerable <= 0 || Math.floor(sim.state.elapsed * 12) % 2 === 0;
    const target = new THREE.Vector3(player.position.x * 0.3, 0, player.position.z * 0.3); camera.position.add(target.clone().sub(controls.target)); controls.target.copy(target);
    gems.forEach((m, i) => { m.visible = !sim.state.collected.has(i); m.rotation.y = sim.state.elapsed; m.position.y = level.gems[i].y + Math.sin(sim.state.elapsed * 2 + i) * 0.1; });
    guards.forEach((m, i) => { if (sim.state.guards[i]) m.position.copy(sim.state.guards[i]); m.rotation.y = Math.sin(sim.state.elapsed + i) * 0.5; });
    beams.forEach(({ line, marker }, i) => {
      const b = sim.state.beams[i]; if (!b) { line.visible = marker.visible = false; return; }
      line.visible = b.active; marker.visible = b.warning;
      for (const m of [line, marker]) { m.position.set(b.axis === "x" ? b.coordinate : 0, m === line ? b.height : 0.04, b.axis === "z" ? b.coordinate : 0); m.rotation.y = b.axis === "x" ? Math.PI / 2 : 0; }
    });
    if (gate) { gate.material.color.set(sim.state.gateOpen ? "#d0e69f" : "#8b83a1"); gate.rotation.z = sim.state.elapsed * 0.2; }
    hud.lives.textContent = sim.state.lives; hud.score.textContent = sim.state.score; hud.time.textContent = clock(level.duration - sim.state.elapsed);
    hud.objective.textContent = garden ? sim.state.gateOpen ? "Vault cleared / Return to the gate" : `${sim.state.collected.size} / ${level.gems.length} gems` : sim.state.beams.some(b => b.warning) ? "Incoming laser" : "Reactor lockdown";
    hud.progress.value = garden ? sim.state.collected.size : sim.state.elapsed;
    if (sim.state.collected.size > previousGems) { options.onPickup?.(); previousGems = sim.state.collected.size; }
    if (sim.state.lives < previousLives) { previousLives = sim.state.lives; notice.textContent = `${sim.state.lives} lives remaining`; noticeUntil = sim.state.elapsed + 1.3; options.onHit?.(); }
    if (sim.state.elapsed > noticeUntil) notice.textContent = "";
    mapCtx.fillStyle = "#19292de8"; mapCtx.fillRect(0, 0, 140, 140);
    mapCtx.strokeStyle = "#aac4b1"; mapCtx.strokeRect(10, 10, 120, 120);
    for (const o of level.obstacles) { mapCtx.fillStyle = "#869880"; mapCtx.fillRect(70 + (o.x - o.w / 2) * 5, 70 + (o.z - o.d / 2) * 5, o.w * 5, o.d * 5); }
    gems.forEach((m, i) => { if (!sim.state.collected.has(i)) { mapCtx.fillStyle = "#72e1c0"; mapCtx.fillRect(68 + m.position.x * 5, 68 + m.position.z * 5, 4, 4); } });
    for (const p of sim.state.guards) { mapCtx.fillStyle = "#f38ea0"; mapCtx.fillRect(67 + p.x * 5, 67 + p.z * 5, 6, 6); }
    mapCtx.fillStyle = "#fff4c3"; mapCtx.fillRect(67 + player.position.x * 5, 67 + player.position.z * 5, 6, 6);
    controls.update(); renderer.render(scene, camera);
  }
  const schedule = () => { if (!disposed && !paused && !ended && frameId === null) frameId = requestAnimationFrame(frame); };
  function setPaused(value) {
    if (disposed || ended) return;
    paused = value; keys.clear(); jump = false; accumulator = 0; lastTime = null; releaseCamera(); controls.enabled = !value;
    if (value) { host.querySelector("h2").textContent = "Paused"; hud.result.textContent = `${level.name} / ${sim.state.score} points`; menu.showModal(); cancelAnimationFrame(frameId); frameId = null; }
    else { menu.close(); renderer.domElement.focus(); schedule(); }
    options.onPause?.(value);
  }
  function frame(now) {
    frameId = null; if (disposed || paused || ended) return;
    accumulator += lastTime === null ? 0 : Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
    const x = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const z = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp"));
    const yaw = controls.getAzimuthalAngle(), dx = x * Math.cos(yaw) + z * Math.sin(yaw), dz = z * Math.cos(yaw) - x * Math.sin(yaw);
    while (accumulator >= STEP) { sim.step({ x: dx, z: dz, jump }); jump = false; accumulator -= STEP; }
    if (x || z) player.rotation.y = Math.atan2(-dx, -dz);
    render();
    if (sim.state.status !== "playing") {
      ended = true; keys.clear(); releaseCamera(); controls.enabled = false;
      const won = sim.state.status === "won";
      host.querySelector("h2").textContent = won ? "Stage Clear" : sim.state.lives <= 0 ? "Out of Lives" : "Time Up";
      hud.result.textContent = `${sim.state.score} points / ${clock(sim.state.elapsed)}`;
      host.querySelector('[data-action="resume"]').hidden = true; host.querySelector('[data-action="next"]').hidden = !won || level.index === 2;
      menu.showModal(); options.onFinish?.({ won, score: sim.state.score, seconds: sim.state.elapsed, levelIndex: level.index });
    } else schedule();
  }
  on(host, "click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "pause") setPaused(true);
    if (action === "resume") setPaused(false);
    if (action === "camera") { resetCamera(); render(); renderer.domElement.focus(); }
    if (action === "fullscreen") Promise.resolve(options.onFullscreen?.()).finally(() => { if (!disposed) renderer.domElement.focus(); });
    if (action === "exit" || action === "restart") { menu.close(); options[action === "exit" ? "onExit" : "onRestart"]?.(); }
    if (action === "next" && sim.state.status === "won" && level.index < 2) { menu.close(); options.onLevelChange?.(level.index + 1); }
    if (action === "level") { menu.close(); options.onLevelChange?.(Number(host.querySelector("select").value)); }
  });
  on(renderer.domElement, "pointerdown", event => { if (event.pointerType !== "mouse") return; if (event.button !== 2 || paused || ended) { event.stopImmediatePropagation(); renderer.domElement.focus(); return; } cameraPointer = event.pointerId; renderer.domElement.style.cursor = "grabbing"; renderer.domElement.focus(); }, { capture: true });
  on(renderer.domElement, "pointermove", event => { if (event.pointerType === "mouse" && !(event.buttons & 2)) releaseCamera(); }, { capture: true });
  on(window, "pointerup", event => { if (!(event.buttons & 2)) releaseCamera(); }); on(renderer.domElement, "pointercancel", releaseCamera); on(renderer.domElement, "lostpointercapture", releaseCamera);
  on(window, "keydown", event => {
    if (event.target.closest("input,select,textarea,button") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Escape" && !menu.open) { event.preventDefault(); setPaused(true); return; }
    if (paused || ended) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) { event.preventDefault(); keys.add(event.code); if (event.code === "Space" && !event.repeat) jump = true; }
  });
  on(window, "keyup", event => keys.delete(event.code)); on(window, "blur", () => setPaused(true)); on(document, "visibilitychange", () => { if (document.hidden) setPaused(true); });
  on(menu, "cancel", event => { event.preventDefault(); if (!ended) setPaused(false); });
  on(renderer.domElement, "webglcontextlost", event => { if (disposed) return; event.preventDefault(); setPaused(true); ended = true; hud.result.textContent = "Graphics connection lost. Restart the stage."; host.querySelector('[data-action="resume"]').hidden = true; });
  const resize = () => {
    if (disposed) return;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height;
    const compact = height <= 520;
    const verticalFit = Math.hypot(23, 22) * (compact ? height / Math.max(150, height - 170) : 1);
    const distance = Math.max(verticalFit, 18 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    camera.position.sub(controls.target).multiplyScalar(distance / framingDistance).add(controls.target);
    framingDistance = distance; controls.maxDistance = Math.max(40, distance * 1.3);
    camera.setViewOffset(width, height, 0, compact ? -75 : 0, width, height);
    scene.fog.near = Math.max(50, distance + 5); scene.fog.far = Math.max(135, distance + 100);
    camera.far = Math.max(180, distance + 120); camera.updateProjectionMatrix(); render();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize(); renderer.domElement.focus(); schedule();
  return {
    pause: () => setPaused(true),
    snapshot: () => ({ mode: level.mode, levelIndex: level.index, status: sim.state.status, paused, elapsed: sim.state.elapsed, score: sim.state.score, lives: sim.state.lives, collected: sim.state.collected.size, position: { ...sim.body.translation() }, camera: { yaw: controls.getAzimuthalAngle(), pitch: controls.getPolarAngle() }, drawCalls: renderer.info.render.calls }),
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frameId); abort.abort(); observer.disconnect(); releaseCamera(); controls.dispose(); menu.close();
      const geometries = new Set(); scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.isInstancedMesh) o.dispose(); });
      geometries.forEach(g => g.dispose()); materials.forEach(m => { m.map?.dispose(); m.dispose(); });
      sim.dispose(); renderer.dispose(); renderer.forceContextLoss(); delete host.dataset.arcade; host.replaceChildren();
    }
  };
}
