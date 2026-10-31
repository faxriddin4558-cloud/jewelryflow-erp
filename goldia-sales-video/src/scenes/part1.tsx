import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, GOLD_GRADIENT, SANS, SERIF, fmt } from "../theme";
import {
  AnimatedNumber,
  AppFrame,
  Card,
  DemoBadge,
  FadeUp,
  GoldText,
  Icon,
  IconBadge,
  Label,
  LogoMark,
  NAV_GROUPS,
  Pill,
  ScaleIn,
  SceneHeader,
  ease,
  useSpring,
} from "../components/ui";

export type SceneProps = { dur: number };

/* ============================== 01 INTRO ============================== */
export const IntroScene: React.FC<SceneProps> = ({ dur }) => {
  const frame = useCurrentFrame();
  const ring = ease(frame, 0, 55);
  const word = useSpring(22, 16);
  const tag = useSpring(44, 20);
  const shine = interpolate(frame, [40, 110], [-30, 130], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const out = interpolate(frame, [dur - 30, dur], [1, 1.04], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${out})` }}>
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: 900,
          background: "radial-gradient(circle, rgba(212,175,55,0.18) 0%, rgba(212,175,55,0) 60%)",
          opacity: ring,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -90 }}>
        <div style={{ transform: `scale(${interpolate(ring, [0, 1], [0.7, 1])})` }}>
          <LogoMark size={210} progress={ring} />
        </div>
        <div
          style={{
            marginTop: 24,
            opacity: word,
            transform: `translateY(${interpolate(word, [0, 1], [30, 0])}px)`,
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: 150,
            letterSpacing: 10,
            lineHeight: 1,
            position: "relative",
          }}
        >
          <span
            style={{
              backgroundImage: `linear-gradient(105deg, rgba(255,255,255,0) ${shine - 12}%, rgba(255,255,255,0.85) ${shine}%, rgba(255,255,255,0) ${shine + 12}%), ${GOLD_GRADIENT}`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            GOLDIA
          </span>
        </div>
        <div
          style={{
            opacity: word,
            fontFamily: SANS,
            fontWeight: 300 + 400,
            fontSize: 34,
            letterSpacing: 26,
            color: C.text,
            marginTop: 14,
            marginRight: -26,
          }}
        >
          SALES
        </div>
        <div
          style={{
            marginTop: 40,
            opacity: tag,
            transform: `translateY(${interpolate(tag, [0, 1], [20, 0])}px)`,
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 38,
            color: C.goldLight,
          }}
        >
          Savdo · Konsignatsiya · Kassa — yagona tizimda
        </div>
        <div
          style={{
            marginTop: 22,
            opacity: tag,
            fontFamily: SANS,
            fontSize: 20,
            letterSpacing: 4,
            color: C.muted,
            textTransform: "uppercase",
          }}
        >
          Direktor uchun taqdimot
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ============================== 02 PROBLEM ============================== */
const CHAIN: { label: string; icon: "factory" | "box" | "users" | "user" }[] = [
  { label: "Zavod", icon: "factory" },
  { label: "Ombor", icon: "box" },
  { label: "Sotuvchi", icon: "users" },
  { label: "Mijoz", icon: "user" },
];

export const ProblemScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <SceneHeader kicker="Muammo" title={<>Har bir <GoldText>gramm</GoldText> hisobda bo‘lishi kerak</>} />
      {/* chain */}
      <div style={{ position: "absolute", top: 290, left: 160, right: 160, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {CHAIN.map((c, i) => {
          const d = 20 + i * 22;
          const line = ease(frame, d + 10, d + 32);
          return (
            <React.Fragment key={c.label}>
              <ScaleIn delay={d}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: 200 }}>
                  <IconBadge name={c.icon} size={110} glow />
                  <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 30, color: C.text }}>{c.label}</div>
                </div>
              </ScaleIn>
              {i < CHAIN.length - 1 ? (
                <div style={{ flex: 1, height: 4, margin: "0 10px 50px", background: "rgba(148,163,200,0.12)", borderRadius: 4, position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${line * 100}%`, background: GOLD_GRADIENT, borderRadius: 4, boxShadow: "0 0 14px rgba(212,175,55,0.6)" }} />
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
      {/* payment types */}
      <FadeUp delay={130} style={{ position: "absolute", top: 540, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 22 }}>
        <Label style={{ alignSelf: "center", marginRight: 10 }}>To‘lov turlari:</Label>
        <Pill style={{ fontSize: 24, padding: "10px 22px" }}>Naqd so‘m (UZS)</Pill>
        <Pill style={{ fontSize: 24, padding: "10px 22px" }}>Dollar (USD)</Pill>
        <Pill style={{ fontSize: 24, padding: "10px 22px" }}>Lom oltin (g)</Pill>
        <Pill style={{ fontSize: 24, padding: "10px 22px" }}>Nasiya</Pill>
      </FadeUp>
      {/* pains */}
      <div style={{ position: "absolute", top: 670, left: 160, right: 160, display: "flex", gap: 28 }}>
        {[
          ["Qog‘oz daftar va Excel", "Ma’lumot tarqoq, xato topish qiyin"],
          ["Sotuvchidagi tovar", "Kimda qancha gramm borligi noaniq"],
          ["Turli proba va valyuta", "585 · 750 · 999, so‘m va dollar aralash"],
        ].map(([t, s], i) => (
          <FadeUp key={t} delay={190 + i * 16} style={{ flex: 1 }}>
            <Card style={{ padding: "28px 30px", borderColor: "rgba(255,111,111,0.35)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 34, height: 34, borderRadius: 34, background: "rgba(255,111,111,0.15)", color: C.red, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>!</span>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{t}</div>
              </div>
              <div style={{ fontSize: 20, color: C.muted, marginTop: 10 }}>{s}</div>
            </Card>
          </FadeUp>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ============================== 03 SOLUTION ============================== */
const GROUP_ICONS = ["chart", "box", "cash", "flask", "report"] as const;

export const SolutionScene: React.FC<SceneProps> = () => (
  <AbsoluteFill>
    <SceneHeader kicker="Yechim" title={<>Goldia Sales — <GoldText>5 ta yo‘nalish</GoldText>, bitta tizim</>} />
    <div style={{ position: "absolute", top: 290, left: 120, right: 120, display: "flex", gap: 22 }}>
      {NAV_GROUPS.map((g, i) => (
        <FadeUp key={g.title} delay={30 + i * 26} style={{ flex: 1 }}>
          <Card highlight={i === 0} style={{ padding: "30px 26px", height: 470, display: "flex", flexDirection: "column", gap: 18 }}>
            <IconBadge name={GROUP_ICONS[i]} size={72} glow />
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 30, lineHeight: 1.15, minHeight: 72 }}>
              {g.title.split(" & ").map((w, k) => (
                <div key={k}>{k ? <GoldText>&amp; {w}</GoldText> : w}</div>
              ))}
            </div>
            <div style={{ height: 1, background: C.line }} />
            {g.items.map((it) => (
              <div key={it.name} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 22, color: C.text, fontWeight: 500 }}>
                <Icon name={it.icon} size={24} color={C.gold} />
                {it.name}
              </div>
            ))}
          </Card>
        </FadeUp>
      ))}
    </div>
  </AbsoluteFill>
);

/* ============================== 04 DASHBOARD ============================== */
// Structure mirrors ProfitAccountingBanner (Jami Aktivlar → Majburiyatlar → Sof Aktiv, 585 g ekvivalenti)
const ASSETS = [
  { label: "Ombor & sotuvchidagi tovar", v: 4862.4, icon: "box" as const },
  { label: "Mijozlar sof nasiyasi", v: 1284.7, icon: "receipt" as const },
  { label: "Sotuvchilar kassasi", v: 612.3, icon: "cash" as const },
  { label: "Menejer seyfi", v: 938.1, icon: "safe" as const },
  { label: "Afinaj oltin (585 eq)", v: 245.6, icon: "flask" as const },
];

export const DashboardScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const total = ASSETS.reduce((a, b) => a + b.v, 0);
  const net = total - 5120.0 - 310.5;
  const glow = 0.5 + 0.5 * Math.sin(frame / 14);
  return (
    <AbsoluteFill>
      <SceneHeader step="01" kicker="Asosiy panel" title={<>Sof aktiv — <GoldText>585 g ekvivalentida</GoldText></>} />
      <DemoBadge />
      <AppFrame active="Asosiy Panel" pageTitle="Asosiy Panel" delay={8} zoom={1.22}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>Moliyaviy holat (585 g)</div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Aktivlar minus tashqi majburiyatlar</div>
          </div>
          <Pill>Bugungi 585 kursi: 1 035 000 so‘m/g</Pill>
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 20 }}>
          {ASSETS.map((a, i) => (
            <FadeUp key={a.label} delay={30 + i * 10} style={{ flex: 1 }}>
              <Card style={{ padding: "16px 16px", borderRadius: 16 }}>
                <Icon name={a.icon} size={22} />
                <div style={{ fontSize: 13, color: C.muted, marginTop: 8, height: 34, fontWeight: 600 }}>{a.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
                  <AnimatedNumber value={a.v} decimals={1} delay={36 + i * 10} />
                  <span style={{ fontSize: 15, color: C.muted, fontWeight: 600 }}> g</span>
                </div>
              </Card>
            </FadeUp>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 16 }}>
          <FadeUp delay={110} style={{ flex: 1.2 }}>
            <Card style={{ padding: "16px 20px", borderRadius: 16 }}>
              <Label>1. Jami aktivlar</Label>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6 }}>
                <AnimatedNumber value={total} decimals={1} delay={110} /> g
              </div>
            </Card>
          </FadeUp>
          <FadeUp delay={170} style={{ flex: 1 }}>
            <Card style={{ padding: "16px 20px", borderRadius: 16, borderColor: "rgba(255,111,111,0.35)" }}>
              <Label>Zavod majburiyati</Label>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6, color: C.red }}>
                <AnimatedNumber value={-5120.0} decimals={1} delay={170} /> g
              </div>
            </Card>
          </FadeUp>
          <FadeUp delay={190} style={{ flex: 1 }}>
            <Card style={{ padding: "16px 20px", borderRadius: 16, borderColor: "rgba(255,111,111,0.35)" }}>
              <Label>Tashqi majburiyatlar</Label>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6, color: C.red }}>
                <AnimatedNumber value={-310.5} decimals={1} delay={190} /> g
              </div>
            </Card>
          </FadeUp>
        </div>
        <FadeUp delay={240}>
          <Card
            highlight
            style={{
              marginTop: 16,
              padding: "20px 28px",
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: `0 0 ${30 + glow * 30}px rgba(212,175,55,${0.18 + glow * 0.15})`,
            }}
          >
            <div>
              <Label style={{ color: C.goldLight }}>Jami sof aktiv (585 g)</Label>
              <div style={{ fontSize: 14, color: C.muted, marginTop: 6 }}>Kapital harakatlariga tuzatilgan</div>
            </div>
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 64 }}>
              <GoldText>
                <AnimatedNumber value={net} decimals={1} delay={245} duration={50} /> g
              </GoldText>
            </div>
          </Card>
        </FadeUp>
      </AppFrame>
    </AbsoluteFill>
  );
};

