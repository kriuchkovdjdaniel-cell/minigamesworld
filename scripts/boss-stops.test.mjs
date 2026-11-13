import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createZombieSimulation, normalizeCheckpoint, ROUTE_BOSSES, ROUTE_UPGRADES, STOPS, STEP,
  bossState, stepRouteBoss, normalizeBossTelegraph, bossZoneContains, routeUpgradeStats } from "../src/zombie-world.mjs";
import { createCoopRouteWorld, normalizeRouteInput, COOP_PROTOCOL } from "../src/coop-route-world.mjs";
import { createRouteView } from "../src/coop-route-view.mjs";

const members = (count = 2) => Array.from({ length: count }, (_, i) => ({ slot: `p${i + 1}`, memberId: `member-${i}`, username: `Player ${i + 1}`, routeInput: { seq: 0, actionSeq: 0 } }));
const teleport = (sim, actor, x, z, y = 0.95) => {
  actor.body.setTranslation({ x, y, z }, true); actor.body.setNextKinematicTranslation({ x, y, z }); sim.world.step();
};
const tick = (sim, frames, input = {}) => { for (let i = 0; i < frames; i++) sim.step(input); };
const clear = enemies => { for (const enemy of enemies) { enemy.hp = 0; enemy.collider.setEnabled(false); } };
const isolate = (enemies, selected) => clear(enemies.filter(enemy => enemy !== selected));
function command(sim, people, slot, input) {
  const member = people.find(person => person.slot === slot), previous = member.routeInput;
  member.routeInput = { ...input, seq: previous.seq + 1, actionSeq: previous.actionSeq + (input.action ? 1 : 0) };
  sim.reconcile(people); sim.step();
}
const upgrade = (sim, people, id, extra = {}) => command(sim, people, "p1", {
  action: `upgrade:${id}`, upgradeStop: sim.state.stopIndex, upgradeRun: sim.state.runId, ...extra
});

test("each solo stop has its own boss and old saves migrate without free upgrades", async () => {
  for (let stop = 0; stop < 3; stop++) {
    const sim = await createZombieSimulation({ version: 1, stopIndex: stop, routeUpgrades: ["reinforced"], stopCleared: true });
    try {
      const bosses = sim.state.enemies.filter(enemy => enemy.boss);
      assert.equal(bosses.length, 1); assert.equal(bosses[0].bossName, ROUTE_BOSSES[stop].name);
      assert.equal(bosses[0].hp, ROUTE_BOSSES[stop].hp); assert.equal(sim.state.stopCleared, false);
      assert.deepEqual(sim.state.routeUpgrades, [null, null, null]); assert.equal(sim.checkpoint().version, 2);
      assert.equal(sim.chooseUpgrade("reinforced"), false);
    } finally { sim.dispose(); }
  }
});

test("all boss attacks warn, lock their target, strike, recover and cancel on death", () => {
  for (let stopIndex = 0; stopIndex < 3; stopIndex++) {
    const spec = ROUTE_BOSSES[stopIndex], boss = bossState(stopIndex), events = [];
    let traveled = 0, strikes = 0;
    const context = { stopIndex, dt: STEP, position: { x: 0, z: STOPS[stopIndex].z }, busPosition: { x: 0, z: STOPS[stopIndex].z + 6 },
      survivors: [], move: (x, z) => { traveled += Math.hypot(x, z); }, strike: () => strikes++, emit: type => events.push(type) };
    boss.bossTimer = 0; stepRouteBoss(boss, context);
    assert.equal(boss.bossPhase, "windup"); assert.deepEqual(events, ["boss-warning"]);
    const zone = { ...boss.telegraph }; context.busPosition.x = 20;
    for (let frame = 0; frame < Math.floor(spec.windup / STEP) - 1; frame++) stepRouteBoss(boss, context);
    assert.equal(strikes, 0); assert.deepEqual(boss.telegraph, zone);
    for (let frame = 0; frame < 90 && boss.bossPhase !== "recover"; frame++) stepRouteBoss(boss, context);
    assert.equal(boss.bossPhase, "recover"); assert.ok(strikes > 0); assert.equal(boss.telegraph, null);
    assert.equal(events.filter(type => type === "boss-strike").length, 1);
    assert.ok(Math.abs(traveled - (spec.kind === "charge" ? 11 : 0)) < 1e-8, "charge stays inside its warning lane");
    boss.hp = 0; const before = strikes; stepRouteBoss(boss, context);
    assert.equal(boss.bossPhase, "defeated"); assert.equal(strikes, before);
  }
});

