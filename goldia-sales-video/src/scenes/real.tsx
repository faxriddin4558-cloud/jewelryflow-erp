import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, GOLD_GRADIENT, SANS, SERIF } from "../theme";
import { FadeUp, GoldText, Icon, Pill, ease, useSpring } from "../components/ui";
import {
  Caption,
  Magnifier,
  PHONE,
  RIGHT,
  RealBadge,
  RightHeader,
  type Region,
  type Shot,
  screenScale,
} from "../components/real";
import realCues from "../data/real-cues.json";
// @ts-expect-error plain JS module
import { FPS } from "../timeline.mjs";

/* ------------------------------------------------------------------ */
/* Screenshots & regions                                               */
/* ------------------------------------------------------------------ */

const shot = (name: string): Shot => ({ file: `screens/${name}.jpg`, w: 1080, h: 2092 });
export const S = {
  dashboard: shot("dashboard"),
  factory: shot("factory"),
  inventory: shot("inventory"),
  consignments: shot("consignments"),
  customers: shot("customers"),
  refining: shot("refining"),
  refiningForm: shot("refining-form"),
  cash: shot("cash"),
  sellers: shot("sellers"),
  reconcile: shot("reconcile"),
  login: shot("login"),
  users: shot("users"),
  reports: shot("reports"),
};

/** Region from coordinates measured on the 932×2000 phone preview (status bar cropped: −93 px). */
const K = 1080 / 932;
const V = (x1: number, y1: number, x2: number, y2: number): Region => ({
  x: x1 * K,
  y: y1 * K - 93,
  w: (x2 - x1) * K,
  h: (y2 - y1) * K,
});

/* ------------------------------------------------------------------ */
/* Narration sync                                                      */
/* ------------------------------------------------------------------ */

type CueSec = { text: string; from: number; to: number };
const CUES = realCues as Record<string, CueSec[]>;

/** Scene-local frame when `phrase` is spoken (from Whisper-aligned cues). */
export const phraseAt = (sceneId: string, phrase: string, speechStart: number) => {
  for (const c of CUES[sceneId]) {
    const i = c.text.indexOf(phrase);
    if (i >= 0) return Math.round(speechStart + (c.from + (i / c.text.length) * (c.to - c.from)) * FPS);
  }
  throw new Error(`phrase not found in ${sceneId}: ${phrase}`);
};

/* ------------------------------------------------------------------ */
/* Walkthrough: phone (real screenshot) + highlight + magnifier         */
/* ------------------------------------------------------------------ */

export type Step = { at: number; shot: Shot; region: Region; caption: string; sub?: string };

const PhoneScreen: React.FC<{ shot: Shot; opacity: number }> = ({ shot, opacity }) => (
  <Img src={staticFile(shot.file)} style={{ position: "absolute", left: 0, top: 0, width: PHONE.screenW, opacity }} />
);

