import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createElement, Pause, Play, RotateCcw, Camera, Maximize, LogOut, Heart, Crosshair, Backpack, Fuel, Shield } from "lucide";
import { createZombieSimulation, STOPS, STEP, normalizeCheckpoint } from "./zombie-world.mjs";
export { normalizeCheckpoint } from "./zombie-world.mjs";

const ICONS = { pause: Pause, resume: Play, restart: RotateCcw, camera: Camera, fullscreen: Maximize, exit: LogOut, heal: Heart, reload: Crosshair, inventory: Backpack, fuel: Fuel, shield: Shield };

export async function mountZombieGame(host, options) {
  const sim = await createZombieSimulation(options.checkpoint);
  if (options.signal?.aborted) { sim.dispose(); throw new DOMException("Canceled", "AbortError"); }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: options.quality > 0, powerPreference: "high-performance" }); }
  catch (error) { sim.dispose(); throw new Error("3D graphics are unavailable. Enable hardware acceleration and retry.", { cause: error }); }
  const abort = new AbortController(), signal = abort.signal;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#b8c8c8");
  scene.fog = new THREE.Fog("#b8c8c8", 48, 150);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][options.quality] || 1));
  renderer.shadowMap.enabled = options.quality > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Dead Route 3D game scene");
  canvas.title = "WASD move or drive; right mouse rotates camera; click shoots; E interact; R reload; Space melee; H heal; Tab workshop";
  host.dataset.game = "dead-route-3d";
  host.innerHTML = `
    <header class="zombie-header">
      <div class="zombie-brand"><span>MINIGAMEWORLD</span><strong>DEAD ROUTE <small>3D</small></strong></div>
      <div class="zombie-route"><span data-stop></span><strong data-objective></strong></div>
      <nav class="zombie-tools" aria-label="Game controls">
        <button data-action="workshop" title="Inventory / Bus Workshop (Tab)" aria-label="Inventory and Bus Workshop"><i data-icon="inventory"></i></button>
        <button data-action="camera" title="Reset camera" aria-label="Reset camera"><i data-icon="camera"></i></button>
        <button data-action="fullscreen" title="Fullscreen" aria-label="Fullscreen"><i data-icon="fullscreen"></i></button>
        <button data-action="pause" title="Pause (Escape)" aria-label="Pause"><i data-icon="pause"></i></button>
      </nav>
    </header>
    <canvas class="zombie-map" width="152" height="152" aria-label="Nearby survivors, infected, bus and supplies"></canvas>
    <section class="zombie-vitals" aria-label="Survivor and bus status">
      <div><i data-icon="heal"></i><span>Survivor</span><output data-health></output><meter data-health-meter min="0" max="100"></meter></div>
      <div><i data-icon="shield"></i><span>Bus</span><output data-bus></output><meter data-bus-meter min="0" max="140"></meter></div>
      <div><i data-icon="fuel"></i><span>Fuel</span><output data-fuel></output><meter data-fuel-meter min="0" max="100"></meter></div>
      <footer><span data-level></span><span data-xp></span></footer>
    </section>
    <div class="zombie-ammo"><span data-weapon></span><strong data-ammo></strong><small data-resources></small></div>
    <div class="zombie-interaction"><button data-action="interact" title="Interact (E)" hidden></button></div>
    <div class="zombie-actions">
      <button data-action="heal" title="Use medkit (H)" aria-label="Use medkit"><i data-icon="heal"></i></button>
      <button data-action="reload" title="Reload (R)" aria-label="Reload"><i data-icon="reload"></i></button>
    </div>
    <p class="zombie-notice" role="status" aria-live="polite"></p>
    <dialog class="three-menu zombie-menu" aria-labelledby="zombieMenuTitle">
      <h2 id="zombieMenuTitle">Paused</h2><p data-result></p>
      <section data-workshop hidden>
        <div class="zombie-inventory"><span data-inventory></span></div>
        <div class="zombie-offers">
          <button data-buy="repair">Repair Bus <small>8 scrap / +50 integrity</small></button>
          <button data-buy="armor">Armor Plating <small>18 scrap / +40 max integrity</small></button>
          <button data-buy="weapon">Carbine Upgrade <small>22 scrap / faster fire</small></button>
          <button data-buy="refuel">Fuel Reserve <small>5 scrap / +35 fuel</small></button>
          <button data-buy="ammo">Ammo Box <small>5 scrap / +36 rounds</small></button>
          <button data-buy="heal">Medkit <small>1 medkit / +60 health</small></button>
        </div>
        <p data-workshop-status role="status"></p>
      </section>
      <button data-action="resume"><i data-icon="resume"></i>Resume</button>
      <button data-action="restart"><i data-icon="restart"></i>Retry Stop</button>
      <button data-action="new">New Journey</button>
      <button data-action="exit"><i data-icon="exit"></i>Return to Games</button>
    </dialog>`;
  host.prepend(canvas);
  for (const item of host.querySelectorAll("[data-icon]")) item.replaceWith(createElement(ICONS[item.dataset.icon], { width: 19, height: 19, "aria-hidden": "true" }));
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE };
  controls.minDistance = 6; controls.maxDistance = 24;
  controls.minPolarAngle = 0.28; controls.maxPolarAngle = 1.25;
  function resetCamera() { camera.position.copy(controls.target).add(new THREE.Vector3(7, 12, 16)); controls.update(); }
  controls.target.set(sim.position().x, 1.1, sim.position().z); resetCamera();
  scene.add(new THREE.HemisphereLight("#e1f0ef", "#4d695c", 2.4));
  const sun = new THREE.DirectionalLight("#fff1d6", 3.1);
  sun.castShadow = true; sun.shadow.mapSize.setScalar(options.quality > 1 ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 100 });
  sun.shadow.bias = -0.001; scene.add(sun, sun.target);
  const materials = new Map(), textures = [], geometries = new Set();
  const material = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }));
    return materials.get(key);
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1), cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 10), coneGeo = new THREE.ConeGeometry(1, 1, 7);
  geometries.add(boxGeo); geometries.add(cylinderGeo); geometries.add(coneGeo);
  const staticBoxes = new Map();
  function box(parent, x, y, z, w, h, d, color, batch = false) {
    if (batch) {
      if (!staticBoxes.has(color)) staticBoxes.set(color, []);
      staticBoxes.get(color).push([x, y, z, w, h, d]); return;
    }
    const mesh = new THREE.Mesh(boxGeo, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function label(text, color = "#e9f0da", bg = "#203d3a", width = 512, height = 96) {
    const image = document.createElement("canvas"); image.width = width; image.height = height;
    const ctx = image.getContext("2d"); ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.strokeRect(5, 5, width - 10, height - 10);
    ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `bold ${height * 0.46}px sans-serif`;
    ctx.fillText(text, width / 2, height / 2, width - 30);
    const tex = new THREE.CanvasTexture(image); tex.colorSpace = THREE.SRGBColorSpace; textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }); materials.set(`label-${textures.length}`, mat);
    const geo = new THREE.PlaneGeometry(width / height, 1); geometries.add(geo);
    return new THREE.Mesh(geo, mat);
  }
  box(scene, 0, -0.25, -145, 190, 0.5, 410, "#577761", true);
  box(scene, 0, 0.015, -145, 13, 0.04, 380, "#42494a", true);
  for (const side of [-1, 1]) box(scene, side * 6.15, 0.043, -145, 0.13, 0.025, 370, "#d4d3ba", true);
  for (let z = 28; z > -320; z -= 9) box(scene, 0, 0.045, z, 0.16, 0.025, 4, "#d2bf77", true);
  const roofs = [];
  for (const b of sim.road.buildings) {
    box(scene, b.x, 0.07, b.z + 1, 13, 0.15, 14, "#a9aaa0", true);
    for (const w of sim.road.walls.filter(w => Math.abs(w.x - b.x) < 7 && Math.abs(w.z - b.z) <= 5)) box(scene, w.x, w.y, w.z, w.w, w.h, w.d, b.color, true);
    const roof = box(scene, b.x, 4.3, b.z, 12.8, 0.35, 11, "#e0d9bf"); roofs.push({ mesh: roof, building: b });
    const sign = label(b.name); sign.position.set(b.x, 3.4, b.z + 5.3); sign.scale.setScalar(1.8); scene.add(sign);
    box(scene, b.x, 0.6, b.z - 3.8, 9, 1.2, 1.2, "#6c5950", true);
    for (let i = -1; i <= 1; i++) box(scene, b.x + i * 2.5, 1.6, b.z - 3.8, 1.1, 0.7, 0.9, i % 2 ? "#879b81" : "#b19775", true);
    if (b.side === -1) {
      for (const dx of [-2, 2]) {
        box(scene, b.x + dx, 0.9, b.z + 9, 0.9, 1.8, 0.65, "#d6c39a", true);
        box(scene, b.x + dx, 1.3, b.z + 9.35, 0.65, 0.55, 0.08, "#243c3e", true);
      }
    }
  }
  for (const stop of STOPS) {
    const sign = label(stop.name.toUpperCase(), "#fff1cd", "#354b48");
    sign.position.set(9, 3.6, stop.z + 17); sign.scale.setScalar(0.9); scene.add(sign);
    box(scene, 9, 1.8, stop.z + 17, 0.14, 3.6, 0.14, "#707b77", true);
    for (const side of [-1, 1]) {
      box(scene, side * 8, 0.45, stop.z - 33, 2.8, 0.9, 0.5, "#adab96", true);
      box(scene, side * 8, 0.46, stop.z - 32.72, 1.5, 0.2, 0.04, "#b58458", true);
    }
  }
  const sanctuary = label("SAFE HAVEN", "#d4edca", "#315a4c"); sanctuary.position.set(0, 6.5, -304); sanctuary.scale.setScalar(2); scene.add(sanctuary);
  for (const x of [-8, 8]) box(scene, x, 3, -304, 0.6, 6, 0.6, "#626f66", true);
  box(scene, 0, 3, -321, 35, 6, 1, "#8c9b87", true);
  const quarantine = label("QUARANTINE ZONE", "#eadca4", "#575b57"); quarantine.position.set(0, 5.8, -235); quarantine.scale.setScalar(1.6); scene.add(quarantine);
  for (const x of [-8, 8]) box(scene, x, 3, -235, 0.35, 6, 0.35, "#8f9890", true);
  for (const x of [-25, 25]) {
    box(scene, x, 4.2, -225, 4, 1.5, 4, "#6b7b74", true);
    box(scene, x, 5.7, -225, 4.5, 0.25, 4.5, "#ced2c0", true);
    for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) box(scene, x + dx, 2.1, -225 + dz, 0.18, 4.2, 0.18, "#667d73", true);
    for (let i = 0; i < 4; i++) box(scene, x > 0 ? 12 + i * 3 : -12 - i * 3, 0.5, -234, 2.6, 1, 1, "#b3af91", true);
  }
  const tank = new THREE.Mesh(cylinderGeo, material("#92a9aa")); tank.position.set(26, 9, -125); tank.scale.set(2.2, 3.2, 2.2); tank.castShadow = true; scene.add(tank);
  for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) box(scene, 26 + dx, 3.8, -125 + dz, 0.2, 7.6, 0.2, "#657a76", true);
  // Instanced roadside vegetation keeps the full road inexpensive to render.
  const treeTransform = new THREE.Object3D();
  const trunks = new THREE.InstancedMesh(cylinderGeo, material("#6c6256"), 100);
  const crowns = new THREE.InstancedMesh(coneGeo, material("#456f60"), 100);
  for (let i = 0; i < 100; i++) {
    const side = i % 2 ? -1 : 1, x = side * (32 + i % 7 * 4), z = 30 - Math.floor(i / 2) * 7.3, h = 5 + i % 4;
    treeTransform.position.set(x, 1.8, z); treeTransform.scale.set(0.3, 3.6, 0.3); treeTransform.updateMatrix(); trunks.setMatrixAt(i, treeTransform.matrix);
    treeTransform.position.y = h / 2 + 2; treeTransform.scale.set(2.5 + i % 3 * 0.5, h, 2.5 + i % 3 * 0.5); treeTransform.updateMatrix(); crowns.setMatrixAt(i, treeTransform.matrix);
  }
  trunks.castShadow = crowns.castShadow = true; scene.add(trunks, crowns);
  for (let i = 0; i < 14; i++) {
    const mountain = new THREE.Mesh(coneGeo, material(i % 2 ? "#899ca0" : "#9ca5a0"));
    mountain.position.set((i % 2 ? 1 : -1) * (75 + i % 3 * 10), 8, 10 - Math.floor(i / 2) * 55);
    mountain.scale.set(35, 40 + i % 3 * 10, 40); scene.add(mountain);
  }
  for (let i = 0; i < 12; i++) {
    const z = 18 - i * 29;
    box(scene, 26, 4.5, z, 0.22, 9, 0.22, "#766c5a", true);
    box(scene, 26, 8.4, z, 3.2, 0.18, 0.18, "#766c5a", true);
    box(scene, 25, 8.7, z - 14.5, 0.035, 0.035, 29, "#5c665d", true);
  }
  for (const [color, boxes] of staticBoxes) {
    const batch = new THREE.InstancedMesh(boxGeo, material(color), boxes.length);
    boxes.forEach(([x, y, z, w, h, d], i) => { treeTransform.position.set(x, y, z); treeTransform.scale.set(w, h, d); treeTransform.updateMatrix(); batch.setMatrixAt(i, treeTransform.matrix); });
    batch.castShadow = batch.receiveShadow = true; scene.add(batch);
  }

  const bus = new THREE.Group(); scene.add(bus);
  box(bus, 0, 1.5, 0, 3.3, 2.1, 8.4, "#447f72");
  box(bus, 0, 2.9, 0, 3.3, 0.7, 8.4, "#e5debd");
  box(bus, 0, 0.55, 0, 3.35, 0.35, 8.55, "#303b3c");
  box(bus, 0, 3.34, 0, 3.45, 0.2, 8.55, "#d1ceae");
  box(bus, 0, 2.25, -4.23, 2.95, 1.25, 0.06, "#263f48");
  box(bus, 0, 2.25, -4.28, 0.1, 1.3, 0.08, "#d3cdb3");
  box(bus, 0, 2.25, 4.23, 2.3, 1.1, 0.06, "#263f48");
  for (const x of [-1.68, 1.68]) {
    for (let i = 0; i < 5; i++) box(bus, x, 2.35, -2.8 + i * 1.45, 0.055, 0.95, 1.18, "#294652");
    box(bus, x, 1.15, 0, 0.08, 0.14, 8.2, "#d4bd7c");
    box(bus, x * 1.19, 2.2, -3.9, 0.35, 0.55, 0.2, "#344749");
  }
  box(bus, 1.72, 1.55, -2.75, 0.08, 2, 1.1, "#355b53");
  box(bus, 1.78, 2.1, -2.75, 0.06, 0.8, 0.9, "#64848a");
  for (const x of [-1.14, 1.14]) { box(bus, x, 1, -4.3, 0.48, 0.35, 0.12, "#f7df9b"); box(bus, x, 1, 4.3, 0.35, 0.25, 0.1, "#b76e64"); }
  const busSign = label("ROUTE 09", "#e8d899", "#293c3c", 256, 64); busSign.rotation.y = Math.PI; busSign.position.set(0, 3, -4.3); busSign.scale.setScalar(0.45); bus.add(busSign);
  box(bus, 0, 3.7, 1, 2.5, 0.65, 3.2, "#827963");
  box(bus, 0, 4.05, 1, 0.12, 0.1, 3.3, "#3a4d46");
  const wheels = [];
  for (const x of [-1.7, 1.7]) for (const z of [-2.7, 2.7]) {
    const wheel = new THREE.Group(); wheel.position.set(x, 0.65, z);
    const tire = new THREE.Mesh(cylinderGeo, material("#293031")); tire.rotation.z = Math.PI / 2; tire.scale.set(0.68, 0.42, 0.68); tire.castShadow = true; wheel.add(tire);
    const hub = new THREE.Mesh(cylinderGeo, material("#c2c6b7")); hub.rotation.z = Math.PI / 2; hub.scale.set(0.29, 0.44, 0.29); wheel.add(hub); bus.add(wheel); wheels.push(wheel);
  }
  function person(zombie = false, boss = false) {
    const group = new THREE.Group(), skin = zombie ? boss ? "#7c9070" : "#9aae86" : "#dbb597", shirt = zombie ? boss ? "#7b607a" : "#807b6c" : options.color || "#57938c";
    box(group, 0, 1.15, 0, 0.65, 0.7, 0.38, shirt);
    box(group, 0, 1.8, 0, 0.49, 0.52, 0.44, skin);
    box(group, 0, 2.04, 0.04, 0.55, 0.1, 0.53, zombie ? "#4b5549" : "#46493e");
    for (const x of [-0.12, 0.12]) box(group, x, 1.83, -0.23, 0.07, 0.07, 0.03, zombie ? "#dcb482" : "#293738");
    const arms = [-1, 1].map(side => { const joint = new THREE.Group(); joint.position.set(side * 0.44, 1.43, 0); box(joint, 0, -0.26, 0, 0.23, 0.62, 0.24, skin); group.add(joint); return joint; });
    const legs = [-1, 1].map(side => { const joint = new THREE.Group(); joint.position.set(side * 0.18, 0.85, 0); box(joint, 0, -0.39, 0, 0.26, 0.78, 0.32, zombie ? "#4c5a58" : "#3e535b"); group.add(joint); return joint; });
    if (!zombie) { box(group, 0, 1.22, 0.3, 0.5, 0.65, 0.3, "#806e4d"); box(arms[1], 0, -0.56, -0.28, 0.14, 0.2, 0.5, "#28353a"); }
    if (boss) group.scale.setScalar(1.5);
    const health = new THREE.Group();
    if (zombie) {
      box(health, 0, 0, 0, 0.95, 0.08, 0.025, "#263c37");
      box(health, 0, 0, 0.018, 0.9, 0.045, 0.02, boss ? "#d5ad87" : "#9abb91");
      if (boss) {
        const name = label("ROADWARDEN", "#eee2b4", "#403f47", 256, 64);
        name.position.y = 0.3; name.scale.setScalar(0.35); health.add(name);
      }
      scene.add(health);
    }
    scene.add(group); return { group, arms, legs, health };
  }
  const survivor = person();
  let enemies = new Map(), loot = new Map(), renderedStop = -1;
  const lootGeo = new THREE.OctahedronGeometry(0.25); geometries.add(lootGeo);
  function refreshStop() {
    for (const model of enemies.values()) scene.remove(model.group, model.health);
    for (const model of loot.values()) scene.remove(model.group);
    enemies = new Map(sim.state.enemies.map(enemy => [enemy.id, person(true, enemy.boss)]));
    loot = new Map(sim.state.loot.map(item => {
      const group = new THREE.Group(); group.position.set(item.x, 0, item.z);
      box(group, 0, 0.45, 0, 1.05, 0.9, 0.85, item.color);
      box(group, 0, 0.91, 0, 1.12, 0.12, 0.92, "#d4d3ad");
      box(group, 0, 0.45, -0.44, 0.15, 0.7, 0.03, "#eee6bf");
      const marker = new THREE.Mesh(lootGeo, material(item.color, { emissive: item.color, emissiveIntensity: 0.15 })); marker.position.y = 1.7; group.add(marker); scene.add(group);
      return [item.id, { group, marker }];
    }));
    renderedStop = sim.state.stopIndex;
  }
  refreshStop();
  const tracerGeo = new THREE.BufferGeometry(); tracerGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)); geometries.add(tracerGeo);
  const tracerMat = new THREE.LineBasicMaterial({ color: "#fff0a4" }); materials.set("tracer", tracerMat);
  const tracer = new THREE.Line(tracerGeo, tracerMat); tracer.visible = false; tracer.frustumCulled = false; scene.add(tracer);
  const aimGeo = new THREE.RingGeometry(0.25, 0.32, 24); geometries.add(aimGeo);
  const aimMat = new THREE.MeshBasicMaterial({ color: "#f8e1a0", side: THREE.DoubleSide, depthWrite: false }); materials.set("aim", aimMat);
  const aimMarker = new THREE.Mesh(aimGeo, aimMat); aimMarker.rotation.x = -Math.PI / 2; scene.add(aimMarker);
  const map = host.querySelector(".zombie-map"), mapCtx = map.getContext("2d"), menu = host.querySelector("dialog");
  const el = name => host.querySelector(`[data-${name}]`);
  const keys = new Set(), oneShot = new Set(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(0, 0);
  let pointerActive = false, shooting = false, cameraPointer = null, paused = false, ended = false, disposed = false, frameId = 0, previous = 0, accumulator = 0, hudTime = 0, noticeTime = 0, tracerTime = 0, lastWalking = false;
  let soundContext, shotBuffer;
  function shotSound() {
    const volume = Math.max(0, Math.min(1, options.volume ?? 0.7));
    if (!volume) return;
    try {
      soundContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (soundContext.state === "suspended") { soundContext.resume().catch(() => {}); return; }
      if (!shotBuffer) {
        shotBuffer = soundContext.createBuffer(1, Math.floor(soundContext.sampleRate * 0.1), soundContext.sampleRate);
        const data = shotBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 7);
      }
      const source = soundContext.createBufferSource(), filter = soundContext.createBiquadFilter(), gain = soundContext.createGain();
      source.buffer = shotBuffer; filter.type = "lowpass"; filter.frequency.value = 1700; gain.gain.value = volume * 0.16;
      source.connect(filter); filter.connect(gain); gain.connect(soundContext.destination); source.start();
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    } catch { /* Sound is optional when the browser blocks audio. */ }
  }
  const groundAim = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.25), aimed = new THREE.Vector3();
  function notify(message) { if (!message) return; host.querySelector(".zombie-notice").textContent = message; noticeTime = 3.2; }
  function releaseCamera() {
    if (cameraPointer !== null && canvas.hasPointerCapture(cameraPointer)) canvas.releasePointerCapture(cameraPointer);
    cameraPointer = null; controls.disconnect(); controls.connect(canvas);
  }
  function clearInput() { keys.clear(); oneShot.clear(); shooting = false; releaseCamera(); }
  function pause(value = !paused, workshop = false) {
    if (disposed || ended && !value) return;
    paused = value; options.onPause?.(value); clearInput(); controls.enabled = !value;
    if (paused) {
      cancelAnimationFrame(frameId); frameId = 0;
      updateHUD();
      el("workshop").hidden = !workshop;
      host.querySelector("#zombieMenuTitle").textContent = ended ? sim.state.status === "won" ? "Safe Haven" : "Journey interrupted" : workshop ? "Bus Workshop" : "Paused";
      el("result").textContent = ended ? `${sim.objective()} / ${sim.state.score} score / ${sim.state.kills} infected defeated` : `${STOPS[sim.state.stopIndex].name} / Level ${sim.state.level}`;
      host.querySelector('[data-action="resume"]').hidden = ended;
      workshopUI();
      const freshButton = host.querySelector('[data-action="new"]'); freshButton.textContent = "New Journey"; delete freshButton.dataset.confirm;
      if (!menu.open) menu.showModal();
    } else {
      if (menu.open) menu.close(); previous = 0; accumulator = 0; canvas.focus();
      if (!frameId && !document.hidden) frameId = requestAnimationFrame(frame);
    }
  }
  function workshopUI() {
    const s = sim.state, near = s.inBus || Math.hypot(sim.player.body.translation().x - sim.bus.body.translation().x, sim.player.body.translation().z - sim.bus.body.translation().z) <= 7;
    el("inventory").textContent = `${s.scrap} scrap / ${s.ammo} reserve ammo / ${s.medkits} medkits`;
    const enabled = { repair: near && s.scrap >= 8 && s.busHealth < s.maxBusHealth, armor: near && s.scrap >= 18 && s.armor < 2, weapon: near && s.scrap >= 22 && !s.weapon, refuel: near && s.scrap >= 5 && s.fuel < 100, ammo: near && s.scrap >= 5 && s.ammo < 300, heal: s.medkits > 0 && s.health < s.maxHealth };
    for (const button of host.querySelectorAll("[data-buy]")) button.disabled = !enabled[button.dataset.buy] || ended;
    el("workshop-status").textContent = near ? `Armor ${s.armor}/2 / ${s.weapon ? "Carbine equipped" : "Pistol equipped"}` : "Workshop unavailable: bus out of range";
  }
  function updateHUD() {
    const s = sim.state;
    el("stop").textContent = `STOP ${s.stopIndex + 1} / 3 - ${STOPS[s.stopIndex].name.toUpperCase()}`;
    el("objective").textContent = sim.objective();
    for (const [key, value, max] of [["health", s.health, s.maxHealth], ["bus", s.busHealth, s.maxBusHealth], ["fuel", s.fuel, 100]]) {
      el(key).textContent = `${Math.ceil(value)} / ${max}`; el(key + "-meter").max = max; el(key + "-meter").value = value;
    }
    el("level").textContent = `LEVEL ${s.level}`; el("xp").textContent = `${s.xp} / ${s.level * 40} XP`;
    el("weapon").textContent = s.inBus ? "ROUTE 09" : s.weapon ? "CARBINE" : "SERVICE PISTOL";
    el("ammo").textContent = s.inBus ? `${Math.round(Math.abs(sim.bus.speed) * 6)} km/h` : s.reload > 0 ? "Reloading" : `${s.magazine} / ${s.ammo}`;
    el("resources").textContent = `${s.scrap} scrap / ${s.medkits} medkits`;
    host.querySelector('[data-action="heal"]').disabled = !s.medkits || s.health >= s.maxHealth;
    host.querySelector('[data-action="reload"]').disabled = s.inBus || s.reload > 0 || s.magazine === 12 || !s.ammo;
    const prompt = sim.prompt(), button = host.querySelector('[data-action="interact"]'); button.hidden = !prompt;
    if (prompt) { button.textContent = prompt.text; button.disabled = prompt.action === "exit" && Math.abs(sim.bus.speed) > 1; }
    host.classList.toggle("zombie-hurt", s.damageFlash > 0);
    mapCtx.fillStyle = "#172d29"; mapCtx.fillRect(0, 0, 152, 152);
    const p = sim.position(), zoom = 2;
    const drawDot = (point, color, radius) => {
      const x = 76 + (point.x - p.x) * zoom, z = 76 + (point.z - p.z) * zoom;
      if (x < 2 || x > 150 || z < 2 || z > 150) return;
      mapCtx.fillStyle = color; mapCtx.beginPath(); mapCtx.arc(x, z, radius, 0, Math.PI * 2); mapCtx.fill();
    };
    mapCtx.fillStyle = "#49574b"; mapCtx.fillRect(76 + (-6.5 - p.x) * zoom, 0, 13 * zoom, 152);
    mapCtx.fillStyle = "#779187";
    for (const b of sim.road.buildings) mapCtx.fillRect(76 + (b.x - 6 - p.x) * zoom, 76 + (b.z - 5 - p.z) * zoom, 24, 20);
    for (const item of s.loot) if (!item.taken) drawDot(item, "#e5c785", 3);
    for (const enemy of s.enemies) if (enemy.hp > 0) drawDot(enemy.body.translation(), "#d18780", enemy.boss ? 4 : 2.5);
    drawDot(sim.bus.body.translation(), "#8fb6d1", 5); drawDot(p, "#f5f1cd", 3);
  }
  function drainEvents() {
    for (const event of sim.state.events.splice(0)) {
      if (event.type === "checkpoint") options.onCheckpoint?.(event.checkpoint);
      if (event.type === "shot") {
        shotSound();
        const positions = tracerGeo.attributes.position; positions.setXYZ(0, event.from.x, event.from.y, event.from.z); positions.setXYZ(1, event.to.x, event.to.y, event.to.z); positions.needsUpdate = true;
        tracer.visible = true; tracerTime = 0.07;
      }
      if (["loot", "level"].includes(event.type)) options.onPickup?.();
      if (event.type === "finish") { ended = true; options.onFinish?.({ won: sim.state.status === "won", score: sim.state.score }); pause(true); }
      if (event.message) notify(event.message);
    }
  }
  function frame(now) {
    if (disposed) return;
    frameId = 0;
    const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 0; previous = now;
    if (!paused && !document.hidden) {
      const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const horizontal = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      const vertical = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown"));
      const movement = forward.multiplyScalar(vertical).add(right.multiplyScalar(horizontal));
      const p = sim.player.body.translation();
      let aim = sim.state.aim;
      if (pointerActive && cameraPointer === null) {
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(groundAim, aimed)) aim = { x: aimed.x - p.x, z: aimed.z - p.z };
      } else if (movement.lengthSq() > 0) aim = { x: movement.x, z: movement.z };
      accumulator += dt;
      while (accumulator >= STEP) {
        sim.step({ x: movement.x, z: movement.z, throttle: vertical, steer: horizontal, aim, shoot: shooting && cameraPointer === null,
          interact: oneShot.has("KeyE"), reload: oneShot.has("KeyR"), heal: oneShot.has("KeyH"), melee: keys.has("Space") });
        oneShot.clear(); accumulator -= STEP;
      }
      lastWalking = movement.lengthSq() > 0;
      drainEvents();
      if (renderedStop !== sim.state.stopIndex) refreshStop();
      const nextTarget = new THREE.Vector3(sim.position().x, sim.state.inBus ? 2 : 1, sim.position().z);
      const delta = nextTarget.clone().sub(controls.target); controls.target.copy(nextTarget); camera.position.add(delta); controls.update();
      tracerTime -= dt; tracer.visible = tracerTime > 0;
      noticeTime -= dt; if (noticeTime <= 0) host.querySelector(".zombie-notice").textContent = "";
    }
    const t = sim.state.elapsed, pos = sim.player.body.translation();
    survivor.group.visible = !sim.state.inBus;
    survivor.group.position.set(pos.x, pos.y - 0.86, pos.z); survivor.group.rotation.y = Math.atan2(-sim.state.aim.x, -sim.state.aim.z);
    for (let i = 0; i < 2; i++) {
      survivor.legs[i].rotation.x = !paused && lastWalking ? Math.sin(t * 11 + i * Math.PI) * 0.6 : 0;
      survivor.arms[i].rotation.x = i ? -1.35 - (sim.state.meleeCooldown > 0.4 ? 0.6 : 0) : survivor.legs[1 - i].rotation.x;
    }
    const b = sim.bus.body.translation(); bus.position.set(b.x, b.y - 1.5, b.z); bus.rotation.y = sim.bus.yaw;
    for (const wheel of wheels) wheel.rotation.x = -sim.bus.wheels / 0.68;
    for (const enemy of sim.state.enemies) {
      const model = enemies.get(enemy.id); if (!model) continue;
      model.group.visible = enemy.hp > 0;
      const p = enemy.body.translation(); model.group.position.set(p.x, p.y - 0.86, p.z); model.group.rotation.y = enemy.yaw;
      model.health.visible = enemy.hp > 0 && (enemy.hp < enemy.maxHp || enemy.boss);
      model.health.position.set(p.x, enemy.boss ? 3.5 : 2.5, p.z); model.health.quaternion.copy(camera.quaternion);
      model.health.children[1].scale.x = 0.9 * enemy.hp / enemy.maxHp;
      for (let i = 0; i < 2; i++) { model.legs[i].rotation.x = Math.sin(t * 6 + i * Math.PI) * 0.3; model.arms[i].rotation.x = -1.1 + Math.sin(t * 4 + i) * 0.15; }
      model.group.scale.setScalar((enemy.boss ? 1.5 : 1) * (enemy.flash > 0 ? 1.04 : 1));
    }
    for (const item of sim.state.loot) { const model = loot.get(item.id); model.group.visible = !item.taken; model.marker.rotation.y = t; model.marker.position.y = 1.8 + Math.sin(t * 2) * 0.1; }
    for (const roof of roofs) roof.mesh.visible = sim.state.inBus || Math.abs(pos.x - roof.building.x) > 7 || Math.abs(pos.z - roof.building.z) > 7;
    aimMarker.visible = !sim.state.inBus && pointerActive && !paused;
    aimMarker.position.set(pos.x + sim.state.aim.x * 5, 0.08, pos.z + sim.state.aim.z * 5);
    sun.position.set(controls.target.x - 24, 35, controls.target.z + 18); sun.target.position.copy(controls.target);
    hudTime += dt; if (hudTime > 0.1 || !previous) { updateHUD(); hudTime = 0; }
    renderer.render(scene, camera);
    if (!document.hidden && !paused) frameId = requestAnimationFrame(frame);
  }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height || disposed) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (paused) renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  host.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button || button.disabled) return;
    if (button.dataset.buy) { sim.purchase(button.dataset.buy); drainEvents(); workshopUI(); updateHUD(); return; }
    switch (button.dataset.action) {
      case "pause": pause(true); break;
      case "resume": pause(false); break;
      case "workshop": pause(true, true); break;
      case "camera": resetCamera(); break;
      case "fullscreen": options.onFullscreen?.(); break;
      case "restart": options.onRestart?.(false); break;
      case "new":
        if (button.dataset.confirm === "yes") options.onRestart?.(true);
        else { button.dataset.confirm = "yes"; button.textContent = "Confirm New Journey"; }
        break;
      case "exit": options.onExit?.(); break;
      case "interact": oneShot.add("KeyE"); canvas.focus(); break;
      case "heal": oneShot.add("KeyH"); canvas.focus(); break;
      case "reload": oneShot.add("KeyR"); canvas.focus(); break;
    }
  }, { signal });
  window.addEventListener("keydown", event => {
    if (event.code === "Escape") { event.preventDefault(); if (!ended) pause(!paused); return; }
    if (event.code === "Tab" && !paused && !ended) { event.preventDefault(); pause(true, true); return; }
    if (paused || ended || !["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyE", "KeyR", "KeyH", "Space"].includes(event.code)) return;
    event.preventDefault(); keys.add(event.code); if (!event.repeat) oneShot.add(event.code);
  }, { signal });
  window.addEventListener("keyup", event => keys.delete(event.code), { signal });
  canvas.addEventListener("pointerdown", event => {
    if (paused || ended) return;
    canvas.focus();
    if (event.button === 2) { cameraPointer = event.pointerId; shooting = false; }
    else { event.stopImmediatePropagation(); if (event.button === 0) shooting = true; }
  }, { capture: true, signal });
  canvas.addEventListener("pointermove", event => {
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); pointerActive = true;
    if (cameraPointer !== null && !(event.buttons & 2)) releaseCamera();
  }, { capture: true, signal });
  window.addEventListener("pointerup", event => { if (event.button === 0) shooting = false; if (event.button === 2) releaseCamera(); }, { signal });
  canvas.addEventListener("pointercancel", clearInput, { signal });
  canvas.addEventListener("lostpointercapture", () => { if (cameraPointer !== null) { cameraPointer = null; controls.disconnect(); controls.connect(canvas); } }, { signal });
  canvas.addEventListener("contextmenu", event => event.preventDefault(), { signal });
  canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); ended = true; pause(true); host.querySelector("#zombieMenuTitle").textContent = "Graphics interrupted"; el("result").textContent = "Retry this stop to restore the scene."; }, { signal });
  menu.addEventListener("cancel", event => { event.preventDefault(); if (!ended) pause(false); }, { signal });
  window.addEventListener("blur", () => { if (!paused && !ended) pause(true); else clearInput(); }, { signal });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { pause(true); cancelAnimationFrame(frameId); frameId = 0; }
    else if (!frameId && !disposed) { previous = 0; frameId = requestAnimationFrame(frame); }
  }, { signal });
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frameId); clearInput(); abort.abort(); observer.disconnect(); controls.dispose();
    if (menu.open) menu.close();
    scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    for (const geometry of geometries) geometry.dispose();
    for (const mat of materials.values()) mat.dispose();
    for (const texture of textures) texture.dispose();
    renderer.dispose(); renderer.forceContextLoss(); sim.dispose(); host.classList.remove("zombie-hurt");
    soundContext?.close().catch(() => {});
  }
  options.signal?.addEventListener("abort", dispose, { once: true });
  drainEvents(); updateHUD(); canvas.focus(); frameId = requestAnimationFrame(frame);
  return { pause, dispose, snapshot: () => ({ status: sim.state.status, stop: sim.state.stopIndex, paused, inBus: sim.state.inBus, health: sim.state.health, enemies: sim.state.enemies.filter(e => e.hp > 0).length, position: sim.position(), camera: { yaw: controls.getAzimuthalAngle(), pitch: controls.getPolarAngle(), distance: controls.getDistance() }, drawCalls: renderer.info.render.calls }) };
}
