import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Background, Subtitles } from "./components/ui";
import { RightSubtitles } from "./components/real";
import { loadFonts } from "./theme";
import { ProblemScene, SolutionScene } from "./scenes/part1";
import {
  RConsign,
  RCustomers,
  RDashboard,
  RFactory,
  RIntro,
  ROutro,
  RReconcile,
  RRefining,
  RSecurity,
  type RealSceneProps,
} from "./scenes/real";
// @ts-expect-error plain JS module
import { FPS, LEAD_SEC, TAIL_SEC, TRANSITION_FRAMES } from "./timeline.mjs";
import realAudio from "./data/real-audio.json";
import realCues from "./data/real-cues.json";
import settings from "./data/settings.json";

loadFonts();

type Layout = "full" | "right";
const SCENES: { id: string; layout: Layout; C: React.FC<RealSceneProps> }[] = [
  { id: "r01-intro", layout: "full", C: RIntro },
  { id: "r02-problem", layout: "full", C: ProblemScene },
  { id: "r03-solution", layout: "full", C: SolutionScene },
  { id: "r04-dashboard", layout: "right", C: RDashboard },
  { id: "r05-factory", layout: "right", C: RFactory },
  { id: "r06-consign", layout: "right", C: RConsign },
  { id: "r07-customers", layout: "right", C: RCustomers },
  { id: "r08-refining", layout: "right", C: RRefining },
  { id: "r09-reconcile", layout: "right", C: RReconcile },
  { id: "r10-security", layout: "right", C: RSecurity },
  { id: "r11-outro", layout: "full", C: ROutro },
];

const AUDIO = realAudio as Record<string, { file: string; duration: number }>;
const CUES = realCues as Record<string, { text: string; from: number; to: number }[]>;

const build = (ids: string[]) => {
  let cursor = 0;
  const list = SCENES.filter((s) => ids.includes(s.id));
  const scenes = list.map((s, i) => {
    const a = AUDIO[s.id];
    const dur = Math.ceil((LEAD_SEC + a.duration + TAIL_SEC) * FPS);
    const start = cursor;
    cursor += dur - (i < list.length - 1 ? TRANSITION_FRAMES : 0);
    const speechLocal = Math.round(LEAD_SEC * FPS);
    const cues = CUES[s.id].map((c) => ({
      text: c.text,
      from: start + speechLocal + Math.round(c.from * FPS),
      to: start + speechLocal + Math.round(c.to * FPS),
      layout: s.layout,
    }));
    return { ...s, start, dur, speechLocal, audio: a.file, cues };
  });
  return { scenes, total: cursor };
};

export const REAL_ALL = build(SCENES.map((s) => s.id));
export const REAL_TEST = build(["r04-dashboard"]);

const transitionFor = (i: number) => {
  const kinds: TransitionPresentation<any>[] = [fade(), slide({ direction: "from-right" }), wipe({ direction: "from-left" }), fade(), slide({ direction: "from-bottom" })];
  return { presentation: kinds[i % kinds.length], timing: linearTiming({ durationInFrames: TRANSITION_FRAMES }) };
};

const Player: React.FC<{ tl: ReturnType<typeof build> }> = ({ tl }) => {
  const { durationInFrames } = useVideoConfig();
  const vol = settings.music.volumeWithVoice;
  const cues = tl.scenes.flatMap((s) => s.cues);
  return (
    <AbsoluteFill style={{ background: "#071024", color: "#EEF1F8", fontFamily: "Inter" }}>
      <Background />
      <TransitionSeries>
        {tl.scenes.flatMap((s, i) => {
          const seq = (
            <TransitionSeries.Sequence key={s.id} durationInFrames={s.dur}>
              <s.C dur={s.dur} speechStart={s.speechLocal} />
            </TransitionSeries.Sequence>
          );
          return i < tl.scenes.length - 1 ? [seq, <TransitionSeries.Transition key={`${s.id}-t`} {...transitionFor(i)} />] : [seq];
        })}
      </TransitionSeries>
      {tl.scenes.map((s) => (
        <Sequence key={`a-${s.id}`} from={s.start + s.speechLocal} layout="none">
          <Audio src={staticFile(s.audio)} />
        </Sequence>
      ))}
      {settings.music.enabled ? (
        <Audio
          src={staticFile(settings.music.file)}
          volume={(f) =>
            vol * interpolate(f, [0, 30, durationInFrames - 60, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          }
        />
      ) : null}
      <Subtitles cues={cues.filter((c) => c.layout === "full")} />
      <RightSubtitles cues={cues.filter((c) => c.layout === "right")} />
    </AbsoluteFill>
  );
};

export const GoldiaReal: React.FC = () => <Player tl={REAL_ALL} />;
export const GoldiaRealTest: React.FC = () => <Player tl={REAL_TEST} />;