export const ShotWalkthrough: React.FC<{ steps: Step[]; dur: number }> = ({ steps, dur }) => {
  const frame = useCurrentFrame();
  const enter = useSpring(0, 20);
  const idx = steps.reduce((acc, st, i) => (frame >= st.at ? i : acc), 0);
  const cur = steps[idx];
  const prev = idx > 0 ? steps[idx - 1] : null;
  const started = frame >= steps[0].at;
  const t = started ? interpolate(frame, [cur.at, cur.at + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const out = interpolate(frame, [dur - 22, dur - 4], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sameShot = prev && prev.shot.file === cur.shot.file;
  const k = 1 - Math.pow(1 - t, 3);
  const L = (a: number, b: number) => a + (b - a) * k;
  const hl: Region =
    prev && sameShot
      ? { x: L(prev.region.x, cur.region.x), y: L(prev.region.y, cur.region.y), w: L(prev.region.w, cur.region.w), h: L(prev.region.h, cur.region.h) }
      : cur.region;
  const hlOpacity = (sameShot ? 1 : t) * out * (started ? 1 : 0);
  const s = screenScale(cur.shot);
  const screenH = cur.shot.h * s;
  const pulse = 0.65 + 0.35 * Math.sin(frame / 7);
  const magTop = 290;
  const hy = PHONE.y + 12 + (hl.y + hl.h / 2) * s;
  const hx = PHONE.x + 12 + (hl.x + hl.w) * s + 4;

  return (
    <AbsoluteFill>
      {/* phone */}
      <div
        style={{
          position: "absolute",
          left: PHONE.x,
          top: PHONE.y,
          padding: 12,
          borderRadius: 56,
          background: "linear-gradient(145deg, #2A3550, #0A1020)",
          boxShadow: "0 50px 120px rgba(0,0,0,0.65), 0 0 0 2px rgba(212,175,55,0.3), inset 0 0 0 2px rgba(255,255,255,0.06)",
          opacity: enter * out + (1 - out) * 0.0,
          transform: `translateX(${interpolate(enter, [0, 1], [-80, 0])}px)`,
        }}
      >
        <div style={{ width: PHONE.screenW, height: screenH, borderRadius: 44, overflow: "hidden", position: "relative", background: "#0B1120" }}>
          {prev && !sameShot && t < 1 ? <PhoneScreen shot={prev.shot} opacity={1} /> : null}
          <PhoneScreen shot={cur.shot} opacity={prev && !sameShot ? t : 1} />
          <svg width={PHONE.screenW} height={screenH} style={{ position: "absolute", inset: 0, opacity: hlOpacity }}>
            <defs>
              <mask id="hole">
                <rect width="100%" height="100%" fill="white" />
                <rect x={hl.x * s} y={hl.y * s} width={hl.w * s} height={hl.h * s} rx={14} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(3,7,18,0.62)" mask="url(#hole)" />
          </svg>
          <div
            style={{
              position: "absolute",
              left: hl.x * s - 4,
              top: hl.y * s - 4,
              width: hl.w * s + 8,
              height: hl.h * s + 8,
              borderRadius: 16,
              border: `3px solid ${C.gold}`,
              boxShadow: `0 0 ${18 + pulse * 18}px rgba(212,175,55,${0.5 + pulse * 0.3})`,
              opacity: hlOpacity,
            }}
          />
        </div>
      </div>
      <div style={{ position: "absolute", left: PHONE.x, top: 990, width: 476, display: "flex", justifyContent: "center", opacity: out }}>
        <RealBadge text="HAQIQIY EKRAN · production" style={{ fontSize: 18, padding: "8px 16px" }} />
      </div>

      {/* connector */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: hlOpacity }}>
        <path
          d={`M ${hx} ${hy} C ${RIGHT.x - 60} ${hy}, ${RIGHT.x - 80} ${magTop + 60}, ${RIGHT.x - 6} ${magTop + 60}`}
          fill="none"
          stroke="rgba(212,175,55,0.75)"
          strokeWidth={2.5}
          strokeDasharray="8 8"
        />
      </svg>

      {/* magnifier + caption */}
      {prev && t < 1 ? (
        <div style={{ position: "absolute", left: RIGHT.x, top: magTop, width: RIGHT.w, display: "flex", flexDirection: "column", gap: 28 }}>
          <Magnifier shot={prev.shot} region={prev.region} maxW={RIGHT.w} maxH={400} appear={Math.max(0, 1 - t * 2) * out} />
          <Caption title={prev.caption} sub={prev.sub} appear={Math.max(0, 1 - t * 2) * out} />
        </div>
      ) : null}
      {started ? (
        <div style={{ position: "absolute", left: RIGHT.x, top: magTop, width: RIGHT.w, display: "flex", flexDirection: "column", gap: 28 }}>
          <Magnifier key={idx} shot={cur.shot} region={cur.region} maxW={RIGHT.w} maxH={400} appear={(prev ? Math.max(0, t * 2 - 1) : t) * out} />
          <Caption title={cur.caption} sub={cur.sub} appear={(prev ? Math.max(0, t * 2 - 1) : t) * out} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export type RealSceneProps = { dur: number; speechStart: number };

const RealScene: React.FC<RealSceneProps & { step: string; kicker: string; title: React.ReactNode; steps: Step[] }> = ({
  dur,
  step,
  kicker,
  title,
  steps,
}) => {
  const out = interpolate(useCurrentFrame(), [dur - 22, dur - 4], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <div style={{ opacity: out }}>
        <RightHeader step={step} kicker={kicker} title={title} />
      </div>
      <ShotWalkthrough steps={steps} dur={dur} />
    </AbsoluteFill>
  );
};

/* ============================== R04 DASHBOARD ============================== */
const DASH = {
  header: { x: 0, y: 0, w: 1080, h: 158 },
  factory: { x: 46, y: 185, w: 472, h: 368 },
  stock: { x: 562, y: 185, w: 472, h: 368 },
  debts: { x: 46, y: 594, w: 472, h: 321 },
  cash: { x: 562, y: 594, w: 472, h: 321 },
  safe: { x: 46, y: 958, w: 472, h: 322 },
  refine: { x: 562, y: 958, w: 472, h: 322 },
  grid: { x: 46, y: 185, w: 988, h: 1095 },
};

export const RDashboard: React.FC<RealSceneProps> = (p) => {
  const id = "r04-dashboard";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("Asosiy panelda"), shot: S.dashboard, region: DASH.header, caption: "Savdo Markazi · Asosiy Panel", sub: "Barcha ko‘rsatkichlar 585 proba ekvivalentida" },
    { at: f("Ombor va sotuvchilardagi"), shot: S.dashboard, region: DASH.stock, caption: "Ombor va sotuvchidagi tovar", sub: "Menejer va sotuvchilar bo‘yicha alohida" },
    { at: f("mijozlar nasiyasi"), shot: S.dashboard, region: DASH.debts, caption: "Mijozlar sof nasiyasi", sub: "Avanslar hisobga olingan sof qarz" },
    { at: f("kassalar"), shot: S.dashboard, region: DASH.cash, caption: "Sotuvchilar kassasi", sub: "Lom, so‘m va dollar" },
    { at: f("menejer seyfi"), shot: S.dashboard, region: DASH.safe, caption: "Menejer seyfi", sub: "Lom, naqd va xarid qilingan oltin" },
    { at: f("afinajdagi oltin"), shot: S.dashboard, region: DASH.refine, caption: "Afinaj oltin (585 eq)", sub: "Toza quyma — 585 ekvivalentida" },
    { at: f("bitta ko‘rsatkichga"), shot: S.dashboard, region: DASH.grid, caption: "Hammasi bitta ekranda", sub: "Oltita asosiy ko‘rsatkich" },
    { at: f("Zavod va tashqi"), shot: S.dashboard, region: DASH.factory, caption: "Zavod majburiyati", sub: "Zavod oldidagi sof qarz — ustama bilan" },
  ];
  return <RealScene {...p} step="01" kicker="Asosiy panel" title={<>Butun biznes — <GoldText>bitta ekranda</GoldText></>} steps={steps} />;
};

/* ============================== R05 FACTORY ============================== */
export const RFactory: React.FC<RealSceneProps> = (p) => {
  const id = "r05-factory";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("Zavoddan kelgan"), shot: S.inventory, region: V(90, 222, 888, 398), caption: "Zavod partiyalari · Mahsulotlar · Modellar", sub: "Boshqaruvchi ombori" },
    { at: f("vazn bo‘yicha"), shot: S.inventory, region: V(40, 1590, 892, 1880), caption: "Zavoddan qabul qilingan partiyalar", sub: "Zavod kvitansiyalari bo‘yicha qoldiq" },
    { at: f("Zavod ustamasi"), shot: S.factory, region: V(40, 917, 892, 1170), caption: "Zavod oldidagi majburiyat", sub: "Ustama foizlari bilan hisoblangan" },
    { at: f("kirimlar bo‘yicha"), shot: S.factory, region: V(40, 325, 892, 580), caption: "Jami qabul qilingan tovar", sub: "Har bir kvitansiya alohida qayd etiladi" },
    { at: f("alohida daftarda"), shot: S.factory, region: V(40, 1508, 892, 1763), caption: "Hozirgi sof zavod qarzi", sub: "585 ekvivalentida, qaytarilgan oltin ayirilgan" },
  ];
  return <RealScene {...p} step="02" kicker="Zavod bilan hisob" title={<>Zavoddan <GoldText>kirim</GoldText> va majburiyat</>} steps={steps} />;
};

/* ============================== R06 CONSIGNMENT ============================== */
export const RConsign: React.FC<RealSceneProps> = (p) => {
  const id = "r06-consign";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("Tovarlar sotuvchilarga"), shot: S.consignments, region: V(95, 255, 840, 500), caption: "Goldia vazn rejimi (585)", sub: "Konsignatsiya — skaner orqali" },
    { at: f("shtrix-kod"), shot: S.consignments, region: V(92, 680, 932, 860), caption: "Vazn shtrix-kodini skaner qilish", sub: "Har bir dona — alohida kod" },
    { at: f("tanlangan sotuvchi"), shot: S.consignments, region: V(40, 968, 892, 1517), caption: "Pozitsiyalar va jami asl vazn", sub: "Sotuvchi hisobiga biriktiriladi" },
  ];
  return <RealScene {...p} step="03" kicker="Scanner 564 · konsignatsiya" title={<>Skaner orqali <GoldText>tarqatish</GoldText></>} steps={steps} />;
};

/* ============================== R07 CUSTOMERS ============================== */
export const RCustomers: React.FC<RealSceneProps> = (p) => {
  const id = "r07-customers";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("To‘lov naqd pul"), shot: S.customers, region: V(130, 1047, 802, 1213), caption: "To‘langan: lom · naqd · USD", sub: "Har bir to‘lov turi alohida" },
    { at: f("To‘lanmagan qism"), shot: S.customers, region: V(90, 885, 842, 1375), caption: "+ Nasiya · To‘lov · Eski qarz", sub: "Sof qarz 585 ekvivalentida" },
    { at: f("Mijozlar va nasiya daftari"), shot: S.customers, region: V(90, 650, 842, 860), caption: "Mijozlar ro‘yxati va nasiya qoldiqlari", sub: "Kim qancha qarzdor — bir qarashda" },
  ];
  return <RealScene {...p} step="04" kicker="Mijozlar va nasiya" title={<>To‘lov va <GoldText>nasiya</GoldText> daftari</>} steps={steps} />;
};

