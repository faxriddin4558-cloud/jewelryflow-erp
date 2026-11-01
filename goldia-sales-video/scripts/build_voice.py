#!/usr/bin/env python3
"""Cut the full narration into per-scene files and align subtitles to the real voice.

Inputs  : src/data/real-script.json   (scene texts + source ranges)
          src/data/asr-full.json      (Whisper word timestamps of the full narration)
          voice-source/*.mp3          (full ElevenLabs narration)
Outputs : public/voiceover/<scene-id>.mp3
          src/data/real-cues.json     (per scene: [{text, from, to}] in seconds from the scene's speech start)

Standard library only (+ ffmpeg on PATH). Run:  python3 scripts/build_voice.py
"""
import difflib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

script = json.load(open("src/data/real-script.json", encoding="utf-8"))
asr = json.load(open("src/data/asr-full.json", encoding="utf-8"))
src = script["voiceSource"]
MAX_CUE = 96


def split_cues(text):
    """Same rules as src/timeline.mjs splitCues."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    out = []

    def split_long(t):
        if len(t) <= MAX_CUE:
            return [t]
        mid = len(t) / 2
        cands = [m.end() for m in re.finditer(r"(: |, | — )", t)]
        if not cands:
            sp = t.rfind(" ", 0, round(mid))
            cands = [sp + 1 if sp > 0 else round(mid)]
        at = sorted(cands, key=lambda a: abs(a - mid))[0]
        left, right = t[:at].strip(), t[at:].strip()
        if not left or not right:
            return [t]
        return split_long(left) + split_long(right)

    for s in sentences:
        out += split_long(s)
    return out


def norm_chars(text):
    t = text.lower()
    t = re.sub(r"[‘’ʻʼ'`]", "", t)
    # rough phonetic folding so Whisper's spelling matches the script
    for a, b in [("x", "h"), ("q", "k"), ("o", "a"), ("ch", "c"), ("sh", "s"), ("ş", "s")]:
        t = t.replace(a, b)
    return "".join(c for c in t if c.isalnum())


words = [w for seg in asr for w in seg["words"]]

cues_out = {}
audio_out = {}
for sc in script["scenes"]:
    sid = sc["id"]
    ranges = sc["ranges"]
    # 1) cut audio (short fades at the joins avoid clicks)
    parts = []
    for i, (a, b) in enumerate(ranges):
        part = f"/tmp/_voice_{sid}_{i}.wav"
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{a}", "-to", f"{b}", "-i", src,
             "-af", f"afade=t=in:d=0.02,afade=t=out:st={max(0, b - a - 0.03):.3f}:d=0.03",
             "-ar", "44100", "-ac", "1", part],
            check=True,
        )
        parts.append(part)
    lst = f"/tmp/_voice_{sid}.txt"
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    os.makedirs("public/voiceover", exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
         "-af", "volume=3dB,alimiter=limit=0.93:level=disabled", "-b:a", "192k", f"public/voiceover/{sid}.mp3"],
        check=True,
    )

    # 2) map source time -> scene-local time
    offsets = []
    acc = 0.0
    for a, b in ranges:
        offsets.append((a, b, acc))
        acc += b - a
    total = acc

    def local(t):
        for a, b, o in offsets:
            if a - 0.05 <= t <= b + 0.05:
                return min(max(o + (t - a), 0), total)
        return None

    # 3) character-level alignment between script and Whisper words
    sw = [w for w in words if local((w["s"] + w["e"]) / 2) is not None]
    asr_chars, asr_times = [], []
    for w in sw:
        n = norm_chars(w["w"])
        mid = local((w["s"] + w["e"]) / 2)
        s = local(w["s"]); e = local(w["e"])
        s = mid if s is None else s
        e = mid if e is None else e
        for k, c in enumerate(n):
            asr_chars.append(c)
            asr_times.append(s + (e - s) * (k + 0.5) / max(1, len(n)))
    cue_texts = split_cues(sc["voiceover"])
    scr_chars, scr_cue = [], []
    for ci, ct in enumerate(cue_texts):
        for c in norm_chars(ct):
            scr_chars.append(c)
            scr_cue.append(ci)
    sm = difflib.SequenceMatcher(None, scr_chars, asr_chars, autojunk=False)
    time_of = [None] * len(scr_chars)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            time_of[blk.a + k] = asr_times[blk.b + k]
    # interpolate gaps
    known = [i for i, t in enumerate(time_of) if t is not None]
    for i in range(len(time_of)):
        if time_of[i] is None:
            prev = max([k for k in known if k < i], default=None)
            nxt = min([k for k in known if k > i], default=None)
            if prev is None:
                time_of[i] = time_of[nxt] if nxt is not None else 0.0
            elif nxt is None:
                time_of[i] = time_of[prev]
            else:
                time_of[i] = time_of[prev] + (time_of[nxt] - time_of[prev]) * (i - prev) / (nxt - prev)

    starts, ends = [], []
    for ci in range(len(cue_texts)):
        idx = [i for i, c in enumerate(scr_cue) if c == ci]
        starts.append(time_of[idx[0]] - 0.12)
        ends.append(time_of[idx[-1]] + 0.25)
    cues = []
    for ci, ct in enumerate(cue_texts):
        frm = max(0.0, starts[ci])
        to = starts[ci + 1] if ci + 1 < len(cue_texts) else min(total + 0.4, ends[ci] + 0.6)
        cues.append({"text": ct, "from": round(frm, 3), "to": round(max(to, frm + 0.8), 3)})
    cues_out[sid] = cues
    audio_out[sid] = {"file": f"voiceover/{sid}.mp3", "duration": round(total, 3)}
    ratio = len([t for t in sm.get_matching_blocks()]) and sum(b.size for b in sm.get_matching_blocks()) / max(1, len(scr_chars))
    print(f"{sid}: {total:6.2f}s  match {ratio:.0%}  " + " | ".join(f"{c['from']:.1f}" for c in cues))

json.dump(cues_out, open("src/data/real-cues.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(audio_out, open("src/data/real-audio.json", "w"), indent=1)
print("src/data/real-cues.json, src/data/real-audio.json yozildi")