/* ============================== 05 RATES ============================== */
export const RatesScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const arrow = ease(frame, 150, 190);
  return (
    <AbsoluteFill>
      <SceneHeader step="02" kicker="Kurslar" title={<>Kunlik <GoldText>585 kursi</GoldText> va Markaziy bank kursi</>} />
      <DemoBadge />
      <div style={{ position: "absolute", top: 270, left: 120, right: 120, display: "flex", gap: 30 }}>
        <FadeUp delay={20} style={{ flex: 1 }}>
          <Card highlight style={{ padding: 34, height: 270 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Label style={{ color: C.goldLight }}>Bugungi 585 kursi</Label>
              <IconBadge name="coin" size={56} />
            </div>
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 76, marginTop: 18 }}>
              <GoldText>
                <AnimatedNumber value={1035000} delay={30} />
              </GoldText>
              <span style={{ fontFamily: SANS, fontSize: 26, color: C.muted, fontWeight: 600 }}> so‘m / g</span>
            </div>
            <div style={{ fontSize: 19, color: C.muted, marginTop: 14 }}>Direktor yoki boshqaruvchi kuniga bir marta kiritadi</div>
          </Card>
        </FadeUp>
        <FadeUp delay={60} style={{ flex: 1 }}>
          <Card style={{ padding: 34, height: 270 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Label>Dollar kursi · CBU</Label>
              <IconBadge name="cash" size={56} />
            </div>
            <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 76, marginTop: 18 }}>
              <AnimatedNumber value={12180} delay={70} />
              <span style={{ fontFamily: SANS, fontSize: 26, color: C.muted, fontWeight: 600 }}> so‘m / $</span>
            </div>
            <div style={{ fontSize: 19, color: C.muted, marginTop: 14 }}>O‘zbekiston Markaziy banki ma’lumoti · 1 soatlik kesh</div>
          </Card>
        </FadeUp>
      </div>
      {/* conversion */}
      <FadeUp delay={140} style={{ position: "absolute", top: 600, left: 120, right: 120 }}>
        <Card style={{ padding: "26px 36px", display: "flex", alignItems: "center", gap: 30 }}>
          <Label style={{ width: 200 }}>Avtomatik hisob</Label>
          {[
            ["1 035 000 so‘m", "1.000 g"],
            ["$1 000 → 12 180 000 so‘m", "11.768 g"],
          ].map(([a, b], i) => (
            <div key={a} style={{ display: "flex", alignItems: "center", gap: 18, flex: 1, opacity: ease(frame, 150 + i * 30, 175 + i * 30) }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{a}</div>
              <div style={{ width: 70 * arrow, overflow: "hidden" }}>
                <Icon name="arrow" size={40} />
              </div>
              <div style={{ fontSize: 34, fontWeight: 800 }}>
                <GoldText>{b}</GoldText>
                <span style={{ fontSize: 18, color: C.muted }}> (585)</span>
              </div>
            </div>
          ))}
        </Card>
      </FadeUp>
    </AbsoluteFill>
  );
};

