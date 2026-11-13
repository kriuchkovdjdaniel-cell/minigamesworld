import { createElement, Camera, Download, X, RotateCcw } from "lucide";
import { MOUSE } from "three";
import { EMOTES, emotePose, ownsEmote } from "./avatar-emotes.mjs";

export function mountPhotoMode(host, { renderer, scene, camera, controls, signal, canOpen = () => true, pause, resume, onRestore, avatar, inventory = {} }) {
  const lifetime = new AbortController(), canvas = renderer.domElement;
  const button = document.createElement("button"); button.type = "button"; button.className = "mgw-photo-open";
  button.title = "Photo mode"; button.setAttribute("aria-label", "Photo mode"); button.append(createElement(Camera)); host.append(button);
  const panel = document.createElement("section"); panel.className = "mgw-photo-tools"; panel.hidden = true; panel.setAttribute("aria-label", "Photo controls");
  panel.innerHTML = '<strong>Photo Mode</strong><label>Lens <input aria-label="Photo lens" type="range" min="25" max="85" value="50"></label><label>Light <input aria-label="Photo light" type="range" min="0.4" max="1.8" step="0.05" value="1"></label><label data-pose-label>Pose <select aria-label="Photo pose"><option value="">Current</option></select></label><button type="button" data-photo-reset title="Reset camera" aria-label="Reset photo camera"></button><button type="button" data-photo-save title="Download PNG" aria-label="Download photo"></button><button type="button" data-photo-close title="Close photo mode" aria-label="Close photo mode"></button><span role="status" data-photo-status></span>';
  for (const [key, shape] of [["reset", RotateCcw], ["save", Download], ["close", X]]) panel.querySelector(`[data-photo-${key}]`).append(createElement(shape));
  host.append(panel);
  const lens = panel.querySelector('[aria-label="Photo lens"]'), light = panel.querySelector('[aria-label="Photo light"]'), pose = panel.querySelector("select"), status = panel.querySelector("[data-photo-status]"), save = panel.querySelector("[data-photo-save]");
  let active = false, frame = 0, saved, disposed = false, url = null, suspended = false, generation = 0, contextLost = false;
  const on = (target, event, callback, extra = {}) => target.addEventListener(event, callback, { ...extra, signal: lifetime.signal });
  function stopDrawing() { cancelAnimationFrame(frame); frame = 0; }
  function draw() {
    frame = 0;
    if (!active || disposed || suspended || document.hidden || contextLost) return;
    controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(draw);
  }
  function reconnectControls() { controls.disconnect(); controls.connect(canvas); canvas.style.cursor = ""; }
  function restoreCamera() {
    if (!saved) return;
    camera.position.copy(saved.position); camera.quaternion.copy(saved.quaternion); camera.fov = saved.fov;
    controls.target.copy(saved.target); renderer.toneMappingExposure = saved.exposure;
    lens.value = saved.fov; light.value = saved.exposure; camera.updateProjectionMatrix(); controls.update();
  }
  function restoreAvatar() {
    if (avatar && saved?.avatar) { avatar.position.copy(saved.avatar.position); avatar.rotation.copy(saved.avatar.rotation); avatar.scale.copy(saved.avatar.scale); }
  }
  function open() {
    if (active || disposed || contextLost || document.hidden || !canOpen() || document.querySelector("dialog[open]")) return;
    const properties = ["enabled", "enablePan", "enableZoom", "enableRotate", "enableDamping", "autoRotate", "minPolarAngle", "maxPolarAngle", "minDistance", "maxDistance"];
    saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, target: controls.target.clone(), exposure: renderer.toneMappingExposure,
      controls: Object.fromEntries(properties.map(key => [key, controls[key]])), mouse: { ...controls.mouseButtons }, view: camera.view ? { ...camera.view } : null,
      avatar: avatar ? { position: avatar.position.clone(), rotation: avatar.rotation.clone(), scale: avatar.scale.clone() } : null,
      inert: [...host.children].filter(node => node !== canvas && node !== panel).map(node => [node, node.inert]) };
    pause(); host.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    active = true; suspended = false; generation++; host.dataset.photo = "true"; panel.hidden = false; status.textContent = ""; save.disabled = false;
    for (const [node] of saved.inert) node.inert = true;
    reconnectControls();
    Object.assign(controls, { enabled: true, enablePan: true, enableZoom: true, enableRotate: true, enableDamping: false, autoRotate: false,
      mouseButtons: { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }, minPolarAngle: 0.05, maxPolarAngle: Math.PI - 0.05, minDistance: 1, maxDistance: 120 });
    camera.clearViewOffset(); lens.value = camera.fov; light.value = renderer.toneMappingExposure;
    pose.replaceChildren(new Option("Current", ""));
    for (const emote of EMOTES) if (ownsEmote(emote.id, inventory.getOwned?.() || [])) pose.append(new Option(emote.name, emote.id));
    panel.querySelector("[data-pose-label]").hidden = !avatar;
    save.focus(); stopDrawing(); draw();
  }
  function close(continueGame = true) {
    if (!active) return;
    const canResume = continueGame && !disposed && !contextLost && !document.hidden && !suspended;
    active = false; generation++; stopDrawing(); delete host.dataset.photo; panel.hidden = true;
    reconnectControls(); Object.assign(controls, saved.controls, { mouseButtons: saved.mouse });
    camera.view = saved.view; restoreCamera(); restoreAvatar();
    for (const [node, inert] of saved.inert) node.inert = inert;
    suspended = false;
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (!disposed && !contextLost) onRestore?.();
    if (canResume) { resume(); canvas.focus(); }
    else { controls.enabled = false; if (continueGame && !disposed && !contextLost) pause(); }
  }
  function suspend() {
    if (!active) return;
    suspended = true; stopDrawing(); reconnectControls(); controls.enabled = false;
  }
  function wake() {
    if (!active || disposed || document.hidden || contextLost) return;
    suspended = false; controls.enabled = true; stopDrawing(); draw();
  }
  on(button, "click", open); on(panel.querySelector("[data-photo-close]"), "click", () => close());
  on(panel.querySelector("[data-photo-reset]"), "click", restoreCamera);
  on(lens, "input", () => { if (active) { camera.fov = Number(lens.value); camera.updateProjectionMatrix(); } });
  on(light, "input", () => { if (active) renderer.toneMappingExposure = Number(light.value); });
  on(pose, "change", () => {
    if (!active || !avatar || !saved.avatar) return;
    restoreAvatar();
    if (!ownsEmote(pose.value, inventory.getOwned?.() || [])) { pose.value = ""; return; }
    const p = emotePose(pose.value, 0.65);
    avatar.position.y += p.y; avatar.rotation.x += p.tilt; avatar.rotation.y += p.yaw; avatar.scale.y *= p.squash;
  });
  on(save, "click", () => {
    if (!active || suspended || document.hidden || contextLost || save.disabled) return;
    const capture = generation; save.disabled = true;
    try {
      renderer.render(scene, camera);
      canvas.toBlob(blob => {
        if (disposed || !active || generation !== capture) return;
        save.disabled = false;
        if (!blob) { status.textContent = "Could not capture photo."; return; }
        if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = `MiniGameWorld-${new Date().toISOString().replace(/[:.]/g, "-")}.png`; link.click(); status.textContent = "Photo downloaded";
      }, "image/png");
    } catch { save.disabled = false; status.textContent = "Could not capture photo. Try again."; }
  });
  on(window, "keydown", event => {
    if (!active) return;
    event.stopImmediatePropagation();
    if (event.code === "Escape") { event.preventDefault(); close(); }
    else if (event.code !== "Tab" && !event.target.closest?.("input,select,button")) event.preventDefault();
  }, { capture: true });
  on(window, "keyup", event => { if (active) event.stopImmediatePropagation(); }, { capture: true });
  on(window, "blur", suspend); on(window, "focus", wake);
  on(document, "visibilitychange", () => { if (document.hidden) suspend(); else wake(); });
  on(canvas, "webglcontextlost", () => { contextLost = true; close(false); button.disabled = true; }, { capture: true });
  const observer = new MutationObserver(() => { if (active && host.querySelector("dialog[open]")) close(false); });
  observer.observe(host, { subtree: true, attributes: true, attributeFilter: ["open"] });
  function dispose() {
    if (disposed) return;
    disposed = true; close(false); stopDrawing(); lifetime.abort(); observer.disconnect();
    signal?.removeEventListener("abort", dispose); if (url) URL.revokeObjectURL(url); button.remove(); panel.remove();
  }
  if (signal?.aborted) dispose(); else signal?.addEventListener("abort", dispose, { once: true });
  return { get active() { return active; }, open, close, dispose,
    snapshot: () => ({ active, suspended, contextLost, fov: camera.fov, exposure: renderer.toneMappingExposure,
      aspect: camera.aspect, view: camera.view ? { ...camera.view } : null,
      target: controls.target.toArray(), position: camera.position.toArray(), pan: controls.enablePan, controlsEnabled: controls.enabled,
      pose: pose.value, avatar: avatar ? { position: avatar.position.toArray(), rotation: avatar.rotation.toArray().slice(0, 3), scale: avatar.scale.toArray() } : null }) };
}