/* ============================== R08 REFINING ============================== */
export const RRefining: React.FC<RealSceneProps> = (p) => {
  const id = "r08-refining";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("Mijozlardan olingan"), shot: S.refining, region: V(40, 1018, 892, 1272), caption: "Seyfdagi lom oltin (585)", sub: "Eritish uchun tayyor zaxira" },
    { at: f("toza oltin"), shot: S.refining, region: V(40, 1315, 892, 1568), caption: "Afinaj qilingan toza oltin", sub: "Sof quyma — 585 ekvivalentida" },
    { at: f("585 ekvivalentida"), shot: S.refiningForm, region: V(100, 990, 832, 1428), caption: "Lom pateriya hisobi", sub: "Kiruvchi lom, yo‘qotish va chiqqan toza oltin" },
    { at: f("Naqd pulga"), shot: S.cash, region: V(40, 1257, 892, 1548), caption: "Xarid oltini (585 eq)", sub: "Naqdga oltin xarid — seyf balansida" },
  ];
  return <RealScene {...p} step="05" kicker="Afinaj va kassa" title={<>Lomdan <GoldText>toza oltin</GoldText>gacha</>} steps={steps} />;
};

/* ============================== R09 RECONCILE ============================== */
export const RReconcile: React.FC<RealSceneProps> = (p) => {
  const id = "r09-reconcile";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("Sotuvchi bilan"), shot: S.sellers, region: V(90, 1320, 842, 1800), caption: "Rekonsilyatsiya (A–G)", sub: "Olingan tovar, majburiyat, kassa" },
    { at: f("qabul qilingan tovar"), shot: S.reconcile, region: V(100, 760, 832, 1127), caption: "A. Qabul qilingan tovar", sub: "Konsignatsiya — sof gramm hisobi" },
    { at: f("javondagi tovar"), shot: S.reconcile, region: V(100, 1168, 832, 1497), caption: "B. Sotilmagan tovar (javonda)", sub: "Javonda mavjud fizik oltin" },
    { at: f("sotilgan tovar"), shot: S.reconcile, region: V(100, 1538, 832, 1830), caption: "C. Mijozlarga sotilgan tovar", sub: "Menejer oldidagi majburiyat" },
    { at: f("mijozlar nasiyasi"), shot: S.reconcile, region: V(100, 440, 832, 718), caption: "D · E · F", sub: "Nasiya, sotuvchi kassasi, topshirilgan to‘lovlar — mutanosiblik tekshiruvi" },
    { at: f("Natijada"), shot: S.sellers, region: V(90, 1013, 842, 1278), caption: "G. Bozor qarzi", sub: "Joriy imzolangan bozor qarzi (+/−)" },
  ];
  return <RealScene {...p} step="06" kicker="Sotuvchi bilan hisob-kitob" title={<>Bozor qarzi — <GoldText>aniq</GoldText></>} steps={steps} />;
};

