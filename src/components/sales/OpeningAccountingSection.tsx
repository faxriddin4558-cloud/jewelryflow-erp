"use client";

// Goldia Sales — controlled financial restart + opening accounting (migration 085, decisions O-1 … O-6).
// 1. The director restarts the books at T0 (typed confirmation, reason, a backup verified by restore within 24 h).
//    Customers, phones, seller assignment, employees, models and settings stay; every financial document is archived.
// 2. The manager / director enters the REAL balances at T0 as opening documents (no sale, no receipt "today",
//    no payment is invented). A wrong document is cancelled while the opening is in draft.
// 3. The reconciliation must be all green; "Boshlang'ich hisobni tasdiqlash" (the baseline) locks the opening.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { isDirectorUiRole, isManagementUiRole } from "@/lib/sales-role-access";
import { formatTashkent, openingT0Problem, tashkentWallClockToIso } from "@/lib/business-date";

const CONFIRM_TEXT = "MOLIYAVIY HISOBNI QAYTA BOSHLASH";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);
const fmt = (v: unknown, d = 4) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d }));

type Doc = {
  id: string; document_no: string; kind: string; status: string; unit: string | null; side: string | null; amount: number;
  physical_g: number | null; proba: number | null; equiv_585_g: number | null; seller_obligation_g: number; factory_obligation_g: number;
  formula: string | null; factory_markup_pct: number | null; seller_markup_pct: number | null; usd_rate: number | null; lom_rate: number | null;
  seller_name: string | null; customer_name: string | null; counterparty: string | null; other_type: string | null; notes: string | null;
  created_at: string; created_by_name: string | null; cancelled_at: string | null; cancel_reason: string | null;
};
type State = {
  period: { id: string; period_no: string; t0: string; status: "draft" | "locked" } | null;
  restart: { restart_no: string; reason: string; created_at: string } | null;
  backup_verifications: { id: string; backup_reference: string; verified_at: string; usable: boolean }[];
  documents: Doc[];
  totals: Record<string, number | null>;
  sellers: { seller_id: string; name: string; held_g: number; obligation_g: number; till_uzs: number; till_usd: number; till_scrap_g: number }[];
  checks: Record<string, boolean | number>;
};

const KINDS: { key: string; label: string }[] = [
  { key: "manager_inventory", label: "A. Menejer ombori (zavoddan qarzga olingan tayyor mahsulot)" },
  { key: "seller_inventory", label: "B. Sotuvchi ombori (tayyor mahsulot + majburiyat)" },
  { key: "factory_obligation", label: "C. Zavodga majburiyat (mahsulotsiz, 585 g)" },
  { key: "factory_advance", label: "C2. Zavodga berilgan avans (585 g)" },
  { key: "seller_obligation", label: "D. Sotuvchining qo'shimcha majburiyati (585 g)" },
  { key: "customer_gram", label: "E. Mijozning 585 g qarzi / avansi" },
  { key: "customer_currency", label: "F. Mijozning so'm / USD qarzi / avansi" },
  { key: "manager_cash", label: "G. Menejer kassasi (so'm / USD)" },
  { key: "manager_scrap", label: "H. Menejerdagi LOM (proba bilan)" },
  { key: "manager_fine_gold", label: "I. Menejerdagi toza oltin" },
  { key: "other", label: "J. Boshqa aktiv / majburiyat" },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label.replace(/^[A-Z0-9]+\. /, "")]));
const CHECK_LABEL: Record<string, string> = {
  seller_tills_empty: "Sotuvchilar kassasi bo'sh (so'm, USD, LOM — O-2)",
  seller_stock_equals_held_pieces: "Sotuvchi ombori = qo'lidagi donalar",
  customer_585_equals_documents: "Mijozlar 585 g qoldig'i = boshlang'ich hujjatlar",
  customer_uzs_equals_documents: "Mijozlar so'm qoldig'i = boshlang'ich hujjatlar",
  customer_usd_equals_documents: "Mijozlar USD qoldig'i = boshlang'ich hujjatlar",
  non_opening_documents_after_restart: "Qayta boshlashdan keyin oddiy hujjatlar soni (0 bo'lishi kerak)",
};
const inputCls = "w-full min-h-[40px] rounded-lg bg-slate-950 border border-slate-700 px-2 text-sm text-white";

