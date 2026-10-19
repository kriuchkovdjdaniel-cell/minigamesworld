export const BOMB_SLOTS = ["p1", "p2", "p3", "p4", "p5"];
const colors = ["#68c6b5", "#e0ba70", "#b49bd2", "#dc8596", "#83b7db"];
const clamp = (n, low, high) => Math.max(low, Math.min(high, Number.isFinite(n) ? n : low));
const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function bombFrame(input = {}) {
  const width = clamp(input.width || 560, 100, 2000), height = clamp(input.height || 560, 100, 2000);
  const players = BOMB_SLOTS.flatMap((slot, i) => {
    const p = Array.isArray(input.players) ? input.players.find(player => player?.slot === slot) : null;
    if (!p) return [];
    const size = clamp(p.size || 28, 10, 80);
    return [{ slot, id: String(p.memberId || slot), name: String(p.username || slot.toUpperCase()).slice(0, 24),
      x: (clamp(p.x, 8, width - size - 8) + size / 2 - width / 2) / 20,
      z: (clamp(p.y, 8, height - size - 8) + size / 2 - height / 2) / 20, size: size / 20,
      color: hex(p.headColor, colors[i]), score: clamp(p.totalScore, 0, 1e9), respawn: String(p.respawn?.id || ""),
      skin: p.skin === "custom64" && /^[0-7]{4096}$/.test(p.pixelSkin64 || "") ? p.pixelSkin64 : "",
      palette: Array.from({ length: 8 }, (_, n) => hex(p.customPalette?.[n], colors[n % 5])),
      accessory: p.accessory === "custom" && /^[.0-7]{256}$/.test(p.customAccessory16 || "") ? p.customAccessory16 : "" }];
  });
  return { width: width / 20, depth: height / 20, code: String(input.code || "").slice(0, 16), local: input.local || "", spectating: Boolean(input.spectating),
    waiting: players.length < 2, players, holder: players.some(p => p.slot === input.bomb?.holder) ? input.bomb.holder : "",
    ticks: clamp(input.bomb?.ticks, 0, 360), round: clamp(input.bomb?.round, 0, Number.MAX_SAFE_INTEGER),
    chat: Array.isArray(input.chat) ? input.chat.slice(-30).map(m => ({ name: String(m?.username || "Player").slice(0, 24), text: String(m?.text || "").slice(0, 80) })) : [],
    canChat: Boolean(input.canChat), chatStatus: String(input.chatStatus || "").slice(0, 160) };
}

export function cameraMovement(x, y, yaw) {
  x = clamp(x, -1, 1); y = clamp(y, -1, 1); yaw = Number.isFinite(yaw) ? yaw : 0;
  const length = Math.max(1, Math.hypot(x, y));
  return { x: (x * Math.cos(yaw) + y * Math.sin(yaw)) / length, y: (y * Math.cos(yaw) - x * Math.sin(yaw)) / length };
}

export function smoothPlayer(previous, player, dt) {
  if (!previous || previous.id !== player.id || previous.respawn !== player.respawn || Math.hypot(previous.x - player.x, previous.z - player.z) > 4) return { ...player };
  const alpha = 1 - Math.exp(-clamp(dt, 0, 0.1) * 24);
  return { ...player, x: previous.x + (player.x - previous.x) * alpha, z: previous.z + (player.z - previous.z) * alpha };
}

export function createBombEvents() {
  let previous;
  return frame => {
    const events = [], old = previous; previous = frame;
    if (!old || frame.waiting || old.waiting) return events;
    const second = Math.ceil(frame.ticks * 0.035), oldSecond = Math.ceil(old.ticks * 0.035);
    if (frame.round !== old.round) {
      const loser = old.players.find(p => p.slot === old.holder), survivor = frame.players.find(p => p.slot === frame.local);
      const scored = frame.players.some(p => p.id === old.players.find(o => o.slot === p.slot)?.id && p.score > old.players.find(o => o.slot === p.slot).score);
      if (loser && scored) events.push({ type: "burst", player: loser, won: survivor && survivor.slot !== loser.slot });
    } else if (frame.holder !== old.holder) events.push({ type: "pass" });
    else if (second !== oldSecond && second <= 4 && second > 0) events.push({ type: "tick" });
    return events;
  };
}
