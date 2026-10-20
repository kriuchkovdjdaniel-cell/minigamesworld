import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const expected3d = ["dead-route-3d", "crystal-isles-3d", "catcher", "dodger", "coin-rush", "laser-dodge", "online-bomb-tag"];
function library() {
  let focus = "", scrolls = 0;
  const node = (id = "") => ({ hidden: false, textContent: "", dataset: {}, setAttribute(key, value) { this[key] = value; }, focus() { focus = id; }, scrollIntoView() { scrolls++; } });
  const ids = Object.fromEntries(["gameLibrary", "gameFolderBack", "gameLibraryTitle", "gameLibraryCount", "gameFolders", "gameLibraryGames", "gameLibrarySolo", "gameLibraryOnline", "gameLibrarySoloTitle", "gameLibraryOnlineTitle", "gameLibraryEmpty", "gameLibraryEmptyMessage", "gameLibraryClearSearch"].map(id => [id, node(id)]));
  const buttons = [...html.matchAll(/<button[^>]+data-start-(online-game|game)="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(([, kind, id, title]) => {
    const button = node(id); button.dataset[kind === "game" ? "startGame" : "startOnlineGame"] = id; button.textContent = title; return button;
  });
  const folders = ["3d", "2d"].map(id => {
    const button = node(id), title = node(), count = node();
    button.dataset.gameFolder = id;
    button.querySelector = selector => selector === "strong" ? title : count;
    return button;
  });
  const ctx = createContext({
    activeGameFolder: "", selectedStartMode: "solo", selectedStartGame: "snake", selectedOnlineGame: "online-snake",
    mgwDashboardSearch: { value: "" }, startGamesMenu: { querySelectorAll: () => buttons },
    startSoloGameButtons: buttons.filter(button => button.dataset.startGame),
    startOnlineGameButtons: buttons.filter(button => button.dataset.startOnlineGame),
    currentText: key => ({ games: "Games", allGames: "All Games", folder3d: "3D Games", folder2d: "2D Games", singlePlayer: "Solo Games", online: "Online Games", noMatchingGames: "No matching games.", clearSearch: "Clear Search" })[key],
    document: {
      getElementById: id => ids[id],
      querySelectorAll: () => folders,
      querySelector: selector => selector.startsWith("#gameLibrary")
        ? buttons.find(button => !button.hidden)
        : folders.find(button => selector.includes(`"${button.dataset.gameFolder}"`))
    }
  });
  ctx.selectSoloGameFromStart = id => { ctx.selectedStartGame = id; ctx.selectedStartMode = "solo"; };
  ctx.selectOnlineGameFromStart = (id, open) => { assert.equal(open, false); ctx.selectedOnlineGame = id; ctx.selectedStartMode = "online"; };
  for (const name of ["isThreeGame", "applyDashboardSearch", "setGameFolder"]) {
    new Script(html.match(new RegExp(`function ${name}\\([^]*?^      }`, "m"))[0]).runInContext(ctx);
  }
  const visible = () => buttons.filter(button => !button.hidden).map(button => button.dataset.startGame || button.dataset.startOnlineGame);
  return { ctx, ids, buttons, folders, visible, focus: () => focus, scrolls: () => scrolls };
}

test("the root shows exactly two folders with counts derived from the actual game buttons", () => {
  const { ctx, ids, buttons, folders } = library(); ctx.applyDashboardSearch();
  assert.equal(buttons.length, 18); assert.equal(new Set(buttons.map(b => b.dataset.startGame || b.dataset.startOnlineGame)).size, 18);
  assert.equal(ids.gameFolders.hidden, false); assert.equal(ids.gameLibraryGames.hidden, true); assert.equal(ids.gameFolderBack.hidden, true);
  assert.equal(folders[0].querySelector("[data-folder-count]").textContent, "7 games");
  assert.equal(folders[1].querySelector("[data-folder-count]").textContent, "11 games");
});