/* ============================== R10 SECURITY ============================== */
export const RSecurity: React.FC<RealSceneProps> = (p) => {
  const id = "r10-security";
  const f = (ph: string) => phraseAt(id, ph, p.speechStart);
  const steps: Step[] = [
    { at: f("Kirish rollarga"), shot: S.login, region: V(40, 788, 892, 1398), caption: "Xodim emaili va maxfiy parol", sub: "Har bir xodim — o‘z hisobi bilan" },
    { at: f("direktor, boshqaruvchi"), shot: S.users, region: V(100, 725, 832, 1290), caption: "Rollar: admin · production_manager · sales", sub: "Direktor · Boshqaruvchi · Sotuvchi" },
    { at: f("Sotuvchi faqat"), shot: S.users, region: V(100, 1290, 832, 1880), caption: "Sotuvchi — faqat o‘z bo‘limlari", sub: "Rolga qarab kirish cheklanadi" },
    { at: f("Telegram orqali"), shot: S.users, region: V(40, 215, 892, 450), caption: "Telegram orqali bog‘lash", sub: "Kod kiritilganda hisob avtomatik bog‘lanadi" },
    { at: f("audit jurnali"), shot: S.reports, region: V(40, 258, 892, 548), caption: "Audit va rekonsilyatsiya tarixi", sub: "Tranzaksiyalar auditi, CSV/Excel eksport" },
    { at: f("takroriy yozuvdan"), shot: S.reports, region: V(100, 778, 832, 1240), caption: "Har bir amal — kvitansiya raqami bilan", sub: "Bekor qilinganlar ham tarixda saqlanadi" },
  ];
  return <RealScene {...p} step="07" kicker="Xavfsizlik va nazorat" title={<>Har kim — <GoldText>o‘z vakolatida</GoldText></>} steps={steps} />;
};