test("telegraphs normalize direction and reject invalid or out-of-stop positions", () => {
  const zone = normalizeBossTelegraph({ x: 0, z: -200, dx: 9, dz: 0, radius: 999, length: 999, kind: "blast" }, 2);
  assert.deepEqual(zone, { x: 0, z: -200, dx: 1, dz: 0, radius: 1.8, length: 11, kind: "charge" });
  assert.equal(bossZoneContains(zone, { x: 5, z: -200 }), true);
  assert.equal(bossZoneContains(zone, { x: 12, z: -200 }), false);
  assert.equal(bossZoneContains(zone, { x: 5, z: -203 }), false);
  for (const bad of [null, {}, { x: 0, z: -200, dx: NaN, dz: 0 }, { x: 40, z: -200, dx: 1, dz: 0 }, { x: 0, z: 0, dx: 1, dz: 0 }]) assert.equal(normalizeBossTelegraph(bad, 2), null);
});

test("every solo boss damages an unoccupied bus exactly once per strike", async () => {
  for (let stop = 0; stop < 3; stop++) {
    const sim = await createZombieSimulation({ version: 1, stopIndex: stop });
    try {
      const boss = sim.state.enemies.find(enemy => enemy.boss), z = STOPS[stop].z;
      isolate(sim.state.enemies, boss); teleport(sim, boss, 0, z + 1); teleport(sim, sim.player, 25, z + 16);
      boss.bossTimer = 0; const health = sim.state.busHealth;
      sim.step(); assert.equal(boss.bossPhase, "windup"); assert.equal(sim.state.busHealth, health);
      for (let i = 0; i < 200 && boss.bossPhase !== "recover"; i++) sim.step();
      assert.equal(sim.state.busHealth, health - ROUTE_BOSSES[stop].busDamage);
      assert.equal(sim.state.health, 100); assert.equal(sim.state.inBus, false);
      tick(sim, 30); assert.equal(sim.state.busHealth, health - ROUTE_BOSSES[stop].busDamage);
    } finally { sim.dispose(); }
  }
});

test("slam damages exposed survivors once, but dodging and solid walls protect them", async () => {
  for (const scenario of ["exposed", "dodge", "wall"]) {
    const sim = await createZombieSimulation();
    try {
      const boss = sim.state.enemies.find(enemy => enemy.boss); isolate(sim.state.enemies, boss);
      teleport(sim, boss, scenario === "wall" ? -10 : 5, 0);
      teleport(sim, sim.player, scenario === "wall" ? -12 : 7, 0);
      if (scenario === "wall") { teleport(sim, boss, -10, -8); teleport(sim, sim.player, -12, -8); }
      boss.bossPhase = "windup"; boss.bossTimer = 0.2;
      const p = boss.body.translation(); boss.telegraph = normalizeBossTelegraph({ x: p.x, z: p.z, dx: 1, dz: 0 }, 0);
      if (scenario === "dodge") teleport(sim, sim.player, 10, 0);
      tick(sim, 40); assert.equal(sim.state.health, scenario === "exposed" ? 80 : 100);
    } finally { sim.dispose(); }
  }
});

