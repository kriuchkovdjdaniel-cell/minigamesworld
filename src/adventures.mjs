import { createElement, CalendarDays, Gem, Trophy, House, Users, Play, Gift, Plus, LogIn, Check, LogOut } from "lucide";
import { ADVENTURE_GAMES, SECRET_IDS, MASTERY_REWARDS, EXPLORER_REWARDS, normalizeAdventure, rewardProgress, weeklyChallenge } from "./adventure-model.mjs";
import { PARTY_GAMES, PARTY_MAPS, partyMembers, partyReady, partyBallots } from "./party-model.mjs";
import { mountClubhouse } from "./clubhouse.mjs";
import "./adventures.css";
export * from "./adventure-model.mjs";
export * from "./party-model.mjs";
export { mountClubhouse };
const icon = shape => createElement(shape, { width: 20, height: 20, "aria-hidden": "true" });
const names = { "online-bomb-tag": "Bomb Tag", "online-dead-route": "Dead Route Co-op", "online-snake": "Neon Snake", "online-catcher": "Apple Drop", "online-pong": "Pong", "online-tanks": "Tanks", "online-tag": "Tag", "online-soccer": "Soccer", "online-maze": "Maze", "online-battle": "Battle Arena" };
export function mountAdventures(host, options) {
  const abort = new AbortController(), signal = abort.signal; let disposed = false, busy = false, tab = options.tab || "weekly", progress = normalizeAdventure(options.progress);
  host.classList.add("adventure-hub");
  host.innerHTML = '<header class="adventure-heading"><div><h2>Adventures</h2><p data-adventure-summary></p></div></header><nav class="adventure-tabs" aria-label="Adventure views"></nav><div class="adventure-content"></div><p class="adventure-status" role="status"></p>';
  const content = host.querySelector(".adventure-content"), status = host.querySelector(".adventure-status");
  const on = (node, type, fn) => node.addEventListener(type, fn, { signal });
  function command(label, shape, fn) {
    const button = document.createElement("button"); button.type = "button"; button.append(icon(shape), document.createTextNode(label));
    on(button, "click", async () => {
      button.disabled = true;
      try { await fn(); } catch (error) { if (!disposed) status.textContent = error.message || "Could not complete this action. Retry."; }
      finally { if (button.isConnected && !disposed) button.disabled = false; }
    });
    return button;
  }
  async function claim(id) {
    if (busy) return; busy = true; status.textContent = "Saving reward...";
    try { progress = normalizeAdventure(await options.onClaim(id)); if (!disposed) { render(); status.textContent = "Reward unlocked"; } }
    catch (error) { if (!disposed) status.textContent = error.message || "Could not save reward. Retry."; }
    finally { busy = false; }
  }
  for (const [id, label, shape] of [["weekly", "Weekly", CalendarDays], ["secrets", "Relics", Gem], ["mastery", "Mastery", Trophy], ["clubhouse", "Clubhouse", House], ["party", "Party", Users]]) {
    const button = command(label, shape, () => { tab = id; render(); }); button.dataset.adventureTab = id; host.querySelector("nav").append(button);
  }
  function rewardRow(reward) {
    const row = document.createElement("article"); row.className = "adventure-reward";
    const count = rewardProgress(progress, reward), claimed = progress.claims[reward.id];
    const title = document.createElement("h3"); title.textContent = reward.name;
    const metric = document.createElement("p"); metric.textContent = `${Math.min(reward.target, count)} / ${reward.target} ${reward.game ? "stages cleared" : "relics found"}`;
    const meter = document.createElement("progress"); meter.max = reward.target; meter.value = count; meter.setAttribute("aria-label", reward.name);
    const swatch = document.createElement("span"); swatch.className = "adventure-swatch"; if (reward.color) swatch.style.background = reward.color; else swatch.append(icon(Gift));
    const button = command(claimed ? "Claimed" : "Claim Reward", claimed ? Check : Gift, () => claim(reward.id)); button.dataset.reward = reward.id; button.disabled = !!claimed || count < reward.target;
    row.append(swatch, title, metric, meter, button);
    if (claimed && reward.type === "color") row.append(command("Equip", Check, async () => { try { await options.onEquip(reward.item); status.textContent = `${reward.name} equipped`; } catch (error) { status.textContent = error.message; } }));
    return row;
  }
  function render() {
    if (disposed) return;
    host.querySelectorAll("[data-adventure-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.adventureTab === tab)));
    host.querySelector("[data-adventure-summary]").textContent = `${Object.keys(progress.secrets).length} / ${SECRET_IDS.length} relics  |  ${MASTERY_REWARDS.filter(r => rewardProgress(progress, r) === r.target).length} / ${MASTERY_REWARDS.length} masteries`;
    content.replaceChildren(); status.textContent = "";
    if (tab === "weekly") {
      const weekly = weeklyChallenge(), section = document.createElement("section"); section.className = "adventure-weekly";
      const image = document.createElement("img"); image.src = `./assets/${{ "crystal-isles-3d": "crystal-isles-3d", dodger: "gem-dash-3d", "laser-dodge": "laser-escape-3d" }[weekly.game]}.png`; image.alt = ADVENTURE_GAMES[weekly.game].name;
      const text = document.createElement("div"), heading = document.createElement("h3"), desc = document.createElement("p"), reset = document.createElement("p");
      heading.textContent = weekly.name; desc.textContent = `${ADVENTURE_GAMES[weekly.game].name} / Stage ${weekly.level + 1}. ${weekly.description}`; reset.textContent = `Ends ${new Date(weekly.endsAt).toLocaleDateString()} / 150 coins`;
      const play = command(progress.weeks[weekly.id] ? "Play Again" : "Play Challenge", Play, () => options.onPlay(weekly)); play.dataset.weeklyPlay = "";
      const claimButton = command(progress.claims[`weekly-${weekly.id}`] ? "Claimed" : "Claim 150 Coins", Gift, () => claim(`weekly-${weekly.id}`)); claimButton.dataset.weeklyClaim = ""; claimButton.disabled = !progress.weeks[weekly.id] || !!progress.claims[`weekly-${weekly.id}`];
      text.append(heading, desc, reset, play, claimButton); section.append(image, text); content.append(section);
    }
    if (tab === "secrets") {
      const list = document.createElement("div"); list.className = "adventure-relic-list";
      for (const id of SECRET_IDS) { const [game, level] = id.split(":"), row = document.createElement("div"); row.className = "adventure-relic"; row.dataset.found = String(!!progress.secrets[id]); row.append(icon(progress.secrets[id] ? Check : Gem), document.createTextNode(`${ADVENTURE_GAMES[game].name} / Stage ${Number(level) + 1}`)); list.append(row); }
      const rewards = document.createElement("div"); rewards.className = "adventure-rewards"; EXPLORER_REWARDS.forEach(r => rewards.append(rewardRow(r))); content.append(list, rewards);
    }
    if (tab === "mastery") { const list = document.createElement("div"); list.className = "adventure-rewards"; MASTERY_REWARDS.forEach(r => list.append(rewardRow(r))); content.append(list); }
    if (tab === "clubhouse") {
      const heading = document.createElement("h3"); heading.textContent = "Your Clubhouse";
      const tally = document.createElement("p"); tally.textContent = `${MASTERY_REWARDS.filter(r => rewardProgress(progress, r) >= r.target).length} mastery trophies`;
      const open = command("Open Clubhouse", House, options.onClubhouse); open.dataset.openClubhouse = ""; content.append(heading, tally, open);
    }
    if (tab === "party") {
      const section = document.createElement("section"); section.className = "adventure-party-create";
      const title = document.createElement("h3"); title.textContent = "Party Lobby";
      const visibility = document.createElement("select"); visibility.setAttribute("aria-label", "Party visibility"); visibility.append(new Option("Private Party", "private"), new Option("Public Party", "public"));
      const code = document.createElement("input"); code.placeholder = "Room Code"; code.setAttribute("aria-label", "Party room code"); code.maxLength = 8; code.autocomplete = "off";
      const create = command("Create Party", Plus, () => options.onPartyCreate(visibility.value)); create.dataset.createParty = "";
      const join = command("Join Party", LogIn, () => options.onPartyJoin(code.value)); join.dataset.joinParty = "";
      section.append(title, visibility, create, code, join); content.append(section);
    }
  }
  render();
  return { update(value) { progress = normalizeAdventure(value); render(); }, dispose() { disposed = true; abort.abort(); host.replaceChildren(); host.classList.remove("adventure-hub"); } };
}

export function mountPartyLobby(host, room, options) {
  const abort = new AbortController(), signal = abort.signal; let busy = false;
  host.classList.add("adventure-party-lobby"); host.innerHTML = '<header><h2>Party Lobby</h2><strong data-party-code></strong><span data-party-count></span></header><ol class="party-members"></ol><div class="party-vote"><label>Next game <select aria-label="Party game vote"></select></label><label>Bomb Tag map <select aria-label="Party map vote"></select></label><button data-party-vote>Vote</button></div><div class="party-actions"><button data-party-ready></button><button data-party-start>Start Party Game</button><button data-party-leave>Leave Party</button></div><p role="status" data-party-status></p>';
  const members = partyMembers(room), me = members.find(m => m.id === options.playerId), ballot = partyBallots(room), status = host.querySelector("[data-party-status]");
  host.querySelector("[data-party-code]").textContent = options.code; host.querySelector("[data-party-count]").textContent = `${members.length} / 5 players`;
  for (const member of members) { const li = document.createElement("li"); li.append(icon(Users)); const label = document.createElement("strong"); label.textContent = member.name; const ready = document.createElement("span"); ready.textContent = room.party.ready?.[member.slot] === member.id ? "Ready" : "Not ready"; li.append(label, ready); if (member.slot === "p1") li.append(document.createTextNode("Host")); host.querySelector("ol").append(li); }
  const game = host.querySelector('[aria-label="Party game vote"]'), map = host.querySelector('[aria-label="Party map vote"]'), vote = me && room.party.votes?.[me.slot];
  for (const id of PARTY_GAMES) game.append(new Option(`${names[id]} (${ballot.counts[id]})`, id));
  for (const id of PARTY_MAPS) map.append(new Option(`${id[0].toUpperCase() + id.slice(1)} (${ballot.maps[id]})`, id));
  game.value = vote && me && vote.memberId === me.id ? vote.game : ballot.game; map.value = vote && me && vote.memberId === me.id ? vote.map : ballot.map;
  const isReady = !!me && room.party.ready?.[me.slot] === me.id, ready = host.querySelector("[data-party-ready]"), start = host.querySelector("[data-party-start]");
  ready.textContent = isReady ? "Not Ready" : "Ready"; ready.setAttribute("aria-pressed", String(isReady)); ready.prepend(icon(Check)); start.prepend(icon(Play)); host.querySelector("[data-party-leave]").prepend(icon(LogOut));
  start.hidden = room.createdBy !== options.playerId; start.disabled = !partyReady(room); status.textContent = members.length < 2 ? "Waiting for another player" : `${names[ballot.game]} leads the vote`;
  async function action(type, payload) { if (busy) return; busy = true; try { await options.onAction(type, payload); } catch (error) { status.textContent = error.message || "Room update failed"; } finally { busy = false; } }
  ready.addEventListener("click", () => action("ready", { ready: !isReady }), { signal }); start.addEventListener("click", () => action("start"), { signal });
  host.querySelector("[data-party-vote]").addEventListener("click", () => action("vote", { game: game.value, map: map.value }), { signal });
  host.querySelector("[data-party-leave]").addEventListener("click", options.onLeave, { signal });
  return { dispose() { abort.abort(); host.replaceChildren(); host.classList.remove("adventure-party-lobby"); } };
}
