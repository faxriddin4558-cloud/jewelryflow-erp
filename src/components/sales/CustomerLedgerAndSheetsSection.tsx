"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";

function parseErrorMessage(err: unknown, fallback: string = "Xatolik yuz berdi"): string {
  if (!err) return fallback;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: string; details?: string; hint?: string; error_description?: string; code?: string };
    if (e.message) return e.message;
    if (e.details) return e.details;
    if (e.error_description) return e.error_description;
    try {
      const s = JSON.stringify(err);
      if (s !== "{}") return s;
    } catch {
      // ignore
    }
  }
  return String(err) !== "[object Object]" ? String(err) : fallback;
}

interface CustomerRow {
  id: string;
  customer_code: string;
  contact_name: string;
  phone?: string | null;
  company_name?: string | null;
  seller_id?: string | null;
  current_debt_grams?: number;
  advance_balance_grams?: number;
  total_scrap_paid_grams?: number;
  total_cash_paid_amount?: number;
  seller?: { name: string; full_name?: string } | null;
}

interface SellerItem {
  id: string;
  name: string;
  full_name?: string;
}

interface PieceItem {
  id: string;
  model_code: string;
  model_name: string;
  weight_grams: number;
  seller_id: string;
  status: string;
}

export interface DailyLedgerEntry {
  tx_id: string;
  tx_type: "sale" | "payment";
  tx_date: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  seller_id: string;
  seller_name: string;
  item_id?: string | null;
  model_name?: string | null;
  model_code?: string | null;
  sold_weight_g?: number | null;
  markup_pct?: number | null;
  obligation_g?: number | null;
  scrap_received_g?: number | null;
  cash_received_uzs?: number | null;
  rate_per_gram?: number | null;
  cash_equiv_g?: number | null;
  total_payment_g?: number | null;
  closing_debt_g: number;
  notes?: string | null;
  status?: string | null;
}

export interface MonthlyReportItem {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  phone?: string | null;
  opening_debt_g: number;
  sales_in_month_g: number;
  scrap_received_g: number;
  cash_received_uzs: number;
  cash_equivalent_g: number;
  total_settled_g: number;
  closing_debt_g: number;
}

export interface MonthlyReportSummary {
  total_customers?: number;
  total_opening_debt_g?: number;
  total_distributed_month_g: number;
  total_collected_scrap_g?: number;
  total_collected_cash_uzs?: number;
  total_collected_cash_gold_eq_g?: number;
  total_collected_month_g: number;
  total_closing_debt_g?: number;
  total_customer_debt_g: number;
  seller_held_cash_uzs: number;
  seller_held_scrap_g: number;
  seller_manager_bozor_qarzi_g: number;
  note?: string;
}

export interface MonthlyReportPayload {
  year: number;
  month: number;
  items: MonthlyReportItem[];
  summary: MonthlyReportSummary;
}

interface CustomerAccountData {
  current_debt_grams?: number | null;
  advance_balance_grams?: number | null;
  total_scrap_paid_grams?: number | null;
  total_cash_paid_amount?: number | null;
}

interface CustomerQueryRow {
  id: string;
  customer_code: string;
  contact_name: string;
  phone: string | null;
  company_name: string | null;
  seller_id: string;
  seller: { name: string; full_name?: string } | null;
  accounts: CustomerAccountData | CustomerAccountData[] | null;
}

