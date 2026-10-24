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
  type ConsignmentPieceRow,
} from "@/lib/erp-engine";
import { SalesReceiptModal, type ReceiptData } from "./SalesReceiptModal";
import { MobileBarcodeScannerModal } from "./MobileBarcodeScannerModal";
import {
  detectBarcodeType,
  parseWeightValue,
  playScannerBeep,
  DEFAULT_SCANNER_CONFIG,
  formatScreenGrams,
  formatScreenUZS,
  type JewelryModelItem,
} from "@/lib/barcode-scanner-engine";
import { ModelPhotoThumbnail } from "./ModelPhotoThumbnail";
import { parseErrorMessage } from "@/lib/error-utils";

interface CustomerItem {
  id: string;
  customer_code?: string;
  contact_name: string;
  phone?: string;
  company_name?: string;
}

export function SellerMobileWorkspace() {
  const [activeTab, setActiveTab] = useState<
    "stock" | "pieces" | "scan_sale" | "sale" | "settle" | "debts" | "customer" | "till"
  >("stock");

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
  const [myPieces, setMyPieces] = useState<ConsignmentPieceRow[]>([]);
  const [models, setModels] = useState<JewelryModelItem[]>([]);
  const [mySales, setMySales] = useState<JewelrySaleRow[]>([]);
  const [myTillAccount, setMyTillAccount] = useState<SellerGoldAccountRow | null>(null);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [clientAccounts, setClientAccounts] = useState<ClientGoldAccountRow[]>([]);

  // Mobile Barcode Scan Sale state
  const [scanModelCode, setScanModelCode] = useState("");
  const [scanWeight, setScanWeight] = useState("");
  const [matchedPiece, setMatchedPiece] = useState<ConsignmentPieceRow | null>(null);
  const [scanCustomerId, setScanCustomerId] = useState("");
  const [scanClientMarkup, setScanClientMarkup] = useState("12.00");
  const [scanNotes, setScanNotes] = useState("");
  const [scanInputVal, setScanInputVal] = useState("");
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

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
  const [settleUsdAmount, setSettleUsdAmount] = useState("");
  const [settleUsdRate, setSettleUsdRate] = useState("");
  const [isManualUsdRate, setIsManualUsdRate] = useState(false);
  const [cbuUsdRate, setCbuUsdRate] = useState<number | null>(null);
  const [settleNotes, setSettleNotes] = useState("");

  const notifySuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };
  const notifyError = (msg: unknown, prefix?: string) => {
    let text = "";
    if (typeof msg === "string") {
      text = msg.includes("[object Object]")
        ? msg.replace("[object Object]", "Server javobida xatolik yuz berdi")
        : msg;
    } else {
      text = parseErrorMessage(msg);
    }
    const fullText = prefix ? `${prefix}: ${text}` : text;
    setErrorMessage(fullText);
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
        piecesRes,
        modelsRes,
      ] = await Promise.all([
        supabase.from("daily_gold_rates").select("*").order("rate_date", { ascending: false }).limit(1),
        supabase.rpc("rpc_get_active_sales_markups", { p_type: "client_markup" }),
        sellerId
          ? supabase.from("seller_consignments").select("*").eq("seller_id", sellerId).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        sellerId
          ? supabase.from("jewelry_sales").select("*, customer:customers(id, contact_name, customer_code, phone)").eq("seller_id", sellerId).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        sellerId
          ? supabase.from("seller_gold_accounts").select("*").eq("seller_id", sellerId).maybeSingle()
          : Promise.resolve({ data: null }),
        sellerId && !isAdminOrDir
          ? supabase.from("customers").select("id, customer_code, contact_name, phone, company_name, seller_id").or(`seller_id.eq.${sellerId},seller_id.is.null`).order("contact_name", { ascending: true })
          : supabase.from("customers").select("id, customer_code, contact_name, phone, company_name, seller_id").order("contact_name", { ascending: true }),
        sellerId && !isAdminOrDir
          ? supabase.from("client_gold_accounts").select("*, customer:customers(id, contact_name, customer_code, phone)").eq("seller_id", sellerId)
          : supabase.from("client_gold_accounts").select("*, customer:customers(id, contact_name, customer_code, phone)"),
        sellerId
          ? supabase.from("consignment_pieces").select("*").eq("seller_id", sellerId).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        supabase.from("jewelry_models").select("*").order("model_code", { ascending: true }),
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
      if (piecesRes.data) {
        setMyPieces(piecesRes.data as unknown as ConsignmentPieceRow[]);
      }
      if (modelsRes.data) {
        setModels(modelsRes.data as JewelryModelItem[]);
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

      // Fetch official CBU USD rate
      try {
        const cbuRes = await fetch("/api/sales/currency/cbu");
        const cbuJson = await cbuRes.json();
        if (cbuJson.success && cbuJson.data?.rate) {
          setCbuUsdRate(cbuJson.data.rate);
          setSettleUsdRate((prev) => prev || String(cbuJson.data.rate));
        }
      } catch {
        // CBU fetch error handled gracefully
      }
    } catch (err: unknown) {
      notifyError(err, "Sotuvchi panelini yuklashda xatolik");
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
      notifyError(err, "Mijozni ro'yxatdan o'tkazishda xatolik");
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
          clientGoldDueGrams: Number(data?.gross_gold_due_grams ?? data?.client_gold_due_grams ?? liveSaleCalc.clientGoldDueGrams),
          markupSpreadGrams: liveSaleCalc.markupSpreadGrams,
          advanceAppliedGrams: Number(data?.advance_applied_grams || 0),
          remainingDebtGrams: Number(data?.net_remaining_debt_grams ?? data?.remaining_gold_grams ?? liveSaleCalc.clientGoldDueGrams),
          notes: saleNotes || "Mijozga nasiya asosida topshirildi",
        });
      }

      notifySuccess(`№${data.sale_no} savdo muvaffaqiyatli rasmiylashtirildi! Chek shakllantirildi.`);
      setSaleNotes("");
      setSaleConsignmentId("");
      await loadSellerWorkspace();
      setActiveTab("stock");
    } catch (err: unknown) {
      notifyError(err, "Savdoni yozishda xatolik");
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

  const rawPrevDebt = Number(customerDebtAccount?.current_debt_grams || customerDebtAccount?.current_gold_debt_grams || 0);
  const rawPrevAdv = Number(customerDebtAccount?.advance_balance_grams || customerDebtAccount?.advance_gold_balance_grams || 0);
  const previousDebtForSettle = Math.max(0, rawPrevDebt - rawPrevAdv);

  const hasValidDailyRate = Boolean(dailyRate && Number(dailyRate.rate_per_gram) > 0);
  const activeRatePerGram = hasValidDailyRate ? Number(dailyRate!.rate_per_gram) : 0;

  const liveSettleCalc = useMemo(() => {
    const scrapW = parseFloat(settleScrapWeight) || 0;
    const cash = parseFloat(settleCashAmount) || 0;
    const usd = parseFloat(settleUsdAmount) || 0;
    const usdRate = parseFloat(settleUsdRate) || 0;
    return GoldEngine.calculateGoldSettlement(
      previousDebtForSettle,
      scrapW,
      cash,
      activeRatePerGram,
      usd,
      usdRate
    );
  }, [previousDebtForSettle, settleScrapWeight, settleCashAmount, settleUsdAmount, settleUsdRate, activeRatePerGram]);

  const handleRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleCustomerId) {
      notifyError("Iltimos, to'lov qilayotgan mijozni tanlang!");
      return;
    }

    const scrapW = parseFloat(settleScrapWeight) || 0;
    const cash = parseFloat(settleCashAmount) || 0;
    const usd = parseFloat(settleUsdAmount) || 0;
    const usdRate = parseFloat(settleUsdRate) || 0;

    if (scrapW <= 0 && cash <= 0 && usd <= 0) {
      notifyError("Iltimos, to'langan lom oltin vazni, naqd UZS yoki naqd USD summasini kiriting!");
      return;
    }

    if ((cash > 0 || usd > 0) && !hasValidDailyRate) {
      notifyError("⚠️ Bugungi 585 oltin kursi belgilanmagan! Naqd pul yoki valyuta qabul qilish uchun avval boshqaruvchidan kursni kiritishni so'rang.");
      return;
    }

    if (usd > 0 && (!usdRate || usdRate <= 0)) {
      notifyError("USD to'lovi uchun USD kursi (UZS/$) kiritilishi shart!");
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
        p_rate_per_gram: (cash > 0 || usd > 0) && hasValidDailyRate ? activeRatePerGram : null,
        p_usd_amount: usd,
        p_usd_rate: usd > 0 ? usdRate : null,
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
        usdAmount: usd,
        usdRateApplied: usd > 0 ? usdRate : undefined,
        usdEquivalentGrams: liveSettleCalc.usdEquivalentGrams,
        totalSettledGrams: liveSettleCalc.totalSettledGrams,
        previousDebtGrams: liveSettleCalc.previousDebtGrams,
        remainingDebtGrams: liveSettleCalc.remainingDebtGrams,
        advanceGoldGrams: liveSettleCalc.excessGoldGrams,
        notes: settleNotes || "Mijozdan to'lov qabul qilindi",
      });

      notifySuccess(`№${data.settlement_no} to'lov qabul qilindi! Kassaga kirim qilindi.`);
      setSettleScrapWeight("");
      setSettleCashAmount("");
      setSettleUsdAmount("");
      setSettleNotes("");
      await loadSellerWorkspace();
    } catch (err: unknown) {
      notifyError(err, "To'lovni qabul qilishda xatolik");
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

  // Filtered available consignments (batches) in seller's hand
  const availableConsignments = myConsignments.filter(c => c.status === "held_by_seller");

  // Filtered available pieces in seller's hand
  const availablePieces = useMemo(() => {
    return myPieces.filter(p => p.status === "held_by_seller");
  }, [myPieces]);

  // Selected customer for Barcode Scan Sale
  const selectedScanCustomer = useMemo(() => {
    return customers.find(c => String(c.id) === scanCustomerId) || null;
  }, [customers, scanCustomerId]);

  // Real-time piece calculation
  const livePieceSaleCalc = useMemo(() => {
    const baseW = matchedPiece ? Number(matchedPiece.weight_grams) : (parseFloat(scanWeight) || 0);
    if (baseW <= 0) return null;
    const fPct = 8.0; // Default or parent consignment markup
    const cPct = parseFloat(scanClientMarkup) || 12.0;
    return GoldEngine.calculateJewelryConsignmentAndSale(baseW, fPct, cPct);
  }, [matchedPiece, scanWeight, scanClientMarkup]);

  const activeModelItem = useMemo(() => {
    return models.find(m => m.model_code?.toLowerCase() === scanModelCode.toLowerCase()) || null;
  }, [models, scanModelCode]);

  // Handle scanned barcode (model QR or weight barcode)
  const handleProcessMobileBarcode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    const detected = detectBarcodeType(code, {
      ...DEFAULT_SCANNER_CONFIG,
      modelPrefixes: ["JF-M-", "MOD-", "JF-"],
    });

    if (detected.type === "model_qr") {
      const modelCode = detected.extractedModelCode || code;
      setScanModelCode(modelCode);
      playScannerBeep("model_switch");
      notifySuccess(`Model kodi tanlandi: ${modelCode}`);

      if (scanWeight) {
        const targetW = parseFloat(scanWeight);
        const match = availablePieces.find(
          p => (p.model_code?.toLowerCase() === modelCode.toLowerCase() || p.model_id === modelCode) &&
               Math.abs(Number(p.weight_grams) - targetW) < 0.001
        );
        if (match) {
          setMatchedPiece(match);
          playScannerBeep("success");
          notifySuccess(`Dona topildi: ${match.model_name || match.model_code} (${match.weight_grams} g)`);
        }
      }
      return;
    }

    // Weight barcode / number
    const parsed = parseWeightValue(code);
    if (parsed.success && parsed.weightGrams && parsed.weightGrams > 0) {
      setScanWeight(String(parsed.weightGrams));
      playScannerBeep("success");

      const targetW = parsed.weightGrams;
      const match = availablePieces.find(p => {
        const matchesWeight = Math.abs(Number(p.weight_grams) - targetW) < 0.001;
        if (!matchesWeight) return false;
        if (scanModelCode) {
          return p.model_code?.toLowerCase() === scanModelCode.toLowerCase();
        }
        return true;
      });

      if (match) {
        setMatchedPiece(match);
        if (match.model_code && !scanModelCode) {
          setScanModelCode(match.model_code);
        }
        notifySuccess(`Dona tasdiqlandi: ${match.model_name || match.model_code} (${match.weight_grams} g)`);
      } else {
        playScannerBeep("duplicate_warning");
        notifyError(`Ogohlantirish: ${targetW}g vaznli dona hisobingizda topilmadi!`);
      }
    } else {
      playScannerBeep("error");
      notifyError(`Noma'lum shtrix-kod: "${code}". Model QR yoki vazn shtrix-kodi kerak.`);
    }
  };

  // Quick Action: Pre-select piece for sale
  const handleQuickSellPiece = (piece: ConsignmentPieceRow) => {
    setMatchedPiece(piece);
    setScanModelCode(piece.model_code || "");
    setScanWeight(String(piece.weight_grams));
    setActiveTab("scan_sale");
  };

  // Return piece to factory
  const handleReturnPieceToFactory = async (piece: ConsignmentPieceRow) => {
    const reason = window.prompt(
      `"${piece.model_name || piece.model_code}" (${piece.weight_grams}g) ni zavodga qaytarish sababi:`,
      "Vitrinadan olindi / xarid qilinmadi"
    );
    if (!reason) return;

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("ret-piece");
      const { data, error } = await supabase.rpc("rpc_return_piece_to_factory", {
        p_piece_id: piece.id,
        p_notes: reason.trim(),
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      notifySuccess(`Dona zavodga qaytarildi va majburiyat ${formatScreenGrams(data.factory_due_deducted_grams, 2)} ga kamaytirildi!`);
      await loadSellerWorkspace();
    } catch (err: unknown) {
      notifyError(err, "Qaytarishda xatolik");
    } finally {
      setBusy(false);
    }
  };

  // Confirm Barcode Piece Sale
  const handleConfirmBarcodePieceSale = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!scanCustomerId) {
      notifyError("Iltimos, xaridor mijozni tanlang!");
      return;
    }

    const weightGrams = matchedPiece ? Number(matchedPiece.weight_grams) : parseFloat(scanWeight);
    if (!weightGrams || weightGrams <= 0) {
      notifyError("Mahsulot vazni aniqlanmadi! Shtrix-kodni qayta skanerlang.");
      return;
    }

    const cPct = parseFloat(scanClientMarkup);
    if (isNaN(cPct) || cPct < 0) {
      notifyError("Mijoz ustama foizi xato kiritilgan!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("sale-piece-scan");
      const { data, error } = await supabase.rpc("rpc_record_barcode_piece_sale", {
        p_customer_id: scanCustomerId,
        p_seller_id: currentSeller?.id,
        p_piece_id: matchedPiece?.id || null,
        p_model_id: matchedPiece?.model_id || null,
        p_weight_grams: weightGrams,
        p_client_markup_pct: cPct,
        p_notes: scanNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      if (livePieceSaleCalc) {
        setReceiptData({
          title: "Skaner Savdo Cheki (Dona Barcode)",
          receiptNo: data.sale_no || "SALE-SCAN",
          date: new Date().toLocaleDateString("uz-UZ"),
          sellerName: currentSeller?.name || currentSeller?.full_name || "Sotuvchi",
          customerName: selectedScanCustomer?.contact_name || "Mijoz",
          customerCode: selectedScanCustomer?.customer_code,
          customerPhone: selectedScanCustomer?.phone,
          itemName: `${matchedPiece?.category || "Zargarlik"} ${matchedPiece?.model_name || scanModelCode || ""}`.trim(),
          baseWeightGrams: livePieceSaleCalc.baseWeightGrams,
          purity: Number(matchedPiece?.purity || 585),
          factoryMarkupPct: livePieceSaleCalc.factoryMarkupPct,
          factoryGoldDueGrams: livePieceSaleCalc.factoryGoldDueGrams,
          clientMarkupPct: livePieceSaleCalc.clientMarkupPct,
          clientGoldDueGrams: Number(data?.gross_gold_due_grams ?? livePieceSaleCalc.clientGoldDueGrams),
          markupSpreadGrams: livePieceSaleCalc.markupSpreadGrams,
          advanceAppliedGrams: Number(data?.advance_applied_grams || 0),
          remainingDebtGrams: Number(data?.net_remaining_debt_grams ?? livePieceSaleCalc.clientGoldDueGrams),
          notes: scanNotes || "Skaner 564 orqali sotildi",
        });
      }

      notifySuccess(`№${data.sale_no} savdo muvaffaqiyatli rasmiylashtirildi! Chek shakllantirildi.`);
      setScanModelCode("");
      setScanWeight("");
      setMatchedPiece(null);
      setScanNotes("");
      setScanInputVal("");

      await loadSellerWorkspace();
      setActiveTab("pieces");
    } catch (err: unknown) {
      notifyError(err, "Skaner savdoni yozishda xatolik");
    } finally {
      setBusy(false);
    }
  };

  // Filtered debtors (strictly net debt > 0)
  const debtorsList = clientAccounts.filter(c => {
    const d = Number(c.current_debt_grams || c.current_gold_debt_grams || 0);
    const a = Number(c.advance_balance_grams || c.advance_gold_balance_grams || 0);
    return (d - a) > 0.0001;
  });

  // Filtered advance clients (strictly advance > 0)
  const advancesList = clientAccounts.filter(c => {
    const a = Number(c.advance_balance_grams || c.advance_gold_balance_grams || 0);
    return a > 0.0001;
  });

  // Till status numbers
  const myTillScrap = Number(myTillAccount?.seller_till_scrap_grams || 0);
  const myTillCash = Number(myTillAccount?.seller_till_cash_amount || 0);
  const myFactoryObligation = Number(myTillAccount?.current_factory_obligation_grams || myTillAccount?.remaining_factory_gold_due_grams || 0);
  const myBozorQarzi = myTillAccount?.bozor_qarzi_signed_g !== undefined ? Number(myTillAccount.bozor_qarzi_signed_g) : -myFactoryObligation;

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
            <div className="text-xs font-bold text-[#CBD5E1]">Kassamdagi Lom</div>
            <div className="text-base font-black font-mono text-amber-300 mt-0.5">
              {formatScreenGrams(myTillScrap, 2)}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-2.5">
            <div className="text-xs font-bold text-[#CBD5E1]">Kassamdagi Naqd</div>
            <div className="text-base font-black font-mono text-emerald-400 mt-0.5">
              {formatScreenUZS(myTillCash)}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-2.5">
            <div className="text-xs font-bold text-[#CBD5E1]">Bozor Qarzi</div>
            <div className={`text-base font-black font-mono mt-0.5 ${
              myBozorQarzi < 0 ? "text-rose-400" : myBozorQarzi > 0 ? "text-emerald-400" : "text-[#F8FAFC]"
            }`}>
              {myBozorQarzi < 0
                ? `-${formatScreenGrams(Math.abs(myBozorQarzi), 2)}`
                : myBozorQarzi > 0
                ? `+${formatScreenGrams(myBozorQarzi, 2)}`
                : formatScreenGrams(0, 2)}
            </div>
          </div>
        </div>
      </div>

      {/* Touch-Friendly Navigation Tabs (Touch targets >= 44px) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 bg-slate-900 border-2 border-slate-800 p-2 rounded-2xl text-xs font-bold shadow-md">
        <button
          id="tabScanSale"
          onClick={() => setActiveTab("scan_sale")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "scan_sale" ? "bg-amber-500 text-slate-950 shadow-md font-extrabold" : "text-amber-400 hover:bg-slate-800"
          }`}
        >
          ⚡ Skaner Savdo
        </button>
        <button
          id="tabPieces"
          onClick={() => setActiveTab("pieces")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "pieces" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          📦 Donalar ({availablePieces.length})
        </button>
        <button
          id="tabStock"
          onClick={() => setActiveTab("stock")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "stock" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          💎 Mahsulotlar ({availableConsignments.length})
        </button>
        <button
          id="tabSale"
          onClick={() => setActiveTab("sale")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "sale" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          🏷️ Nasiya
        </button>
        <button
          id="tabSettle"
          onClick={() => setActiveTab("settle")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "settle" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          💰 To&apos;lov Olish
        </button>
        <button
          id="tabDebts"
          onClick={() => setActiveTab("debts")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "debts" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          📒 Qarzlar ({debtorsList.length})
        </button>
        <button
          id="tabCustomer"
          onClick={() => setActiveTab("customer")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "customer" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          ➕ Yangi Mijoz
        </button>
        <button
          id="tabTill"
          onClick={() => setActiveTab("till")}
          className={`min-h-[44px] py-2 px-2 rounded-xl transition flex items-center justify-center text-center font-bold ${
            activeTab === "till" ? "bg-blue-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          🏦 Kassam
        </button>
      </div>

      {/* TAB: SCANNER 564 & CAMERA PIECE SALE */}
      {activeTab === "scan_sale" && (
        <div className="space-y-4">
          <div className="bg-slate-900 border-2 border-amber-500/50 rounded-3xl p-5 shadow-xl text-white space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                  Scanner 564 + Kamera Skaner
                </span>
                <h2 className="text-lg font-black text-white mt-0.5">Shtrix-kodli Dona Savdo</h2>
              </div>
              <button
                type="button"
                id="openCameraBtn"
                onClick={() => setCameraModalOpen(true)}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow transition"
              >
                📷 Kamera Skaner
              </button>
            </div>

            {/* Keyboard Wedge / Scanner input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                Skaner 564 Kiritish (Vazn Shtrix-kodi):
              </label>
              <div className="flex gap-2">
                <input
                  id="sellerBarcodeScanInput"
                  type="text"
                  autoFocus
                  placeholder="Vazn shtrixkodini skaner qiling (masalan: 14.52)..."
                  value={scanInputVal}
                  onChange={(e) => setScanInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleProcessMobileBarcode(scanInputVal);
                      setScanInputVal("");
                    }
                  }}
                  className="flex-1 bg-slate-950 border-2 border-slate-700 focus:border-amber-400 text-white rounded-xl px-3 py-2.5 text-xs font-mono outline-none"
                />
                <button
                  type="button"
                  id="processScanBtn"
                  onClick={() => {
                    handleProcessMobileBarcode(scanInputVal);
                    setScanInputVal("");
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold px-4 py-2.5 rounded-xl text-xs border border-slate-700"
                >
                  Kiritish
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                💡 Skaner 564 shtrix-kodni o&apos;qigach Enter bosadi. Telefon kamerasini ishlatish uchun &quot;Kamera Skaner&quot; tugmasini bosing.
              </p>
            </div>

            {/* Scanned Indicators */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3">
                <span className="text-[10px] text-slate-400 block font-bold">Model Kodi</span>
                <span id="scannedModelIndicator" className="font-mono font-bold text-sm text-amber-300">
                  {scanModelCode ? `${scanModelCode}${activeModelItem ? ` (${activeModelItem.name})` : ""}` : "— Tanlanmagan —"}
                </span>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3">
                <span className="text-[10px] text-slate-400 block font-bold">Skanerlangan Vazn</span>
                <span id="scannedWeightIndicator" className="font-mono font-bold text-sm text-emerald-400">
                  {scanWeight ? `${scanWeight} g` : "— Kiritilmagan —"}
                </span>
              </div>
            </div>

            {/* Matched Piece Card */}
            {matchedPiece ? (
              <div id="matchedPieceCard" className="bg-emerald-950/60 border-2 border-emerald-500/60 rounded-2xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center text-emerald-300 font-bold">
                  <span>✅ Omboringizdagi Mahsulot Topildi:</span>
                  <span className="font-mono bg-emerald-900/60 px-2 py-0.5 rounded text-[10px]">{matchedPiece.id.slice(0, 8)}...</span>
                </div>
                <div className="flex items-center gap-3">
                  <ModelPhotoThumbnail
                    src={
                      matchedPiece.primary_image_url ||
                      models.find((m) => m.model_code === matchedPiece.model_code || m.id === matchedPiece.model_id)?.primary_image_url
                    }
                    alt={matchedPiece.model_name || matchedPiece.model_code}
                    size="md"
                    rounded="xl"
                  />
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="text-white font-extrabold text-sm truncate">
                      {matchedPiece.category || "Zargarlik"} — {matchedPiece.model_name || matchedPiece.model_code}
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-slate-300 font-mono text-[11px] pt-0.5">
                      <span>Proba: <strong className="text-amber-300">{matchedPiece.purity}°</strong></span>
                      <span>Aniq Vazn: <strong id="matchedPieceWeight" className="text-emerald-300">{formatScreenGrams(matchedPiece.weight_grams, 2)}</strong></span>
                      <span>Model: <strong className="text-white">{matchedPiece.model_code}</strong></span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/80 border border-dashed border-slate-700 rounded-2xl p-3 text-center text-slate-400 text-xs">
                🔍 Model kodi yoki vazn shtrix-kodini skanerlang. Omboringizdagi mos dona avtomatik tanlanadi.
              </div>
            )}
          </div>

          {/* Sale Confirmation Form */}
          <form onSubmit={handleConfirmBarcodePieceSale} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-[#0F172A]">
            <h3 className="font-bold text-[#0F172A] text-sm">Xaridor va Savdo Shartlari</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  Xaridor Mijozni Tanlang: <span className="text-rose-500">*</span>
                </label>
                <select
                  id="scanSaleCustomerSelect"
                  value={scanCustomerId}
                  onChange={(e) => setScanCustomerId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-[#0F172A] focus:border-amber-500 outline-none"
                  required
                >
                  <option value="">— Mijozni tanlang —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contact_name} {c.customer_code ? `(${c.customer_code})` : ""} {c.phone ? `— ${c.phone}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  Mijozga Sotish Ustama Foizi (%): <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2 mb-2 flex-wrap">
                  {activeClientMarkups.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setScanClientMarkup(String(p.percentage))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        scanClientMarkup === String(p.percentage)
                          ? "bg-amber-600 text-white shadow-sm"
                          : "bg-slate-100 text-[#475569] hover:bg-slate-200"
                      }`}
                    >
                      +{p.percentage}%
                    </button>
                  ))}
                </div>
                <input
                  id="scanSaleMarkupSelect"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={scanClientMarkup}
                  onChange={(e) => setScanClientMarkup(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-[#0F172A]"
                  required
                />
              </div>

              {/* Real-time Calculation Breakdown */}
              {livePieceSaleCalc && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5 space-y-2 text-xs">
                  <div className="font-bold text-amber-900 border-b border-amber-200 pb-1 flex justify-between">
                    <span>Hisob-kitob (Asl Mahsulot Grammidan):</span>
                    <span className="font-mono text-amber-800">{formatScreenGrams(livePieceSaleCalc.baseWeightGrams, 2)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[#475569] block">Zavod Majburiyati (+{livePieceSaleCalc.factoryMarkupPct}%):</span>
                      <span className="font-mono font-bold text-[#0F172A]">{formatScreenGrams(livePieceSaleCalc.factoryGoldDueGrams, 2)}</span>
                    </div>
                    <div>
                      <span className="text-[#475569] block">Mijoz Qarzi (+{livePieceSaleCalc.clientMarkupPct}%):</span>
                      <span id="liveClientDueGrams" className="font-mono font-bold text-blue-700">{formatScreenGrams(livePieceSaleCalc.clientGoldDueGrams, 2)}</span>
                    </div>
                    <div className="col-span-2 pt-1 border-t border-amber-200/60 flex justify-between">
                      <span className="text-[#475569]">Ustama Farqi:</span>
                      <span className="font-mono font-bold text-amber-900">+{formatScreenGrams(livePieceSaleCalc.markupSpreadGrams, 2)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Izoh (Ixtiyoriy):
                </label>
                <input
                  id="scanSaleNotesInput"
                  type="text"
                  placeholder="Savdo haqida eslatma..."
                  value={scanNotes}
                  onChange={(e) => setScanNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
              </div>

              <button
                id="confirmScanSaleBtn"
                type="submit"
                disabled={busy || !scanCustomerId || (!matchedPiece && !scanWeight)}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 text-slate-950 font-black text-sm rounded-xl shadow-lg transition"
              >
                {busy ? "Savdo Rasmiylashtirilmoqda..." : "⚡ Savdoni Tasdiqlash va Chek Berish"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB: MY CONSIGNED PIECES LIST */}
      {activeTab === "pieces" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-base font-bold text-[#F8FAFC]">Vitrinamdagi Donalar Ro&apos;yxati</h2>
            <span id="piecesCountBadge" className="text-xs text-[#CBD5E1] font-medium">Jami: {availablePieces.length} dona</span>
          </div>

          {availablePieces.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center text-[#475569] space-y-2 text-[#0F172A]">
              <div className="text-3xl">📦</div>
              <div className="font-bold text-sm text-[#0F172A]">Hozirda sizning hisobingizda dona mahsulotlar yo&apos;q</div>
              <p className="text-xs text-[#475569]">
                Direktor &quot;Shtrix-kodli Mahsulot Topshirish&quot; orqali sizga mahsulot yuklaganda bu yerda paydo bo&apos;ladi.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {availablePieces.map((p) => {
                const modelObj = models.find(
                  (m) => m.model_code === p.model_code || m.id === p.model_id
                );
                const photoUrl =
                  p.primary_image_url || modelObj?.primary_image_url;

                return (
                  <div
                    key={p.id}
                    data-piece-id={p.id}
                    className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm flex items-center justify-between hover:border-amber-400 transition gap-3 text-[#0F172A]"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <ModelPhotoThumbnail
                        src={photoUrl}
                        alt={p.model_name || p.model_code}
                        size="sm"
                        rounded="xl"
                      />
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#0F172A] text-sm truncate">
                            {p.category || "Zargarlik"} — {p.model_name || p.model_code}
                          </span>
                          <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
                            {p.purity || 585}°
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[#475569]">
                          <span className="font-mono text-[#475569] font-semibold">{p.model_code}</span>
                          <span>•</span>
                          <span className="font-mono font-black text-[#0F172A] text-sm">
                            {formatScreenGrams(p.weight_grams, 2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleReturnPieceToFactory(p)}
                        title="Ushbu donani zavod omboriga qaytarish"
                        className="bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs px-2.5 py-2 rounded-xl transition"
                      >
                        ↩️ Qaytarish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickSellPiece(p)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl shadow transition"
                      >
                        ⚡ Sotish
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 1: MY CONSIGNED STOCK */}
      {activeTab === "stock" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-base font-bold text-[#F8FAFC]">O&apos;zimdagi Mahsulotlar (Vitrina)</h2>
            <span className="text-xs text-[#CBD5E1] font-medium">Jami: {availableConsignments.length} dona</span>
          </div>

          {availableConsignments.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center text-[#475569] space-y-2 text-[#0F172A]">
              <div className="text-3xl">📦</div>
              <div className="font-bold text-sm text-[#0F172A]">Hozirda sizga topshirilgan mahsulot yo&apos;q</div>
              <p className="text-xs text-[#475569]">
                Direktor panel orqali sizga mahsulot topshirishi bilan bu yerda ko&apos;rinadi.
              </p>
            </div>
          ) : (
            availableConsignments.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm space-y-3 hover:border-blue-400 transition text-[#0F172A]"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3">
                    <ModelPhotoThumbnail
                      src={
                        c.primary_image_url ||
                        models.find((m) => m.name === c.product_name || m.model_code === c.item_name)?.primary_image_url
                      }
                      alt={c.product_name || c.item_name || "Mahsulot"}
                      size="sm"
                      rounded="xl"
                    />
                    <div>
                      <div className="font-bold text-[#0F172A] text-sm">{c.product_name || c.item_name}</div>
                      <div className="text-[11px] font-mono text-blue-600 font-bold mt-0.5">
                        {c.consignment_no}
                      </div>
                    </div>
                  </div>
                  <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
                    {c.proba || 585}° proba
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-2xl text-center text-xs">
                  <div>
                    <span className="text-[#475569] block text-[10px]">Asl Vazn</span>
                    <span className="font-mono font-bold text-[#0F172A]">{formatScreenGrams(c.base_weight_grams, 2)}</span>
                  </div>
                  <div>
                    <span className="text-[#475569] block text-[10px]">Zavod Ustamasi</span>
                    <span className="font-mono font-bold text-amber-700">+{c.factory_markup_pct}%</span>
                  </div>
                  <div>
                    <span className="text-[#475569] block text-[10px]">Zavod Majburiyati</span>
                    <span className="font-mono font-bold text-[#0F172A]">{formatScreenGrams(c.factory_gold_due_grams, 2)}</span>
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
          className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-sm text-[#0F172A]"
        >
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Mijozga Nasiyaga Mahsulot Sotish</h2>
            <p className="text-xs text-[#475569]">
              Faqat direktor tasdiqlagan foizlar tanlanadi. Asl vazndan alohida hisoblanadi.
            </p>
          </div>

          <div className="space-y-3">
            {/* Consignment Selection */}
            <div>
              <label htmlFor="saleConsignmentSelect" className="block text-xs font-bold text-[#475569] mb-1">Topshiriladigan Mahsulot:</label>
              <select
                id="saleConsignmentSelect"
                value={saleConsignmentId}
                onChange={(e) => setSaleConsignmentId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs text-[#0F172A] focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">Mahsulotni tanlang...</option>
                {availableConsignments.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.product_name || c.item_name} ({formatScreenGrams(c.base_weight_grams, 2)}, {c.proba || 585}°) — Zavod: +{c.factory_markup_pct}%
                  </option>
                ))}
              </select>
            </div>

            {/* Customer Selection */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="saleCustomerSelect" className="text-xs font-bold text-[#475569]">Mijoz:</label>
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
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs text-[#0F172A] focus:ring-2 focus:ring-blue-500 outline-none"
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
              <label htmlFor="saleClientMarkupSelect" className="block text-xs font-bold text-[#475569] mb-1">
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
                  <span className="text-[#475569]">Asl Mahsulot Vazni:</span>
                  <span className="font-mono font-bold text-[#0F172A]">{formatScreenGrams(liveSaleCalc.baseWeightGrams, 2)}</span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Zavod Majburiyati (+{liveSaleCalc.factoryMarkupPct}%):</span>
                  <span className="font-mono font-bold text-[#0F172A]">{formatScreenGrams(liveSaleCalc.factoryGoldDueGrams, 2)}</span>
                </div>

                <div className="border-t border-amber-200/80 pt-2 flex justify-between text-sm">
                  <span className="font-bold text-amber-950">Mijozning Oltin Qarzi (+{liveSaleCalc.clientMarkupPct}%):</span>
                  <span className="font-mono font-black text-amber-950 text-base">
                    {formatScreenGrams(liveSaleCalc.clientGoldDueGrams, 2)}
                  </span>
                </div>

                <div className="flex justify-between text-xs text-[#475569] italic pt-1 border-t border-amber-200/50">
                  <span>Hisob-kitobdagi farq (Spread):</span>
                  <span className="font-mono font-semibold">+{formatScreenGrams(liveSaleCalc.markupSpreadGrams, 2)}</span>
                </div>
                <div className="text-[10px] text-amber-700 italic">
                  * Eslatma: Foizlar ketma-ket ko&apos;paytirilmaydi. Farq faqat hisob-kitobdagi tafovut bo&apos;lib, shaxsiy foyda emas.
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#475569] mb-1">Izoh (ixtiyoriy):</label>
              <input
                type="text"
                placeholder="To'lov muddati yoki shartlar..."
                value={saleNotes}
                onChange={(e) => setSaleNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
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
          className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-sm text-[#0F172A]"
        >
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Mijozdan To&apos;lov (Lom yoki Pul) Qabul Qilish</h2>
            <p className="text-xs text-[#475569]">
              Qoida 5: To&apos;lov to&apos;g&apos;ridan-to&apos;g&apos;ri sizning kassangizga kiradi. Naqd pul kurs bo&apos;yicha lomga aylanadi.
            </p>
          </div>

          <div className="space-y-3">
            {/* Customer Selection */}
            <div>
              <label htmlFor="settleCustomerSelect" className="block text-xs font-bold text-[#475569] mb-1">Mijoz:</label>
              <select
                id="settleCustomerSelect"
                value={settleCustomerId}
                onChange={(e) => setSettleCustomerId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs text-[#0F172A] focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">To&apos;lov qiluvchi mijozni tanlang...</option>
                {customers.map((cust) => {
                  const acc = clientAccounts.find(a => String(a.customer_id) === String(cust.id));
                  const d = Number(acc?.current_debt_grams || acc?.current_gold_debt_grams || 0);
                  const a = Number(acc?.advance_balance_grams || acc?.advance_gold_balance_grams || 0);
                  const net = Math.max(0, d - a);
                  let label = "• Qarzsiz";
                  if (net > 0) {
                    label = `• Qarz: ${formatScreenGrams(net, 2)}`;
                  } else if (a > 0) {
                    label = `• Avans: +${formatScreenGrams(a, 2)}`;
                  }
                  return (
                    <option key={cust.id} value={cust.id}>
                      {cust.contact_name} ({cust.customer_code || "KODSIZ"}) {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Current Debt & Advance notice */}
            {settleCustomerId && (
              <div className="bg-slate-50 border p-3 rounded-2xl flex justify-between items-center text-xs">
                <div>
                  <span className="text-[#475569] block">Mijozning Joriy Qarzi:</span>
                  <span className="font-mono font-bold text-rose-600 text-sm">
                    {formatScreenGrams(previousDebtForSettle, 2)}
                  </span>
                </div>
                {Number(customerDebtAccount?.advance_balance_grams || customerDebtAccount?.advance_gold_balance_grams || 0) > 0 && (
                  <div className="text-right">
                    <span className="text-[#475569] block">Avans Balansi:</span>
                    <span className="font-mono font-bold text-blue-600">
                      +{formatScreenGrams(customerDebtAccount?.advance_balance_grams || customerDebtAccount?.advance_gold_balance_grams, 2)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Scrap Gold Input */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="settleScrapWeightInput" className="block text-xs font-bold text-[#475569] mb-1">Lom Oltin (g):</label>
                <input
                  id="settleScrapWeightInput"
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="0.00"
                  value={settleScrapWeight}
                  onChange={(e) => setSettleScrapWeight(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs font-bold text-[#0F172A]"
                />
              </div>
              <div>
                <label htmlFor="settleScrapPuritySelect" className="block text-xs font-bold text-[#475569] mb-1">Proba:</label>
                <select
                  id="settleScrapPuritySelect"
                  value={settleScrapPurity}
                  onChange={(e) => setSettleScrapPurity(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A] font-semibold"
                >
                  <option value="585">585 proba</option>
                  <option value="750">750 proba</option>
                  <option value="999">999 proba</option>
                </select>
              </div>
            </div>

            {/* Cash Input UZS & USD */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="settleCashAmountInput" className="block text-xs font-bold text-[#475569] mb-1">
                  Naqd UZS:
                </label>
                <input
                  id="settleCashAmountInput"
                  type="number"
                  step="1000"
                  min="0"
                  placeholder={hasValidDailyRate ? "0" : "Kurs kerak"}
                  disabled={!hasValidDailyRate}
                  value={settleCashAmount}
                  onChange={(e) => setSettleCashAmount(e.target.value)}
                  className={`w-full p-2.5 rounded-xl font-mono text-xs font-bold ${
                    hasValidDailyRate
                      ? "bg-slate-50 border border-slate-300 text-emerald-800"
                      : "bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                />
              </div>

              <div>
                <label htmlFor="settleUsdAmountInput" className="block text-xs font-bold text-[#475569] mb-1">
                  Naqd USD ($):
                </label>
                <input
                  id="settleUsdAmountInput"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="$ 0"
                  value={settleUsdAmount}
                  onChange={(e) => setSettleUsdAmount(e.target.value)}
                  className="w-full p-2.5 rounded-xl font-mono text-xs font-bold bg-slate-50 border border-slate-300 text-blue-800"
                />
              </div>
            </div>

            {/* Rates: 585 Gold & USD */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  585 Kursi: {hasValidDailyRate ? `${activeRatePerGram.toLocaleString()} UZS` : <span className="text-amber-600">(Kiritilmagan)</span>}
                </label>
                <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono text-slate-700">
                  {hasValidDailyRate ? `${activeRatePerGram.toLocaleString()} UZS/g` : "⚠️ Kurs yo'q"}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="settleUsdRateInput" className="block text-xs font-bold text-[#475569]">
                    USD Kursi {isManualUsdRate ? <span className="text-[10px] text-amber-600 font-normal">(Qo&apos;lda)</span> : <span className="text-[10px] text-cyan-600 font-normal">(MB)</span>}:
                  </label>
                  {cbuUsdRate && (
                    <button
                      type="button"
                      onClick={() => {
                        setSettleUsdRate(String(cbuUsdRate));
                        setIsManualUsdRate(false);
                      }}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      MB: {cbuUsdRate.toLocaleString()}
                    </button>
                  )}
                </div>
                <input
                  id="settleUsdRateInput"
                  type="number"
                  placeholder="Masalan: 12800"
                  value={settleUsdRate}
                  onChange={(e) => {
                    setSettleUsdRate(e.target.value);
                    setIsManualUsdRate(true);
                  }}
                  className="w-full p-2.5 rounded-xl font-mono text-xs font-bold bg-slate-50 border border-slate-300 text-slate-800"
                />
              </div>
            </div>

            {/* Live Calculation Preview */}
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl space-y-2 text-xs">
              <div className="text-[11px] font-bold text-emerald-900 uppercase">
                Kompozit Kalkulyator (Jonli):
              </div>
              {Number(liveSettleCalc.cashEquivalentGrams || 0) > 0 && (
                <div className="flex justify-between text-[#475569]">
                  <span>Naqd UZS lom ekvivalenti:</span>
                  <span className="font-mono font-bold text-emerald-800">
                    +{formatScreenGrams(liveSettleCalc.cashEquivalentGrams, 2)}
                  </span>
                </div>
              )}
              {Number(liveSettleCalc.usdEquivalentGrams || 0) > 0 && (
                <div className="flex justify-between text-[#475569]">
                  <span>Naqd USD lom ekvivalenti:</span>
                  <span className="font-mono font-bold text-blue-800">
                    +{formatScreenGrams(liveSettleCalc.usdEquivalentGrams, 2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold text-[#0F172A] border-t border-emerald-200/80 pt-1">
                <span>Jami To&apos;lanayotgan Lom:</span>
                <span className="font-mono text-sm text-emerald-950">
                  {formatScreenGrams(liveSettleCalc.totalSettledGrams, 2)}
                </span>
              </div>
              <div className="flex justify-between text-[#475569] pt-1 border-t border-emerald-200/50">
                <span>Qoladigan Qarz:</span>
                <span className={`font-mono font-bold ${liveSettleCalc.remainingDebtGrams > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                  {formatScreenGrams(liveSettleCalc.remainingDebtGrams, 2)}
                </span>
              </div>
              {liveSettleCalc.excessGoldGrams > 0 && (
                <div className="flex justify-between font-bold text-blue-700 bg-blue-50/80 p-2 rounded-xl">
                  <span>Ortiqcha Qaytim (Avans saqlanadi):</span>
                  <span className="font-mono">+{formatScreenGrams(liveSettleCalc.excessGoldGrams, 2)}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#475569] mb-1">Izoh (ixtiyoriy):</label>
              <input
                type="text"
                placeholder="To'lov izohi..."
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
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
            <h2 className="text-base font-bold text-[#F8FAFC]">Qarz Daftari (Kim qancha berishi kerak)</h2>
            <span className="text-xs text-rose-600 font-bold">Qarzdorlar: {debtorsList.length} nafar</span>
          </div>

          {debtorsList.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center text-[#475569] space-y-2 text-[#0F172A]">
              <div className="text-3xl">🎉</div>
              <div className="font-bold text-sm text-[#0F172A]">Hozircha faol qarzdorlar yo&apos;q</div>
              <p className="text-xs text-[#475569]">Barcha mijozlar o&apos;z vaqtida hisob-kitob qilgan.</p>
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
                  className="bg-white rounded-3xl p-4 border border-rose-100 shadow-sm space-y-3 hover:border-rose-300 transition text-[#0F172A]"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-[#0F172A] text-sm">{custName}</div>
                      <div className="text-[11px] font-mono text-blue-600 font-bold">{custCode}</div>
                      {relatedCustomer?.phone && (
                        <div className="text-xs text-[#475569]">{relatedCustomer.phone}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-[#475569] block">Qarzi</span>
                      <span className="text-base font-black font-mono text-rose-600">
                        {formatScreenGrams(curDebt, 2)}
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

          {advancesList.length > 0 && (
            <div className="pt-4 space-y-3">
              <div className="flex justify-between items-center px-1">
                <h3 className="text-sm font-bold text-[#F8FAFC]">Mijoz Avanslari (Ortiqcha To&apos;lovlar)</h3>
                <span className="text-xs text-cyan-400 font-bold">{advancesList.length} mijoz</span>
              </div>
              {advancesList.map((acc) => {
                const adv = Number(acc.advance_balance_grams || acc.advance_gold_balance_grams || 0);
                const relatedCustomer = acc.customer || customers.find(c => String(c.id) === String(acc.customer_id));
                const custName = relatedCustomer?.contact_name || "Mijoz";
                const custCode = relatedCustomer?.customer_code || "KODSIZ";

                return (
                  <div
                    key={`adv_${acc.customer_id}`}
                    className="bg-white rounded-3xl p-4 border border-cyan-100 shadow-sm space-y-2 text-[#0F172A]"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-[#0F172A] text-sm">{custName}</div>
                        <div className="text-[11px] font-mono text-cyan-700 font-bold">{custCode}</div>
                        {relatedCustomer?.phone && (
                          <div className="text-xs text-[#475569]">{relatedCustomer.phone}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-cyan-700 font-bold block">Avans Balansi</span>
                        <span className="text-base font-black font-mono text-cyan-600">
                          +{formatScreenGrams(adv, 2)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: REGISTER NEW CUSTOMER */}
      {activeTab === "customer" && (
        <form
          onSubmit={(e) => void handleRegisterCustomer(e)}
          className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-sm text-[#0F172A]"
        >
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Yangi Mijoz Qo&apos;shish</h2>
            <p className="text-xs text-[#475569]">
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
              <label className="block text-xs font-bold text-[#475569] mb-1">Ism Familiya (F.I.O):</label>
              <input
                type="text"
                placeholder="Masalan: Sardor Rustamov"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#475569] mb-1">Telefon Raqami:</label>
              <input
                type="text"
                placeholder="+998 90 123 45 67"
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-[#0F172A]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#475569] mb-1">
                Kompaniya / Pasport yoki PINFL:
              </label>
              <input
                type="text"
                placeholder="Pasport seriya yoki do'kon nomi..."
                value={newCustCompany}
                onChange={(e) => setNewCustCompany(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
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
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-[#0F172A]">
            <h2 className="text-base font-bold text-[#0F172A]">Mening Kassam va Bozor Qarzi (Boshqaruvchi Oldidagi Majburiyat)</h2>

            {/* Signed Bozor Qarzi Card */}
            <div className={`p-4 rounded-2xl border space-y-1 ${
              myBozorQarzi < 0
                ? "bg-rose-50 border-rose-200 text-[#B91C1C]"
                : myBozorQarzi > 0
                ? "bg-emerald-50 border-emerald-200 text-[#047857]"
                : "bg-slate-50 border-slate-200 text-[#0F172A]"
            }`}>
              <div className="flex justify-between items-center text-xs font-bold">
                <span>Bozor Qarzi:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                  myBozorQarzi < 0
                    ? "bg-rose-200 text-rose-800"
                    : myBozorQarzi > 0
                    ? "bg-emerald-200 text-emerald-800"
                    : "bg-slate-200 text-[#0F172A]"
                }`}>
                  {myBozorQarzi < 0
                    ? "Qarzingiz bor (-)"
                    : myBozorQarzi > 0
                    ? "Haqqingiz bor (+)"
                    : "0 qarz"}
                </span>
              </div>
              <div className="text-2xl font-black font-mono">
                {myBozorQarzi < 0
                  ? `-${formatScreenGrams(Math.abs(myBozorQarzi), 2)}`
                  : myBozorQarzi > 0
                  ? `+${formatScreenGrams(myBozorQarzi, 2)}`
                  : formatScreenGrams(0, 2)}
              </div>
              <div className="text-[11px] text-[#475569]">
                {myBozorQarzi < 0
                  ? `Boshqaruvchiga ${formatScreenGrams(Math.abs(myBozorQarzi), 2)} lom qaytarishingiz kerak.`
                  : myBozorQarzi > 0
                  ? `Boshqaruvchi sizga ${formatScreenGrams(myBozorQarzi, 2)} ortiqcha tushum (avans) uchun qarzdor.`
                  : "Barcha hisob-kitoblar to'liq yopilgan."}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200">
                <span className="font-bold text-amber-900 block mb-1">Kassamdagi Lom:</span>
                <span className="font-mono font-black text-amber-950 text-base">
                  {formatScreenGrams(myTillScrap, 2)}
                </span>
              </div>

              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200">
                <span className="font-bold text-emerald-900 block mb-1">Kassamdagi Naqd (UZS):</span>
                <span className="font-mono font-black text-emerald-950 text-base">
                  {formatScreenUZS(myTillCash)}
                </span>
              </div>

              <div className="p-3 bg-blue-50 rounded-2xl border border-blue-200">
                <span className="font-bold text-blue-900 block mb-1">Kassamdagi Naqd (USD):</span>
                <span className="font-mono font-black text-blue-950 text-base">
                  ${Number(myTillAccount?.seller_till_usd_amount || 0).toLocaleString()}
                </span>
              </div>

              <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-200">
                <span className="font-bold text-indigo-900 block mb-1">Fizik Oltin Qoldig&apos;i:</span>
                <span className="font-mono font-black text-indigo-950 text-base">
                  {formatScreenGrams(myTillAccount?.current_physical_stock_g || 0, 4)}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-[#475569] bg-slate-50 p-3 rounded-2xl border">
              ℹ️ Qoida 5: Mijoz to&apos;lagan lom yoki naqd pul sizning kassangizda saqlanadi. Boshqaruvchi sizdan ushbu lom yoki pulni qabul qilib olgandagina bozor qarzingiz kamayadi.
            </div>
          </div>

          {/* Recent Sales History */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3 text-[#0F172A]">
            <h3 className="font-bold text-[#0F172A] text-sm">Oxirgi Savdolarim Tarixi</h3>

            <div className="space-y-2">
              {mySales.map((s) => (
                <div key={s.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-[#0F172A]">{s.customer?.contact_name || "Mijoz"}</div>
                    <div className="text-[10px] text-[#475569] font-mono">{s.sale_no} • {s.sale_date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-[#0F172A]">
                      {formatScreenGrams(s.client_gold_due_grams, 2)}
                    </div>
                    <div className="text-[10px] text-indigo-600 font-semibold">+{s.client_markup_pct}% ustama</div>
                  </div>
                </div>
              ))}
              {mySales.length === 0 && (
                <div className="text-center py-4 text-xs text-[#475569]">
                  Hozircha savdolar tarixi yo&apos;q.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MOBILE BARCODE CAMERA SCANNER MODAL */}
      <MobileBarcodeScannerModal
        isOpen={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onDetected={(code: string) => {
          handleProcessMobileBarcode(code);
          setCameraModalOpen(false);
        }}
      />

      {/* RECEIPT MODAL */}
      <SalesReceiptModal data={receiptData} onClose={() => setReceiptData(null)} />
    </div>
  );
}
