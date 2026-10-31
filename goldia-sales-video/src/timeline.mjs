// Shared timeline logic — used by the Remotion composition AND by Node scripts (SRT export).
// Plain JS (ESM) so it runs in Node without a TypeScript build step.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TRANSITION_FRAMES = 20;

// Estimated Uzbek narration speed when no real audio exists yet (characters / second).
export const CHARS_PER_SEC = 14.5;
export const LEAD_SEC = 0.8; // silence before narration starts in a scene
export const TAIL_SEC = 1.3; // silence after narration ends in a scene
const MAX_CUE_CHARS = 96; // ~2 subtitle lines

function splitLong(text) {
  if (text.length <= MAX_CUE_CHARS) return [text];
  // try to split near the middle on a natural boundary
  const mid = text.length / 2;
  const candidates = [];
  const re = /(: |, | — )/g; // break AFTER punctuation only
  let m;
  while ((m = re.exec(text))) candidates.push(m.index + m[0].length);
  if (candidates.length === 0) {
    const sp = text.lastIndexOf(" ", Math.round(mid));
    candidates.push(sp > 0 ? sp + 1 : Math.round(mid));
  }
  candidates.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const at = candidates[0];
  const left = text.slice(0, at).trim();
  const right = text.slice(at).trim();
  if (!left || !right) return [text];
  return [...splitLong(left), ...splitLong(right)];
}

export function splitCues(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.flatMap(splitLong);
}

/**
 * @param {{scenes: {id: string, voiceover: string}[]}} script
 * @param {Record<string, {file: string, duration: number}>} audio  per-scene audio manifest
 */
export function buildTimeline(script, audio = {}) {
  let cursor = 0;
  const scenes = script.scenes.map((s, i) => {
    const a = audio[s.id];
    const speechSec = a ? a.duration : s.voiceover.length / CHARS_PER_SEC;
    const durationInFrames = Math.ceil((LEAD_SEC + speechSec + TAIL_SEC) * FPS);
    const start = cursor;
    cursor += durationInFrames - (i < script.scenes.length - 1 ? TRANSITION_FRAMES : 0);

    const parts = splitCues(s.voiceover);
    const weights = parts.map((p) => p.length + 6); // +6 ≈ pause between phrases
    const total = weights.reduce((x, y) => x + y, 0);
    let t = LEAD_SEC;
    const cues = parts.map((text, k) => {
      const len = (weights[k] / total) * speechSec;
      const cue = {
        text,
        from: Math.round((start / FPS + t) * FPS),
        to: Math.round((start / FPS + t + len) * FPS),
      };
      t += len;
      return cue;
    });

    return {
      id: s.id,
      index: i,
      start,
      durationInFrames,
      speechStart: start + Math.round(LEAD_SEC * FPS),
      speechFrames: Math.round(speechSec * FPS),
      audioFile: a ? a.file : null,
      cues,
    };
  });
  return { scenes, totalFrames: cursor };
}

export function toSrtTime(frame) {
  const ms = Math.round((frame / FPS) * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const r = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${r}`;
}