/* ============================== 06 FACTORY ============================== */
const FACTORY_ROWS = [
  ["JF-M-0012", "Uzuk «Klassik»", "585", 3.42],
  ["JF-M-0027", "Zirak «Tomchi»", "585", 2.18],
  ["JF-M-0041", "Bilaguzuk «Nafis»", "585", 8.75],
  ["JF-M-0053", "Zanjir «Royal»", "750", 6.3],
] as const;

export const FactoryScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <SceneHeader step="03" kicker="Zavoddan qabul" title={<>Kirim: model · proba · <GoldText>vazn</GoldText></>} />
      <DemoBadge />
      <AppFrame active="Zavod Bilan Hisob" pageTitle="Zavoddan Tovar Qabul Qilish" delay={6} zoom={1.32}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Zavoddan tovar qabul qilish</div>
        <div style={{ display: "flex", gap: 20, marginTop: 18 }}>
          <div style={{ flex: 1.6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px 120px", padding: "10px 16px", fontSize: 13, fontWeight: 800, letterSpacing: 1.2, color: C.dim, textTransform: "uppercase" }}>
              <div>Model kodi</div>
              <div>Mahsulot</div>
              <div>Proba</div>
              <div style={{ textAlign: "right" }}>Asl vazn</div>
            </div>
            {FACTORY_ROWS.map((r, i) => {
              const d = 30 + i * 22;
              const o = ease(frame, d, d + 16);
              return (
                <div
                  key={r[0]}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "150px 1fr 90px 120px",
                    alignItems: "center",
                    padding: "14px 16px",
                    marginBottom: 8,
                    borderRadius: 12,
                    background: "rgba(24,48,90,0.55)",
                    border: `1px solid ${C.lineSoft}`,
                    opacity: o,
                    transform: `translateX(${(1 - o) * -30}px)`,
                    fontSize: 19,
                  }}
                >
                  <div style={{ color: C.goldLight, fontWeight: 700, fontFamily: "monospace", fontSize: 18 }}>{r[0]}</div>
                  <div style={{ fontWeight: 600 }}>{r[1]}</div>
                  <div><Pill style={{ fontSize: 14, padding: "3px 10px" }}>{r[2]}</Pill></div>
                  <div style={{ textAlign: "right", fontWeight: 800 }}>{r[3].toFixed(2)} g</div>
                </div>
              );
            })}
            <FadeUp delay={130}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", borderTop: `1px solid ${C.line}`, marginTop: 6, fontSize: 19 }}>
                <span style={{ color: C.muted }}>Jami qabul qilingan asl vazn:</span>
                <b>20.65 g</b>
              </div>
            </FadeUp>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            <FadeUp delay={150}>
              <Card style={{ padding: 20, borderRadius: 16 }}>
                <Label>Zavod ustamasi (%)</Label>
                <div style={{ fontSize: 40, fontWeight: 800, marginTop: 6 }}>
                  <GoldText>12%</GoldText>
                </div>
              </Card>
            </FadeUp>
            <FadeUp delay={175}>
              <Card style={{ padding: 20, borderRadius: 16 }}>
                <Label>585 ekvivalenti</Label>
                <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>22.427 g</div>
                <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>750 proba avtomatik 585 ga keltiriladi</div>
              </Card>
            </FadeUp>
            <FadeUp delay={205}>
              <Card highlight style={{ padding: 20, borderRadius: 16 }}>
                <Label style={{ color: C.goldLight }}>Zavod majburiyati (+ustama)</Label>
                <div style={{ fontSize: 36, fontWeight: 800, marginTop: 6 }}>
                  <GoldText><AnimatedNumber value={25.118} decimals={3} delay={210} /> g</GoldText>
                </div>
              </Card>
            </FadeUp>
          </div>
        </div>
      </AppFrame>
    </AbsoluteFill>
  );
};