test("upgrades pay once, stack bounded bonuses, persist and cannot be selected early or at the wrong stop", async () => {
  for (const { id } of ROUTE_UPGRADES) {
    const sim = await createZombieSimulation();
    try {
      assert.equal(sim.chooseUpgrade(id), false); clear(sim.state.enemies); sim.step();
      const before = { ...sim.state };
      assert.equal(sim.chooseUpgrade(id, 1), false); assert.equal(sim.chooseUpgrade("invented"), false);
      assert.equal(sim.chooseUpgrade(id), true); assert.equal(sim.chooseUpgrade(id), false);
      assert.equal(sim.state.fuel, before.fuel + 20);
      assert.equal(sim.state.maxBusHealth, before.maxBusHealth + (id === "reinforced" ? 50 : 0));
      assert.equal(sim.state.ammo, before.ammo + (id === "overdrive" ? 36 : 0));
      assert.equal(sim.state.maxHealth, before.maxHealth + (id === "field-medic" ? 20 : 0));
      assert.equal(sim.state.medkits, before.medkits + (id === "field-medic" ? 2 : 0));
      const saved = sim.checkpoint(), restored = await createZombieSimulation(saved);
      try {
        assert.equal(restored.state.stopCleared, true); assert.equal(restored.state.enemies.some(enemy => enemy.hp > 0), false);
        assert.deepEqual(restored.state.routeUpgrades, [id, null, null]); assert.equal(restored.chooseUpgrade(id), false);
        assert.equal(restored.state.maxHealth, sim.state.maxHealth); assert.equal(restored.state.maxBusHealth, sim.state.maxBusHealth);
        assert.equal(restored.state.ammo, sim.state.ammo); assert.equal(restored.state.medkits, sim.state.medkits);
      } finally { restored.dispose(); }
      saved.routeUpgrades[0] = "tampered"; assert.equal(sim.checkpoint().routeUpgrades[0], id);
      sim.state.status = "lost"; assert.equal(sim.chooseUpgrade(id), false);
    } finally { sim.dispose(); }
  }
  assert.deepEqual(routeUpgradeStats(["reinforced", "reinforced", "reinforced"]), { busCapacity: 150, busResistance: 0.36, damage: 0, reload: 1.25, health: 0 });
  assert.equal(routeUpgradeStats(["overdrive", "overdrive", "overdrive"]).reload, 0.8);
  assert.equal(routeUpgradeStats(["field-medic", "field-medic", "field-medic"]).health, 60);
});

test("secured checkpoints preserve pending choice, loot and healing without replaying rewards", async () => {
  const sim = await createZombieSimulation();
  try {
    clear(sim.state.enemies); sim.step(); assert.match(sim.objective(), /Choose/);
    teleport(sim, sim.player, -17, -10); sim.interact(); sim.state.health = 30; sim.purchase("heal");
    const saved = sim.checkpoint(); assert.equal(saved.fuelFound, true); assert.deepEqual(saved.takenLoot, ["fuel"]);
    assert.equal(saved.health, 90); assert.equal(saved.medkits, 1);
    const restored = await createZombieSimulation(saved);
    try {
      assert.match(restored.objective(), /Choose/); teleport(restored, restored.player, -17, -10);
      assert.equal(restored.interact(), false); assert.equal(restored.state.scrap, saved.scrap);
      assert.equal(restored.chooseUpgrade("field-medic"), true); assert.equal(restored.state.health, 120);
      const event = restored.state.events.findLast(event => event.type === "checkpoint");
      event.checkpoint.routeUpgrades[0] = "reinforced"; assert.equal(restored.checkpoint().routeUpgrades[0], "field-medic");
    } finally { restored.dispose(); }
    const bad = normalizeCheckpoint({ version: 2, stopIndex: 1, routeUpgrades: ["reinforced", "overdrive", "field-medic"], stopCleared: false, fuelFound: true, takenLoot: ["fuel"] });
    assert.deepEqual(bad.routeUpgrades, ["reinforced", null, null]); assert.equal(bad.fuelFound, false); assert.deepEqual(bad.takenLoot, []);
  } finally { sim.dispose(); }
});

test("solo departure requires boss defeat, an upgrade and fuel independently", async () => {
  const sim = await createZombieSimulation();
  try {
    clear(sim.state.enemies); sim.step(); sim.state.fuelFound = true; sim.interact();
    tick(sim, 450, { throttle: 1 }); assert.equal(sim.state.stopIndex, 0); assert.ok(sim.bus.body.translation().z >= -28.1);
    sim.state.fuelFound = false; assert.equal(sim.chooseUpgrade("reinforced"), true);
    tick(sim, 120, { throttle: 1 }); assert.equal(sim.state.stopIndex, 0);
    sim.state.fuelFound = true;
    for (let i = 0; i < 600 && sim.state.stopIndex === 0; i++) sim.step({ throttle: 1 });
    assert.equal(sim.state.stopIndex, 1); assert.equal(sim.state.stopCleared, false);
    assert.deepEqual(sim.state.routeUpgrades, ["reinforced", null, null]); assert.equal(sim.state.inBus, false);
  } finally { sim.dispose(); }
});

