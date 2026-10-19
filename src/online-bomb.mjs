import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createElement, Bomb, Camera, Maximize, Menu, Play, LogOut, MessageCircle, Send, Volume2, VolumeX } from "lucide";
import { bombFrame, cameraMovement, smoothPlayer, createBombEvents } from "./online-bomb-model.mjs";
import { makeBombScene, makeBombAvatar } from "./online-bomb-scene.mjs";
import { createCollectionAudio } from "./collection-audio.mjs";
import "./online-bomb.css";

export function mountOnlineBomb(host, options) {
  if (options.signal?.aborted) throw new DOMException("Canceled", "AbortError");
  const quality = Math.max(0, Math.min(3, Math.floor(options.quality) || 0));
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: quality > 0, powerPreference: "high-performance" }); }
  catch { throw new Error("3D graphics are unavailable. Enable hardware acceleration and retry."); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.5, 1.75][quality]));
  renderer.shadowMap.enabled = quality > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute("aria-label", "Online Bomb Tag 3D arena");
  renderer.domElement.title = "WASD/arrows: move. Right-drag: camera. Escape: menu.";
  host.dataset.onlineBomb = "true";
  host.innerHTML = `<header class="bomb-header"><div class="bomb-brand"><strong>Online Bomb Tag 3D</strong><small data-room></small></div>
    <div class="bomb-clock"><output data-clock></output><span data-holder></span></div>
    <div class="bomb-tools">${["sound", "camera", "chat", "fullscreen", "menu"].map(action => `<button data-action="${action}" title="${{ sound: "Mute effects (M)", camera: "Reset camera", chat: "Room chat", fullscreen: "Fullscreen", menu: "Room menu (Escape)" }[action]}" aria-label="${action}"></button>`).join("")}</div></header>
    <p class="bomb-status" role="status"></p><ol class="bomb-roster" aria-label="Room players and scores"></ol>
    <section class="bomb-chat" aria-label="Room chat" hidden><div class="bomb-chat-log" role="log" aria-live="polite"></div><form class="bomb-chat-form"><input maxlength="80" aria-label="Chat message" autocomplete="off"><button type="submit" title="Send message" aria-label="Send message"></button></form><p class="bomb-chat-status" role="status"></p></section>
    <dialog class="three-menu bomb-menu" aria-labelledby="bombMenuTitle"><h2 id="bombMenuTitle">Room Menu</h2><p data-menu-status>Live multiplayer room</p><button data-action="resume">Resume</button><button data-action="leave">Leave Room</button></dialog>`;
  host.prepend(renderer.domElement);
  const icons = { sound: Volume2, camera: Camera, chat: MessageCircle, fullscreen: Maximize, menu: Menu, resume: Play, leave: LogOut };
  const icon = shape => createElement(shape, { width: 19, height: 19, "aria-hidden": "true" });
  host.querySelectorAll("[data-action]").forEach(button => button.prepend(icon(icons[button.dataset.action])));
  host.querySelector('[type="submit"]').append(icon(Send));
  let state = bombFrame(options.read()), menuOpen = false, disposed = false, frameId = null, lastTime = null, readTime = -1, burstTime = 0, cameraPointer = null, sending = false, leavePending = false, rosterKey = "", chatKey = "", chatError = "";
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#a5c3b8"); scene.fog = new THREE.Fog(scene.background, 70, 180);
  scene.add(new THREE.HemisphereLight("#edf8e4", "#517b74", 2));
  const sun = new THREE.DirectionalLight("#fff0d3", 2.5); sun.position.set(-18, 35, 18); sun.castShadow = quality > 0;
  sun.shadow.mapSize.setScalar(quality > 1 ? 2048 : 1024); sun.shadow.bias = -0.001;
  Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 95 }); scene.add(sun);
  const scenery = makeBombScene(scene, state.width, state.depth), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 250);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = controls.enableDamping = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE }; controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.15; controls.minDistance = 16;
  let framing = 45; controls.maxDistance = 75;
  const resetCamera = () => { camera.position.copy(controls.target).add(new THREE.Vector3(0, 36, 30).setLength(framing)); controls.update(); };
  resetCamera();
  const audio = createCollectionAudio({ volume: options.getVolume }), observe = createBombEvents(), avatars = new Map(), keys = new Set(), abort = new AbortController();
  try { audio.setMuted(localStorage.getItem("online-bomb-muted") === "true"); } catch {}
  const menu = host.querySelector("dialog"), chat = host.querySelector(".bomb-chat"), form = host.querySelector("form"), input = form.querySelector("input"), status = host.querySelector(".bomb-status");
  const on = (target, type, callback, extra = {}) => target.addEventListener(type, callback, { ...extra, signal: abort.signal });
  function soundButton() {
    const button = host.querySelector('[data-action="sound"]'), muted = audio.snapshot().muted;
    button.replaceChildren(icon(muted ? VolumeX : Volume2)); button.title = `${muted ? "Unmute" : "Mute"} effects (M)`; button.setAttribute("aria-label", button.title); button.setAttribute("aria-pressed", String(muted));
  }
  function toggleSound() { audio.setMuted(!audio.snapshot().muted); soundButton(); try { localStorage.setItem("online-bomb-muted", String(audio.snapshot().muted)); } catch {} }
  function releaseCamera() {
    if (cameraPointer === null) return; const id = cameraPointer; cameraPointer = null;
    if (renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id);
    controls.disconnect(); controls.connect(renderer.domElement); renderer.domElement.style.cursor = "";
  }
  function clearInput() { keys.clear(); options.move({ x: 0, y: 0 }); releaseCamera(); }
  function setMenu(value) {
    if (disposed || leavePending) return;
    menuOpen = value; clearInput(); controls.enabled = !value; audio.setPaused(value || document.hidden); options.onMenu?.(value);
    if (value) { if (!menu.open) menu.showModal(); }
    else { menu.close(); renderer.domElement.focus(); }
  }
  function updateHUD() {
    const holder = state.players.find(p => p.slot === state.holder);
    host.querySelector("[data-room]").textContent = `${state.code} / ${state.players.length} of 5 players${state.spectating ? " / Spectating" : ""}`;
    host.querySelector("[data-clock]").textContent = state.waiting ? "--" : `${Math.ceil(state.ticks * 0.035)}s`;
    host.querySelector("[data-holder]").textContent = state.waiting ? "Waiting" : "Fuse remaining";
    status.textContent = state.waiting ? "Waiting for another player" : state.holder === state.local ? "You have the bomb" : `${holder?.name || "Player"} has the bomb`;
    const key = JSON.stringify(state.players.map(p => [p.slot, p.id, p.name, p.score, p.color, p.slot === state.holder]));
    if (key !== rosterKey) {
      rosterKey = key; const list = host.querySelector(".bomb-roster"); list.replaceChildren();
      for (const player of state.players) {
        const row = document.createElement("li"), swatch = document.createElement("i"), name = document.createElement("span"), mark = document.createElement("span"), score = document.createElement("b");
        row.dataset.local = String(player.slot === state.local); swatch.style.background = player.color; name.textContent = player.name; name.title = player.name; score.textContent = player.score;
        if (player.slot === state.holder && !state.waiting) mark.append(icon(Bomb)); row.append(swatch, name, mark, score); list.append(row);
      }
    }
    const messagesKey = JSON.stringify(state.chat);
    if (messagesKey !== chatKey) {
      chatKey = messagesKey; const log = host.querySelector(".bomb-chat-log"); log.replaceChildren();
      for (const message of state.chat) { const line = document.createElement("p"), name = document.createElement("strong"); name.textContent = `${message.name}: `; line.append(name, document.createTextNode(message.text)); log.append(line); }
      log.scrollTop = log.scrollHeight;
    }
    input.disabled = !state.canChat || sending; form.querySelector("button").disabled = !state.canChat || sending;
    host.querySelector(".bomb-chat-status").textContent = state.canChat ? chatError || state.chatStatus : "Sign in to send messages";
    if (!leavePending) host.querySelector("[data-menu-status]").textContent = state.waiting ? "Waiting lobby" : "The room stays live while this menu is open.";
  }
  function refreshState(now) {
    if (now - readTime < 33) return; readTime = now; state = bombFrame(options.read()); updateHUD();
    for (const event of observe(state)) {
      if (event.type === "burst") {
        burstTime = 0.65; scenery.burst.position.set(event.player.x, 0.7, event.player.z);
        if (!menuOpen && !document.hidden) audio.play(event.won ? "gate" : "hurt");
      } else if (!menuOpen && !document.hidden) audio.play(event.type === "pass" ? "shield" : "warning", { gain: 0.35 });
    }
    const slots = new Set(state.players.map(p => p.slot));
    for (const [slot, avatar] of avatars) if (!slots.has(slot)) { scene.remove(avatar.group, avatar.label); avatar.dispose(); avatars.delete(slot); }
    for (const player of state.players) {
      const key = JSON.stringify([player.id, player.name, player.color, player.skin, player.palette, player.accessory, player.size]);
      let avatar = avatars.get(player.slot);
      if (!avatar || avatar.key !== key) {
        if (avatar) { scene.remove(avatar.group, avatar.label); avatar.dispose(); }
        avatar = { ...makeBombAvatar(player), key, position: null }; avatars.set(player.slot, avatar); scene.add(avatar.group, avatar.label);
      }
      avatar.target = player;
    }
  }
  function render(dt, now) {
    refreshState(now);
    const moving = !leavePending && !menuOpen && !document.hidden && !state.waiting && !state.spectating && document.activeElement !== input;
    const movement = moving ? cameraMovement(Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")), Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")), controls.getAzimuthalAngle()) : { x: 0, y: 0 };
    options.move(movement);
    for (const avatar of avatars.values()) {
      const old = avatar.position, p = smoothPlayer(old, avatar.target, dt); avatar.position = p;
      if (old && Math.hypot(p.x - old.x, p.z - old.z) > 0.002) avatar.group.rotation.y = Math.atan2(old.x - p.x, old.z - p.z);
      avatar.group.position.set(p.x, 0.05, p.z); avatar.label.position.set(p.x, p.size + 2.3, p.z);
    }
    const carrier = avatars.get(state.holder);
    scenery.bomb.visible = scenery.ring.visible = Boolean(carrier && !state.waiting);
    if (carrier) {
      scenery.bomb.position.set(carrier.group.position.x, carrier.target.size + 0.7, carrier.group.position.z);
      scenery.ring.position.set(carrier.group.position.x, 0.09, carrier.group.position.z);
      scenery.ember.scale.setScalar(0.8 + Math.sin(now * 0.025) * 0.25); scenery.ring.scale.setScalar(1 + Math.sin(now * 0.008) * 0.08);
    }
    burstTime = Math.max(0, burstTime - dt); scenery.burst.visible = burstTime > 0;
    if (burstTime) { scenery.burst.scale.setScalar(0.5 + (0.65 - burstTime) * 5); scenery.burst.material.opacity = burstTime * 0.65; }
    audio.sync(); controls.update(); renderer.render(scene, camera);
  }
  function frame(now) {
    frameId = null; if (disposed || document.hidden) return;
    const dt = lastTime === null ? 0.016 : Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
    render(dt, now); if (!disposed) frameId = requestAnimationFrame(frame);
  }
  async function leave() {
    if (leavePending) return; leavePending = true; clearInput(); audio.setPaused(true);
    host.querySelector('[data-action="leave"]').disabled = true; host.querySelector("[data-menu-status]").textContent = "Leaving room...";
    try { await options.leave(); }
    catch { if (!disposed) { leavePending = false; host.querySelector('[data-action="leave"]').disabled = false; host.querySelector("[data-menu-status]").textContent = "Could not leave. Please retry."; } }
  }
  on(host, "click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "sound") toggleSound(); else if (action) void audio.unlock();
    if (action === "menu" || action === "resume") setMenu(action === "menu");
    if (action === "camera") { resetCamera(); renderer.domElement.focus(); }
    if (action === "fullscreen") Promise.resolve(options.fullscreen?.()).catch(() => {});
    if (action === "chat") { chat.hidden = !chat.hidden; host.dataset.chatOpen = String(!chat.hidden); clearInput(); if (chat.hidden) renderer.domElement.focus(); else input.focus(); }
    if (action === "leave") void leave();
  });
  on(form, "submit", async event => {
    event.preventDefault(); if (sending || !state.canChat || !input.value.trim()) return;
    sending = true; chatError = ""; const text = input.value.trim().slice(0, 80); updateHUD(); clearInput();
    try { const sent = await options.chat(text); if (!disposed && sent !== false) input.value = ""; }
    catch { chatError = "Message could not be sent."; }
    finally { if (!disposed) { sending = false; updateHUD(); input.focus(); } }
  });
  on(input, "focus", clearInput);
  on(window, "keydown", event => {
    if (event.target instanceof Element && event.target.closest("input,textarea,select") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyM" && !event.repeat) { event.preventDefault(); toggleSound(); return; }
    if (event.code === "Escape" && !menu.open) { event.preventDefault(); setMenu(true); return; }
    if (menuOpen || event.target instanceof Element && event.target.closest("button")) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) { event.preventDefault(); keys.add(event.code); void audio.unlock(); }
  });
  on(window, "keyup", event => keys.delete(event.code)); on(menu, "cancel", event => { event.preventDefault(); setMenu(false); });
  on(renderer.domElement, "pointerdown", event => {
    void audio.unlock(); renderer.domElement.focus();
    if (event.pointerType !== "mouse" || event.button !== 2 || menuOpen) { event.stopImmediatePropagation(); return; }
    cameraPointer = event.pointerId; renderer.domElement.style.cursor = "grabbing";
  }, { capture: true });
  on(renderer.domElement, "pointermove", event => { if (!(event.buttons & 2)) releaseCamera(); }, { capture: true });
  on(window, "pointerup", event => { if (!(event.buttons & 2)) releaseCamera(); }); on(renderer.domElement, "lostpointercapture", releaseCamera); on(renderer.domElement, "pointercancel", releaseCamera);
  on(window, "blur", () => setMenu(true));
  on(document, "visibilitychange", () => { if (document.hidden) { setMenu(true); cancelAnimationFrame(frameId); frameId = null; lastTime = null; } else if (!disposed && frameId === null) frameId = requestAnimationFrame(frame); });
  on(renderer.domElement, "webglcontextlost", event => { event.preventDefault(); if (!disposed) { setMenu(true); options.graphicsLost?.(); } });
  const resize = () => {
    if (disposed) return; const { width, height } = host.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height;
    const compact = height < 540, distance = Math.max(45 * (compact ? height / Math.max(140, height - (width <= 800 ? 150 : 110)) : 1), 20 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    camera.position.sub(controls.target).multiplyScalar(distance / framing).add(controls.target); framing = distance; controls.maxDistance = Math.max(75, distance * 1.3);
    camera.setViewOffset(width, height, 0, compact ? width <= 800 ? -65 : -45 : width < 500 && height < 700 ? -35 : 0, width, height);
    camera.far = Math.max(250, distance + 120); scene.fog.near = Math.max(70, distance + 10); scene.fog.far = Math.max(180, distance + 100); camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize(); soundButton(); void audio.unlock(); renderer.domElement.focus(); frameId = requestAnimationFrame(frame);
  return { pause: () => setMenu(true), snapshot: () => ({ code: state.code, players: [...avatars].map(([slot, avatar]) => ({ slot, ...avatar.position })), holder: state.holder, ticks: state.ticks, waiting: state.waiting, menuOpen, camera: controls.getAzimuthalAngle(), drawCalls: renderer.info.render.calls, audio: audio.snapshot() }),
    dispose() { if (disposed) return; disposed = true; abort.abort(); cancelAnimationFrame(frameId); observer.disconnect(); clearInput(); menu.close(); controls.dispose(); audio.dispose(); for (const avatar of avatars.values()) avatar.dispose(); avatars.clear(); scenery.dispose(); renderer.dispose(); renderer.forceContextLoss(); delete host.dataset.onlineBomb; delete host.dataset.chatOpen; host.replaceChildren(); } };
}
