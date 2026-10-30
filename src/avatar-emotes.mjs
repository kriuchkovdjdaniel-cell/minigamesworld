export const EMOTES = Object.freeze([
  { id: "bounce", name: "Bounce" }, { id: "spin", name: "Spin" }, { id: "bow", name: "Bow" }
]);
export function validEmote(id) { return EMOTES.some(emote => emote.id === id); }
export function emotePose(id, seconds) {
  if (!validEmote(id) || !Number.isFinite(seconds) || seconds < 0 || seconds > 2.4) return { y: 0, yaw: 0, tilt: 0, squash: 1 };
  const fade = Math.min(1, seconds * 6, (2.4 - seconds) * 6);
  if (id === "bounce") return { y: Math.abs(Math.sin(seconds * Math.PI * 2)) * 0.45 * fade, yaw: 0, tilt: Math.sin(seconds * Math.PI * 2) * 0.12 * fade, squash: 1 - Math.cos(seconds * Math.PI * 4) * 0.08 * fade };
  if (id === "spin") return { y: Math.sin(seconds / 2.4 * Math.PI) * 0.2, yaw: seconds / 2.4 * Math.PI * 4, tilt: 0, squash: 1 };
  return { y: 0, yaw: 0, tilt: Math.sin(seconds / 2.4 * Math.PI) * 0.6, squash: 1 };
}

export function mountEmotePicker(parent, { signal, play, storageKey = "mgw-victory-pose" } = {}) {
  let victory = "bounce";
  try { const saved = localStorage.getItem(storageKey); if (validEmote(saved)) victory = saved; } catch {}
  const panel = document.createElement("fieldset"); panel.className = "avatar-emotes";
  const legend = document.createElement("legend"); legend.textContent = "Emotes"; panel.append(legend);
  for (const emote of EMOTES) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = emote.name;
    button.dataset.emote = emote.id; button.addEventListener("click", () => play?.(emote.id), { signal }); panel.append(button);
  }
  const label = document.createElement("label"); label.textContent = "Victory pose ";
  const select = document.createElement("select"); select.setAttribute("aria-label", "Victory pose");
  for (const emote of EMOTES) { const option = document.createElement("option"); option.value = emote.id; option.textContent = emote.name; select.append(option); }
  select.value = victory; select.addEventListener("change", () => { victory = select.value; try { localStorage.setItem(storageKey, victory); } catch {} }, { signal });
  label.append(select); panel.append(label); parent.append(panel);
  return { get victory() { return victory; }, element: panel };
}

export function attachAvatarEmotes(parent, avatar, { signal, time, resume }) {
  let active = null;
  const picker = mountEmotePicker(parent, { signal, play: id => { active = { id, at: time(), yaw: avatar.rotation.y }; resume(); } });
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
