import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createElement, Menu, Maximize, Camera, Play, LogOut, RotateCcw } from "lucide";
import { createKartWorld, TRACKS, KART_STEP, trackPoint } from "./kart-world.mjs";
import { makeBombAvatar } from "./online-bomb-scene.mjs";
import { createCollectionAudio } from "./collection-audio.mjs";
import { createRouteAudio } from "./zombie-audio.mjs";
import { emotePose, mountEmotePicker } from "./avatar-emotes.mjs";
import { formatTrialTime } from "./ghost-replay.mjs";
import "./kart-game.css";

export async function mountKartGame(host, options) {
  const sim = await createKartWorld(options.trackIndex);
  if (options.signal?.aborted) { sim.dispose(); throw new DOMException("Canceled", "AbortError"); }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: options.quality > 0, powerPreference: "high-performance" }); }
  catch (error) { sim.dispose(); throw error; }
  const abort = new AbortController(), signal = abort.signal, quality = options.quality || 0;
  const audio = createCollectionAudio({ volume: options.getVolume }), engine = createRouteAudio({ volume: options.getVolume });
  const scene = new THREE.Scene(); scene.background = new THREE.Color(sim.track.sky); scene.fog = new THREE.Fog(sim.track.sky, 100, 250);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][quality])); renderer.shadowMap.enabled = quality > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.dataset.kart = "true";
  host.innerHTML = `<header class="kart-hud"><div><small>MINIGAMEWORLD</small><strong>Coastline Karts</strong><span>${sim.track.name}</span></div><div class="kart-stats"><span>Lap <output data-lap>1 / 3</output></span><span>Place <output data-place>1 / 4</output></span><span>Time <output data-time>0:00.00</output></span></div><nav>${["camera", "fullscreen", "menu"].map(action => `<button data-action="${action}" title="${action === "camera" ? "Reset camera" : action === "menu" ? "Race menu" : "Fullscreen"}" aria-label="${action}"></button>`).join("")}</nav></header>
    <output class="kart-countdown" aria-live="polite"></output><section class="kart-speed"><strong data-speed>0</strong><span>km/h</span><label>Drift boost <meter data-boost min="0" max="1.5" value="0"></meter></label></section>
    <dialog class="three-menu kart-menu" aria-labelledby="kart-title"><h2 id="kart-title">Garage</h2><p data-result></p><div class="kart-garage"><label>Track<select data-track>${TRACKS.map((track, i) => `<option value="${i}">${track.name}</option>`).join("")}</select></label><label>Paint<input data-paint type="color" value="#55b8a8"></label><label>Body<select data-body><option value="sprint">Sprint</option><option value="touring">Touring</option></select></label></div><button data-action="resume">Start Race</button><button data-action="restart">Restart Race</button><button data-action="exit">Return to Games</button></dialog>`;
  const canvas = renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Coastline Karts 3D race"); canvas.title = "WASD / arrows: drive; Space: drift; right mouse: orbit; Escape: menu"; host.prepend(canvas);
  const icons = { camera: Camera, fullscreen: Maximize, menu: Menu, resume: Play, restart: RotateCcw, exit: LogOut };
  for (const button of host.querySelectorAll("[data-action]")) button.prepend(createElement(icons[button.dataset.action], { width: 19, height: 19 }));
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300), controls = new OrbitControls(camera, canvas);
  controls.enableDamping = controls.enablePan = false; controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE }; controls.minDistance = 7; controls.maxDistance = 30; controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.25;
  const target = sim.karts[0].body.translation(); controls.target.set(target.x, 1, target.z);
  function resetCamera() { const yaw = sim.karts[0].yaw; camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(yaw) * 12, 9, Math.cos(yaw) * 12)); controls.update(); }
  resetCamera(); scene.add(new THREE.HemisphereLight("#eff7f4", "#526d65", 2.3));
  const sun = new THREE.DirectionalLight("#fff1d4", 3); sun.position.set(-40, 65, 30); sun.castShadow = quality > 0; sun.shadow.mapSize.setScalar(quality > 1 ? 2048 : 1024); Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, far: 180 }); sun.shadow.bias = -0.002; scene.add(sun);
  const geometry = new THREE.BoxGeometry(1, 1, 1), materials = new Map(), geometries = new Set([geometry]);
  const material = color => { if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 })); return materials.get(color); };
  const staticBoxes = new Map();
  function box(parent, x, y, z, w, h, d, color, yaw = 0) {
    if (parent === scene) { if (!staticBoxes.has(color)) staticBoxes.set(color, []); staticBoxes.get(color).push([x, y, z, w, h, d, yaw]); return; }
    const mesh = new THREE.Mesh(geometry, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.y = yaw; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  box(scene, 0, -0.2, 0, 240, 0.3, 220, sim.track.ground);
  for (let i = 0; i < 128; i++) {
    const a = trackPoint(sim.track, i / 128), b = trackPoint(sim.track, (i + 1) / 128), yaw = Math.atan2(b.x - a.x, b.z - a.z);
    box(scene, (a.x + b.x) / 2, 0.02, (a.z + b.z) / 2, 11, 0.1, Math.hypot(b.x - a.x, b.z - a.z) + 0.3, "#4f6069", yaw);
    if (i % 4 === 0) box(scene, a.x, 0.09, a.z, 0.12, 0.03, 1.5, "#e1dfc1", yaw);
  }
  for (const barrier of sim.barriers) box(scene, barrier.x, 0.45, barrier.z, 0.5, 0.9, barrier.length + 0.1, barrier.stripe ? sim.track.accent : "#e5e2cb", barrier.yaw);
  for (const f of [0.19, 0.69]) { const p = trackPoint(sim.track, f), n = trackPoint(sim.track, f + 0.01), yaw = Math.atan2(n.x - p.x, n.z - p.z); box(scene, p.x, 0.13, p.z, 4.5, 0.04, 2.2, "#66c8c0", yaw); for (const z of [-0.6, 0, 0.6]) box(scene, p.x + Math.sin(yaw) * z, 0.17, p.z + Math.cos(yaw) * z, 3.5, 0.03, 0.12, "#e4f3d7", yaw); }
  for (let x = 0; x < 12; x++) for (let z = 0; z < 2; z++) box(scene, sim.track.rx - 5.5 + x, 0.15, z - 0.5, 0.95, 0.04, 0.95, (x + z) % 2 ? "#f0ecda" : "#273e49");
  for (const side of [-1, 1]) { box(scene, sim.track.rx + side * 6, 2, 0, 0.3, 4, 0.3, "#587f83"); for (let i = 0; i < 3; i++) box(scene, sim.track.rx + side * 6, 3.5, i * 0.35, 0.9, 0.5, 0.3, i % 2 ? "#e4ebd7" : "#425b62"); }
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4, x = Math.cos(a) * (sim.track.rx + 16 + i % 3 * 7), z = Math.sin(a) * (sim.track.rz + 17 + i % 4 * 6), h = 3 + i % 4 * 2;
    box(scene, x, h / 2, z, 5, h, 5, ["#c3b1ab", "#9bafba", "#d5c6a4"][i % 3]); box(scene, x, h + 0.15, z, 5.4, 0.3, 5.4, "#617b83");
    for (let floor = 1; floor < h; floor += 2) for (const side of [-1, 1]) box(scene, x + side * 1.3, floor, z + 2.52, 0.8, 1.1, 0.04, "#e2e8d2");
  }
  if (sim.state.trackIndex === 0) {
    box(scene, 0, 0, 0, sim.track.rx * 1.4, 0.3, sim.track.rz * 1.3, "#60969f");
    for (let i = 0; i < 6; i++) { const x = (i % 3 - 1) * 10, z = (Math.floor(i / 3) - 0.5) * 12; box(scene, x, 0.4, z, 5, 0.8, 2, "#d8ddd1"); box(scene, x, 1.2, z, 2, 1, 1.8, sim.track.accent); box(scene, x - 1, 2.8, z, 0.12, 5, 0.12, "#e2d8ba"); box(scene, x + 0.1, 3.7, z, 2, 2.2, 0.06, "#f2e6c9"); box(scene, x, 0.4, z + 3, 7, 0.4, 1.2, "#9b8e76"); }
  } else if (sim.state.trackIndex === 1) {
    for (let i = 0; i < 7; i++) {
      const geometry = new THREE.ConeGeometry(5 + i % 3, 9 + i % 3 * 3, 5); geometries.add(geometry);
      const rock = new THREE.Mesh(geometry, material(i % 2 ? "#8b9b9c" : "#d3dfd6")); rock.position.set((i % 3 - 1) * 10, 4.5 + i % 3 * 1.5, (Math.floor(i / 3) - 1) * 12); scene.add(rock);
    }
  } else {
    for (const side of [-1, 1]) for (let row = 0; row < 4; row++) { box(scene, 0, row * 0.5, side * (8 + row), 35, 0.5, 1, row % 2 ? "#b6a1c8" : "#9dbcb0"); }
    for (let i = 0; i < 3; i++) box(scene, (i - 1) * 3, 0.8 + (i === 1 ? 0.4 : 0), 0, 2.8, 1.6 + (i === 1 ? 0.8 : 0), 3, i === 1 ? "#d5bf83" : "#96aebe");
  }
  const treeGeo = new THREE.ConeGeometry(1.6, 4.2, 6); geometries.add(treeGeo);
  for (let i = 0; i < 20; i++) { const p = trackPoint(sim.track, i / 20, 10); box(scene, p.x, 1.1, p.z, 0.3, 2.2, 0.3, "#877e69"); const tree = new THREE.Mesh(treeGeo, material(i % 2 ? "#588972" : "#739b73")); tree.position.set(p.x, 3, p.z); tree.castShadow = true; scene.add(tree); }
  const transform = new THREE.Object3D();
  for (const [color, boxes] of staticBoxes) {
    const batch = new THREE.InstancedMesh(geometry, material(color), boxes.length);
    boxes.forEach(([x, y, z, w, h, d, yaw], i) => { transform.position.set(x, y, z); transform.scale.set(w, h, d); transform.rotation.set(0, yaw, 0); transform.updateMatrix(); batch.setMatrixAt(i, transform.matrix); }); batch.receiveShadow = batch.castShadow = true; scene.add(batch);
  }
  const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12); geometries.add(wheelGeometry);
  const models = sim.karts.map((kart, i) => {
    const group = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: ["#55b8a8", "#d6a36c", "#b395cd", "#dc8d9b"][i], roughness: 0.45 }); materials.set(`kart-${i}`, paint);
    const body = box(group, 0, 0.48, 0, 1.3, 0.32, 2.1, "#4f6970"); body.material = paint;
    box(group, 0, 0.28, 0, 1.45, 0.16, 2.25, "#283c49"); box(group, 0, 0.65, -0.65, 1, 0.25, 0.7, "#e6d9ac").material = paint;
    const spoiler = box(group, 0, 1, 0.85, 1.65, 0.12, 0.4, "#e3d6aa");
    const wheels = [];
    for (const x of [-0.76, 0.76]) for (const z of [-0.68, 0.68]) { const wheel = new THREE.Mesh(wheelGeometry, material("#293c44")); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.36, z); group.add(wheel); wheels.push(wheel); }
    const driver = makeBombAvatar({ name: "", color: options.color || "#97cfba", size: 0.65, skin: !i ? options.pixelSkin : "", palette: options.palette || [], accessory: "" }); driver.group.position.y = 0.67; group.add(driver.group); scene.add(group);
    return { group, paint, spoiler, driver, wheels };
  });
  const menu = host.querySelector("dialog"), el = name => host.querySelector(`[data-${name}]`), keys = new Set();
  let paused = true, started = false, disposed = false, frameId = 0, previous = 0, accumulator = 0, activeEmote = null, finished = false, cameraDragging = false, orbitUntil = 0;
  const emotes = mountEmotePicker(menu, { signal, play: id => { activeEmote = { id, at: performance.now() }; } });
  let garage = { paint: "#55b8a8", body: "sprint" };
  try { const saved = JSON.parse(localStorage.getItem(options.storageKey + "-garage") || "null"); if (/^#[0-9a-f]{6}$/i.test(saved?.paint)) garage.paint = saved.paint; if (saved?.body === "touring") garage.body = saved.body; } catch {}
  el("paint").value = garage.paint; el("body").value = garage.body; el("track").value = sim.state.trackIndex;
  const appearance = () => { models[0].paint.color.set(el("paint").value); models[0].spoiler.visible = el("body").value === "sprint"; try { localStorage.setItem(options.storageKey + "-garage", JSON.stringify({ paint: el("paint").value, body: el("body").value })); } catch {} };
  appearance(); el("paint").addEventListener("input", appearance, { signal }); el("body").addEventListener("change", appearance, { signal });
  function pause(value) {
    if (disposed) return; paused = value; keys.clear(); releaseCamera(); controls.enabled = !value; options.onPause?.(value); audio.setPaused(value); engine.setPaused(value);
    if (value) { if (!menu.open) menu.showModal(); } else { menu.close(); previous = 0; canvas.focus(); void audio.unlock(); void engine.unlock(); }
  }
  function render(now, dt) {
    for (let i = 0; i < models.length; i++) {
      const kart = sim.karts[i], model = models[i], p = kart.body.translation(); model.group.position.set(p.x, 0, p.z); model.group.rotation.y = kart.yaw;
      const pose = i === 0 ? emotePose(activeEmote?.id, finished ? 0.6 : (now - (activeEmote?.at || 0)) / 1000) : emotePose("", 0);
      model.driver.group.position.y = 0.67 + pose.y; model.driver.group.rotation.set(pose.tilt, pose.yaw, 0);
      for (const wheel of model.wheels) if (!paused) wheel.rotation.x -= kart.speed * dt / 0.36;
    }
    const p = sim.karts[0].body.translation(), next = new THREE.Vector3(p.x, 1, p.z), delta = next.clone().sub(controls.target); camera.position.add(delta); controls.target.copy(next);
    if (!paused && !cameraDragging && now > orbitUntil) { const yaw = sim.karts[0].yaw, desired = next.clone().add(new THREE.Vector3(Math.sin(yaw) * 12, 9, Math.cos(yaw) * 12)); camera.position.lerp(desired, 1 - Math.exp(-dt * 3)); }
    controls.update();
    el("lap").textContent = `${Math.min(3, sim.karts[0].lap + 1)} / 3`; el("place").textContent = `${sim.state.place} / 4`; el("time").textContent = formatTrialTime(sim.state.elapsed); el("speed").textContent = Math.round(Math.abs(sim.karts[0].speed) * 5); el("boost").value = sim.karts[0].boosting ? 1.5 : sim.karts[0].drift;
    host.querySelector(".kart-countdown").textContent = started && sim.state.countdown > 0 ? Math.ceil(sim.state.countdown) : "";
    renderer.render(scene, camera);
  }
  function frame(now) {
    if (disposed) return; frameId = 0;
    const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 0; previous = now;
    if (!paused && !finished) {
      if (keys.size) activeEmote = null;
      accumulator += dt;
      while (accumulator >= KART_STEP) { sim.step({ throttle: Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")), steer: Number(keys.has("KeyA") || keys.has("ArrowLeft")) - Number(keys.has("KeyD") || keys.has("ArrowRight")), drift: keys.has("Space") }); accumulator -= KART_STEP; }
      for (const event of sim.state.events.splice(0)) audio.play(event);
      engine.update({ position: sim.karts[0].body.translation(), inBus: true, speed: sim.karts[0].speed, fuel: 100, enemies: [], yaw: controls.getAzimuthalAngle() }, dt);
      if (sim.state.status === "finished") {
        finished = true; activeEmote = { id: emotes.victory, at: now }; pause(true); el("result").textContent = `Place ${sim.state.place} / ${formatTrialTime(sim.state.elapsed)}`; host.querySelector("#kart-title").textContent = "Race Complete"; host.querySelector('[data-action="resume"]').hidden = true;
        try { const key = options.storageKey + "-best-" + sim.state.trackIndex, best = Number(localStorage.getItem(key)); if (!best || sim.state.elapsed < best) { localStorage.setItem(key, String(sim.state.elapsed)); el("result").textContent += " / New personal best"; } } catch {}
        options.onFinish?.({ won: sim.state.place === 1, score: (5 - sim.state.place) * 250, seconds: sim.state.elapsed });
      }
    }
    render(now, dt); if (!document.hidden) frameId = requestAnimationFrame(frame);
  }
  host.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "menu") { host.querySelector("#kart-title").textContent = "Race Menu"; pause(true); }
    if (action === "resume") { if (+el("track").value !== sim.state.trackIndex) options.onTrack?.(+el("track").value, true); else { started = true; host.querySelector('[data-action="resume"]').lastChild.textContent = "Resume"; pause(false); } }
    if (action === "restart") options.onTrack?.(+el("track").value, true);
    if (action === "camera") resetCamera(); if (action === "fullscreen") options.onFullscreen?.(); if (action === "exit") options.onExit?.();
  }, { signal });
  window.addEventListener("keydown", event => {
    if (event.target.closest?.("input,select,textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Escape" && !menu.open) { event.preventDefault(); pause(true); }
    if (!paused && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) { event.preventDefault(); keys.add(event.code); }
  }, { signal });
  window.addEventListener("keyup", event => keys.delete(event.code), { signal }); window.addEventListener("blur", () => pause(true), { signal });
  menu.addEventListener("cancel", event => { event.preventDefault(); if (started && !finished) pause(false); }, { signal });
  canvas.addEventListener("pointerdown", event => { canvas.focus(); if (event.button !== 2 || paused) event.stopImmediatePropagation(); else cameraDragging = true; }, { capture: true, signal });
  function releaseCamera() { if (cameraDragging) { cameraDragging = false; orbitUntil = performance.now() + 3000; controls.disconnect(); controls.connect(canvas); } }
  window.addEventListener("pointerup", releaseCamera, { signal }); canvas.addEventListener("pointercancel", releaseCamera, { signal }); canvas.addEventListener("lostpointercapture", releaseCamera, { signal });
  canvas.addEventListener("contextmenu", event => event.preventDefault(), { signal });
  canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); pause(true); el("result").textContent = "Graphics interrupted. Restart the race."; host.querySelector('[data-action="resume"]').hidden = true; }, { signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(true); cancelAnimationFrame(frameId); frameId = 0; } else if (!disposed && !frameId) { previous = 0; frameId = requestAnimationFrame(frame); } }, { signal });
  const resize = () => { if (!host.clientWidth || !host.clientHeight || disposed) return; renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  try { const best = Number(localStorage.getItem(options.storageKey + "-best-" + sim.state.trackIndex)); el("result").textContent = `Personal best: ${formatTrialTime(best || undefined)}`; } catch {}
  pause(!options.autoStart); if (options.autoStart) started = true; frameId = requestAnimationFrame(frame);
  return { pause: () => pause(true), snapshot: () => ({ ...sim.state, paused, speed: sim.karts[0].speed, drift: sim.karts[0].drift, position: sim.karts[0].body.translation(), lap: sim.karts[0].lap, camera: { yaw: controls.getAzimuthalAngle(), dragging: cameraDragging }, drawCalls: renderer.info.render.calls }), dispose() {
    if (disposed) return; disposed = true; abort.abort(); cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose(); menu.close(); audio.dispose(); engine.dispose(); models.forEach(model => model.driver.dispose()); scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); }); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); renderer.dispose(); renderer.forceContextLoss(); sim.dispose(); delete host.dataset.kart; host.replaceChildren();
  } };
}