test("solo full journey kills every boss with raycasts, upgrades, drives and finishes once", async () => {
  const sim = await createZombieSimulation();
  try {
    for (let stop = 0; stop < 3; stop++) {
      assert.equal(sim.state.stopIndex, stop); const z = STOPS[stop].z;
      for (const enemy of sim.state.enemies) {
        if (enemy.hp <= 0) continue;
        teleport(sim, sim.player, 7, z + 14); teleport(sim, enemy, 7, z + 4);
        for (let i = 0; i < 900 && enemy.hp > 0; i++) {
          const p = sim.player.body.translation(), e = enemy.body.translation();
          sim.step({ shoot: true, aim: { x: e.x - p.x, z: e.z - p.z }, heal: sim.state.health < 65 });
        }
        assert.equal(enemy.hp, 0, enemy.id);
      }
      assert.equal(sim.state.stopCleared, true); assert.equal(sim.chooseUpgrade(ROUTE_UPGRADES[stop].id), true);
      teleport(sim, sim.player, -17, z - 9); sim.interact(); teleport(sim, sim.player, 17, z - 9); sim.interact();
      teleport(sim, sim.player, 4, z + 9); sim.interact(); sim.purchase("repair"); sim.purchase("weapon");
      for (let i = 0; i < 900 && sim.state.stopIndex === stop && sim.state.status === "playing"; i++) sim.step({ throttle: 1 });
      assert.ok(sim.state.stopIndex > stop || sim.state.status === "won", `stalled at ${stop}`);
    }
    assert.equal(sim.state.status, "won"); assert.equal(sim.state.kills, 17); assert.ok(sim.state.fuel > 0);
    const score = sim.state.score; tick(sim, 60); assert.equal(sim.state.score, score);
    assert.equal(sim.state.events.filter(event => event.type === "finish").length, 1);
  } finally { sim.dispose(); }
});

test("co-op accepts only host choices for the current run and stop, and retries never pay twice", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    assert.equal(sim.enemies.find(enemy => enemy.boss).hp, ROUTE_BOSSES[0].hp + 45);
    upgrade(sim, people, "overdrive"); assert.equal(sim.state.routeUpgrades[0], null);
    clear(sim.enemies); sim.step();
    command(sim, people, "p2", { action: "upgrade:overdrive", upgradeStop: 0, upgradeRun: sim.state.runId });
    assert.equal(sim.state.routeUpgrades[0], null);
    upgrade(sim, people, "overdrive", { upgradeRun: "old-run" });
    upgrade(sim, people, "overdrive", { upgradeStop: 1 });
    assert.equal(sim.state.routeUpgrades[0], null);
    const ammo = sim.state.ammo; upgrade(sim, people, "overdrive"); assert.equal(sim.state.ammo, ammo + 36);
    for (let i = 0; i < 10; i++) { sim.reconcile(people); sim.step(); }
    upgrade(sim, people, "reinforced"); assert.equal(sim.state.ammo, ammo + 36); assert.equal(sim.state.maxBusHealth, 200);
    assert.deepEqual(sim.state.routeUpgrades, ["overdrive", null, null]);
    const malicious = normalizeRouteInput({ action: "upgrade:overdrive", upgradeStop: 99, upgradeRun: 4, damage: 999, routeUpgrades: ["reinforced"] });
    assert.equal(malicious.upgradeStop, -1); assert.equal(malicious.upgradeRun, ""); assert.equal(malicious.damage, undefined); assert.equal(malicious.routeUpgrades, undefined);
  } finally { sim.dispose(); }
});

test("a downed host can choose team medicine; revive, healing and late joins retain the new capacity", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    clear(sim.enemies); sim.step(); const host = sim.players.get("p1"), ally = sim.players.get("p2");
    host.health = 0; host.collider.setEnabled(false); ally.health = 40; sim.state.medkits = 0;
    upgrade(sim, people, "field-medic"); assert.equal(host.health, 0); assert.equal(host.maxHealth, 120);
    assert.equal(ally.health, 90); assert.equal(sim.state.medkits, 2);
    command(sim, people, "p2", { action: "interact" }); assert.equal(host.health, 60); assert.equal(sim.state.medkits, 1);
    command(sim, people, "p1", { action: "heal" }); assert.equal(host.health, 120);
    people.push(members(3)[2]); sim.reconcile(people); assert.equal(sim.players.get("p3").health, 120);
  } finally { sim.dispose(); }
});

