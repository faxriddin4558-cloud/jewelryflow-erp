import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, GOLD_GRADIENT, SANS, SERIF, fmt } from "../theme";

/* ------------------------------------------------------------------ */
/* Motion helpers                                                      */
/* ------------------------------------------------------------------ */

export const useSpring = (delay = 0, damping = 18, durationInFrames?: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.9 }, durationInFrames });
};

export const ease = (frame: number, from: number, to: number, a = 0, b = 1) =>
  interpolate(frame, [from, to], [a, b], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

export const FadeUp: React.FC<{
  delay?: number;
  distance?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, distance = 34, style, children }) => {
  const p = useSpring(delay, 20);
  return (
    <div
      style={{
        opacity: interpolate(p, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(p, [0, 1], [distance, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const ScaleIn: React.FC<{ delay?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  delay = 0,
  style,
  children,
}) => {
  const p = useSpring(delay, 16);
  return (
    <div
      style={{
        opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
        transform: `scale(${interpolate(p, [0, 1], [0.86, 1])})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

const PARTICLES = new Array(46).fill(0).map((_, i) => ({
  x: random(`px${i}`) * 1920,
  y: random(`py${i}`) * 1080,
  r: 1 + random(`pr${i}`) * 2.6,
  speed: 0.15 + random(`ps${i}`) * 0.45,
  phase: random(`ph${i}`) * Math.PI * 2,
  alpha: 0.18 + random(`pa${i}`) * 0.5,
}));

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame * 0.25;
  return (
    <AbsoluteFill style={{ background: C.navy900, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 800px at ${18 + Math.sin(frame / 160) * 4}% 12%, rgba(33,64,111,0.85) 0%, rgba(7,16,36,0) 60%),
             radial-gradient(900px 700px at ${88 + Math.cos(frame / 190) * 3}% 92%, rgba(212,175,55,0.10) 0%, rgba(7,16,36,0) 65%),
             linear-gradient(180deg, ${C.navy800} 0%, ${C.navy900} 55%, ${C.navy950} 100%)`,
        }}
      />
      {/* fine grid */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 0.35 }}>
        <defs>
          <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse" x={-drift % 64} y={0}>
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(148,163,200,0.07)" strokeWidth="1" />
          </pattern>
          <radialGradient id="gridMask" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="m">
            <rect width="1920" height="1080" fill="url(#gridMask)" />
          </mask>
        </defs>
        <rect width="1920" height="1080" fill="url(#grid)" mask="url(#m)" />
      </svg>
      {/* gold dust */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {PARTICLES.map((p, i) => {
          const y = (p.y - frame * p.speed + 1080 * 4) % 1080;
          const x = p.x + Math.sin(frame / 60 + p.phase) * 14;
          const tw = 0.55 + 0.45 * Math.sin(frame / 22 + p.phase);
          return <circle key={i} cx={x} cy={y} r={p.r} fill={C.goldLight} opacity={p.alpha * tw} />;
        })}
      </svg>
      {/* vignette */}
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Typography & labels                                                 */
/* ------------------------------------------------------------------ */

export const GoldText: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <span
    style={{
      background: GOLD_GRADIENT,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      ...style,
    }}
  >
    {children}
  </span>
);

export const SceneHeader: React.FC<{ kicker: string; title: React.ReactNode; step?: string }> = ({
  kicker,
  title,
  step,
}) => {
  const frame = useCurrentFrame();
  const line = ease(frame, 6, 40);
  return (
    <div style={{ position: "absolute", left: 120, top: 64, right: 120 }}>
      <FadeUp delay={2} distance={16}>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 20,
            letterSpacing: 6,
            color: C.gold,
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          {step ? (
            <span
              style={{
                border: `1px solid ${C.line}`,
                borderRadius: 999,
                padding: "4px 14px",
                letterSpacing: 2,
                color: C.goldLight,
              }}
            >
              {step}
            </span>
          ) : null}
          {kicker}
        </div>
      </FadeUp>
      <FadeUp delay={6} distance={22}>
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: 60,
            color: C.text,
            marginTop: 10,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
      </FadeUp>
      <div
        style={{
          marginTop: 18,
          height: 3,
          width: 220 * line,
          background: GOLD_GRADIENT,
          borderRadius: 2,
          boxShadow: "0 0 18px rgba(212,175,55,0.55)",
        }}
      />
    </div>
  );
};

/** Honest label: these screens are mock-ups built from the real UI, not a recording. */
export const DemoBadge: React.FC<{ text?: string }> = ({
  text = "DEMO MAKET · haqiqiy UI asosida · ma’lumotlar namunaviy",
}) => {
  const p = useSpring(14, 20);
  return (
    <div
      style={{
        position: "absolute",
        right: 120,
        top: 74,
        opacity: p,
        fontFamily: SANS,
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: 1.2,
        color: C.goldLight,
        padding: "9px 16px",
        borderRadius: 999,
        border: `1px dashed rgba(243,217,138,0.55)`,
        background: "rgba(7,16,36,0.65)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 8, background: C.gold }} />
      {text}
    </div>
  );
};

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  highlight?: boolean;
}> = ({ children, style, highlight }) => (
  <div
    style={{
      background: highlight
        ? "linear-gradient(160deg, rgba(212,175,55,0.16) 0%, rgba(17,34,68,0.85) 55%)"
        : "linear-gradient(160deg, rgba(24,48,90,0.75) 0%, rgba(11,23,51,0.85) 100%)",
      border: `1px solid ${highlight ? "rgba(212,175,55,0.55)" : C.lineSoft}`,
      borderRadius: 22,
      boxShadow: highlight
        ? "0 20px 60px rgba(0,0,0,0.45), 0 0 40px rgba(212,175,55,0.12)"
        : "0 20px 50px rgba(0,0,0,0.35)",
      fontFamily: SANS,
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      fontFamily: SANS,
      fontSize: 15,
      fontWeight: 700,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: C.muted,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Pill: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({
  children,
  color = C.gold,
  style,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 14px",
      borderRadius: 999,
      fontFamily: SANS,
      fontSize: 16,
      fontWeight: 700,
      color,
      border: `1px solid ${color}55`,
      background: `${color}18`,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </span>
);

export const AnimatedNumber: React.FC<{
  value: number;
  decimals?: number;
  delay?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
  signed?: boolean;
}> = ({ value, decimals = 0, delay = 0, duration = 40, prefix = "", suffix = "", style, signed }) => {
  const frame = useCurrentFrame();
  const t = ease(frame, delay, delay + duration);
  const v = value * t;
  const sign = signed && v > 0 ? "+" : "";
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}
      {sign}
      {fmt(v, decimals)}
      {suffix}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/* Icons (inline SVG — no emoji font dependency)                       */
/* ------------------------------------------------------------------ */

type IconName =
  | "chart"
  | "factory"
  | "box"
  | "scan"
  | "users"
  | "cash"
  | "flask"
  | "coin"
  | "report"
  | "tag"
  | "shield"
  | "gear"
  | "phone"
  | "telegram"
  | "lock"
  | "history"
  | "sheet"
  | "check"
  | "arrow"
  | "receipt"
  | "safe"
  | "user";

export const Icon: React.FC<{ name: IconName; size?: number; color?: string; stroke?: number }> = ({
  name,
  size = 28,
  color = C.gold,
  stroke = 1.8,
}) => {
  const p = { fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    chart: (
      <>
        <path {...p} d="M3 21h18" />
        <path {...p} d="M6 17V10M11 17V6M16 17v-5M20 17V8" />
      </>
    ),
    factory: (
      <>
        <path {...p} d="M3 21V10l5 3V10l5 3V7l8 4v10H3z" />
        <path {...p} d="M7 17h2M12 17h2M17 17h2" />
      </>
    ),
    box: (
      <>
        <path {...p} d="M3 7l9-4 9 4-9 4-9-4z" />
        <path {...p} d="M3 7v10l9 4 9-4V7M12 11v10" />
      </>
    ),
    scan: (
      <>
        <path {...p} d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
        <path {...p} d="M8 8v8M11 8v8M14 8v8M17 8v8" />
      </>
    ),
    users: (
      <>
        <circle {...p} cx="9" cy="8" r="3.5" />
        <path {...p} d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
        <circle {...p} cx="17" cy="9" r="2.6" />
        <path {...p} d="M16.5 14.6c2.6.2 4.3 1.9 5 4.9" />
      </>
    ),
    cash: (
      <>
        <rect {...p} x="2.5" y="6" width="19" height="12" rx="2" />
        <circle {...p} cx="12" cy="12" r="2.8" />
        <path {...p} d="M6 9.5v.01M18 14.5v.01" />
      </>
    ),
    flask: (
      <>
        <path {...p} d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2.2h12.4a1.5 1.5 0 001.3-2.2L14 9V3" />
        <path {...p} d="M7.5 15h9" />
      </>
    ),
    coin: (
      <>
        <ellipse {...p} cx="12" cy="7" rx="7" ry="3" />
        <path {...p} d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
        <path {...p} d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      </>
    ),
    report: (
      <>
        <path {...p} d="M6 3h9l4 4v14H6z" />
        <path {...p} d="M15 3v4h4M9 12h7M9 16h7M9 8h3" />
      </>
    ),
    tag: (
      <>
        <path {...p} d="M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9z" />
        <circle {...p} cx="8" cy="8" r="1.6" />
      </>
    ),
    shield: (
      <>
        <path {...p} d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
        <path {...p} d="M8.5 12l2.5 2.5 4.5-5" />
      </>
    ),
    gear: (
      <>
        <circle {...p} cx="12" cy="12" r="3" />
        <path
          {...p}
          d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"
        />
      </>
    ),
    phone: (
      <>
        <rect {...p} x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path {...p} d="M10.5 18.5h3" />
      </>
    ),
    telegram: (
      <>
        <path {...p} d="M21 4L3 11l6 2 2 6 3-4 5 4 2-15z" />
        <path {...p} d="M9 13l9-6" />
      </>
    ),
    lock: (
      <>
        <rect {...p} x="4.5" y="10.5" width="15" height="10" rx="2" />
        <path {...p} d="M8 10.5V7a4 4 0 018 0v3.5" />
      </>
    ),
    history: (
      <>
        <path {...p} d="M3.5 12a8.5 8.5 0 102.5-6L3.5 8.5" />
        <path {...p} d="M3.5 4v4.5H8M12 7.5V12l3 2" />
      </>
    ),
    sheet: (
      <>
        <rect {...p} x="4" y="3" width="16" height="18" rx="2" />
        <path {...p} d="M4 9h16M4 15h16M10 3v18" />
      </>
    ),
    check: <path {...p} d="M5 12.5l4.5 4.5L19 7.5" />,
    arrow: <path {...p} d="M4 12h15M13 6l6 6-6 6" />,
    receipt: (
      <>
        <path {...p} d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path {...p} d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    safe: (
      <>
        <rect {...p} x="3" y="4" width="18" height="16" rx="2" />
        <circle {...p} cx="12" cy="12" r="3.5" />
        <path {...p} d="M12 8.5v1M12 14.5v1M8.5 12h1M14.5 12h1M6 20v1.5M18 20v1.5" />
      </>
    ),
    user: (
      <>
        <circle {...p} cx="12" cy="8" r="4" />
        <path {...p} d="M4 21c1-4.2 4-6.5 8-6.5s7 2.3 8 6.5" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

export const IconBadge: React.FC<{ name: IconName; size?: number; glow?: boolean }> = ({ name, size = 64, glow }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.3,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(145deg, rgba(212,175,55,0.22), rgba(212,175,55,0.05))",
      border: `1px solid rgba(212,175,55,0.45)`,
      boxShadow: glow ? "0 0 30px rgba(212,175,55,0.35)" : undefined,
      flexShrink: 0,
    }}
  >
    <Icon name={name} size={size * 0.52} />
  </div>
);

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

export const LogoMark: React.FC<{ size?: number; progress?: number }> = ({ size = 160, progress = 1 }) => {
  const frame = useCurrentFrame();
  const circ = 2 * Math.PI * 44;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FBEFB8" />
          <stop offset="45%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#9E7419" />
        </linearGradient>
      </defs>
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke="url(#lg)"
        strokeWidth="2.4"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - progress)}
        transform={`rotate(${-90 + frame * 0.2} 50 50)`}
      />
      <circle cx="50" cy="50" r="37" fill="none" stroke="rgba(212,175,55,0.25)" strokeWidth="0.8" />
      {/* faceted gem */}
      <g opacity={interpolate(progress, [0.4, 1], [0, 1], { extrapolateLeft: "clamp" })}>
        <path d="M30 42 L40 30 H60 L70 42 L50 72 Z" fill="rgba(212,175,55,0.12)" stroke="url(#lg)" strokeWidth="2" />
        <path d="M30 42 H70 M40 30 L45 42 L50 72 L55 42 L60 30 M45 42 L50 30 L55 42" fill="none" stroke="url(#lg)" strokeWidth="1.3" />
      </g>
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Device frames for demo mock-ups                                     */
/* ------------------------------------------------------------------ */

// Navigation mirrors src/app/sales/app/layout.tsx (NAVIGATION_GROUPS)
export const NAV_GROUPS: { title: string; items: { name: string; icon: IconName }[] }[] = [
  {
    title: "Boshqaruv & Balans",
    items: [
      { name: "Asosiy Panel", icon: "chart" },
      { name: "Zavod Bilan Hisob", icon: "factory" },
    ],
  },
  {
    title: "Ombor & Konsignatsiya",
    items: [
      { name: "Boshqaruvchi Ombori", icon: "box" },
      { name: "Scanner 564 Tarqatish", icon: "scan" },
    ],
  },
  {
    title: "Savdo & Kassalar",
    items: [
      { name: "Sotuvchilar & Bozor Qarzi", icon: "users" },
      { name: "Mijozlar va Nasiya", icon: "receipt" },
      { name: "Kassa & Valyuta", icon: "cash" },
    ],
  },
  {
    title: "Afinaj & Zavod Balansi",
    items: [
      { name: "Afinaj / Lom Pateriya", icon: "flask" },
      { name: "Naqdga Oltin Xarid", icon: "coin" },
    ],
  },
  {
    title: "Tahlil & Tizim",
    items: [
      { name: "Moliyaviy Hisobotlar", icon: "report" },
      { name: "BarTender & Modellar", icon: "tag" },
      { name: "Xodimlar & Telegram", icon: "telegram" },
      { name: "Sozlamalar & Import", icon: "gear" },
    ],
  },
];

export const AppFrame: React.FC<{
  active: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  pageTitle: string;
  delay?: number;
  zoom?: number;
}> = ({ active, children, style, pageTitle, delay = 0, zoom = 1 }) => {
  const p = useSpring(delay, 22);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        top: 228,
        height: 660,
        borderRadius: 22,
        overflow: "hidden",
        border: `1px solid rgba(148,163,200,0.22)`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,175,55,0.08)",
        background: C.navy900,
        display: "flex",
        flexDirection: "column",
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [50, 0])}px) scale(${interpolate(p, [0, 1], [0.97, 1])})`,
        fontFamily: SANS,
        color: C.text,
        ...style,
      }}
    >
      {/* window bar */}
      <div
        style={{
          height: 44,
          background: C.navy950,
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          gap: 8,
          borderBottom: `1px solid ${C.lineSoft}`,
        }}
      >
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 12, background: c, opacity: 0.75 }} />
        ))}
        <div
          style={{
            marginLeft: 18,
            flex: 1,
            maxWidth: 560,
            height: 26,
            borderRadius: 8,
            background: "rgba(148,163,200,0.08)",
            color: C.dim,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 8,
          }}
        >
          <Icon name="lock" size={14} color={C.dim} /> goldia-sales · {pageTitle}
        </div>
        <div style={{ flex: 1 }} />
        <Pill color={C.green} style={{ fontSize: 13, padding: "3px 10px" }}>
          ● Onlayn
        </Pill>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* sidebar */}
        <div
          style={{
            width: 290,
            background: "linear-gradient(180deg, #08122A 0%, #060E20 100%)",
            borderRight: `1px solid ${C.lineSoft}`,
            padding: "18px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 8px" }}>
            <LogoMark size={34} />
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 22, color: C.text }}>
              Goldia <GoldText>Sales</GoldText>
            </div>
          </div>
          {NAV_GROUPS.map((g) => (
            <div key={g.title}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: 1.4,
                  color: C.dim,
                  textTransform: "uppercase",
                  padding: "2px 10px 4px",
                }}
              >
                {g.title}
              </div>
              {g.items.map((it) => {
                const on = it.name === active;
                return (
                  <div
                    key={it.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "5px 10px",
                      borderRadius: 9,
                      fontSize: 13.5,
                      fontWeight: on ? 700 : 500,
                      color: on ? C.goldPale : C.muted,
                      background: on ? "linear-gradient(90deg, rgba(212,175,55,0.24), rgba(212,175,55,0.04))" : undefined,
                      borderLeft: on ? `3px solid ${C.gold}` : "3px solid transparent",
                    }}
                  >
                    <Icon name={it.icon} size={16} color={on ? C.gold : C.dim} />
                    {it.name}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* main */}
        <div style={{ flex: 1, padding: 26 / zoom, position: "relative", minWidth: 0, zoom }}>{children}</div>
      </div>
    </div>
  );
};

export const PhoneFrame: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <div
    style={{
      width: 372,
      height: 760,
      borderRadius: 54,
      padding: 12,
      background: "linear-gradient(145deg, #2A3550, #0A1020)",
      boxShadow: "0 50px 120px rgba(0,0,0,0.65), 0 0 0 2px rgba(212,175,55,0.25), inset 0 0 0 2px rgba(255,255,255,0.06)",
      ...style,
    }}
  >
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 44,
        overflow: "hidden",
        background: C.navy900,
        position: "relative",
        fontFamily: SANS,
        color: C.text,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          width: 110,
          height: 30,
          borderRadius: 20,
          background: "#000",
          zIndex: 5,
        }}
      />
      {children}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Subtitles                                                           */
/* ------------------------------------------------------------------ */

export type Cue = { text: string; from: number; to: number };

export const Subtitles: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const cue = cues.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;
  const fadeIn = interpolate(frame, [cue.from, cue.from + 6], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [cue.to - 5, cue.to], [1, 0], { extrapolateLeft: "clamp" });
  const o = Math.min(fadeIn, fadeOut);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 54, pointerEvents: "none" }}>
      <div
        style={{
          opacity: o,
          transform: `translateY(${(1 - fadeIn) * 8}px)`,
          maxWidth: 1480,
          textAlign: "center",
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 42,
          lineHeight: 1.3,
          color: "#FFFFFF",
          padding: "14px 32px",
          borderRadius: 16,
          background: "rgba(4,9,21,0.78)",
          border: "1px solid rgba(212,175,55,0.25)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
          textShadow: "0 2px 6px rgba(0,0,0,0.6)",
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};
