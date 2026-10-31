// Scans public/voiceover/ for per-scene narration files (<scene-id>.mp3|.wav|.m4a),
// measures them with ffprobe and writes src/data/audio-manifest.json.
// The video timeline then stretches each scene to fit its real narration.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const script = JSON.parse(readFileSync("src/data/script.json", "utf8"));
const dir = "public/voiceover";
const files = existsSync(dir) ? readdirSync(dir) : [];
const manifest = {};
for (const s of script.scenes) {
  const f = files.find((x) => x.replace(/\.(mp3|wav|m4a|aac|ogg)$/i, "") === s.id);
  if (!f) { console.log(`  —  ${s.id}: audio yo'q (taxminiy vaqt ishlatiladi)`); continue; }
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${dir}/${f}`]).toString().trim();
  manifest[s.id] = { file: `voiceover/${f}`, duration: Math.round(Number(out) * 1000) / 1000 };
  console.log(`  ✓  ${s.id}: ${f} (${manifest[s.id].duration}s)`);
}
writeFileSync("src/data/audio-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`src/data/audio-manifest.json yangilandi: ${Object.keys(manifest).length}/${script.scenes.length} sahna`);