/* ============================== INTRO / OUTRO with the real logo ============================== */
const RealLogo: React.FC<{ size: number; progress: number }> = ({ size, progress }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div
        style={{
          position: "absolute",
          inset: -size * 0.12,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(212,175,55,0.35) 0%, rgba(212,175,55,0) 65%)",
          opacity: progress,
          transform: `scale(${0.9 + 0.05 * Math.sin(frame / 20)})`,
        }}
      />
      <Img
        src={staticFile("logo/goldia-icon.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: size,
          height: size,
          borderRadius: size * 0.27,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 2px rgba(212,175,55,0.45)",
          opacity: progress,
          transform: `scale(${0.82 + progress * 0.18})`,
        }}
      />
    </div>
  );
};

export const RIntro: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const p = useSpring(4, 16);
  const tag = useSpring(40, 20);
  const out = interpolate(frame, [dur - 30, dur], [1, 1.04], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${out})` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -110 }}>
        <RealLogo size={400} progress={p} />
        <div style={{ marginTop: 44, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)`, fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, fontSize: 46, color: C.goldLight }}>
          Savdo · Konsignatsiya · Kassa — yagona tizimda
        </div>
        <div style={{ marginTop: 18, opacity: tag, fontFamily: SANS, fontSize: 26, letterSpacing: 6, color: C.muted, textTransform: "uppercase" }}>
          Direktor uchun taqdimot
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const ROutro: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const p = useSpring(0, 18);
  const fade = interpolate(frame, [dur - 24, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const points = ["585 g ekvivalentida yagona balans", "Sotuvchi va mijoz qarzi nazorati", "Rollar, audit va Telegram"];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -150 }}>
        <RealLogo size={300} progress={p} />
        <FadeUp delay={22}>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, fontSize: 52, color: C.goldLight, marginTop: 34 }}>
            Oltin hisobida grammgacha aniqlik
          </div>
        </FadeUp>
        <div style={{ display: "flex", gap: 20, marginTop: 36 }}>
          {points.map((pt, i) => (
            <FadeUp key={pt} delay={44 + i * 12}>
              <Pill style={{ fontSize: 26, padding: "14px 26px" }}>
                <Icon name="check" size={24} /> {pt}
              </Pill>
            </FadeUp>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: GOLD_GRADIENT, opacity: ease(frame, 10, 50) }} />
    </AbsoluteFill>
  );
};
