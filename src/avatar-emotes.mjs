import { createElement, ArrowUpDown, RotateCw, Hand, Music2, Sparkles, FlipVertical2, LockKeyhole, X, Coins, Smile } from "lucide";

export const EMOTES = Object.freeze([
  { id: "bounce", name: "Bounce", cost: 0 }, { id: "spin", name: "Spin", cost: 0 }, { id: "bow", name: "Bow", cost: 0 },
  { id: "groove", name: "Groove", cost: 200 }, { id: "twirl", name: "Twirl", cost: 350 }, { id: "flip", name: "Flip", cost: 500 },
  { id: "shuffle", name: "Shuffle", cost: 650 }, { id: "sway", name: "Sway", cost: 800 }, { id: "levitate", name: "Levitate", cost: null, source: "Find all 10 secret relics" }
]);
export function validEmote(id) { return EMOTES.some(emote => emote.id === id); }
export function ownsEmote(id, owned = []) { return EMOTES.some(emote => emote.id === id && (emote.cost === 0 || Array.isArray(owned) && owned.includes(id))); }
export function wheelSlots(value, owned = []) {
  const seen = new Set();
  const slots = Array.from({ length: 6 }, (_, index) => {
    const id = Array.isArray(value) ? value[index] : null;
    if (!ownsEmote(id, owned) || seen.has(id)) return "";
    seen.add(id); return id;
  });
  for (const emote of EMOTES) {
    const empty = slots.indexOf("");
    if (empty < 0) break;
    if (ownsEmote(emote.id, owned) && !seen.has(emote.id)) { slots[empty] = emote.id; seen.add(emote.id); }
  }
  return slots;
}
export function setWheelSlot(value, index, id, owned = []) {
  const slots = wheelSlots(value, owned);
  if (!Number.isInteger(index) || index < 0 || index >= 6 || !ownsEmote(id, owned)) return slots;
  const other = slots.indexOf(id);
  if (other >= 0) slots[other] = slots[index];
  slots[index] = id;
  return slots;
}
export function emotePose(id, seconds) {
  if (!validEmote(id) || !Number.isFinite(seconds) || seconds < 0 || seconds > 2.4) return { y: 0, yaw: 0, tilt: 0, squash: 1 };
  const fade = Math.min(1, seconds * 6, (2.4 - seconds) * 6);
  if (id === "bounce") return { y: Math.abs(Math.sin(seconds * Math.PI * 2)) * 0.45 * fade, yaw: 0, tilt: Math.sin(seconds * Math.PI * 2) * 0.12 * fade, squash: 1 - Math.cos(seconds * Math.PI * 4) * 0.08 * fade };
  if (id === "spin") return { y: Math.sin(seconds / 2.4 * Math.PI) * 0.2, yaw: seconds / 2.4 * Math.PI * 4, tilt: 0, squash: 1 };
  if (id === "groove") return { y: Math.abs(Math.sin(seconds * Math.PI * 3)) * 0.18 * fade, yaw: Math.sin(seconds * Math.PI * 3) * 0.7 * fade, tilt: Math.cos(seconds * Math.PI * 3) * 0.3 * fade, squash: 1 - Math.abs(Math.sin(seconds * Math.PI * 3)) * 0.09 * fade };
  if (id === "twirl") return { y: Math.sin(seconds / 2.4 * Math.PI) * 0.45, yaw: seconds / 2.4 * Math.PI * 6, tilt: Math.sin(seconds / 2.4 * Math.PI) * 0.25, squash: 1 };
  if (id === "flip") return { y: Math.sin(seconds / 2.4 * Math.PI) * 0.48, yaw: 0, tilt: seconds / 2.4 * Math.PI * 2, squash: 1 };
  if (id === "shuffle") return { y: Math.abs(Math.sin(seconds * 12)) * 0.15 * fade, yaw: Math.sin(seconds * 10) * 0.4 * fade, tilt: Math.sin(seconds * 12) * 0.15 * fade, squash: 1 };
  if (id === "sway") return { y: 0, yaw: Math.sin(seconds * 5) * 0.5 * fade, tilt: Math.sin(seconds * 5) * 0.45 * fade, squash: 1 };
  if (id === "levitate") return { y: Math.sin(seconds / 2.4 * Math.PI) * 0.48, yaw: seconds / 2.4 * Math.PI * 2, tilt: 0, squash: 1 };
  return { y: 0, yaw: 0, tilt: Math.sin(seconds / 2.4 * Math.PI) * 0.6, squash: 1 };
}

