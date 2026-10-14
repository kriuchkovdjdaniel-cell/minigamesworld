import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createElement, Pause, Play, RotateCcw, Camera, Maximize, LogOut, Apple, Coins, Heart, Timer, ArrowRight, Zap } from "lucide";
import { createCollectionSimulation, COLLECTION_LEVELS, STEP } from "./collection-world.mjs";
import { createCollectionScene } from "./collection-scene.mjs";
import "./collection-games.css";

const icons = { pause: Pause, resume: Play, restart: RotateCcw, camera: Camera, fullscreen: Maximize, exit: LogOut, apple: Apple, coins: Coins, heart: Heart, timer: Timer, next: ArrowRight, dash: Zap };
const clock = value => `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, "0")}`;

export async function mountCollectionGame(host, options) {
  const sim = await createCollectionSimulation(options.mode, options.levelIndex), level = sim.level, orchard = options.mode === "catcher";
  if (options.signal?.aborted) { sim.dispose(); throw new DOMException("Canceled", "AbortError"); }
  const quality = Math.max(0, Math.min(3, Math.floor(options.quality) || 0));
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: quality > 0, powerPreference: "high-performance" }); }
  catch (error) { sim.dispose(); throw new Error("3D graphics are unavailable. Enable hardware acceleration and retry.", { cause: error }); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][quality]));
  renderer.shadowMap.enabled = quality > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute("aria-label", level.title + " game scene");
  renderer.domElement.title = "WASD/arrows: move. Space: jump. Right-drag: camera." + (orchard ? "" : " Shift: dash.");
  host.dataset.collection = level.mode;
  host.innerHTML = `<div class="arcade-hud">
    <div class="arcade-title"><span>${orchard ? "THE ORCHARD / HARVEST RUN" : "HARBOR DISTRICT / COIN RUN"}</span><strong>${level.title}</strong><small>${level.index + 1} / 3 &nbsp; ${level.name}</small></div>
    <div class="arcade-counters"><span title="Lives"><i data-icon="heart"></i><output data-lives>3</output></span><span title="Score"><i data-icon="${orchard ? "apple" : "coins"}"></i><output data-score>0</output></span><span title="Time remaining"><i data-icon="timer"></i><output data-time></output></span></div>
    <div class="arcade-tools">${[...(orchard ? [] : ["dash"]), "camera", "fullscreen", "pause"].map(action => `<button data-action="${action}" title="${{ dash: "Dash (Shift)", camera: "Reset camera", fullscreen: "Fullscreen", pause: "Pause (Escape)" }[action]}" aria-label="${action}"><i data-icon="${action}"></i>${action === "dash" ? '<progress max="4" value="4" aria-label="Dash recharge"></progress>' : ""}</button>`).join("")}</div>
    </div><div class="arcade-objective"><span data-objective></span><progress data-progress max="${level.target}" value="0"></progress></div>
    <canvas class="arcade-map" width="140" height="140" aria-label="Area map"></canvas><p class="arcade-notice" role="status" aria-live="polite"></p>
    <dialog class="three-menu arcade-menu" aria-labelledby="collectionMenuTitle"><h2 id="collectionMenuTitle">Paused</h2><p data-result></p>
      <button data-action="next" hidden><i data-icon="next"></i>Next Stage</button><button data-action="resume"><i data-icon="resume"></i>Resume</button>
      <button data-action="restart"><i data-icon="restart"></i>Restart Stage</button>
      <label for="collectionLevelSelect">Stage</label><div class="three-level-picker"><select id="collectionLevelSelect" aria-label="Stage">${COLLECTION_LEVELS[level.mode].map((name, i) => `<option value="${i}" ${i === level.index ? "selected" : ""}>${i + 1}. ${name}</option>`).join("")}</select><button data-action="level" title="Play stage" aria-label="Play stage"><i data-icon="resume"></i></button></div>
      <button data-action="exit"><i data-icon="exit"></i>Return to Games</button>
    </dialog>`;
  host.prepend(renderer.domElement);
  host.querySelectorAll("[data-icon]").forEach(node => node.replaceWith(createElement(icons[node.dataset.icon], { width: 19, height: 19, "aria-hidden": "true" })));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(orchard ? "#b9d2c1" : "#b2cbd1"); scene.fog = new THREE.Fog(scene.background, 55, 140);
  scene.add(new THREE.HemisphereLight("#f0f7e5", "#4e746a", 2));
  const sun = new THREE.DirectionalLight("#fff3d9", 2.7); sun.position.set(-14, 28, 12); sun.castShadow = quality > 0;
  sun.shadow.mapSize.setScalar(quality > 1 ? 2048 : 1024); sun.shadow.bias = -0.001;
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 85 }); scene.add(sun);
  const visuals = createCollectionScene(scene, level, options), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = controls.enableDamping = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE };
  controls.minDistance = 12; controls.maxDistance = 45; controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.15;
  controls.target.set(0, 0, 2); let framingDistance = Math.hypot(25, 22);
  const resetCamera = () => { camera.position.copy(controls.target).add(new THREE.Vector3(0, 25, 22).setLength(framingDistance)); controls.update(); };
  resetCamera();
  const menu = host.querySelector("dialog"), notice = host.querySelector(".arcade-notice"), map = host.querySelector(".arcade-map").getContext("2d");
  const hud = Object.fromEntries(["lives", "score", "time", "objective", "progress", "result"].map(key => [key, host.querySelector(`[data-${key}]`)]));
  const dashButton = host.querySelector('[data-action="dash"]'), keys = new Set(), abort = new AbortController();
  const on = (target, type, callback, extra = {}) => target.addEventListener(type, callback, { ...extra, signal: abort.signal });
  let disposed = false, paused = false, ended = false, frameId = null, lastTime = null, accumulator = 0, jump = false, dash = false, cameraPointer = null;
  let previousCollected = 0, previousLives = 3, previousShield = 0, noticeUntil = 0;
  function releaseCamera() {
    if (cameraPointer === null) return;
    const id = cameraPointer; cameraPointer = null;
    if (renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id);
    controls.disconnect(); controls.connect(renderer.domElement); renderer.domElement.style.cursor = "";
  }
  function render() {
    if (disposed) return;
    const s = sim.state, p = sim.body.translation(); visuals.update(sim);
    const target = new THREE.Vector3(p.x * 0.25, 0, p.z * 0.25); camera.position.add(target.clone().sub(controls.target)); controls.target.copy(target);
    const collected = orchard ? s.caught : s.collected.size;
    hud.lives.textContent = s.lives; hud.score.textContent = s.score; hud.time.textContent = clock(level.duration - s.elapsed);
    hud.objective.textContent = s.gateOpen ? "All coins secured / Return to the gate" : `${collected} / ${level.target} ${orchard ? "apples" : "coins"}`;
    hud.progress.value = collected;
    if (collected > previousCollected) { previousCollected = collected; options.onPickup?.(); }
    if (s.lives < previousLives) { previousLives = s.lives; notice.textContent = `${s.lives} lives remaining`; noticeUntil = s.elapsed + 1.4; options.onHit?.(); }
    if (s.usedShields.size > previousShield) { previousShield = s.usedShields.size; notice.textContent = "Shield active"; noticeUntil = s.elapsed + 2; options.onPickup?.(); }
    if (s.elapsed > noticeUntil) notice.textContent = "";
    if (dashButton) { dashButton.disabled = s.cooldown > 0 || ended; dashButton.querySelector("progress").value = 4 - s.cooldown; }
    map.fillStyle = "#1b3030ee"; map.fillRect(0, 0, 140, 140); map.strokeStyle = "#b4c8b2"; map.strokeRect(10, 10, 120, 120);
    for (const b of level.obstacles) { map.fillStyle = "#91b0aa"; map.fillRect(70 + (b.x - b.w / 2) * 5, 70 + (b.z - b.d / 2) * 5, b.w * 5, b.d * 5); }
    level.coins.forEach((coin, i) => { if (!s.collected.has(i)) { map.fillStyle = "#f0d992"; map.fillRect(68 + coin.x * 5, 68 + coin.z * 5, 4, 4); } });
    for (const drop of s.drops) { map.fillStyle = drop.kind === "apple" ? "#e7dba2" : "#e49aa9"; map.beginPath(); map.arc(70 + drop.x * 5, 70 + drop.z * 5, 4, 0, Math.PI * 2); map.fill(); }
    for (const enemy of s.enemies) { map.fillStyle = "#e48a9a"; map.fillRect(67 + enemy.x * 5, 67 + enemy.z * 5, 6, 6); }
    map.fillStyle = "#f8fff3"; map.fillRect(67 + p.x * 5, 67 + p.z * 5, 6, 6);
    controls.update(); renderer.render(scene, camera);
  }
  const schedule = () => { if (!disposed && !paused && !ended && frameId === null) frameId = requestAnimationFrame(frame); };
  function setPaused(value) {
    if (disposed || ended) return;
    paused = value; keys.clear(); jump = dash = false; accumulator = 0; lastTime = null; releaseCamera(); controls.enabled = !value;
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
    while (accumulator >= STEP) { sim.step({ x: dx, z: dz, jump, dash }); jump = dash = false; accumulator -= STEP; }
    if (x || z) visuals.player.rotation.y = Math.atan2(-dx, -dz);
    render();
    if (sim.state.status === "playing") { schedule(); return; }
    ended = true; keys.clear(); releaseCamera(); controls.enabled = false;
    const won = sim.state.status === "won";
    host.querySelector("h2").textContent = won ? "Stage Clear" : sim.state.lives <= 0 ? "Out of Lives" : "Time Up";
    hud.result.textContent = `${sim.state.score} points / ${clock(sim.state.elapsed)}${orchard ? ` / ${sim.state.missed} missed` : ""}`;
    host.querySelector('[data-action="resume"]').hidden = true; host.querySelector('[data-action="next"]').hidden = !won || level.index === 2;
    menu.showModal(); options.onFinish?.({ won, score: sim.state.score, seconds: sim.state.elapsed, levelIndex: level.index });
  }
  on(host, "click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "pause") setPaused(true);
    if (action === "resume") setPaused(false);
    if (action === "camera") { resetCamera(); render(); renderer.domElement.focus(); }
    if (action === "dash" && !paused && !ended) { dash = true; renderer.domElement.focus(); }
    if (action === "fullscreen") Promise.resolve(options.onFullscreen?.()).finally(() => { if (!disposed) renderer.domElement.focus(); });
    if (action === "exit" || action === "restart") { menu.close(); options[action === "exit" ? "onExit" : "onRestart"]?.(); }
    if (action === "next" && sim.state.status === "won" && level.index < 2) { menu.close(); options.onLevelChange?.(level.index + 1); }
    if (action === "level") { menu.close(); options.onLevelChange?.(Number(host.querySelector("select").value)); }
  });
  on(renderer.domElement, "pointerdown", event => {
    if (event.pointerType !== "mouse") return;
    if (event.button !== 2 || paused || ended) { event.stopImmediatePropagation(); renderer.domElement.focus(); return; }
    cameraPointer = event.pointerId; renderer.domElement.style.cursor = "grabbing"; renderer.domElement.focus();
  }, { capture: true });
  on(renderer.domElement, "pointermove", event => { if (event.pointerType === "mouse" && !(event.buttons & 2)) releaseCamera(); }, { capture: true });
  on(window, "pointerup", event => { if (!(event.buttons & 2)) releaseCamera(); }); on(renderer.domElement, "pointercancel", releaseCamera); on(renderer.domElement, "lostpointercapture", releaseCamera);
  on(window, "keydown", event => {
    if (event.target instanceof Element && event.target.closest("input,select,textarea,button") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Escape" && !menu.open) { event.preventDefault(); setPaused(true); return; }
    if (paused || ended) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"].includes(event.code)) {
      event.preventDefault(); keys.add(event.code); if (event.code === "Space" && !event.repeat) jump = true;
      if (event.code.startsWith("Shift") && !event.repeat) dash = true;
    }
  });
  on(window, "keyup", event => keys.delete(event.code)); on(window, "blur", () => setPaused(true)); on(document, "visibilitychange", () => { if (document.hidden) setPaused(true); });
  on(menu, "cancel", event => { event.preventDefault(); if (!ended) setPaused(false); });
  on(renderer.domElement, "webglcontextlost", event => { if (disposed) return; event.preventDefault(); setPaused(true); ended = true; hud.result.textContent = "Graphics connection lost. Restart the stage."; host.querySelector('[data-action="resume"]').hidden = true; });
  const resize = () => {
    if (disposed) return; const { width, height } = host.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height;
    const compact = height <= 520, distance = Math.max(Math.hypot(25, 22) * (compact ? height / Math.max(150, height - 170) : 1), 18 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    camera.position.sub(controls.target).multiplyScalar(distance / framingDistance).add(controls.target); framingDistance = distance;
    controls.maxDistance = Math.max(45, distance * 1.3); camera.setViewOffset(width, height, 0, compact ? -75 : 0, width, height);
    scene.fog.near = Math.max(55, distance + 5); scene.fog.far = Math.max(140, distance + 100); camera.far = Math.max(200, distance + 120); camera.updateProjectionMatrix(); render();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize(); renderer.domElement.focus(); schedule();
  return {
    pause: () => setPaused(true),
    snapshot: () => ({ mode: level.mode, levelIndex: level.index, status: sim.state.status, paused, elapsed: sim.state.elapsed, score: sim.state.score, lives: sim.state.lives,
      caught: sim.state.caught, missed: sim.state.missed, collected: sim.state.collected.size, cooldown: sim.state.cooldown, shield: sim.state.shield,
      drops: sim.state.drops.map(({ id, kind, phase, x, y, z }) => ({ id, kind, phase, x, y, z })), position: { ...sim.body.translation() },
      camera: { yaw: controls.getAzimuthalAngle(), pitch: controls.getPolarAngle() }, drawCalls: renderer.info.render.calls }),
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frameId); abort.abort(); observer.disconnect(); releaseCamera(); controls.dispose(); menu.close();
      visuals.dispose(); sim.dispose(); renderer.dispose(); renderer.forceContextLoss(); delete host.dataset.collection; host.replaceChildren();
    }
  };
}