test("co-op boss snapshots include bounded warnings and authoritative bus damage", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    const boss = sim.enemies.find(enemy => enemy.boss); isolate(sim.enemies, boss); teleport(sim, boss, 0, 1); boss.bossTimer = 0;
    for (const [i, player] of [...sim.players.values()].entries()) teleport(sim, player, 25, 12 + i * 2);
    sim.step(); const data = sim.snapshot(); assert.equal(data.version, COOP_PROTOCOL);
    assert.equal(data.enemies.find(enemy => enemy.boss).bossPhase, "windup");
    assert.ok(JSON.stringify(data).length < 20000); data.routeUpgrades[0] = "reinforced"; assert.equal(sim.state.routeUpgrades[0], null);
    const health = sim.state.busHealth; tick(sim, 130); assert.equal(sim.state.busHealth, health - ROUTE_BOSSES[0].busDamage);
  } finally { sim.dispose(); }
});

test("co-op full journey uses combat, host upgrades and all-survivor boarding before each departure", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people);
  try {
    for (let stop = 0; stop < 3; stop++) {
      assert.equal(sim.state.stopIndex, stop); const z = STOPS[stop].z, host = sim.players.get("p1"), ally = sim.players.get("p2");
      teleport(sim, ally, 26, z + 18);
      for (const enemy of sim.enemies) {
        if (enemy.hp <= 0) continue;
        teleport(sim, host, 7, z + 14); teleport(sim, enemy, 7, z + 4);
        for (let i = 0; i < 900 && enemy.hp > 0; i++) {
          const p = host.body.translation(), e = enemy.body.translation();
          command(sim, people, "p1", { shoot: true, aim: { x: e.x - p.x, z: e.z - p.z },
            action: host.health < 65 && sim.state.medkits ? "heal" : host.magazine === 0 && !host.reload ? "reload" : "" });
        }
        assert.equal(enemy.hp, 0, enemy.id);
      }
      assert.equal(sim.state.stopCleared, true);
      teleport(sim, host, -17, z - 8); command(sim, people, "p1", { action: "interact" });
      teleport(sim, host, 17, z - 8); command(sim, people, "p1", { action: "interact" });
      teleport(sim, host, 4, z + 9); command(sim, people, "p1", { action: "repair" }); command(sim, people, "p1", { action: "interact" });
      for (let i = 0; i < 350; i++) command(sim, people, "p1", { throttle: 1 });
      assert.equal(sim.state.stopIndex, stop); assert.ok(sim.bus.body.translation().z >= z - 28.1);
      upgrade(sim, people, ROUTE_UPGRADES[stop].id);
      for (let i = 0; i < 60; i++) command(sim, people, "p1", { throttle: 1 });
      assert.equal(sim.state.stopIndex, stop); assert.ok(sim.bus.body.translation().z >= z - 28.1);
      // Bring the passenger to the stopped bus and board through the real command path.
      for (let i = 0; i < 90; i++) command(sim, people, "p1", { throttle: 0 });
      const b = sim.bus.body.translation(); teleport(sim, ally, b.x + 4, b.z + 1);
      command(sim, people, "p2", { action: "interact" }); assert.equal(ally.inBus, true);
      for (let i = 0; i < 900 && sim.state.stopIndex === stop && sim.state.status === "playing"; i++) command(sim, people, "p1", { throttle: 1 });
      assert.ok(sim.state.stopIndex > stop || sim.state.status === "won", `stalled at ${stop}`);
    }
    assert.equal(sim.state.status, "won"); assert.equal(sim.state.kills, 24);
    const score = sim.state.score; tick(sim, 60); assert.equal(sim.state.score, score);
    assert.equal(sim.state.events.filter(event => event.type === "finish").length, 1);
  } finally { sim.dispose(); }
});

test("view exposes pending choice, retries while paused, acknowledges and resets on a new run", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people); clear(sim.enemies); sim.step();
  let data = sim.snapshot(); const writes = [];
  const view = createRouteView({ read: () => data, write: value => writes.push(value), slot: "p1" });
  try {
    assert.equal(view.chooseUpgrade("overdrive"), true); const input = writes.at(-1);
    assert.equal(view.upgradePending, true); assert.equal(view.chooseUpgrade("reinforced"), false);
    assert.equal(view.state.routeUpgrades[0], null, "no optimistic reward");
    await new Promise(resolve => setTimeout(resolve, 60)); view.refresh();
    assert.equal(writes.length, 2); assert.equal(writes[1].actionSeq, input.actionSeq); assert.ok(writes[1].seq > input.seq);
    people[0].routeInput = writes[1]; sim.reconcile(people); sim.step(); data = sim.snapshot(); view.refresh();
    assert.equal(view.upgradePending, false); assert.equal(view.state.routeUpgrades[0], "overdrive");
    data = { ...data, runId: "next-run", tick: 0, routeUpgrades: [null, null, null], status: "playing" }; view.refresh();
    assert.equal(view.chooseUpgrade("reinforced"), true); assert.equal(writes.at(-1).upgradeRun, "next-run");
    data = { ...data, runId: "restart", routeUpgrades: [null, null, null], stopCleared: false }; view.refresh();
    assert.equal(view.upgradePending, false); view.clearInput(); assert.equal(writes.at(-1).action, "");
    view.dispose(); assert.equal(view.chooseUpgrade("overdrive"), false); assert.equal(view.interact(), false);
  } finally { view.dispose(); sim.dispose(); }
});