export function mountEmotePicker(parent, { signal, play, inventory = {}, canOpen = () => true, onWheelChange = () => {}, storageKey = inventory.storageKey || "mgw-victory-pose" } = {}) {
  const owns = id => ownsEmote(id, inventory.getOwned?.() || []);
  let victory = "bounce";
  try { const saved = localStorage.getItem(storageKey) || localStorage.getItem("mgw-victory-pose"); if (owns(saved)) victory = saved; } catch {}
  const panel = document.createElement("fieldset"); panel.className = "avatar-emotes";
  const legend = document.createElement("legend"); legend.textContent = "Emotes"; panel.append(legend);
  for (const emote of EMOTES) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = emote.name;
    button.dataset.emote = emote.id; button.addEventListener("click", () => { if (owns(emote.id)) play?.(emote.id); }, { signal }); panel.append(button);
  }
  const label = document.createElement("label"); label.textContent = "Victory pose ";
  const select = document.createElement("select"); select.setAttribute("aria-label", "Victory pose");
  for (const emote of EMOTES) { const option = document.createElement("option"); option.value = emote.id; option.textContent = emote.name; select.append(option); }
  select.value = victory; select.addEventListener("change", () => { if (!owns(select.value)) { select.value = victory; return; } victory = select.value; try { localStorage.setItem(storageKey, victory); } catch {} }, { signal });
  label.append(select); panel.append(label); parent.append(panel);
  const owned = () => inventory.getOwned?.() || [];
  let favorites = wheelSlots(null, owned());
  try { favorites = wheelSlots(JSON.parse(localStorage.getItem(storageKey + "-wheel")), owned()); } catch {}
  const slots = document.createElement("details"); slots.className = "emote-favorites"; const summary = document.createElement("summary"); summary.textContent = "Wheel Favorites"; slots.append(summary);
  const slotSelects = Array.from({ length: 6 }, (_, index) => {
    const row = document.createElement("label"), choice = document.createElement("select"); row.textContent = `Slot ${index + 1}`; choice.setAttribute("aria-label", `Emote slot ${index + 1}`);
    const empty = new Option("Empty", ""); empty.disabled = true; choice.append(empty);
    for (const emote of EMOTES) choice.append(new Option(emote.name, emote.id));
    choice.value = favorites[index]; row.append(choice); slots.append(row);
    choice.addEventListener("change", () => {
      if (!owns(choice.value)) { choice.value = favorites[index]; return; }
      favorites = setWheelSlot(favorites, index, choice.value, owned());
      slotSelects.forEach((input, i) => { input.value = favorites[i]; });
      try { localStorage.setItem(storageKey + "-wheel", JSON.stringify(favorites)); } catch {}
    }, { signal }); return choice;
  }); panel.append(slots);
  const refresh = () => {
    favorites = wheelSlots(favorites, owned());
    slotSelects.forEach((input, i) => { input.value = favorites[i]; });
    for (const button of panel.querySelectorAll("[data-emote]")) { button.disabled = !owns(button.dataset.emote); button.title = button.disabled ? EMOTES.find(emote => emote.id === button.dataset.emote).source || "Available in the Emote Shop" : button.textContent; }
    for (const option of select.options) option.disabled = !owns(option.value);
    for (const choice of slotSelects) for (const option of choice.options) option.disabled = !owns(option.value);
    if (!owns(victory)) { victory = "bounce"; select.value = victory; }
  };
  refresh();
  const wheel = mountEmoteWheel(parent, { signal, owns, play, inventory, canOpen, onWheelChange, refresh, getSlots: () => favorites.map(id => EMOTES.find(e => e.id === id)) });
  return { get victory() { return owns(victory) ? victory : "bounce"; }, element: panel, wheel };
}

