import test from "node:test";
import assert from "node:assert/strict";
import { ADVENTURE_GAMES, SECRET_IDS, MASTERY_REWARDS, EXPLORER_REWARDS, weekId, weeklyChallenge, normalizeAdventure, mergeAdventure, recordAdventure, claimAdventureReward } from "../src/adventure-model.mjs";
import { PARTY_GAMES, partyMembers, partyReady, partyBallots, changeParty, patchPartyRound } from "../src/party-model.mjs";
import { relicPosition, mountRelic } from "../src/secret-relic.mjs";
import { Scene } from "three";
import { makeLevel, createSimulation } from "../src/three-world.mjs";
import { makeArcadeLevel, createArcadeSimulation } from "../src/arcade-world.mjs";
import { makeCollectionLevel } from "../src/collection-world.mjs";

test("weekly challenges use Monday UTC boundaries and rotate all three playable modifiers", () => {
  assert.equal(weekId(Date.parse("2026-11-01T23:59:59Z")), "2026-10-26");
  assert.equal(weekId(Date.parse("2026-11-02T00:00:00Z")), "2026-11-02");
  const weeks = [0, 1, 2].map(i => weeklyChallenge(Date.parse("2026-11-02T00:00:00Z") + i * 604800000));
  assert.equal(new Set(weeks.map(w => w.modifier)).size, 3);
  weeks.forEach(w => { assert.ok(w.level >= 0 && w.level < ADVENTURE_GAMES[w.game].stages); assert.equal(w.endsAt, Date.parse(w.id) + 604800000); });
  const stages = {};
  for (let i = 0; i < 12; i++) { const w = weeklyChallenge(Date.parse("2026-11-02T00:00:00Z") + i * 604800000); (stages[w.game] ||= new Set()).add(w.level); }
  for (const [game, levels] of Object.entries(stages)) assert.equal(levels.size, ADVENTURE_GAMES[game].stages, "every stage rotates into its modifier");
});
test("adventure normalization rejects unknown games, levels, invalid times and duplicate secrets", () => {
  const p = normalizeAdventure({ secrets: { [SECRET_IDS[0]]: true, bad: true }, clears: { dodger: { 0: { seconds: -1 }, 1: { seconds: Infinity }, 2: { seconds: 40 }, 7: { seconds: 4 } }, unknown: { 0: { seconds: 5 } } }, claims: { arbitrary: true } });
  assert.deepEqual(Object.keys(p.secrets), [SECRET_IDS[0]]); assert.deepEqual(Object.keys(p.clears.dodger), ["2"]); assert.deepEqual(p.claims, {});
  assert.deepEqual(recordAdventure(p, { type: "secret", id: "bad" }), p);
  assert.deepEqual(recordAdventure(p, { type: "finish", game: "dodger", level: 0, won: false, seconds: 30 }), p);
});
test("progress merges concurrent device results without losing clears, relics or better times", () => {
  let a = recordAdventure({}, { type: "secret", id: SECRET_IDS[0] }); a = recordAdventure(a, { type: "finish", game: "dodger", level: 0, won: true, seconds: 40 });
  let b = recordAdventure({}, { type: "secret", id: SECRET_IDS[1] }); b = recordAdventure(b, { type: "finish", game: "dodger", level: 0, won: true, seconds: 35, flawless: true });
  const merged = mergeAdventure(a, b); assert.equal(Object.keys(merged.secrets).length, 2); assert.deepEqual(merged.clears.dodger[0], { seconds: 35, flawless: true }); assert.deepEqual(mergeAdventure(merged, a), merged);
});
test("weekly rewards cannot be claimed twice, early or for an expired/different challenge", () => {
  const now = Date.parse("2026-11-02T12:00:00Z"), w = weeklyChallenge(now), event = { type: "finish", game: w.game, level: w.level, won: true, seconds: 60, challenge: w.id };
  let progress = recordAdventure({}, event, now); assert.equal(progress.weeks[w.id], true); assert.deepEqual(progress.clears, { [w.game]: {} });
  const user = { coins: 10, flameCoins: 50, untouched: "keep", adventure: progress };
  assert.equal(claimAdventureReward({ coins: 0 }, `weekly-${w.id}`, now), undefined);
  const claimed = claimAdventureReward(user, `weekly-${w.id}`, now); assert.equal(claimed.coins, 160); assert.equal(claimed.flameCoins, 50); assert.equal(claimed.untouched, "keep");
  assert.equal(claimAdventureReward(claimed, `weekly-${w.id}`, now), undefined);
  assert.equal(claimAdventureReward(user, `weekly-${w.id}`, now + 604800000), undefined);
  progress = recordAdventure({}, { ...event, game: "catcher" }, now); assert.deepEqual(progress.weeks, {});
});
test("mastery and explorer cosmetics unlock only after their full requirements", () => {
  for (const reward of MASTERY_REWARDS) {
    let progress = normalizeAdventure();
    for (let level = 0; level < reward.target; level++) { assert.equal(claimAdventureReward({ adventure: progress }, reward.id), undefined); progress = recordAdventure(progress, { type: "finish", game: reward.game, level, seconds: 100, won: true }); }
    const user = claimAdventureReward({ adventure: progress, ownedItems: { keep: true }, coins: 5 }, reward.id);
    assert.equal(user.ownedItems[reward.item], true); assert.equal(user.ownedItems.keep, true); assert.equal(user.coins, 5); assert.equal(claimAdventureReward(user, reward.id), undefined);
  }
  const progress = SECRET_IDS.reduce((p, id) => recordAdventure(p, { type: "secret", id }), {});
  for (const reward of EXPLORER_REWARDS) assert.equal(claimAdventureReward({ adventure: progress }, reward.id).ownedItems[reward.item], true);
});
test("all ten secret relics are placed on traversable level surfaces", () => {
  for (const id of SECRET_IDS) {
    const [game, stage] = id.split(":"), level = game === "crystal-isles-3d" ? makeLevel(game, Number(stage)) : game === "dodger" ? makeArcadeLevel(game, Number(stage)) : makeCollectionLevel(game, Number(stage));
    const p = relicPosition(game, level); assert.ok(p && Object.values(p).every(Number.isFinite));
    if (level.boxes) assert.ok(level.boxes.some(b => Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.z - b.z) < b.d / 2 && p.y > b.y + b.h / 2));
    else { assert.ok(Math.abs(p.x) < 11 && Math.abs(p.z) < 11); assert.ok(!level.obstacles.some(b => Math.abs(p.x - b.x) < b.w / 2 + 0.45 && Math.abs(p.z - b.z) < b.d / 2 + 0.45)); }
  }
});
test("weekly modifiers change real physics and leave normal simulations unchanged", async () => {
  const normal = await createSimulation("crystal-isles-3d", 0), moon = await createSimulation("crystal-isles-3d", 0, "low-gravity");
  try { for (const sim of [normal, moon]) { for (let i = 0; i < 60; i++) sim.step(); sim.step({ jump: true }); for (let i = 0; i < 30; i++) sim.step(); } assert.ok(moon.body.translation().y > normal.body.translation().y + 0.5); } finally { normal.dispose(); moon.dispose(); }
  const one = await createArcadeSimulation("laser-dodge", 0, "one-life"); try { assert.equal(one.state.lives, 1); one.damage(); assert.equal(one.state.status, "lost"); } finally { one.dispose(); }
  const base = await createArcadeSimulation("dodger", 0), fast = await createArcadeSimulation("dodger", 0, "fast-guards");
  try { for (let i = 0; i < 90; i++) { base.step(); fast.step(); } assert.notDeepEqual(base.state.guards, fast.state.guards); } finally { base.dispose(); fast.dispose(); }
});
function room(count = 3) {
  const members = {}, playersState = {};
  for (let n = 1; n <= count; n++) { members[`p${n}`] = `u${n}`; playersState[`p${n}`] = { memberId: `u${n}`, username: `User ${n}`, x: n }; }
  return { createdBy: "u1", game: "online-bomb-tag", members, playersState, party: { enabled: true, phase: "lobby", round: 0, ready: {}, votes: {} } };
}

