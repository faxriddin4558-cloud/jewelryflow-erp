// Generates an original, royalty-free ambient pad (no external samples) → public/music/ambient-pad.mp3
// Usage: node scripts/make-music.mjs [seconds]
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SR = 44100;
const seconds = Number(process.argv[2] || 230);
const N = SR * seconds;
const L = new Float32Array(N), R = new Float32Array(N);
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// D major-ish progression, warm & corporate: Dmaj9, Bm9, Gmaj9, A6/9 (8 s each)
const chords = [
  [38, 50, 57, 61, 64, 66],
  [35, 47, 54, 57, 61, 62],
  [31, 43, 50, 54, 57, 59],
  [33, 45, 52, 54, 57, 59],
];
const CH = 8; // seconds per chord
const XF = 3; // crossfade seconds
for (let c = 0; c * CH < seconds + CH; c++) {
  const notes = chords[c % chords.length];
  const t0 = c * CH - XF / 2;
  const t1 = t0 + CH + XF;
  const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(N, Math.floor(t1 * SR));
  notes.forEach((m, k) => {
    const f = midi(m);
    const amp = (k === 0 ? 0.16 : 0.07) / (1 + k * 0.12);
    const det = [0.997, 1.0, 1.0032];
    const pan = k === 0 ? 0.5 : (k % 2 ? 0.3 : 0.7);
    for (let i = i0; i < i1; i++) {
      const t = i / SR;
      const lt = t - t0;
      const env = Math.min(1, lt / XF) * Math.min(1, (t1 - t) / XF);
      const e = env * env * (3 - 2 * env); // smoothstep
      const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * (0.07 + k * 0.013) * t + k);
      let s = 0;
      for (const d of det) s += Math.sin(2 * Math.PI * f * d * t + k * 1.7) + 0.18 * Math.sin(4 * Math.PI * f * d * t);
      s = (s / det.length) * amp * e * lfo;
      L[i] += s * (1 - pan) * 2;
      R[i] += s * pan * 2;
    }
  });
}
// gentle sparkle bells every 4 s (high chord tones)
for (let b = 2; b < seconds - 2; b += 4) {
  const notes = chords[Math.floor(b / CH) % chords.length];
  const f = midi(notes[2 + (b % 3)] + 24);
  const i0 = Math.floor(b * SR);
  for (let i = i0; i < Math.min(N, i0 + SR * 3); i++) {
    const t = (i - i0) / SR;
    const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 1.6) * 0.025;
    L[i] += s * 0.8; R[i] += s * 1.2;
  }
}
// one-pole low-pass + normalize
let pl = 0, pr = 0, peak = 0;
const a = 0.12;
for (let i = 0; i < N; i++) { pl += a * (L[i] - pl); pr += a * (R[i] - pr); L[i] = pl; R[i] = pr; peak = Math.max(peak, Math.abs(pl), Math.abs(pr)); }
const g = 0.7 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
}
mkdirSync("public/music", { recursive: true });
writeFileSync("out-ambient.wav", buf);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "out-ambient.wav", "-af", "aecho=0.8:0.7:120|260:0.25|0.18,afade=t=in:d=3", "-b:a", "160k", "public/music/ambient-pad.mp3"]);
execFileSync("rm", ["-f", "out-ambient.wav"]);
console.log(`public/music/ambient-pad.mp3 (${seconds}s) yaratildi`);