export function attachAvatarEmotes(parent, avatar, { signal, time, resume, ...options }) {
  let active = null;
  const picker = mountEmotePicker(parent, { ...options, signal, play: id => { active = { id, at: time(), yaw: avatar.rotation.y }; resume(); } });
  function apply(id, elapsed, yaw) {
    const pose = emotePose(id, elapsed); avatar.position.y += pose.y; avatar.rotation.x = pose.tilt; avatar.scale.y = pose.squash; avatar.rotation.y = yaw + pose.yaw;
  }
  return {
    update(moving) {
      if (moving) active = null;
      avatar.rotation.x = 0; avatar.scale.y = 1;
      if (active) { if (time() - active.at <= 2.4) apply(active.id, time() - active.at, active.yaw); else active = null; }
    },
    victory() { apply(picker.victory, 0.6, avatar.rotation.y); }
  };
}

function mountEmoteWheel(parent, { signal, owns, play, inventory, canOpen, onWheelChange, refresh, getSlots }) {
  const host = parent.parentElement, wheel = document.createElement("dialog");
  wheel.className = "mgw-emote-wheel"; wheel.setAttribute("aria-label", "Emote wheel");
  wheel.innerHTML = '<div class="emote-wheel-heading"><h2>Emotes</h2><button type="button" data-wheel-close aria-label="Close emote wheel" title="Close (M / Escape)"></button></div><div class="emote-wheel-ring"><div class="emote-wheel-center" aria-hidden="true"></div></div><div class="emote-wheel-purchase"><p role="status" data-wheel-status></p><button type="button" data-emote-buy hidden></button></div>';
  const icon = shape => createElement(shape, { width: 24, height: 24, "aria-hidden": "true" });
  wheel.querySelector("[data-wheel-close]").append(icon(X)); wheel.querySelector(".emote-wheel-center").append(icon(Smile));
  const ring = wheel.querySelector(".emote-wheel-ring"), status = wheel.querySelector("[data-wheel-status]"), buy = wheel.querySelector("[data-emote-buy]");
  const icons = [ArrowUpDown, RotateCw, Hand, Music2, Sparkles, FlipVertical2];
  let disposed = false, pending = false, selected = null, returnFocus = null;
  const on = (target, type, callback, extra = {}) => target.addEventListener(type, callback, { ...extra, signal });
  let entries = getSlots();
  const buttons = entries.map((emote, i) => {
    const button = document.createElement("button"), name = document.createElement("span"), lock = icon(LockKeyhole);
    button.type = "button"; button.dataset.wheelEmote = emote?.id || ""; button.className = "emote-wheel-slot";
    const angle = (-90 + i * 60) * Math.PI / 180;
    button.style.left = `${50 + Math.cos(angle) * 35}%`; button.style.top = `${50 + Math.sin(angle) * 35}%`;
    name.textContent = emote?.name || "Empty"; lock.classList.add("emote-slot-lock"); button.append(icon(icons[i]), name, lock);
    on(button, "click", () => choose(entries[i])); ring.append(button); return button;
  });
  function update() {
    refresh();
    entries = getSlots();
    buttons.forEach((button, i) => {
      const emote = entries[i], locked = !!emote && !owns(emote.id);
      button.dataset.wheelEmote = emote?.id || ""; button.querySelector("span").textContent = emote?.name || "Empty";
      button.firstChild.replaceWith(icon(emote ? icons[EMOTES.indexOf(emote)] || Sparkles : Smile));
      button.dataset.locked = String(locked); button.querySelector(".emote-slot-lock").style.display = locked ? "" : "none";
      button.title = !emote ? `Empty slot ${i + 1}` : locked ? `${emote.name} / ${emote.source || `${emote.cost} coins`}` : `Play ${emote.name}`;
      button.setAttribute("aria-disabled", String(!emote));
      button.setAttribute("aria-label", button.title); button.setAttribute("aria-pressed", String(!!emote && selected?.id === emote.id));
    });
    buy.hidden = !selected || owns(selected.id) || !!selected.source; buy.disabled = pending;
    if (!buy.hidden) { buy.replaceChildren(icon(Coins), document.createTextNode(pending ? "Purchasing..." : `Buy ${selected.cost} coins`)); }
  }
  function close(focus = true) {
    if (!wheel.open) return;
    wheel.close(); onWheelChange(false);
    if (focus && returnFocus?.isConnected) returnFocus.focus();
  }
  function open() {
    if (disposed || !canOpen() || document.hidden || document.querySelector("dialog[open]")) return;
    returnFocus = document.activeElement; selected = null; status.textContent = ""; update();
    onWheelChange(true); wheel.showModal(); buttons[0].focus();
  }
  function choose(emote) {
    if (pending || !emote) return;
    selected = emote;
    if (owns(emote.id)) { close(); play?.(emote.id); return; }
    status.textContent = `${emote.name} / ${emote.source || `${emote.cost} coins`}`; update(); if (!buy.hidden) buy.focus();
  }
  on(buy, "click", async () => {
    if (pending || !selected || selected.source || !Number.isSafeInteger(selected.cost) || selected.cost <= 0 || owns(selected.id)) return;
    const emote = selected; pending = true; status.textContent = "Saving purchase..."; update();
    try {
      if (!inventory.buy) throw new Error("Sign in to buy emotes.");
      await inventory.buy(emote.id);
      if (!disposed && wheel.open) status.textContent = `${emote.name} unlocked`;
    } catch (error) { if (!disposed && wheel.open) status.textContent = error?.message || "Purchase failed. Please retry."; }
    finally { pending = false; if (!disposed) update(); }
  });
  on(wheel.querySelector("[data-wheel-close]"), "click", () => close());
  on(wheel, "cancel", event => { event.preventDefault(); close(); });
  on(wheel, "click", event => { if (event.target === wheel) { const r = wheel.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
  on(window, "keydown", event => {
    if (disposed || event.ctrlKey || event.metaKey || event.altKey) return;
    if (wheel.open) {
      event.stopImmediatePropagation();
      if (["KeyM", "Escape"].includes(event.code)) { event.preventDefault(); if (!event.repeat) close(); }
      else if (/^Digit[1-6]$/.test(event.code)) { event.preventDefault(); if (!event.repeat) choose(entries[Number(event.code.slice(-1)) - 1]); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.code)) {
        event.preventDefault(); const current = Math.max(0, buttons.indexOf(document.activeElement)), previous = ["ArrowLeft", "ArrowUp"].includes(event.code);
        buttons[event.code === "Home" ? 0 : event.code === "End" ? 5 : (current + (previous ? 5 : 1)) % 6].focus();
      } else if (!["Tab", "Enter", "Space"].includes(event.code)) event.preventDefault();
    } else if (event.code === "KeyM" && !event.repeat && !event.target.closest?.("input,select,textarea,[contenteditable=true]") && canOpen()) { event.preventDefault(); event.stopImmediatePropagation(); open(); }
  }, { capture: true });
  on(window, "keyup", event => { if (wheel.open) event.stopImmediatePropagation(); }, { capture: true });
  on(window, "blur", () => close(false)); on(document, "visibilitychange", () => { if (document.hidden) close(false); });
  const observer = new MutationObserver(() => { if (parent.open) close(false); }); observer.observe(parent, { attributes: true, attributeFilter: ["open"] });
  host.append(wheel);
  signal?.addEventListener("abort", () => { disposed = true; observer.disconnect(); wheel.close(); wheel.remove(); }, { once: true });
  return { open, close, get isOpen() { return wheel.open; } };
}
