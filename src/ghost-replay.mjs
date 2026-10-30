export const REPLAY_VERSION = 1;
export const REPLAY_LIMIT = 600;
const finite = value => typeof value === "number" && Number.isFinite(value);

export function normalizeReplay(value, course) {
  if (!value || value.version !== REPLAY_VERSION || value.course !== course || !finite(value.seconds) || value.seconds <= 0 || value.seconds > REPLAY_LIMIT) return null;
  if (!Array.isArray(value.frames) || value.frames.length < 2 || value.frames.length > 6002) return null;
  let previous = -1;
  for (const frame of value.frames) {
    if (!Array.isArray(frame) || frame.length !== 5 || !frame.every(finite) || frame[0] <= previous || frame[0] > value.seconds + 0.02 || frame.slice(1, 4).some(v => Math.abs(v) > 1000)) return null;
    previous = frame[0];
  }
  if (value.frames[0][0] !== 0 || Math.abs(previous - value.seconds) > 0.15) return null;
  return { version: REPLAY_VERSION, course, seconds: value.seconds, frames: value.frames.map(frame => [...frame]) };
}

export function createRecorder(course, initial) {
  const frames = [[0, initial.x, initial.y, initial.z, 0]];
  let valid = true;
  return {
    invalidate() { valid = false; },
    sample(time, position, yaw, force = false) {
      if (!valid || time > REPLAY_LIMIT) { valid = false; return; }
      if (time - frames.at(-1)[0] < (force ? 0.001 : 0.1)) return;
      frames.push([time, position.x, position.y, position.z, yaw].map(v => Math.round(v * 1000) / 1000));
    },
    finish(seconds, won) { return valid && won ? normalizeReplay({ version: REPLAY_VERSION, course, seconds, frames }, course) : null; },
    get valid() { return valid; }
  };
}

export function replayPose(replay, time) {
  if (!replay || time > replay.seconds) return null;
  const frames = replay.frames;
  let low = 0, high = frames.length - 1;
  while (low + 1 < high) { const mid = (low + high) >> 1; if (frames[mid][0] <= time) low = mid; else high = mid; }
  const a = frames[low], b = frames[high], fraction = Math.max(0, Math.min(1, (time - a[0]) / (b[0] - a[0])));
  // Respawns snap rather than drawing a ghost flying through the level.
  const f = Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]) > 4 ? 0 : fraction;
  const angle = Math.atan2(Math.sin(b[4] - a[4]), Math.cos(b[4] - a[4]));
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, z: a[3] + (b[3] - a[3]) * f, yaw: a[4] + angle * f };
}

export function formatTrialTime(seconds) {
  return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}` : "--:--";
}
