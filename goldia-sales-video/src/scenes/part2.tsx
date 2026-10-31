import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, GOLD_GRADIENT, SANS, SERIF } from "../theme";
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
  PhoneFrame,
  Pill,
  ScaleIn,
  SceneHeader,
  ease,
  useSpring,
} from "../components/ui";
import type { SceneProps } from "./part1";

/* ============================== 08 SELLER MOBILE ============================== */
const VITRINA = [
  ["Uzuk «Klassik»", "585", 3.42],
  ["Zirak «Tomchi»", "585", 2.18],
  ["Bilaguzuk «Nafis»", "585", 8.75],
] as const;

export const SellerScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  // phase 1: vitrina; phase 2: sale form slides in
  const sale = ease(frame, 120, 150);
  const pays = [
    { label: "Lom oltin", v: "2.000 g", g: 2.0, t: 170 },
    { label: "Naqd pul (UZS)", v: "1 035 000 so‘m", g: 1.0, t: 200 },
  ];
  const paid = pays.filter((p) => frame > p.t + 10).reduce((a, b) => a + b.g, 0);
  return (
    <AbsoluteFill>
      <SceneHeader step="05" kicker="Sotuvchi mobil ish joyi" title={<>Sotuv, to‘lov va <GoldText>nasiya</GoldText> — telefonda</>} />
      <DemoBadge />
      <div style={{ position: "absolute", top: 222, left: 200, transform: "scale(1.0)" }}>
        <ScaleIn delay={10}>
          <PhoneFrame style={{ height: 690, width: 350 }}>
            <div style={{ padding: "52px 18px 18px", position: "relative", height: `${100 / 1.24}%`, zoom: 1.24 }}>
              {/* vitrina */}
              <div style={{ position: "absolute", inset: "52px 18px 18px", opacity: 1 - sale, transform: `translateX(${-sale * 60}px)` }}>
                <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>SOTUVCHI (TOSHKENT)</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>O‘zimdagi mahsulotlar</div>
                <div style={{ fontSize: 13, color: C.muted }}>Vitrina · 3 dona · 14.35 g</div>
                {VITRINA.map((v, i) => (
                  <FadeUp key={v[0]} delay={30 + i * 12} distance={14}>
                    <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: i === 0 ? "rgba(212,175,55,0.16)" : "rgba(24,48,90,0.6)", border: `1px solid ${i === 0 ? C.gold : C.lineSoft}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{v[0]}</div>
                        <div style={{ fontSize: 12.5, color: C.muted }}>Proba {v[1]}</div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 17 }}>{v[2].toFixed(2)} g</div>
                    </div>
                  </FadeUp>
                ))}
                <FadeUp delay={70} distance={14}>
                  <div style={{ marginTop: 18, padding: 14, borderRadius: 14, background: "rgba(7,16,36,0.8)", border: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>MENING KASSAM</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 14 }}>
                      <span>Naqd (UZS)</span><b>4 140 000</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 14 }}>
                      <span>Dollar</span><b>$350</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 14 }}>
                      <span>Lom</span><b>6.240 g</b>
                    </div>
                  </div>
                </FadeUp>
                <div style={{ marginTop: 16, padding: "14px 0", textAlign: "center", borderRadius: 14, background: GOLD_GRADIENT, color: C.navy900, fontWeight: 800, fontSize: 17 }}>
                  Mijozga sotish
                </div>
              </div>
              {/* sale form */}
              <div style={{ position: "absolute", inset: "52px 18px 18px", opacity: sale, transform: `translateX(${(1 - sale) * 60}px)` }}>
                <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>YANGI SAVDO</div>
                <div style={{ fontSize: 21, fontWeight: 800, marginTop: 4 }}>Uzuk «Klassik» · 3.42 g</div>
                <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(24,48,90,0.6)", fontSize: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.muted }}>Mijoz</span><b>Aziza K.</b></div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}><span style={{ color: C.muted }}>Mijoz ustamasi</span><b>18%</b></div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}><span style={{ color: C.muted }}>Jami (585)</span><b style={{ color: C.goldLight }}>4.036 g</b></div>
                </div>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, marginTop: 14 }}>TO‘LOV</div>
                {pays.map((p) => {
                  const o = ease(frame, p.t, p.t + 14);
                  return (
                    <div key={p.label} style={{ marginTop: 8, padding: 12, borderRadius: 12, border: `1px solid ${C.green}66`, background: "rgba(65,217,155,0.08)", display: "flex", justifyContent: "space-between", fontSize: 14, opacity: o, transform: `scale(${0.9 + o * 0.1})` }}>
                      <span>{p.label}</span><b>{p.v}</b>
                    </div>
                  );
                })}
                <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: `1px solid ${C.gold}88`, background: "rgba(212,175,55,0.1)", opacity: ease(frame, 240, 256) }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span>Nasiyaga yoziladi</span><b style={{ color: C.goldLight }}>1.036 g</b>
                  </div>
                </div>
                <div style={{ marginTop: 16, padding: "14px 0", textAlign: "center", borderRadius: 14, background: GOLD_GRADIENT, color: C.navy900, fontWeight: 800, fontSize: 17, opacity: ease(frame, 260, 275) }}>
                  Savdoni tasdiqlash
                </div>
              </div>
            </div>
          </PhoneFrame>
        </ScaleIn>
      </div>
      {/* explanation side */}
      <div style={{ position: "absolute", top: 280, left: 680, right: 140, display: "flex", flexDirection: "column", gap: 22 }}>
        {[
          { icon: "box" as const, t: "Vitrina", s: "Sotuvchi faqat o‘ziga biriktirilgan tovarni ko‘radi", d: 30 },
          { icon: "cash" as const, t: "Aralash to‘lov", s: "Naqd so‘m, dollar va lom oltin — bitta savdoda", d: 150 },
          { icon: "receipt" as const, t: "Nasiya avtomatik", s: "To‘lanmagan qism mijoz qarziga 585 g da yoziladi", d: 230 },
        ].map((b) => (
          <FadeUp key={b.t} delay={b.d}>
            <Card style={{ padding: "22px 26px", display: "flex", gap: 20, alignItems: "center" }}>
              <IconBadge name={b.icon} size={64} />
              <div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{b.t}</div>
                <div style={{ fontSize: 20, color: C.muted, marginTop: 4 }}>{b.s}</div>
              </div>
            </Card>
          </FadeUp>
        ))}
        <FadeUp delay={200}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, paddingLeft: 6 }}>
            <Label>To‘langan:</Label>
            <div style={{ flex: 1, height: 12, borderRadius: 12, background: "rgba(148,163,200,0.15)", overflow: "hidden" }}>
              <div style={{ width: `${(paid / 4.036) * 100}%`, height: "100%", background: GOLD_GRADIENT }} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{paid.toFixed(3)} / 4.036 g</div>
          </div>
        </FadeUp>
      </div>
    </AbsoluteFill>
  );
};

/* ============================== 09 RECEIPT + LEDGER ============================== */
const DEBTORS = [
  ["Aziza K.", "Nasiya / Savdo", 1.036],
  ["Bekzod R.", "Nasiya / Savdo", 4.512],
  ["Malika S.", "Bo‘lib to‘lash", 2.87],
  ["Sardor T.", "Nasiya / Savdo", 0.95],
] as const;

export const LedgerScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const rp = useSpring(10, 18);
  return (
    <AbsoluteFill>
      <SceneHeader step="06" kicker="Chek va nasiya daftari" title={<>Kim, qancha — <GoldText>aniq daftar</GoldText></>} />
      <DemoBadge />
      {/* receipt */}
      <div
        style={{
          position: "absolute",
          top: 240,
          left: 140,
          width: 420,
          opacity: rp,
          transform: `translateY(${(1 - rp) * 60}px) rotate(${(1 - rp) * -4 - 1.2}deg)`,
          background: "#FBF7EA",
          color: "#0B1733",
          borderRadius: 14,
          padding: "26px 28px 30px",
          fontFamily: SANS,
          boxShadow: "0 40px 90px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
          <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 28, color: "#9E7419" }}>GOLDIA</div>
          <div style={{ fontSize: 13, letterSpacing: 4, fontWeight: 700 }}>SALES</div>
        </div>
        <div style={{ textAlign: "center", fontSize: 13, color: "#55607A", marginTop: 4 }}>Savdo cheki · namuna</div>
        <div style={{ borderTop: "1px dashed #B9B3A0", margin: "16px 0" }} />
        {[
          ["Hujjat raqami:", "S-000128"],
          ["Mijoz:", "Aziza K."],
          ["Mahsulot:", "Uzuk «Klassik»"],
          ["Asl vazn:", "3.42 g · 585"],
          ["Mijoz ustamasi:", "18%"],
          ["Jami (585):", "4.036 g"],
          ["To‘landi:", "3.000 g"],
        ].map(([a, b]) => (
          <div key={a} style={{ display: "flex", justifyContent: "space-between", fontSize: 17, marginBottom: 8 }}>
            <span style={{ color: "#55607A" }}>{a}</span>
            <b>{b}</b>
          </div>
        ))}
        <div style={{ borderTop: "1px dashed #B9B3A0", margin: "12px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 800 }}>
          <span>Qolgan qarz:</span>
          <span style={{ color: "#B23B3B" }}>1.036 g</span>
        </div>
      </div>
      {/* ledger */}
      <div style={{ position: "absolute", top: 240, left: 640, right: 120 }}>
        <FadeUp delay={60}>
          <Card style={{ padding: 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800 }}>Qarz daftari — kim qancha berishi kerak</div>
              <Pill>585 g</Pill>
            </div>
            <div style={{ marginTop: 14 }}>
              {DEBTORS.map((d, i) => {
                const o = ease(frame, 80 + i * 14, 96 + i * 14);
                return (
                  <div key={d[0]} style={{ display: "grid", gridTemplateColumns: "1fr 220px 140px", padding: "13px 6px", borderBottom: `1px solid ${C.lineSoft}`, fontSize: 20, opacity: o, transform: `translateX(${(1 - o) * 24}px)` }}>
                    <b>{d[0]}</b>
                    <span style={{ color: C.muted }}>{d[1]}</span>
                    <span style={{ textAlign: "right", fontWeight: 800, color: C.goldLight }}>{d[2].toFixed(3)} g</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 6px 0", fontSize: 21, opacity: ease(frame, 150, 165) }}>
                <span style={{ color: C.muted }}>Mijozlarning haqiqiy qarzlari (585 eq):</span>
                <b><GoldText>9.368 g</GoldText></b>
              </div>
            </div>
          </Card>
        </FadeUp>
        <FadeUp delay={210}>
          <Card style={{ padding: "18px 24px", marginTop: 18, display: "flex", alignItems: "center", gap: 18 }}>
            <IconBadge name="sheet" size={56} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>Google Sheets import</div>
              <div style={{ fontSize: 17, color: C.muted, marginTop: 2 }}>Mavjud jadvallar CSV orqali tekshirilib, partiyalar bo‘yicha kiritiladi</div>
            </div>
            <Pill color={C.green}>✓ To‘g‘ri qatorlar</Pill>
          </Card>
        </FadeUp>
      </div>
    </AbsoluteFill>
  );
};

/* ============================== 10 MARKUP DIFFERENCE ============================== */
const MARKUP = [
  ["S-000128", "Uzuk «Klassik»", 3.42, 15, 18],
  ["S-000131", "Zirak «Tomchi»", 2.18, 15, 12],
  ["S-000135", "Bilaguzuk «Nafis»", 8.75, 14, 16],
] as const;

export const MarkupScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const rows = MARKUP.map((m) => ({ m, d: (m[2] * (m[4] - m[3])) / 100 }));
  const sum = rows.reduce((a, b) => a + b.d, 0);
  return (
    <AbsoluteFill>
      <SceneHeader step="07" kicker="Ustama farqi · kurs farqi" title={<>Farq grammda — <GoldText>ishorasi bilan</GoldText></>} />
      <DemoBadge />
      <AppFrame active="Moliyaviy Hisobotlar" pageTitle="Ustama farqi" delay={6} zoom={1.3}>
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1.7 }}>
            <div style={{ fontSize: 21, fontWeight: 800 }}>Ustama farqi (sotuvchi ↔ mijoz)</div>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px 90px 90px 120px", padding: "14px 12px 8px", fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.dim, textTransform: "uppercase" }}>
              <div>Savdo</div><div>Model</div><div>Vazn</div><div>Sotuvchi</div><div>Mijoz</div><div style={{ textAlign: "right" }}>Farq</div>
            </div>
            {rows.map(({ m, d }, i) => {
              const o = ease(frame, 40 + i * 30, 56 + i * 30);
              const pos = d >= 0;
              return (
                <div key={m[0]} style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px 90px 90px 120px", alignItems: "center", padding: "13px 12px", marginBottom: 8, borderRadius: 12, background: "rgba(24,48,90,0.55)", border: `1px solid ${pos ? "rgba(65,217,155,0.35)" : "rgba(255,111,111,0.4)"}`, fontSize: 17, opacity: o }}>
                  <div style={{ fontFamily: "monospace", color: C.goldLight }}>{m[0]}</div>
                  <div style={{ fontWeight: 600 }}>{m[1]}</div>
                  <div>{m[2].toFixed(2)} g</div>
                  <div>{m[3]}%</div>
                  <div>{m[4]}%</div>
                  <div style={{ textAlign: "right", fontWeight: 800, color: pos ? C.green : C.red }}>
                    {pos ? "+" : "−"}{Math.abs(d).toFixed(4)} g
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 14, marginTop: 14, opacity: ease(frame, 140, 160) }}>
              <Pill color={C.green}>Musbat: +{(rows.filter((r) => r.d > 0).reduce((a, b) => a + b.d, 0)).toFixed(4)} g</Pill>
              <Pill color={C.red}>Manfiy: −{Math.abs(rows.filter((r) => r.d < 0).reduce((a, b) => a + b.d, 0)).toFixed(4)} g</Pill>
              <Pill>Jami: +{sum.toFixed(4)} g</Pill>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            <FadeUp delay={70}>
              <Card style={{ padding: 20, borderRadius: 16 }}>
                <Label>Formula</Label>
                <div style={{ fontSize: 17, marginTop: 10, lineHeight: 1.5 }}>
                  Asl vazn × (<span style={{ color: C.goldLight }}>mijoz ustamasi</span> − <span style={{ color: C.goldLight }}>sotuvchi ustamasi</span>)
                </div>
                <div style={{ fontSize: 14, color: C.muted, marginTop: 8 }}>Savdo vaqtidagi qiymatlar saqlanadi</div>
              </Card>
            </FadeUp>
            <FadeUp delay={260}>
              <Card highlight style={{ padding: 20, borderRadius: 16 }}>
                <Label style={{ color: C.goldLight }}>Kompaniya kurs farqi</Label>
                <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Naqd → lom xaridi (585 g)</div>
                <div style={{ fontSize: 40, fontWeight: 800, marginTop: 8, color: C.green }}>
                  <AnimatedNumber value={0.418} decimals={3} delay={270} signed /> g
                </div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Xarid kursi va qabul kursi farqi</div>
              </Card>
            </FadeUp>
          </div>
        </div>
      </AppFrame>
    </AbsoluteFill>
  );
};

/* ============================== 11 REFINING ============================== */
export const RefiningScene: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const nodes = [
    { icon: "user" as const, t: "Mijozdan lom", s: "Turli proba", v: "12.480 g" },
    { icon: "flask" as const, t: "Afinaj", s: "Lom pateriya hisobi", v: "→ toza oltin" },
    { icon: "coin" as const, t: "Toza oltin", s: "585 ekvivalenti", v: "11.920 g" },
    { icon: "safe" as const, t: "Menejer seyfi", s: "Sof aktivga qo‘shiladi", v: "+11.920 g" },
  ];
  return (
    <AbsoluteFill>
      <SceneHeader step="08" kicker="Afinaj va oltin xarid" title={<>Lomdan <GoldText>toza oltin</GoldText>gacha</>} />
      <DemoBadge />
      <div style={{ position: "absolute", top: 300, left: 120, right: 120, display: "flex", alignItems: "center" }}>
        {nodes.map((n, i) => {
          const d = 20 + i * 40;
          const flow = ease(frame, d + 20, d + 45);
          return (
            <React.Fragment key={n.t}>
              <ScaleIn delay={d} style={{ width: 300 }}>
                <Card highlight={i === 3} style={{ padding: 26, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <IconBadge name={n.icon} size={84} glow />
                  <div style={{ fontSize: 28, fontWeight: 800 }}>{n.t}</div>
                  <div style={{ fontSize: 18, color: C.muted }}>{n.s}</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}><GoldText>{n.v}</GoldText></div>
                </Card>
              </ScaleIn>
              {i < nodes.length - 1 ? (
                <div style={{ flex: 1, height: 4, margin: "0 8px", position: "relative", background: "rgba(148,163,200,0.12)", borderRadius: 4 }}>
                  <div style={{ position: "absolute", inset: 0, width: `${flow * 100}%`, background: GOLD_GRADIENT, borderRadius: 4 }} />
                  <div style={{ position: "absolute", top: -6, left: `${((frame * 2.2) % 100)}%`, width: 16, height: 16, borderRadius: 16, background: C.goldLight, opacity: flow, boxShadow: "0 0 16px #F3D98A" }} />
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
      <FadeUp delay={240} style={{ position: "absolute", top: 690, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <Card style={{ padding: "22px 34px", display: "flex", alignItems: "center", gap: 22 }}>
          <IconBadge name="cash" size={60} />
          <div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>Naqdga oltin xarid</div>
            <div style={{ fontSize: 19, color: C.muted, marginTop: 4 }}>Xarid qilingan oltin ham 585 ekvivalentida menejer balansiga qo‘shiladi</div>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, marginLeft: 20 }}><GoldText>+5.000 g</GoldText></div>
        </Card>
      </FadeUp>
    </AbsoluteFill>
  );
};

/* ============================== 12 RECONCILIATION ============================== */
// Sections A–F mirror SellerReconciliationModal
const SECTIONS = [
  ["A", "Boshqaruvchidan qabul qilingan tovar", 120.5],
  ["B", "Sotilmagan tovar (sotuvchi javonida)", 64.2],
  ["C", "Mijozlarga sotilgan tovar", 56.3],
  ["D", "Mijozlar qarzdorligi (nasiya)", 18.4],
  ["E", "Sotuvchi g‘aznasi (kassa)", 22.15],
  ["F", "Menejerga topshirilgan to‘lov va qaytgan tovar", 15.75],
] as const;

export const ReconcileScene: React.FC<SceneProps> = ({ dur }) => {
  const frame = useCurrentFrame();
  const step = Math.max(26, Math.floor((dur * 0.62) / SECTIONS.length));
  const done = ease(frame, 40 + step * 6, 60 + step * 6);
  return (
    <AbsoluteFill>
      <SceneHeader step="09" kicker="Sotuvchi bilan hisob-kitob" title={<>Olti bo‘limli <GoldText>solishtirish</GoldText></>} />
      <DemoBadge />
      <div style={{ position: "absolute", top: 250, left: 120, right: 120, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
        {SECTIONS.map((s, i) => {
          const d = 30 + i * step;
          return (
            <FadeUp key={s[0]} delay={d}>
              <Card style={{ padding: "22px 24px", height: 168, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 46, height: 46, borderRadius: 12, background: GOLD_GRADIENT, color: C.navy900, fontWeight: 800, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF }}>{s[0]}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>{s[1]}</div>
                </div>
                <div style={{ fontSize: 38, fontWeight: 800 }}>
                  <AnimatedNumber value={s[2]} decimals={3} delay={d + 4} duration={30} />
                  <span style={{ fontSize: 18, color: C.muted, fontWeight: 600 }}> g (585)</span>
                </div>
              </Card>
            </FadeUp>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 650, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: done, transform: `scale(${0.94 + done * 0.06})` }}>
        <Card highlight style={{ padding: "20px 40px", display: "flex", alignItems: "center", gap: 30 }}>
          <IconBadge name="users" size={64} glow />
          <div style={{ fontSize: 22, color: C.muted, maxWidth: 360 }}>Sotuvchi (Toshkent) · namunaviy hisob-kitob</div>
          <div style={{ width: 1, height: 50, background: C.line }} />
          <div>
            <Label style={{ color: C.goldLight }}>Imzolangan bozor qarzi (+/−)</Label>
            <div style={{ fontSize: 40, fontWeight: 800, marginTop: 4 }}>
              <GoldText>0.000 g</GoldText> <span style={{ fontSize: 20, color: C.green }}>· muvozanat ✓</span>
            </div>
          </div>
        </Card>
      </div>
    </AbsoluteFill>
  );
};

/* ============================== 13 SECURITY ============================== */
export const SecurityScene: React.FC<SceneProps> = () => {
  const roles = [
    { t: "Direktor", s: "To‘liq vakolat, barcha hisobotlar", icon: "shield" as const },
    { t: "Boshqaruvchi", s: "Ombor, konsignatsiya, zavod hisobi", icon: "box" as const },
    { t: "Sotuvchi", s: "Faqat o‘z vitrinasi, kassasi va mijozlari", icon: "phone" as const },
  ];
  const badges = [
    { t: "Telegram orqali tasdiqlash", s: "OTP kod va hisob bog‘lash", icon: "telegram" as const },
    { t: "Audit jurnali", s: "Har bir amal qayd etiladi", icon: "history" as const },
    { t: "Takroriy yozuvdan himoya", s: "Idempotentlik kaliti", icon: "lock" as const },
    { t: "Sahifa himoyasi", s: "Rolga mos kirish (route guard)", icon: "shield" as const },
  ];
  return (
    <AbsoluteFill>
      <SceneHeader step="10" kicker="Xavfsizlik va nazorat" title={<>Har kim — <GoldText>o‘z vakolatida</GoldText></>} />
      <div style={{ position: "absolute", top: 260, left: 120, right: 120, display: "flex", gap: 24 }}>
        {roles.map((r, i) => (
          <FadeUp key={r.t} delay={20 + i * 20} style={{ flex: 1 }}>
            <Card highlight={i === 0} style={{ padding: 28, display: "flex", gap: 20, alignItems: "center" }}>
              <IconBadge name={r.icon} size={72} glow={i === 0} />
              <div>
                <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 34 }}>{r.t}</div>
                <div style={{ fontSize: 18, color: C.muted, marginTop: 4 }}>{r.s}</div>
              </div>
            </Card>
          </FadeUp>
        ))}
      </div>
      <div style={{ position: "absolute", top: 470, left: 120, right: 120, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {badges.map((b, i) => (
          <FadeUp key={b.t} delay={190 + i * 26}>
            <Card style={{ padding: "22px 26px", display: "flex", gap: 18, alignItems: "center" }}>
              <IconBadge name={b.icon} size={58} />
              <div>
                <div style={{ fontSize: 25, fontWeight: 800 }}>{b.t}</div>
                <div style={{ fontSize: 18, color: C.muted, marginTop: 3 }}>{b.s}</div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <Icon name="check" size={30} color={C.green} />
              </div>
            </Card>
          </FadeUp>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ============================== 14 OUTRO ============================== */
export const OutroScene: React.FC<SceneProps> = ({ dur }) => {
  const frame = useCurrentFrame();
  const ring = ease(frame, 0, 50);
  const fade = interpolate(frame, [dur - 24, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const points = ["585 g ekvivalentida yagona balans", "Sotuvchi va mijoz qarzi — real vaqtda", "Rollar, audit va Telegram tasdiqlash"];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div style={{ position: "absolute", width: 1000, height: 1000, borderRadius: 1000, background: "radial-gradient(circle, rgba(212,175,55,0.16) 0%, rgba(212,175,55,0) 60%)" }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -120 }}>
        <LogoMark size={150} progress={ring} />
        <FadeUp delay={14}>
          <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 104, letterSpacing: 6, marginTop: 14 }}>
            <GoldText>GOLDIA</GoldText>
            <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 40, letterSpacing: 14, color: C.text, marginLeft: 22 }}>SALES</span>
          </div>
        </FadeUp>
        <FadeUp delay={28}>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, fontSize: 40, color: C.goldLight, marginTop: 6 }}>
            Oltin hisobida grammgacha aniqlik
          </div>
        </FadeUp>
        <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
          {points.map((p, i) => (
            <FadeUp key={p} delay={50 + i * 14}>
              <Pill style={{ fontSize: 21, padding: "12px 22px" }}>
                <Icon name="check" size={20} /> {p}
              </Pill>
            </FadeUp>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
