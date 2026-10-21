"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  supabase,
  GoldEngine,
  generateIdempotencyKey,
  RBAC,
  type SalesMarkupPresetRow,
  type SellerConsignmentRow,
  type JewelrySaleRow,
  type ClientGoldAccountRow,
  type SellerGoldAccountRow,
  type DailyGoldRateRow,
  type EmployeeRow,
} from "@/lib/erp-engine";
import { SalesReceiptModal, type ReceiptData } from "./SalesReceiptModal";

interface CustomerItem {
  id: string;
  customer_code?: string;
  contact_name: string;
  phone?: string;
  company_name?: string;
}

export function SellerMobileWorkspace() {
  const [activeTab, setActiveTab] = useState<"stock" | "sale" | "settle" | "debts" | "customer" | "till">("stock");

  // State
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Current seller info
  const [currentSeller, setCurrentSeller] = useState<EmployeeRow | null>(null);
  const [allSellers, setAllSellers] = useState<EmployeeRow[]>([]);
  const [isDirectorViewing, setIsDirectorViewing] = useState(false);

  // Data
  const [dailyRate, setDailyRate] = useState<DailyGoldRateRow | null>(null);
  const [activeClientMarkups, setActiveClientMarkups] = useState<SalesMarkupPresetRow[]>([]);
  const [myConsignments, setMyConsignments] = useState<SellerConsignmentRow[]>([]);
  const [mySales, setMySales] = useState<JewelrySaleRow[]>([]);
  const [myTillAccount, setMyTillAccount] = useState<SellerGoldAccountRow | null>(null);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [clientAccounts, setClientAccounts] = useState<ClientGoldAccountRow[]>([]);

  // Form: Customer Registration
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("+998 ");
  const [newCustCompany, setNewCustCompany] = useState("");
  const [registeredCodeNotice, setRegisteredCodeNotice] = useState<string | null>(null);

  // Form: Sale on Debt
  const [saleConsignmentId, setSaleConsignmentId] = useState("");
  const [saleCustomerId, setSaleCustomerId] = useState("");
  const [saleClientMarkup, setSaleClientMarkup] = useState("12.00");
  const [saleNotes, setSaleNotes] = useState("");

  // Form: Settlement / Payment (Pul yoki Lom qabul qilish)
  const [settleCustomerId, setSettleCustomerId] = useState("");
  const [settleScrapWeight, setSettleScrapWeight] = useState("");
  const [settleScrapPurity, setSettleScrapPurity] = useState("585");
  const [settleCashAmount, setSettleCashAmount] = useState("");
  const [settleNotes, setSettleNotes] = useState("");

  const notifySuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };
  const notifyError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 6000);
  };

  // Load user, active markups, and seller-specific data
  const loadSellerWorkspace = useCallback(async () => {
    try {
      const currentUser = RBAC.getCurrentUser();
      const userRole = (currentUser?.role || "").toLowerCase();
      const isAdminOrDir = ["admin", "director", "owner", "direktor", "rahbar"].includes(userRole);
      setIsDirectorViewing(isAdminOrDir);

      // Fetch employees to identify seller
      const { data: empRows } = await supabase.from("employees").select("*").eq("is_active", true);
      const emps = (empRows || []) as EmployeeRow[];
      setAllSellers(emps);

      let targetEmp: EmployeeRow | undefined;
      if (currentUser?.id) {
        targetEmp = emps.find(e => String(e.id) === String(currentUser.id) || String(e.user_id) === String(currentUser.id));
      }
      if (!targetEmp && emps.length > 0) {
        targetEmp = emps.find(e => e.role === "sales" || e.role_type === "seller") || emps[0];
      }
      setCurrentSeller(targetEmp || null);

      const sellerId = targetEmp ? String(targetEmp.id) : null;

      // Parallel queries: daily rate, active presets, consignments, sales, till, customers, client accounts
      const [
        ratesRes,
        presetsRes,
        consignRes,
        salesRes,
        tillRes,
        custRes,
        clientAccRes,
      ] = await Promise.all([
        supabase.from("daily_gold_rates").select("*").order("rate_date", { ascending: false }).limit(1),
        supabase.rpc("rpc_get_active_sales_markups", { p_type: "client_markup" }),
        sellerId
          ? supabase.from("seller_consignments").select("*").eq("seller_id", sellerId).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        sellerId
          ? supabase.from("jewelry_sales").select("*, customer:customer_id(id, contact_name, customer_code, phone)").eq("seller_id", sellerId).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        sellerId
          ? supabase.from("seller_gold_accounts").select("*").eq("seller_id", sellerId).maybeSingle()
          : Promise.resolve({ data: null }),
        sellerId && !isAdminOrDir
          ? supabase.from("customers").select("id, customer_code, contact_name, phone, company_name, seller_id").or(`seller_id.eq.${sellerId},seller_id.is.null`).order("contact_name", { ascending: true })
          : supabase.from("customers").select("id, customer_code, contact_name, phone, company_name, seller_id").order("contact_name", { ascending: true }),
        sellerId && !isAdminOrDir
          ? supabase.from("client_gold_accounts").select("*, customer:customer_id(id, contact_name, customer_code, phone)").eq("seller_id", sellerId)
          : supabase.from("client_gold_accounts").select("*, customer:customer_id(id, contact_name, customer_code, phone)"),
      ]);

      if (ratesRes.data && ratesRes.data.length > 0) {
        setDailyRate(ratesRes.data[0] as DailyGoldRateRow);
      }
      if (presetsRes.data) {
        const pList = (Array.isArray(presetsRes.data) ? presetsRes.data : []) as SalesMarkupPresetRow[];
        setActiveClientMarkups(pList);
        const def = pList.find(p => p.is_default) || pList[0];
        if (def && !saleClientMarkup) {
          setSaleClientMarkup(String(def.percentage));
        }
      }
      if (consignRes.data) {
        setMyConsignments(consignRes.data as unknown as SellerConsignmentRow[]);
      }
      if (salesRes.data) {
        setMySales(salesRes.data as unknown as JewelrySaleRow[]);
      }
      if (tillRes.data) {
        setMyTillAccount(tillRes.data as unknown as SellerGoldAccountRow);
      }
      if (custRes.data) {
        setCustomers(custRes.data as CustomerItem[]);
      }
      if (clientAccRes.data) {
        setClientAccounts(clientAccRes.data as unknown as ClientGoldAccountRow[]);
      }
    } catch (err: unknown) {
      notifyError(`Sotuvchi panelini yuklashda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [saleClientMarkup]);

  useEffect(() => {
    void loadSellerWorkspace();
  }, [loadSellerWorkspace]);

  // Telegram Mini App WebView integration
  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void } } }).Telegram?.WebApp) {
      try {
        const tg = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void } } }).Telegram?.WebApp;
        tg?.ready();
        tg?.expand();
      } catch (err) {
        console.warn("Telegram WebApp initialization error:", err);
      }
    }
  }, []);

  // Switch seller if Director
  const handleSwitchSeller = (sellerId: string) => {
    const s = allSellers.find(e => String(e.id) === sellerId);
    if (s) {
      setCurrentSeller(s);
      // Reload seller specific data
      void (async () => {
        const [consignRes, salesRes, tillRes] = await Promise.all([
          supabase.from("seller_consignments").select("*").eq("seller_id", s.id).order("created_at", { ascending: false }),
          supabase.from("jewelry_sales").select("*, customer:customer_id(id, contact_name, customer_code, phone)").eq("seller_id", s.id).order("created_at", { ascending: false }),
          supabase.from("seller_gold_accounts").select("*").eq("seller_id", s.id).maybeSingle(),
        ]);
        if (consignRes.data) setMyConsignments(consignRes.data as unknown as SellerConsignmentRow[]);
        if (salesRes.data) setMySales(salesRes.data as unknown as JewelrySaleRow[]);
        if (tillRes.data) setMyTillAccount(tillRes.data as unknown as SellerGoldAccountRow);
      })();
    }
  };

  // 1. Quick Customer Registration Action
  const handleRegisterCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) {
      notifyError("Mijoz ismini kiritish majburiy!");
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("rpc_register_or_get_customer", {
        p_contact_name: newCustName.trim(),
        p_phone: newCustPhone.trim() || null,
        p_company_name: newCustCompany.trim() || null,
        p_seller_id: currentSeller?.id || null,
      });

      if (error) throw error;

      const code = data.customer_code || "CUST-NEW";
      setRegisteredCodeNotice(`Mijoz muvaffaqiyatli ro'yxatga olindi! Doimiy ID Kodi: ${code}`);
      notifySuccess(`Yangi mijoz qo'shildi: ${data.contact_name} (${code})`);

      // Refresh customers list
      const { data: newCustList } = await supabase.from("customers").select("id, customer_code, contact_name, phone, company_name").order("contact_name", { ascending: true });
      if (newCustList) {
        setCustomers(newCustList as CustomerItem[]);
        // Auto-select for sale or settlement
        setSaleCustomerId(data.customer_id);
        setSettleCustomerId(data.customer_id);
      }

      setNewCustName("");
      setNewCustCompany("");
      // Switch to sale tab if coming from sale workflow
      setTimeout(() => {
        setRegisteredCodeNotice(null);
      }, 8000);
    } catch (err: unknown) {
      notifyError(`Mijozni ro'yxatdan o'tkazishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 2. Sell to Customer on Debt (Nasiyaga Sotish)
  const selectedConsignment = useMemo(() => {
    return myConsignments.find(c => String(c.id) === saleConsignmentId) || null;
  }, [myConsignments, saleConsignmentId]);

  const selectedCustomer = useMemo(() => {
    return customers.find(c => String(c.id) === saleCustomerId) || null;
  }, [customers, saleCustomerId]);

  const liveSaleCalc = useMemo(() => {
    if (!selectedConsignment) return null;
    const baseW = Number(selectedConsignment.base_weight_grams || 0);
    const fPct = Number(selectedConsignment.factory_markup_pct || 0);
    const cPct = parseFloat(saleClientMarkup) || 0;
    return GoldEngine.calculateJewelryConsignmentAndSale(baseW, fPct, cPct);
  }, [selectedConsignment, saleClientMarkup]);

  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleConsignmentId) {
      notifyError("Iltimos, sotilayotgan mahsulotni tanlang!");
      return;
    }
    if (!saleCustomerId) {
      notifyError("Iltimos, mijozni tanlang yoki 'Yangi Mijoz' bo'limida ro'yxatdan o'tkazing!");
      return;
    }

    const cPct = parseFloat(saleClientMarkup);
    if (isNaN(cPct) || cPct < 0) {
      notifyError("Mijoz ustama foizi xato kiritilgan!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("sale-client");
      const { data, error } = await supabase.rpc("rpc_record_client_jewelry_sale", {
        p_customer_id: saleCustomerId,
        p_consignment_id: saleConsignmentId,
        p_client_markup_pct: cPct,
        p_notes: saleNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      // Show receipt modal
      if (liveSaleCalc && selectedConsignment) {
        setReceiptData({
          title: "Mijozga Nasiya Savdo Cheki",
          receiptNo: data.sale_no || "SALE-NEW",
          date: new Date().toLocaleDateString("uz-UZ"),
          sellerName: currentSeller?.name || currentSeller?.full_name || "Sotuvchi",
          customerName: selectedCustomer?.contact_name || "Mijoz",
          customerCode: selectedCustomer?.customer_code,
          customerPhone: selectedCustomer?.phone,
          itemName: selectedConsignment.product_name || selectedConsignment.item_name,
          baseWeightGrams: liveSaleCalc.baseWeightGrams,
          purity: Number(selectedConsignment.proba || 585),
          factoryMarkupPct: liveSaleCalc.factoryMarkupPct,
          factoryGoldDueGrams: liveSaleCalc.factoryGoldDueGrams,
          clientMarkupPct: liveSaleCalc.clientMarkupPct,
          clientGoldDueGrams: liveSaleCalc.clientGoldDueGrams,
          markupSpreadGrams: liveSaleCalc.markupSpreadGrams,
          remainingDebtGrams: liveSaleCalc.clientGoldDueGrams,
          notes: saleNotes || "Mijozga nasiya asosida topshirildi",
        });
      }

      notifySuccess(`№${data.sale_no} savdo muvaffaqiyatli rasmiylashtirildi! Chek shakllantirildi.`);
      setSaleNotes("");
      setSaleConsignmentId("");
      await loadSellerWorkspace();
      setActiveTab("stock");
    } catch (err: unknown) {
      notifyError(`Savdoni yozishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 3. Settlement / Payment Action (Pul yoki Lom qabul qilish)
  const selectedSettleCustomer = useMemo(() => {
    return customers.find(c => String(c.id) === settleCustomerId) || null;
  }, [customers, settleCustomerId]);

  const customerDebtAccount = useMemo(() => {
    if (!settleCustomerId) return null;
    return clientAccounts.find(a => String(a.customer_id) === settleCustomerId) || null;
  }, [clientAccounts, settleCustomerId]);

  const previousDebtForSettle = Number(customerDebtAccount?.current_debt_grams || customerDebtAccount?.current_gold_debt_grams || 0);

  const activeRatePerGram = Number(dailyRate?.rate_per_gram || 900000);

  const liveSettleCalc = useMemo(() => {
    const scrapW = parseFloat(settleScrapWeight) || 0;
    const cash = parseFloat(settleCashAmount) || 0;
    return GoldEngine.calculateGoldSettlement(
      previousDebtForSettle,
      scrapW,
      cash,
      activeRatePerGram
    );
  }, [previousDebtForSettle, settleScrapWeight, settleCashAmount, activeRatePerGram]);

  const handleRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleCustomerId) {
      notifyError("Iltimos, to'lov qilayotgan mijozni tanlang!");
      return;
    }

    const scrapW = parseFloat(settleScrapWeight) || 0;
    const cash = parseFloat(settleCashAmount) || 0;

    if (scrapW <= 0 && cash <= 0) {
      notifyError("Iltimos, to'langan lom oltin vazni yoki naqd pul summasini kiriting!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("settle-client");
      const { data, error } = await supabase.rpc("rpc_record_client_settlement", {
        p_customer_id: settleCustomerId,
        p_sale_id: null,
        p_scrap_weight: scrapW,
        p_scrap_proba: parseInt(settleScrapPurity, 10) || 585,
        p_cash_amount: cash,
        p_rate_per_gram: activeRatePerGram,
        p_notes: settleNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      // Show receipt modal
      setReceiptData({
        title: "Mijoz To'lovi & Tushum Kvitansiyasi",
        receiptNo: data.settlement_no || "SETTL-NEW",
        date: new Date().toLocaleDateString("uz-UZ"),
        sellerName: currentSeller?.name || currentSeller?.full_name || "Sotuvchi",
        customerName: selectedSettleCustomer?.contact_name || "Mijoz",
        customerCode: selectedSettleCustomer?.customer_code,
        customerPhone: selectedSettleCustomer?.phone,
        scrapWeightGrams: scrapW,
        scrapPurity: parseInt(settleScrapPurity, 10) || 585,
        cashAmount: cash,
        goldRateApplied: activeRatePerGram,
        cashEquivalentGrams: liveSettleCalc.cashEquivalentGrams,
        totalSettledGrams: liveSettleCalc.totalSettledGrams,
        previousDebtGrams: liveSettleCalc.previousDebtGrams,
        remainingDebtGrams: liveSettleCalc.remainingDebtGrams,
        advanceGoldGrams: liveSettleCalc.excessGoldGrams,
        notes: settleNotes || "Mijozdan lom va naqd pul qabul qilindi",
      });

      notifySuccess(`№${data.settlement_no} to'lov qabul qilindi! Kassaga kirim qilindi.`);
      setSettleScrapWeight("");
      setSettleCashAmount("");
      setSettleNotes("");
      await loadSellerWorkspace();
    } catch (err: unknown) {
      notifyError(`To'lovni qabul qilishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // Quick Action: Pre-select product for sale
  const handleQuickSell = (consignId: string) => {
    setSaleConsignmentId(consignId);
    setActiveTab("sale");
  };

  // Quick Action: Pre-select customer for settlement
  const handleQuickSettle = (custId: string) => {
    setSettleCustomerId(custId);
    setActiveTab("settle");
  };

  // Filtered available items in seller's hand
  const availableConsignments = myConsignments.filter(c => c.status === "held_by_seller");

  // Filtered debtors
  const debtorsList = clientAccounts.filter(c => Number(c.current_debt_grams || c.current_gold_debt_grams || 0) > 0);

  // Till status numbers
  const myTillScrap = Number(myTillAccount?.seller_till_scrap_grams || 0);
  const myTillCash = Number(myTillAccount?.seller_till_cash_amount || 0);
  const myFactoryObligation = Number(myTillAccount?.current_factory_obligation_grams || myTillAccount?.remaining_factory_gold_due_grams || 0);

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-12">
      {/* Toast notifications */}
      {successMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-300 text-emerald-900 px-4 py-3 rounded-2xl flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 font-medium text-xs">
            <span>✅</span>
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-700 font-bold">✕</button>
        </div>
      )}
      {errorMessage && (
        <div className="bg-red-50 border-2 border-red-300 text-red-900 px-4 py-3 rounded-2xl flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 font-medium text-xs">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-red-700 font-bold">✕</button>
        </div>
      )}

      {/* Top Header Card (Mobile-first, high contrast) */}
      <div className="bg-slate-950 text-white rounded-3xl p-5 shadow-2xl border-2 border-slate-800">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="text-xs uppercase font-extrabold tracking-widest text-amber-400">
              Sotuvchi Mobil Ish Joyi
            </div>
            <h1 className="text-xl md:text-2xl font-black mt-1 text-white">
              {currentSeller?.name || currentSeller?.full_name || "Sotuvchi"}
            </h1>
            <div className="text-xs text-slate-200 mt-1 font-medium">
              Bugungi Lom Kursi: <span className="font-mono font-black text-amber-300">{activeRatePerGram.toLocaleString()} UZS/g</span>
            </div>
          </div>

          {/* Director simulation selector */}
          {isDirectorViewing && (
            <div className="text-right">
              <span className="text-[11px] text-slate-300 block mb-1 font-bold">Sotuvchini tanlash:</span>
              <select
                value={currentSeller?.id || ""}
                onChange={(e) => handleSwitchSeller(e.target.value)}
                className="bg-slate-900 text-white text-xs rounded-xl p-2 font-bold outline-none border-2 border-slate-700 focus:border-amber-400"
              >
                {allSellers.map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                    {s.name || s.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Seller Till Summary Banner */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800 text-center">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-2.5">
            <div className="text-xs font-bold text-slate-200">Kassamdagi Lom</div>
            <div className="text-base font-black font-mono text-amber-300 mt-0.5">
              {myTillScrap.toFixed(4)} <span className="text-xs font-bold text-slate-200">g</span>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-2.5">
            <div className="text-xs font-bold text-slate-200">Kassamdagi Naqd</div>
            <div className="text-base font-black font-mono text-emerald-400 mt-0.5">
              {myTillCash.toLocaleString()} <span className="text-[10px] font-bold text-slate-200">UZS</span>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-2.5">
            <div className="text-xs font-bold text-slate-200">Zavod Majburiyati</div>
            <div className="text-base font-black font-mono text-rose-400 mt-0.5">
              {myFactoryObligation.toFixed(4)} <span className="text-xs font-bold text-slate-200">g</span>
            </div>
          </div>
        </div>
      </div>

      {/* Touch-Friendly Navigation Tabs (Touch targets >= 44px) */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 bg-slate-900 border-2 border-slate-800 p-2 rounded-2xl text-xs font-bold shadow-md">
        <button
          onClick={() => setActiveTab("stock")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "stock" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          💎 Mahsulotlar ({availableConsignments.length})
        </button>
        <button
          onClick={() => setActiveTab("sale")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "sale" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          🏷️ Nasiya
        </button>
        <button
          onClick={() => setActiveTab("settle")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "settle" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          💰 To&apos;lov Olish
        </button>
        <button
          onClick={() => setActiveTab("debts")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "debts" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          📒 Qarzlar ({debtorsList.length})
        </button>
        <button
          onClick={() => setActiveTab("customer")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "customer" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          ➕ Yangi Mijoz
        </button>
        <button
          onClick={() => setActiveTab("till")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "till" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          🏦 Kassam
        </button>
      </div>

      {/* TAB 1: MY CONSIGNED STOCK */}
      {activeTab === "stock" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-base font-bold text-slate-800">O&apos;zimdagi Mahsulotlar (Vitrina)</h2>
            <span className="text-xs text-slate-500 font-medium">Jami: {availableConsignments.length} dona</span>
          </div>

          {availableConsignments.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border text-center text-slate-500 space-y-2">
              <div className="text-3xl">📦</div>
              <div className="font-bold text-sm">Hozirda sizga topshirilgan mahsulot yo&apos;q</div>
              <p className="text-xs text-slate-400">
                Direktor panel orqali sizga mahsulot topshirishi bilan bu yerda ko&apos;rinadi.
              </p>
            </div>
          ) : (
            availableConsignments.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm space-y-3 hover:border-blue-400 transition"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{c.product_name || c.item_name}</div>
                    <div className="text-[11px] font-mono text-blue-600 font-bold mt-0.5">
                      {c.consignment_no}
                    </div>
                  </div>
                  <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {c.proba || 585}° proba
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-2xl text-center text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Asl Vazn</span>
                    <span className="font-mono font-bold text-slate-800">{Number(c.base_weight_grams).toFixed(4)} g</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Zavod Ustamasi</span>
                    <span className="font-mono font-bold text-amber-700">+{c.factory_markup_pct}%</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Zavod Majburiyati</span>
                    <span className="font-mono font-bold text-slate-900">{Number(c.factory_gold_due_grams).toFixed(4)} g</span>
                  </div>
                </div>

                <button
                  onClick={() => handleQuickSell(c.id)}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                >
                  <span>🏷️</span> Mijozga Nasiyaga Sotish
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: SELL TO CUSTOMER (NASIYA) */}
      {activeTab === "sale" && (
        <form
          onSubmit={(e) => void handleRecordSale(e)}
          className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-sm"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">Mijozga Nasiyaga Mahsulot Sotish</h2>
            <p className="text-xs text-slate-500">
              Faqat direktor tasdiqlagan foizlar tanlanadi. Asl vazndan alohida hisoblanadi.
            </p>
          </div>

          <div className="space-y-3">
            {/* Consignment Selection */}
            <div>
              <label htmlFor="saleConsignmentSelect" className="block text-xs font-bold text-slate-700 mb-1">Topshiriladigan Mahsulot:</label>
              <select
                id="saleConsignmentSelect"
                value={saleConsignmentId}
                onChange={(e) => setSaleConsignmentId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">Mahsulotni tanlang...</option>
                {availableConsignments.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.product_name || c.item_name} ({Number(c.base_weight_grams).toFixed(4)}g, {c.proba || 585}°) — Zavod: +{c.factory_markup_pct}%
                  </option>
                ))}
              </select>
            </div>

            {/* Customer Selection */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="saleCustomerSelect" className="text-xs font-bold text-slate-700">Mijoz:</label>
                <button
                  type="button"
                  onClick={() => setActiveTab("customer")}
                  className="text-[11px] font-bold text-blue-600 hover:underline"
                >
                  + Yangi Mijoz Qo&apos;shish
                </button>
              </div>
              <select
                id="saleCustomerSelect"
                value={saleCustomerId}
                onChange={(e) => setSaleCustomerId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">Mijozni tanlang...</option>
                {customers.map((cust) => (
                  <option key={cust.id} value={cust.id}>
                    {cust.contact_name} ({cust.customer_code || "KODSIZ"}) {cust.phone ? `• ${cust.phone}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Client Markup Selection — Strictly restricted to active director approved markups */}
            <div>
              <label htmlFor="saleClientMarkupSelect" className="block text-xs font-bold text-slate-700 mb-1">
                Mijozga Sotish Ustamasi (%):
              </label>
              <select
                id="saleClientMarkupSelect"
                value={saleClientMarkup}
                onChange={(e) => setSaleClientMarkup(e.target.value)}
                className="w-full p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl font-bold text-indigo-900 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                {activeClientMarkups.map((preset) => (
                  <option key={preset.id} value={preset.percentage}>
                    {preset.name} (+{preset.percentage}%) {preset.is_default ? "★" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Live Calculation Cards (Strict Rule: Non-Compounding, Asl vazndan hisoblanadi) */}
            {liveSaleCalc && selectedConsignment && (
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 rounded-2xl space-y-2">
                <div className="text-[11px] font-bold text-amber-900 uppercase">
                  Jonli Hisob-Kitob (Non-Compounding):
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Asl Mahsulot Vazni:</span>
                  <span className="font-mono font-bold text-slate-900">{liveSaleCalc.baseWeightGrams.toFixed(4)} g</span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Zavod Majburiyati (+{liveSaleCalc.factoryMarkupPct}%):</span>
                  <span className="font-mono font-bold text-slate-800">{liveSaleCalc.factoryGoldDueGrams.toFixed(4)} g</span>
                </div>

                <div className="border-t border-amber-200/80 pt-2 flex justify-between text-sm">
                  <span className="font-bold text-amber-950">Mijozning Oltin Qarzi (+{liveSaleCalc.clientMarkupPct}%):</span>
                  <span className="font-mono font-black text-amber-950 text-base">
                    {liveSaleCalc.clientGoldDueGrams.toFixed(4)} g lom
                  </span>
                </div>

                <div className="flex justify-between text-xs text-slate-500 italic pt-1 border-t border-amber-200/50">
                  <span>Hisob-kitobdagi farq (Spread):</span>
                  <span className="font-mono font-semibold">+{liveSaleCalc.markupSpreadGrams.toFixed(4)} g</span>
                </div>
                <div className="text-[10px] text-amber-700 italic">
                  * Eslatma: Foizlar ketma-ket ko&apos;paytirilmaydi. Farq faqat hisob-kitobdagi tafovut bo&apos;lib, shaxsiy foyda emas.
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Izoh (ixtiyoriy):</label>
              <input
                type="text"
                placeholder="To'lov muddati yoki shartlar..."
                value={saleNotes}
                onChange={(e) => setSaleNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !saleConsignmentId || !saleCustomerId}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg transition"
            >
              {busy ? "Rasmiylashtirilmoqda..." : "Nasiyani Rasmiylashtirish & Chek"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: SETTLEMENT / ACCEPT SCRAP & CASH */}
      {activeTab === "settle" && (
        <form
          onSubmit={(e) => void handleRecordSettlement(e)}
          className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-sm"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">Mijozdan To&apos;lov (Lom yoki Pul) Qabul Qilish</h2>
            <p className="text-xs text-slate-500">
              Qoida 5: To&apos;lov to&apos;g&apos;ridan-to&apos;g&apos;ri sizning kassangizga kiradi. Naqd pul kurs bo&apos;yicha lomga aylanadi.
            </p>
          </div>

          <div className="space-y-3">
            {/* Customer Selection */}
            <div>
              <label htmlFor="settleCustomerSelect" className="block text-xs font-bold text-slate-700 mb-1">Mijoz:</label>
              <select
                id="settleCustomerSelect"
                value={settleCustomerId}
                onChange={(e) => setSettleCustomerId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">To&apos;lov qiluvchi mijozni tanlang...</option>
                {customers.map((cust) => {
                  const acc = clientAccounts.find(a => String(a.customer_id) === String(cust.id));
                  const debt = Number(acc?.current_debt_grams || acc?.current_gold_debt_grams || 0);
                  return (
                    <option key={cust.id} value={cust.id}>
                      {cust.contact_name} ({cust.customer_code || "KODSIZ"}) {debt > 0 ? `• Qarz: ${debt.toFixed(4)}g` : "• Qarzsiz"}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Current Debt & Advance notice */}
            {settleCustomerId && (
              <div className="bg-slate-50 border p-3 rounded-2xl flex justify-between items-center text-xs">
                <div>
                  <span className="text-slate-500 block">Mijozning Joriy Qarzi:</span>
                  <span className="font-mono font-bold text-rose-600 text-sm">
                    {previousDebtForSettle.toFixed(4)} g lom
                  </span>
                </div>
                {Number(customerDebtAccount?.advance_balance_grams || customerDebtAccount?.advance_gold_balance_grams || 0) > 0 && (
                  <div className="text-right">
                    <span className="text-slate-500 block">Avans Balansi:</span>
                    <span className="font-mono font-bold text-blue-600">
                      +{Number(customerDebtAccount?.advance_balance_grams || customerDebtAccount?.advance_gold_balance_grams).toFixed(4)} g
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Scrap Gold Input */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="settleScrapWeightInput" className="block text-xs font-bold text-slate-700 mb-1">Lom Oltin (g):</label>
                <input
                  id="settleScrapWeightInput"
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="0.0000"
                  value={settleScrapWeight}
                  onChange={(e) => setSettleScrapWeight(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs font-bold text-amber-900"
                />
              </div>
              <div>
                <label htmlFor="settleScrapPuritySelect" className="block text-xs font-bold text-slate-700 mb-1">Proba:</label>
                <select
                  id="settleScrapPuritySelect"
                  value={settleScrapPurity}
                  onChange={(e) => setSettleScrapPurity(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                >
                  <option value="585">585 proba</option>
                  <option value="750">750 proba</option>
                  <option value="999">999 proba</option>
                </select>
              </div>
            </div>

            {/* Cash Input */}
            <div>
              <label htmlFor="settleCashAmountInput" className="block text-xs font-bold text-slate-700 mb-1">
                Naqd Pul (UZS) (Kurs: {activeRatePerGram.toLocaleString()} UZS/g):
              </label>
              <input
                id="settleCashAmountInput"
                type="number"
                step="1000"
                min="0"
                placeholder="0"
                value={settleCashAmount}
                onChange={(e) => setSettleCashAmount(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs font-bold text-emerald-800"
              />
            </div>

            {/* Live Calculation Preview */}
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl space-y-2 text-xs">
              <div className="text-[11px] font-bold text-emerald-900 uppercase">
                Avtomatik Kalkulyator (Jonli):
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Naqd pulning lom ekvivalenti:</span>
                <span className="font-mono font-bold text-emerald-800">
                  {liveSettleCalc.cashEquivalentGrams.toFixed(4)} g
                </span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 border-t border-emerald-200/80 pt-1">
                <span>Jami To&apos;lanayotgan Lom:</span>
                <span className="font-mono text-sm text-emerald-950">
                  {liveSettleCalc.totalSettledGrams.toFixed(4)} g
                </span>
              </div>
              <div className="flex justify-between text-slate-700 pt-1 border-t border-emerald-200/50">
                <span>Qoladigan Qarz:</span>
                <span className={`font-mono font-bold ${liveSettleCalc.remainingDebtGrams > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                  {liveSettleCalc.remainingDebtGrams.toFixed(4)} g
                </span>
              </div>
              {liveSettleCalc.excessGoldGrams > 0 && (
                <div className="flex justify-between font-bold text-blue-700 bg-blue-50/80 p-2 rounded-xl">
                  <span>Ortiqcha Qaytim (Avans saqlanadi):</span>
                  <span className="font-mono">+{liveSettleCalc.excessGoldGrams.toFixed(4)} g</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Izoh (ixtiyoriy):</label>
              <input
                type="text"
                placeholder="To'lov izohi..."
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !settleCustomerId}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg transition"
            >
              {busy ? "Qabul qilinmoqda..." : "To'lovni Kassaga Olish & Chek"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: DEBTORS LIST */}
      {activeTab === "debts" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-base font-bold text-slate-800">Qarz Daftari (Kim qancha berishi kerak)</h2>
            <span className="text-xs text-rose-600 font-bold">Qarzdorlar: {debtorsList.length} nafar</span>
          </div>

          {debtorsList.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border text-center text-slate-500 space-y-2">
              <div className="text-3xl">🎉</div>
              <div className="font-bold text-sm">Hozircha faol qarzdorlar yo&apos;q</div>
              <p className="text-xs text-slate-400">Barcha mijozlar o&apos;z vaqtida hisob-kitob qilgan.</p>
            </div>
          ) : (
            debtorsList.map((acc) => {
              const curDebt = Number(acc.current_debt_grams || acc.current_gold_debt_grams || 0);
              const relatedCustomer = acc.customer || customers.find(c => String(c.id) === String(acc.customer_id));
              const custName = relatedCustomer?.contact_name || "Mijoz";
              const custCode = relatedCustomer?.customer_code || "KODSIZ";

              return (
                <div
                  key={acc.customer_id}
                  className="bg-white rounded-3xl p-4 border border-rose-100 shadow-sm space-y-3 hover:border-rose-300 transition"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{custName}</div>
                      <div className="text-[11px] font-mono text-blue-600 font-bold">{custCode}</div>
                      {relatedCustomer?.phone && (
                        <div className="text-xs text-slate-500">{relatedCustomer.phone}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">Qarzi</span>
                      <span className="text-base font-black font-mono text-rose-600">
                        {curDebt.toFixed(4)} g
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleQuickSettle(acc.customer_id)}
                    className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                  >
                    <span>💰</span> To&apos;lov / Lom Qabul Qilish
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 5: REGISTER NEW CUSTOMER */}
      {activeTab === "customer" && (
        <form
          onSubmit={(e) => void handleRegisterCustomer(e)}
          className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-sm"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">Yangi Mijoz Qo&apos;shish</h2>
            <p className="text-xs text-slate-500">
              Har bir mijozga avtomatik tarzda takrorlanmas doimiy kod (CUST-XXXXXX) beriladi.
            </p>
          </div>

          {registeredCodeNotice && (
            <div className="bg-blue-50 border-2 border-blue-300 text-blue-900 p-3 rounded-2xl text-xs font-bold">
              {registeredCodeNotice}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ism Familiya (F.I.O):</label>
              <input
                type="text"
                placeholder="Masalan: Sardor Rustamov"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Telefon Raqami:</label>
              <input
                type="text"
                placeholder="+998 90 123 45 67"
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Kompaniya / Pasport yoki PINFL:
              </label>
              <input
                type="text"
                placeholder="Pasport seriya yoki do'kon nomi..."
                value={newCustCompany}
                onChange={(e) => setNewCustCompany(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !newCustName.trim()}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg transition"
            >
              {busy ? "Ro'yxatga olinmoqda..." : "Mijozni Saqlash (ID Yaratish)"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 6: SELLER TILL STATUS & HISTORY */}
      {activeTab === "till" && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900">Mening Kassam va Zavod Majburiyatim</h2>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-3 bg-amber-50 rounded-2xl border border-amber-200">
                <span className="font-bold text-amber-900">Yig&apos;ilgan Lom Oltin:</span>
                <span className="font-mono font-black text-amber-950 text-base">
                  {myTillScrap.toFixed(4)} g
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-2xl border border-emerald-200">
                <span className="font-bold text-emerald-900">Yig&apos;ilgan Naqd Pul:</span>
                <span className="font-mono font-black text-emerald-950 text-base">
                  {myTillCash.toLocaleString()} UZS
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-rose-50 rounded-2xl border border-rose-200">
                <span className="font-bold text-rose-900">Zavod Oldidagi Majburiyat:</span>
                <span className="font-mono font-black text-rose-950 text-base">
                  {myFactoryObligation.toFixed(4)} g
                </span>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-2xl border">
              ℹ️ Qoida 5: Siz mijozdan pul yoki lom olganingizda, u sizning shaxsiy kassangizga tushadi. Direktor sizdan ushbu lom yoki pulni qabul qilmaguncha zavod oldidagi majburiyatingiz kamaymaydi.
            </div>
          </div>

          {/* Recent Sales History */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">Oxirgi Savdolarim Tarixi</h3>

            <div className="space-y-2">
              {mySales.map((s) => (
                <div key={s.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-slate-900">{s.customer?.contact_name || "Mijoz"}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{s.sale_no} • {s.sale_date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-slate-800">
                      {Number(s.client_gold_due_grams).toFixed(4)} g
                    </div>
                    <div className="text-[10px] text-indigo-600 font-semibold">+{s.client_markup_pct}% ustama</div>
                  </div>
                </div>
              ))}
              {mySales.length === 0 && (
                <div className="text-center py-4 text-xs text-slate-400">
                  Hozircha savdolar tarixi yo&apos;q.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      <SalesReceiptModal data={receiptData} onClose={() => setReceiptData(null)} />
    </div>
  );
}