/* ============================== 07 SCANNER ============================== */
const SCAN_ITEMS = [
  ["2000000124", "Uzuk «Klassik»", 3.42],
  ["2000000275", "Zirak «Tomchi»", 2.18],
  ["2000000418", "Bilaguzuk «Nafis»", 8.75],
] as const;

const Barcode: React.FC<{ seed: string; w?: number; h?: number }> = ({ seed, w = 220, h = 90 }) => {
  const bars: number[] = [];
  for (let i = 0; i < 46; i++) bars.push(((seed.charCodeAt(i % seed.length) * (i + 7)) % 4) + 1);
  let x = 0;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${bars.reduce((a, b) => a + b + 1.4, 0)} 50`} preserveAspectRatio="none">
      {bars.map((b, i) => {
        const r = <rect key={i} x={x} y={0} width={b * 0.7} height={50} fill={i % 2 ? "#0B1733" : "#0B1733"} />;
        x += b + 1.4;
        return r;
      })}
    </svg>
  );
};

const QrMock: React.FC<{ size?: number }> = ({ size = 150 }) => {
  const n = 21;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const finder = (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
      let on: boolean;
      if (finder) {
        const fx = x > n - 8 ? x - (n - 7) : x;
        const fy = y > n - 8 ? y - (n - 7) : y;
        on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
      } else on = ((x * 7 + y * 13 + x * y) % 5) < 2;
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#0B1733" />);
    }
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${n + 2} ${n + 2}`} style={{ background: "#fff", borderRadius: 8 }}>
      {cells}
    </svg>
  );
};

