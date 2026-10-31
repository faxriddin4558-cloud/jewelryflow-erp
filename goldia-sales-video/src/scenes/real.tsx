import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { GoldText } from "../components/ui";
import {
  Caption,
  Magnifier,
  PHONE,
  RIGHT,
  RealBadge,
  RealPhone,
  RightHeader,
  SHOTS,
  type Region,
  type Shot,
  screenScale,
} from "../components/real";

export type Step = {
  at: number; // frame (scene-local) when this step starts
  region: Region; // highlight + magnify region (screenshot px)
  caption: string;
  sub?: string;
};

/** Phone + magnifier choreography shared by all real-screenshot scenes. */
export const ShotWalkthrough: React.FC<{
  shot: Shot;
  steps: Step[];
  dur: number;
  scroll?: (frame: number) => number;
}> = ({ shot, steps, dur, scroll }) => {
  const frame = useCurrentFrame();
  const idx = steps.reduce((acc, st, i) => (frame >= st.at ? i : acc), -1);
  const cur = idx >= 0 ? steps[idx] : null;
  const prev = idx > 0 ? steps[idx - 1] : null;
  const t = cur ? interpolate(frame, [cur.at, cur.at + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const out = interpolate(frame, [dur - 24, dur - 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // smoothly move highlight between regions
  const lerp = (a: number, b: number) => a + (b - a) * (1 - Math.pow(1 - t, 3));
  const hl: Region | null = cur
    ? prev
      ? { x: lerp(prev.region.x, cur.region.x), y: lerp(prev.region.y, cur.region.y), w: lerp(prev.region.w, cur.region.w), h: lerp(prev.region.h, cur.region.h) }
      : cur.region
    : null;
  const scrollY = scroll ? scroll(frame) : 0;

  // connector from highlight to magnifier
  const s = screenScale(shot);
  const magTop = 290;
  return (
    <AbsoluteFill>
      <RealPhone shot={shot} highlight={hl} highlightOpacity={(prev ? 1 : t) * out} scrollY={scrollY} />
      {hl ? (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: t * out }}>
          <path
            d={`M ${PHONE.x + 12 + (hl.x + hl.w) * s + 4} ${PHONE.y + 12 + (hl.y - scrollY + hl.h / 2) * s} C ${RIGHT.x - 60} ${PHONE.y + 12 + (hl.y - scrollY + hl.h / 2) * s}, ${RIGHT.x - 80} ${magTop + 60}, ${RIGHT.x - 6} ${magTop + 60}`}
            fill="none"
            stroke="rgba(212,175,55,0.75)"
            strokeWidth={2.5}
            strokeDasharray="8 8"
          />
        </svg>
      ) : null}
      {prev && t < 1 ? (
        <div style={{ position: "absolute", left: RIGHT.x, top: magTop, width: RIGHT.w, display: "flex", flexDirection: "column", gap: 28 }}>
          <Magnifier shot={shot} region={prev.region} maxW={RIGHT.w} maxH={400} appear={(1 - t) * out} />
          <Caption title={prev.caption} sub={prev.sub} appear={(1 - t) * out} />
        </div>
      ) : null}
      {cur ? (
        <div style={{ position: "absolute", left: RIGHT.x, top: magTop, width: RIGHT.w, display: "flex", flexDirection: "column", gap: 28 }}>
          <Magnifier key={idx} shot={shot} region={cur.region} maxW={RIGHT.w} maxH={400} appear={t * out} />
          <Caption title={cur.caption} sub={cur.sub} appear={t * out} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Convert a phrase position in the narration into a scene-local frame (works with estimated or real audio). */
export const phraseFrame = (text: string, phrase: string, speechStartLocal: number, speechFrames: number) => {
  const i = text.indexOf(phrase);
  if (i < 0) throw new Error(`phrase not found: ${phrase}`);
  return Math.round(speechStartLocal + (i / text.length) * speechFrames);
};

/* ============================== R01 DASHBOARD ============================== */
// Regions measured on screens/dashboard.jpg (1080×2092)
const R = {
  header: { x: 0, y: 0, w: 1080, h: 158 },
  factory: { x: 46, y: 185, w: 472, h: 368 },
  stock: { x: 562, y: 185, w: 472, h: 368 },
  debts: { x: 46, y: 594, w: 472, h: 321 },
  balance: { x: 46, y: 1352, w: 988, h: 404 },
};

export const RealDashboardScene: React.FC<{ dur: number; text: string; speechStart: number; speechFrames: number }> = ({
  dur,
  text,
  speechStart,
  speechFrames,
}) => {
  const f = (p: string) => phraseFrame(text, p, speechStart, speechFrames);
  const steps: Step[] = [
    { at: speechStart + 6, region: R.header, caption: "Savdo Markazi · Asosiy Panel", sub: "Barcha ko‘rsatkichlar 585 proba ekvivalentida" },
    { at: f("zavod majburiyati"), region: R.factory, caption: "Zavod majburiyati", sub: "Zavod oldidagi sof qarz — ustama bilan" },
    { at: f("ombor va sotuvchilardagi"), region: R.stock, caption: "Ombor va sotuvchidagi tovar", sub: "Menejer va sotuvchilar bo‘yicha alohida" },
    { at: f("mijozlar nasiyasi"), region: R.debts, caption: "Mijozlar sof nasiyasi", sub: "585 ekvivalentidagi sof qarz" },
    { at: f("Fizik tovar"), region: R.balance, caption: "Fizik tovar balansi", sub: "Zavoddan qabul qilingan har bir gramm hisobda" },
  ];
  return (
    <AbsoluteFill>
      <RightHeader step="01" kicker="Asosiy panel" title={<>Butun biznes — <GoldText>bitta ekranda</GoldText></>} />
      <ShotWalkthrough shot={SHOTS.dashboard} steps={steps} dur={dur} />
      <div style={{ position: "absolute", left: PHONE.x, top: 990, width: 476, display: "flex", justifyContent: "center" }}>
        <RealBadge text="HAQIQIY EKRAN · production" style={{ fontSize: 18, padding: "8px 16px" }} />
      </div>
    </AbsoluteFill>
  );
};
