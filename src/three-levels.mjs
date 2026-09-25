export const LEVELS = [
  {
    name: "Emerald Haven",
    islands: [
      [0, -0.6, 10, 10, 10], [0, -0.2, 1, 5, 6], [6, 0.3, -4, 6, 6],
      [10, 0.8, -12, 5, 6], [2, 1.2, -16, 7, 6], [-7, 0.9, -12, 6, 6],
      [-11, 0.2, -4, 5, 6], [-7, -0.2, 3, 5, 5]
    ],
    theme: { sky: "#a0bec3", water: "#3c7a87", grass: "#70a77a", stone: "#667773", rock: "#405962", mountain: "#698c8b", gem: "#f0d285" }
  },
  {
    name: "Sunstone Steps",
    islands: [
      [0, -0.6, 10, 10, 10], [0, 0, 1, 5, 5], [6, 0.6, -3, 5, 5],
      [12, 1.2, -7, 4.5, 5], [12, 1.8, -14, 5, 5], [6, 2.4, -18, 5, 5],
      [-1, 2.4, -18, 5, 5], [-7, 1.8, -14, 5, 5], [-11, 1.2, -7, 5, 5],
      [-8, 0.3, 1, 5, 5]
    ],
    theme: { sky: "#c5bdba", water: "#526e80", grass: "#d7bf89", stone: "#a67c70", rock: "#765e6d", mountain: "#a299ab", gem: "#87d9cf" }
  },
  {
    name: "Frostline Peaks",
    islands: [
      [0, -0.6, 10, 10, 10], [0, 0.1, 1, 4.8, 5], [-6, 0.8, -3, 4.8, 5],
      [-12, 1.5, -8, 4.8, 5], [-12, 2.2, -15, 4.8, 5], [-6, 2.9, -19, 4.8, 5],
      [1, 3.6, -19, 4.8, 5], [8, 2.9, -17, 4.8, 5], [13, 2.2, -11, 4.8, 5],
      [13, 1.5, -4, 4.8, 5], [8, 0.5, 2, 4.8, 5]
    ],
    theme: { sky: "#abbccf", water: "#466381", grass: "#cce2df", stone: "#8eabba", rock: "#5a718a", mountain: "#aeb9c6", gem: "#db9fba" }
  },
  {
    name: "Twilight Crown",
    islands: [
      [0, -0.6, 10, 10, 10], [0, 0.1, 1, 4.2, 4.5], [6, 0.8, -3, 4.2, 4.5],
      [12, 1.5, -7, 4.2, 4.5], [12, 2.2, -13.5, 4.2, 4.5], [6.5, 2.9, -18, 4.2, 4.5],
      [0, 3.6, -20, 4.2, 4.5], [-6.5, 4.3, -18, 4.2, 4.5], [-12, 3.4, -13, 4.2, 4.5],
      [-12, 2.5, -6.5, 4.2, 4.5], [-8, 1.5, -1, 4.2, 4.5], [-7, 0.5, 5.5, 4.2, 4.5]
    ],
    theme: { sky: "#56536f", water: "#344e62", grass: "#a297b6", stone: "#736f89", rock: "#4b4e64", mountain: "#74718c", gem: "#e4ca8c" }
  }
];

export function normalizeProgress(value) {
  return {
    selected: Number.isInteger(value?.selected) && value.selected >= 0 && value.selected < LEVELS.length ? value.selected : 0,
    completed: LEVELS.map((_, index) => value?.completed?.[index] === true)
  };
}

export function recordLevelResult(progress, result) {
  const next = normalizeProgress(progress);
  if (Number.isInteger(result.levelIndex) && result.levelIndex >= 0 && result.levelIndex < LEVELS.length) {
    next.selected = result.levelIndex;
    if (result.won === true) next.completed[result.levelIndex] = true;
  }
  return next;
}