export function CustomerLedgerAndSheetsSection() {
  const [activeTab, setActiveTab] = useState<"directory" | "daily_ledger" | "monthly_report">("directory");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Filter states
  const [sellers, setSellers] = useState<SellerItem[]>([]);
  const [selectedSeller, setSelectedSeller] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Directory Data
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [availablePieces, setAvailablePieces] = useState<PieceItem[]>([]);

  // Daily Ledger Data
  const [dailyLedgerRows, setDailyLedgerRows] = useState<DailyLedgerEntry[]>([]);
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  // Monthly Report Data
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [monthlyReportData, setMonthlyReportData] = useState<MonthlyReportPayload | null>(null);

  // Modals
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("+998 ");
  const [newCustSellerId, setNewCustSellerId] = useState("");
  const [newCustNotes, setNewCustNotes] = useState("");

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [targetCustomer, setTargetCustomer] = useState<CustomerRow | null>(null);
  const [payScrapWeight, setPayScrapWeight] = useState("");
  const [payCashAmount, setPayCashAmount] = useState("");
  const [payRate, setPayRate] = useState("900000");
  const [payScrapPurity, setPayScrapPurity] = useState("585");
  const [payNotes, setPayNotes] = useState("");

  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [salePieceId, setSalePieceId] = useState("");
  const [saleMarkupPct, setSaleMarkupPct] = useState("12.0");
  const [saleNotes, setSaleNotes] = useState("");

  // Reversal / Correction states
  const [currentRole, setCurrentRole] = useState<string>("seller");
  const [reversalModalOpen, setReversalModalOpen] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<DailyLedgerEntry | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  useEffect(() => {
    supabase.rpc("current_employee_role_text").then(({ data }) => {
      if (data) setCurrentRole(String(data).toLowerCase());
    });
  }, []);

  // Load Sellers
  useEffect(() => {
    const fetchSellers = async () => {
      const { data } = await supabase.from("employees").select("id, name, full_name, role").eq("is_active", true);
      if (data) {
        setSellers(data as SellerItem[]);
        if (data.length > 0 && !newCustSellerId && data[0]?.id) {
          setNewCustSellerId(data[0].id);
        }
      }
    };
    void fetchSellers();
  }, [newCustSellerId]);

  // Load Customers & Debts
  const loadCustomers = useCallback(async () => {
    setBusy(true);
    try {
      const { data: ledgerData, error: ledgerErr } = await supabase.rpc("rpc_get_unified_customer_ledger");
      if (!ledgerErr && ledgerData?.items) {
        interface UnifiedItem {
          customer_id: string;
          customer_code: string;
          contact_name: string;
          phone?: string | null;
          company_name?: string | null;
          seller_id?: string | null;
          seller_name?: string | null;
          net_debt_g?: number;
          available_advance_g?: number;
          paid_scrap_equivalent_g?: number;
          paid_cash_equivalent_g?: number;
        }
        let mapped: CustomerRow[] = ledgerData.items.map((i: UnifiedItem) => ({
          id: i.customer_id,
          customer_code: i.customer_code,
          contact_name: i.contact_name,
          phone: i.phone || null,
          company_name: i.company_name || null,
          seller_id: i.seller_id || "",
          seller: { name: i.seller_name || "Sotuvchi", full_name: i.seller_name || "Sotuvchi" },
          current_debt_grams: Number(i.net_debt_g || 0),
          advance_balance_grams: Number(i.available_advance_g || 0),
          total_scrap_paid_grams: Number(i.paid_scrap_equivalent_g || 0),
          total_cash_paid_amount: Number(i.paid_cash_equivalent_g || 0),
        }));
        if (selectedSeller !== "all") {
          mapped = mapped.filter((c) => c.seller_id === selectedSeller);
        }
        setCustomers(mapped);
      } else {
        let query = supabase
          .from("customers")
          .select(`
            id, customer_code, contact_name, phone, company_name, seller_id,
            seller:employees!customers_seller_id_fkey(name, full_name),
            accounts:client_gold_accounts(current_debt_grams, advance_balance_grams, total_scrap_paid_grams, total_cash_paid_amount)
          `)
          .order("contact_name", { ascending: true });

        if (selectedSeller !== "all") {
          query = query.eq("seller_id", selectedSeller);
        }

        const { data, error } = await query;
        if (error) throw error;

        const mapped: CustomerRow[] = ((data as unknown as CustomerQueryRow[]) || []).map((row) => {
          const rawAccounts = row.accounts;
          const accObj = Array.isArray(rawAccounts)
            ? (rawAccounts[0] as CustomerAccountData | undefined)
            : (rawAccounts as CustomerAccountData | undefined);
          const rawDebt = Number(accObj?.current_debt_grams || 0);
          const rawAdv = Number(accObj?.advance_balance_grams || 0);
          const netDebt = Math.max(0, rawDebt - rawAdv);

          return {
            id: row.id,
            customer_code: row.customer_code,
            contact_name: row.contact_name,
            phone: row.phone,
            company_name: row.company_name,
            seller_id: row.seller_id,
            seller: row.seller,
            current_debt_grams: netDebt,
            advance_balance_grams: rawAdv,
            total_scrap_paid_grams: Number(accObj?.total_scrap_paid_grams || 0),
            total_cash_paid_amount: Number(accObj?.total_cash_paid_amount || 0),
          };
        });

        setCustomers(mapped);
      }

      // Load available pieces for sale
      const piecesQuery = supabase
        .from("consignment_pieces")
        .select("id, model_code, model_name, weight_grams, seller_id, status")
        .eq("status", "held_by_seller");

      const { data: pData } = await piecesQuery;
      if (pData) setAvailablePieces(pData as PieceItem[]);
    } catch (err: unknown) {
      setMessage({ type: "error", text: `Mijozlarni yuklashda xatolik: ${parseErrorMessage(err, "Mijozlarni yuklab bo'lmadi")}` });
    } finally {
      setBusy(false);
    }
  }, [selectedSeller]);

  // Load Daily Ledger by range
  const fetchDailyLedgerRange = useCallback(async (start?: string, end?: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("rpc_get_daily_sales_ledger", {
        p_seller_id: selectedSeller === "all" ? null : selectedSeller,
        p_start_date: start || null,
        p_end_date: end || null,
      });

      if (error) throw error;
      setDailyLedgerRows((data as unknown as DailyLedgerEntry[]) || []);
    } catch (err: unknown) {
      setDailyLedgerRows([]);
      setMessage({ type: "error", text: `Kunlik jurnalni yuklashda xatolik: ${parseErrorMessage(err, "Kunlik jurnalni yuklab bo'lmadi")}` });
    } finally {
      setBusy(false);
    }
  }, [selectedSeller]);

  const loadDailyLedger = useCallback(async () => {
    await fetchDailyLedgerRange(startDate, endDate);
  }, [fetchDailyLedgerRange, startDate, endDate]);

  // Load Monthly Report
  const loadMonthlyReport = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("rpc_get_customer_monthly_report", {
        p_seller_id: selectedSeller === "all" ? null : selectedSeller,
        p_year: selectedYear,
        p_month: selectedMonth,
      });

      if (error) throw error;
      setMonthlyReportData((data as unknown as MonthlyReportPayload) || null);
    } catch (err: unknown) {
      setMessage({ type: "error", text: `Oylik hisobotni yuklashda xatolik: ${parseErrorMessage(err, "Oylik hisobotni yuklab bo'lmadi")}` });
    } finally {
      setBusy(false);
    }
  }, [selectedSeller, selectedYear, selectedMonth]);

  useEffect(() => {
    if (activeTab === "directory") void loadCustomers();
    if (activeTab === "daily_ledger") void loadDailyLedger();
    if (activeTab === "monthly_report") void loadMonthlyReport();
  }, [activeTab, loadCustomers, loadDailyLedger, loadMonthlyReport]);

  // Add Customer
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    setBusy(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.rpc("rpc_create_customer_with_code", {
        p_contact_name: newCustName.trim(),
        p_phone: newCustPhone.trim() || null,
        p_company_name: null,
        p_seller_id: newCustSellerId || null,
        p_notes: newCustNotes.trim() || null,
      });

      if (error) throw error;

      if (data?.status === "existing") {
        setMessage({ type: "error", text: "Ushbu nomdagi mijoz allaqachon mavjud!" });
      } else {
        setMessage({
          type: "success",
          text: `Yangi mijoz muvaffaqiyatli saqlandi: ${data.customer_code} — ${data.contact_name}`,
        });
        setNewCustomerModalOpen(false);
        setNewCustName("");
        setNewCustPhone("+998 ");
        setNewCustNotes("");
        await loadCustomers();
      }
    } catch (err: unknown) {
      setMessage({ type: "error", text: `Mijoz qo'shishda xatolik: ${parseErrorMessage(err, "Mijozni saqlab bo'lmadi")}` });
    } finally {
      setBusy(false);
    }
  };

  // Payment Handler
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCustomer) return;
    setBusy(true);
    setMessage(null);

    try {
      const scrap = parseFloat(payScrapWeight) || 0;
      const cash = parseFloat(payCashAmount) || 0;
      const rate = parseFloat(payRate) || 900000;

      if (scrap <= 0 && cash <= 0) {
        throw new Error("Kamida lom vazni yoki naqd pul summasi kiritilishi shart");
      }

      const { data, error } = await supabase.rpc("rpc_record_client_settlement", {
        p_customer_id: targetCustomer.id,
        p_scrap_weight: scrap,
        p_scrap_proba: scrap > 0 ? (parseFloat(payScrapPurity) || 585) : null,
        p_cash_amount: cash,
        p_rate_per_gram: rate,
        p_notes: payNotes.trim() || "Mijozdan to'lov qabul qilindi",
      });

      if (error) throw error;

      setMessage({
        type: "success",
        text: `To'lov qabul qilindi! (${targetCustomer.contact_name}): Jami yopildi ${formatScreenGrams(data.total_settled_grams, 2)}. Qoldiq qarz: ${formatScreenGrams(data.remaining_debt_grams, 2)}.`,
      });

      setPaymentModalOpen(false);
      setTargetCustomer(null);
      setPayScrapWeight("");
      setPayScrapPurity("585");
      setPayCashAmount("");
      setPayNotes("");
      await loadCustomers();
    } catch (err: unknown) {
      setMessage({ type: "error", text: `To'lovni saqlashda xatolik: ${parseErrorMessage(err, "To'lovni saqlab bo'lmadi")}` });
    } finally {
      setBusy(false);
    }
  };

  // Sale Handler
  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCustomer || !salePieceId) return;
    setBusy(true);
    setMessage(null);

    try {
      const markup = parseFloat(saleMarkupPct) || 12.0;

      const { data, error } = await supabase.rpc("rpc_record_barcode_piece_sale", {
        p_customer_id: targetCustomer.id,
        p_seller_id: targetCustomer.seller_id || sellers[0]?.id,
        p_piece_id: salePieceId,
        p_client_markup_pct: markup,
        p_notes: saleNotes.trim() || "Mijozga nasiya sotuv",
      });

      if (error) throw error;

      setMessage({
        type: "success",
        text: `Savdo muvaffaqiyatli rasmiylashtirildi! (${targetCustomer.contact_name}): ${data.model_name} (${formatScreenGrams(data.weight_grams, 2)} @ ${data.client_markup_pct}%). Mahsulot qiymati: ${formatScreenGrams(data.gross_gold_due_grams || data.client_gold_due_grams, 2)}.${Number(data.advance_applied_grams || 0) > 0 ? ` Qoplangan avans: -${formatScreenGrams(Number(data.advance_applied_grams), 2)}.` : ""} Sof qolgan qarz: ${formatScreenGrams(data.net_remaining_debt_grams ?? data.remaining_gold_grams, 2)}.`,
      });

      setSaleModalOpen(false);
      setTargetCustomer(null);
      setSalePieceId("");
      setSaleNotes("");
      await loadCustomers();
    } catch (err: unknown) {
      setMessage({ type: "error", text: `Savdoni rasmiylashtirishda xatolik: ${parseErrorMessage(err, "Savdoni saqlab bo'lmadi")}` });
    } finally {
      setBusy(false);
    }
  };

  const isPrivileged = [
    "admin", "director", "owner", "direktor", "rahbar", "manager", "production_manager", "boshqaruvchi"
  ].includes(currentRole);

  const openReversalModal = (tx: DailyLedgerEntry) => {
    setReversalTarget(tx);
    setReversalReason("");
    setReversalModalOpen(true);
  };

  const handleExecuteReversal = async () => {
    if (!reversalTarget) return;
    if (!reversalReason.trim()) {
      setMessage({ type: "error", text: "Bekor qilish sababini kiritishingiz shart!" });
      return;
    }
    setBusy(true);
    try {
      if (reversalTarget.tx_type === "sale") {
        if (!reversalTarget.item_id) {
          throw new Error("Ushbu savdoga bog'langan mahsulot donasi (item_id) topilmadi");
        }
        const { error } = await supabase.rpc("rpc_reverse_barcode_piece_sale", {
          p_piece_id: reversalTarget.item_id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("rpc_reverse_client_settlement", {
          p_settlement_id: reversalTarget.tx_id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
      }

      setMessage({
        type: "success",
        text: `Operatsiya (${reversalTarget.tx_id.slice(0, 8)}) muvaffaqiyatli bekor qilindi (audited compensating reversal).`,
      });
      setReversalModalOpen(false);
      setReversalTarget(null);
      setReversalReason("");
      await loadDailyLedger();
      await loadCustomers();
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: `Bekor qilishda xatolik: ${parseErrorMessage(err, "Bekor qilib bo'lmadi")}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const filteredCustomers = customers.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.contact_name.toLowerCase().includes(q) ||
      (c.customer_code && c.customer_code.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl text-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
              <span>🛍️</span> Mijozlar Hisob-Kitobi va Nasiya Daftari
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sotuvchilarning kundalik savdo jurnali va oylik mijozlar hisob-kitob balansi.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
            <button
              onClick={() => setActiveTab("directory")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === "directory" ? "bg-amber-500 text-slate-950 shadow-md" : "text-slate-400 hover:text-white"
              }`}
            >
              <span>👤</span> Mijozlar Ro&apos;yxati ({customers.length})
            </button>
            <button
              onClick={() => setActiveTab("daily_ledger")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === "daily_ledger" ? "bg-amber-500 text-slate-950 shadow-md" : "text-slate-400 hover:text-white"
              }`}
            >
              <span>📑</span> Kunlik Savdo Jurnali
            </button>
            <button
              onClick={() => setActiveTab("monthly_report")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === "monthly_report" ? "bg-amber-500 text-slate-950 shadow-md" : "text-slate-400 hover:text-white"
              }`}
            >
              <span>📊</span> Oylik Hisobot
            </button>
          </div>
        </div>

        {/* Global Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedSeller}
              onChange={(e) => setSelectedSeller(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium"
            >
              <option value="all">Barcha Sotuvchilar</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.name}
                </option>
              ))}
            </select>

            {activeTab === "directory" && (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Mijoz ismi yoki kod..."
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white w-52"
              />
            )}

            {activeTab === "daily_ledger" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white text-xs font-mono"
                />
                <span className="text-slate-500 font-mono">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => void loadDailyLedger()}
                  disabled={busy}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center gap-1"
                >
                  <span>🔍</span> Filter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().split("T")[0];
                    setStartDate(today);
                    setEndDate(today);
                    void fetchDailyLedgerRange(today, today);
                  }}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs rounded-xl border border-slate-700 transition"
                >
                  Bugun
                </button>
              </div>
            )}

            {activeTab === "monthly_report" && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white"
                >
                  <option value={2026}>2026-yil</option>
                  <option value={2025}>2025-yil</option>
                </select>

                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white"
                >
                  {[
                    "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
                    "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"
                  ].map((m, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {activeTab === "directory" && (
            <button
              onClick={() => setNewCustomerModalOpen(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
            >
              <span>+</span> Yangi Mijoz Qo&apos;shish
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-bold border ${
            message.type === "success"
              ? "bg-emerald-950/80 border-emerald-700 text-emerald-200"
              : "bg-rose-950/80 border-rose-700 text-rose-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* TAB 1: CUSTOMERS DIRECTORY */}
      {activeTab === "directory" && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
              Mijozlar Ro&apos;yxati va Nasiya Qoldiqlari ({filteredCustomers.length})
            </h3>
            <span className="text-xs text-slate-400">
              Qarzlar 12-15% mijoz ustamasi bilan 585 sof ekvivalentda
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Kod</th>
                  <th className="py-3 px-3">Mijoz Ismi</th>
                  <th className="py-3 px-3">Telefon</th>
                  <th className="py-3 px-3">Biriktirilgan Sotuvchi</th>
                  <th className="py-3 px-3 font-mono text-amber-300">To&apos;langan Lom</th>
                  <th className="py-3 px-3 font-mono text-emerald-300">To&apos;langan Naqd</th>
                  <th className="py-3 px-3 font-mono text-rose-400">Hozirgi Qarz (585g)</th>
                  <th className="py-3 px-3 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 font-mono font-bold text-amber-400">{c.customer_code}</td>
                    <td className="py-2.5 px-3 font-bold text-white">{c.contact_name}</td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono">{c.phone || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-300">
                      {c.seller?.full_name || c.seller?.name || "Biriktirilmagan"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-amber-300">
                      {formatScreenGrams(c.total_scrap_paid_grams)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-emerald-400">
                      {formatScreenUZS(c.total_cash_paid_amount)}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-black text-rose-400 text-sm">
                      {formatScreenGrams(c.current_debt_grams)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setTargetCustomer(c);
                            setSaleModalOpen(true);
                          }}
                          className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 rounded-lg text-[11px] font-bold transition"
                        >
                          + Nasiya Sotuv
                        </button>
                        <button
                          onClick={() => {
                            setTargetCustomer(c);
                            setPaymentModalOpen(true);
                          }}
                          className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-lg text-[11px] font-bold transition"
                        >
                          To&apos;lov Qabul
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Mijozlar topilmadi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: DAILY LEDGER (Kunlik Savdo Jurnali) */}
      {activeTab === "daily_ledger" && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
              Kunlik Savdo va Tushumlar Jurnali ({dailyLedgerRows.length})
            </h3>
            <span className="text-xs text-slate-400">
              Sana, Klient, Sotilgan gr, Ustama %, gram+%, Lom berdi, Pul berdi, Qarzdorlik
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Sana</th>
                  <th className="py-3 px-3">Hujjat turi</th>
                  <th className="py-3 px-3">Klient Ism</th>
                  <th className="py-3 px-3">Mahsulot / Izoh</th>
                  <th className="py-3 px-3 font-mono text-cyan-300">Sotilgan gr</th>
                  <th className="py-3 px-3 font-mono">Ustama %</th>
                  <th className="py-3 px-3 font-mono text-rose-300">gram+%</th>
                  <th className="py-3 px-3 font-mono text-amber-300">Lom berdi</th>
                  <th className="py-3 px-3 font-mono text-emerald-300">Pul berdi (UZS)</th>
                  <th className="py-3 px-3 font-mono text-amber-200">Lom narxi</th>
                  <th className="py-3 px-3 font-mono text-emerald-200">Pul+Lom (eq)</th>
                  <th className="py-3 px-3 font-mono font-bold text-rose-400">Qarzdorlik</th>
                  <th className="py-3 px-3 text-center">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {dailyLedgerRows.map((r) => (
                  <tr key={`${r.tx_id}_${r.tx_type}`} className="hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 font-mono text-slate-300">{r.tx_date}</td>
                    <td className="py-2.5 px-3">
                      {r.tx_type === "sale" ? (
                        <span className="px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded text-[10px] font-bold">
                          🛍️ Savdo
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-bold">
                          💰 To&apos;lov
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">
                      {r.customer_name}{" "}
                      <span className="text-[10px] font-mono text-slate-500">({r.customer_code})</span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{r.model_name}</td>
                    <td className="py-2.5 px-3 font-mono text-cyan-300">
                      {Number(r.sold_weight_g) > 0 ? formatScreenGrams(r.sold_weight_g) : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      {Number(r.markup_pct) > 0 ? `${Number(r.markup_pct).toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-rose-300">
                      {Number(r.obligation_g) > 0 ? formatScreenGrams(r.obligation_g) : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-amber-300">
                      {Number(r.scrap_received_g) > 0 ? formatScreenGrams(r.scrap_received_g) : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-emerald-300">
                      {Number(r.cash_received_uzs) > 0 ? formatScreenUZS(r.cash_received_uzs) : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-amber-200">
                      {Number(r.rate_per_gram) > 0 ? formatScreenUZS(r.rate_per_gram) : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-emerald-200">
                      {Number(r.total_payment_g) > 0 ? formatScreenGrams(r.total_payment_g) : "—"}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-rose-400">
                      {formatScreenGrams(r.closing_debt_g)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {r.status === "reversed" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/80 text-rose-400 border border-rose-900/60">
                          Bekor qilingan
                        </span>
                      ) : isPrivileged || (r.tx_type === "sale" && r.item_id) ? (
                        <button
                          type="button"
                          onClick={() => openReversalModal(r)}
                          disabled={busy}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-rose-800/80 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 hover:text-white transition flex items-center gap-1 mx-auto"
                        >
                          <span>↩️</span> Bekor qilish
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500 italic" title="Faqat rahbar yoki menejer bekor qila oladi">
                          🔒 Tasdiqlangan
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {dailyLedgerRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-8 text-center text-slate-500">
                      Tanlangan oraliqda savdo yoki to&apos;lov yozuvlari topilmadi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: MONTHLY REPORT (Ойлик Ҳисобот) */}
      {activeTab === "monthly_report" && monthlyReportData && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                Oylik Hisobot — Mijozlar Balansi ({selectedYear}-yil, {selectedMonth}-oy)
              </h3>
              <span className="text-xs text-slate-400">
                Oldingi oy yakuniy qarzi = Yangi oy boshlang&apos;ich qarzi
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Mijoz Ismi</th>
                    <th className="py-3 px-3">Kod</th>
                    <th className="py-3 px-3 font-mono text-amber-200">Boshlang&apos;ich Qarz</th>
                    <th className="py-3 px-3 font-mono text-cyan-300">Oy Davomida Sotuv</th>
                    <th className="py-3 px-3 font-mono text-amber-300">Lom Tushumi</th>
                    <th className="py-3 px-3 font-mono text-emerald-300">Pul Tushumi (UZS)</th>
                    <th className="py-3 px-3 font-mono text-emerald-200">Pul Eq (g)</th>
                    <th className="py-3 px-3 font-mono text-emerald-400">Jami Yopilgan</th>
                    <th className="py-3 px-3 font-mono font-bold text-rose-400">Yakuniy Qarz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {monthlyReportData.items.map((it: MonthlyReportItem) => (
                    <tr key={it.customer_id} className="hover:bg-slate-900/50">
                      <td className="py-2.5 px-3 font-bold text-white">{it.customer_name}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{it.customer_code}</td>
                      <td className="py-2.5 px-3 font-mono text-amber-200">
                        {formatScreenGrams(it.opening_debt_g)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-cyan-300">
                        {formatScreenGrams(it.sales_in_month_g)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-amber-300">
                        {formatScreenGrams(it.scrap_received_g)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-300">
                        {formatScreenUZS(it.cash_received_uzs)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-200">
                        {formatScreenGrams(it.cash_equivalent_g)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-400">
                        {formatScreenGrams(it.total_settled_g)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-black text-rose-400 text-sm">
                        {formatScreenGrams(it.closing_debt_g)}
                      </td>
                    </tr>
                  ))}
                  {monthlyReportData.items.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        Ushbu oyda hech qanday harakat qayd etilmagan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Master Summary Card (Umumiy Kassa) */}
          <div className="bg-gradient-to-r from-slate-900 to-indigo-950 border border-slate-800 rounded-3xl p-6 text-white space-y-4 shadow-xl">
            <h4 className="text-base font-black text-amber-300 flex items-center gap-2">
              <span>📊</span> Umumiy Kassa & Bozor Qarzi Xulosasi
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs font-mono">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                <div className="text-slate-400 font-sans font-bold text-[11px]">Jami Tarqatilgan (Oyda)</div>
                <div className="text-lg font-black text-cyan-300">
                  {formatScreenGrams(monthlyReportData.summary.total_distributed_month_g)}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                <div className="text-slate-400 font-sans font-bold text-[11px]">Jami Yig&apos;ilgan (Oyda)</div>
                <div className="text-lg font-black text-emerald-400">
                  {formatScreenGrams(monthlyReportData.summary.total_collected_month_g)}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                <div className="text-slate-400 font-sans font-bold text-[11px]">Mijozlar Nasiya Qoldig&apos;i</div>
                <div className="text-lg font-black text-rose-400">
                  {formatScreenGrams(monthlyReportData.summary.total_customer_debt_g)}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                <div className="text-slate-400 font-sans font-bold text-[11px]">Sotuvchi G&apos;aznasi</div>
                <div className="text-xs font-bold text-slate-200">
                  <span className="text-amber-300">{formatScreenGrams(monthlyReportData.summary.seller_held_scrap_g)} lom</span>
                  <br />
                  <span className="text-emerald-400">{formatScreenUZS(monthlyReportData.summary.seller_held_cash_uzs)}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-amber-800/40 space-y-1">
                <div className="text-amber-300 font-sans font-bold text-[11px]">Boshqaruvchiga Bozor Qarzi</div>
                <div className="text-lg font-black text-amber-400">
                  {formatScreenGrams(Math.abs(monthlyReportData.summary.seller_manager_bozor_qarzi_g))}
                </div>
                <div className="text-[10px] text-slate-400 font-sans">
                  {monthlyReportData.summary.seller_manager_bozor_qarzi_g < 0 ? "(Sotuvchi qarzdor)" : "(Haqdor)"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD CUSTOMER */}
      {newCustomerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCustomer}
            className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-black text-amber-300 flex items-center gap-2">
              <span>+</span> Yangi Mijoz Ro&apos;yxatdan O&apos;tkazish
            </h3>
            <p className="text-xs text-slate-300">
              Har bir mijozga tizim avtomatik barqaror kod (CUST-xxxx) beradi.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-400 block mb-1">Mijoz To&apos;liq Ismi *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="Masalan: Dilrabo Karimova"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white"
                />
              </div>

              <div>
                <label className="font-bold text-slate-400 block mb-1">Telefon raqami</label>
                <input
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-400 block mb-1">Biriktirilgan Sotuvchi</label>
                <select
                  value={newCustSellerId}
                  onChange={(e) => setNewCustSellerId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white"
                >
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name || s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-400 block mb-1">Izoh / Manzil</label>
                <textarea
                  value={newCustNotes}
                  onChange={(e) => setNewCustNotes(e.target.value)}
                  placeholder="Do'kon joylashuvi yoki boshqa ma'lumotlar..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setNewCustomerModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition"
              >
                {busy ? "Saqlanmoqda..." : "Mijozni Saqlash"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: RECORD PAYMENT (TO'LOV QABUL QILISH) */}
      {paymentModalOpen && targetCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordPayment}
            className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-black text-emerald-400 flex items-center gap-2">
              <span>💰</span> Mijozdan To&apos;lov Qabul Qilish
            </h3>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
              <div className="font-bold text-white text-sm">{targetCustomer.contact_name}</div>
              <div className="text-slate-400 font-mono">
                Hozirgi qarz:{" "}
                <span className="text-rose-400 font-bold">
                  {formatScreenGrams(targetCustomer.current_debt_grams)}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-amber-300 block mb-1">Qaytarilgan Lom (g)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={payScrapWeight}
                    onChange={(e) => setPayScrapWeight(e.target.value)}
                    placeholder="0.0000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="font-bold text-amber-300 block mb-1">Lom Probasi</label>
                  <select
                    value={payScrapPurity}
                    onChange={(e) => setPayScrapPurity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono text-sm"
                  >
                    <option value="585">585 proba</option>
                    <option value="375">375 proba</option>
                    <option value="750">750 proba</option>
                    <option value="995">995 proba</option>
                    <option value="999.9">999.9 proba</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-emerald-300 block mb-1">To&apos;langan Naqd Pul (UZS)</label>
                <input
                  type="number"
                  step="1000"
                  min="0"
                  value={payCashAmount}
                  onChange={(e) => setPayCashAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono text-sm"
                />
              </div>

              <div>
                <label className="font-bold text-slate-400 block mb-1">Oltin Kursi (UZS / 1g lom)</label>
                <input
                  type="number"
                  value={payRate}
                  onChange={(e) => setPayRate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-400 block mb-1">Izoh</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="To'lov haqida qo'shimcha ma'lumot..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition"
              >
                {busy ? "Saqlanmoqda..." : "To'lovni Tasdiqlash"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: RECORD SALE (NASIYA SAVDO) */}
      {saleModalOpen && targetCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordSale}
            className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-black text-cyan-400 flex items-center gap-2">
              <span>🛍️</span> Aniq Donani Nasiya Sotish
            </h3>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
              <div className="font-bold text-white text-sm">{targetCustomer.contact_name}</div>
              <div className="text-slate-400 font-mono">
                Hozirgi qarz:{" "}
                <span className="text-rose-400 font-bold">
                  {formatScreenGrams(targetCustomer.current_debt_grams)}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-amber-300 block mb-1">
                  Sotuvchi Javonidagi Aniq Fizik Dona *
                </label>
                <select
                  required
                  value={salePieceId}
                  onChange={(e) => setSalePieceId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono"
                >
                  <option value="">Donani tanlang...</option>
                  {availablePieces
                    .filter((p) => !targetCustomer.seller_id || String(p.seller_id) === String(targetCustomer.seller_id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.model_name} ({p.model_code}) — {formatScreenGrams(p.weight_grams)}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-cyan-300 block mb-1">Mijoz Ustama Foizi (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={saleMarkupPct}
                  onChange={(e) => setSaleMarkupPct(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Standart: 12.0% yoki 15.0%. Asl bazaviy vazndan mustaqil hisoblanadi.
                </span>
              </div>

              <div>
                <label className="font-bold text-slate-400 block mb-1">Izoh</label>
                <input
                  type="text"
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  placeholder="Nasiya muddati yoki qo'shimcha ma'lumot..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSaleModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={busy || !salePieceId}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black transition"
              >
                {busy ? "Sotilmoqda..." : "Nasiyani Rasmiylashtirish"}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* MODAL: REVERSAL / BEKOR QILISH (Compensating Transaction) */}
      {reversalModalOpen && reversalTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 text-white space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-base">
                <span>↩️</span>
                <h3>Operatsiyani Bekor Qilish (Auditli Kompensatsiya)</h3>
              </div>
              <button
                type="button"
                onClick={() => setReversalModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-2xl text-xs text-amber-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <span>🛡️</span> Xavfsiz Auditli Tuzatish
              </div>
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                Ushbu amal ma&apos;lumotlarni o&apos;chirmaydi. Aksincha, moliyaviy va fizik oltin qoldiqlarini
                to&apos;g&apos;ri holatga qaytaruvchi kompensatsion yozuv va to&apos;liq audit qaydini yaratadi.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs space-y-2 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Hujjat turi:</span>
                <span className="font-bold text-white uppercase">{reversalTarget.tx_type === "sale" ? "Savdo (Nasiya)" : "To'lov / Qaytim"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Kvitansiya ID:</span>
                <span className="text-slate-300">{reversalTarget.tx_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Mijoz:</span>
                <span className="font-bold text-amber-300">{reversalTarget.customer_name} ({reversalTarget.customer_code})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Sotuvchi:</span>
                <span className="text-slate-300">{reversalTarget.seller_name}</span>
              </div>
              {reversalTarget.tx_type === "sale" ? (
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">Bekor qilinadigan qarz:</span>
                  <span className="font-bold text-rose-400">-{formatScreenGrams(reversalTarget.obligation_g)}</span>
                </div>
              ) : (
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">Bekor qilinadigan to&apos;lov:</span>
                  <span className="font-bold text-amber-400">
                    {formatScreenGrams(reversalTarget.scrap_received_g)} lom / {formatScreenUZS(reversalTarget.cash_received_uzs)} naqd
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-rose-300 flex items-center gap-1">
                <span>✍️</span> Bekor qilish sababi (Majburiy)
              </label>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="Xato kiritilgan summa, mijoz tovarini qaytardi, noto'g'ri tushum..."
                rows={3}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReversalModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition"
              >
                Orqaga
              </button>
              <button
                type="button"
                disabled={busy || !reversalReason.trim()}
                onClick={handleExecuteReversal}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
              >
                {busy ? "Bekor qilinmoqda..." : "Tasdiqlash & Bekor Qilish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
