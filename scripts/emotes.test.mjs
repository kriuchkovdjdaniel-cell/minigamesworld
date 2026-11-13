import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { EMOTES, ownsEmote, emotePose, wheelSlots, setWheelSlot } from "../src/avatar-emotes.mjs";
import { SECRET_IDS, claimAdventureReward, recordAdventure } from "../src/adventure-model.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function fixture(coins = 1000) {
  let stored = { username: "Buyer", coins, flameCoins: 22, ownedItems: { "skin-round": true }, untouched: "keep" }, calls = 0, fault = false, wait = null;
  const snapshot = () => ({ val: () => structuredClone(stored), exists: () => stored !== null });
  const ctx = createContext({ currentAccount: { username: "Buyer" }, currentUserData: structuredClone(stored), pendingEmotePurchases: new Map(), mgwTopCoins: { textContent: "1000" },
    ensureFirebaseSession: async () => {}, normalizeUserProgress: user => structuredClone(user),
    firebaseDb: { ref: path => { assert.equal(path, "users/buyer"); return {
      once: async () => snapshot(),
      transaction: async update => {
        calls++; if (wait) await wait; if (fault) throw new Error("Connection lost");
        const next = update(structuredClone(stored)); if (next) stored = structuredClone(next);
        return { committed: !!next, snapshot: snapshot() };
      }
    }; } }
  });
  ctx.getUserKeyFromAccount = () => ctx.currentAccount?.username?.toLowerCase() || "";
  new Script(html.match(/const emoteShopItems = \[[^]*?^      \];/m)[0] + "\nglobalThis.catalog = emoteShopItems;").runInContext(ctx);
  for (const name of ["emotePurchaseUpdate", "getOwnedEmotes", "getEmoteInventory", "buyEmote"]) new Script(html.match(new RegExp(`(?:async )?function ${name}\\([^]*?^      }`, "m"))[0]).runInContext(ctx);
  return { ctx, data: () => stored, calls: () => calls, fail: value => { fault = value; }, hold: promise => { wait = promise; }, missing: () => { stored = null; } };
}

test("three free, five paid and one earned emote have distinct ownership rules", () => {
  const { ctx } = fixture();
  assert.deepEqual(EMOTES.filter(e => e.cost === 0).map(e => e.id), ["bounce", "spin", "bow"]);
  assert.equal(ctx.catalog.length, 5); assert.equal(EMOTES.length, 9);
  for (const emote of EMOTES.filter(e => e.cost)) {
    const item = ctx.catalog.find(item => item.value === emote.id); assert.equal(item.cost, emote.cost); assert.equal(item.id, `emote-${emote.id}`);
    assert.equal(ownsEmote(emote.id), false); assert.equal(ownsEmote(emote.id, [emote.id]), true);
  }
  assert.equal(ownsEmote("unknown", ["unknown"]), false);
  assert.equal(ownsEmote("levitate"), false); assert.equal(ownsEmote("levitate", ["levitate"]), true);
  assert.equal(ownsEmote("groove", null), false);
  assert.equal(ctx.catalog.some(item => item.value === "levitate"), false);
  assert.match(EMOTES.find(e => e.id === "levitate").source, /10 secret relics/);
});

test("all nine animations are finite, bounded and return to a neutral pose", () => {
  for (const emote of EMOTES) {
    for (let t = 0; t < 2.4; t += 0.025) { const pose = emotePose(emote.id, t); assert.ok(Object.values(pose).every(Number.isFinite)); assert.ok(Math.abs(pose.y) <= 0.5 && pose.squash >= 0.8 && pose.squash <= 1.2); }
    assert.deepEqual(emotePose(emote.id, 3), { y: 0, yaw: 0, tilt: 0, squash: 1 });
  }
});