test("view remount resumes sequence numbers, rejects stale snapshots, and spectators never choose", async () => {
  const sim = await createCoopRouteWorld(), people = members(); sim.reconcile(people); clear(sim.enemies); sim.step();
  for (let i = 0; i < 30; i++) command(sim, people, "p1", {});
  let data = sim.snapshot(), input;
  const view = createRouteView({ read: () => data, write: value => { input = value; }, slot: "p1" });
  try {
    const tick = data.tick; view.chooseUpgrade("reinforced"); assert.ok(input.seq > people[0].routeInput.seq);
    people[0].routeInput = input; sim.reconcile(people); sim.step(); data = sim.snapshot(); view.refresh();
    assert.equal(view.state.routeUpgrades[0], "reinforced");
    data = { ...data, tick, routeUpgrades: [null, null, null] }; view.refresh(); assert.equal(view.state.routeUpgrades[0], "reinforced");
    data = { ...data, tick: tick + 2, routeUpgrades: [null, null, null] };
    for (const slot of ["p2", "", "p5"]) {
      let writes = 0; const other = createRouteView({ read: () => data, write: () => writes++, slot });
      assert.equal(other.chooseUpgrade("reinforced"), false); other.dispose(); assert.equal(writes, slot === "p2" ? 1 : 0);
    }
    data = { ...data, tick: tick + 3, status: "waiting" }; view.refresh();
    assert.equal(view.state.status, "waiting"); assert.equal(view.chooseUpgrade("overdrive"), false);
    assert.equal(view.state.events.some(event => event.type === "finish"), false);
  } finally { view.dispose(); sim.dispose(); }
});

test("view sanitizes boss presentation without accepting client-supplied attack geometry", async () => {
  const sim = await createCoopRouteWorld(); sim.reconcile(members());
  let data = sim.snapshot(); const boss = data.enemies.find(enemy => enemy.boss);
  Object.assign(boss, { bossPhase: "windup", bossName: "injected", bossTimer: 999, hp: Infinity, telegraph: { x: 0, z: 0, dx: 0, dz: 2, radius: 999 } });
  const view = createRouteView({ read: () => data, write() {}, slot: "p1" });
  try {
    assert.equal(view.state.enemies.find(enemy => enemy.boss).telegraph, null);
    boss.hp = 100; data.tick++; view.refresh(); const sanitized = view.state.enemies.find(enemy => enemy.boss);
    assert.equal(sanitized.bossName, ROUTE_BOSSES[0].name); assert.equal(sanitized.bossTimer, 4);
    assert.equal(sanitized.telegraph.radius, ROUTE_BOSSES[0].radius);
    data = { ...data, tick: data.tick + 1, loot: [null], events: [null] }; assert.doesNotThrow(() => view.refresh());
  } finally { view.dispose(); sim.dispose(); }
});

test("parent photo mode and adventure finish payload remain connected", () => {
  const source = readFileSync(new URL("../src/zombie-game.mjs", import.meta.url), "utf8");
  assert.match(source, /!options.cooperative \? mountPhotoMode\(host/);
  assert.match(source, /options.onFinish\?\.\(\{ won: sim.state.status === "won", score: sim.state.score, seconds: sim.state.elapsed \}\)/);
  assert.match(source, /host.dataset.photo === "true"/);
});

test("incompatible co-op clients show an update message instead of a silent waiting state", async () => {
  const sim = await createCoopRouteWorld(); sim.reconcile(members());
  let data = { ...sim.snapshot(), version: 1 };
  const view = createRouteView({ read: () => data, write() {}, slot: "p1" });
  try {
    assert.match(view.objective(), /Update MiniGameWorld/);
    data = sim.snapshot(); view.refresh(); assert.doesNotMatch(view.objective(), /Update MiniGameWorld/);
  } finally { view.dispose(); sim.dispose(); }
});
