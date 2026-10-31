// Exports Uzbek subtitles (same timing as the video) → out/goldia-sales.uz.srt
// and the narration text for voice actors / TTS → out/voiceover-script.txt
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildTimeline, toSrtTime, FPS } from "../src/timeline.mjs";

const script = JSON.parse(readFileSync("src/data/script.json", "utf8"));
const audio = JSON.parse(readFileSync("src/data/audio-manifest.json", "utf8"));
const tl = buildTimeline(script, audio);
mkdirSync("out", { recursive: true });
let n = 1, srt = "";
for (const s of tl.scenes) for (const c of s.cues) srt += `${n++}\n${toSrtTime(c.from)} --> ${toSrtTime(c.to)}\n${c.text}\n\n`;
writeFileSync("out/goldia-sales.uz.srt", srt);
let txt = `${script.title}\nJami davomiylik: ${(tl.totalFrames / FPS).toFixed(1)} s\n\n`;
for (const s of tl.scenes) txt += `[${s.id}]  ${toSrtTime(s.speechStart).slice(3, 8)}  (fayl: public/voiceover/${s.id}.mp3)\n${script.scenes[s.index].voiceover}\n\n`;
writeFileSync("out/voiceover-script.txt", txt);
console.log(`out/goldia-sales.uz.srt (${n - 1} ta subtitr), out/voiceover-script.txt — ${(tl.totalFrames / FPS).toFixed(1)} s`);
