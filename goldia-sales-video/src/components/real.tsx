import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, GOLD_GRADIENT, SANS, SERIF } from "../theme";
import { FadeUp, GoldText, ease, useSpring } from "./ui";

/** Region inside a screenshot, in the screenshot's own pixel coordinates. */
export type Region = { x: number; y: number; w: number; h: number };

export type Shot = { file: string; w: number; h: number };

/* Production screenshots (status bar / nav bar cropped, personal data blurred). */
export const SHOTS = {
  dashboard: { file: "screens/dashboard.jpg", w: 1080, h: 2092 },
  factory: { file: "screens/factory.jpg", w: 1080, h: 2092 },
  customers: { file: "screens/customers.jpg", w: 1080, h: 2092 },
  inventory: { file: "screens/inventory.jpg", w: 1080, h: 2092 },
} satisfies Record<string, Shot>;

/** Honest label for real screenshots. */
export const RealBadge: React.FC<{ text?: string; style?: React.CSSProperties }> = ({
  text = "HAQIQIY EKRAN · Goldia Sales production",
  style,
}) => {
  const p = useSpring(10, 20);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        opacity: p,
        fontFamily: SANS,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: 1.5,
        color: C.green,
        padding: "10px 20px",
        borderRadius: 999,
        border: "1px solid rgba(65,217,155,0.5)",
        background: "rgba(7,16,36,0.75)",
        ...style,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 10, background: C.green, boxShadow: `0 0 10px ${C.green}` }} />
      {text}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Phone with a real screenshot + animated highlight                   */
/* ------------------------------------------------------------------ */

export const PHONE = { x: 120, y: 70, screenW: 452 };

export const screenScale = (shot: Shot) => PHONE.screenW / shot.w;

export const RealPhone: React.FC<{
  shot: Shot;
  highlight?: Region | null;
  highlightOpacity?: number;
  scrollY?: number; // in screenshot px
  delay?: number;
}> = ({ shot, highlight, highlightOpacity = 1, scrollY = 0, delay = 0 }) => {
  const frame = useCurrentFrame();
  const p = useSpring(delay, 20);
  const s = screenScale(shot);
  const screenH = shot.h * s;
  const pulse = 0.65 + 0.35 * Math.sin(frame / 7);
  return (
    <div
      style={{
        position: "absolute",
        left: PHONE.x,
        top: PHONE.y,
        padding: 12,
        borderRadius: 56,
        background: "linear-gradient(145deg, #2A3550, #0A1020)",
        boxShadow: "0 50px 120px rgba(0,0,0,0.65), 0 0 0 2px rgba(212,175,55,0.3), inset 0 0 0 2px rgba(255,255,255,0.06)",
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [-80, 0])}px)`,
      }}
    >
      <div
        style={{
          width: PHONE.screenW,
          height: Math.min(screenH, 920),
          borderRadius: 44,
          overflow: "hidden",
          position: "relative",
          background: "#0B1120",
        }}
      >
        <Img
          src={staticFile(shot.file)}
          style={{ width: PHONE.screenW, position: "absolute", left: 0, top: -scrollY * s }}
        />
        {highlight ? (
          <>
            {/* dim everything except the highlighted region */}
            <svg width={PHONE.screenW} height={screenH} style={{ position: "absolute", left: 0, top: -scrollY * s, opacity: highlightOpacity }}>
              <defs>
                <mask id="hole">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={highlight.x * s} y={highlight.y * s} width={highlight.w * s} height={highlight.h * s} rx={14} fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(3,7,18,0.62)" mask="url(#hole)" />
            </svg>
            <div
              style={{
                position: "absolute",
                left: highlight.x * s - 4,
                top: (highlight.y - scrollY) * s - 4,
                width: highlight.w * s + 8,
                height: highlight.h * s + 8,
                borderRadius: 16,
                border: `3px solid ${C.gold}`,
                boxShadow: `0 0 ${18 + pulse * 18}px rgba(212,175,55,${0.5 + pulse * 0.3})`,
                opacity: highlightOpacity,
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Magnifier: the same screenshot region, enlarged and readable        */
/* ------------------------------------------------------------------ */

export const Magnifier: React.FC<{
  shot: Shot;
  region: Region;
  maxW: number;
  maxH: number;
  appear: number; // 0..1
  style?: React.CSSProperties;
}> = ({ shot, region, maxW, maxH, appear, style }) => {
  const k = Math.min(maxW / region.w, maxH / region.h);
  const w = region.w * k;
  const h = region.h * k;
  return (
    <div
      style={{
        width: w,
        height: h,
        overflow: "hidden",
        borderRadius: 26,
        position: "relative",
        border: `2px solid rgba(212,175,55,0.7)`,
        boxShadow: "0 40px 100px rgba(0,0,0,0.6), 0 0 50px rgba(212,175,55,0.18)",
        opacity: appear,
        transform: `scale(${0.92 + appear * 0.08}) translateY(${(1 - appear) * 24}px)`,
        transformOrigin: "left center",
        ...style,
      }}
    >
      <Img
        src={staticFile(shot.file)}
        style={{ position: "absolute", width: shot.w * k, left: -region.x * k, top: -region.y * k }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Right-column header & subtitles (large, phone-readable)             */
/* ------------------------------------------------------------------ */

export const RIGHT = { x: 700, w: 1100 };

export const RightHeader: React.FC<{ step: string; kicker: string; title: React.ReactNode }> = ({ step, kicker, title }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: RIGHT.x, top: 70, width: RIGHT.w }}>
      <FadeUp delay={4} distance={16}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: SANS, fontWeight: 800, fontSize: 24, letterSpacing: 5, color: C.gold, textTransform: "uppercase" }}>
          <span style={{ border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 16px", letterSpacing: 2, color: C.goldLight }}>{step}</span>
          {kicker}
        </div>
      </FadeUp>
      <FadeUp delay={8} distance={20}>
        <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 72, lineHeight: 1.08, marginTop: 12, color: C.text }}>{title}</div>
      </FadeUp>
      <div style={{ marginTop: 18, height: 4, width: 240 * ease(frame, 10, 44), background: GOLD_GRADIENT, borderRadius: 2, boxShadow: "0 0 18px rgba(212,175,55,0.55)" }} />
    </div>
  );
};

export type Cue = { text: string; from: number; to: number };

export const RightSubtitles: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const cue = cues.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;
  const o = Math.min(
    interpolate(frame, [cue.from, cue.from + 6], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [cue.to - 5, cue.to], [1, 0], { extrapolateLeft: "clamp" }),
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: RIGHT.x,
          width: RIGHT.w,
          bottom: 56,
          opacity: o,
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 42,
          lineHeight: 1.3,
          color: "#fff",
          padding: "18px 30px",
          borderRadius: 18,
          background: "rgba(4,9,21,0.82)",
          border: "1px solid rgba(212,175,55,0.3)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
          textAlign: "left",
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

/** Big caption next to the magnifier. */
export const Caption: React.FC<{ title: string; sub?: string; appear: number }> = ({ title, sub, appear }) => (
  <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 16}px)`, fontFamily: SANS }}>
    <div style={{ fontSize: 46, fontWeight: 800, color: C.text, lineHeight: 1.15 }}>
      <GoldText>{title}</GoldText>
    </div>
    {sub ? <div style={{ fontSize: 32, color: C.muted, marginTop: 10, lineHeight: 1.3 }}>{sub}</div> : null}
  </div>
);