test("relic pickup is proximity-based, single-flight, retryable and disposed with the scene", async () => {
  const scene = new Scene(), controller = new AbortController();
  let calls = 0, accept;
  const relic = mountRelic(scene, "dodger", { levelIndex: 1 }, { collect: id => {
    calls++; assert.equal(id, "dodger:1");
    if (calls === 1) throw new Error("Offline");
    return new Promise(resolve => { accept = resolve; });
  } }, controller.signal);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  relic.update({ x: 10, y: 1, z: 10 }, 0); await flush(); assert.equal(calls, 0);
  relic.update(relic.position, 0); await flush(); assert.equal(calls, 1); assert.equal(scene.children[0].visible, true);
  relic.update(relic.position, 4); await flush(); assert.equal(calls, 1);
  relic.update(relic.position, 5); relic.update(relic.position, 6); await flush(); assert.equal(calls, 2);
  accept(); await flush(); relic.update(relic.position, 8); await flush();
  assert.equal(calls, 2); assert.equal(scene.children[0].visible, false);
  let disposed = 0; scene.children[0].geometry.addEventListener("dispose", () => disposed++);
  controller.abort(); assert.equal(scene.children.length, 0); assert.equal(disposed, 1);
  mountRelic(scene, "dodger", {}, {}, controller.signal); assert.equal(scene.children.length, 0);
  mountRelic(scene, "dodger", { levelIndex: 1 }, { found: ["dodger:1"] }, new AbortController().signal); assert.equal(scene.children.length, 0);
});
test("party requires two to five present ready members and only host can start", () => {
  let r = room(5); assert.equal(partyMembers(r).length, 5); assert.equal(partyReady(r), false);
  assert.equal(changeParty(r, "outsider", "ready", { ready: true }), undefined); assert.equal(changeParty(r, "u2", "start"), undefined);
  for (let n = 1; n <= 5; n++) r = changeParty(r, `u${n}`, "ready", { ready: true });
  assert.equal(partyReady(r), true); r = changeParty(r, "u1", "start"); assert.equal(r.party.phase, "playing"); assert.equal(r.party.round, 1);
  assert.equal(changeParty(r, "u1", "start"), undefined); assert.equal(changeParty(r, "u2", "lobby"), undefined);
  r = changeParty(r, "u1", "lobby"); assert.deepEqual(r.party.ready, {}); assert.equal(partyReady(changeParty(room(1), "u1", "ready", { ready: true })), false);
});
test("votes are deterministic, validate game/map and invalidate readiness; departed players do not vote", () => {
  let r = room(); r = changeParty(r, "u1", "vote", { game: "online-snake", map: "factory" }); r = changeParty(r, "u1", "ready", { ready: true });
  r = changeParty(r, "u2", "vote", { game: "online-snake", map: "factory" }); assert.deepEqual(r.party.ready, {});
  assert.equal(partyBallots(r).game, "online-snake"); assert.equal(partyBallots(r).map, "factory");
  assert.equal(changeParty(r, "u3", "vote", { game: "unknown", map: "factory" }), undefined);
  delete r.members.p1; delete r.members.p2; assert.equal(partyBallots(r).game, PARTY_GAMES[0]);
  r.members.p2 = "replacement"; r.playersState.p2.memberId = "replacement"; assert.equal(partyBallots(r).counts["online-snake"], 0);
});
test("late game packets cannot overwrite a new party round or lobby, or recreate departed members", () => {
  let r = room(2); r = changeParty(changeParty(r, "u1", "ready", { ready: true }), "u2", "ready", { ready: true }); r = changeParty(r, "u1", "start");
  const updated = patchPartyRound(r, "u2", 1, r.game, { "playersState/p2/x": 8, "playersState/p1/x": 99, "playersState/p2/memberId": "hacker", bomb: { broken: true } });
  assert.equal(updated.playersState.p2.x, 8); assert.equal(updated.playersState.p1.x, 1); assert.equal(updated.playersState.p2.memberId, "u2"); assert.equal(updated.bomb, undefined);
  assert.equal(patchPartyRound(r, "u2", 0, r.game, {}), undefined); assert.equal(patchPartyRound(r, "u2", 1, "online-snake", {}), undefined);
  const lobby = changeParty(r, "u1", "lobby"); assert.equal(patchPartyRound(lobby, "u2", 1, r.game, {}), undefined);
  delete r.members.p2; assert.equal(patchPartyRound(r, "u2", 1, r.game, {}), undefined);
});

test("party preserves normal guest food updates, chat and own-player restart", () => {
  let r = room(2);
  r.game = "online-snake"; r.party.phase = "playing"; r.party.round = 1;
  const updated = patchPartyRound(r, "u2", 1, r.game, {
    foods: [{ x: 2, y: 3 }], chat: [{ username: "Guest", text: "Hello", at: 123 }],
    "playersState/p2": { x: 4, score: 0, memberId: "wrong" },
    "playersState/p1": { x: 99, memberId: "wrong" }
  });
  assert.deepEqual(updated.foods, [{ x: 2, y: 3 }]); assert.equal(updated.chat[0].text, "Hello");
  assert.equal(updated.playersState.p2.x, 4); assert.equal(updated.playersState.p2.memberId, "u2");
  assert.equal(updated.playersState.p1.x, 1); assert.equal(r.playersState.p2.x, 2);
  assert.equal(patchPartyRound({ ...r, game: "online-bomb-tag" }, "u2", 1, "online-bomb-tag", { foods: [] }).foods, undefined);
});