export function OpeningAccountingSection() {
  const [role, setRole] = useState<string | null>(null);
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; label: string }[]>([]);

  const load = useCallback(async () => {
    const [r, s, e, c] = await Promise.all([
      supabase.rpc("current_employee_role_text"),
      supabase.rpc("rpc_get_opening_state"),
      supabase.from("employees").select("id, name, full_name, role, is_active"),
      supabase.from("customers").select("id, contact_name, customer_code").order("contact_name"),
    ]);
    setRole((r.data as string) ?? null);
    if (s.error) setErr(parseErrorMessage(s.error)); else setSt(s.data as State);
    setSellers(((e.data ?? []) as { id: string; name?: string; full_name?: string; role?: string; is_active?: boolean }[])
      .filter((x) => x.is_active !== false && /^(sales|seller|sotuvchi)$/i.test(String(x.role ?? "")))
      .map((x) => ({ id: x.id, name: x.name || x.full_name || x.id })));
    setCustomers(((c.data ?? []) as { id: string; contact_name?: string; customer_code?: string }[])
      .map((x) => ({ id: x.id, label: `${x.contact_name ?? ""} (${x.customer_code ?? "KODSIZ"})` })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const isDirector = isDirectorUiRole(role);
  const canManage = isManagementUiRole(role);
  const draft = st?.period?.status === "draft";
  const allGreen = !!st && Object.entries(st.checks).every(([k, v]) => (k === "non_opening_documents_after_restart" ? v === 0 : v === true));

  // ---------------------------------------------------------------- restart (director)
  const [rT0, setRT0] = useState("");
  // 086: the server-side write freeze of the backup -> restart window (set by the release tooling, read via RLS)
  const [freezeAt, setFreezeAt] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("financial_write_freezes").select("frozen_at").is("released_at", null).order("frozen_at", { ascending: false }).limit(1);
      setFreezeAt(data && data.length ? String((data[0] as { frozen_at: string }).frozen_at) : null);
    })();
  }, [st]);
  const [rReason, setRReason] = useState("");
  const [rBackup, setRBackup] = useState("");
  const [rConfirm, setRConfirm] = useState("");
  const [rKey, setRKey] = useState(newKey);
  // T0 is a Tashkent wall-clock time: sent as +05:00 whatever the browser's time zone is (PHASE F2)
  const t0Iso = tashkentWallClockToIso(rT0);
  const t0Problem = rT0 ? openingT0Problem(t0Iso, new Date(), 24, freezeAt) : null;
  const restart = async () => {
    if (busy || rConfirm !== CONFIRM_TEXT || !rReason.trim() || !t0Iso || t0Problem || !rBackup || !freezeAt) return;
    setBusy(true); setErr(null); setMsg(null);
    const { data, error } = await supabase.rpc("rpc_financial_restart", {
      p_confirmation: rConfirm, p_reason: rReason.trim(), p_t0: t0Iso, p_backup_verification_id: rBackup, p_idempotency_key: rKey,
    });
    setBusy(false);
    if (error) { setErr(parseErrorMessage(error)); return; }
    setMsg(`Qayta boshlandi: ${(data as { restart_no: string }).restart_no}. Endi T0 dagi haqiqiy qoldiqlarni kiriting.`);
    setRKey(newKey()); setRConfirm("");
    await load();
  };

  // ---------------------------------------------------------------- opening document form
  const [kind, setKind] = useState("manager_inventory");
  const [f, setF] = useState<Record<string, string>>({});
  const [docKey, setDocKey] = useState(newKey);
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const num = (k: string) => (f[k] && f[k].trim() !== "" ? Number(f[k]) : null);
  const managerInventories = useMemo(() => (st?.documents ?? []).filter((d) => d.kind === "manager_inventory" && d.status === "active"), [st]);
  const submitDoc = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setMsg(null);
    const pieces = f.pieces ? f.pieces.split(/[\s,;]+/).map((x) => x.replace(",", ".")).filter(Boolean).map((w) => ({ weight_grams: Number(w) })) : null;
    const { data, error } = await supabase.rpc("rpc_record_opening_document", {
      p_kind: kind, p_amount: num("amount"), p_unit: f.unit || null, p_side: f.side || null,
      p_seller_id: f.seller_id || null, p_customer_id: f.customer_id || null, p_physical_g: num("physical_g"), p_proba: num("proba"),
      p_factory_markup_pct: num("factory_markup_pct"), p_seller_markup_pct: num("seller_markup_pct"), p_usd_rate: num("usd_rate"),
      p_lom_rate: num("lom_rate"), p_equiv_585_g: null, p_pieces: pieces && pieces.length ? pieces : null,
      p_source_document_id: f.source_document_id || null, p_model_id: null, p_product_name: f.product_name || null,
      p_counterparty: f.counterparty || null, p_other_type: f.other_type || null, p_notes: f.notes || null, p_idempotency_key: docKey,
    });
    setBusy(false);
    if (error) { setErr(parseErrorMessage(error)); return; }
    const d = data as { document_no: string; formula: string | null };
    setMsg(`Kiritildi: ${d.document_no}${d.formula ? ` — ${d.formula}` : ""}`);
    setF({}); setDocKey(newKey());
    await load();
  };
  const cancelDoc = async (d: Doc) => {
    if (busy) return;
    const reason = window.prompt(`${d.document_no} bekor qilinsinmi? Sababini yozing:`);
    if (!reason || !reason.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("rpc_cancel_opening_document", { p_document_id: d.id, p_reason: reason.trim(), p_idempotency_key: `cancel-${d.id}` });
    setBusy(false);
    if (error) setErr(parseErrorMessage(error)); else { setMsg(`${d.document_no} bekor qilindi`); await load(); }
  };

  // ---------------------------------------------------------------- lock (baseline)
  const [usdRate, setUsdRate] = useState("");
  const [lockKey, setLockKey] = useState(newKey);
  const lock = async () => {
    if (busy || !allGreen) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("rpc_confirm_accounting_baseline", {
      p_notes: `Boshlang'ich hisob ${st?.period?.period_no ?? ""}`, p_idempotency_key: lockKey, p_usd_rate: usdRate ? Number(usdRate) : null,
    });
    setBusy(false);
    if (error) { setErr(parseErrorMessage(error)); return; }
    setLockKey(newKey()); setMsg("Boshlang'ich hisob tasdiqlandi va qulflandi.");
    await load();
  };

  if (role !== null && !canManage) return <div className="p-4 text-sm text-rose-300">Bu sahifa faqat menejer va direktor uchun.</div>;

  const need = (k: string) => {
    const m: Record<string, string[]> = {
      manager_inventory: ["physical_g", "factory_markup_pct", "product_name"],
      seller_inventory: ["seller_id", "pieces", "physical_g", "seller_markup_pct", "source_document_id", "factory_markup_pct"],
      factory_obligation: ["amount"], factory_advance: ["amount"], seller_obligation: ["seller_id", "amount"],
      customer_gram: ["customer_id", "side", "amount"], customer_currency: ["customer_id", "unit", "side", "amount", "usd_rate", "lom_rate"],
      manager_cash: ["unit", "amount"], manager_scrap: ["physical_g", "proba"], manager_fine_gold: ["physical_g", "proba"],
      other: ["side", "unit", "amount", "proba", "usd_rate", "lom_rate", "other_type", "counterparty"],
    };
    return (m[kind] ?? []).includes(k);
  };

  return (
    <div className="space-y-4 text-white" data-testid="opening-accounting">
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-1">
        <h1 className="text-lg font-black">🧾 Boshlang&apos;ich hisob (T0)</h1>
        <p className="text-xs text-slate-400">
          T0 dagi HAQIQIY qoldiqlar kiritiladi. T0 gacha bo&apos;lgan savdolar qayta kiritilmaydi — ularning natijasi shu qoldiqlarda bor.
          Sotuvchilar kassasidagi pul va LOM T0 dan oldin menejerga topshiriladi (O-2).
        </p>
        <div className="text-sm" data-testid="opening-period">
          {st?.period
            ? <>Davr: <b>{st.period.period_no}</b> · T0: <b>{formatTashkent(st.period.t0)}</b> (Toshkent) · Holat: <b className={draft ? "text-amber-300" : "text-emerald-300"}>{draft ? "qoralama" : "tasdiqlangan (qulflangan)"}</b></>
            : <span className="text-slate-400">Ochiq boshlang&apos;ich davr yo&apos;q.</span>}
        </div>
      </div>
      {err && <div role="alert" className="rounded-xl bg-rose-950 border border-rose-800 p-3 text-sm text-rose-200" data-testid="opening-error">{err}</div>}
      {msg && <div className="rounded-xl bg-emerald-950 border border-emerald-800 p-3 text-sm text-emerald-200" data-testid="opening-message">{msg}</div>}

      {isDirector && !draft && (
        <div className="rounded-2xl bg-slate-900 border border-rose-900 p-4 space-y-2" data-testid="restart-panel">
          <h2 className="font-black text-rose-300">⚠️ Moliyaviy hisobni qayta boshlash (faqat direktor)</h2>
          <p className="text-xs text-slate-400">
            Barcha moliyaviy hujjatlar arxivga o&apos;tadi (o&apos;chirilmaydi), barcha qoldiqlar 0 bo&apos;ladi. Mijozlar, telefonlar, sotuvchiga
            biriktirish, xodimlar, modellar va sozlamalar saqlanadi. Avval backup olinib, alohida nusxaga tiklab sinalgan bo&apos;lishi shart.
          </p>
          {freezeAt
            ? <div className="text-xs text-emerald-300" data-testid="restart-freeze">Moliyaviy yozuvlar serverda muzlatilgan: {formatTashkent(freezeAt)} (Toshkent) dan beri</div>
            : <div className="text-xs text-amber-300" data-testid="restart-no-freeze">Moliyaviy yozuvlar muzlatilmagan: avval release vositasi bilan muzlatish va backup kerak (server boshqacha qayta boshlashni rad etadi).</div>}
          <label className="block text-xs">T0 sana va vaqti (Toshkent vaqti)
            <input type="datetime-local" className={inputCls} value={rT0} onChange={(e) => setRT0(e.target.value)} data-testid="restart-t0" /></label>
          {rT0 && (t0Problem
            ? <div className="text-xs text-rose-300" data-testid="restart-t0-problem">{t0Problem}</div>
            : <div className="text-xs text-slate-300" data-testid="restart-t0-tashkent">T0 = <b>{t0Iso ? formatTashkent(t0Iso) : ""}</b> (Toshkent, UTC+5)</div>)}
          <label className="block text-xs">Sabab
            <input className={inputCls} value={rReason} onChange={(e) => setRReason(e.target.value)} data-testid="restart-reason" /></label>
          <label className="block text-xs">Tiklab sinalgan backup
            <select className={inputCls} value={rBackup} onChange={(e) => setRBackup(e.target.value)} data-testid="restart-backup">
              <option value="">— tanlang —</option>
              {(st?.backup_verifications ?? []).filter((b) => b.usable).map((b) => (
                <option key={b.id} value={b.id}>{b.backup_reference} · {formatTashkent(b.verified_at)}</option>))}
            </select></label>
          {(st?.backup_verifications ?? []).filter((b) => b.usable).length === 0 && (
            <div className="text-xs text-amber-300">Yaroqli backup tasdig&apos;i yo&apos;q (24 soat ichida, ishlatilmagan). Uni release vositasi backup + tiklash sinovidan keyin yozadi.</div>)}
          <label className="block text-xs">Tasdiqlash uchun aynan yozing: <b>{CONFIRM_TEXT}</b>
            <input className={inputCls} value={rConfirm} onChange={(e) => setRConfirm(e.target.value)} data-testid="restart-confirm" /></label>
          <button type="button" onClick={() => void restart()} data-testid="restart-submit"
            disabled={busy || rConfirm !== CONFIRM_TEXT || !rReason.trim() || !t0Iso || !!t0Problem || !rBackup || !freezeAt}
            className="min-h-[44px] px-4 rounded-xl bg-rose-700 font-bold disabled:opacity-40">Qayta boshlash</button>
        </div>
      )}

      {draft && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2" data-testid="opening-form">
          <h2 className="font-black text-amber-400">Boshlang&apos;ich hujjat qo&apos;shish</h2>
          <select className={inputCls} value={kind} onChange={(e) => { setKind(e.target.value); setF({}); }} data-testid="opening-kind">
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            {need("seller_id") && <label className="text-xs">Sotuvchi<select className={inputCls} value={f.seller_id ?? ""} onChange={set("seller_id")} data-testid="opening-seller">
              <option value="">— tanlang —</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            {need("customer_id") && <label className="text-xs">Mijoz<select className={inputCls} value={f.customer_id ?? ""} onChange={set("customer_id")} data-testid="opening-customer">
              <option value="">— tanlang —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
            {need("side") && <label className="text-xs">Turi<select className={inputCls} value={f.side ?? ""} onChange={set("side")} data-testid="opening-side">
              <option value="">— tanlang —</option>
              {kind === "other" ? <><option value="asset">Bizga qarz (aktiv)</option><option value="liability">Bizning qarzimiz (majburiyat)</option></>
                : <><option value="debt">Mijoz qarzi</option><option value="advance">Mijoz avansi</option></>}</select></label>}
            {need("unit") && <label className="text-xs">Birlik<select className={inputCls} value={f.unit ?? ""} onChange={set("unit")} data-testid="opening-unit">
              <option value="">— tanlang —</option><option value="UZS">so&apos;m (UZS)</option><option value="USD">USD</option>
              {kind === "other" && <><option value="G585">585 g</option><option value="GOLD">oltin (proba bilan)</option></>}</select></label>}
            {need("amount") && <label className="text-xs">{kind.startsWith("customer") || kind === "manager_cash" || kind === "other" ? "Summa / miqdor" : "Miqdor (585 g)"}
              <input type="number" step="any" min="0" className={inputCls} value={f.amount ?? ""} onChange={set("amount")} data-testid="opening-amount" /></label>}
            {need("physical_g") && <label className="text-xs">{kind === "seller_inventory" ? "Jami fizik vazn (g) — donalar kiritilmasa" : "Fizik vazn (g)"}
              <input type="number" step="any" min="0" className={inputCls} value={f.physical_g ?? ""} onChange={set("physical_g")} data-testid="opening-physical" /></label>}
            {need("pieces") && <label className="text-xs sm:col-span-2">Dona vaznlari (har biri alohida, masalan: 14.52 8.3 10)
              <input className={inputCls} value={f.pieces ?? ""} onChange={set("pieces")} data-testid="opening-pieces" /></label>}
            {need("source_document_id") && <label className="text-xs">Manba: menejer boshlang&apos;ich ombori (bo&apos;sh = mahsulot faqat sotuvchida)
              <select className={inputCls} value={f.source_document_id ?? ""} onChange={set("source_document_id")} data-testid="opening-source">
                <option value="">— menejer omborida emas —</option>
                {managerInventories.map((d) => <option key={d.id} value={d.id}>{d.document_no} · {fmt(d.amount)} g</option>)}</select></label>}
            {need("factory_markup_pct") && !(kind === "seller_inventory" && f.source_document_id) && <label className="text-xs">Zavod ustamasi (%)
              <input type="number" step="any" min="0" className={inputCls} value={f.factory_markup_pct ?? ""} onChange={set("factory_markup_pct")} data-testid="opening-factory-pct" /></label>}
            {need("seller_markup_pct") && <label className="text-xs">Sotuvchi majburiyati ustamasi (%)
              <input type="number" step="any" min="0" className={inputCls} value={f.seller_markup_pct ?? ""} onChange={set("seller_markup_pct")} data-testid="opening-seller-pct" /></label>}
            {need("proba") && (kind !== "other" || f.unit === "GOLD") && <label className="text-xs">Proba
              <input type="number" step="any" min="0" className={inputCls} value={f.proba ?? ""} onChange={set("proba")} data-testid="opening-proba" /></label>}
            {need("usd_rate") && (f.unit === "USD") && <label className="text-xs">USD kursi (so&apos;m)
              <input type="number" step="any" min="0" className={inputCls} value={f.usd_rate ?? ""} onChange={set("usd_rate")} data-testid="opening-usd-rate" /></label>}
            {need("lom_rate") && (f.unit === "UZS" || f.unit === "USD") && <label className="text-xs">585 kursi (so&apos;m / g){kind === "customer_currency" ? " — sotuvchi majburiyati shu kurs bilan bir marta hisoblanadi" : ""}
              <input type="number" step="any" min="0" className={inputCls} value={f.lom_rate ?? ""} onChange={set("lom_rate")} data-testid="opening-lom-rate" /></label>}
            {need("product_name") && <label className="text-xs">Mahsulot / partiya nomi
              <input className={inputCls} value={f.product_name ?? ""} onChange={set("product_name")} /></label>}
            {need("other_type") && <label className="text-xs">Qarz turi<input className={inputCls} value={f.other_type ?? ""} onChange={set("other_type")} data-testid="opening-other-type" /></label>}
            {need("counterparty") && <label className="text-xs">Qarshi tomon<input className={inputCls} value={f.counterparty ?? ""} onChange={set("counterparty")} data-testid="opening-counterparty" /></label>}
            <label className="text-xs sm:col-span-2">Izoh{kind === "seller_obligation" ? " (majburiyat asosi — majburiy)" : ""}
              <input className={inputCls} value={f.notes ?? ""} onChange={set("notes")} data-testid="opening-notes" /></label>
          </div>
          <button type="button" onClick={() => void submitDoc()} disabled={busy} data-testid="opening-submit"
            className="min-h-[44px] px-4 rounded-xl bg-amber-500 text-slate-950 font-bold disabled:opacity-40">Kiritish</button>
        </div>
      )}

      {st && st.documents.length > 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2">
          <h2 className="font-black text-amber-400">Boshlang&apos;ich hujjatlar</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="opening-documents">
              <thead className="text-slate-500"><tr><th className="text-left">Hujjat</th><th className="text-left">Turi</th><th className="text-left">Kim / kimga</th>
                <th className="text-right">Miqdor</th><th className="text-right">585 g</th><th className="text-left">Hisob</th><th className="text-left">Kiritgan</th><th /></tr></thead>
              <tbody>
                {st.documents.map((d) => (
                  <tr key={d.id} className={`border-t border-slate-800 ${d.status !== "active" ? "opacity-50 line-through" : ""}`} data-testid="opening-row">
                    <td className="py-1 font-mono">{d.document_no}</td>
                    <td>{KIND_LABEL[d.kind] ?? d.kind}{d.side ? ` · ${d.side}` : ""}</td>
                    <td>{d.seller_name ?? d.customer_name ?? d.counterparty ?? "—"}{d.customer_name && d.seller_name ? ` (${d.seller_name})` : ""}</td>
                    <td className="text-right font-mono whitespace-nowrap">{fmt(d.amount)} {d.unit ?? ""}{d.proba ? ` · ${d.proba}` : ""}</td>
                    <td className="text-right font-mono">{fmt(d.equiv_585_g)}</td>
                    <td className="text-slate-400">{d.formula ?? ""}{d.usd_rate ? ` · USD ${fmt(d.usd_rate, 2)}` : ""}{d.lom_rate ? ` · 585 ${fmt(d.lom_rate, 2)}` : ""}</td>
                    <td className="text-slate-400 whitespace-nowrap">{d.created_by_name ?? ""} · {new Date(d.created_at).toLocaleString("ru-RU")}</td>
                    <td>{draft && d.status === "active" && (
                      <button type="button" onClick={() => void cancelDoc(d)} disabled={busy} data-testid="opening-cancel"
                        className="min-h-[36px] px-2 rounded-lg bg-slate-800 border border-slate-700">Bekor</button>)}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {st?.period && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2" data-testid="opening-reconciliation">
          <h2 className="font-black text-amber-400">Solishtirish</h2>
          <div className="grid gap-1 sm:grid-cols-2 text-xs font-mono">
            {Object.entries(st.totals).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span className="font-sans text-slate-400">{k}</span><span>{fmt(v)}</span></div>)}
          </div>
          <ul className="text-sm space-y-1">
            {Object.entries(st.checks).map(([k, v]) => {
              const ok = k === "non_opening_documents_after_restart" ? v === 0 : v === true;
              return <li key={k} data-testid={`check-${k}`} className={ok ? "text-emerald-300" : "text-rose-300"}>{ok ? "✅" : "❌"} {CHECK_LABEL[k] ?? k}{typeof v === "number" ? `: ${v}` : ""}</li>;
            })}
          </ul>
          {st.sellers.length > 0 && (
            <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead className="text-slate-500"><tr><th className="text-left font-sans">Sotuvchi</th>
              <th className="text-right">Ombor g</th><th className="text-right">Majburiyat g</th><th className="text-right">Kassa so&apos;m</th><th className="text-right">USD</th><th className="text-right">LOM g</th></tr></thead>
              <tbody>{st.sellers.map((s) => <tr key={s.seller_id} className="border-t border-slate-800"><td className="font-sans">{s.name}</td><td className="text-right">{fmt(s.held_g)}</td>
                <td className="text-right">{fmt(s.obligation_g)}</td><td className="text-right">{fmt(s.till_uzs, 2)}</td><td className="text-right">{fmt(s.till_usd, 2)}</td><td className="text-right">{fmt(s.till_scrap_g)}</td></tr>)}</tbody></table></div>)}
          {draft && (
            <div className="space-y-2 border-t border-slate-800 pt-2">
              <label className="block text-xs">USD kursi (so&apos;m) — kassada yoki mijozlarda USD bo&apos;lsa majburiy
                <input type="number" step="any" min="0" className={inputCls} value={usdRate} onChange={(e) => setUsdRate(e.target.value)} data-testid="lock-usd-rate" /></label>
              <button type="button" onClick={() => void lock()} disabled={busy || !allGreen} data-testid="lock-submit"
                className="min-h-[44px] px-4 rounded-xl bg-emerald-600 font-bold disabled:opacity-40">Boshlang&apos;ich hisobni tasdiqlash va qulflash</button>
              {!allGreen && <div className="text-xs text-amber-300">Barcha tekshiruvlar yashil bo&apos;lmaguncha tasdiqlab bo&apos;lmaydi.</div>}
            </div>)}
        </div>
      )}
    </div>
  );
}