test("3D contains all six solo conversions and Online Bomb Tag, with no duplicated buttons", () => {
  const { ctx, ids, visible } = library(); ctx.setGameFolder("3d");
  assert.deepEqual(visible(), expected3d);
  assert.equal(ids.gameLibrarySolo.hidden, false); assert.equal(ids.gameLibraryOnline.hidden, false);
  assert.equal(ids.gameFolders.hidden, true); assert.equal(ids.gameLibraryGames.hidden, false);
  assert.equal(ids.gameLibraryTitle.textContent, "3D Games"); assert.equal(ctx.selectedStartGame, "dead-route-3d");
});

test("2D contains only the remaining games and retains a valid selected game", () => {
  const { ctx, visible } = library(); ctx.setGameFolder("2d");
  assert.equal(visible().length, 11); assert.ok(visible().every(id => !expected3d.includes(id)));
  assert.equal(ctx.selectedStartGame, "snake");
});

test("search from the root finds games across both folders without changing runtime gates", () => {
  const { ctx, ids, visible, folders } = library();
  ctx.mgwDashboardSearch.value = " bOmB "; ctx.applyDashboardSearch();
  assert.deepEqual(visible(), ["online-bomb-tag"]); assert.equal(ids.gameLibraryGames.hidden, false);
  assert.equal(ids.gameFolders.hidden, false); assert.equal(ids.gameLibrarySolo.hidden, true); assert.equal(ids.gameLibraryOnline.hidden, false);
  assert.equal(folders[0].querySelector("[data-folder-count]").textContent, "1 / 7 games");
  assert.equal(folders[1].querySelector("[data-folder-count]").textContent, "0 / 11 games");
});

test("folder search has a clear empty state and clearing it restores that folder", () => {
  const { ctx, ids, visible } = library(); ctx.setGameFolder("2d"); ctx.mgwDashboardSearch.value = "bomb"; ctx.applyDashboardSearch();
  assert.equal(visible().length, 0); assert.equal(ids.gameLibraryEmpty.hidden, false);
  assert.equal(ids.gameLibrarySolo.hidden, true); assert.equal(ids.gameLibraryOnline.hidden, true);
  ctx.mgwDashboardSearch.value = ""; ctx.applyDashboardSearch();
  assert.equal(ctx.activeGameFolder, "2d"); assert.equal(visible().length, 11); assert.equal(ids.gameLibraryEmpty.hidden, true);
});

test("opening a searched folder selects its matching online game without opening or joining a room", () => {
  const { ctx, visible } = library(); ctx.mgwDashboardSearch.value = "bomb"; ctx.setGameFolder("3d");
  assert.deepEqual(visible(), ["online-bomb-tag"]); assert.equal(ctx.selectedOnlineGame, "online-bomb-tag"); assert.equal(ctx.selectedStartMode, "online");
});

test("back preserves the search, restores focus to the folder and invalid folders do nothing", () => {
  const { ctx, ids, focus, scrolls } = library(); ctx.setGameFolder("3d");
  assert.equal(focus(), "gameLibraryTitle"); ctx.mgwDashboardSearch.value = "bomb"; ctx.setGameFolder("");
  assert.equal(focus(), "3d"); assert.equal(ids.gameFolderBack.hidden, true);
  assert.equal(ctx.mgwDashboardSearch.value, "bomb"); assert.equal(ctx.activeGameFolder, "");
  const count = scrolls(); ctx.setGameFolder("unknown"); assert.equal(scrolls(), count); assert.equal(ctx.activeGameFolder, "");
});

test("library markup retains one copy of every control and uses native buttons", () => {
  for (const id of ["gameLibrary", "gameFolders", "gameFolderBack", "gameLibraryGames", "gameLibrarySolo", "gameLibraryOnline", "gameLibraryClearSearch"]) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, "g"))].length, 1);
  assert.equal([...html.matchAll(/<button[^>]+data-game-folder="(?:2d|3d)"/g)].length, 2);
  assert.match(html, /#gameLibrary \[hidden\] \{ display: none !important; \}/);
  assert.match(html, /startGamesButton.addEventListener\("click", \(\) => \{\s*activeGameFolder = "";/);
});
