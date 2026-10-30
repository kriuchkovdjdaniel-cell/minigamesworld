import RAPIER from "@dimforge/rapier3d-compat";
export const KART_STEP = 1 / 60;
export const TRACKS = Object.freeze([
  { name: "Harbor Circuit", rx: 36, rz: 25, ground: "#739b8d", sky: "#b1d4df", accent: "#dc8d78" },
  { name: "Alpine Loop", rx: 30, rz: 36, ground: "#7d9b85", sky: "#bad1e0", accent: "#a5a3cf" },
  { name: "Sunset Speedway", rx: 45, rz: 21, ground: "#a6a98b", sky: "#dbc5bd", accent: "#72b8c2" }
]);
export const TRACK_WIDTH = 11;
export const GATE_COUNT = 16;
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
let initialization;
export function trackPoint(track, fraction, offset = 0) {
  const angle = fraction * Math.PI * 2;
  return { x: (track.rx + offset) * Math.cos(angle), z: (track.rz + offset) * Math.sin(angle) };
}
export function kartAI(kart, track) {
  const p = kart.body.translation(), angle = Math.atan2(p.z / track.rz, p.x / track.rx);
  const goal = trackPoint(track, (angle + 0.27) / (Math.PI * 2), kart.lane);
  const desired = Math.atan2(-(goal.x - p.x), -(goal.z - p.z));
  return { throttle: 0.83, steer: clamp(wrap(desired - kart.yaw) * 2.8, -1, 1), drift: false };
}
export async function createKartWorld(trackIndex = 0) {
  await (initialization ||= RAPIER.init());
  const index = Number.isInteger(trackIndex) && TRACKS[trackIndex] ? trackIndex : 0, track = TRACKS[index];
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); world.timestep = KART_STEP;
  const barriers = [];
  for (const side of [-1, 1]) for (let i = 0; i < 96; i++) {
    const a = trackPoint(track, i / 96, side * TRACK_WIDTH / 2), b = trackPoint(track, (i + 1) / 96, side * TRACK_WIDTH / 2);
    const length = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z), position = { x: (a.x + b.x) / 2, y: 0.6, z: (a.z + b.z) / 2 };
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.24, 1, length / 2 + 0.15).setTranslation(position.x, position.y, position.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setRestitution(0.15));
    barriers.push({ ...position, length, yaw, side, stripe: i % 4 < 2 });
  }
  const karts = Array.from({ length: 4 }, (_, id) => {
    const p = trackPoint(track, -0.005 - Math.floor(id / 2) * 0.014, (id % 2 ? 1 : -1) * 1.7);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, 0.65, p.z).enabledTranslations(true, false, true).lockRotations().setCanSleep(false).setCcdEnabled(true));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.65, 0.5, 1.05).setMass(1).setFriction(0).setRestitution(0.2), body);
    return { id, body, collider, yaw: Math.PI, lap: 0, nextGate: 0, passed: 0, drift: 0, boosting: 0, padCooldown: 0, drifting: false, speed: 0, finished: null, lane: (id - 1.5) * 0.65 };
  });
  const state = { status: "countdown", countdown: 3, elapsed: 0, trackIndex: index, events: [], place: 1 };
  let disposed = false;
  function step(input = {}) {
    if (disposed || state.status === "finished") return;
    if (state.countdown > 0) { state.countdown = Math.max(0, state.countdown - KART_STEP); if (!state.countdown) { state.status = "racing"; state.events.push("gate"); } return; }
    state.elapsed += KART_STEP;
    for (const kart of karts) {
      const controls = kart.id ? kartAI(kart, track) : input;
      const throttle = kart.finished ? 0 : clamp(controls.throttle, -1, 1), steer = clamp(controls.steer, -1, 1);
      const p = kart.body.translation(), velocity = kart.body.linvel();
      const forward = { x: -Math.sin(kart.yaw), z: -Math.cos(kart.yaw) };
      let speed = velocity.x * forward.x + velocity.z * forward.z;
      const drifting = !!controls.drift && speed > 7 && Math.abs(steer) > 0.15 && !kart.finished;
      if (drifting) kart.drift = Math.min(1.5, kart.drift + KART_STEP * 0.8);
      if (kart.drifting && !drifting) { if (kart.drift > 0.35) { kart.boosting = kart.drift * 1.25; if (!kart.id) state.events.push("shield"); } kart.drift = 0; }
      kart.drifting = drifting;
      kart.boosting = Math.max(0, kart.boosting - KART_STEP); kart.padCooldown = Math.max(0, kart.padCooldown - KART_STEP);
      const boostPad = [0.19, 0.69].some(f => { const pad = trackPoint(track, f); return Math.hypot(p.x - pad.x, p.z - pad.z) < 2.8; });
      if (boostPad && !kart.padCooldown && speed > 0) { kart.boosting = 1.4; kart.padCooldown = 3; if (!kart.id) state.events.push("shield"); }
      kart.yaw = wrap(kart.yaw + steer * Math.min(1, Math.abs(speed) / 6) * (drifting ? 1.95 : 1.65) * Math.sign(speed || 1) * KART_STEP);
      speed += (throttle * 13 - speed * (throttle ? 0.5 : 1.2)) * KART_STEP;
      if (kart.boosting && throttle > 0) speed += 20 * KART_STEP;
      speed = clamp(speed, -6, kart.boosting ? 28 : kart.id ? 17 : 21);
      const side = velocity.x * Math.cos(kart.yaw) - velocity.z * Math.sin(kart.yaw);
      const lateral = side * Math.exp(-(drifting ? 2 : 10) * KART_STEP);
      kart.body.setLinvel({ x: -Math.sin(kart.yaw) * speed + Math.cos(kart.yaw) * lateral, y: 0, z: -Math.cos(kart.yaw) * speed - Math.sin(kart.yaw) * lateral }, true);
      kart.body.setRotation({ x: 0, y: Math.sin(kart.yaw / 2), z: 0, w: Math.cos(kart.yaw / 2) }, true); kart.speed = speed;
    }
    world.step();
    for (const kart of karts) {
      if (kart.finished !== null) continue;
      const p = kart.body.translation(), gate = trackPoint(track, kart.nextGate / GATE_COUNT);
      if (Math.hypot(p.x - gate.x, p.z - gate.z) < 6 && kart.speed > 1) {
        kart.passed++; kart.nextGate = (kart.nextGate + 1) % GATE_COUNT;
        if (kart.passed > 1 && (kart.passed - 1) % GATE_COUNT === 0) {
          kart.lap++;
          if (!kart.id) state.events.push("gate");
          if (kart.lap === 3) kart.finished = state.elapsed;
        }
      }
    }
    const ranking = [...karts].sort((a, b) => {
      if (a.finished !== null || b.finished !== null) return (a.finished ?? Infinity) - (b.finished ?? Infinity);
      if (a.passed !== b.passed) return b.passed - a.passed;
      const gate = trackPoint(track, a.nextGate / GATE_COUNT), ap = a.body.translation(), bp = b.body.translation();
      return Math.hypot(ap.x - gate.x, ap.z - gate.z) - Math.hypot(bp.x - gate.x, bp.z - gate.z);
    });
    state.place = ranking.findIndex(kart => kart.id === 0) + 1;
    if (karts[0].finished !== null) state.status = "finished";
  }
  return { state, karts, track, barriers, world, step, dispose() { if (!disposed) { disposed = true; world.free(); } } };
}
