import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createElement, Pause, Play, RotateCcw, Camera, Maximize, LogOut, Gem, Heart, Timer, ArrowRight } from "lucide";
import { createSimulation, STEP } from "./three-world.mjs";
import { LEVELS, normalizeProgress } from "./three-levels.mjs";
export { LEVELS, normalizeProgress, recordLevelResult } from "./three-levels.mjs";

const ICONS = { pause: Pause, resume: Play, restart: RotateCcw, camera: Camera, fullscreen: Maximize, exit: LogOut, gem: Gem, heart: Heart, timer: Timer, next: ArrowRight };

export async function mountThreeGame(host, options) {
  const sim = await createSimulation(options.mode, options.levelIndex);
  const { theme, levelIndex } = sim.level;
  const completed = normalizeProgress({ completed: options.completed }).completed;
  if (options.signal?.aborted) { sim.dispose(); throw new DOMException("Canceled", "AbortError"); }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: options.quality > 0, powerPreference: "high-performance" }); }
  catch (error) { sim.dispose(); throw new Error("3D graphics are unavailable on this device. Try enabling hardware acceleration.", { cause: error }); }
  const abort = new AbortController();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(scene.background, 36, 150);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][options.quality] || 1));
  renderer.shadowMap.enabled = options.quality > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute("aria-label", sim.level.title + " game scene");
  renderer.domElement.title = "Hold right mouse button to rotate camera; scroll to zoom";
  renderer.domElement.tabIndex = 0;
  host.innerHTML = `
    <div class="three-hud">
      <div class="three-title"><span>MINIGAMEWORLD</span><strong>${sim.level.title}</strong><span data-level>Level ${levelIndex + 1} / ${LEVELS.length} - ${sim.level.name}</span></div>
      <div class="three-counters" aria-label="Game progress">
        <span><i data-three-icon="gem"></i><output data-gems>0 / ${sim.level.gems.length}</output></span>
        <span><i data-three-icon="heart"></i><output data-lives>3</output></span>
        <span><i data-three-icon="timer"></i><output data-time>0:00</output></span>
      </div>
      <div class="three-tools">
        <button data-action="camera" title="Reset camera" aria-label="Reset camera"><i data-three-icon="camera"></i></button>
        <button data-action="fullscreen" title="Fullscreen" aria-label="Fullscreen"><i data-three-icon="fullscreen"></i></button>
        <button data-action="pause" title="Pause (Escape)" aria-label="Pause"><i data-three-icon="pause"></i></button>
      </div>
    </div>
    <canvas class="three-map" width="160" height="160" aria-label="Level map"></canvas>
    <p class="three-notice" role="status" aria-live="polite"></p>
    <dialog class="three-menu" aria-labelledby="threeMenuTitle">
      <h2 id="threeMenuTitle">Paused</h2><p data-result></p>
      <button data-action="next" hidden><i data-three-icon="next"></i>Next Level</button>
      <button data-action="resume"><i data-three-icon="resume"></i>Resume</button>
      <button data-action="restart"><i data-three-icon="restart"></i>Restart Level</button>
      <label for="threeLevelSelect">Level</label>
      <div class="three-level-picker">
        <select id="threeLevelSelect" aria-label="Level"></select>
        <button data-action="level" title="Play selected level" aria-label="Play selected level"><i data-three-icon="resume"></i></button>
      </div>
      <button data-action="exit"><i data-three-icon="exit"></i>Return to Games</button>
    </dialog>`;
  host.prepend(renderer.domElement);
  for (const element of host.querySelectorAll("[data-three-icon]")) element.replaceWith(createElement(ICONS[element.dataset.threeIcon], { width: 20, height: 20, "aria-hidden": "true" }));
  const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 260);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE };
  controls.enableDamping = false;
  controls.minDistance = 5;
  controls.maxDistance = 22;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.1;
  controls.target.set(sim.level.spawn.x, 1.2, sim.level.spawn.z - 3.5);
  function resetCamera() {
    camera.position.copy(controls.target).add(new THREE.Vector3(0, 10.5, 14));
    controls.update();
  }
  resetCamera();
  const ambient = new THREE.HemisphereLight("#e4f4ef", "#30464b", 2.1);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight("#ffefd4", 3.2);
  sun.position.set(-18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(options.quality > 1 ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 0.5, far: 100 });
  sun.shadow.bias = -0.001;
  scene.add(sun);
  const materials = new Map();
  const material = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra }));
    return materials.get(key);
  };
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const addBox = (x, y, z, w, h, d, color) => {
    const mesh = new THREE.Mesh(boxGeometry, material(color));
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh); return mesh;
  };
  // Share geometry and instance the platforms to keep scene draw calls bounded.
  const transform = new THREE.Object3D();
  for (const kind of ["wall", "floor", "island"]) {
    const boxes = sim.level.boxes.filter((box) => box.kind === kind);
    if (!boxes.length) continue;
    const batch = new THREE.InstancedMesh(boxGeometry, material(theme.stone), boxes.length);
    const caps = new THREE.InstancedMesh(boxGeometry, material(theme.grass), boxes.length);
    boxes.forEach((box, i) => {
      transform.position.set(box.x, box.y, box.z); transform.scale.set(box.w, box.h, box.d); transform.updateMatrix(); batch.setMatrixAt(i, transform.matrix);
      transform.position.y = box.y + box.h / 2 + 0.01; transform.scale.set(box.w, 0.05, box.d); transform.updateMatrix(); caps.setMatrixAt(i, transform.matrix);
      if (kind === "island") {
        const rock = new THREE.Mesh(new THREE.ConeGeometry(Math.max(box.w, box.d) * 0.55, 4, 5), material(theme.rock));
        rock.rotation.z = Math.PI; rock.position.set(box.x, box.y - 2.5, box.z); scene.add(rock);
        addBox(box.x + box.w / 2 - 0.7, box.y + 1.25, box.z + box.d / 2 - 0.7, 0.12, 1.3, 0.12, "#344e4b");
        const flag = addBox(box.x + box.w / 2 - 0.35, box.y + 1.8, box.z + box.d / 2 - 0.7, 0.65, 0.4, 0.08, i % 2 ? "#c3a0c8" : "#dfc57d");
        flag.castShadow = false;
      }
    });
    batch.castShadow = batch.receiveShadow = caps.receiveShadow = true;
    scene.add(batch, caps);
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), material(theme.water, { roughness: 0.35, metalness: 0.25 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -9; scene.add(water);
  for (let i = 0; i < 18; i++) {
    const angle = i * Math.PI * 2 / 18;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(10 + i % 4 * 3, 15 + i % 5 * 5, 5), material(i % 2 ? theme.mountain : theme.rock));
    mountain.position.set(Math.sin(angle) * 78, -3, Math.cos(angle) * 78); scene.add(mountain);
  }
  const gemGeometry = new THREE.OctahedronGeometry(0.5);
  const gemMeshes = sim.level.gems.map((point) => {
    const mesh = new THREE.Mesh(gemGeometry, material(theme.gem, { metalness: 0.3, roughness: 0.25, emissive: theme.gem, emissiveIntensity: 0.1 }));
    mesh.position.copy(point); mesh.castShadow = true; scene.add(mesh); return mesh;
  });
  const hazardMeshes = sim.hazards.map(() => {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), material("#d3748e", { emissive: "#a13657", emissiveIntensity: 0.4 }));
    mesh.castShadow = true; scene.add(mesh); return mesh;
  });
  const gate = new THREE.Group();
  const gateMaterial = material("#8b91a6", { emissive: "#534969", emissiveIntensity: 0.3, metalness: 0.3 });
  const gateRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.16, 8, 40), gateMaterial);
  gate.add(gateRing); gate.position.copy(sim.level.portal); gate.position.y += 0.2; scene.add(gate);
  const player = new THREE.Group();
  let playerMaterial = material(options.color || "#53bca3");
  if (/^[0-9]{4096}$/.test(options.pixelSkin || "")) {
    const textureCanvas = document.createElement("canvas"); textureCanvas.width = textureCanvas.height = 64;
    const pixels = textureCanvas.getContext("2d");
    for (let i = 0; i < 4096; i++) { pixels.fillStyle = /^#[\da-f]{6}$/i.test(options.palette?.[Number(options.pixelSkin[i])] || "") ? options.palette[Number(options.pixelSkin[i])] : "#53bca3"; pixels.fillRect(i % 64, Math.floor(i / 64), 1, 1); }
    const texture = new THREE.CanvasTexture(textureCanvas); texture.magFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace;
    playerMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 }); materials.set("player", playerMaterial);
  }
  const cube = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.9, 0.86, 2, 0.09), playerMaterial);
  cube.castShadow = cube.receiveShadow = true; player.add(cube);
  for (const x of [-0.19, 0.19]) {
    const eye = new THREE.Mesh(boxGeometry, material("#eaf8e8")); eye.position.set(x, 0.1, -0.438); eye.scale.set(0.14, 0.21, 0.035); player.add(eye);
  }
  player.position.copy(sim.body.translation()); scene.add(player);
  const map = host.querySelector(".three-map");
  const mapContext = map.getContext("2d");
  const menu = host.querySelector(".three-menu");
  const levelSelect = host.querySelector("#threeLevelSelect");
  function updateLevelOptions() {
    levelSelect.replaceChildren(...LEVELS.map((level, index) => new Option(`${index + 1}. ${level.name}${completed[index] ? " - Clear" : ""}`, String(index), false, index === levelIndex)));
  }
  updateLevelOptions();
  const notice = host.querySelector(".three-notice");
  const keys = new Set();
  let paused = false, ended = false, disposed = false, jump = false, frameId = null, lastTime = null, accumulator = 0, previousCount = 0, previousLives = 3, noticeUntil = 0;
  let cameraPointer = null;
  function releaseCameraDrag() {
    if (cameraPointer === null) return;
    const pointer = cameraPointer;
    cameraPointer = null;
    if (renderer.domElement.hasPointerCapture(pointer)) renderer.domElement.releasePointerCapture(pointer);
    // Reconnecting clears OrbitControls' drag state after blur, cancel, or a modal.
    controls.disconnect();
    controls.connect(renderer.domElement);
    renderer.domElement.style.cursor = "";
  }
  const clockLabel = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  function setPaused(value) {
    if (disposed || ended) return;
    paused = value; keys.clear(); jump = false; lastTime = null; accumulator = 0;
    releaseCameraDrag();
    controls.enabled = !paused;
    if (paused) {
      host.querySelector("#threeMenuTitle").textContent = "Paused";
      host.querySelector("[data-result]").textContent = `${sim.state.collected.size} / ${sim.level.gems.length} crystals`;
      menu.showModal();
      cancelAnimationFrame(frameId); frameId = null;
    } else { menu.close(); renderer.domElement.focus(); schedule(); }
    options.onPause?.(paused);
  }
  function drawMap() {
    const scale = 3;
    mapContext.clearRect(0, 0, 160, 160);
    mapContext.fillStyle = "#071619d9"; mapContext.fillRect(0, 0, 160, 160);
    for (const box of sim.level.boxes) {
      if (box.kind === "floor") continue;
      mapContext.fillStyle = theme.grass;
      mapContext.fillRect(80 + (box.x - box.w / 2) * scale, 80 + (box.z - box.d / 2) * scale, box.w * scale, box.d * scale);
    }
    sim.level.gems.forEach((point, i) => { if (!sim.state.collected.has(i)) { mapContext.fillStyle = theme.gem; mapContext.fillRect(78 + point.x * scale, 78 + point.z * scale, 4, 4); } });
    mapContext.strokeStyle = sim.state.collected.size === sim.level.gems.length ? "#d7afff" : "#8995a4";
    mapContext.strokeRect(76 + sim.level.portal.x * scale, 76 + sim.level.portal.z * scale, 8, 8);
    mapContext.fillStyle = "#fff"; mapContext.beginPath(); mapContext.arc(80 + player.position.x * scale, 80 + player.position.z * scale, 3, 0, Math.PI * 2); mapContext.fill();
  }
  function render() {
    if (disposed) return;
    const position = sim.body.translation();
    const delta = new THREE.Vector3(position.x - player.position.x, position.y - player.position.y, position.z - player.position.z);
    player.position.copy(position); camera.position.add(delta); controls.target.add(delta);
    cube.visible = sim.state.invulnerable <= 0 || Math.floor(sim.state.elapsed * 12) % 2 === 0;
    gemMeshes.forEach((gem, i) => { gem.visible = !sim.state.collected.has(i); gem.rotation.y = sim.state.elapsed; gem.position.y = sim.level.gems[i].y + Math.sin(sim.state.elapsed * 2 + i) * 0.12; });
    hazardMeshes.forEach((mesh, i) => { mesh.position.copy(sim.hazards[i].translation()); mesh.rotation.y = sim.state.elapsed; });
    if (sim.state.collected.size === sim.level.gems.length) { gateMaterial.color.set("#bf9de6"); gateMaterial.emissiveIntensity = 0.8; }
    gateRing.rotation.z = sim.state.elapsed * 0.35;
    host.querySelector("[data-gems]").textContent = `${sim.state.collected.size} / ${sim.level.gems.length}`;
    host.querySelector("[data-lives]").textContent = String(sim.state.lives);
    host.querySelector("[data-time]").textContent = clockLabel(sim.state.elapsed);
    if (sim.state.collected.size > previousCount) {
      notice.textContent = sim.state.collected.size === sim.level.gems.length ? "Portal unlocked" : "Checkpoint saved";
      noticeUntil = sim.state.elapsed + 2; options.onPickup?.(); previousCount = sim.state.collected.size;
    }
    if (sim.state.lives < previousLives) { notice.textContent = "Back to checkpoint"; noticeUntil = sim.state.elapsed + 2; previousLives = sim.state.lives; }
    if (sim.state.elapsed > noticeUntil) notice.textContent = "";
    controls.update(); drawMap(); renderer.render(scene, camera);
  }
  function schedule() { if (!disposed && !paused && !ended && frameId === null) frameId = requestAnimationFrame(frame); }
  function frame(now) {
    frameId = null;
    if (disposed || paused || ended) return;
    accumulator += lastTime === null ? 0 : Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
    const yaw = controls.getAzimuthalAngle();
    const horizontal = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const vertical = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp"));
    while (accumulator >= STEP) {
      const input = { x: horizontal * Math.cos(yaw) + vertical * Math.sin(yaw), z: vertical * Math.cos(yaw) - horizontal * Math.sin(yaw), jump };
      sim.step(input); jump = false; accumulator -= STEP;
      if (input.x || input.z) player.rotation.y = Math.atan2(-input.x, -input.z);
    }
    render();
    if (sim.state.status !== "playing") {
      releaseCameraDrag();
      ended = true; keys.clear(); controls.enabled = false;
      const won = sim.state.status === "won";
      if (won) completed[levelIndex] = true;
      updateLevelOptions();
      host.querySelector("#threeMenuTitle").textContent = won ? (levelIndex === LEVELS.length - 1 ? "Final Course Clear" : "Course Clear") : "Out of Lives";
      host.querySelector("[data-result]").textContent = `${sim.state.score} points | ${clockLabel(sim.state.elapsed)}`;
      host.querySelector('[data-action="resume"]').hidden = true;
      host.querySelector('[data-action="next"]').hidden = !won || levelIndex === LEVELS.length - 1;
      menu.showModal();
      options.onFinish?.({ won, score: sim.state.score, seconds: sim.state.elapsed, levelIndex });
    } else schedule();
  }
  const resize = () => { const { width, height } = host.getBoundingClientRect(); if (width && height) { renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); } };
  const observer = new ResizeObserver(resize); observer.observe(host);
  host.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "pause") setPaused(true);
    if (action === "resume") setPaused(false);
    if (action === "camera") { resetCamera(); render(); renderer.domElement.focus(); }
    if (action === "fullscreen") Promise.resolve(options.onFullscreen?.()).finally(() => { if (!disposed) renderer.domElement.focus(); });
    if (action === "next" && sim.state.status === "won" && levelIndex + 1 < LEVELS.length) { menu.close(); options.onLevelChange?.(levelIndex + 1); }
    if (action === "level") { menu.close(); options.onLevelChange?.(Number(levelSelect.value)); }
    if (action === "exit" || action === "restart") { menu.close(); options[action === "exit" ? "onExit" : "onRestart"]?.(); }
  }, { signal: abort.signal });
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") return;
    if (paused || ended || event.button !== 2) { event.stopImmediatePropagation(); return; }
    cameraPointer = event.pointerId;
    renderer.domElement.style.cursor = "grabbing";
    renderer.domElement.focus();
  }, { signal: abort.signal, capture: true });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" && !(event.buttons & 2)) releaseCameraDrag();
  }, { signal: abort.signal, capture: true });
  window.addEventListener("pointerup", (event) => { if (!(event.buttons & 2)) releaseCameraDrag(); }, { signal: abort.signal });
  renderer.domElement.addEventListener("pointercancel", releaseCameraDrag, { signal: abort.signal });
  renderer.domElement.addEventListener("lostpointercapture", releaseCameraDrag, { signal: abort.signal });
  window.addEventListener("keydown", (event) => {
    if (event.target.closest("input,select,textarea,button") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Escape" && !menu.open) { event.preventDefault(); setPaused(true); return; }
    if (paused || ended) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault(); keys.add(event.code); if (event.code === "Space" && !event.repeat) jump = true;
    }
  }, { signal: abort.signal });
  window.addEventListener("keyup", (event) => keys.delete(event.code), { signal: abort.signal });
  window.addEventListener("blur", () => setPaused(true), { signal: abort.signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); }, { signal: abort.signal });
  menu.addEventListener("cancel", (event) => { event.preventDefault(); if (!ended) setPaused(false); }, { signal: abort.signal });
  renderer.domElement.addEventListener("webglcontextlost", (event) => { event.preventDefault(); setPaused(true); ended = true; host.querySelector("[data-result]").textContent = "Graphics connection lost. Restart the game."; host.querySelector('[data-action="resume"]').hidden = true; }, { signal: abort.signal });
  resize(); renderer.domElement.focus(); schedule();
  return {
    pause: () => setPaused(true),
    snapshot: () => ({ ...sim.state, levelIndex, levelName: sim.level.name, paused, collected: sim.state.collected.size, position: { ...sim.body.translation() }, camera: { yaw: controls.getAzimuthalAngle(), pitch: controls.getPolarAngle(), distance: controls.getDistance() }, drawCalls: renderer.info.render.calls }),
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frameId); abort.abort(); observer.disconnect(); releaseCameraDrag(); controls.dispose(); menu.close();
      const geometries = new Set(); scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (object.isInstancedMesh) object.dispose(); });
      for (const geometry of geometries) geometry.dispose();
      for (const value of materials.values()) { value.map?.dispose(); value.dispose(); }
      sim.dispose(); renderer.dispose(); renderer.forceContextLoss(); host.replaceChildren();
    }
  };
}
