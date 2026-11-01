import React from "react";
import { Composition } from "remotion";
import { GoldiaSales, TIMELINE } from "./Video";
import { GoldiaReal, GoldiaRealTest, REAL_ALL, REAL_TEST } from "./RealVideo";
// @ts-expect-error plain JS module
import { FPS, HEIGHT, WIDTH } from "./timeline.mjs";

export const RemotionRoot: React.FC = () => (
  <>
    {/* NEW: real production screenshots + ElevenLabs voice */}
    <Composition id="GoldiaReal" component={GoldiaReal} durationInFrames={REAL_ALL.total} fps={FPS} width={WIDTH} height={HEIGHT} />
    {/* OLD: mock-up version (~3.5 min, silent) */}
    <Composition
      id="GoldiaSales"
      component={GoldiaSales}
      durationInFrames={TIMELINE.totalFrames}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ subtitles: true }}
    />
    {/* 10-second test: intro → dashboard mock-up (checks fonts, transitions, subtitles, encoding) */}
    <Composition
      id="GoldiaTest"
      component={GoldiaSales}
      durationInFrames={10 * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ subtitles: true, only: ["01-intro", "04-dashboard"] }}
    />
    {/* Real production screenshot — test scene */}
    <Composition
      id="GoldiaRealTest"
      component={GoldiaRealTest}
      durationInFrames={REAL_TEST.total}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
