import React from "react";
import { Composition } from "remotion";
import { GoldiaSales, TIMELINE } from "./Video";
// @ts-expect-error plain JS module
import { FPS, HEIGHT, WIDTH } from "./timeline.mjs";

export const RemotionRoot: React.FC = () => (
  <>
    {/* Full presentation (~3.5 min) */}
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
  </>
);
