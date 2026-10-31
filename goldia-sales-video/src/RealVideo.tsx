import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { Background } from "./components/ui";
import { RightSubtitles } from "./components/real";
import { loadFonts } from "./theme";
import { RealDashboardScene } from "./scenes/real";
// @ts-expect-error plain JS module shared with Node scripts
import { buildTimeline } from "./timeline.mjs";
import realScript from "./data/real-script.json";
import audioManifest from "./data/audio-manifest.json";
import settings from "./data/settings.json";

loadFonts();

type TLScene = {
  id: string;
  index: number;
  start: number;
  durationInFrames: number;
  speechStart: number;
  speechFrames: number;
  audioFile: string | null;
  cues: { text: string; from: number; to: number }[];
};

export const REAL_TIMELINE: { scenes: TLScene[]; totalFrames: number } = buildTimeline(
  realScript,
  audioManifest as Record<string, { file: string; duration: number }>,
);

const hasVoice = REAL_TIMELINE.scenes.some((s) => s.audioFile);

export const GoldiaRealTest: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const sc = REAL_TIMELINE.scenes[0];
  const musicVol = hasVoice ? settings.music.volumeWithVoice : settings.music.volume;
  return (
    <AbsoluteFill style={{ background: "#071024", color: "#EEF1F8", fontFamily: "Inter" }}>
      <Background />
      <RealDashboardScene
        dur={sc.durationInFrames}
        text={realScript.scenes[0].voiceover}
        speechStart={sc.speechStart - sc.start}
        speechFrames={sc.speechFrames}
      />
      {sc.audioFile ? (
        <Sequence from={sc.speechStart} layout="none">
          <Audio src={staticFile(sc.audioFile)} />
        </Sequence>
      ) : null}
      {settings.music.enabled ? (
        <Audio
          src={staticFile(settings.music.file)}
          volume={(f) =>
            musicVol *
            interpolate(f, [0, 30, durationInFrames - 30, durationInFrames], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}
      <RightSubtitles cues={sc.cues} />
    </AbsoluteFill>
  );
};
