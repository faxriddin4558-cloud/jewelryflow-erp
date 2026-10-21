"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  supabase,
  GoldEngine,
  generateIdempotencyKey,
  type SalesMarkupPresetRow,
  type SellerConsignmentRow,
  type GoldSettlementRow,
  type ClientGoldAccountRow,
  type SellerGoldAccountRow,
  type DailyGoldRateRow,
  type EmployeeRow,
  type ProductRow,
  type ConsignmentPieceRow,
} from "@/lib/erp-engine";
import { SalesReceiptModal, type ReceiptData } from "./SalesReceiptModal";
import { ScannerDiagnostics } from "./ScannerDiagnostics";
import { BarTenderModelManager } from "./BarTenderModelManager";
import { ScannerConsignmentSection } from "./ScannerConsignmentSection";
import { SellerInventoryDashboard } from "./SellerInventoryDashboard";
import { type JewelryModelItem } from "@/lib/barcode-scanner-engine";

export function DirectorSalesWorkspace() {
  const [activeTab, setActiveTab] = useState<
    "sellers" | "consign" | "scanner_consign" | "seller_stock" | "models" | "diagnostics" | "presets" | "clients" | "history"
  >("sellers");

  // State
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Data
  const [dailyRate, setDailyRate] = useState<DailyGoldRateRow | null>(null);
  const [presets, setPresets] = useState<SalesMarkupPresetRow[]>([]);
  const [consignments, setConsignments] = useState<SellerConsignmentRow[]>([]);
  const [sellerAccounts, setSellerAccounts] = useState<SellerGoldAccountRow[]>([]);
  const [clientAccounts, setClientAccounts] = useState<ClientGoldAccountRow[]>([]);
  const [settlements, setSettlements] = useState<GoldSettlementRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; contact_name: string; customer_code?: string; phone?: string }[]>([]);
  const [models, setModels] = useState<JewelryModelItem[]>([]);
  const [pieces, setPieces] = useState<ConsignmentPieceRow[]>([]);

  // Daily rate form
  const [newRateAmount, setNewRateAmount] = useState<string>("900000");
  const [newRateDate, setNewRateDate] = useState<string>(() => (new Date().toISOString().split("T")[0] as string));
  const [newRateNotes, setNewRateNotes] = useState<string>("");
  const [showRateModal, setShowRateModal] = useState(false);

  // Dynamic Markup Preset form
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<SalesMarkupPresetRow | null>(null);
  const [presetType, setPresetType] = useState<"factory_markup" | "client_markup">("factory_markup");
  const [presetName, setPresetName] = useState("");
  const [presetPercentage, setPresetPercentage] = useState("8.0");
  const [presetIsDefault, setPresetIsDefault] = useState(false);
  const [presetOrder, setPresetOrder] = useState("1");

  // Consignment issuance form
  const [consignSellerId, setConsignSellerId] = useState("");
  const [consignProductId, setConsignProductId] = useState("");
  const [consignQty, setConsignQty] = useState("1");
  const [consignBaseWeight, setConsignBaseWeight] = useState("14.5000");
  const [consignPurity, setConsignPurity] = useState("585");
  const [consignFactoryMarkup, setConsignFactoryMarkup] = useState("8.00");
  const [consignNotes, setConsignNotes] = useState("");

  // Seller Surrender (Handover to Factory) modal
  const [surrenderModalOpen, setSurrenderModalOpen] = useState(false);
  const [surrenderSeller, setSurrenderSeller] = useState<SellerGoldAccountRow | null>(null);
  const [surrenderScrapWeight, setSurrenderScrapWeight] = useState("0");
  const [surrenderCashAmount, setSurrenderCashAmount] = useState("0");
  const [surrenderNotes, setSurrenderNotes] = useState("");

  // Notification helper
  const notifySuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };
  const notifyError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 6000);
  };

  // Load all director data
  const loadData = useCallback(async () => {
    try {
      const [
        ratesRes,
        presetsRes,
        consignRes,
        sellerAccRes,
        clientAccRes,
        settleRes,
        ,
        empRes,
        prodRes,
        custRes,
        modelsRes,
        piecesRes,
      ] = await Promise.all([
        supabase.from("daily_gold_rates").select("*").order("rate_date", { ascending: false }).limit(20),
        supabase.from("sales_markup_presets").select("*").order("display_order", { ascending: true }),
        supabase.from("seller_consignments").select("*, seller:seller_id(id, name, full_name, phone)").order("created_at", { ascending: false }),
        supabase.from("seller_gold_accounts").select("*, seller:seller_id(id, name, full_name, phone)"),
        supabase.from("client_gold_accounts").select("*, customer:customer_id(id, contact_name, customer_code, phone)"),
        supabase.from("gold_settlements").select("*, customer:customer_id(id, contact_name, customer_code, phone), seller:seller_id(id, name, full_name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("jewelry_sales").select("*, customer:customer_id(id, contact_name, customer_code, phone), seller:seller_id(id, name, full_name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("employees").select("*"),
        supabase.from("products").select("*").gt("stock", 0),
        supabase.from("customers").select("id, contact_name, customer_code, phone"),
        supabase.from("jewelry_models").select("*").order("model_code", { ascending: true }),
        supabase.from("consignment_pieces").select("*").order("created_at", { ascending: false }),
      ]);

      if (ratesRes.data && ratesRes.data.length > 0) {
        setDailyRate(ratesRes.data[0] as DailyGoldRateRow);
        setNewRateAmount(String(ratesRes.data[0].rate_per_gram));
      }
      if (presetsRes.data) setPresets(presetsRes.data as SalesMarkupPresetRow[]);
      if (consignRes.data) setConsignments(consignRes.data as unknown as SellerConsignmentRow[]);
      if (sellerAccRes.data) setSellerAccounts(sellerAccRes.data as unknown as SellerGoldAccountRow[]);
      if (clientAccRes.data) setClientAccounts(clientAccRes.data as unknown as ClientGoldAccountRow[]);
      if (settleRes.data) setSettlements(settleRes.data as unknown as GoldSettlementRow[]);
      if (custRes.data) setCustomers(custRes.data as unknown as { id: string; contact_name: string; customer_code?: string; phone?: string }[]);
      if (modelsRes.data) setModels(modelsRes.data as JewelryModelItem[]);
      if (piecesRes.data) setPieces(piecesRes.data as ConsignmentPieceRow[]);
      if (empRes.data) {
        setEmployees(empRes.data as EmployeeRow[]);
      }
      if (prodRes.data) {
        setProducts(prodRes.data as ProductRow[]);
        if (!consignProductId && prodRes.data.length > 0) {
          setConsignProductId(String(prodRes.data[0].id));
          setConsignBaseWeight(String(prodRes.data[0].weight || 14.5));
          setConsignPurity(String(prodRes.data[0].proba || 585));
        }
      }
    } catch (err: unknown) {
      notifyError(`Ma'lumotlarni yuklashda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [consignProductId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Active sellers: strictly exclude director, admin, and management roles
  const activeSellers = useMemo(() => {
    return employees.filter(e => {
      if (e.is_active === false) return false;
      if (e.employment_status && e.employment_status !== "active") return false;
      if (e.status && e.status !== "active") return false;
      const r = (e.role || "").toLowerCase();
      const rt = (e.role_type || "").toLowerCase();
      const dept = (e.department || "").toLowerCase();
      if (
        r === "admin" ||
        r === "director" ||
        rt === "director" ||
        rt === "admin" ||
        dept.includes("rahbariyat") ||
        r === "quality_inspector" ||
        r === "production_manager" ||
        r === "inventory_manager"
      ) {
        return false;
      }
      return (
        r === "sales" ||
        r === "seller" ||
        r === "sotuvchi" ||
        rt === "seller" ||
        rt === "sales" ||
        dept.includes("savdo")
      );
    }).map(e => ({
      ...e,
      id: String(e.id),
      name: e.name || e.full_name || "Sotuvchi",
      full_name: e.full_name,
      phone: (e as unknown as { phone?: string }).phone,
      department: e.department,
    }));
  }, [employees]);

  // Factory & Client markups separated
  const factoryPresets = useMemo(() => presets.filter(p => p.type === "factory_markup"), [presets]);
  const clientPresets = useMemo(() => presets.filter(p => p.type === "client_markup"), [presets]);

  // Set default factory markup from presets if available
  useEffect(() => {
    if (factoryPresets.length > 0 && !consignFactoryMarkup) {
      const def = factoryPresets.find(p => p.is_default && p.is_active) || factoryPresets.find(p => p.is_active);
      if (def) setConsignFactoryMarkup(String(def.percentage));
    }
  }, [factoryPresets, consignFactoryMarkup]);

  // Auto-fill product weight when product changes
  const handleProductSelect = (pId: string) => {
    setConsignProductId(pId);
    const prod = products.find(p => String(p.id) === pId);
    if (prod) {
      setConsignBaseWeight(String(prod.weight || 0));
      setConsignPurity(String(prod.proba || 585));
    }
  };

  // 1. Daily Rate Setter Action
  const handleSaveDailyRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateNum = parseFloat(newRateAmount);
    if (!rateNum || rateNum <= 0) {
      notifyError("Iltimos, gramm uchun to'g'ri kurs qiymatini kiriting!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("rate");
      const { error } = await supabase.rpc("rpc_set_daily_gold_rate", {
        p_rate_per_gram: rateNum,
        p_currency: "UZS",
        p_rate_date: newRateDate || new Date().toISOString().split("T")[0],
        p_proba: 585,
        p_notes: newRateNotes || "Direktor tomonidan kiritilgan kunlik lom narxi",
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      notifySuccess(`Kunlik lom kursi muvaffaqiyatli saqlandi: ${rateNum.toLocaleString()} UZS/g`);
      setShowRateModal(false);
      setNewRateNotes("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Lom kursini saqlashda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 2. Dynamic Markup Preset Actions
  const handleOpenNewPreset = (type: "factory_markup" | "client_markup") => {
    setEditingPreset(null);
    setPresetType(type);
    setPresetName(type === "factory_markup" ? "Zavod " : "Mijoz ");
    setPresetPercentage(type === "factory_markup" ? "8.0" : "12.0");
    setPresetIsDefault(false);
    setPresetOrder(String(presets.filter(p => p.type === type).length + 1));
    setPresetModalOpen(true);
  };

  const handleEditPreset = (p: SalesMarkupPresetRow) => {
    setEditingPreset(p);
    setPresetType(p.type);
    setPresetName(p.name);
    setPresetPercentage(String(p.percentage));
    setPresetIsDefault(p.is_default);
    setPresetOrder(String(p.display_order));
    setPresetModalOpen(true);
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    const pct = parseFloat(presetPercentage);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      notifyError("Ustama foizi 0 va 100 oralig'ida bo'lishi kerak!");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_manage_sales_markup_preset", {
        p_preset_id: editingPreset?.id || null,
        p_type: presetType,
        p_name: presetName.trim() || `${presetType === "factory_markup" ? "Zavod" : "Mijoz"} ${pct}%`,
        p_percentage: pct,
        p_is_active: true,
        p_is_default: presetIsDefault,
        p_display_order: parseInt(presetOrder, 10) || 0,
      });

      if (error) throw error;
      notifySuccess(`Ustama foizi muvaffaqiyatli saqlandi: ${pct}%`);
      setPresetModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      notifyError(`Ustama foizini saqlashda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePresetActive = async (p: SalesMarkupPresetRow) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_manage_sales_markup_preset", {
        p_preset_id: p.id,
        p_type: p.type,
        p_name: p.name,
        p_percentage: p.percentage,
        p_is_active: !p.is_active,
        p_is_default: p.is_default,
        p_display_order: p.display_order,
      });

      if (error) throw error;
      notifySuccess(`Ustama "${p.name}" ${!p.is_active ? "faollashtirildi" : "o'chirildi"}`);
      await loadData();
    } catch (err: unknown) {
      notifyError(`Ustama holatini o'zgartirishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 3. Issue Consignment Action
  const handleIssueConsignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consignSellerId || !consignProductId) {
      notifyError("Iltimos, sotuvchi va mahsulotni tanlang!");
      return;
    }
    const selectedSeller = activeSellers.find(e => String(e.id) === consignSellerId);
    if (!selectedSeller) {
      notifyError("Tanlangan xodim sotuvchi emas yoki ruxsati yo'q! Direktor yoki boshqaruv xodimiga mahsulot topshirib bo'lmaydi.");
      return;
    }
    const qty = parseInt(consignQty, 10);
    const fPct = parseFloat(consignFactoryMarkup);
    if (!qty || qty <= 0) {
      notifyError("Dona soni 1 yoki undan ko'p bo'lishi shart!");
      return;
    }

    const selectedProd = products.find(p => String(p.id) === consignProductId);

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("consign");
      const { data, error } = await supabase.rpc("rpc_issue_seller_consignment", {
        p_seller_id: consignSellerId,
        p_product_id: consignProductId,
        p_quantity: qty,
        p_factory_markup_pct: fPct,
        p_notes: consignNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      const baseWeight = (Number(selectedProd?.weight || consignBaseWeight) * qty);
      const calc = GoldEngine.calculateJewelryConsignmentAndSale(baseWeight, fPct, fPct);

      // Show receipt modal
      setReceiptData({
        title: "Zavod Konsignatsiya Cheki (Topshirish)",
        receiptNo: data.consignment_no || "CONS-NEW",
        date: new Date().toLocaleDateString("uz-UZ"),
        sellerName: selectedSeller?.name || selectedSeller?.full_name || "Sotuvchi",
        itemName: `${selectedProd?.name || "Zargarlik buyumi"} (${qty} dona)`,
        baseWeightGrams: baseWeight,
        purity: Number(selectedProd?.proba || consignPurity),
        factoryMarkupPct: fPct,
        factoryGoldDueGrams: calc.factoryGoldDueGrams,
        notes: consignNotes || "Zavoddan sotuvchiga konsignatsiya asosida topshirildi",
      });

      notifySuccess(`Konsignatsiya №${data.consignment_no} sotuvchiga muvaffaqiyatli topshirildi!`);
      setConsignNotes("");
      setConsignSellerId("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Konsignatsiya topshirishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 4. Seller Surrender / Handover Action (Accept from Seller Till into Factory)
  const handleOpenSurrender = (acc: SellerGoldAccountRow) => {
    setSurrenderSeller(acc);
    setSurrenderScrapWeight(String(acc.seller_till_scrap_grams || 0));
    setSurrenderCashAmount(String(acc.seller_till_cash_amount || 0));
    setSurrenderNotes("");
    setSurrenderModalOpen(true);
  };

  const handleConfirmSurrender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surrenderSeller) return;

    const scrapW = parseFloat(surrenderScrapWeight) || 0;
    const cash = parseFloat(surrenderCashAmount) || 0;

    if (scrapW <= 0 && cash <= 0) {
      notifyError("Iltimos, topshirilayotgan lom vazni yoki naqd pul summasini kiriting!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("surr");
      const { data, error } = await supabase.rpc("rpc_record_seller_to_factory_settlement", {
        p_seller_id: surrenderSeller.seller_id,
        p_scrap_weight: scrapW,
        p_cash_amount: cash,
        p_rate_per_gram: dailyRate?.rate_per_gram || null,
        p_settlement_date: new Date().toISOString().split("T")[0],
        p_notes: surrenderNotes.trim() || "Sotuvchi kassasidan zavodga qabul qilingan tushum",
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      const rate = dailyRate?.rate_per_gram || 900000;
      const calc = GoldEngine.calculateGoldSettlement(
        surrenderSeller.current_factory_obligation_grams || surrenderSeller.remaining_factory_gold_due_grams || 0,
        scrapW,
        cash,
        rate
      );

      setReceiptData({
        title: "Zavodga Tushum Qabul Qilish Kvitansiyasi",
        receiptNo: data.settlement_no || "SURR-NEW",
        date: new Date().toLocaleDateString("uz-UZ"),
        sellerName: surrenderSeller.seller?.name || surrenderSeller.seller?.full_name || "Sotuvchi",
        scrapWeightGrams: scrapW,
        scrapPurity: 585,
        cashAmount: cash,
        goldRateApplied: rate,
        cashEquivalentGrams: calc.cashEquivalentGrams,
        totalSettledGrams: calc.totalSettledGrams,
        previousDebtGrams: calc.previousDebtGrams,
        remainingDebtGrams: calc.remainingDebtGrams,
        advanceGoldGrams: calc.excessGoldGrams,
        notes: surrenderNotes || "Sotuvchi kassasidan lom va naqd pul zavodga qabul qilindi",
      });

      notifySuccess(`№${data.settlement_no} tushum zavodga qabul qilindi va sotuvchi majburiyati kamaytirildi!`);
      setSurrenderModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      notifyError(`Tushumni qabul qilishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 5. High-Throughput Scanner 564 Consignment Action
  const handleConfirmBarcodeConsignment = async (payload: {
    sellerId: string;
    factoryMarkupPct: number;
    pieces: Array<{
      model_id?: string;
      model_code: string;
      model_name: string;
      category?: string;
      purity: number;
      weight_grams: number;
      raw_barcode: string;
    }>;
    notes?: string;
  }) => {
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("consign-barcode");
      const { data, error } = await supabase.rpc("rpc_issue_barcode_consignment", {
        p_seller_id: payload.sellerId,
        p_factory_markup_pct: payload.factoryMarkupPct,
        p_pieces: payload.pieces,
        p_notes: payload.notes || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      const selectedSeller = activeSellers.find((s) => String(s.id) === payload.sellerId);
      setReceiptData({
        title: "Zavod Skaner Konsignatsiya Cheki",
        receiptNo: data.consignment_no || "CONS-BC",
        date: new Date().toLocaleDateString("uz-UZ"),
        sellerName: selectedSeller?.name || selectedSeller?.full_name || "Sotuvchi",
        itemName: `Skanerlangan partiya (${payload.pieces.length} dona)`,
        baseWeightGrams: Number(data.base_weight_grams),
        purity: 585,
        factoryMarkupPct: payload.factoryMarkupPct,
        factoryGoldDueGrams: Number(data.factory_gold_due_grams),
        notes: payload.notes || "Scanner 564 orqali topshirilgan partiya",
      });

      notifySuccess(
        `№${data.consignment_no} konsignatsiya muvaffaqiyatli topshirildi! (${payload.pieces.length} dona, ${Number(data.base_weight_grams).toFixed(4)}g)`
      );
      await loadData();
      setActiveTab("seller_stock");
    } catch (err: unknown) {
      notifyError(`Konsignatsiyani topshirishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 6. BarTender Model Creation Action
  const handleAddNewModel = async (modelData: {
    model_code: string;
    name: string;
    category: string;
    decorations?: string;
    reference_weight_grams?: number;
    gold_purity?: number;
  }) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("jewelry_models").insert([
        {
          ...modelData,
          is_active: true,
        },
      ]);
      if (error) throw error;
      notifySuccess(`Yangi model muvaffaqiyatli saqlandi: ${modelData.name} (${modelData.model_code})`);
      await loadData();
    } catch (err: unknown) {
      notifyError(`Model qo'shishda xatolik: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // Calculations for Consignment Form Live Preview
  const selectedProdForCalc = products.find(p => String(p.id) === consignProductId);
  const curBaseWeight = (Number(selectedProdForCalc?.weight || consignBaseWeight || 0) * (parseInt(consignQty, 10) || 1));
  const curFactoryMarkupNum = parseFloat(consignFactoryMarkup) || 0;
  const liveConsignCalc = GoldEngine.calculateJewelryConsignmentAndSale(
    curBaseWeight,
    curFactoryMarkupNum,
    curFactoryMarkupNum
  );

  // Global Metrics Totals
  const totalFactoryObligation = sellerAccounts.reduce((acc, s) => acc + Number(s.current_factory_obligation_grams || s.remaining_factory_gold_due_grams || 0), 0);
  const totalSellerTillScrap = sellerAccounts.reduce((acc, s) => acc + Number(s.seller_till_scrap_grams || 0), 0);
  const totalSellerTillCash = sellerAccounts.reduce((acc, s) => acc + Number(s.seller_till_cash_amount || 0), 0);
  const totalClientDebtGrams = clientAccounts.reduce((acc, c) => acc + Number(c.current_debt_grams || c.current_gold_debt_grams || 0), 0);

  return (
    <div className="space-y-6">
      {/* Toast notifications */}
      {successMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-300 text-emerald-900 px-4 py-3 rounded-2xl flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 font-medium text-sm">
            <span>✅</span>
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-700 font-bold">✕</button>
        </div>
      )}
      {errorMessage && (
        <div className="bg-red-50 border-2 border-red-300 text-red-900 px-4 py-3 rounded-2xl flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 font-medium text-sm">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-red-700 font-bold">✕</button>
        </div>
      )}

      {/* Top Banner & Quick Metrics */}
      <div className="bg-slate-950 text-white rounded-3xl p-6 shadow-2xl border-2 border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="text-xs uppercase font-extrabold tracking-widest text-amber-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
              Zavod Boshqaruv Markazi
            </div>
            <h1 className="text-2xl md:text-3xl font-black mt-1 text-white">Direktor Savdo & Konsignatsiya Paneli</h1>
            <p className="text-xs md:text-sm text-slate-200 mt-1 font-medium">
              Zavod → Sotuvchi → Mijoz zanjiri, dinamik foizlar va qat&apos;iy 585 lom oltin hisobi
            </p>
          </div>

          {/* Daily Gold Rate Badge */}
          <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-3 px-5 flex items-center gap-4 shadow-lg">
            <div>
              <div className="text-xs text-amber-300 font-extrabold uppercase">Bugungi Lom Kursi (585)</div>
              <div className="text-xl md:text-2xl font-black font-mono text-white">
                {dailyRate ? `${Number(dailyRate.rate_per_gram).toLocaleString()} UZS` : "900,000 UZS"}
                <span className="text-xs font-semibold text-slate-200"> / gramm</span>
              </div>
              <div className="text-[11px] text-slate-300 font-medium">
                Sana: {dailyRate?.rate_date || new Date().toISOString().split("T")[0]}
              </div>
            </div>
            <button
              onClick={() => setShowRateModal(true)}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition shadow-lg shadow-amber-500/20 active:scale-95"
            >
              ⚙️ Yangilash
            </button>
          </div>
        </div>

        {/* Real-time Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-5">
          <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
            <div className="text-slate-200 text-xs font-bold">Sotuvchilardagi Zavod Qarzi</div>
            <div className="text-2xl font-black font-mono text-amber-300 mt-1">
              {totalFactoryObligation.toFixed(4)} <span className="text-xs font-bold text-slate-100">g lom</span>
            </div>
            <div className="text-[11px] text-slate-300 mt-1 font-medium">Sotuvchilar qaytarishi shart bo&apos;lgan oltin</div>
          </div>

          <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
            <div className="text-slate-200 text-xs font-bold">Sotuvchilar Kassasidagi Lom</div>
            <div className="text-2xl font-black font-mono text-amber-400 mt-1">
              {totalSellerTillScrap.toFixed(4)} <span className="text-xs font-bold text-slate-100">g lom</span>
            </div>
            <div className="text-[11px] text-slate-300 mt-1 font-medium">Mijozdan olingan, zavodga berilmagan</div>
          </div>

          <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
            <div className="text-slate-200 text-xs font-bold">Sotuvchilar Kassasidagi Naqd Pul</div>
            <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
              {totalSellerTillCash.toLocaleString()} <span className="text-xs font-bold text-slate-100">UZS</span>
            </div>
            <div className="text-[11px] text-slate-300 mt-1 font-medium">Sotuvchining shaxsiy kassasida yig&apos;ilgan</div>
          </div>

          <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
            <div className="text-slate-200 text-xs font-bold">Mijozlarning Jami Qarzi</div>
            <div className="text-2xl font-black font-mono text-rose-400 mt-1">
              {totalClientDebtGrams.toFixed(4)} <span className="text-xs font-bold text-slate-100">g lom</span>
            </div>
            <div className="text-[11px] text-slate-300 mt-1 font-medium">Barcha sotuvchilar bo&apos;yicha mijozlar qarzi</div>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2 text-sm font-bold text-slate-600">
        <button
          onClick={() => setActiveTab("sellers")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "sellers"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>👥</span> Sotuvchilar Balansi & Kassasi
        </button>
        <button
          onClick={() => setActiveTab("scanner_consign")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "scanner_consign"
              ? "border-amber-500 text-amber-500 font-black"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>⚡</span> Skaner 564 Konsignatsiya
        </button>
        <button
          onClick={() => setActiveTab("seller_stock")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "seller_stock"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>📊</span> Sotuvchilar Ombori (Donalar)
        </button>
        <button
          onClick={() => setActiveTab("models")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "models"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>🏷️</span> BarTender Modellar
        </button>
        <button
          onClick={() => setActiveTab("consign")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "consign"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>📦</span> Mahsulot Topshirish (Klassik)
        </button>
        <button
          onClick={() => setActiveTab("presets")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "presets"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>⚙️</span> Dinamik Foizlar
        </button>
        <button
          onClick={() => setActiveTab("clients")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "clients"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>📒</span> Mijozlar Qarzi
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "history"
              ? "border-blue-600 text-blue-600"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>📑</span> Tarix
        </button>
        <button
          onClick={() => setActiveTab("diagnostics")}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
            activeTab === "diagnostics"
              ? "border-amber-600 text-amber-600 font-bold"
              : "border-transparent hover:text-slate-900"
          }`}
        >
          <span>🔍</span> Skaner Diagnostikasi
        </button>
      </div>

      {/* TAB 1: SELLERS OVERVIEW & SURRENDER */}
      {activeTab === "sellers" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Sotuvchilar Balansi va Kassalari</h2>
              <p className="text-xs text-slate-500">
                Qoida 5: Mijoz to&apos;lagan pul va lom sotuvchi kassasida saqlanadi. Zavodga topshirilmaguncha zavod majburiyati kamaymaydi.
              </p>
            </div>
            <button
              onClick={() => void loadData()}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
            >
              🔄 Yangilash
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sellerAccounts.length === 0 ? (
              <div className="col-span-full bg-white p-8 rounded-2xl border text-center text-slate-500">
                Hozircha sotuvchilar hisobida tranzaksiya mavjud emas. Mahsulot topshirilgach paydo bo&apos;ladi.
              </div>
            ) : (
              sellerAccounts.map((acc) => {
                const seller = acc.seller || employees.find(e => String(e.id) === String(acc.seller_id));
                const sellerName = seller?.name || seller?.full_name || "Sotuvchi";
                const sellerPhone = (seller && "phone" in seller ? (seller as { phone?: string }).phone : undefined) || acc.seller?.phone;
                const factoryObligation = Number(acc.current_factory_obligation_grams || acc.remaining_factory_gold_due_grams || 0);
                const tillScrap = Number(acc.seller_till_scrap_grams || 0);
                const tillCash = Number(acc.seller_till_cash_amount || 0);

                return (
                  <div key={acc.seller_id} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4 hover:shadow-md transition">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-base text-slate-900">{sellerName}</div>
                        {sellerPhone && <div className="text-xs text-slate-500">{sellerPhone}</div>}
                      </div>
                      <span className="bg-blue-50 text-blue-700 text-[11px] font-bold px-2.5 py-1 rounded-full border border-blue-200">
                        Sotuvchi
                      </span>
                    </div>

                    <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 space-y-1">
                      <div className="text-xs text-amber-900 font-medium">Zavod Oldidagi Majburiyat:</div>
                      <div className="text-xl font-black font-mono text-amber-950">
                        {factoryObligation.toFixed(4)} <span className="text-xs font-normal">g lom</span>
                      </div>
                      <div className="text-[10px] text-amber-700">Zavodga topshirilishi kerak bo&apos;lgan 585 lom majburiyati</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-100">
                      <div>
                        <span className="text-slate-500 block">Kassasidagi Lom:</span>
                        <span className="font-mono font-bold text-slate-800 text-sm">{tillScrap.toFixed(4)} g</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Kassasidagi Naqd:</span>
                        <span className="font-mono font-bold text-emerald-700 text-sm">{tillCash.toLocaleString()} UZS</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenSurrender(acc)}
                      className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                    >
                      <span>📥</span> Zavodga Tushumni Qabul Qilish
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ISSUE CONSIGNMENT */}
      {activeTab === "consign" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={(e) => void handleIssueConsignment(e)}
            className="lg:col-span-1 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-900">Mahsulot Topshirish</h2>
              <p className="text-xs text-slate-500">
                Zavod mahsulotini sotuvchiga belgilangan zavod ustamasi bilan berish.
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Sotuvchi (Faqat faol sotuvchilar):
                </label>
                <select
                  id="consignSellerSelect"
                  value={consignSellerId}
                  onChange={(e) => setConsignSellerId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:ring-2 focus:ring-blue-500 outline-none text-xs"
                  required
                >
                  <option value="">-- Sotuvchini tanlang (Direktor tanlanmaydi) --</option>
                  {activeSellers.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name || emp.full_name} ({emp.department || "Savdo"})
                    </option>
                  ))}
                </select>
                {activeSellers.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1 font-medium">
                    Tizimda faol sotuvchi topilmadi.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tayyor Mahsulot (Vitrina):</label>
                <select
                  value={consignProductId}
                  onChange={(e) => handleProductSelect(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:ring-2 focus:ring-blue-500 outline-none text-xs"
                  required
                >
                  <option value="">Mahsulotni tanlang...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.weight}g ({p.proba || 585}°) • Qoldiq: {p.stock ?? p.quantity} dona
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Dona soni:</label>
                  <input
                    type="number"
                    min="1"
                    value={consignQty}
                    onChange={(e) => setConsignQty(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Asl Vazn (1 dona):</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={consignBaseWeight}
                    onChange={(e) => setConsignBaseWeight(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs"
                    required
                  />
                </div>
              </div>

              {/* Dynamic Factory Markup selection */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-700">Zavod Ustamasi (%):</label>
                  <span className="text-[10px] text-blue-600 font-semibold cursor-pointer" onClick={() => setActiveTab("presets")}>
                    + Foizlarni sozlash
                  </span>
                </div>
                <select
                  value={consignFactoryMarkup}
                  onChange={(e) => setConsignFactoryMarkup(e.target.value)}
                  className="w-full p-2.5 bg-blue-50/50 border border-blue-200 rounded-xl font-bold text-blue-900 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {factoryPresets.filter(p => p.is_active).map((preset) => (
                    <option key={preset.id} value={preset.percentage}>
                      {preset.name} (+{preset.percentage}%) {preset.is_default ? "★" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Live Preview Card */}
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 rounded-2xl space-y-2">
                <div className="text-[11px] font-bold text-amber-900 uppercase">
                  Jonli Hisob-Kitob (Non-Compounding):
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Jami Asl Vazn:</span>
                  <span className="font-mono font-bold text-slate-800">{curBaseWeight.toFixed(4)} g</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Zavod Ustamasi:</span>
                  <span className="font-mono font-bold text-amber-800">+{curFactoryMarkupNum}%</span>
                </div>
                <div className="border-t border-amber-200/80 pt-1 flex justify-between text-sm">
                  <span className="font-bold text-amber-950">Zavod Majburiyati:</span>
                  <span className="font-mono font-black text-amber-950">
                    {liveConsignCalc.factoryGoldDueGrams.toFixed(4)} g lom
                  </span>
                </div>
                <div className="text-[10px] text-amber-700 italic">
                  Formula: {curBaseWeight.toFixed(4)} × (1 + {curFactoryMarkupNum}/100) = {liveConsignCalc.factoryGoldDueGrams.toFixed(4)}g
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Izoh (ixtiyoriy):</label>
                <input
                  type="text"
                  placeholder="Partiya yoki topshirish shartlari..."
                  value={consignNotes}
                  onChange={(e) => setConsignNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold text-sm rounded-xl shadow-lg transition"
              >
                {busy ? "Topshirilmoqda..." : "Topshirish va Chek Chiqarish"}
              </button>
            </div>
          </form>

          {/* Consignments Table */}
          <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Topshirilgan Konsignatsiyalar Ro&apos;yxati</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">№ Chek</th>
                    <th className="py-2.5 px-3 font-semibold">Sotuvchi</th>
                    <th className="py-2.5 px-3 font-semibold">Mahsulot</th>
                    <th className="py-2.5 px-3 font-semibold">Vazn</th>
                    <th className="py-2.5 px-3 font-semibold">Ustama</th>
                    <th className="py-2.5 px-3 font-semibold">Zavod Oltini</th>
                    <th className="py-2.5 px-3 font-semibold">Holat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {consignments.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{c.consignment_no || c.id.slice(0, 8)}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{c.seller?.name || c.seller?.full_name || "Sotuvchi"}</td>
                      <td className="py-2.5 px-3 text-slate-700">{c.product_name || c.item_name}</td>
                      <td className="py-2.5 px-3 font-mono">{Number(c.base_weight_grams).toFixed(4)}g</td>
                      <td className="py-2.5 px-3 font-bold text-amber-700">+{c.factory_markup_pct}%</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {Number(c.factory_gold_due_grams).toFixed(4)}g
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === "held_by_seller"
                            ? "bg-amber-100 text-amber-800"
                            : c.status === "fully_sold"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-700"
                        }`}>
                          {c.status === "held_by_seller" ? "Sotuvchida" : c.status === "fully_sold" ? "Sotildi" : c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {consignments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400">
                        Hozircha konsignatsiyalar ro&apos;yxati bo&apos;sh.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DYNAMIC MARKUP PRESETS MANAGEMENT */}
      {activeTab === "presets" && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-sm text-blue-950">
              <span>ℹ️</span> Dinamik Foizlar Qoidasi (Majburiy Talab):
            </div>
            <p>
              1. Siz istalgan yangi foizni qo&apos;shishingiz mumkin: 6%, 8%, 10%, 12%, 15%, 18%, 25% yoki boshqa ixtiyoriy qiymatlar.
            </p>
            <p>
              2. <strong>Tarixiy immutability kafolati:</strong> Yangi foiz qo&apos;shish yoki eskisini o&apos;zgartirish avval tuzilgan savdolar va konsignatsiyalarning hisob-kitoblariga TA&apos;SIR QILMAYDI.
            </p>
            <p>
              3. Sotuvchi faqat siz tasdiqlagan va <strong>faol</strong> bo&apos;lgan foizlarni ko&apos;radi va tanlay oladi.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Factory Markups Section */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-black text-slate-900 text-base">Zavod Ustamalari (Factory Markups)</h3>
                  <div className="text-xs text-slate-500">Zavoddan sotuvchiga topshirishda qo&apos;llaniladi</div>
                </div>
                <button
                  id="addFactoryPresetBtn"
                  onClick={() => handleOpenNewPreset("factory_markup")}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition"
                >
                  + Yangi Zavod Ustamasi
                </button>
              </div>

              <div className="space-y-2">
                {factoryPresets.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-3.5 rounded-2xl border transition ${
                      p.is_active ? "bg-slate-50 border-slate-200" : "bg-slate-100/60 border-slate-200/50 opacity-60"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                        <span className="bg-amber-100 text-amber-900 text-xs font-mono font-black px-2 py-0.5 rounded-lg">
                          +{p.percentage}%
                        </span>
                        {p.is_default && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            Standart
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Tartib raqami: {p.display_order} • Holat: {p.is_active ? "Faol (Sotuvchiga ko'rinadi)" : "Nofaol"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTogglePresetActive(p)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition ${
                          p.is_active
                            ? "border-slate-300 text-slate-600 hover:bg-slate-200"
                            : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                        }`}
                      >
                        {p.is_active ? "O'chirish" : "Faollashtirish"}
                      </button>
                      <button
                        onClick={() => handleEditPreset(p)}
                        className="text-xs px-2.5 py-1 rounded-lg font-bold bg-slate-200 hover:bg-slate-300 text-slate-700"
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Client Markups Section */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-black text-slate-900 text-base">Mijozga Sotish Ustamalari (Client Markups)</h3>
                  <div className="text-xs text-slate-500">Sotuvchi mijozga nasiya yozishda faqat bularni tanlay oladi</div>
                </div>
                <button
                  id="addClientPresetBtn"
                  onClick={() => handleOpenNewPreset("client_markup")}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition"
                >
                  + Yangi Mijoz Ustamasi
                </button>
              </div>

              <div className="space-y-2">
                {clientPresets.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-3.5 rounded-2xl border transition ${
                      p.is_active ? "bg-slate-50 border-slate-200" : "bg-slate-100/60 border-slate-200/50 opacity-60"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                        <span className="bg-indigo-100 text-indigo-900 text-xs font-mono font-black px-2 py-0.5 rounded-lg">
                          +{p.percentage}%
                        </span>
                        {p.is_default && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            Standart
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Tartib raqami: {p.display_order} • Holat: {p.is_active ? "Faol (Sotuvchiga ko'rinadi)" : "Nofaol"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        data-preset-toggle={p.name}
                        onClick={() => handleTogglePresetActive(p)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition ${
                          p.is_active
                            ? "border-slate-300 text-slate-600 hover:bg-slate-200"
                            : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                        }`}
                      >
                        {p.is_active ? "O'chirish" : "Faollashtirish"}
                      </button>
                      <button
                        onClick={() => handleEditPreset(p)}
                        className="text-xs px-2.5 py-1 rounded-lg font-bold bg-slate-200 hover:bg-slate-300 text-slate-700"
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CLIENTS OVERVIEW */}
      {activeTab === "clients" && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Mijozlar Umumiy Qarzdorlik Holati</h2>
              <p className="text-xs text-slate-500">
                Barcha sotuvchilarga tegishli mijozlarning 585 lom oltin qarz va avans hisoblari.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">Mijoz Kodi</th>
                  <th className="py-2.5 px-3 font-semibold">Mijoz Ismi</th>
                  <th className="py-2.5 px-3 font-semibold">Telefon</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan (Lom)</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan (Naqd)</th>
                  <th className="py-2.5 px-3 font-semibold">Hozirgi Qarz</th>
                  <th className="py-2.5 px-3 font-semibold">Avans (Ortiqcha)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clientAccounts.map((c) => {
                  const cust = c.customer || customers.find(cu => String(cu.id) === String(c.customer_id));
                  return (
                    <tr key={c.customer_id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {cust?.customer_code || "CUST-XXXX"}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">{cust?.contact_name || "Mijoz"}</td>
                      <td className="py-2.5 px-3 text-slate-600">{cust?.phone || "—"}</td>
                      <td className="py-2.5 px-3 font-mono">{Number(c.total_scrap_paid_grams || 0).toFixed(4)}g</td>
                      <td className="py-2.5 px-3 font-mono text-emerald-700">
                        {Number(c.total_cash_paid_amount || 0).toLocaleString()} UZS
                      </td>
                      <td className="py-2.5 px-3 font-mono font-black text-rose-600 text-sm">
                        {Number(c.current_debt_grams || c.current_gold_debt_grams || 0).toFixed(4)}g
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {Number(c.advance_balance_grams || c.advance_gold_balance_grams || 0) > 0
                          ? `+${Number(c.advance_balance_grams || c.advance_gold_balance_grams).toFixed(4)}g`
                          : "0.0000g"}
                      </td>
                    </tr>
                  );
                })}
                {clientAccounts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-400">
                      Hozircha mijozlar hisob raqamlari mavjud emas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: HISTORY & AUDIT */}
      {activeTab === "history" && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Oxirgi Tushum va Qaytimlar Arxivi</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">№ Kvitansiya</th>
                  <th className="py-2.5 px-3 font-semibold">Yo&apos;nalish</th>
                  <th className="py-2.5 px-3 font-semibold">Sotuvchi / Mijoz</th>
                  <th className="py-2.5 px-3 font-semibold">Lom Oltin</th>
                  <th className="py-2.5 px-3 font-semibold">Naqd Pul</th>
                  <th className="py-2.5 px-3 font-semibold">Kurs</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan</th>
                  <th className="py-2.5 px-3 font-semibold">Sana</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map((s) => {
                  const cust = s.customer || customers.find(cu => String(cu.id) === String(s.customer_id));
                  const seller = s.seller || employees.find(e => String(e.id) === String(s.seller_id));
                  const partyName = cust?.contact_name || seller?.name || seller?.full_name || "—";
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{s.settlement_no}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          s.direction === "client_to_seller"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {s.direction === "client_to_seller" ? "Mijoz → Sotuvchi" : "Sotuvchi → Zavod"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {partyName}
                      </td>
                      <td className="py-2.5 px-3 font-mono">{Number(s.scrap_weight_grams).toFixed(4)}g</td>
                      <td className="py-2.5 px-3 font-mono text-emerald-700">
                        {Number(s.cash_paid_amount).toLocaleString()} UZS
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {Number(s.gold_rate_applied).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {Number(s.total_settled_grams).toFixed(4)}g
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">{s.settlement_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: SCANNER 564 CONSIGNMENT */}
      {activeTab === "scanner_consign" && (
        <ScannerConsignmentSection
          activeSellers={activeSellers}
          availableModels={models}
          factoryPresets={factoryPresets}
          onConfirmConsignment={handleConfirmBarcodeConsignment}
          isBusy={busy}
        />
      )}

      {/* TAB 7: SELLER INVENTORY (PIECES & RECONCILIATION) */}
      {activeTab === "seller_stock" && (
        <SellerInventoryDashboard
          pieces={pieces}
          sellers={activeSellers}
          sellerAccounts={sellerAccounts}
        />
      )}

      {/* TAB 8: BARTENDER MODELS & QR */}
      {activeTab === "models" && (
        <BarTenderModelManager
          models={models}
          onAddModel={handleAddNewModel}
          isBusy={busy}
        />
      )}

      {/* TAB 9: SCANNER 564 DIAGNOSTICS */}
      {activeTab === "diagnostics" && <ScannerDiagnostics />}

      {/* MODAL 1: DAILY SCRAP RATE */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={(e) => void handleSaveDailyRate(e)}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-amber-200"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-slate-900">Kunlik Lom Kursini Kiritish</h3>
              <button
                type="button"
                onClick={() => setShowRateModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Kurs (1 gramm lom 585 uchun UZS):</label>
                <input
                  type="number"
                  step="1000"
                  value={newRateAmount}
                  onChange={(e) => setNewRateAmount(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-base font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Sana:</label>
                <input
                  type="date"
                  value={newRateDate}
                  onChange={(e) => setNewRateDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Izoh:</label>
                <input
                  type="text"
                  placeholder="Bozor kursi bo'yicha tasdiqlandi..."
                  value={newRateNotes}
                  onChange={(e) => setNewRateNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border">
                ℹ️ Qoida 6: Ushbu kurs bo&apos;yicha mijozdan olingan naqd pullar o&apos;sha operatsiya sanasidagi kurs bilan lom grammiga aylantiriladi va tarixiy qiymati o&apos;zgarmaydi.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowRateModal(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700"
              >
                Bekor qilish
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-md"
              >
                {busy ? "Saqlanmoqda..." : "Tasdiqlash & Saqlash"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: DYNAMIC PRESET ADD/EDIT */}
      {presetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={(e) => void handleSavePreset(e)}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-blue-200"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-slate-900">
                {editingPreset ? "Ustama Foizini Tahrirlash" : "Yangi Ustama Foizi Qo'shish"}
              </h3>
              <button
                type="button"
                onClick={() => setPresetModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Toifa:</label>
                <select
                  value={presetType}
                  onChange={(e) => setPresetType(e.target.value as "factory_markup" | "client_markup")}
                  disabled={editingPreset != null}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold"
                >
                  <option value="factory_markup">Zavod Ustamasi (Factory Markup)</option>
                  <option value="client_markup">Mijozga Sotish Ustamasi (Client Markup)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Ustama Foizi (%):</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="Masalan: 14.5"
                    value={presetPercentage}
                    onChange={(e) => setPresetPercentage(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tartib (Display Order):</label>
                  <input
                    type="number"
                    value={presetOrder}
                    onChange={(e) => setPresetOrder(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nomi (Tavsifi):</label>
                <input
                  type="text"
                  placeholder="Masalan: Zavod 14% (Katta Partiya)"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="presetDefaultCheck"
                  checked={presetIsDefault}
                  onChange={(e) => setPresetIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600"
                />
                <label htmlFor="presetDefaultCheck" className="text-xs text-slate-700 font-medium">
                  Ushbu toifa uchun standart (default) qilib belgilash
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPresetModalOpen(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700"
              >
                Bekor qilish
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md"
              >
                {busy ? "Saqlanmoqda..." : "Saqlash"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: SURRENDER (ACCEPT TILL INTO FACTORY) */}
      {surrenderModalOpen && surrenderSeller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={(e) => void handleConfirmSurrender(e)}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-indigo-200"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-slate-900">Zavodga Tushumni Qabul Qilish</h3>
                <div className="text-xs text-slate-500">
                  Sotuvchi: {surrenderSeller.seller?.name || surrenderSeller.seller?.full_name || employees.find(e => String(e.id) === String(surrenderSeller.seller_id))?.full_name || "Sotuvchi"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSurrenderModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="bg-slate-50 p-3 rounded-2xl border text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Sotuvchi kassasidagi lom:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {Number(surrenderSeller.seller_till_scrap_grams || 0).toFixed(4)} g
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Sotuvchi kassasidagi naqd:</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {Number(surrenderSeller.seller_till_cash_amount || 0).toLocaleString()} UZS
                  </span>
                </div>
                <div className="flex justify-between text-amber-900 font-semibold border-t pt-1">
                  <span>Zavod majburiyati:</span>
                  <span className="font-mono font-bold">
                    {Number(surrenderSeller.current_factory_obligation_grams || surrenderSeller.remaining_factory_gold_due_grams || 0).toFixed(4)} g
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Qabul qilinayotgan Lom Oltin (g):
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={surrenderScrapWeight}
                  onChange={(e) => setSurrenderScrapWeight(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Qabul qilinayotgan Naqd Pul (UZS):
                </label>
                <input
                  type="number"
                  step="1000"
                  min="0"
                  value={surrenderCashAmount}
                  onChange={(e) => setSurrenderCashAmount(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-emerald-700"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Izoh:</label>
                <input
                  type="text"
                  placeholder="Kassir qabul qildi..."
                  value={surrenderNotes}
                  onChange={(e) => setSurrenderNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setSurrenderModalOpen(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700"
              >
                Bekor qilish
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md font-bold"
              >
                {busy ? "Qabul qilinmoqda..." : "Qabul Qilish & Chek"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* RECEIPT MODAL */}
      <SalesReceiptModal data={receiptData} onClose={() => setReceiptData(null)} />
    </div>
  );
}
