import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { EMOTES, ownsEmote, emotePose } from "../src/avatar-emotes.mjs";

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

test("three starter emotes stay free and paid catalog matches the shop exactly", () => {
  const { ctx } = fixture();
  assert.deepEqual(EMOTES.filter(e => !e.cost).map(e => e.id), ["bounce", "spin", "bow"]);
  for (const emote of EMOTES.filter(e => e.cost)) {
    const item = ctx.catalog.find(item => item.value === emote.id); assert.equal(item.cost, emote.cost); assert.equal(item.id, `emote-${emote.id}`);
    assert.equal(ownsEmote(emote.id), false); assert.equal(ownsEmote(emote.id, [emote.id]), true);
  }
  assert.equal(ownsEmote("unknown", ["unknown"]), false);
});

test("all six animations are finite, bounded and return to a neutral pose", () => {
  for (const emote of EMOTES) {
    for (let t = 0; t < 2.4; t += 0.025) { const pose = emotePose(emote.id, t); assert.ok(Object.values(pose).every(Number.isFinite)); assert.ok(Math.abs(pose.y) <= 0.5 && pose.squash >= 0.8 && pose.squash <= 1.2); }
    assert.deepEqual(emotePose(emote.id, 3), { y: 0, yaw: 0, tilt: 0, squash: 1 });
  }
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
