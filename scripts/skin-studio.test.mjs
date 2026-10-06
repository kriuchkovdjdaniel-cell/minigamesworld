import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { paintStroke, fillPixels, transformPixels, createHistory } from "../src/skin-studio-model.mjs";

test("fast strokes interpolate every pixel without introducing holes or changing skin size", () => {
  const result = paintStroke("0".repeat(4096), 64, [0, 0], [63, 63], "2");
  assert.equal(result.length, 4096);
  for (let i = 0; i < 64; i++) assert.equal(result[i * 64 + i], "2");
  assert.match(result, /^[02]+$/);
});

test("16/32 pixel grids paint opaque blocks in the canonical 64x64 texture", () => {
  for (const resolution of [16, 32, 64]) {
    const result = paintStroke("0".repeat(4096), 64, [1, 1], [1, 1], "3", 1, false, resolution);
    assert.equal([...result].filter(p => p === "3").length, (64 / resolution) ** 2);
    assert.equal(result.length, 4096);
  }
});

test("mirrored brushes stay inside the texture even at corners", () => {
  const result = paintStroke("0".repeat(256), 16, [0, 0], [0, 0], "4", 4, true);
  assert.equal(result.length, 256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.equal(result[y * 16 + x], result[y * 16 + 15 - x]);
  assert.match(result, /^[04]+$/);
});

test("fill respects connected boundaries, does not wrap rows, and fills transparent accessories", () => {
  assert.equal(fillPixels("0101010101010101", 4, 0, 0, "2"), "2101210121012101");
  assert.equal(fillPixels("1110011111111111", 4, 3, 0, "2"), "1112011111111111");
  assert.equal(fillPixels(".".repeat(256), 16, 5, 4, "1"), "1".repeat(256));
  assert.equal(fillPixels("0".repeat(4096), 64, 0, 0, "0"), "0".repeat(4096));
});

test("flips and quarter turns are reversible and preserve every pixel", () => {
  const data = "012345678";
  for (const action of ["flip-h", "flip-v"]) assert.equal(transformPixels(transformPixels(data, 3, action), 3, action), data);
  let rotated = data;
  for (let i = 0; i < 4; i++) rotated = transformPixels(rotated, 3, "rotate");
  assert.equal(rotated, data);
});

test("history is bounded, ignores no-op strokes, and discards redo after a new edit", () => {
  const history = createHistory(2);
  history.commit("a", "a"); assert.equal(history.canUndo, false);
  history.commit("a", "b"); history.commit("b", "c"); history.commit("c", "d");
  assert.equal(history.undo("d"), "c"); assert.equal(history.undo("c"), "b");
  assert.equal(history.canUndo, false); assert.equal(history.redo("b"), "c");
  history.commit("c", "e"); assert.equal(history.canRedo, false);
  history.clear(); assert.equal(history.canUndo, false);
});

test("studio stays lazy-loaded, ships in both builds and keeps canonical save validators", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /import\("\.\/assets\/skin-studio.js"\)/);
  assert.match(html, /mode === "skin" && sanitizePixelSkin64\(value\)/);
  assert.match(html, /mode === "accessory" && hasAccessoryStudioAccess\(\) && sanitizeAccessory16\(value\)/);
  assert.doesNotMatch(html, /renderPixelSkinGrid\(null, true\)/);
  for (const file of ["prepare-vercel.mjs", "prepare-tauri.mjs", "serve.mjs"]) {
    const content = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(content.includes("assets/skin-studio.js")); assert.ok(content.includes("assets/skin-studio.css"));
  }
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function loadFunction(name, context) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([^]*?^      }`, "m"));
  assert.ok(match);
  new Script(match[0]).runInContext(context);
}

test("failed equips never change local appearance or discard the draft", async () => {
  for (const action of ["equipPixelSkin", "equipAccessory"]) {
    const context = createContext({
      currentAccount: { username: "tester" }, currentUserData: {}, playerStyle: { skin: "classic", accessory: "cap" },
      pixelSkinDirty: true, accessoryDirty: true, skinAccessorySelect: { value: "custom" },
      getPixelSkinDraft: () => "2".repeat(4096), sanitizePixelSkin64: value => value,
      refreshCurrentUserData: async () => ({}), normalizeAccessory: value => value,
      getAccessoryDraft: () => "4".repeat(256), sanitizeAccessory16: value => value,
      patchCurrentUser: async () => { throw new Error("Offline"); },
      savePlayerStyle() { throw new Error("Must not save appearance before the server accepts it"); }
    });
    loadFunction(action, context);
    await assert.rejects(context[action](), /Offline/);
    assert.equal(context.playerStyle.skin, "classic"); assert.equal(context.playerStyle.accessory, "cap");
    assert.equal(context.pixelSkinDirty, true); assert.equal(context.accessoryDirty, true);
  }
});

test("save actions prevent duplicate submissions and recover their controls after failure", async () => {
  let reject, count = 0, message;
  const states = [];
  const context = createContext({ skinStudioSaving: false, skinStudioEditor: { setBusy: value => states.push(value) }, setSkinStudioMessage: value => { message = value; } });
  loadFunction("runSkinStudioAction", context);
  const action = () => { count++; return new Promise((resolve, fail) => { reject = fail; }); };
  const pending = context.runSkinStudioAction(action);
  await context.runSkinStudioAction(action);
  assert.equal(count, 1);
  reject(new Error("Offline")); await pending;
  assert.deepEqual(states, [true, false]); assert.equal(context.skinStudioSaving, false);
  assert.match(message, /draft is still here/);
});

test("custom accessory saving still requires VIP or Premium", async () => {
  let writes = 0, message;
  const context = createContext({ currentAccount: { username: "tester" }, refreshCurrentUserData: async () => ({}), hasAccessoryStudioAccess: () => false, patchCurrentUser: async () => { writes++; }, setSkinStudioMessage: value => { message = value; } });
  loadFunction("saveAccessory", context); await context.saveAccessory();
  assert.equal(writes, 0); assert.match(message, /VIP or Premium/);
});
