import { makeRoad, STOPS, ROUTE_BOSSES, ROUTE_UPGRADES, normalizeBossTelegraph, normalizeRouteUpgrades } from "./zombie-world.mjs";
import { COOP_PROTOCOL, normalizeRouteInput } from "./coop-route-world.mjs";

const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const validPosition = value => value && [value.x, value.y, value.z].every(n => Number.isFinite(n) && Math.abs(n) < 1000);

export function createRouteView({ read, write, slot }) {
  let snapshot = null, lastEvent = null, lastTick = -1, sentAt = -Infinity, seq = 0, actionSeq = 0, disposed = false, localInput = {}, previousStop = -1, ended = false, protocolMismatch = false;
  const poses = new Map(), actions = [];
  const state = { stopIndex: 0, status: "playing", elapsed: 0, health: 100, maxHealth: 100, busHealth: 200, maxBusHealth: 200, fuel: 70, level: 1, xp: 0, weapon: 0, armor: 0, score: 0, kills: 0, ammo: 180, scrap: 20, medkits: 4, inBus: false, magazine: 12, reload: 0, shotCooldown: 0, meleeCooldown: 0, damageFlash: 0, aim: { x: 0, z: -1 }, events: [], enemies: [], loot: [] };
  state.stopCleared = false; state.routeUpgrades = [null, null, null];
  const body = key => ({ translation: () => poses.get(key) || { x: 4, y: 0.86, z: 9 } });
  const bus = { body: body("bus"), yaw: 0, speed: 0, wheels: 0 }, player = { body: body("local") };
  const teammates = new Map();
  function refresh(dt = 1 / 60) {
    if (disposed) return;
    const data = read();
    protocolMismatch = !!data && data.version !== COOP_PROTOCOL;
    if (!data || data.version !== COOP_PROTOCOL || typeof data.runId !== "string" || !data.runId || data.runId.length > 100 || !Number.isSafeInteger(data.tick) || data.tick < 0 ||
        !validPosition(data.bus) || !data.players || !Array.isArray(data.enemies || []) || !Array.isArray(data.events || []) ||
        !Number.isInteger(data.stopIndex) || data.stopIndex < 0 || data.stopIndex > 2) return;
    if (snapshot?.runId === data.runId && data.tick < lastTick) return;
    const viewedSlot = data.players[slot] ? slot : Object.keys(data.players)[0];
    const local = data.players[viewedSlot];
    if (!validPosition(local)) return;
    if (snapshot && snapshot.runId !== data.runId) { poses.clear(); actions.length = 0; lastEvent = null; previousStop = -1; ended = false; state.events.length = 0; localInput = {}; lastTick = -1; }
    snapshot = data;
    const updatePose = (key, p) => {
      if (!validPosition(p)) return;
      const old = poses.get(key), snap = previousStop !== data.stopIndex || !old || Math.hypot(p.x - old.x, p.z - old.z) > 6;
      const a = snap ? 1 : 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) * 25);
      poses.set(key, { x: old ? old.x + (p.x - old.x) * a : p.x, y: old ? old.y + (p.y - old.y) * a : p.y, z: old ? old.z + (p.z - old.z) * a : p.z });
    };
    lastTick = data.tick;
    updatePose("local", local); updatePose("bus", data.bus);
    for (const key of ["stopIndex", "elapsed", "busHealth", "maxBusHealth", "fuel", "level", "xp", "weapon", "armor", "score", "kills", "ammo", "scrap", "medkits"]) state[key] = number(data[key], state[key]);
    state.stopIndex = Math.max(0, Math.min(2, Math.floor(state.stopIndex)));
    state.stopCleared = data.stopCleared === true;
    state.routeUpgrades = normalizeRouteUpgrades(data.routeUpgrades, state.stopIndex, state.stopCleared);
    for (const key of ["health", "maxHealth", "magazine", "reload", "shotCooldown", "meleeCooldown", "damageFlash"]) state[key] = number(local[key], state[key]);
    state.status = ["waiting", "won", "lost"].includes(data.status) ? data.status : "playing"; state.inBus = !!local.inBus; state.aim = normalizeRouteInput({ aim: local.aim }).aim;
    bus.yaw = number(data.bus.yaw); bus.speed = number(data.bus.speed); bus.wheels = number(data.bus.wheels);
    teammates.clear();
    for (const [id, p] of Object.entries(data.players).slice(0, 5)) if (validPosition(p)) {
      updatePose(id, p); if (id !== viewedSlot) teammates.set(id, { ...p, slot: id, body: body(id) });
    }
    state.enemies = (data.enemies || []).slice(0, 16).filter(e => validPosition(e) && typeof e.id === "string").map(e => {
      const maxHp = Math.max(1, Math.min(1000, number(e.maxHp, 48))), hp = Math.max(0, Math.min(maxHp, number(e.hp)));
      const boss = e.boss === true, spec = ROUTE_BOSSES[state.stopIndex];
      const bossPhase = !hp ? "defeated" : ["advance", "windup", "strike", "recover"].includes(e.bossPhase) ? e.bossPhase : "advance";
      updatePose(`enemy-${e.id}`, e); return { id: e.id.slice(0, 64), boss, hp, maxHp, yaw: number(e.yaw), flash: number(e.flash), attack: number(e.attack), body: body(`enemy-${e.id}`),
        ...(boss ? { bossName: spec.name, bossPhase, bossTimer: Math.max(0, Math.min(4, number(e.bossTimer))),
          telegraph: ["windup", "strike"].includes(bossPhase) ? normalizeBossTelegraph(e.telegraph, state.stopIndex) : null } : {}) };
    });
    state.loot = (Array.isArray(data.loot) ? data.loot : []).slice(0, 8).filter(item => item && Number.isFinite(item.x) && Number.isFinite(item.z));
    previousStop = data.stopIndex;
    const events = (data.events || []).slice(-24).filter(event => event && Number.isSafeInteger(event.id));
    if (lastEvent === null) lastEvent = Math.max(0, ...events.map(event => event.id));
    for (const event of events) if (event.id > lastEvent) {
      lastEvent = event.id;
      if (event.type !== "finish" && event.type !== "checkpoint") state.events.push(event.type === "kill" ? { ...event, id: event.enemyId } : event);
    }
    if (["won", "lost"].includes(state.status) && !ended) { ended = true; state.events.push({ type: "finish", message: data.status === "won" ? "Safe Haven reached together" : "Journey interrupted" }); }
    if (viewedSlot === slot) {
      const acknowledged = normalizeRouteInput({ actionSeq: local.lastAction, seq: local.lastSeq });
      while (actions.length && actions[0].actionSeq <= acknowledged.actionSeq) actions.shift();
      actionSeq = Math.max(actionSeq, acknowledged.actionSeq); seq = Math.max(seq, acknowledged.seq);
    }
    // Menus keep refreshing snapshots even when movement input is paused.
    if (actions.length) send();
  }
  function send(force = false) {
    const now = performance.now();
    if (disposed || !slot || !snapshot?.players?.[slot] || !force && now - sentAt < 50) return;
    sentAt = now; write({ ...normalizeRouteInput(localInput), ...(actions[0] || { action: "", actionSeq }), seq: ++seq });
  }
  function queue(action, extra = {}) {
    if (disposed || !slot || !snapshot?.players?.[slot] || state.status !== "playing" ||
        state.health <= 0 && !action.startsWith("upgrade:") || actions.length >= 8) return false;
    actions.push({ action, actionSeq: ++actionSeq, ...extra }); send(true); return true;
  }
  function objective() {
    if (protocolMismatch) return "Room version differs. Update MiniGameWorld and create a new room.";
    if (!snapshot) return "Connecting to the host...";
    if (snapshot.status === "waiting") return "Waiting for another survivor (2-5 players)";
    if (snapshot.status === "won") return "Safe Haven reached together";
    if (snapshot.status === "lost") return snapshot.busHealth <= 0 ? "Bus destroyed" : "Team down";
    if (state.health <= 0) return "Downed / Waiting for a teammate to revive you";
    const count = state.enemies.filter(e => e.hp > 0).length;
    if (count) return `Defend the bus / ${count} infected remaining`;
    if (!state.routeUpgrades[state.stopIndex]) return slot === "p1" ? "Stop secured / Choose a team upgrade" : "Stop secured / Host is choosing a team upgrade";
    if (!snapshot.fuelFound) return "Find the fuel cache before departing";
    if (Object.values(snapshot.players).some(p => p.health > 0 && !p.inBus)) return "Route clear / All survivors must board";
    return `Drive to ${STOPS[state.stopIndex + 1]?.name || "Safe Haven"}`;
  }
  function prompt() {
    if (!slot || !snapshot || snapshot.status !== "playing" || state.health <= 0) return null;
    if (state.inBus) return { action: "exit", text: Math.abs(bus.speed) > 1 ? "Bus is moving" : "E / Leave bus" };
    const p = player.body.translation(), near = item => Math.hypot(item.x - p.x, item.z - p.z);
    const ally = Object.entries(snapshot.players).find(([id, other]) => id !== slot && other.health <= 0 && near(other) < 2.5);
    if (ally) return { action: "revive", text: state.medkits ? `E / Revive ${String(ally[1].username).slice(0, 24)}` : "No team medkits" };
    const item = state.loot.find(item => !item.taken && near(item) < 2.5);
    if (item) return { action: "loot", text: `E / ${item.name}` };
    if (near(bus.body.translation()) < 6.8 && Math.abs(bus.speed) < 1) return { action: "board", text: snapshot.bus.driver ? "E / Board as passenger" : "E / Drive bus" };
    return null;
  }
  refresh();
  return { state, player, bus, teammates, road: makeRoad(), refresh, objective, prompt,
    get epoch() { return snapshot?.runId; },
    get playerCount() { return Object.keys(snapshot?.players || {}).length; },
    get upgradePending() { return actions.some(action => action.action.startsWith("upgrade:")); },
    chooseUpgrade(id, stopIndex = state.stopIndex) {
      if (slot !== "p1" || snapshot?.status !== "playing" || !snapshot?.players?.[slot] || !state.stopCleared || stopIndex !== state.stopIndex ||
        state.routeUpgrades[stopIndex] || actions.some(action => action.action.startsWith("upgrade:")) || !ROUTE_UPGRADES.some(item => item.id === id)) return false;
      return queue(`upgrade:${id}`, { upgradeStop: stopIndex, upgradeRun: snapshot.runId });
    },
    position: () => state.inBus ? bus.body.translation() : player.body.translation(), checkpoint: () => null,
    clearInput() { localInput = {}; send(true); },
    step(input = {}) {
      if (state.health <= 0) input = {};
      localInput = input;
      for (const action of ["interact", "reload", "heal"]) if (input[action]) queue(action);
      send();
    },
    purchase: action => queue(action), interact: () => queue("interact"), reload: () => queue("reload"),
    dispose() { if (!disposed) { localInput = {}; actions.length = 0; send(true); disposed = true; } }
  };
}