test("six favorite positions contain only unique owned emotes, with empty unfilled slots", () => {
  for (const owned of [[], ["shuffle"], ["levitate", "sway"], EMOTES.map(e => e.id)]) {
    for (const value of [null, {}, "spin", [], ["unknown", "spin", "spin", null, 4], EMOTES.map(e => e.id)]) {
      const slots = wheelSlots(value, owned), assigned = slots.filter(Boolean);
      assert.equal(slots.length, 6); assert.equal(new Set(assigned).size, assigned.length);
      assert.equal(assigned.length, Math.min(6, 3 + owned.filter(id => !ownsEmote(id)).length));
      assert.ok(assigned.every(id => ownsEmote(id, owned)));
      assert.deepEqual(wheelSlots(slots, owned), slots);
    }
  }
  assert.deepEqual(wheelSlots(), ["bounce", "spin", "bow", "", "", ""]);
  assert.equal(wheelSlots(["levitate", "shuffle", "sway"], ["levitate"])[0], "levitate");
  assert.ok(!wheelSlots(["levitate", "shuffle", "sway"]).includes("levitate"));
});

test("moving a favorite swaps existing slots without duplicates or changing the input", () => {
  const owned = EMOTES.map(e => e.id), original = wheelSlots(null, owned); let slots = original;
  for (const emote of EMOTES) for (let index = 0; index < 6; index++) {
    slots = setWheelSlot(slots, index, emote.id, owned);
    assert.equal(slots[index], emote.id); assert.equal(new Set(slots).size, 6);
  }
  assert.deepEqual(original, wheelSlots(null, owned));
  assert.deepEqual(setWheelSlot(original, 0, "spin", owned), ["spin", "bounce", "bow", "groove", "twirl", "flip"]);
  assert.deepEqual(setWheelSlot(original, 0, "unknown", owned), original);
  assert.deepEqual(setWheelSlot(original, -1, "spin", owned), original);
  assert.deepEqual(setWheelSlot(original, 6, "spin", owned), original);
  assert.deepEqual(setWheelSlot([], 0, "levitate"), wheelSlots());
  assert.deepEqual(setWheelSlot([], 5, "spin"), ["bounce", "", "bow", "", "", "spin"]);
});

test("Levitate is earned at ten distinct relics, not nine or duplicate finds", () => {
  let adventure = {};
  for (const id of SECRET_IDS.slice(0, 9)) adventure = recordAdventure(adventure, { type: "secret", id });
  adventure = recordAdventure(adventure, { type: "secret", id: SECRET_IDS[0] });
  const user = { coins: 3000, ownedItems: { "emote-shuffle": true }, adventure };
  assert.equal(claimAdventureReward(user, "explorer-10"), undefined);
  user.adventure = recordAdventure(adventure, { type: "secret", id: SECRET_IDS[9] });
  const earned = claimAdventureReward(user, "explorer-10");
  assert.equal(earned.ownedItems["emote-levitate"], true);
  assert.equal(earned.ownedItems["emote-shuffle"], true); assert.equal(earned.coins, 3000);
  assert.equal(user.ownedItems["emote-levitate"], undefined);
  assert.equal(claimAdventureReward(earned, "explorer-10"), undefined);
});

test("Shuffle and Sway debit their paid prices without granting Levitate", async () => {
  const f = fixture(1450);
  await f.ctx.buyEmote("shuffle"); assert.equal(f.data().coins, 800);
  await f.ctx.buyEmote("sway"); assert.equal(f.data().coins, 0);
  assert.equal(f.data().ownedItems["emote-shuffle"], true); assert.equal(f.data().ownedItems["emote-sway"], true);
  assert.equal(f.data().ownedItems["emote-levitate"], undefined);
});

