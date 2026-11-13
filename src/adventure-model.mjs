export const ADVENTURE_GAMES = {
  "crystal-isles-3d": { name: "Crystal Isles", stages: 4 }, dodger: { name: "Gem Dash", stages: 3 },
  "laser-dodge": { name: "Laser Escape", stages: 3 }, catcher: { name: "Apple Drop", stages: 3 },
  "coin-rush": { name: "Coin Dash", stages: 3 }, "coastline-karts": { name: "Coastline Karts", stages: 3 },
  "dead-route-3d": { name: "Dead Route", stages: 1 }
};
export const SECRET_IDS = ["crystal-isles-3d", "dodger", "coin-rush"].flatMap(game => Array.from({ length: ADVENTURE_GAMES[game].stages }, (_, level) => `${game}:${level}`));
export const MASTERY_REWARDS = Object.entries(ADVENTURE_GAMES).map(([game, meta], i) => ({
  id: `mastery-${game}`, game, name: `${meta.name} Master`, item: `color-mastery-${i}`, type: "color", value: `mastery-${i}`,
  color: ["#9bcbb4", "#b8a0d9", "#dfb7c6", "#d9c58d", "#91bdca", "#c5d3ac", "#a3b5c5"][i], target: meta.stages
}));
export const EXPLORER_REWARDS = [
  { id: "explorer-3", name: "Relic Jade", target: 3, item: "color-relic", type: "color", value: "relic", color: "#77c6ad" },
  { id: "explorer-10", name: "Levitate Emote", target: 10, item: "emote-levitate", type: "emote", value: "levitate" }
];
export function weekId(now = Date.now()) {
  const date = new Date(now); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function weeklyChallenge(now = Date.now()) {
  const week = weekId(now), number = Math.floor(Date.parse(week) / 604800000), index = ((number % 3) + 3) % 3;
  const cycle = Math.floor(number / 3), stage = count => ((cycle % count) + count) % count;
  const variants = [
    { game: "crystal-isles-3d", name: "Moonlight Leap", modifier: "low-gravity", description: "Clear the course with low gravity.", level: stage(4) },
    { game: "laser-dodge", name: "Last Heart", modifier: "one-life", description: "Survive the arena with one life.", level: stage(3) },
    { game: "dodger", name: "Overclocked Vault", modifier: "fast-guards", description: "Collect every gem while patrols move faster.", level: stage(3) }
  ];
  return { ...variants[index], id: week, reward: 150, endsAt: Date.parse(week) + 604800000 };
}
export function normalizeAdventure(value = {}) {
  const secrets = {}, clears = {}, weeks = {}, claims = {};
  for (const id of SECRET_IDS) if (value?.secrets?.[id] === true) secrets[id] = true;
  for (const [game, meta] of Object.entries(ADVENTURE_GAMES)) {
    const stages = {};
    for (let i = 0; i < meta.stages; i++) {
      const result = value?.clears?.[game]?.[i];
      if (result && Number.isFinite(result.seconds) && result.seconds > 0 && result.seconds <= 86400) stages[i] = { seconds: result.seconds, flawless: result.flawless === true };
    }
    if (Object.keys(stages).length) clears[game] = stages;
  }
  for (const [id, complete] of Object.entries(value?.weeks || {}).slice(-104)) if (/^20\d{2}-\d{2}-\d{2}$/.test(id) && complete === true) weeks[id] = true;
  for (const [id, claimed] of Object.entries(value?.claims || {})) if (claimed === true && (MASTERY_REWARDS.some(r => r.id === id) || EXPLORER_REWARDS.some(r => r.id === id) || /^weekly-20\d{2}-\d{2}-\d{2}$/.test(id))) claims[id] = true;
  return { version: 1, secrets, clears, weeks, claims };
}
export function mergeAdventure(a, b) {
  const left = normalizeAdventure(a), right = normalizeAdventure(b), clears = { ...left.clears };
  for (const [game, stages] of Object.entries(right.clears)) {
    clears[game] = { ...clears[game] };
    for (const [level, result] of Object.entries(stages)) {
      const old = clears[game][level];
      clears[game][level] = { seconds: Math.min(old?.seconds ?? Infinity, result.seconds), flawless: old?.flawless === true || result.flawless };
    }
  }
  return normalizeAdventure({ secrets: { ...left.secrets, ...right.secrets }, clears, weeks: { ...left.weeks, ...right.weeks }, claims: { ...left.claims, ...right.claims } });
}
export function recordAdventure(value, event, now = Date.now()) {
  const progress = normalizeAdventure(value);
  if (event?.type === "secret" && SECRET_IDS.includes(event.id)) progress.secrets[event.id] = true;
  if (event?.type !== "finish" || event.won !== true || !ADVENTURE_GAMES[event.game] || !Number.isInteger(event.level) || event.level < 0 || event.level >= ADVENTURE_GAMES[event.game].stages || !Number.isFinite(event.seconds) || event.seconds <= 0 || event.seconds > 86400) return progress;
  const previous = progress.clears[event.game]?.[event.level];
  progress.clears[event.game] ||= {};
  if (!event.challenge) progress.clears[event.game][event.level] = { seconds: Math.min(previous?.seconds ?? Infinity, event.seconds), flawless: previous?.flawless === true || event.flawless === true };
  const weekly = weeklyChallenge(now);
  if (event.challenge === weekly.id && event.game === weekly.game && event.level === weekly.level) progress.weeks[weekly.id] = true;
  return progress;
}
export function rewardProgress(value, reward) {
  const progress = normalizeAdventure(value);
  if (reward.id.startsWith("explorer-")) return Object.keys(progress.secrets).length;
  return Object.keys(progress.clears[reward.game] || {}).length;
}
export function claimAdventureReward(user, id, now = Date.now()) {
  if (!user) return;
  const progress = normalizeAdventure(user.adventure), weekly = weeklyChallenge(now);
  if (progress.claims[id]) return;
  let item, coins = 0;
  if (id === `weekly-${weekly.id}` && progress.weeks[weekly.id]) coins = weekly.reward;
  else {
    const reward = [...MASTERY_REWARDS, ...EXPLORER_REWARDS].find(r => r.id === id);
    if (!reward || rewardProgress(progress, reward) < reward.target) return;
    item = reward.item;
  }
  if (coins && (!Number.isSafeInteger(user.coins) || user.coins < 0 || user.coins > Number.MAX_SAFE_INTEGER - coins)) return;
  progress.claims[id] = true;
  return { ...user, adventure: progress, ...(item ? { ownedItems: { ...(user.ownedItems || {}), [item]: true } } : {}), ...(coins ? { coins: user.coins + coins } : {}) };
}
