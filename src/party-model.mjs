export const PARTY_GAMES = ["online-bomb-tag", "online-dead-route", "online-snake", "online-catcher", "online-pong", "online-tanks", "online-tag", "online-soccer", "online-maze", "online-battle"];
export const PARTY_MAPS = ["park", "rooftops", "factory"];
const slots = ["p1", "p2", "p3", "p4", "p5"];
export function partyMembers(room) {
  return slots.filter(slot => room?.members?.[slot] && room?.playersState?.[slot]?.memberId === room.members[slot]).map(slot => ({ slot, id: room.members[slot], name: String(room.playersState[slot].username || slot).slice(0, 24) }));
}
export function partyBallots(room) {
  const counts = Object.fromEntries(PARTY_GAMES.map(game => [game, 0])), maps = Object.fromEntries(PARTY_MAPS.map(map => [map, 0]));
  for (const member of partyMembers(room)) {
    const vote = room.party?.votes?.[member.slot];
    if (vote?.memberId !== member.id) continue;
    if (PARTY_GAMES.includes(vote.game)) counts[vote.game]++;
    if (PARTY_MAPS.includes(vote.map)) maps[vote.map]++;
  }
  const winner = (list, tally) => list.reduce((a, b) => tally[b] > tally[a] ? b : a, list[0]);
  return { game: winner(PARTY_GAMES, counts), map: winner(PARTY_MAPS, maps), counts, maps };
}
export function partyReady(room) {
  const members = partyMembers(room);
  return members.length >= 2 && members.every(member => room.party?.ready?.[member.slot] === member.id);
}
export function changeParty(room, actor, action, payload = {}, now = Date.now()) {
  const members = partyMembers(room), member = members.find(m => m.id === actor);
  if (!room?.createdBy || !member || !room.party?.enabled) return;
  const next = { ...room, party: { ...room.party, ready: { ...room.party.ready }, votes: { ...room.party.votes } }, updatedAt: now };
  const host = room.createdBy === actor && member.slot === "p1";
  if (action === "lobby") {
    if (!host || room.party.phase === "lobby") return;
    next.party.phase = "lobby"; next.party.ready = {}; next.party.votes = {}; next.status = "waiting";
  } else if (action === "ready") {
    if (room.party.phase !== "lobby") return;
    if (payload.ready === true) next.party.ready[member.slot] = actor; else delete next.party.ready[member.slot];
  } else if (action === "vote") {
    if (room.party.phase !== "lobby" || !PARTY_GAMES.includes(payload.game) || !PARTY_MAPS.includes(payload.map)) return;
    next.party.votes[member.slot] = { memberId: actor, game: payload.game, map: payload.map };
    // A changed vote invalidates readiness so nobody launches into a surprise selection.
    next.party.ready = {};
  } else if (action === "start") {
    if (!host || room.party.phase !== "lobby" || !partyReady(room)) return;
    const ballot = partyBallots(room);
    next.party.phase = "playing"; next.party.round = Math.min(1000000, (Number.isSafeInteger(room.party.round) ? room.party.round : 0) + 1);
    next.party.selectedGame = ballot.game; next.party.selectedMap = ballot.map; next.party.ready = {}; next.status = "playing";
  } else return;
  return next;
}

export function patchPartyRound(room, actor, round, game, patch) {
  const member = partyMembers(room).find(m => m.id === actor);
  if (!member || room.party?.phase !== "playing" || room.party.round !== round || room.game !== game) return;
  const next = { ...room, playersState: { ...room.playersState } };
  const shared = ["updatedAt", "route", "foods", "food", "apples", "apple", "ball", "tagger", "goal", "orb", "poweredSlot", "bomb"];
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split("/");
    if (path === "chat" && Array.isArray(value)) {
      next.chat = value.slice(-30).filter(message => message && typeof message.text === "string" && typeof message.username === "string").map(message => ({ text: message.text.slice(0, 80), username: message.username.slice(0, 24), at: Number.isFinite(message.at) ? message.at : 0 }));
    } else if (parts.length === 1 && shared.includes(path) && (path === "updatedAt" || member.slot === "p1" || (game === "online-snake" && ["food", "foods"].includes(path)))) { if (value === null) delete next[path]; else next[path] = value; }
    else if (parts.length === 2 && parts[0] === "playersState" && parts[1] === member.slot && value && typeof value === "object" && !Array.isArray(value)) {
      next.playersState[member.slot] = { ...value, memberId: member.id };
    }
    else if (parts.length === 3 && parts[0] === "playersState" && slots.includes(parts[1]) && /^[a-zA-Z][a-zA-Z0-9]*$/.test(parts[2]) && !["constructor", "prototype", "__proto__", "memberId"].includes(parts[2]) && (parts[1] === member.slot || member.slot === "p1") && room.members[parts[1]]) {
      next.playersState[parts[1]] = { ...next.playersState[parts[1]] };
      if (value === null) delete next.playersState[parts[1]][parts[2]]; else next.playersState[parts[1]][parts[2]] = value;
    }
  }
  return next;
}
