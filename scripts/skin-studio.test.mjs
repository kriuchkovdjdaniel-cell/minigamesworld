import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { paintStroke, fillPixels, transformPixels, createHistory } from "../src/skin-studio-model.mjs";
import { createCustomAccessory } from "../src/skin-studio-accessory.mjs";
import { Color, Matrix4 } from "three";

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

const palette = ["#04130f", "#f8fafc", "#5eead4", "#22c55e", "#facc15", "#8b5cf6", "#fb7185", "#38bdf8"];
const disposeAccessory = mesh => { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); };

test("a fully painted accessory is solid, bounded, and rests on the cube instead of intersecting it", () => {
  const mesh = createCustomAccessory("7".repeat(256), palette);
  assert.equal(mesh.count, 256);
  const { min, max } = mesh.boundingBox;
  assert.ok(Math.abs(min.y - 1) < 1e-6);
  assert.ok(max.y <= 2.361 && min.x >= -0.681 && max.x <= 0.681);
  assert.ok(max.z - min.z > 0.27);
  const color = new Color(); mesh.getColorAt(0, color);
  assert.equal(color.getHexString(), "38bdf8");
  disposeAccessory(mesh);
});

test("transparent padding does not float, enlarge or offset sparse accessories", () => {
  const pixels = Array(256).fill("."); pixels[0] = "2"; pixels[16] = "4";
  const mesh = createCustomAccessory(pixels.join(""), palette);
  assert.equal(mesh.count, 2);
  assert.ok(Math.abs(mesh.boundingBox.min.y - 1) < 1e-6);
  assert.ok(Math.abs(mesh.boundingBox.min.x + mesh.boundingBox.max.x) < 1e-6);
  const top = new Matrix4(), bottom = new Matrix4();
  mesh.getMatrixAt(0, top); mesh.getMatrixAt(1, bottom);
  assert.ok(top.elements[13] > bottom.elements[13]);
  assert.ok(mesh.boundingBox.max.y < 1.18);
  disposeAccessory(mesh);
  assert.equal(createCustomAccessory(".".repeat(256), palette), null);
});

test("accessory holes remain empty and palette edits reach the solid preview", () => {
  const pixels = "7777" + ".".repeat(248) + "7777";
  const changedPalette = [...palette]; changedPalette[7] = "#ff2080";
  const mesh = createCustomAccessory(pixels, changedPalette);
  assert.equal(mesh.count, 8);
  const color = new Color(); mesh.getColorAt(7, color);
  assert.equal(color.getHexString(), "ff2080");
  disposeAccessory(mesh);
});

function paletteContext(patchCurrentUser) {
  const renders = [];
  const context = createContext({
    currentAccount: { username: "tester" }, currentUserData: {},
    getUserKeyFromAccount: () => "tester", patchCurrentUser,
    pixelSkinPalette: [...palette], customRgbColors: [],
    playerStyle: { customPalette: [...palette] }, onlineState: null, onlinePlayerSlot: "",
    normalizeCustomPalette: value => [...value], normalizeCustomColors: value => [...new Set(value)].slice(0, 24),
    savePlayerStyle: () => renders.push("save"), renderPixelSkinGrid: () => renders.push("skin"),
    renderAccessoryControls: () => renders.push("accessory"), draw: () => renders.push("draw")
  });
  loadFunction("persistStudioPalette", context);
  return { context, renders };
}

test("failed palette saves leave existing skin/accessory colors and custom swatches unchanged", async () => {
  const { context, renders } = paletteContext(async () => { throw new Error("Offline"); });
  await assert.rejects(context.persistStudioPalette(palette.map(() => "#ff0000"), ["#ff0000"]), /Offline/);
  assert.deepEqual(context.pixelSkinPalette, palette);
  assert.deepEqual(context.playerStyle.customPalette, palette);
  assert.deepEqual(context.customRgbColors, []); assert.deepEqual(renders, []);
});

test("accepted palette saves update both editors and persist only after cloud acceptance", async () => {
  let accept;
  const { context, renders } = paletteContext(() => new Promise(resolve => { accept = resolve; }));
  const changed = [...palette]; changed[7] = "#ee8844";
  const pending = context.persistStudioPalette(changed, ["#ee8844"]);
  assert.deepEqual(context.pixelSkinPalette, palette); assert.deepEqual(renders, []);
  accept(); await pending;
  assert.deepEqual(context.pixelSkinPalette, changed);
  assert.deepEqual(context.customRgbColors, ["#ee8844"]);
  assert.deepEqual(renders, ["save", "skin", "accessory", "draw"]);
});

test("guest palettes stay usable without a network or account", async () => {
  const { context, renders } = paletteContext(() => { throw new Error("Guest must not write to cloud"); });
  context.currentAccount = null; context.getUserKeyFromAccount = () => "";
  await context.persistStudioPalette(palette, ["#123456"]);
  assert.deepEqual(context.customRgbColors, ["#123456"]);
  assert.deepEqual(renders, ["save", "skin", "accessory", "draw"]);
});

test("a late palette save cannot replace a different account's local colors", async () => {
  let accept;
  const { context, renders } = paletteContext(() => new Promise(resolve => { accept = resolve; }));
  const pending = context.persistStudioPalette(palette.map(() => "#000000"), []);
  context.getUserKeyFromAccount = () => "another-player";
  accept(); await assert.rejects(pending, /Account changed/);
  assert.deepEqual(context.pixelSkinPalette, palette); assert.deepEqual(renders, []);
});

test("picker captures drags, releases cancellation, and escapes a black brightness value", () => {
  const captures = new Set(); const moves = [];
  const context = createContext({
    rgbPickerPointer: null, selectedPaletteHsv: { h: 0, s: 0, v: 0 },
    rgbColorMap: { setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) },
    updateRgbFromMapEvent: event => moves.push(event.pointerId)
  });
  for (const name of ["startRgbPicker", "continueRgbPicker", "stopRgbPicker"]) loadFunction(name, context);
  context.startRgbPicker({ button: 0, pointerId: 1, preventDefault() {} });
  assert.equal(context.selectedPaletteHsv.v, 1); assert.ok(captures.has(1));
  context.continueRgbPicker({ pointerId: 2 }); context.stopRgbPicker({ pointerId: 2 });
  assert.equal(context.rgbPickerPointer, 1); assert.deepEqual(moves, [1]);
  context.continueRgbPicker({ pointerId: 1 }); context.stopRgbPicker({ pointerId: 1 });
  assert.equal(context.rgbPickerPointer, null); assert.equal(captures.size, 0);
  context.continueRgbPicker({ pointerId: 1 }); assert.deepEqual(moves, [1, 1]);
});

test("invalid hex entries never save the previous color by accident", async () => {
  for (const name of ["saveRgbPaletteColor", "addRgbCustomColor"]) {
    let message;
    const context = createContext({
      rgbHexInput: { value: "#zzzzzz" },
      sanitizeHexColor: value => /^#[0-9a-f]{6}$/i.test(value) ? value : "",
      setSkinStudioMessage: value => { message = value; },
      persistStudioPalette: () => { throw new Error("Must not persist invalid color"); }
    });
    loadFunction(name, context); await context[name]();
    assert.match(message, /valid RGB color/);
  }
});
