import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Background, Subtitles } from "./components/ui";
import { loadFonts } from "./theme";
import {
  DashboardScene,
  FactoryScene,
  IntroScene,
  ProblemScene,
  RatesScene,
  ScannerScene,
  SolutionScene,
  type SceneProps,
} from "./scenes/part1";
import {
  LedgerScene,
  MarkupScene,
  OutroScene,
  ReconcileScene,
  RefiningScene,
  SecurityScene,
  SellerScene,
} from "./scenes/part2";
// @ts-expect-error plain JS module shared with Node scripts
import { TRANSITION_FRAMES, buildTimeline } from "./timeline.mjs";
import script from "./data/script.json";
import audioManifest from "./data/audio-manifest.json";
import settings from "./data/settings.json";

loadFonts();

const SCENES: Record<string, React.FC<SceneProps>> = {
  "01-intro": IntroScene,
  "02-problem": ProblemScene,
  "03-solution": SolutionScene,
  "04-dashboard": DashboardScene,
  "05-rates": RatesScene,
  "06-factory": FactoryScene,
  "07-scanner": ScannerScene,
  "08-seller": SellerScene,
  "09-ledger": LedgerScene,
  "10-markup": MarkupScene,
  "11-refining": RefiningScene,
  "12-reconcile": ReconcileScene,
  "13-security": SecurityScene,
  "14-outro": OutroScene,
};

type TLScene = {
  id: string;
  index: number;
  start: number;
  durationInFrames: number;
  speechStart: number;
  audioFile: string | null;
  cues: { text: string; from: number; to: number }[];
};

export const TIMELINE: { scenes: TLScene[]; totalFrames: number } = buildTimeline(
  script,
  audioManifest as Record<string, { file: string; duration: number }>,
);

const transitionFor = (i: number) => {
  const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kinds: TransitionPresentation<any>[] = [
    fade(),
    slide({ direction: "from-right" }),
    wipe({ direction: "from-left" }),
    fade(),
    slide({ direction: "from-bottom" }),
  ];
  return { presentation: kinds[i % kinds.length], timing };
};

const hasVoice = TIMELINE.scenes.some((s) => s.audioFile);

export const GoldiaSales: React.FC<{ subtitles?: boolean; only?: string[] }> = ({ subtitles = true, only }) => {
  const { durationInFrames } = useVideoConfig();
  const scenes = only ? TIMELINE.scenes.filter((s) => only.includes(s.id)) : TIMELINE.scenes;
  const offset = scenes[0]?.start ?? 0;
  const musicVol = hasVoice ? settings.music.volumeWithVoice : settings.music.volume;

  return (
    <AbsoluteFill style={{ background: "#071024", color: "#EEF1F8", fontFamily: "Inter" }}>
      <Background />
      <TransitionSeries>
        {scenes.flatMap((s, i) => {
          const Comp = SCENES[s.id];
          const seq = (
            <TransitionSeries.Sequence key={s.id} durationInFrames={s.durationInFrames}>
              <Comp dur={s.durationInFrames} />
            </TransitionSeries.Sequence>
          );
          return i < scenes.length - 1
            ? [seq, <TransitionSeries.Transition key={`${s.id}-t`} {...transitionFor(i)} />]
            : [seq];
        })}
      </TransitionSeries>

      {/* voiceover — one file per scene (public/voiceover/<id>.mp3), see README */}
      {scenes.map((s) =>
        s.audioFile ? (
          <Sequence key={`a-${s.id}`} from={s.speechStart - offset} layout="none">
            <Audio src={staticFile(s.audioFile)} />
          </Sequence>
        ) : null,
      )}

      {/* background music bed */}
      {settings.music.enabled ? (
        <Audio
          src={staticFile(settings.music.file)}
          loop
          volume={(f) =>
            musicVol *
            interpolate(f, [0, 45, durationInFrames - 75, durationInFrames], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}

      {subtitles ? (
        <Subtitles
          cues={scenes.flatMap((s) => s.cues.map((c) => ({ ...c, from: c.from - offset, to: c.to - offset })))}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** Duration helper for partial renders (e.g. the 10s test). */
export const framesFor = (ids: string[]) => {
  const sc = TIMELINE.scenes.filter((s) => ids.includes(s.id));
  return sc.reduce((a, s) => a + s.durationInFrames, 0) - TRANSITION_FRAMES * (sc.length - 1);
};
