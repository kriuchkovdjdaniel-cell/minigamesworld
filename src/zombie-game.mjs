import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createElement, Pause, Play, RotateCcw, Camera, Maximize, LogOut, Heart, Crosshair, Backpack, Fuel, Shield, Volume2, VolumeX } from "lucide";
import { createZombieSimulation, STOPS, STEP, normalizeCheckpoint, ROUTE_BOSSES, ROUTE_UPGRADES } from "./zombie-world.mjs";
import { buildRoadScenery } from "./zombie-scenery.mjs";
import { createRouteAudio, spatialMix } from "./zombie-audio.mjs";
import { mountPhotoMode } from "./photo-mode.mjs";
export { normalizeCheckpoint } from "./zombie-world.mjs";

const ICONS = { pause: Pause, resume: Play, restart: RotateCcw, camera: Camera, fullscreen: Maximize, exit: LogOut, heal: Heart, reload: Crosshair, inventory: Backpack, fuel: Fuel, shield: Shield, sound: Volume2 };

export async function mountZombieGame(host, options) {
  const sim = options.simulation || await createZombieSimulation(options.checkpoint);
  if (options.signal?.aborted) { sim.dispose(); throw new DOMException("Canceled", "AbortError"); }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: options.quality > 0, powerPreference: "high-performance" }); }
  catch (error) { sim.dispose(); throw new Error("3D graphics are unavailable. Enable hardware acceleration and retry.", { cause: error }); }
  const abort = new AbortController(), signal = abort.signal;
  const audio = createRouteAudio({ volume: options.getVolume || options.volume });
  try { audio.setMuted(localStorage.getItem("dead-route-muted") === "true"); } catch {}
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#a8c5d1");
  scene.fog = new THREE.Fog("#a8c5d1", 70, 175);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][options.quality] || 1));
  renderer.shadowMap.enabled = options.quality > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Dead Route 3D game scene");
  canvas.title = "WASD move or drive; right mouse rotates camera; click shoots; E interact; R reload; Space melee; H heal; Tab workshop";
  host.dataset.game = "dead-route-3d";
  host.innerHTML = `
    <style>
      #threeGameHost .route-status { position:absolute; top:96px; left:50%; transform:translateX(-50%); width:min(400px,calc(100% - 500px)); display:grid; gap:8px; pointer-events:none; }
      #threeGameHost .route-status .zombie-notice { position:static; transform:none; max-width:none; width:100%; box-sizing:border-box; }
      #threeGameHost .route-boss { padding:10px 14px; box-sizing:border-box; border:1px solid #b59a6d; border-radius:6px; background:#192d2ef2; color:#f4ecd7; font:14px Arial,sans-serif; }
      #threeGameHost .route-boss[hidden],#threeGameHost [data-route-upgrades][hidden] { display:none; }
      #threeGameHost .route-boss header { display:flex; justify-content:space-between; gap:12px; align-items:center; margin:0; padding:0; border:0; border-radius:0; background:none; box-shadow:none; }
      #threeGameHost .route-boss strong { font-size:15px; }
      #threeGameHost .route-boss meter { display:block; width:100%; height:12px; margin:6px 0; accent-color:#d5b476; }
      #threeGameHost .route-boss small { display:block; min-height:16px; color:#cddbd1; }
      #threeGameHost .route-boss[data-phase="windup"] { border-color:#f5cc77; background:#3c3325f5; }
      #threeGameHost [data-route-upgrades] { text-align:left; }
      #threeGameHost [data-route-upgrades] p { color:#cddbd1; margin:8px 0 14px; font:14px/1.5 Arial,sans-serif; }
      #threeGameHost [data-route-choice] { display:flex; align-items:flex-start; flex-direction:column; width:100%; min-height:80px; gap:6px; margin:8px 0; padding:12px 16px; border:1px solid #698e87; border-radius:6px; text-align:left; background:#233e3b; color:#edf3df; text-transform:none; white-space:normal; box-sizing:border-box; }
      #threeGameHost [data-route-choice] strong { font:700 16px Arial,sans-serif; }
      #threeGameHost [data-route-choice] small { font:13px/1.5 Arial,sans-serif; color:#cddbd1; }
      #threeGameHost [data-route-choice]:nth-of-type(2) { background:#343344; border-color:#90809f; }
      #threeGameHost [data-route-choice]:nth-of-type(3) { background:#34402f; border-color:#8c9d74; }
      #threeGameHost [data-route-choice]:focus-visible { outline:3px solid #e4d49a; outline-offset:2px; }
      #threeGameHost [data-route-choice]:disabled { opacity:.6; cursor:default; }
      #threeGameHost [data-action="upgrade"] { color:#f0d495; }
      #threeGameHost[data-game="dead-route-3d"] .mgw-photo-open { left:320px; bottom:24px; }
      @media(max-width:900px) { #threeGameHost .route-status { width:min(320px,calc(100% - 32px)); } }
      @media(max-width:760px) { #threeGameHost .route-status { top:248px; } #threeGameHost[data-game="dead-route-3d"] .mgw-photo-open { left:12px; bottom:194px; } }
      @media(max-height:520px) { #threeGameHost .route-status { top:96px; width:280px; } #threeGameHost .route-boss { padding:5px 10px; } }
      @media(max-height:520px) and (max-width:760px) { #threeGameHost .route-status { top:148px; } }
    </style>
    <header class="zombie-header">
      <div class="zombie-brand"><span>MINIGAMEWORLD</span><strong>DEAD ROUTE <small>3D</small></strong></div>
      <div class="zombie-route"><span data-stop></span><strong data-objective></strong></div>
      <nav class="zombie-tools" aria-label="Game controls">
        <button data-action="upgrade" title="Choose route upgrade" aria-label="Choose route upgrade" hidden><i data-icon="shield"></i></button>
        <button data-action="sound" title="Mute game sounds (M)" aria-label="Mute game sounds" aria-pressed="false"><i data-icon="sound"></i></button>
        <button data-action="workshop" title="Inventory / Bus Workshop (Tab)" aria-label="Inventory and Bus Workshop"><i data-icon="inventory"></i></button>
        <button data-action="camera" title="Reset camera" aria-label="Reset camera"><i data-icon="camera"></i></button>
        <button data-action="fullscreen" title="Fullscreen" aria-label="Fullscreen"><i data-icon="fullscreen"></i></button>
        <button data-action="pause" title="Pause (Escape)" aria-label="Pause"><i data-icon="pause"></i></button>
      </nav>
    </header>
    <div class="route-status"><section class="route-boss" aria-label="Boss encounter" hidden>
      <header><strong data-boss-name></strong><output data-boss-health></output></header>
      <meter data-boss-meter min="0" max="1" value="1" aria-label="Boss health"></meter><small data-boss-attack></small>
    </section><p class="zombie-notice" role="status" aria-live="polite"></p></div>
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
    <dialog class="three-menu zombie-menu" aria-labelledby="zombieMenuTitle">
      <h2 id="zombieMenuTitle">Paused</h2><p data-result></p>
      <section data-route-upgrades hidden aria-label="Route upgrades">
        <p data-upgrade-instruction></p>
        ${ROUTE_UPGRADES.map(item => `<button data-route-choice="${item.id}"><strong>${item.name}</strong><small>${item.description}</small></button>`).join("")}
        <p data-upgrade-status role="status" aria-live="polite"></p>
      </section>
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
  if (options.cooperative) {
    host.querySelector(".zombie-brand strong").innerHTML = "DEAD ROUTE <small>CO-OP</small>";
    host.dataset.cooperative = "true";
    host.querySelector('[data-action="new"]').hidden = true;
    host.querySelector('[data-action="restart"]').hidden = options.slot !== "p1";
    host.querySelector('[data-action="restart"]').textContent = "Restart Journey";
    const team = document.createElement("aside"); team.className = "route-team"; team.setAttribute("aria-label", "Survivor team"); host.append(team);
  }
  for (const item of host.querySelectorAll("[data-icon]")) item.replaceWith(createElement(ICONS[item.dataset.icon], { width: 19, height: 19, "aria-hidden": "true" }));
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE };
  controls.minDistance = 6; controls.maxDistance = 24;
  controls.minPolarAngle = 0.28; controls.maxPolarAngle = 1.25;
  function resetCamera() { camera.position.copy(controls.target).add(new THREE.Vector3(8, 9, 16)); controls.update(); }
  controls.target.set(sim.position().x, 1.1, sim.position().z); resetCamera();
  scene.add(new THREE.HemisphereLight("#e5f1ff", "#638071", 2.1));
  const sun = new THREE.DirectionalLight("#fff0d7", 3.5);
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
  const roundedGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.055);
  geometries.add(boxGeo); geometries.add(cylinderGeo); geometries.add(coneGeo); geometries.add(roundedGeo);
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
  const { roofs, buildingCount } = buildRoadScenery({ scene, road: sim.road, box, material, label, boxGeo, cylinderGeo, coneGeo, geometries, textures, quality: options.quality });
  const treeTransform = new THREE.Object3D();
  for (const [color, boxes] of staticBoxes) {
    const batch = new THREE.InstancedMesh(boxGeo, material(color), boxes.length);
    boxes.forEach(([x, y, z, w, h, d], i) => { treeTransform.position.set(x, y, z); treeTransform.scale.set(w, h, d); treeTransform.updateMatrix(); batch.setMatrixAt(i, treeTransform.matrix); });
    batch.castShadow = batch.receiveShadow = true; scene.add(batch);
  }

  const bus = new THREE.Group(); scene.add(bus);
  box(bus, 0, 1.5, 0, 3.3, 2.1, 8.4, "#508f82").geometry = roundedGeo;
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
  const door = new THREE.Group(); door.position.set(1.72, 0, -3.3); bus.add(door);
  box(door, 0, 1.55, 0.55, 0.08, 2, 1.1, "#355b53");
  box(door, 0.06, 2.1, 0.55, 0.06, 0.8, 0.9, "#82a5ad");
  box(door, 0.1, 1.35, 0.95, 0.1, 0.12, 0.22, "#dbd6bb");
  for (const x of [-1.14, 1.14]) { box(bus, x, 1, -4.3, 0.48, 0.35, 0.12, "#f7df9b"); box(bus, x, 1, 4.3, 0.35, 0.25, 0.1, "#b76e64"); }
  const busSign = label("ROUTE 09", "#e8d899", "#293c3c", 256, 64); busSign.rotation.y = Math.PI; busSign.position.set(0, 3, -4.3); busSign.scale.setScalar(0.45); bus.add(busSign);
  box(bus, 0, 3.7, 1, 2.5, 0.65, 3.2, "#827963");
  box(bus, 0, 4.05, 1, 0.12, 0.1, 3.3, "#3a4d46");
  const armorParts = [];
  for (const side of [-1, 1]) {
    box(bus, side * 1.5, 3.6, 0.4, 0.08, 0.55, 6, "#566c6b");
    for (const z of [-2.5, 0.5, 3.3]) box(bus, side * 1.5, 3.7, z, 0.08, 0.15, 0.08, "#d4ceb7");
    for (let i = 0; i < 5; i++) {
      box(bus, side * 1.72, 2.65, -2.8 + i * 1.45, 0.02, 0.12, 0.95, "#799da4");
      box(bus, side * 1.73, 0.85, -2.9 + i * 1.4, 0.025, 0.08, 0.5, "#a3916e");
    }
    armorParts.push(box(bus, side * 1.75, 1.2, 0.6, 0.12, 0.7, 4.4, "#798a91"));
  }
  for (const y of [0.9, 1.3, 1.7, 2.1, 2.5, 2.9, 3.3]) box(bus, -1.08, y, 4.36, 0.55, 0.07, 0.12, "#93a6a3");
  for (const x of [-1.37, -0.8]) box(bus, x, 2.1, 4.36, 0.06, 2.7, 0.12, "#93a6a3");
  armorParts.push(box(bus, 0, 0.85, -4.6, 3.5, 0.15, 0.25, "#899d9c"));
  const backSign = label("09 / SAFE HAVEN", "#e8d899", "#293c3c", 256, 64); backSign.position.set(0.1, 1.55, 4.27); backSign.scale.setScalar(0.34); bus.add(backSign);
  const wheels = [];
  for (const x of [-1.7, 1.7]) for (const z of [-2.7, 2.7]) {
    const wheel = new THREE.Group(); wheel.position.set(x, 0.65, z);
    const tire = new THREE.Mesh(cylinderGeo, material("#293031")); tire.rotation.z = Math.PI / 2; tire.scale.set(0.68, 0.42, 0.68); tire.castShadow = true; wheel.add(tire);
    const hub = new THREE.Mesh(cylinderGeo, material("#c2c6b7")); hub.rotation.z = Math.PI / 2; hub.scale.set(0.29, 0.44, 0.29); wheel.add(hub); bus.add(wheel); wheels.push(wheel);
  }
  // Batch rigid bus trim, leaving the door, wheels and upgrade plates independent.
  const busBatches = new Map();
  for (const part of [...bus.children]) {
    if (!part.isMesh || part.geometry !== boxGeo || armorParts.includes(part)) continue;
    const key = part.material.uuid;
    if (!busBatches.has(key)) busBatches.set(key, []);
    busBatches.get(key).push(part);
  }
  for (const parts of busBatches.values()) {
    const batch = new THREE.InstancedMesh(boxGeo, parts[0].material, parts.length);
    parts.forEach((part, i) => { part.updateMatrix(); batch.setMatrixAt(i, part.matrix); bus.remove(part); });
    batch.castShadow = batch.receiveShadow = true; bus.add(batch);
  }
  function person(zombie = false, boss = false, variant = 0, color = options.color) {
    const group = new THREE.Group(), skin = zombie ? boss ? "#7c9070" : "#9aae86" : "#dbb597", shirt = zombie ? boss ? "#786e96" : ["#8c7872", "#6c8a95", "#909a76", "#a68f69"][variant % 4] : color || "#57938c";
    box(group, 0, 1.15, 0, 0.7, 0.7, 0.43, shirt).geometry = roundedGeo;
    box(group, 0, 1.8, 0, 0.52, 0.52, 0.46, skin).geometry = roundedGeo;
    box(group, 0, 2.04, 0.04, 0.55, 0.1, 0.53, zombie ? "#4b5549" : "#46493e");
    for (const x of [-0.12, 0.12]) box(group, x, 1.83, -0.23, 0.07, 0.07, 0.03, zombie ? "#dcb482" : "#293738");
    const arms = [-1, 1].map(side => { const joint = new THREE.Group(); joint.position.set(side * 0.44, 1.43, 0); box(joint, 0, -0.26, 0, 0.23, 0.62, 0.24, skin); group.add(joint); return joint; });
    const legs = [-1, 1].map(side => { const joint = new THREE.Group(); joint.position.set(side * 0.18, 0.85, 0); box(joint, 0, -0.39, 0, 0.26, 0.78, 0.32, zombie ? "#4c5a58" : "#3e535b"); group.add(joint); return joint; });
    for (const leg of legs) box(leg, 0, -0.71, -0.06, 0.29, 0.15, 0.42, "#334646");
    box(group, 0, 0.91, -0.23, 0.68, 0.12, 0.07, "#43534c");
    box(group, 0, 1.67, -0.25, 0.16, 0.035, 0.03, zombie ? "#666250" : "#896e5a");
    const gun = new THREE.Group(); group.add(gun); gun.position.set(0.42, 1.28, -0.5); gun.visible = !zombie;
    if (!zombie) {
      box(group, 0, 1.22, 0.3, 0.5, 0.65, 0.3, "#806e4d").geometry = roundedGeo;
      box(group, -0.22, 1.26, -0.25, 0.18, 0.4, 0.06, "#c5b787");
      box(gun, 0, 0, -0.13, 0.16, 0.19, 0.5, "#526674"); box(gun, 0, -0.13, 0.04, 0.13, 0.2, 0.15, "#34494b");
      box(gun, 0, 0.04, -0.41, 0.09, 0.1, 0.22, "#c2c8bd");
    }
    if (boss) { box(group, 0, 2.08, 0, 0.68, 0.22, 0.6, "#576571"); for (const x of [-0.43, 0.43]) box(group, x, 1.51, 0, 0.3, 0.3, 0.5, "#8b9290"); }
    if (boss) group.scale.setScalar(1.5);
    const health = new THREE.Group();
    if (zombie) {
      box(health, 0, 0, 0, 0.95, 0.08, 0.025, "#263c37");
      box(health, 0, 0, 0.018, 0.9, 0.045, 0.02, boss ? "#d5ad87" : "#9abb91");
      if (boss) {
        const name = label(ROUTE_BOSSES[sim.state.stopIndex].name.toUpperCase(), "#eee2b4", "#403f47", 512, 64);
        name.position.y = 0.3; name.scale.setScalar(0.35); health.add(name);
      }
      scene.add(health);
    }
    scene.add(group); return { group, arms, legs, health, gun, deathTime: null };
  }
  const survivor = person();
  const allies = new Map();
  let coopEpoch = null;
  const flashMaterial = new THREE.MeshBasicMaterial({ color: "#ffe6ac" }); materials.set("muzzle-flash", flashMaterial);
  const muzzle = new THREE.Mesh(coneGeo, flashMaterial); muzzle.rotation.x = -Math.PI / 2; muzzle.position.set(0, 0.03, -0.66); muzzle.scale.set(0.14, 0.34, 0.14); muzzle.visible = false; survivor.gun.add(muzzle);
  let enemies = new Map(), loot = new Map(), renderedStop = -1;
  const lootGeo = new THREE.OctahedronGeometry(0.25); geometries.add(lootGeo);
  function refreshStop() {
    for (const model of enemies.values()) scene.remove(model.group, model.health);
    for (const model of loot.values()) scene.remove(model.group);
    enemies = new Map(sim.state.enemies.map((enemy, i) => [enemy.id, person(true, enemy.boss, i)]));
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
  const warningGeo = new THREE.RingGeometry(0.9, 1, 48), warningFillGeo = new THREE.CircleGeometry(1, 48), laneGeo = new THREE.PlaneGeometry(1, 1);
  geometries.add(warningGeo); geometries.add(warningFillGeo); geometries.add(laneGeo);
  const warningMat = new THREE.MeshBasicMaterial({ color: "#f1bf67", transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const warningFillMat = warningMat.clone(); warningFillMat.opacity = 0.18;
  materials.set("boss-warning", warningMat); materials.set("boss-warning-fill", warningFillMat);
  const warning = new THREE.Group(), warningRing = new THREE.Mesh(warningGeo, warningMat), warningFill = new THREE.Mesh(warningFillGeo, warningFillMat);
  warning.add(warningRing, warningFill); warning.rotation.x = -Math.PI / 2; warning.visible = false; scene.add(warning);
  const particles = [], particleLimit = options.quality > 0 ? 64 : 24;
  const particleMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" }); materials.set("route-particles", particleMaterial);
  const particleMesh = new THREE.InstancedMesh(boxGeo, particleMaterial, particleLimit); particleMesh.frustumCulled = false; particleMesh.count = 0; scene.add(particleMesh);
  const particleTransform = new THREE.Object3D(), particleColor = new THREE.Color();
  let muzzleTime = 0, exhaustTime = 0;
  function burst(x, y, z, count, color, smoke = false) {
    for (let i = 0; i < count && particles.length < particleLimit; i++) {
      const angle = i * 2.4 + sim.state.elapsed;
      particles.push({ x, y, z, dx: Math.sin(angle) * (smoke ? 0.3 : 2), dy: smoke ? 0.9 : 1.5 + i % 3, dz: Math.cos(angle) * (smoke ? 0.3 : 2), life: smoke ? 0.65 : 0.3, max: smoke ? 0.65 : 0.3, color, smoke });
    }
  }
  const map = host.querySelector(".zombie-map"), mapCtx = map.getContext("2d"), menu = host.querySelector("dialog");
  const el = name => host.querySelector(`[data-${name}]`);
  const keys = new Set(), oneShot = new Set(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(0, 0);
  let pointerActive = false, shooting = false, cameraPointer = null, paused = false, ended = false, disposed = false, frameId = 0, previous = 0, accumulator = 0, hudTime = 0, noticeTime = 0, tracerTime = 0, lastWalking = false;
  let upgradePromptKey = "";
  const upgradeNeeded = () => sim.state.status === "playing" && sim.state.stopCleared && !sim.state.routeUpgrades?.[sim.state.stopIndex];
  function updateSoundButton() {
    const muted = audio.snapshot().muted, button = host.querySelector('[data-action="sound"]');
    button.replaceChildren(createElement(muted ? VolumeX : Volume2, { width: 19, height: 19, "aria-hidden": "true" }));
    button.setAttribute("aria-pressed", String(muted)); button.setAttribute("aria-label", muted ? "Unmute game sounds" : "Mute game sounds");
    button.title = muted ? "Unmute game sounds (M)" : "Mute game sounds (M)";
  }
  function toggleSound() {
    const muted = !audio.snapshot().muted; audio.setMuted(muted); updateSoundButton();
    try { localStorage.setItem("dead-route-muted", String(muted)); } catch {}
  }
  const groundAim = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.25), aimed = new THREE.Vector3();
  function notify(message) { if (!message) return; host.querySelector(".zombie-notice").textContent = message; noticeTime = 3.2; }
  function releaseCamera() {
    if (cameraPointer !== null && canvas.hasPointerCapture(cameraPointer)) canvas.releasePointerCapture(cameraPointer);
    cameraPointer = null; controls.disconnect(); controls.connect(canvas);
  }
  function clearInput() { keys.clear(); oneShot.clear(); shooting = false; releaseCamera(); sim.clearInput?.(); }
  function pause(value = !paused, workshop = false) {
    if (disposed || ended && !value) return;
    paused = value; options.onPause?.(value); clearInput(); controls.enabled = !value;
    audio.setPaused(value);
    if (paused) {
      if (!options.cooperative) { cancelAnimationFrame(frameId); frameId = 0; }
      updateHUD();
      const upgrade = !workshop && !ended && upgradeNeeded();
      el("route-upgrades").hidden = !upgrade;
      el("workshop").hidden = !workshop;
      host.querySelector("#zombieMenuTitle").textContent = ended ? sim.state.status === "won" ? "Safe Haven" : "Journey interrupted" : upgrade ? "Stop Secured" : workshop ? "Bus Workshop" : "Paused";
      el("result").textContent = ended ? `${sim.objective()} / ${sim.state.score} score / ${sim.state.kills} infected defeated` : options.cooperative ? "The co-op room stays live while this menu is open." : `${STOPS[sim.state.stopIndex].name} / Level ${sim.state.level}`;
      host.querySelector('[data-action="resume"]').hidden = ended;
      workshopUI();
      const freshButton = host.querySelector('[data-action="new"]'); freshButton.textContent = "New Journey"; delete freshButton.dataset.confirm;
      if (options.cooperative) { const restart = host.querySelector('[data-action="restart"]'); restart.textContent = "Restart Journey"; delete restart.dataset.confirm; }
      if (!menu.open) menu.showModal();
      if (upgrade) { upgradeUI(); host.querySelector('[data-route-choice]:not(:disabled)')?.focus(); }
    } else {
      if (menu.open) menu.close(); previous = 0; accumulator = 0; canvas.focus();
      if (!frameId && !document.hidden) frameId = requestAnimationFrame(frame);
    }
  }
  function upgradeUI() {
    const canChoose = !options.cooperative || options.slot === "p1";
    el("upgrade-instruction").textContent = canChoose ? "Choose one permanent journey upgrade. Every choice also adds 20 fuel." : "The host is choosing one upgrade for the whole team.";
    for (const button of host.querySelectorAll("[data-route-choice]")) button.disabled = !canChoose || !upgradeNeeded() || !!sim.upgradePending;
    el("upgrade-status").textContent = sim.upgradePending ? "Waiting for host confirmation..." : "";
  }
  function syncUpgradePrompt() {
    if (disposed || ended || host.dataset.photo === "true") return;
    const key = `${sim.epoch || "solo"}:${sim.state.stopIndex}`;
    if (upgradeNeeded() && upgradePromptKey !== key) { upgradePromptKey = key; pause(true); }
    else if (!upgradeNeeded() && menu.open && !el("route-upgrades").hidden) pause(false);
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
    if (options.cooperative) {
      const team = host.querySelector(".route-team"); team.replaceChildren();
      const title = document.createElement("strong"); title.textContent = `Room ${options.code} / ${sim.playerCount} survivors`; team.append(title);
      for (const ally of sim.teammates.values()) { const row = document.createElement("p"), name = document.createElement("span"), health = document.createElement("b"); name.textContent = ally.username; health.textContent = ally.health <= 0 ? "DOWN" : ally.inBus ? "IN BUS" : `${Math.ceil(ally.health)} HP`; row.append(name, health); team.append(row); }
    }
    el("stop").textContent = `STOP ${s.stopIndex + 1} / 3 - ${STOPS[s.stopIndex].name.toUpperCase()}`;
    el("objective").textContent = sim.objective();
    const boss = s.enemies.find(enemy => enemy.boss && enemy.hp > 0), bossPanel = host.querySelector(".route-boss");
    bossPanel.hidden = !boss;
    if (boss) {
      const spec = ROUTE_BOSSES[s.stopIndex]; bossPanel.dataset.phase = boss.bossPhase;
      el("boss-name").textContent = spec.name; el("boss-health").textContent = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
      el("boss-meter").max = boss.maxHp; el("boss-meter").value = boss.hp;
      el("boss-attack").textContent = boss.bossPhase === "windup" ? `${spec.attackName} / ${boss.bossTimer.toFixed(1)}s` : boss.bossPhase === "recover" ? "Recovering" : boss.bossPhase === "strike" ? spec.attackName : "Defend the bus";
    }
    host.querySelector('[data-action="upgrade"]').hidden = !upgradeNeeded();
    if (menu.open && !el("route-upgrades").hidden) upgradeUI();
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
    for (const b of sim.road.buildings) mapCtx.fillRect(76 + (b.x - b.w / 2 - p.x) * zoom, 76 + (b.z - b.d / 2 - p.z) * zoom, b.w * zoom, b.d * zoom);
    for (const item of s.loot) if (!item.taken) drawDot(item, "#e5c785", 3);
    for (const enemy of s.enemies) if (enemy.hp > 0) drawDot(enemy.body.translation(), "#d18780", enemy.boss ? 4 : 2.5);
    drawDot(sim.bus.body.translation(), "#8fb6d1", 5); drawDot(p, "#f5f1cd", 3);
  }
  function drainEvents() {
    for (const event of sim.state.events.splice(0)) {
      if (event.type === "checkpoint") options.onCheckpoint?.(event.checkpoint);
      if (event.type === "shot") {
        audio.play("shot", { rate: sim.state.weapon ? 1.12 : 0.94 }); muzzleTime = 0.06;
        const positions = tracerGeo.attributes.position; positions.setXYZ(0, event.from.x, event.from.y, event.from.z); positions.setXYZ(1, event.to.x, event.to.y, event.to.z); positions.needsUpdate = true;
        tracer.visible = true; tracerTime = 0.07;
      }
      if (["reload", "melee", "door", "loot", "upgrade", "heal"].includes(event.type)) audio.play(event.type);
      if (event.type === "level" || event.type === "stop-clear") audio.play("upgrade");
      if (event.type === "boss-warning") audio.play("reload", { rate: 0.6, gain: 0.6 });
      if (event.type === "boss-strike") { audio.play("melee", { rate: 0.55, gain: 0.8 }); burst(event.x, 0.3, event.z, 10, "#d6b683"); }
      if (event.type === "hit" || event.type === "hurt") {
        const mix = spatialMix(event, sim.position(), controls.getAzimuthalAngle());
        audio.play(event.type, { ...mix, gain: Math.max(0.15, mix.gain) * 0.65 });
        if (event.type === "hit") burst(event.x, 1.2, event.z, 6, "#e2ce99");
      }
      if (event.type === "kill") { const model = enemies.get(event.id); if (model) model.deathTime = sim.state.elapsed; burst(event.x, 0.7, event.z, 8, "#9faeaa"); }
      if (event.type === "finish") { ended = true; options.onFinish?.({ won: sim.state.status === "won", score: sim.state.score, seconds: sim.state.elapsed }); pause(true); }
      if (event.message) notify(event.message);
    }
  }
  function frame(now) {
    if (disposed) return;
    frameId = 0;
    const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 0; previous = now;
    if (options.cooperative) {
      sim.refresh(dt);
      if (coopEpoch && coopEpoch !== sim.epoch) { ended = false; paused = false; renderedStop = -1; menu.close(); controls.enabled = true; options.onPause?.(false); audio.setPaused(false); }
      coopEpoch = sim.epoch; drainEvents();
      if (renderedStop !== sim.state.stopIndex || enemies.size !== sim.state.enemies.length) refreshStop();
    }
    syncUpgradePrompt();
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
      while (accumulator >= STEP && !paused) {
        sim.step({ x: movement.x, z: movement.z, throttle: vertical, steer: horizontal, aim, shoot: shooting && cameraPointer === null,
          interact: oneShot.has("KeyE"), reload: oneShot.has("KeyR"), heal: oneShot.has("KeyH"), melee: keys.has("Space") });
        oneShot.clear(); accumulator -= STEP;
      }
      lastWalking = movement.lengthSq() > 0;
      drainEvents();
      syncUpgradePrompt();
      if (renderedStop !== sim.state.stopIndex) refreshStop();
      const nextTarget = new THREE.Vector3(sim.position().x, sim.state.inBus ? 2 : 1, sim.position().z);
      const delta = nextTarget.clone().sub(controls.target); controls.target.copy(nextTarget); camera.position.add(delta); controls.update();
      tracerTime -= dt; tracer.visible = tracerTime > 0;
      noticeTime -= dt; if (noticeTime <= 0) host.querySelector(".zombie-notice").textContent = "";
      audio.update({ position: sim.position(), inBus: sim.state.inBus, speed: sim.bus.speed, fuel: sim.state.fuel, enemies: sim.state.enemies, yaw: controls.getAzimuthalAngle() }, dt);
      muzzleTime -= dt; exhaustTime -= dt;
      if (sim.state.inBus && sim.state.fuel > 0 && exhaustTime <= 0) {
        exhaustTime = options.quality > 0 ? 0.18 : 0.4;
        const exhaust = bus.localToWorld(new THREE.Vector3(1.1, 0.55, 4.5)); burst(exhaust.x, exhaust.y, exhaust.z, 1, "#8c9d9c", true);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.dx * dt; p.y += p.dy * dt; p.z += p.dz * dt; if (!p.smoke) p.dy -= dt * 9;
      }
    }
    const t = sim.state.elapsed, pos = sim.player.body.translation();
    survivor.group.visible = !sim.state.inBus;
    survivor.group.rotation.z = sim.state.health <= 0 ? Math.PI / 2 : 0;
    if (options.cooperative) {
      for (const [slot, model] of allies) if (!sim.teammates.has(slot) || sim.teammates.get(slot).memberId !== model.memberId) { scene.remove(model.group, model.health); allies.delete(slot); }
      for (const [slot, ally] of sim.teammates) {
        let model = allies.get(slot);
        if (!model) { model = { ...person(false, false, 0, ally.color), memberId: ally.memberId }; allies.set(slot, model); }
        const p = ally.body.translation(), walking = model.lastPosition && Math.hypot(p.x - model.lastPosition.x, p.z - model.lastPosition.z) > 0.002;
        model.lastPosition = { ...p }; model.group.visible = !ally.inBus; model.group.position.set(p.x, p.y - 0.86, p.z); model.group.rotation.y = Math.atan2(-(ally.aim?.x ?? 0), -(ally.aim?.z ?? -1)); model.group.rotation.z = ally.health <= 0 ? Math.PI / 2 : 0;
        for (let i = 0; i < 2; i++) { model.legs[i].rotation.x = walking && ally.health > 0 ? Math.sin(t * 10 + i * Math.PI) * 0.35 : 0; model.arms[i].rotation.x = i ? -1.35 : 0; }
      }
    }
    survivor.group.position.set(pos.x, pos.y - 0.86, pos.z); survivor.group.rotation.y = Math.atan2(-sim.state.aim.x, -sim.state.aim.z);
    survivor.gun.scale.z = sim.state.weapon ? 1.3 : 1; survivor.gun.rotation.x = sim.state.reload > 0 ? 0.65 : Math.max(0, muzzleTime) * 3;
    muzzle.visible = muzzleTime > 0;
    for (let i = 0; i < 2; i++) {
      survivor.legs[i].rotation.x = !paused && lastWalking ? Math.sin(t * 11 + i * Math.PI) * 0.6 : 0;
      survivor.arms[i].rotation.x = i ? -1.35 - (sim.state.meleeCooldown > 0.4 ? 0.6 : 0) : survivor.legs[1 - i].rotation.x;
    }
    const b = sim.bus.body.translation(); bus.position.set(b.x, b.y - 1.5, b.z); bus.rotation.y = sim.bus.yaw;
    door.rotation.y += ((sim.state.inBus ? 0 : 0.8) - door.rotation.y) * Math.min(1, dt * 7);
    armorParts.forEach((part, i) => { part.visible = sim.state.armor > (i === 2 ? 1 : 0); });
    for (const wheel of wheels) wheel.rotation.x = -sim.bus.wheels / 0.68;
    for (const enemy of sim.state.enemies) {
      const model = enemies.get(enemy.id); if (!model) continue;
      const dying = model.deathTime === null ? 0 : Math.min(1, (t - model.deathTime) / 0.45);
      model.group.visible = enemy.hp > 0 || model.deathTime !== null && dying < 1;
      model.group.rotation.x = enemy.hp <= 0 ? -dying * Math.PI / 2 : 0;
      const p = enemy.body.translation(); model.group.position.set(p.x, p.y - 0.86, p.z); model.group.rotation.y = enemy.yaw;
      model.health.visible = enemy.hp > 0 && (enemy.hp < enemy.maxHp || enemy.boss);
      model.health.position.set(p.x, enemy.boss ? 3.5 : 2.5, p.z); model.health.quaternion.copy(camera.quaternion);
      model.health.children[1].scale.x = 0.9 * enemy.hp / enemy.maxHp;
      for (let i = 0; i < 2; i++) { model.legs[i].rotation.x = Math.sin(t * 6 + i * Math.PI) * 0.3; model.arms[i].rotation.x = -1.1 + Math.sin(t * 4 + i) * 0.15; }
      model.group.scale.setScalar((enemy.boss ? 1.5 : 1) * (enemy.flash > 0 ? 1.04 : 1));
      if (enemy.boss && enemy.bossPhase === "windup") for (const arm of model.arms) arm.rotation.x = -2.4;
    }
    const attackingBoss = sim.state.enemies.find(enemy => enemy.boss && enemy.hp > 0 && enemy.telegraph);
    warning.visible = !!attackingBoss;
    if (attackingBoss) {
      const zone = attackingBoss.telegraph, lane = zone.kind === "charge";
      warningRing.geometry = lane ? laneGeo : warningGeo; warningFill.geometry = lane ? laneGeo : warningFillGeo;
      warning.position.set(zone.x + (lane ? zone.dx * zone.length / 2 : 0), 0.06, zone.z + (lane ? zone.dz * zone.length / 2 : 0));
      warning.rotation.z = lane ? Math.atan2(zone.dx, zone.dz) : 0;
      warning.scale.set(lane ? zone.radius * 2 : zone.radius, lane ? zone.length : zone.radius, 1);
      warningRing.visible = !lane; warningFillMat.opacity = attackingBoss.bossPhase === "strike" ? 0.55 : 0.22 + Math.sin(t * 8) * 0.06;
      warningMat.color.set(attackingBoss.bossPhase === "strike" ? "#f19c78" : ROUTE_BOSSES[sim.state.stopIndex].color); warningFillMat.color.copy(warningMat.color);
    }
    for (const item of sim.state.loot) { const model = loot.get(item.id); model.group.visible = !item.taken; model.marker.rotation.y = t; model.marker.position.y = 1.8 + Math.sin(t * 2) * 0.1; }
    for (const roof of roofs) roof.mesh.visible = sim.state.inBus || Math.abs(pos.x - roof.building.x) > roof.building.w / 2 + 1 || Math.abs(pos.z - roof.building.z) > roof.building.d / 2 + 2;
    particleMesh.count = particles.length;
    particles.forEach((p, i) => {
      particleTransform.position.set(p.x, p.y, p.z); particleTransform.rotation.set(p.life * 3, p.life * 4, 0);
      particleTransform.scale.setScalar(p.smoke ? 0.13 + (1 - p.life / p.max) * 0.3 : 0.07 * p.life / p.max);
      particleTransform.updateMatrix(); particleMesh.setMatrixAt(i, particleTransform.matrix); particleMesh.setColorAt(i, particleColor.set(p.color));
    });
    particleMesh.instanceMatrix.needsUpdate = true; if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    aimMarker.visible = !sim.state.inBus && pointerActive && !paused;
    aimMarker.position.set(pos.x + sim.state.aim.x * 5, 0.08, pos.z + sim.state.aim.z * 5);
    sun.position.set(controls.target.x - 24, 35, controls.target.z + 18); sun.target.position.copy(controls.target);
    hudTime += dt; if (hudTime > 0.1 || !previous) { updateHUD(); hudTime = 0; }
    renderer.render(scene, camera);
    if (!document.hidden && (!paused || options.cooperative)) frameId = requestAnimationFrame(frame);
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
    if (button.dataset.action !== "sound") void audio.unlock();
    if (button.dataset.routeChoice) {
      if (sim.chooseUpgrade?.(button.dataset.routeChoice, sim.state.stopIndex)) { drainEvents(); upgradeUI(); syncUpgradePrompt(); updateHUD(); }
      return;
    }
    if (button.dataset.buy) { sim.purchase(button.dataset.buy); drainEvents(); workshopUI(); updateHUD(); return; }
    switch (button.dataset.action) {
      case "pause": pause(true); break;
      case "resume": pause(false); break;
      case "workshop": pause(true, true); break;
      case "upgrade": pause(true); break;
      case "sound": toggleSound(); break;
      case "camera": resetCamera(); break;
      case "fullscreen": options.onFullscreen?.(); break;
      case "restart":
        if (options.cooperative && button.dataset.confirm !== "yes") { button.dataset.confirm = "yes"; button.textContent = "Confirm Restart for Everyone"; }
        else options.onRestart?.(false);
        break;
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
    if (!paused && !ended) void audio.unlock();
    if (event.code === "KeyM" && !event.repeat && !paused && !ended) { event.preventDefault(); toggleSound(); return; }
    if (event.code === "Escape") { event.preventDefault(); if (!ended) pause(!paused); return; }
    if (event.code === "Tab" && !paused && !ended) { event.preventDefault(); pause(true, true); return; }
    if (paused || ended || !["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyE", "KeyR", "KeyH", "Space"].includes(event.code)) return;
    event.preventDefault(); keys.add(event.code); if (!event.repeat) oneShot.add(event.code);
  }, { signal });
  window.addEventListener("keyup", event => keys.delete(event.code), { signal });
  canvas.addEventListener("pointerdown", event => {
    if (host.dataset.photo === "true") return;
    if (paused || ended) return;
    void audio.unlock();
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
    if (host.dataset.photo === "true") return;
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
    audio.dispose();
    delete host.dataset.cooperative;
  }
  options.signal?.addEventListener("abort", dispose, { once: true });
  const photo = !options.cooperative ? mountPhotoMode(host, { renderer, scene, camera, controls, signal, canOpen: () => !disposed && !paused && !ended, pause: () => pause(true), resume: () => pause(false) }) : null;
  drainEvents(); updateHUD(); updateSoundButton(); canvas.focus(); void audio.unlock(); syncUpgradePrompt(); frameId = requestAnimationFrame(frame);
  return { pause, dispose, snapshot: () => ({ status: sim.state.status, stop: sim.state.stopIndex, paused, elapsed: sim.state.elapsed, photo: photo?.snapshot(), inBus: sim.state.inBus, health: sim.state.health,
    busHealth: sim.state.busHealth, stopCleared: sim.state.stopCleared, routeUpgrades: [...(sim.state.routeUpgrades || [])], upgradePending: upgradeNeeded(),
    boss: (() => { const enemy = sim.state.enemies.find(e => e.boss); return enemy ? { name: enemy.bossName, hp: enemy.hp, maxHp: enemy.maxHp, phase: enemy.bossPhase, timer: enemy.bossTimer, telegraph: enemy.telegraph ? { ...enemy.telegraph } : null } : null; })(),
    enemies: sim.state.enemies.filter(e => e.hp > 0).length, position: sim.position(), camera: { yaw: controls.getAzimuthalAngle(), pitch: controls.getPolarAngle(), distance: controls.getDistance() }, drawCalls: renderer.info.render.calls, buildings: buildingCount, particles: particles.length, audio: audio.snapshot() }) };
}