test("Levitate cannot be coin-bought and only an explicit earned claim grants ownership", async () => {
  const f = fixture(100000);
  assert.equal(f.ctx.emotePurchaseUpdate(f.data(), "levitate"), undefined);
  await assert.rejects(f.ctx.buyEmote("levitate")); assert.equal(f.calls(), 0);
  assert.equal(f.ctx.getOwnedEmotes().includes("levitate"), false);
  f.ctx.currentUserData.ownedItems["emote-levitate"] = true;
  assert.equal(f.ctx.getOwnedEmotes().includes("levitate"), true);
  f.ctx.currentUserData.ownedItems["emote-levitate"] = "true";
  assert.equal(f.ctx.getOwnedEmotes().includes("levitate"), false);
});

test("purchase update refuses malformed balances, duplicates and unknown emotes", () => {
  const { ctx } = fixture();
  for (const coins of [0, 199, -1, NaN, Infinity, "1000", 200.5]) assert.equal(ctx.emotePurchaseUpdate({ coins }, "groove"), undefined);
  assert.equal(ctx.emotePurchaseUpdate(null, "groove"), undefined);
  assert.equal(ctx.emotePurchaseUpdate({ coins: 1000 }, "unknown"), undefined);
  assert.equal(ctx.emotePurchaseUpdate({ coins: 1000, ownedItems: { "emote-groove": true } }, "groove"), undefined);
  const user = { coins: 200, flameCoins: 50, ownedItems: { hat: true } }, update = ctx.emotePurchaseUpdate(user, "groove");
  assert.equal(update.coins, 0); assert.equal(update.flameCoins, 50); assert.equal(update.ownedItems.hat, true); assert.equal(user.coins, 200); assert.equal(user.ownedItems["emote-groove"], undefined);
});

test("concurrent clicks charge once and repeat purchases never debit again", async () => {
  const f = fixture(); await Promise.all([f.ctx.buyEmote("groove"), f.ctx.buyEmote("groove")]);
  assert.equal(f.calls(), 1); assert.equal(f.data().coins, 800); assert.equal(f.data().ownedItems["emote-groove"], true);
  await f.ctx.buyEmote("groove"); assert.equal(f.data().coins, 800); assert.equal(f.data().flameCoins, 22); assert.equal(f.data().untouched, "keep");
  assert.ok(f.ctx.getOwnedEmotes().includes("groove")); assert.equal(f.ctx.pendingEmotePurchases.size, 0);
});

test("different purchases competing for one balance cannot overdraw it", async () => {
  const f = fixture(500); const results = await Promise.allSettled([f.ctx.buyEmote("groove"), f.ctx.buyEmote("twirl")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.data().coins, 300); assert.equal(f.data().ownedItems["emote-twirl"], undefined);
});

test("failed saves grant nothing and can retry, while guests and missing accounts cannot buy", async () => {
  const f = fixture(); f.fail(true); await assert.rejects(f.ctx.buyEmote("flip"), /Connection lost/);
  assert.equal(f.data().coins, 1000); assert.equal(f.ctx.currentUserData.ownedItems["emote-flip"], undefined); assert.equal(f.ctx.pendingEmotePurchases.size, 0);
  f.fail(false); await f.ctx.buyEmote("flip"); assert.equal(f.data().coins, 500);
  f.ctx.currentAccount = null; await assert.rejects(f.ctx.buyEmote("groove"), /Sign in/);
  const missing = fixture(); missing.missing(); await assert.rejects(missing.ctx.buyEmote("groove"), /unavailable/);
});

test("an old inventory or delayed purchase cannot grant another account an emote", async () => {
  const f = fixture(), inventory = f.ctx.getEmoteInventory(); let release;
  f.hold(new Promise(resolve => { release = resolve; })); const buying = f.ctx.buyEmote("groove");
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.calls(), 1);
  f.ctx.currentAccount = { username: "Other" }; f.ctx.currentUserData = { coins: 9, ownedItems: {} }; release(); await buying;
  assert.equal(f.ctx.currentUserData.coins, 9); assert.deepEqual(Array.from(inventory.getOwned()), ["bounce", "spin", "bow"]);
  await assert.rejects(inventory.buy("twirl"), /Account changed/);
});