export const ScannerScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const scanned = SCAN_ITEMS.filter((_, i) => frame > 60 + i * 55).length;
  const active = Math.min(scanned, SCAN_ITEMS.length - 1);
  const laser = (Math.sin(frame / 7) + 1) / 2;
  const total = SCAN_ITEMS.slice(0, scanned).reduce((a, b) => a + b[2], 0);
  return (
    <AbsoluteFill>
      <SceneHeader step="04" kicker="Scanner 564 · konsignatsiya" title={<>Shtrix-kod → <GoldText>sotuvchi hisobiga</GoldText></>} />
      <DemoBadge />
      <AppFrame active="Scanner 564 Tarqatish" pageTitle="Scanner 564 Konsignatsiya Tarqatish" delay={6} zoom={1.3}>
        <div style={{ display: "flex", gap: 22, height: "100%" }}>
          {/* scanner */}
          <div style={{ width: 330, display: "flex", flexDirection: "column", gap: 14 }}>
            <Card style={{ padding: 20, borderRadius: 16 }}>
              <Label>Sotuvchi</Label>
              <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 18, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                Sotuvchi (Toshkent) <span style={{ color: C.gold }}>▾</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 8 }}>Direktor tanlanmaydi — faqat sotuvchilar</div>
            </Card>
            <Card highlight style={{ padding: 20, borderRadius: 16, alignItems: "center", display: "flex", flexDirection: "column" }}>
              <Label style={{ alignSelf: "flex-start", color: C.goldLight }}>Skaner kutmoqda…</Label>
              <div style={{ position: "relative", marginTop: 14, background: "#F5F1E4", padding: "14px 16px", borderRadius: 10 }}>
                <Barcode seed={SCAN_ITEMS[active][0]} />
                <div style={{ textAlign: "center", fontFamily: "monospace", color: "#0B1733", fontSize: 16, marginTop: 4, letterSpacing: 2 }}>
                  {SCAN_ITEMS[active][0]}
                </div>
                <div style={{ position: "absolute", left: 6, right: 6, top: 14 + laser * 86, height: 3, background: "#FF3B3B", boxShadow: "0 0 12px #FF3B3B", borderRadius: 2 }} />
              </div>
            </Card>
          </div>
          {/* consignment list */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 21, fontWeight: 800 }}>Konsignatsiyaga berilayotgan tovar</div>
              <Pill>{scanned} dona · {total.toFixed(2)} g</Pill>
            </div>
            <div style={{ marginTop: 14 }}>
              {SCAN_ITEMS.map((it, i) => {
                const t0 = 60 + i * 55;
                const o = ease(frame, t0, t0 + 14);
                const flash = interpolate(frame, [t0, t0 + 6, t0 + 30], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                return (
                  <div
                    key={it[0]}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "14px 18px",
                      marginBottom: 10,
                      borderRadius: 12,
                      background: `rgba(${Math.round(24 + flash * 40)},${Math.round(48 + flash * 80)},${Math.round(90 + flash * 20)},0.6)`,
                      border: `1px solid ${flash > 0.1 ? C.green : C.lineSoft}`,
                      opacity: o,
                      transform: `translateY(${(1 - o) * 20}px)`,
                    }}
                  >
                    <Icon name="check" size={24} color={C.green} />
                    <div style={{ fontFamily: "monospace", color: C.goldLight, fontSize: 16, width: 130 }}>{it[0]}</div>
                    <div style={{ flex: 1, fontSize: 19, fontWeight: 600 }}>{it[1]}</div>
                    <div style={{ fontSize: 19, fontWeight: 800 }}>{it[2].toFixed(2)} g</div>
                  </div>
                );
              })}
            </div>
            {/* BarTender label */}
            <FadeUp delay={250}>
              <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 12 }}>
                <div style={{ background: "#FBF7EA", borderRadius: 12, padding: 12, display: "flex", gap: 14, alignItems: "center", color: "#0B1733", boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>
                  <QrMock size={92} />
                  <div style={{ fontFamily: SANS }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>JF-M-0012</div>
                    <div style={{ fontSize: 14 }}>Uzuk «Klassik» · 585</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>3.42 g</div>
                  </div>
                </div>
                <div style={{ fontSize: 16, color: C.muted, lineHeight: 1.45 }}>
                  <b style={{ color: C.text }}>BarTender & Modellar</b>
                  <br />
                  Model kodi + QR payload · BarTender uchun CSV eksport
                </div>
              </div>
            </FadeUp>
          </div>
        </div>
      </AppFrame>
    </AbsoluteFill>
  );
};

export { fmt };
