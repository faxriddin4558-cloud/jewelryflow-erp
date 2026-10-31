"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
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
  type JewelrySaleRow,
  type FactoryReceiptRow,
  type ManagerVaultAccountRow,
  type RefiningBatchRow,
  type GoldPurchaseRow,
  type FactoryGoldHandoverRow,
} from "@/lib/erp-engine";
import { SalesReceiptModal, type ReceiptData } from "./SalesReceiptModal";
import { ScannerDiagnostics } from "./ScannerDiagnostics";
import { BarTenderModelManager } from "./BarTenderModelManager";
import { ScannerConsignmentSection } from "./ScannerConsignmentSection";
import { SellerInventoryDashboard } from "./SellerInventoryDashboard";
import { SheetsImportSection } from "./SheetsImportSection";
import { TelegramUsersSection } from "./TelegramUsersSection";
import { SellerReconciliationModal } from "./SellerReconciliationModal";
import {
  formatScreenGrams,
  formatScreenUZS,
  type JewelryModelItem,
} from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { ProfitAccountingBanner } from "./ProfitAccountingBanner";
import { CompanyRateDifferenceCard } from "./CompanyRateDifferenceCard";
import { MarkupDifferenceCard } from "./MarkupDifferenceCard";

export type DirectorSalesTab =
  | "factory"
  | "sellers"
  | "scanner_consign"
  | "seller_stock"
  | "vault"
  | "models"
  | "consign"
  | "presets"
  | "clients"
  | "history"
  | "diagnostics"
  | "sheets_import"
  | "users";

export interface DirectorSalesWorkspaceProps {
  initialTab?: DirectorSalesTab;
  hideTopBanner?: boolean;
  hideTabBar?: boolean;
  factorySection?: "all" | "receive" | "handover";
  vaultSection?: "all" | "cash" | "refining" | "purchases";
}

export function DirectorSalesWorkspace({
  initialTab = "sellers",
  hideTopBanner = false,
  hideTabBar = false,
  factorySection = "all",
  vaultSection = "all",
}: DirectorSalesWorkspaceProps = {}) {
  const [activeTab, setActiveTab] = useState<DirectorSalesTab>(initialTab);
  const [activeFactorySection, setActiveFactorySection] = useState<"all" | "receive" | "handover">(factorySection);
  const [activeVaultSection, setActiveVaultSection] = useState<"all" | "cash" | "refining" | "purchases">(vaultSection);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (factorySection) {
      setActiveFactorySection(factorySection);
    }
  }, [factorySection]);

  useEffect(() => {
    if (vaultSection) {
      setActiveVaultSection(vaultSection);
    }
  }, [vaultSection]);


  // State
  const [loading, setLoading] = useState(true);
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
  const [sales, setSales] = useState<JewelrySaleRow[]>([]);

  // Master Financial Entities
  const [factoryReceipts, setFactoryReceipts] = useState<FactoryReceiptRow[]>([]);
  const [managerVault, setManagerVault] = useState<ManagerVaultAccountRow | null>(null);
  const [refiningBatches, setRefiningBatches] = useState<RefiningBatchRow[]>([]);
  const [goldPurchases, setGoldPurchases] = useState<GoldPurchaseRow[]>([]);
  const [factoryHandovers, setFactoryHandovers] = useState<FactoryGoldHandoverRow[]>([]);

  // Form: Factory Receipt ("Zavod bilan")
  const [rcpProductName, setRcpProductName] = useState("");
  const [rcpWeight, setRcpWeight] = useState("100.0000");
  const [rcpMarkup, setRcpMarkup] = useState("8.00");
  const [rcpNotes, setRcpNotes] = useState("");

  // Form: Refining Batch ("Lom pateriya")
  const [refInputScrap, setRefInputScrap] = useState("");
  const [refInputProba, setRefInputProba] = useState("585");
  const [refMeltedWeight, setRefMeltedWeight] = useState("");
  const [refFineWeight, setRefFineWeight] = useState("");
  const [refFineProba, setRefFineProba] = useState("995");
  const [refNotes, setRefNotes] = useState("");

  // Form: Gold Purchase ("Tovar olish" - Multi-Currency: UZS + USD)
  const [buySupplier, setBuySupplier] = useState("");
  const [buyCashUZS, setBuyCashUZS] = useState("");
  const [buyCashUSD, setBuyCashUSD] = useState("");
  const [buyUsdRate, setBuyUsdRate] = useState("");
  const [activeBaselineUsdRate, setActiveBaselineUsdRate] = useState<number | null>(null);
  const [buyRate, setBuyRate] = useState<string>("");
  const [buyWeight, setBuyWeight] = useState("");
  const [buyProba, setBuyProba] = useState("585");
  const [buyNotes, setBuyNotes] = useState("");

  // Form: Factory Handover ("Zavodga topshirish")
  const [hndSourceType, setHndSourceType] = useState<"refined_gold" | "purchased_gold" | "scrap_gold" | "capital_pure_gold">("refined_gold");
  const [hndWeight, setHndWeight] = useState("");
  const [hndProba, setHndProba] = useState("585");
  const [hndRecipient, setHndRecipient] = useState("Zavod");
  const [hndNotes, setHndNotes] = useState("");
  const [hndCapitalTxId, setHndCapitalTxId] = useState<string>("");
  const [hndRefiningBatchId, setHndRefiningBatchId] = useState<string>("");
  const [hndPurchaseId, setHndPurchaseId] = useState<string>("");
  const [capitalPureTxs, setCapitalPureTxs] = useState<{ id: string; transaction_no: string; physical_weight_grams?: number; gold_proba?: number; equiv_585_grams?: number }[]>([]);

  // Daily rate form
  const [newRateAmount, setNewRateAmount] = useState<string>("");
  const [newRateDate, setNewRateDate] = useState<string>(() => (new Date().toISOString().split("T")[0] as string));
  const [newRateNotes, setNewRateNotes] = useState<string>("");
  const [showRateModal, setShowRateModal] = useState(false);



  // 7-Step Seller Reconciliation Modal
  const [reconModalOpen, setReconModalOpen] = useState(false);
  const [selectedReconSeller, setSelectedReconSeller] = useState<{ id: string; name: string } | null>(null);

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
  const [surrenderUsdAmount, setSurrenderUsdAmount] = useState("0");
  const [surrenderUsdRate, setSurrenderUsdRate] = useState("");
  const [cbuUsdRate, setCbuUsdRate] = useState<number | null>(null);
  const [surrenderNotes, setSurrenderNotes] = useState("");
  // Safe Reversals Modal state
  const [reversalTarget, setReversalTarget] = useState<{
    type: "factory_receipt" | "consignment" | "settlement" | "refining_batch" | "factory_gold_handover" | "gold_purchase" | "financial_transaction";
    id: string;
    docNo: string;
    title: string;
    details: string;
    direction?: string;
  } | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalBusy, setReversalBusy] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Notification helper
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

  // Load all director data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        ratesRes,
        presetsRes,
        consignRes,
        sellerAccRes,
        clientAccRes,
        settleRes,
        salesRes,
        empRes,
        prodRes,
        custRes,
        modelsRes,
        piecesRes,
        receiptsRes,
        vaultRes,
        refiningRes,
        purchasesRes,
        handoversRes,
        capTxsRes,
        baselineRes,
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
        supabase.from("consignment_pieces").select("*, consignment:seller_consignments(id, consignment_no, seller_markup_pct, factory_markup_pct)").order("created_at", { ascending: false }),
        supabase.from("factory_receipts").select("*").order("receipt_date", { ascending: false }),
        supabase.from("manager_vault_account").select("*").maybeSingle(),
        supabase.from("refining_batches").select("*").order("batch_date", { ascending: false }),
        supabase.from("gold_purchases").select("*").order("purchase_date", { ascending: false }),
        supabase.from("factory_gold_handovers").select("*").order("handover_date", { ascending: false }),
        supabase.from("financial_transactions").select("id, transaction_no, physical_weight_grams, gold_proba, equiv_585_grams").eq("transaction_type", "capital_contribution").in("source_till", ["manager_fine_gold", "fine_gold"]).neq("status", "reversed").order("created_at", { ascending: false }),
        supabase.from("accounting_baselines").select("usd_rate").eq("status", "active").order("baseline_date", { ascending: false }).limit(1).maybeSingle(),
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
      if (salesRes.data) setSales(salesRes.data as unknown as JewelrySaleRow[]);
      if (custRes.data) setCustomers(custRes.data as unknown as { id: string; contact_name: string; customer_code?: string; phone?: string }[]);
      if (modelsRes.data) setModels(modelsRes.data as JewelryModelItem[]);
      if (piecesRes.data) setPieces(piecesRes.data as ConsignmentPieceRow[]);
      if (receiptsRes.data) setFactoryReceipts(receiptsRes.data as FactoryReceiptRow[]);
      if (vaultRes.data) setManagerVault(vaultRes.data as ManagerVaultAccountRow);
      if (refiningRes.data) setRefiningBatches(refiningRes.data as RefiningBatchRow[]);
      if (purchasesRes.data) setGoldPurchases(purchasesRes.data as GoldPurchaseRow[]);
      if (handoversRes.data) setFactoryHandovers(handoversRes.data as FactoryGoldHandoverRow[]);
      if (capTxsRes.data) setCapitalPureTxs(capTxsRes.data as { id: string; transaction_no: string; physical_weight_grams?: number; gold_proba?: number; equiv_585_grams?: number }[]);
      if (baselineRes?.data && "usd_rate" in baselineRes.data && baselineRes.data.usd_rate) {
        const bRate = Number(baselineRes.data.usd_rate);
        setActiveBaselineUsdRate(bRate);
        setBuyUsdRate((prev) => (!prev || prev === "12800" ? String(bRate) : prev));
      }
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
      notifyError(`Ma'lumotlarni yuklashda xatolik: ${parseErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, [consignProductId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);



  const handleExecuteReversal = async () => {
    if (!reversalTarget || !reversalReason.trim()) {
      setReversalError("Iltimos, bekor qilish sababini batafsil kiriting.");
      return;
    }
    setReversalBusy(true);
    setReversalError(null);
    try {
      if (reversalTarget.type === "factory_receipt") {
        const { error } = await supabase.rpc("rpc_reverse_factory_receipt", {
          p_receipt_id: reversalTarget.id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
        notifySuccess(`Zavod kvitansiyasi (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
      } else if (reversalTarget.type === "consignment") {
        const { error } = await supabase.rpc("rpc_reverse_barcode_consignment", {
          p_consignment_id: reversalTarget.id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
        notifySuccess(`Konsignatsiya (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
      } else if (reversalTarget.type === "settlement") {
        if (reversalTarget.direction === "client_to_seller") {
          const { error } = await supabase.rpc("rpc_reverse_client_settlement", {
            p_settlement_id: reversalTarget.id,
            p_reason: reversalReason.trim(),
          });
          if (error) throw error;
          notifySuccess(`Mijoz to'lovi (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
        } else {
          const { error } = await supabase.rpc("rpc_reverse_seller_to_manager_settlement", {
            p_settlement_id: reversalTarget.id,
            p_reason: reversalReason.trim(),
          });
          if (error) throw error;
          notifySuccess(`Topshirish hisoboti (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
        }
      } else if (reversalTarget.type === "refining_batch") {
        const { error } = await supabase.rpc("rpc_reverse_refining_batch", {
          p_batch_id: reversalTarget.id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
        notifySuccess(`Afinaj partiyasi (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
      } else if (reversalTarget.type === "factory_gold_handover") {
        const { error } = await supabase.rpc("rpc_reverse_factory_gold_handover", {
          p_handover_id: reversalTarget.id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
        notifySuccess(`Zavodga topshirilgan oltin (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
      } else if (reversalTarget.type === "gold_purchase") {
        const { error } = await supabase.rpc("rpc_reverse_gold_purchase", {
          p_purchase_id: reversalTarget.id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
        notifySuccess(`Oltin xaridi (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
      } else if (reversalTarget.type === "financial_transaction") {
        const { error } = await supabase.rpc("rpc_reverse_financial_transaction", {
          p_transaction_id: reversalTarget.id,
          p_reason: reversalReason.trim(),
        });
        if (error) throw error;
        notifySuccess(`Moliyaviy operatsiya (${reversalTarget.docNo}) muvaffaqiyatli bekor qilindi.`);
      }
      setReversalTarget(null);
      setReversalReason("");
      setReversalError(null);
      await loadData();
    } catch (err: unknown) {
      setReversalError(parseErrorMessage(err, "Bekor qilishda server xatoligi yuz berdi"));
    } finally {
      setReversalBusy(false);
    }
  };

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

      // The audited RPC is the only write path for rates; never fall back to a direct table write.
      if (error) throw error;
      notifySuccess(`Kunlik lom kursi muvaffaqiyatli saqlandi: ${rateNum.toLocaleString()} UZS/g`);
      setShowRateModal(false);
      setNewRateNotes("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Lom kursini saqlashda xatolik: ${parseErrorMessage(err)}`);
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
      notifyError(`Ustama foizini saqlashda xatolik: ${parseErrorMessage(err)}`);
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
      notifyError(`Ustama holatini o'zgartirishda xatolik: ${parseErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 2B. Factory Receipt Action ("Zavod bilan")
  const handleCreateFactoryReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = parseFloat(rcpWeight);
    const m = parseFloat(rcpMarkup) || 0;
    if (isNaN(w) || w <= 0) {
      notifyError("Iltimos, mahsulotning to'g'ri fizik vaznini kiriting!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("rcp");
      const { data, error } = await supabase.rpc("rpc_record_factory_receipt", {
        p_product_name: rcpProductName.trim() || "Zargarlik buyumi",
        p_quantity: 1,
        p_original_physical_g: w,
        p_proba: 585,
        p_factory_markup_pct: m,
        p_product_id: null,
        p_model_id: null,
        p_notes: rcpNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      notifySuccess(`Zavoddan tovar qabul qilindi: ${w}g @ ${m}% = ${data.factory_obligation_g}g zavod majburiyati`);
      setRcpProductName("");
      setRcpNotes("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Zavod tovarini qabul qilishda xatolik: ${parseErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 2C. Refining Batch Action ("Lom pateriya")
  const handleCreateRefiningBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const inW = parseFloat(refInputScrap);
    const meltW = parseFloat(refMeltedWeight);
    const fineW = parseFloat(refFineWeight);
    const fineP = parseFloat(refFineProba) || 995;

    if (isNaN(inW) || inW <= 0 || isNaN(meltW) || meltW <= 0 || isNaN(fineW) || fineW <= 0) {
      notifyError("Iltimos, afinajning barcha vazn parametrlarini to'g'ri kiriting!");
      return;
    }

    setBusy(true);
    try {
      const inProba = parseFloat(refInputProba) || 585;
      const idempotencyKey = generateIdempotencyKey("ref");
      const { data, error } = await supabase.rpc("rpc_record_refining_batch", {
        p_input_scrap_grams: inW,
        p_melted_weight_grams: meltW,
        p_output_fine_grams: fineW,
        p_output_fine_proba: fineP,
        p_notes: refNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
        p_physical_scrap_grams: inW,
        p_input_scrap_proba: inProba,
      });

      if (error) throw error;
      notifySuccess(`Afinaj yakunlandi: 585 ekvivalenti = ${data.output_585_equiv_grams}g, Yo'qotish (pateriya) = ${data.total_loss_grams}g (${data.loss_pct}%) [Boshqaruvchi hisobiga yozildi]`);
      setRefInputScrap("");
      setRefMeltedWeight("");
      setRefFineWeight("");
      setRefNotes("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Afinaj partiyasini saqlashda xatolik: ${parseErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 2D. Gold Purchase Action ("Tovar olish" - Multi-Currency: UZS + USD)
  const handleCreateGoldPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const spentUZS = parseFloat(buyCashUZS) || 0;
    const spentUSD = parseFloat(buyCashUSD) || 0;
    const usdRate = parseFloat(buyUsdRate) || activeBaselineUsdRate || 0;
    const goldW = parseFloat(buyWeight) || 0;
    const pr = parseFloat(buyProba) || 585;
    const customRate = parseFloat(buyRate) || 0;

    if (spentUZS <= 0 && spentUSD <= 0) {
      notifyError("Kamida bitta to'lov valyutasi (UZS yoki USD) kiritilishi shart!");
      return;
    }

    if (spentUSD > 0 && (!usdRate || usdRate <= 0)) {
      notifyError("USD yoki MIXED xarid uchun musbat USD/UZS kursi kiritilishi majburiy!");
      return;
    }

    if (goldW <= 0) {
      notifyError("Iltimos, olingan oltin vaznini to'g'ri kiriting!");
      return;
    }

    if (spentUZS > 0 && Number(managerVault?.manager_cash_amount || 0) < spentUZS) {
      notifyError(`Boshqaruvchi seyfida yetarli naqd pul (UZS) mavjud emas (Mavjud: ${Number(managerVault?.manager_cash_amount || 0).toLocaleString()} UZS, Talab: ${spentUZS.toLocaleString()} UZS)`);
      return;
    }

    if (spentUSD > 0 && Number(managerVault?.manager_usd_amount || 0) < spentUSD) {
      notifyError(`Boshqaruvchi seyfida yetarli USD mavjud emas (Mavjud: $${Number(managerVault?.manager_usd_amount || 0).toLocaleString()}, Talab: $${spentUSD.toLocaleString()})`);
      return;
    }

    const totalCostUZS = spentUZS + (spentUSD * usdRate);
    const finalRate = customRate > 0 ? customRate : (totalCostUZS / goldW);
    const currency = spentUZS > 0 && spentUSD > 0 ? "MIXED" : (spentUSD > 0 ? "USD" : "UZS");

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("buy");
      const { data, error } = await supabase.rpc("rpc_record_gold_purchase", {
        p_supplier_name: buySupplier.trim() || "Bozor",
        p_cash_spent_uzs: spentUZS,
        p_rate_per_gram: finalRate,
        p_gold_weight_grams: goldW,
        p_proba: pr,
        p_notes: buyNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
        p_currency: currency,
        p_usd_spent: spentUSD,
        p_usd_rate: spentUSD > 0 ? usdRate : null,
      });

      if (error) throw error;
      const spentSummary = spentUZS > 0 && spentUSD > 0
        ? `${spentUZS.toLocaleString()} UZS + $${spentUSD.toLocaleString()} USD`
        : (spentUSD > 0 ? `$${spentUSD.toLocaleString()} USD` : `${spentUZS.toLocaleString()} UZS`);

      notifySuccess(`Oltin xarid qilindi: ${goldW}g (${data?.equiv_585_grams || ""}g 585 eq) — ${spentSummary} sarflandi`);
      setBuySupplier("");
      setBuyCashUZS("");
      setBuyCashUSD("");
      setBuyRate("");
      setBuyWeight("");
      setBuyNotes("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Oltin xaridini qayd etishda xatolik: ${parseErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 2E. Factory Gold Handover Action ("Zavodga topshirish")
  const handleCreateFactoryHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = parseFloat(hndWeight);
    const pr = parseFloat(hndProba) || 585;

    if (isNaN(w) || w <= 0) {
      notifyError("Iltimos, zavodga topshirilayotgan oltin vaznini kiriting!");
      return;
    }

    const agreedEq = Number((w * (pr / 585.0)).toFixed(4));

    if (hndSourceType === "purchased_gold") {
      const availPurch = Number(managerVault?.manager_purchased_gold_grams || 0);
      if (availPurch < agreedEq) {
        notifyError(`Boshqaruvchi seyfida yetarli xarid qilingan oltin yo'q (Mavjud: ${availPurch}g, Talab: ${agreedEq}g)`);
        return;
      }
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("hnd");
      const { data, error } = await supabase.rpc("rpc_record_factory_gold_handover", {
        p_source_type: hndSourceType,
        p_physical_weight_g: w,
        p_proba: pr,
        p_agreed_equivalent_g: agreedEq,
        p_factory_recipient: hndRecipient.trim() || "Zavod",
        p_notes: hndNotes.trim() || null,
        p_idempotency_key: idempotencyKey,
        p_capital_tx_id: hndSourceType === "capital_pure_gold" && hndCapitalTxId ? hndCapitalTxId : null,
        p_refining_batch_id: hndSourceType === "refined_gold" && hndRefiningBatchId ? hndRefiningBatchId : null,
        p_purchase_id: hndSourceType === "purchased_gold" && hndPurchaseId ? hndPurchaseId : null,
      });

      if (error) throw error;
      if (Number(data?.current_factory_advance_g || 0) > 0) {
        notifySuccess(`Zavodga oltin topshirildi: ${w}g (${agreedEq}g 585 eq). Zavod qarzi to'liq yopildi! Zavoddagi avansimiz: ${data.current_factory_advance_g}g 585 eq.`);
      } else {
        notifySuccess(`Zavodga oltin topshirildi: ${w}g (${agreedEq}g 585 eq). Zavod qarzi ${data?.current_factory_obligation_g || 0}g ga tushirildi!`);
      }
      setHndWeight("");
      setHndNotes("");
      setHndCapitalTxId("");
      setHndRefiningBatchId("");
      setHndPurchaseId("");
      await loadData();
    } catch (err: unknown) {
      notifyError(`Zavodga topshirishda xatolik: ${parseErrorMessage(err)}`);
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
      notifyError(`Konsignatsiya topshirishda xatolik: ${parseErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 4. Seller Surrender / Handover Action (Accept from Seller Till into Factory)
  const handleOpenSurrender = (acc: SellerGoldAccountRow) => {
    setSurrenderSeller(acc);
    setSurrenderScrapWeight(String(acc.seller_till_scrap_grams || 0));
    setSurrenderCashAmount(String(acc.seller_till_cash_amount || 0));
    setSurrenderUsdAmount(String(acc.seller_till_usd_amount || 0));
    setSurrenderNotes("");
    setSurrenderModalOpen(true);
    fetch("/api/sales/currency/cbu")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data?.rate) {
          setCbuUsdRate(json.data.rate);
          if (!surrenderUsdRate) setSurrenderUsdRate(String(json.data.rate));
        }
      })
      .catch(() => {});
  };

  const handleConfirmSurrender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surrenderSeller) return;

    const scrapW = parseFloat(surrenderScrapWeight) || 0;
    const cash = parseFloat(surrenderCashAmount) || 0;
    const usd = parseFloat(surrenderUsdAmount) || 0;
    const usdRate = parseFloat(surrenderUsdRate) || 0;

    if (scrapW <= 0 && cash <= 0 && usd <= 0) {
      notifyError("Iltimos, topshirilayotgan lom vazni, naqd UZS yoki naqd USD summasini kiriting!");
      return;
    }

    if ((cash > 0 || usd > 0) && (!dailyRate || !dailyRate.rate_per_gram || Number(dailyRate.rate_per_gram) <= 0)) {
      notifyError("⚠️ Bugungi 585 oltin kursi belgilanmagan! Naqd pul yoki valyuta topshirish uchun avval kunlik kursni kiriting.");
      return;
    }

    if (usd > 0 && (!usdRate || usdRate <= 0)) {
      notifyError("USD topshirish uchun USD kursi kiritilishi shart!");
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("surr");
      const { data, error } = await supabase.rpc("rpc_record_seller_to_manager_settlement", {
        p_seller_id: surrenderSeller.seller_id,
        p_scrap_weight_grams: scrapW,
        p_cash_paid_amount: cash,
        p_usd_paid_amount: usd,
        p_usd_rate: usd > 0 ? usdRate : null,
        p_rate_per_gram: (cash > 0 || usd > 0) ? (dailyRate?.rate_per_gram || null) : null,
        p_notes: surrenderNotes.trim() || "Sotuvchi kassasidan boshqaruvchiga qabul qilingan tushum",
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      const rate = Number(data?.applied_rate_per_gram || dailyRate?.rate_per_gram || 0);
      const calc = GoldEngine.calculateGoldSettlement(
        surrenderSeller.current_factory_obligation_grams || surrenderSeller.remaining_factory_gold_due_grams || 0,
        scrapW,
        cash,
        rate,
        usd,
        usdRate
      );

      setReceiptData({
        title: "Boshqaruvchiga Tushum Qabul Qilish Kvitansiyasi",
        receiptNo: data.settlement_no || "SURR-NEW",
        date: new Date().toLocaleDateString("uz-UZ"),
        sellerName: surrenderSeller.seller?.name || surrenderSeller.seller?.full_name || "Sotuvchi",
        scrapWeightGrams: scrapW,
        scrapPurity: 585,
        cashAmount: cash,
        goldRateApplied: rate,
        cashEquivalentGrams: calc.cashEquivalentGrams,
        usdAmount: usd,
        usdRateApplied: usd > 0 ? usdRate : undefined,
        usdEquivalentGrams: calc.usdEquivalentGrams,
        totalSettledGrams: calc.totalSettledGrams,
        previousDebtGrams: calc.previousDebtGrams,
        remainingDebtGrams: calc.remainingDebtGrams,
        advanceGoldGrams: calc.excessGoldGrams,
        notes: surrenderNotes || "Sotuvchi kassasidan lom va naqd pul boshqaruvchiga qabul qilindi",
      });

      notifySuccess(`№${data.settlement_no} tushum boshqaruvchiga qabul qilindi va sotuvchi majburiyati kamaytirildi!`);
      setSurrenderModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      notifyError(err, "Tushumni qabul qilishda xatolik");
    } finally {
      setBusy(false);
    }
  };

  // 5. High-Throughput Scanner 564 Consignment Action
  const handleConfirmBarcodeConsignment = async (payload: {
    sellerId: string;
    factoryMarkupPct: number;
    factoryReceiptId?: string;
    sellerMarkupPct?: number;
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
        p_seller_markup_pct: payload.sellerMarkupPct || 12.0,
        p_pieces: payload.pieces,
        p_notes: payload.notes || null,
        p_idempotency_key: idempotencyKey,
        p_factory_receipt_id: payload.factoryReceiptId || null,
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
      notifyError(`Konsignatsiyani topshirishda xatolik: ${parseErrorMessage(err)}`);
      throw err; // Rethrow so ScannerConsignmentSection preserves scanner draft!
    } finally {
      setBusy(false);
    }
  };

  // 6. BarTender Model Creation Action
  const handleAddNewModel = async (modelData: {
    model_code?: string;
    name: string;
    category: string;
    decorations?: string;
    reference_weight_grams?: number;
    gold_purity?: number;
    primary_image_url?: string;
  }): Promise<JewelryModelItem> => {
    setBusy(true);
    try {
      // 1. Call server-side atomic sequence RPC
      const { data, error } = await supabase.rpc("rpc_create_jewelry_model", {
        p_name: modelData.name,
        p_category: modelData.category || "Серьги",
        p_decorations: modelData.decorations || null,
        p_reference_weight_grams: modelData.reference_weight_grams || null,
        p_purity: String(modelData.gold_purity || 585),
        p_model_code: modelData.model_code || null,
        p_primary_image_url: modelData.primary_image_url || null,
      });

      if (error) {
        // Fallback: direct insert if RPC not present in older schemas
        const code = modelData.model_code || `JF-M-${String(models.length + 1).padStart(4, "0")}`;
        const { data: insData, error: insErr } = await supabase.from("jewelry_models").insert([
          {
            model_code: code,
            name: modelData.name,
            category: modelData.category || "Серьги",
            decorations: modelData.decorations,
            reference_weight_grams: modelData.reference_weight_grams,
            gold_purity: String(modelData.gold_purity || 585),
            proba: modelData.gold_purity || 585,
            primary_image_url: modelData.primary_image_url || null,
            is_active: true,
          },
        ]).select().single();

        if (insErr) throw insErr;
        const fallbackItem = insData as unknown as JewelryModelItem;
        notifySuccess(`Yangi model muvaffaqiyatli saqlandi: ${fallbackItem.name} (${fallbackItem.model_code})`);
        await loadData();
        return fallbackItem;
      }

      const created = (typeof data === "string" ? JSON.parse(data) : data) as JewelryModelItem;
      notifySuccess(`Yangi model muvaffaqiyatli saqlandi: ${created.name} (${created.model_code})`);
      await loadData();
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError(`Model qo'shishda xatolik: ${msg}`);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateModelPhoto = async (modelId: string, photoUrl: string): Promise<void> => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_update_jewelry_model_photo", {
        p_model_id: modelId,
        p_primary_image_url: photoUrl,
      });
      if (error) {
        // Fallback direct update
        const { error: updErr } = await supabase
          .from("jewelry_models")
          .update({ primary_image_url: photoUrl })
          .eq("id", modelId);
        if (updErr) throw updErr;
      }
      notifySuccess("Model rasmi muvaffaqiyatli saqlandi!");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError(`Rasm saqlashda xatolik: ${msg}`);
      throw err;
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

  // Authoritative physical inventory and today's sales
  const todayStr: string = new Date().toISOString().split("T")[0] || "";
  const availableSellerPieces = pieces.filter(p => p.status === "held_by_seller");
  const totalSellerPhysicalGrams = availableSellerPieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);
  const todaySalesList = sales.filter(s => (s.sale_date === todayStr || Boolean(s.created_at?.startsWith(todayStr))) && s.status !== "reversed");
  const todaySalesCount = todaySalesList.length;
  const todaySalesGrams = todaySalesList.reduce((acc, s) => acc + Number(s.base_weight_grams || 0), 0);

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
      {!hideTopBanner && (
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
                  {dailyRate && Number(dailyRate.rate_per_gram) > 0 ? (
                    <>
                      {Number(dailyRate.rate_per_gram).toLocaleString()} UZS
                      <span className="text-xs font-semibold text-slate-200"> / gramm</span>
                    </>
                  ) : (
                    <span className="text-amber-400 font-bold text-base">Kurs belgilanmagan</span>
                  )}
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

          {/* Real-time Summary Cards (Priority 5: Authoritative minimal overview) */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5 pt-5">
            <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="text-slate-200 text-xs font-bold">Sotuvchilardagi Fizik Oltin</div>
              <div className="text-xl font-black font-mono text-cyan-300 mt-1">
                {formatScreenGrams(totalSellerPhysicalGrams)}
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-medium font-mono">585 proba ekvivalenti</div>
            </div>

            <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="text-slate-200 text-xs font-bold">Sotuvchilardagi Zavod Qarzi</div>
              <div className="text-xl font-black font-mono text-amber-300 mt-1">
                {formatScreenGrams(totalFactoryObligation)}
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-medium">Sotuvchilar qaytarishi shart bo&apos;lgan oltin</div>
            </div>

            <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="text-slate-200 text-xs font-bold">Mijozlarning Jami Qarzi</div>
              <div className="text-xl font-black font-mono text-rose-400 mt-1">
                {formatScreenGrams(totalClientDebtGrams)}
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-medium">Barcha sotuvchilar bo&apos;yicha mijozlar qarzi</div>
            </div>

            <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="text-slate-200 text-xs font-bold">Sotuvchilar Kassasidagi Lom</div>
              <div className="text-xl font-black font-mono text-amber-400 mt-1">
                {formatScreenGrams(totalSellerTillScrap)}
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-medium">Mijozdan olingan, zavodga berilmagan</div>
            </div>

            <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="text-slate-200 text-xs font-bold">Sotuvchilar Kassasidagi Naqd Pul</div>
              <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                {totalSellerTillCash.toLocaleString()} <span className="text-xs font-bold text-slate-100">UZS</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-medium">Sotuvchining shaxsiy kassasida yig&apos;ilgan</div>
            </div>

            <div className="bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="text-slate-200 text-xs font-bold">Bugungi Savdolar</div>
              <div className="text-xl font-black font-mono text-indigo-300 mt-1">
                {formatScreenGrams(todaySalesGrams)}
              </div>
              <div className="text-[11px] text-slate-300 mt-1 font-medium font-mono">{todaySalesCount} ta savdo bitimi</div>
            </div>
          </div>

          {/* Automated Management Accounting Card: Davr hisobiy foyda / zarar — 585 g */}
          <div className="mt-5">
            <ProfitAccountingBanner onDataMutated={loadData} canManageAccounting={true} />
          </div>
          <div className="mt-3">
            <CompanyRateDifferenceCard />
          </div>
          <div className="mt-3">
            <MarkupDifferenceCard showBySeller />
          </div>
        </div>
      )}

      {/* Main Tabs Navigation */}
      {!hideTabBar && (
        <div className="flex border-b border-slate-200 overflow-x-auto gap-2 text-sm font-bold text-slate-600">
          <button
            onClick={() => setActiveTab("factory")}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
              activeTab === "factory"
                ? "border-amber-600 text-amber-600 font-black"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <span>🏭</span> Zavod Bilan
          </button>
          <button
            onClick={() => setActiveTab("sellers")}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
              activeTab === "sellers"
                ? "border-blue-600 text-blue-600 font-black"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <span>👥</span> Sotuvchilar Balansi & Bozor Qarzi
          </button>
          <button
            onClick={() => setActiveTab("vault")}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
              activeTab === "vault"
                ? "border-emerald-600 text-emerald-600 font-black"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <span>💰</span> Kassa & Afinaj
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
            <span>📊</span> Sotuvchilar Ombori (Mahsulotlar)
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
            <span>📑</span> Tushumlar & Tarix
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
              activeTab === "users"
                ? "border-indigo-600 text-indigo-600 font-bold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <span>👤</span> Xodimlar & Telegram
          </button>
          <button
            onClick={() => setActiveTab("sheets_import")}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
              activeTab === "sheets_import"
                ? "border-emerald-600 text-emerald-600 font-bold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <span>📥</span> Sheets Import
          </button>
          <button
            onClick={() => setActiveTab("diagnostics")}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 whitespace-nowrap transition ${
              activeTab === "diagnostics"
                ? "border-amber-600 text-amber-600 font-bold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <span>🔍</span> Diagnostika
          </button>
        </div>
      )}


      {/* TAB 0: FACTORY ACCOUNTING ("Zavod Bilan") */}
      {activeTab === "factory" && (
        <div className="space-y-6">
          {/* Header & Metrics */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-black text-[#F8FAFC]">Zavod Bilan Hisob-Kitob (1-Zanjir)</h2>
              <p className="text-xs text-[#CBD5E1]">
                Sheets &quot;Zavod bilan&quot; varaqasi pariteti: Zavoddan tovar qabul qilish va zavodga oltin topshirish. Faqat zavodga topshirilgan oltin zavod qarzini kamaytiradi.
              </p>
            </div>
            <button
              onClick={() => void loadData()}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[#F8FAFC] border border-slate-700 text-xs font-semibold rounded-xl transition"
            >
              🔄 Yangilash
            </button>
          </div>

          {/* Metric Cards */}
          {(() => {
            const activeReceipts = factoryReceipts.filter((r) => r.status !== "reversed");
            const activeHandovers = factoryHandovers.filter((h) => h.status !== "reversed");
            const totalRcpObligation = activeReceipts.reduce((sum, r) => sum + Number(r.factory_obligation_g || 0), 0);
            const totalHndPaid = activeHandovers.reduce((sum, h) => sum + Number(h.agreed_equivalent_g || 0), 0);
            const netFactoryDebt = Math.max(0, totalRcpObligation - totalHndPaid);
            const factoryAdvance = Math.max(0, Number(managerVault?.current_factory_advance_g || 0), totalHndPaid - totalRcpObligation);
            const mgrAvailStock = activeReceipts.reduce((sum, r) => sum + Number(r.available_physical_g || 0), 0);

            return (
              <div className={`grid grid-cols-1 ${factoryAdvance > 0 ? "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-5"} gap-4`}>
                <div className="bg-slate-900 text-white p-4 rounded-3xl border border-slate-800 shadow-sm">
                  <div className="text-xs font-bold text-[#CBD5E1]">Jami Qabul Qilingan Tovar</div>
                  <div className="text-2xl font-black font-mono text-cyan-300 mt-1">
                    {formatScreenGrams(activeReceipts.reduce((sum, r) => sum + Number(r.original_physical_g || 0), 0))} <span className="text-xs font-normal">fizik</span>
                  </div>
                  <div className="text-[11px] text-[#CBD5E1] mt-1">
                    {activeReceipts.length} ta kvitansiya {factoryReceipts.length > activeReceipts.length ? `(${factoryReceipts.length - activeReceipts.length} bekor qilingan)` : ""}
                  </div>
                </div>

                <div className="bg-blue-950 text-white p-4 rounded-3xl border border-blue-800 shadow-sm">
                  <div className="text-xs font-bold text-blue-200">Menejer Omboridagi Mavjud Tovar</div>
                  <div className="text-2xl font-black font-mono text-blue-400 mt-1">
                    {formatScreenGrams(mgrAvailStock)} <span className="text-xs font-normal">fizik</span>
                  </div>
                  <div className="text-[11px] text-blue-200 mt-1">Sotuvchilarga tarqatish uchun tayyor</div>
                </div>

                <div className="bg-amber-950 text-white p-4 rounded-3xl border border-amber-800 shadow-sm">
                  <div className="text-xs font-bold text-amber-200">Zavod Oldidagi Majburiyat</div>
                  <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                    {formatScreenGrams(totalRcpObligation)} <span className="text-xs font-normal">585</span>
                  </div>
                  <div className="text-[11px] text-amber-200 mt-1">Ustama foizlari bilan hisoblangan</div>
                </div>

                <div className="bg-emerald-950 text-white p-4 rounded-3xl border border-emerald-800 shadow-sm">
                  <div className="text-xs font-bold text-emerald-200">Zavodga Qaytarilgan Oltin</div>
                  <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
                    {formatScreenGrams(totalHndPaid)} <span className="text-xs font-normal">585 eq</span>
                  </div>
                  <div className="text-[11px] text-emerald-200 mt-1">
                    {activeHandovers.length} ta topshirish hujjati {factoryHandovers.length > activeHandovers.length ? `(${factoryHandovers.length - activeHandovers.length} bekor qilingan)` : ""}
                  </div>
                </div>

                <div className="bg-rose-950 text-white p-4 rounded-3xl border border-rose-800 shadow-sm">
                  <div className="text-xs font-bold text-rose-200">Hozirgi Sof Zavod Qarzi</div>
                  <div className="text-2xl font-black font-mono text-rose-400 mt-1">
                    {formatScreenGrams(netFactoryDebt)} <span className="text-xs font-normal">585</span>
                  </div>
                  <div className="text-[11px] text-rose-200 mt-1">
                    {netFactoryDebt === 0 ? "Qarz yo'q (to'liq yopilgan)" : "Zavod oldidagi toza qoldiq qarz"}
                  </div>
                </div>

                {factoryAdvance > 0 && (
                  <div className="bg-teal-950 text-white p-4 rounded-3xl border border-teal-700 shadow-sm">
                    <div className="text-xs font-bold text-teal-200">🏆 Zavoddagi Avansimiz (Haqdorlik)</div>
                    <div className="text-2xl font-black font-mono text-teal-300 mt-1">
                      {formatScreenGrams(factoryAdvance)} <span className="text-xs font-normal">585 eq</span>
                    </div>
                    <div className="text-[11px] text-teal-200 mt-1">Bizning aktivimiz; keyingi kirimda yopiladi</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Subview Segmented Control for Factory Accounting */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl w-fit text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveFactorySection("all")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeFactorySection === "all"
                  ? "bg-slate-800 text-[#F8FAFC] shadow-sm border border-slate-700"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              📋 Barchasi (Kirim & Chiqim)
            </button>
            <button
              type="button"
              onClick={() => setActiveFactorySection("receive")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeFactorySection === "receive"
                  ? "bg-amber-600 text-white shadow-sm"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              📥 Faqat Zavoddan Qabul (Kirim)
            </button>
            <button
              type="button"
              onClick={() => setActiveFactorySection("handover")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeFactorySection === "handover"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              🚚 Faqat Zavodga Topshirish (Chiqim)
            </button>
          </div>

          <div className={activeFactorySection === "all" ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : "max-w-2xl"}>
            {/* Form: Zavoddan Tovar Qabul Qilish */}
            {(activeFactorySection === "all" || activeFactorySection === "receive") && (
              <form
                onSubmit={(e) => void handleCreateFactoryReceipt(e)}
                className="bg-white text-[#0F172A] p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
              >
                <div className="border-b pb-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                    Varaqa: &quot;Zavod bilan&quot; Kirim
                  </span>
                  <h3 className="text-lg font-black text-[#0F172A] mt-2">Zavoddan Tovar Qabul Qilish</h3>
                  <p className="text-xs text-[#475569]">
                    Zavoddan kelgan partiyani fizik vazni va zavod ustama foizi bilan qabul qilish.
                  </p>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-xs font-bold text-[#475569] mb-1">Mahsulot Nomi / Partiya Tavsifi:</label>
                    <input
                      type="text"
                      placeholder="Masalan: Malika sirg'a partiyasi, zanjir..."
                      value={rcpProductName}
                      onChange={(e) => setRcpProductName(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A] placeholder:text-[#475569]"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Fizik Vazn (g):</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        value={rcpWeight}
                        onChange={(e) => setRcpWeight(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Proba (Ombor standarti):</label>
                      <div className="w-full p-2.5 bg-slate-100 border border-slate-300 rounded-xl font-mono text-xs font-bold text-[#0F172A] flex items-center justify-between">
                        <span>585 (Standart)</span>
                        <span className="text-[10px] text-slate-500 font-sans font-medium">Faqat 585</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Zavod Foizi (%):</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={rcpMarkup}
                        onChange={(e) => setRcpMarkup(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-amber-700"
                        required
                      />
                    </div>
                  </div>

                  {/* Live Preview */}
                  <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200 text-xs space-y-1 font-mono text-[#0F172A]">
                    <div className="flex justify-between text-[#475569]">
                      <span>Fizik vazn:</span>
                      <span className="font-bold text-[#0F172A]">{formatScreenGrams(parseFloat(rcpWeight) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-[#475569]">
                      <span>Zavod ustamasi ({parseFloat(rcpMarkup) || 0}%):</span>
                      <span className="font-bold text-amber-800">{formatScreenGrams((parseFloat(rcpWeight) || 0) * ((parseFloat(rcpMarkup) || 0) / 100))}</span>
                    </div>
                    <div className="flex justify-between text-[#0F172A] font-black border-t border-amber-300 pt-1 text-sm">
                      <span>Zavod Majburiyati:</span>
                      <span className="text-amber-900">{formatScreenGrams((parseFloat(rcpWeight) || 0) * (1 + (parseFloat(rcpMarkup) || 0) / 100))}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#475569] mb-1">Izoh / Nakladnoy №:</label>
                    <input
                      type="text"
                      placeholder="Zavod nakladnoyi, sana yoki eslatma..."
                      value={rcpNotes}
                      onChange={(e) => setRcpNotes(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A] placeholder:text-[#475569]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-md transition"
                >
                  {busy ? "Saqlanmoqda..." : "📥 Zavoddan Tovar Qabul Qilish"}
                </button>
              </form>
            )}

            {/* Form: Zavodga Oltin Topshirish */}
            {(activeFactorySection === "all" || activeFactorySection === "handover") && (
              <form
                onSubmit={(e) => void handleCreateFactoryHandover(e)}
                className="bg-white text-[#0F172A] p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
              >
                <div className="border-b pb-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    Qarzni Yopish Hujjati
                  </span>
                  <h3 className="text-lg font-black text-[#0F172A] mt-2">Zavodga Oltin Topshirish</h3>
                  <p className="text-xs text-[#475569]">
                    Afinaj qilingan toza oltin, xarid qilingan oltin yoki lomni zavodga topshirish. Faqat ushbu amal zavod qarzini kamaytiradi.
                  </p>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-xs font-bold text-[#475569] mb-1">Topshirilayotgan Oltin Manbasi:</label>
                    <select
                      value={hndSourceType}
                      onChange={(e) => {
                        const val = e.target.value as "refined_gold" | "purchased_gold" | "scrap_gold" | "capital_pure_gold";
                        setHndSourceType(val);
                        if (val === "capital_pure_gold" || val === "refined_gold") {
                          const activeRefiningBatch = refiningBatches.find((b) => b.status === "completed");
                          setHndProba(String(activeRefiningBatch?.output_fine_proba || 997));
                        } else {
                          setHndProba("585");
                        }
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-[#0F172A]"
                    >
                      <option value="refined_gold">Afinaj qilingan toza oltin (Sof quyma)</option>
                      <option value="capital_pure_gold">🏆 Ta&apos;sischi toza oltin kapitali (Quyma)</option>
                      <option value="purchased_gold">Bozordan naqdga olingan oltin (585 eq)</option>
                      <option value="scrap_gold">Seyfdagi 585 lom oltin</option>
                    </select>
                    <div className="text-[11px] text-[#475569] mt-1">
                      Mavjud seyf qoldig&apos;i:{" "}
                      <span className="font-bold text-[#0F172A]">
                        {hndSourceType === "capital_pure_gold"
                          ? `${formatScreenGrams(managerVault?.manager_capital_pure_gold_g || 0)} (585 eq) / ${formatScreenGrams(managerVault?.manager_capital_pure_gold_fine_g || 0)} (toza g)`
                          : hndSourceType === "refined_gold"
                          ? `${formatScreenGrams(managerVault?.manager_refined_gold_grams || 0)} (585 eq)`
                          : hndSourceType === "purchased_gold"
                          ? `${formatScreenGrams(managerVault?.manager_purchased_gold_grams || 0)} (585 eq)`
                          : `${formatScreenGrams(managerVault?.manager_scrap_grams || 0)}`}
                      </span>
                    </div>
                  </div>

                  {hndSourceType === "purchased_gold" && goldPurchases.filter((p) => p.status !== "reversed").length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">
                        Bog&apos;langan Oltin Xaridi (Ixtiyoriy/Tavsiya etiladi):
                      </label>
                      <select
                        value={hndPurchaseId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHndPurchaseId(val);
                          const sel = goldPurchases.find((p) => p.id === val);
                          if (sel) {
                            const usedPhys = factoryHandovers
                              .filter((h) => h.status !== "reversed" && ((h as { source_purchase_id?: string; purchase_id?: string }).source_purchase_id === sel.id || (h as { purchase_id?: string }).purchase_id === sel.id || (sel.purchase_no && h.notes?.includes(sel.purchase_no))))
                              .reduce((sum, h) => sum + Number(h.physical_weight_g || 0), 0);
                            const remPhys = Math.max(0, Number((Number(sel.gold_weight_grams || 0) - usedPhys).toFixed(4)));
                            setHndWeight(String(remPhys));
                            if (sel.proba) setHndProba(String(sel.proba));
                          }
                        }}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A]"
                      >
                        <option value="">-- Xarid partiyasini tanlang (yoki to&apos;g&apos;ridan-to&apos;g&apos;ri kiriting) --</option>
                        {goldPurchases.filter((p) => p.status !== "reversed").map((p) => {
                          const usedPhys = factoryHandovers
                            .filter((h) => h.status !== "reversed" && ((h as { source_purchase_id?: string; purchase_id?: string }).source_purchase_id === p.id || (h as { purchase_id?: string }).purchase_id === p.id || (p.purchase_no && h.notes?.includes(p.purchase_no))))
                            .reduce((sum, h) => sum + Number(h.physical_weight_g || 0), 0);
                          const remPhys = Math.max(0, Number((Number(p.gold_weight_grams || 0) - usedPhys).toFixed(4)));
                          const remEquiv = Number((remPhys * (Number(p.proba || 585) / 585.0)).toFixed(4));
                          return (
                            <option key={p.id} value={p.id}>
                              №{p.purchase_no} — {p.supplier_name || "Bozor"} (Qoldiq: {formatScreenGrams(remPhys)}, {p.proba}°) = {formatScreenGrams(remEquiv)} 585 eq
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {hndSourceType === "refined_gold" && refiningBatches.filter((b) => b.status === "completed").length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">
                        Bog&apos;langan Afinaj Partiyasi (Ixtiyoriy/Tavsiya etiladi):
                      </label>
                      <select
                        value={hndRefiningBatchId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHndRefiningBatchId(val);
                          const sel = refiningBatches.find((b) => b.id === val);
                          if (sel && sel.output_fine_grams) {
                            setHndWeight(String(sel.output_fine_grams));
                            if (sel.output_fine_proba) setHndProba(String(sel.output_fine_proba));
                          }
                        }}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A]"
                      >
                        <option value="">-- Afinaj partiyasini tanlang (yoki to&apos;g&apos;ridan-to&apos;g&apos;ri kiriting) --</option>
                        {refiningBatches.filter((b) => b.status === "completed").map((b) => (
                          <option key={b.id} value={b.id}>
                            №{b.batch_no} — {formatScreenGrams(b.output_fine_grams, 2)} ({b.output_fine_proba}°) = {formatScreenGrams(b.output_585_equiv_grams, 2)} 585 eq
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {hndSourceType === "capital_pure_gold" && capitalPureTxs.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">
                        Bog&apos;langan Kapital Kirimi (Ixtiyoriy/Tavsiya etiladi):
                      </label>
                      <select
                        value={hndCapitalTxId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHndCapitalTxId(val);
                          const sel = capitalPureTxs.find((c) => c.id === val);
                          if (sel && sel.physical_weight_grams) {
                            setHndWeight(String(sel.physical_weight_grams));
                            if (sel.gold_proba) setHndProba(String(sel.gold_proba));
                          }
                        }}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A]"
                      >
                        <option value="">-- Kapital partiyasini tanlang (yoki to&apos;g&apos;ridan-to&apos;g&apos;ri kiriting) --</option>
                        {capitalPureTxs.map((c) => (
                          <option key={c.id} value={c.id}>
                            №{c.transaction_no} — {c.physical_weight_grams}g ({c.gold_proba}°) / {c.equiv_585_grams}g 585 eq
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Fizik Vazn (g):</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        value={hndWeight}
                        onChange={(e) => setHndWeight(e.target.value)}
                        placeholder="0.00"
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Probasi:</label>
                      <input
                        type="number"
                        step="1"
                        min="375"
                        max="1000"
                        value={hndProba}
                        onChange={(e) => setHndProba(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                        required
                      />
                    </div>
                  </div>

                  {/* Live Preview */}
                  {(() => {
                    const hndPhysW = parseFloat(hndWeight) || 0;
                    const hndPr = parseFloat(hndProba) || 585;
                    const hndEq = (hndPhysW * hndPr) / 585.0;
                    const curDebt = Number(managerVault?.current_factory_obligation_g || 0);
                    const debtCovered = Math.min(curDebt, hndEq);
                    const newAdvance = Math.max(0, hndEq - curDebt);

                    return (
                      <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-200 text-xs space-y-1 font-mono text-[#0F172A]">
                        <div className="flex justify-between text-[#475569]">
                          <span>Topshirilayotgan vazn:</span>
                          <span className="font-bold text-[#0F172A]">
                            {formatScreenGrams(hndPhysW)} ({hndPr} proba)
                          </span>
                        </div>
                        <div className="flex justify-between text-[#0F172A] font-black border-t border-emerald-300 pt-1 text-sm">
                          <span>585 Ekvivalenti:</span>
                          <span className="text-[#047857]">{formatScreenGrams(hndEq)}</span>
                        </div>
                        <div className="flex justify-between text-[#475569] pt-0.5">
                          <span>Qarz kamayishi:</span>
                          <span className="font-bold text-rose-700">-{formatScreenGrams(debtCovered)}</span>
                        </div>
                        {newAdvance > 0 && (
                          <div className="flex justify-between text-teal-900 font-bold bg-teal-100/70 p-1.5 rounded-lg border border-teal-300 mt-1">
                            <span>🏆 Zavodga yangi avans (haqdorlik):</span>
                            <span className="font-mono">+{formatScreenGrams(newAdvance)} 585 eq</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Zavod Qabul Qiluvchi:</label>
                      <input
                        type="text"
                        value={hndRecipient}
                        onChange={(e) => setHndRecipient(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A] placeholder:text-[#475569]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Izoh:</label>
                      <input
                        type="text"
                        placeholder="Tilxat yoki akt raqami..."
                        value={hndNotes}
                        onChange={(e) => setHndNotes(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A] placeholder:text-[#475569]"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition"
                >
                  {busy ? "Topshirilmoqda..." : "📤 Zavodga Oltin Topshirish & Qarzni Kamaytirish"}
                </button>
              </form>
            )}
          </div>

          {/* Tables: Factory Receipts & Handovers */}
          <div className="space-y-4">
            {(activeFactorySection === "all" || activeFactorySection === "receive") && (
              <div className="bg-white text-[#0F172A] p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="font-bold text-[#0F172A] text-sm">Zavoddan Kelgan Tovarlar Ro&apos;yxati (&quot;Zavod bilan&quot;)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-[#475569] border-b font-bold">
                      <tr>
                        <th className="p-2.5">Kvitansiya №</th>
                        <th className="p-2.5">Sana</th>
                        <th className="p-2.5">Mahsulot Nomi</th>
                        <th className="p-2.5 text-right">Fizik Vazn</th>
                        <th className="p-2.5 text-right">Proba</th>
                        <th className="p-2.5 text-right">Zavod %</th>
                        <th className="p-2.5 text-right">Zavod Majburiyati</th>
                        <th className="p-2.5 text-right">Qoldiq Vazn</th>
                        <th className="p-2.5 text-center">Holati</th>
                        <th className="p-2.5 text-center">Amallar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono">
                      {factoryReceipts.map((r) => {
                        const isReversed = r.status === "reversed" || Boolean(r.reversed_at);
                        const isTransferred = Number(r.transferred_physical_g) > 0 || Number(r.available_physical_g) < Number(r.original_physical_g);
                        return (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="p-2.5 font-bold text-[#0F172A]">{r.receipt_no}</td>
                            <td className="p-2.5 text-[#475569]">{r.receipt_date}</td>
                            <td className="p-2.5 font-sans font-medium text-[#0F172A]">{r.product_name}</td>
                            <td className="p-2.5 text-right font-bold text-[#0F172A]">{formatScreenGrams(r.original_physical_g)}</td>
                            <td className="p-2.5 text-right text-[#475569]">{r.proba}</td>
                            <td className="p-2.5 text-right text-amber-700 font-bold">+{r.factory_markup_pct}%</td>
                            <td className="p-2.5 text-right font-black text-amber-900">{formatScreenGrams(r.factory_obligation_g)}</td>
                            <td className="p-2.5 text-right text-[#475569]">{formatScreenGrams(r.available_physical_g)}</td>
                            <td className="p-2.5 text-center font-sans">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isReversed
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : "bg-slate-100 text-[#0F172A]"
                              }`}>
                                {isReversed ? "Bekor qilingan" : r.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-center font-sans">
                              {isReversed ? (
                                <span className="text-[11px] text-slate-400 italic font-mono">
                                  Bekor bo&apos;lgan
                                </span>
                              ) : isTransferred ? (
                                <button
                                  type="button"
                                  disabled
                                  title="Sotuvchilarga tarqatilgan. Avval konsignatsiyani bekor qiling."
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                                >
                                  🔒 Tarqatilgan
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReversalTarget({
                                      type: "factory_receipt",
                                      id: r.id,
                                      docNo: r.receipt_no,
                                      title: `Zavod Kirimi №${r.receipt_no}`,
                                      details: `${r.product_name} — ${formatScreenGrams(r.original_physical_g)} (${r.proba}°)`,
                                    });
                                    setReversalReason("");
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                                >
                                  ↩️ Bekor qilish
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {factoryReceipts.length === 0 && (
                        <tr>
                          <td colSpan={10} className="p-6 text-center text-[#475569] font-sans">
                            Hozircha zavoddan tovar kirimi mavjud emas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(activeFactorySection === "all" || activeFactorySection === "handover") && (
              <div className="bg-white text-[#0F172A] p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="font-bold text-[#0F172A] text-sm">Zavodga Topshirilgan Oltinlar Tarixi (Qarz Qoplamasi)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-[#475569] border-b font-bold">
                      <tr>
                        <th className="p-2.5">Hujjat №</th>
                        <th className="p-2.5">Sana</th>
                        <th className="p-2.5">Manba Turi</th>
                        <th className="p-2.5 text-right">Fizik Vazn</th>
                        <th className="p-2.5 text-right">Proba</th>
                        <th className="p-2.5 text-right">585 Ekvivalenti</th>
                        <th className="p-2.5">Qabul Qiluvchi</th>
                        <th className="p-2.5">Izoh</th>
                        <th className="p-2.5 text-right">Amallar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono">
                      {factoryHandovers.map((h) => (
                        <tr key={h.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-[#0F172A]">{h.handover_no}</td>
                          <td className="p-2.5 text-[#475569]">{h.handover_date}</td>
                          <td className="p-2.5 font-sans font-medium text-[#0F172A]">
                            {h.source_type === "capital_pure_gold" ? "🏆 Ta'sischi kapital quyma" : h.source_type === "refined_gold" ? "Afinaj toza oltin" : h.source_type === "purchased_gold" ? "Bozordan xarid" : "Lom oltin"}
                            {h.capital_tx_id && (
                              <span className="block text-[10px] text-amber-700 font-mono font-bold mt-0.5">
                                🔗 Kapitalga bog&apos;langan
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-right font-bold text-[#0F172A]">{formatScreenGrams(h.physical_weight_g)}</td>
                          <td className="p-2.5 text-right text-[#475569]">{h.proba}</td>
                          <td className="p-2.5 text-right font-black text-[#047857]">{formatScreenGrams(h.agreed_equivalent_g)}</td>
                          <td className="p-2.5 font-sans text-[#0F172A]">{h.factory_recipient}</td>
                          <td className="p-2.5 font-sans text-[#475569]">{h.notes || "—"}</td>
                          <td className="p-2.5 text-right font-sans">
                            {h.status === "reversed" ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Bekor qilingan
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setReversalTarget({
                                    type: "factory_gold_handover",
                                    id: h.id,
                                    docNo: h.handover_no,
                                    title: `Zavodga Oltin Topshirish №${h.handover_no}`,
                                    details: `${formatScreenGrams(h.physical_weight_g)} (${h.proba}°) = ${formatScreenGrams(h.agreed_equivalent_g)} 585 eq`,
                                  });
                                  setReversalReason("");
                                }}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                              >
                                ↩️ Bekor qilish
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {factoryHandovers.length === 0 && (
                        <tr>
                          <td colSpan={9} className="p-6 text-center text-[#475569] font-sans">
                            Hozircha zavodga topshirilgan oltinlar tarixi mavjud emas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: SELLERS OVERVIEW & SURRENDER */}
      {activeTab === "sellers" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-[#F8FAFC]">Sotuvchilar Balansi va Bozor Qarzi (2-Zanjir)</h2>
              <p className="text-xs text-[#CBD5E1]">
                Sheets &quot;Bozor qarzi&quot; konvensiyasi: (-) Sotuvchi bizga qarzdor, (+) Biz sotuvchiga qarzdormiz. Mijoz to&apos;lovi sotuvchi kassasida saqlanadi.
              </p>
            </div>
            <button
              onClick={() => void loadData()}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[#F8FAFC] border border-slate-700 text-xs font-semibold rounded-xl transition"
            >
              🔄 Yangilash
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sellerAccounts.length === 0 ? (
              <div className="col-span-full bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center text-[#CBD5E1]">
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
                const tillUsd = Number(acc.seller_till_usd_amount || 0);
                const sellerOwes = Number(acc.seller_owes_manager_g || 0);
                const managerOwes = Number(acc.manager_owes_seller_g || 0);
                const isSellerDebtor = sellerOwes > 0.001 || (acc.bozor_qarzi_signed_g !== undefined && Number(acc.bozor_qarzi_signed_g) < -0.001);
                const isManagerDebtor = managerOwes > 0.001 || (acc.bozor_qarzi_signed_g !== undefined && Number(acc.bozor_qarzi_signed_g) > 0.001);
                const activeDebtAmount = isSellerDebtor ? (sellerOwes || Math.abs(Number(acc.bozor_qarzi_signed_g || 0))) : (managerOwes || Number(acc.bozor_qarzi_signed_g || 0));

                return (
                  <div key={acc.seller_id} className="bg-white text-[#0F172A] rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4 hover:shadow-md transition">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-base text-[#0F172A]">{sellerName}</div>
                        {sellerPhone && <div className="text-xs text-[#475569]">{sellerPhone}</div>}
                      </div>
                      <span className="bg-blue-50 text-blue-700 text-[11px] font-bold px-2.5 py-1 rounded-full border border-blue-200">
                        Sotuvchi
                      </span>
                    </div>

                    {/* Signed Bozor Qarzi Card */}
                    <div className={`p-4 rounded-2xl border space-y-1 ${
                      isSellerDebtor
                        ? "bg-rose-50 border-rose-200 text-[#B91C1C]"
                        : isManagerDebtor
                        ? "bg-emerald-50 border-emerald-200 text-[#047857]"
                        : "bg-slate-50 border-slate-200 text-[#0F172A]"
                    }`}>
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className={isSellerDebtor ? "text-[#B91C1C]" : isManagerDebtor ? "text-[#047857]" : "text-[#0F172A]"}>
                          Bozor Qarzi (Boshqaruvchi hisobi):
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          isSellerDebtor
                            ? "bg-rose-200 text-[#B91C1C]"
                            : isManagerDebtor
                            ? "bg-emerald-200 text-[#047857]"
                            : "bg-slate-200 text-[#0F172A]"
                        }`}>
                          {isSellerDebtor
                            ? "Sotuvchi qarzdor (-)"
                            : isManagerDebtor
                            ? "Biz qarzdormiz (+)"
                            : "Hisob teng (0)"}
                        </span>
                      </div>
                      <div className={`text-2xl font-black font-mono ${
                        isSellerDebtor ? "text-[#B91C1C]" : isManagerDebtor ? "text-[#047857]" : "text-[#0F172A]"
                      }`}>
                        {isSellerDebtor ? "-" : isManagerDebtor ? "+" : ""}
                        {formatScreenGrams(activeDebtAmount, 2)}
                      </div>
                      <div className="text-[11px] text-[#475569] font-medium">
                        {isSellerDebtor
                          ? `Sotuvchi boshqaruvchiga ${formatScreenGrams(activeDebtAmount, 2)} lom qaytarishi shart.`
                          : isManagerDebtor
                          ? `Boshqaruvchi sotuvchiga ${formatScreenGrams(activeDebtAmount, 2)} ortiqcha tushum (avans) uchun qarzdor.`
                          : "Barcha majburiyatlar to'liq yopilgan."}
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="grid grid-cols-3 gap-1.5 text-[11px] bg-slate-50 p-2.5 rounded-2xl border border-slate-200 font-mono text-[#0F172A]">
                      <div>
                        <span className="text-[#475569] block text-[10px]">Olingan Tovar:</span>
                        <span className="font-bold text-[#0F172A]">{formatScreenGrams(Number(acc.total_transferred_physical_g || 0), 2)}</span>
                      </div>
                      <div>
                        <span className="text-[#475569] block text-[10px]">Sotuvchi Majburiyati:</span>
                        <span className="font-bold text-amber-900">{formatScreenGrams(Number(acc.total_seller_obligation_g || factoryObligation), 2)}</span>
                        {Number(acc.seller_legacy_debt_obligation_g || 0) > 0 && (
                          <div className="text-[9px] text-[#475569] font-sans leading-tight mt-0.5">
                            {formatScreenGrams(Number(acc.total_consigned_gold_grams || (Number(acc.total_seller_obligation_g || 0) - Number(acc.seller_legacy_debt_obligation_g || 0))), 2)} tovar + {formatScreenGrams(Number(acc.seller_legacy_debt_obligation_g), 2)} eski qarz
                          </div>
                        )}
                      </div>
                      <div>
                        <span className="text-[#475569] block text-[10px]">Topshirildi:</span>
                        <span className="font-bold text-[#047857]">{formatScreenGrams(Number(acc.total_settled_to_manager_g || 0), 2)}</span>
                      </div>
                    </div>

                    <div className={`grid ${tillUsd > 0 ? "grid-cols-3" : "grid-cols-2"} gap-2 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-200 text-[#0F172A]`}>
                      <div>
                        <span className="text-[#475569] block">Kassasidagi Lom:</span>
                        <span className="font-mono font-bold text-[#0F172A] text-sm">{formatScreenGrams(tillScrap, 2)}</span>
                      </div>
                      <div>
                        <span className="text-[#475569] block">Kassasidagi Naqd:</span>
                        <span className="font-mono font-bold text-[#047857] text-sm">{formatScreenUZS(tillCash)}</span>
                      </div>
                      {tillUsd > 0 && (
                        <div>
                          <span className="text-[#475569] block">Kassasidagi USD:</span>
                          <span className="font-mono font-bold text-blue-700 text-sm">
                            ${tillUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <button
                        onClick={() => {
                          setSelectedReconSeller({ id: acc.seller_id, name: sellerName });
                          setReconModalOpen(true);
                        }}
                        className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-amber-300 font-bold text-xs rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5"
                      >
                        <span>📋</span> Rekonsilyatsiya (A-G)
                      </button>
                      <button
                        onClick={() => handleOpenSurrender(acc)}
                        className="py-2 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                      >
                        <span>📥</span> Qabul Qilish
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB: VAULT & REFINING ("Kassa & Afinaj") */}
      {activeTab === "vault" && (
        <div className="space-y-6">
          {/* Header & Metrics */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-black text-[#F8FAFC]">
                {activeVaultSection === "cash"
                  ? "Boshqaruvchi Kassasi & Seyf Balansi"
                  : activeVaultSection === "refining"
                  ? "Afinaj & Lom Pateriya (Eritish va Qayta Ishlash)"
                  : activeVaultSection === "purchases"
                  ? "Naqd Pulga Oltin Xarid (\"Tovar Olish\")"
                  : "Boshqaruvchi Kassasi, Afinaj & Xaridlar"}
              </h2>
              <p className="text-xs text-[#CBD5E1]">
                {activeVaultSection === "cash"
                  ? "Boshqaruvchi seyfi va kassasidagi fizik lom oltin, naqd UZS hamda toza quyma qoldiqlari."
                  : activeVaultSection === "refining"
                  ? "Sheets \"Lom pateriya\" pariteti: Yig'ilgan 585 lomni eritish, toza quyma olish va yo'qotish (pateriya) hisobi."
                  : activeVaultSection === "purchases"
                  ? "Sheets \"Tovar olish\" pariteti: Naqd pulga bozordan oltin sotib olish va kassa hisob-kitobi."
                  : "Sheets \"Lom pateriya\" va \"Tovar olish\" varaqalari pariteti: G'azna, afinaj va oltin xaridlari yagona markazda."}
              </p>
            </div>
            <button
              onClick={() => void loadData()}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-[#F8FAFC] border border-slate-700 text-xs font-semibold rounded-xl transition"
            >
              🔄 Yangilash
            </button>
          </div>

          {/* Subview Segmented Control (only when all subviews are allowed) */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl w-fit text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveVaultSection("all")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeVaultSection === "all"
                  ? "bg-slate-800 text-[#F8FAFC] shadow-sm border border-slate-700"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              📋 Barchasi
            </button>
            <button
              type="button"
              onClick={() => setActiveVaultSection("cash")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeVaultSection === "cash"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              💰 Kassa Balansi
            </button>
            <button
              type="button"
              onClick={() => setActiveVaultSection("refining")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeVaultSection === "refining"
                  ? "bg-cyan-600 text-white shadow-sm"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              ⚗️ Afinaj (Pateriya)
            </button>
            <button
              type="button"
              onClick={() => setActiveVaultSection("purchases")}
              className={`px-3 py-1.5 rounded-xl transition ${
                activeVaultSection === "purchases"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-[#CBD5E1] hover:text-[#F8FAFC]"
              }`}
            >
              🪙 Naqdga Oltin Xarid
            </button>
          </div>

          {/* Metric Cards (Scoped per section) */}
          {(() => {
            const completedBatches = refiningBatches.filter((b) => b.status === "completed");
            const distinctRefiningProbas = Array.from(new Set(completedBatches.map((b) => b.output_fine_proba).filter(Boolean)));
            const activeRefiningProbaVal = completedBatches[0]?.output_fine_proba || 997;
            const activeRefiningProbaLabel = distinctRefiningProbas.length === 1 ? `${distinctRefiningProbas[0]}°` : "Aralash proba";

            const activePurchases = goldPurchases.filter((p) => p.status !== "reversed");
            const activePurchasesInStock = activePurchases.filter((p) => {
              const usedPhys = factoryHandovers
                .filter((h) => h.status !== "reversed" && ((h as { source_purchase_id?: string; purchase_id?: string }).source_purchase_id === p.id || (h as { purchase_id?: string }).purchase_id === p.id || (p.purchase_no && h.notes?.includes(p.purchase_no))))
                .reduce((sum, h) => sum + Number(h.physical_weight_g || 0), 0);
              return Math.max(0, Number((Number(p.gold_weight_grams || 0) - usedPhys).toFixed(4))) > 0;
            });
            const distinctPurchaseProbas = Array.from(new Set(activePurchasesInStock.map((p) => p.proba).filter(Boolean)));
            const purchProbaDisplay = distinctPurchaseProbas.length === 1 ? `${distinctPurchaseProbas[0]}°` : (distinctPurchaseProbas.length > 1 ? "Aralash proba" : `${activePurchases[0]?.proba || 585}°`);

            const totalHistPurchased585 = activePurchases.reduce((sum, p) => sum + Number(p.equiv_585_grams || 0), 0);
            const totalHistPurchasedPhys = activePurchases.reduce((sum, p) => sum + Number(p.gold_weight_grams || 0), 0);
            const curPurchased585 = Number(managerVault?.manager_purchased_gold_grams || 0);
            const curPurchasedPhys: number = totalHistPurchased585 > 0
              ? Number((totalHistPurchasedPhys * (curPurchased585 / totalHistPurchased585)).toFixed(4))
              : curPurchased585;

            return activeVaultSection === "refining" ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-amber-900 text-white p-4 rounded-3xl border border-amber-800 shadow-sm">
                  <div className="text-xs font-bold text-amber-200">Seyfdagi Lom Oltin (585)</div>
                  <div className="text-2xl font-black font-mono text-amber-300 mt-1">
                    {formatScreenGrams(managerVault?.manager_scrap_grams || 0)}
                  </div>
                  <div className="text-[11px] text-amber-200 mt-1">Eritish uchun tayyor lom zaxirasi</div>
                </div>

                <div className="bg-cyan-950 text-white p-4 rounded-3xl border border-cyan-800 shadow-sm">
                  <div className="text-xs font-bold text-cyan-300">
                    Afinaj Qilingan Toza Oltin ({completedBatches.length > 0 ? `Fizik ${activeRefiningProbaLabel}` : "Sof Quyma"})
                  </div>
                  <div className="text-2xl font-black font-mono text-cyan-300 mt-1">
                    {formatScreenGrams(
                      managerVault?.manager_refined_gold_fine_grams ??
                      (managerVault?.manager_refined_gold_grams ? Number(managerVault.manager_refined_gold_grams) * 585 / activeRefiningProbaVal : 0)
                    )} <span className="text-xs font-normal text-cyan-400">{activeRefiningProbaLabel}</span>
                  </div>
                  <div className="text-[11px] text-cyan-300 mt-1">
                    {formatScreenGrams(managerVault?.manager_refined_gold_grams || 0)} (585 ekvivalent) • Sof quyma
                  </div>
                </div>

                <div className="bg-rose-950 text-white p-4 rounded-3xl border border-rose-800 shadow-sm">
                  <div className="text-xs font-bold text-rose-300">Jami Afinaj Yo&apos;qotishi (Pateriya)</div>
                  <div className="text-2xl font-black font-mono text-rose-300 mt-1">
                    {formatScreenGrams(refiningBatches.filter((b) => b.status === "completed").reduce((sum, b) => sum + Number(b.total_loss_grams || 0), 0))} <span className="text-xs font-normal">585</span>
                  </div>
                  <div className="text-[11px] text-rose-200 mt-1">Boshqaruvchi hisobiga yozilgan zarar</div>
                </div>
              </div>
            ) : activeVaultSection === "purchases" ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-950 text-white p-4 rounded-3xl border border-emerald-800 shadow-sm">
                  <div className="text-xs font-bold text-emerald-300">Kassadagi Naqd Pul (UZS)</div>
                  <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
                    {formatScreenUZS(managerVault?.manager_cash_amount || 0)}
                  </div>
                  <div className="text-[11px] text-emerald-200 mt-1">Oltin xarid qilish uchun mavjud so&apos;m</div>
                </div>

                <div className="bg-blue-950 text-white p-4 rounded-3xl border border-blue-800 shadow-sm">
                  <div className="text-xs font-bold text-blue-300">Kassadagi Valyuta ($ USD)</div>
                  <div className="text-2xl font-black font-mono text-blue-400 mt-1">
                    ${Number(managerVault?.manager_usd_amount || 0).toLocaleString()} USD
                  </div>
                  <div className="text-[11px] text-blue-200 mt-1">Oltin xarid qilish uchun mavjud dollar</div>
                </div>

                <div className="bg-indigo-950 text-white p-4 rounded-3xl border border-indigo-800 shadow-sm">
                  <div className="text-xs font-bold text-indigo-300">Xarid Qilingan Oltin — Joriy Qoldiq</div>
                  <div className="text-2xl font-black font-mono text-indigo-300 mt-1">
                    {formatScreenGrams(curPurchased585)} <span className="text-xs font-normal text-indigo-200">(585 eq)</span>
                  </div>
                  <div className="text-[11px] text-indigo-200 mt-1">
                    {formatScreenGrams(curPurchasedPhys)} fizik ({purchProbaDisplay}°) • Jami xarid: {formatScreenGrams(totalHistPurchased585)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <div className="bg-amber-900 text-white p-4 rounded-3xl border border-amber-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-amber-200 uppercase tracking-wide">Seyfdagi Lom (585)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-amber-300 mt-1">
                      {formatScreenGrams(managerVault?.manager_scrap_585_eq_g ?? managerVault?.manager_scrap_grams ?? 0)}
                    </div>
                  </div>
                  <div className="text-[10px] text-amber-200 mt-2">
                    {managerVault?.manager_scrap_physical_g && Number(managerVault.manager_scrap_physical_g) > 0
                      ? `${formatScreenGrams(managerVault.manager_scrap_physical_g)} fizik lom`
                      : "Sotuvchilardan olingan lom"}
                  </div>
                </div>

                <div className="bg-cyan-950 text-white p-4 rounded-3xl border border-cyan-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-cyan-300 uppercase tracking-wide">Afinaj Toza (585 eq)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-cyan-300 mt-1">
                      {formatScreenGrams(managerVault?.manager_refined_gold_grams || 0)}
                    </div>
                  </div>
                  <div className="text-[10px] text-cyan-200 mt-2">
                    {managerVault?.manager_refined_gold_fine_grams && Number(managerVault.manager_refined_gold_fine_grams) > 0
                      ? `${formatScreenGrams(managerVault.manager_refined_gold_fine_grams)} toza ${activeRefiningProbaLabel}`
                      : "Afinajdan chiqqan toza oltin"}
                  </div>
                </div>

                <div className="bg-indigo-950 text-white p-4 rounded-3xl border border-indigo-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-wide">Xarid Oltini (585 eq)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-indigo-300 mt-1">
                      {formatScreenGrams(curPurchased585)}
                    </div>
                  </div>
                  <div className="text-[10px] text-indigo-200 mt-2">
                    Joriy qoldiq ({formatScreenGrams(curPurchasedPhys)} fizik)
                  </div>
                </div>

                <div className="bg-purple-950 text-white p-4 rounded-3xl border border-purple-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-purple-300 uppercase tracking-wide">Kapital Quyma (585 eq)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-purple-300 mt-1">
                      {formatScreenGrams(managerVault?.manager_capital_pure_gold_g || 0)}
                    </div>
                  </div>
                  <div className="text-[10px] text-purple-200 mt-2">
                    {managerVault?.manager_capital_pure_gold_fine_g && Number(managerVault.manager_capital_pure_gold_fine_g) > 0
                      ? `${formatScreenGrams(managerVault.manager_capital_pure_gold_fine_g)} toza quyma`
                      : "Ta'sischi kiritgan toza quyma"}
                  </div>
                </div>

                <div className="bg-emerald-950 text-white p-4 rounded-3xl border border-emerald-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wide">Kassadagi Naqd (UZS)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-emerald-400 mt-1">
                      {formatScreenUZS(managerVault?.manager_cash_amount || 0)}
                    </div>
                  </div>
                  <div className="text-[10px] text-emerald-200 mt-2">Boshqaruvchi seyfidagi UZS</div>
                </div>

                <div className="bg-blue-950 text-white p-4 rounded-3xl border border-blue-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-blue-300 uppercase tracking-wide">Valyuta (USD)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-blue-400 mt-1">
                      ${Number(managerVault?.manager_usd_amount || 0).toLocaleString()} USD
                    </div>
                  </div>
                  <div className="text-[10px] text-blue-200 mt-2">Boshqaruvchi seyfidagi USD</div>
                </div>

                <div className="bg-rose-950 text-white p-4 rounded-3xl border border-rose-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-rose-300 uppercase tracking-wide">Afinaj Pateriya (585)</div>
                    <div className="text-xl md:text-2xl font-black font-mono text-rose-300 mt-1">
                      {formatScreenGrams(
                        refiningBatches
                          .filter((b) => b.status === "completed")
                          .reduce((sum, b) => sum + (Number(b.total_loss_grams) || 0), 0)
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-rose-200 mt-2">
                    {refiningBatches.filter((b) => b.status === "completed").length} ta afinaj partiyasi
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Dedicated Kassa & Seyf quick action links when on cash view */}
          {activeVaultSection === "cash" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Link
                href="/sales/app/refining"
                className="p-5 rounded-2xl bg-gradient-to-r from-cyan-950/40 to-slate-900 border border-cyan-500/30 hover:border-cyan-400 transition flex items-center justify-between group shadow-sm"
              >
                <div>
                  <div className="text-cyan-400 font-bold text-sm group-hover:underline">
                    ⚗️ Afinaj & Lom Pateriya Bo&apos;limiga O&apos;tish
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Yig&apos;ilgan lomni eritish va toza quyma olish amaliyoti
                  </div>
                </div>
                <span className="text-cyan-400 font-bold text-lg group-hover:translate-x-1 transition">→</span>
              </Link>
              <Link
                href="/sales/app/purchases"
                className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-500/30 hover:border-emerald-400 transition flex items-center justify-between group shadow-sm"
              >
                <div>
                  <div className="text-emerald-400 font-bold text-sm group-hover:underline">
                    🪙 Naqdga Oltin Xarid Bo&apos;limiga O&apos;tish
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Kassadagi naqd pulga bozordan oltin sotib olish (&quot;Tovar olish&quot;)
                  </div>
                </div>
                <span className="text-emerald-400 font-bold text-lg group-hover:translate-x-1 transition">→</span>
              </Link>
            </div>
          )}

          {/* Operational Forms (Refining and/or Purchases) */}
          {(activeVaultSection === "all" || activeVaultSection === "refining" || activeVaultSection === "purchases") && (
            <div className={activeVaultSection === "all" ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : "max-w-2xl"}>
              {/* Form 1: Afinaj — Lom Pateriya */}
              {(activeVaultSection === "all" || activeVaultSection === "refining") && (
                <form
                  onSubmit={(e) => void handleCreateRefiningBatch(e)}
                  className="bg-white text-[#0F172A] p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
                >
                  <div className="border-b pb-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-full border border-cyan-200">
                      Varaqa: &quot;Lom pateriya&quot;
                    </span>
                    <h3 className="text-lg font-black text-[#0F172A] mt-2">Afinaj (Eritish & Qayta Ishlash)</h3>
                    <p className="text-xs text-[#475569]">
                      Lom oltinni eritish va tozalash. Yo&apos;qotish (pateriya) faqat boshqaruvchi hisobiga yoziladi, zavod qarzi o&apos;zgarmaydi!
                    </p>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="block text-xs font-bold text-[#475569] mb-1">Kiruvchi Lom Vazni (g):</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          value={refInputScrap}
                          onChange={(e) => setRefInputScrap(e.target.value)}
                          placeholder="Masalan: 50.00"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Lom Probasi:</label>
                        <input
                          type="number"
                          step="1"
                          min="300"
                          max="1000"
                          value={refInputProba}
                          onChange={(e) => setRefInputProba(e.target.value)}
                          placeholder="585"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-amber-800"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Eritilgan Vazn (g):</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          value={refMeltedWeight}
                          onChange={(e) => setRefMeltedWeight(e.target.value)}
                          placeholder="Eritgandan so'ng"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Chiqqan Toza (g):</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          value={refFineWeight}
                          onChange={(e) => setRefFineWeight(e.target.value)}
                          placeholder="Toza vazn"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Toza Probasi:</label>
                        <input
                          type="number"
                          step="1"
                          min="900"
                          max="1000"
                          value={refFineProba}
                          onChange={(e) => setRefFineProba(e.target.value)}
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-cyan-800"
                          required
                        />
                      </div>
                    </div>

                    {/* Live Preview */}
                    {(() => {
                      const inW = parseFloat(refInputScrap) || 0;
                      const inP = parseFloat(refInputProba) || 585;
                      const in585Eq = (inW * inP) / 585.0;
                      const meltW = parseFloat(refMeltedWeight) || 0;
                      const fineW = parseFloat(refFineWeight) || 0;
                      const fineP = parseFloat(refFineProba) || 995;
                      const out585Eq = (fineW * fineP) / 585.0;
                      const pateriya585 = Math.max(0, in585Eq - out585Eq);

                      return (
                        <div className="bg-cyan-50 p-3 rounded-2xl border border-cyan-200 text-xs space-y-1 font-mono text-[#0F172A]">
                          <div className="flex justify-between text-[#475569]">
                            <span>Kiruvchi Lom 585 Ekvivalenti:</span>
                            <span className="font-bold text-[#0F172A]">{formatScreenGrams(in585Eq)}</span>
                          </div>
                          <div className="flex justify-between text-[#475569]">
                            <span>Eritish yo&apos;qotishi (kuya):</span>
                            <span className="font-bold text-[#0F172A]">
                              {formatScreenGrams(Math.max(0, inW - meltW))}
                            </span>
                          </div>
                          <div className="flex justify-between text-[#475569]">
                            <span>Chiqqan Toza 585 Ekvivalenti:</span>
                            <span className="font-bold text-cyan-800">{formatScreenGrams(out585Eq)}</span>
                          </div>
                          <div className="flex justify-between text-[#B91C1C] font-black border-t border-cyan-300 pt-1 text-sm">
                            <span>Jami Yo&apos;qotish (Lom Pateriya 585 g):</span>
                            <span>{formatScreenGrams(pateriya585)}</span>
                          </div>
                          <div className="text-[10px] text-cyan-800 font-sans mt-1">
                            ℹ️ Pateriya 585 ekvivalent bo&apos;yicha hisoblanadi va korxona foydasini aynan bir marta kamaytiradi; zavod qarzi o&apos;zgarmaydi.
                          </div>
                        </div>
                      );
                    })()}

                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Izoh:</label>
                      <input
                        type="text"
                        placeholder="Usta / laboratoriya izohi..."
                        value={refNotes}
                        onChange={(e) => setRefNotes(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A] placeholder:text-[#475569]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-3 bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-xs rounded-xl shadow-md transition"
                  >
                    {busy ? "Saqlanmoqda..." : "🔬 Afinaj Partiyasini Saqlash (Pateriya Qayd Qilish)"}
                  </button>
                </form>
              )}

              {/* Form 2: Tovar Olish (Naqd Pulga Oltin Xarid Qilish) */}
              {(activeVaultSection === "all" || activeVaultSection === "purchases") && (
                <form
                  onSubmit={(e) => void handleCreateGoldPurchase(e)}
                  className="bg-white text-[#0F172A] p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
                >
                  <div className="border-b pb-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      Varaqa: &quot;Tovar olish&quot;
                    </span>
                    <h3 className="text-lg font-black text-[#0F172A] mt-2">Tovar Olish (Naqdga Oltin Xarid Qilish)</h3>
                    <p className="text-xs text-[#475569]">
                      Kassadagi naqd pulga oltin sotib olish. Kassadagi naqd pul kamayadi, seyfdagi oltin ko&apos;payadi. Zavod qarzi o&apos;zgarmaydi!
                    </p>
                  </div>

                  <div className="space-y-3 text-sm">
                    {/* Vault Balances */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                      <div>
                        <span className="text-[11px] font-bold text-[#475569] block">Mavjud UZS Kassasi:</span>
                        <strong className="text-emerald-600 font-mono text-xs font-black">{formatScreenUZS(managerVault?.manager_cash_amount || 0)}</strong>
                      </div>
                      <div>
                        <span className="text-[11px] font-bold text-[#475569] block">Mavjud USD Kassasi:</span>
                        <strong className="text-blue-600 font-mono text-xs font-black">${Number(managerVault?.manager_usd_amount || 0).toLocaleString()} USD</strong>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Yetkazib Beruvchi / Bozor Nomi:</label>
                      <input
                        type="text"
                        placeholder="Masalan: Bozor, Usta Akmal..."
                        value={buySupplier}
                        onChange={(e) => setBuySupplier(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-[#0F172A] placeholder:text-[#475569]"
                        required
                      />
                    </div>

                    {/* Currency Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Sarflangan UZS (So&apos;m):</label>
                        <input
                          type="number"
                          step="1000"
                          min="0"
                          value={buyCashUZS}
                          onChange={(e) => setBuyCashUZS(e.target.value)}
                          placeholder="0 UZS"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-emerald-700"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Sarflangan USD ($ Dollar):</label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={buyCashUSD}
                          onChange={(e) => setBuyCashUSD(e.target.value)}
                          placeholder="$0 USD"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-blue-700"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-xs font-bold text-[#475569]">Operatsiya USD Kursi:</label>
                          {activeBaselineUsdRate && (
                            <button
                              type="button"
                              onClick={() => setBuyUsdRate(String(activeBaselineUsdRate))}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              Tasdiqlangan: {activeBaselineUsdRate.toLocaleString()}
                            </button>
                          )}
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="1"
                          value={buyUsdRate}
                          onChange={(e) => setBuyUsdRate(e.target.value)}
                          placeholder={activeBaselineUsdRate ? String(activeBaselineUsdRate) : "Masalan: 11918.98"}
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Olingan Oltin Vazni (g):</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          value={buyWeight}
                          onChange={(e) => setBuyWeight(e.target.value)}
                          placeholder="20.00"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">Probasi:</label>
                        <input
                          type="number"
                          step="1"
                          min="375"
                          max="1000"
                          value={buyProba}
                          onChange={(e) => setBuyProba(e.target.value)}
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#475569] mb-1">1 g Kursi (ixtiyoriy):</label>
                        <input
                          type="number"
                          step="100"
                          min="0"
                          value={buyRate}
                          onChange={(e) => setBuyRate(e.target.value)}
                          placeholder="Avtomatik"
                          className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                        />
                      </div>
                    </div>

                    {/* Live Preview */}
                    {(() => {
                      const spentUZS = parseFloat(buyCashUZS) || 0;
                      const spentUSD = parseFloat(buyCashUSD) || 0;
                      const usdRate = parseFloat(buyUsdRate) || activeBaselineUsdRate || 0;
                      const goldW = parseFloat(buyWeight) || 0;
                      const pr = parseFloat(buyProba) || 585;
                      const totalCostUZS = spentUZS + (spentUSD * usdRate);
                      const equiv585 = goldW > 0 ? (goldW * pr) / 585.0 : 0;
                      const unitCostUZS = goldW > 0 ? totalCostUZS / goldW : 0;

                      return (
                        <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-200 text-xs space-y-1 font-mono text-[#0F172A]">
                          <div className="flex justify-between text-[#475569]">
                            <span>Sarflangan naqd UZS:</span>
                            <span className="font-bold text-emerald-700">{formatScreenUZS(spentUZS)}</span>
                          </div>
                          {spentUSD > 0 && (
                            <div className="flex justify-between text-[#475569]">
                              <span>Sarflangan valyuta USD:</span>
                              <span className="font-bold text-blue-700">${spentUSD.toLocaleString()} USD (kurs: {usdRate.toLocaleString()})</span>
                            </div>
                          )}
                          <div className="flex justify-between text-[#475569] border-t border-emerald-200 pt-1">
                            <span>Jami xarid qiymati (UZS):</span>
                            <span className="font-bold text-[#0F172A]">{formatScreenUZS(totalCostUZS)}</span>
                          </div>
                          <div className="flex justify-between text-[#475569]">
                            <span>Olingan oltin vazni:</span>
                            <span className="font-bold text-[#0F172A]">{formatScreenGrams(goldW)} ({pr} proba)</span>
                          </div>
                          {goldW > 0 && totalCostUZS > 0 && (
                            <div className="flex justify-between text-[#475569]">
                              <span>1 gramm o&apos;rtacha tannarxi:</span>
                              <span className="font-bold text-[#0F172A]">{formatScreenUZS(unitCostUZS)}/g</span>
                            </div>
                          )}
                          <div className="flex justify-between text-[#0F172A] font-black border-t border-emerald-300 pt-1 text-sm">
                            <span>585 Ekvivalenti:</span>
                            <span className="text-[#047857]">{formatScreenGrams(equiv585)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    <div>
                      <label className="block text-xs font-bold text-[#475569] mb-1">Izoh:</label>
                      <input
                        type="text"
                        placeholder="Bozor yoki tovar tafsiloti..."
                        value={buyNotes}
                        onChange={(e) => setBuyNotes(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A] placeholder:text-[#475569]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-md transition"
                  >
                    {busy ? "Saqlanmoqda..." : "💵 Oltin Xaridini Qayd Etish"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Tables: Refining Batches & Gold Purchases */}
          <div className="space-y-4">
            {(activeVaultSection === "all" || activeVaultSection === "cash" || activeVaultSection === "refining") && (
              <div className="bg-white text-[#0F172A] p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="font-bold text-[#0F172A] text-sm">Afinaj Partiyalari Ro&apos;yxati (&quot;Lom pateriya&quot;)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-[#475569] border-b font-bold">
                      <tr>
                        <th className="p-2.5">Partiya №</th>
                        <th className="p-2.5">Sana</th>
                        <th className="p-2.5 text-right">Kiruvchi Lom</th>
                        <th className="p-2.5 text-right">Eritilgan</th>
                        <th className="p-2.5 text-right">Toza Oltin</th>
                        <th className="p-2.5 text-right">Toza Proba</th>
                        <th className="p-2.5 text-right">585 Eq</th>
                        <th className="p-2.5 text-right text-[#B91C1C]">Yo&apos;qotish</th>
                        <th className="p-2.5 text-right text-[#B91C1C]">% Pateriya</th>
                        <th className="p-2.5 text-right">Amallar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono">
                      {refiningBatches.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-[#0F172A]">{b.batch_no}</td>
                          <td className="p-2.5 text-[#475569]">{b.batch_date}</td>
                          <td className="p-2.5 text-right font-bold text-[#0F172A]">{formatScreenGrams(b.input_scrap_grams)}</td>
                          <td className="p-2.5 text-right text-[#475569]">{formatScreenGrams(b.melted_weight_grams)}</td>
                          <td className="p-2.5 text-right font-bold text-cyan-800">{formatScreenGrams(b.output_fine_grams)}</td>
                          <td className="p-2.5 text-right text-[#475569]">{b.output_fine_proba}</td>
                          <td className="p-2.5 text-right font-black text-[#0F172A]">{formatScreenGrams(b.output_585_equiv_grams)}</td>
                          <td className="p-2.5 text-right font-bold text-[#B91C1C]">{formatScreenGrams(b.total_loss_grams)}</td>
                          <td className="p-2.5 text-right font-black text-[#B91C1C]">{b.loss_pct}%</td>
                          <td className="p-2.5 text-right font-sans">
                            {b.status === "reversed" ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Bekor qilingan
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setReversalTarget({
                                    type: "refining_batch",
                                    id: b.id,
                                    docNo: b.batch_no,
                                    title: `Afinaj Partiyasi №${b.batch_no}`,
                                    details: `Kirim: ${formatScreenGrams(b.input_scrap_grams)} lom, Chiqim: ${formatScreenGrams(b.output_585_equiv_grams)} 585 eq`,
                                  });
                                  setReversalReason("");
                                }}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                              >
                                ↩️ Bekor qilish
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {refiningBatches.length === 0 && (
                        <tr>
                          <td colSpan={10} className="p-6 text-center text-[#475569] font-sans">
                            Hozircha afinaj partiyalari mavjud emas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(activeVaultSection === "all" || activeVaultSection === "cash" || activeVaultSection === "purchases") && (
              <div className="bg-white text-[#0F172A] p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="font-bold text-[#0F172A] text-sm">Oltin Xaridlari Tarixi (&quot;Tovar olish&quot;)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-[#475569] border-b font-bold">
                      <tr>
                        <th className="p-2.5">Xarid №</th>
                        <th className="p-2.5">Sana</th>
                        <th className="p-2.5">Yetkazib Beruvchi</th>
                        <th className="p-2.5 text-right">Sarflangan Naqd</th>
                        <th className="p-2.5 text-right">Kurs</th>
                        <th className="p-2.5 text-right">Vazn</th>
                        <th className="p-2.5 text-right">Proba</th>
                        <th className="p-2.5 text-right font-bold text-[#047857]">585 Eq</th>
                        <th className="p-2.5 text-right">Amallar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono">
                      {goldPurchases.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-[#0F172A]">{p.purchase_no}</td>
                          <td className="p-2.5 text-[#475569]">{p.purchase_date}</td>
                          <td className="p-2.5 font-sans font-medium text-[#0F172A]">{p.supplier_name}</td>
                          <td className="p-2.5 text-right font-bold text-[#047857]">
                            {p.currency === "MIXED" || (Number(p.cash_spent_uzs || 0) > 0 && Number(p.usd_spent || 0) > 0) ? (
                              <div>
                                <span>{formatScreenUZS(p.cash_spent_uzs)}</span>
                                <span className="block text-[11px] text-blue-600 font-mono">+${Number(p.usd_spent).toLocaleString()} USD</span>
                              </div>
                            ) : p.currency === "USD" || Number(p.usd_spent || 0) > 0 ? (
                              <span className="text-blue-700 font-mono">${Number(p.usd_spent).toLocaleString()} USD</span>
                            ) : (
                              formatScreenUZS(p.cash_spent_uzs)
                            )}
                          </td>
                          <td className="p-2.5 text-right text-[#475569]">
                            {p.currency === "MIXED" || (Number(p.cash_spent_uzs || 0) > 0 && Number(p.usd_spent || 0) > 0) ? (
                              <div>
                                <span>{Number(p.rate_per_gram).toLocaleString()} UZS</span>
                                {p.usd_rate ? <span className="block text-[10px] text-slate-500">($ {Number(p.usd_rate).toLocaleString()})</span> : null}
                              </div>
                            ) : p.currency === "USD" || Number(p.usd_spent || 0) > 0 ? (
                              `$${Number(p.rate_per_gram).toLocaleString()}/g`
                            ) : (
                              `${Number(p.rate_per_gram).toLocaleString()} UZS`
                            )}
                          </td>
                          <td className="p-2.5 text-right font-bold text-[#0F172A]">{formatScreenGrams(p.gold_weight_grams)}</td>
                          <td className="p-2.5 text-right text-[#475569]">{p.proba}</td>
                          <td className="p-2.5 text-right font-black text-[#047857]">{formatScreenGrams(p.equiv_585_grams)}</td>
                          <td className="p-2.5 text-right font-sans">
                            {p.status === "reversed" ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Bekor qilingan
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setReversalTarget({
                                    type: "gold_purchase",
                                    id: p.id,
                                    docNo: p.purchase_no,
                                    title: `Oltin Xaridi №${p.purchase_no}`,
                                    details: `${formatScreenGrams(p.gold_weight_grams)} (${p.proba}°) = ${formatScreenGrams(p.equiv_585_grams)} 585 eq`,
                                  });
                                  setReversalReason("");
                                }}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                              >
                                ↩️ Bekor qilish
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {goldPurchases.length === 0 && (
                        <tr>
                          <td colSpan={9} className="p-6 text-center text-[#475569] font-sans">
                            Hozircha oltin xaridlari mavjud emas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ISSUE CONSIGNMENT */}
      {activeTab === "consign" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={(e) => void handleIssueConsignment(e)}
            className="lg:col-span-1 bg-white text-[#0F172A] p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
          >
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Mahsulot Topshirish</h2>
              <p className="text-xs text-[#475569]">
                Zavod mahsulotini sotuvchiga belgilangan zavod ustamasi bilan berish.
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  Sotuvchi (Faqat faol sotuvchilar):
                </label>
                <select
                  id="consignSellerSelect"
                  value={consignSellerId}
                  onChange={(e) => setConsignSellerId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:ring-2 focus:ring-blue-500 outline-none text-xs text-[#0F172A]"
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
                <label className="block text-xs font-bold text-[#475569] mb-1">Tayyor Mahsulot (Vitrina):</label>
                <select
                  value={consignProductId}
                  onChange={(e) => handleProductSelect(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:ring-2 focus:ring-blue-500 outline-none text-xs text-[#0F172A]"
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
                  <label className="block text-xs font-bold text-[#475569] mb-1">Dona soni:</label>
                  <input
                    type="number"
                    min="1"
                    value={consignQty}
                    onChange={(e) => setConsignQty(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-[#0F172A]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">Asl Vazn (1 dona):</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={consignBaseWeight}
                    onChange={(e) => setConsignBaseWeight(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-[#0F172A]"
                    required
                  />
                </div>
              </div>

              {/* Dynamic Factory Markup selection */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-[#475569]">Zavod Ustamasi (%):</label>
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
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 rounded-2xl space-y-2 text-[#0F172A]">
                <div className="text-[11px] font-bold text-amber-900 uppercase">
                  Jonli Hisob-Kitob (Non-Compounding):
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Jami Asl Vazn:</span>
                  <span className="font-mono font-bold text-[#0F172A]">{formatScreenGrams(curBaseWeight)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#475569]">Zavod Ustamasi:</span>
                  <span className="font-mono font-bold text-amber-800">+{curFactoryMarkupNum}%</span>
                </div>
                <div className="border-t border-amber-200/80 pt-1 flex justify-between text-sm">
                  <span className="font-bold text-[#0F172A]">Zavod Majburiyati:</span>
                  <span className="font-mono font-black text-amber-950">
                    {formatScreenGrams(liveConsignCalc.factoryGoldDueGrams)}
                  </span>
                </div>
                <div className="text-[10px] text-amber-700 italic">
                  Formula: {formatScreenGrams(curBaseWeight)} × (1 + {curFactoryMarkupNum}/100) = {formatScreenGrams(liveConsignCalc.factoryGoldDueGrams)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">Izoh (ixtiyoriy):</label>
                <input
                  type="text"
                  placeholder="Partiya yoki topshirish shartlari..."
                  value={consignNotes}
                  onChange={(e) => setConsignNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A] placeholder:text-[#475569]"
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
          <div className="lg:col-span-2 bg-white text-[#0F172A] p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-[#0F172A]">Topshirilgan Konsignatsiyalar Ro&apos;yxati</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[#475569]">
                    <th className="py-2.5 px-3 font-semibold">№ Chek</th>
                    <th className="py-2.5 px-3 font-semibold">Sotuvchi</th>
                    <th className="py-2.5 px-3 font-semibold">Mahsulot</th>
                    <th className="py-2.5 px-3 font-semibold">Vazn</th>
                    <th className="py-2.5 px-3 font-semibold">Ustama</th>
                    <th className="py-2.5 px-3 font-semibold">Zavod Oltini</th>
                    <th className="py-2.5 px-3 font-semibold">Holat</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {consignments.map((c) => {
                    const isCancelled = c.status === "cancelled" || Boolean(c.cancelled_at);
                    const hasSales = Number(c.sold_quantity) > 0;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{c.consignment_no || c.id.slice(0, 8)}</td>
                        <td className="py-2.5 px-3 font-medium text-[#0F172A]">{c.seller?.name || c.seller?.full_name || "Sotuvchi"}</td>
                        <td className="py-2.5 px-3 text-[#475569]">{c.product_name || c.item_name}</td>
                        <td className="py-2.5 px-3 font-mono text-[#0F172A]">{formatScreenGrams(c.base_weight_grams)}</td>
                        <td className="py-2.5 px-3 font-bold text-amber-700">+{c.factory_markup_pct}%</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#0F172A]">
                          {formatScreenGrams(c.factory_gold_due_grams)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isCancelled
                              ? "bg-rose-100 text-rose-800 border border-rose-200"
                              : c.status === "held_by_seller"
                              ? "bg-amber-100 text-amber-800"
                              : c.status === "fully_sold"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-[#0F172A]"
                          }`}>
                            {isCancelled ? "Bekor qilingan" : c.status === "held_by_seller" ? "Sotuvchida" : c.status === "fully_sold" ? "Sotildi" : c.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isCancelled ? (
                            <span className="text-[11px] text-slate-400 italic font-mono">
                              Bekor bo&apos;lgan
                            </span>
                          ) : hasSales ? (
                            <button
                              type="button"
                              disabled
                              title="Dona sotilgan. Avval sotuv kvitansiyasini bekor qiling."
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                            >
                              🔒 Sotilgan
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setReversalTarget({
                                  type: "consignment",
                                  id: c.id,
                                  docNo: c.consignment_no || c.id.slice(0, 8),
                                  title: `Konsignatsiya №${c.consignment_no || c.id.slice(0, 8)}`,
                                  details: `${c.product_name || c.item_name} — ${formatScreenGrams(c.base_weight_grams)} (${c.seller?.name || "Sotuvchi"})`,
                                });
                                setReversalReason("");
                              }}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                            >
                              ↩️ Bekor qilish
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {consignments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-[#475569]">
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
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4 text-[#0F172A]">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-black text-[#0F172A] text-base">Zavod Ustamalari (Factory Markups)</h3>
                  <div className="text-xs text-[#475569]">Zavoddan sotuvchiga topshirishda qo&apos;llaniladi</div>
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
                        <span className="font-bold text-[#0F172A] text-sm">{p.name}</span>
                        <span className="bg-amber-100 text-amber-900 text-xs font-mono font-black px-2 py-0.5 rounded-lg">
                          +{p.percentage}%
                        </span>
                        {p.is_default && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            Standart
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#475569] mt-0.5">
                        Tartib raqami: {p.display_order} • Holat: {p.is_active ? "Faol (Sotuvchiga ko'rinadi)" : "Nofaol"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTogglePresetActive(p)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition ${
                          p.is_active
                            ? "border-slate-300 text-[#475569] hover:bg-slate-200"
                            : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                        }`}
                      >
                        {p.is_active ? "O'chirish" : "Faollashtirish"}
                      </button>
                      <button
                        onClick={() => handleEditPreset(p)}
                        className="text-xs px-2.5 py-1 rounded-lg font-bold bg-slate-200 hover:bg-slate-300 text-[#0F172A]"
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Client Markups Section */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4 text-[#0F172A]">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-black text-[#0F172A] text-base">Mijozga Sotish Ustamalari (Client Markups)</h3>
                  <div className="text-xs text-[#475569]">Sotuvchi mijozga nasiya yozishda faqat bularni tanlay oladi</div>
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
                        <span className="font-bold text-[#0F172A] text-sm">{p.name}</span>
                        <span className="bg-indigo-100 text-indigo-900 text-xs font-mono font-black px-2 py-0.5 rounded-lg">
                          +{p.percentage}%
                        </span>
                        {p.is_default && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            Standart
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#475569] mt-0.5">
                        Tartib raqami: {p.display_order} • Holat: {p.is_active ? "Faol (Sotuvchiga ko'rinadi)" : "Nofaol"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        data-preset-toggle={p.name}
                        onClick={() => handleTogglePresetActive(p)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition ${
                          p.is_active
                            ? "border-slate-300 text-[#475569] hover:bg-slate-200"
                            : "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                        }`}
                      >
                        {p.is_active ? "O'chirish" : "Faollashtirish"}
                      </button>
                      <button
                        onClick={() => handleEditPreset(p)}
                        className="text-xs px-2.5 py-1 rounded-lg font-bold bg-slate-200 hover:bg-slate-300 text-[#0F172A]"
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
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-[#0F172A]">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Mijozlar Umumiy Qarzdorlik Holati</h2>
              <p className="text-xs text-[#475569]">
                Barcha sotuvchilarga tegishli mijozlarning 585 lom oltin qarz va avans hisoblari.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[#475569]">
                  <th className="py-2.5 px-3 font-semibold">Mijoz Kodi</th>
                  <th className="py-2.5 px-3 font-semibold">Mijoz Ismi</th>
                  <th className="py-2.5 px-3 font-semibold">Telefon</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan (Lom)</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan (Naqd)</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan (USD)</th>
                  <th className="py-2.5 px-3 font-semibold">Hozirgi Qarz</th>
                  <th className="py-2.5 px-3 font-semibold">Avans (Ortiqcha)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clientAccounts.map((c) => {
                  const cust = c.customer || customers.find(cu => String(cu.id) === String(c.customer_id));
                  const adv = Number(c.advance_balance_grams || c.advance_gold_balance_grams || 0);
                  const usdPaid = Number(c.total_usd_paid_amount || 0);
                  const usdEquiv = Number(c.total_usd_equiv_grams || 0);
                  return (
                    <tr key={c.customer_id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {cust?.customer_code || "CUST-XXXX"}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#0F172A]">{cust?.contact_name || "Mijoz"}</td>
                      <td className="py-2.5 px-3 text-[#475569]">{cust?.phone || "—"}</td>
                      <td className="py-2.5 px-3 font-mono">{formatScreenGrams(c.total_scrap_paid_grams, 2)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                        {formatScreenUZS(c.total_cash_paid_amount)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {usdPaid > 0 ? (
                          <>
                            ${usdPaid.toLocaleString()} USD
                            {usdEquiv > 0 && (
                              <span className="block text-[10px] text-blue-500 font-normal">
                                ({formatScreenGrams(usdEquiv, 2)})
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-black text-rose-600 text-sm">
                        {formatScreenGrams(c.current_debt_grams || c.current_gold_debt_grams, 2)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {adv > 0
                          ? `+${formatScreenGrams(adv, 2)}`
                          : formatScreenGrams(0, 2)}
                      </td>
                    </tr>
                  );
                })}
                {clientAccounts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-[#475569]">
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
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 text-[#0F172A]">
          <h2 className="text-lg font-bold text-[#0F172A]">Oxirgi Tushum va Qaytimlar Arxivi</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[#475569]">
                  <th className="py-2.5 px-3 font-semibold">№ Kvitansiya</th>
                  <th className="py-2.5 px-3 font-semibold">Yo&apos;nalish</th>
                  <th className="py-2.5 px-3 font-semibold">Sotuvchi / Mijoz</th>
                  <th className="py-2.5 px-3 font-semibold">Lom Oltin</th>
                  <th className="py-2.5 px-3 font-semibold">Naqd Pul (UZS)</th>
                  <th className="py-2.5 px-3 font-semibold">Valyuta ($ USD)</th>
                  <th className="py-2.5 px-3 font-semibold">Oltin Kursi</th>
                  <th className="py-2.5 px-3 font-semibold">Jami Yopilgan</th>
                  <th className="py-2.5 px-3 font-semibold">Sana</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map((s) => {
                  const cust = s.customer || customers.find(cu => String(cu.id) === String(s.customer_id));
                  const seller = s.seller || employees.find(e => String(e.id) === String(s.seller_id));
                  const partyName = cust?.contact_name || seller?.name || seller?.full_name || "—";
                  const isReversed = s.status === "reversed" || Boolean(s.reversed_at);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{s.settlement_no}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isReversed
                            ? "bg-rose-100 text-rose-800 border border-rose-200"
                            : s.direction === "client_to_seller"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {isReversed ? "Bekor qilingan" : s.direction === "client_to_seller" ? "Mijoz → Sotuvchi" : "Sotuvchi → Menejer"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-[#0F172A]">
                        {partyName}
                      </td>
                      <td className="py-2.5 px-3 font-mono">{formatScreenGrams(s.scrap_weight_grams, 2)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                        {Number(s.cash_paid_amount || 0) > 0 ? (
                          <div>
                            {formatScreenUZS(s.cash_paid_amount)}
                            {Number(s.cash_equivalent_grams || 0) > 0 && (
                              <span className="block text-[10px] text-slate-500 font-normal">
                                ({formatScreenGrams(s.cash_equivalent_grams, 2)})
                              </span>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                        {Number(s.usd_paid_amount || s.usd_amount || 0) > 0 ? (
                          <div>
                            ${Number(s.usd_paid_amount || s.usd_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span className="block text-[10px] text-slate-500 font-normal">
                              @ {Number(s.applied_usd_rate || s.usd_rate_applied || 0).toLocaleString()} (
                              {formatScreenGrams(s.usd_equivalent_grams || 0, 2)})
                            </span>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#475569]">
                        {Number(s.gold_rate_applied).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#0F172A]">
                        {formatScreenGrams(s.total_settled_grams, 2)}
                      </td>
                      <td className="py-2.5 px-3 text-[#475569]">{s.settlement_date}</td>
                      <td className="py-2.5 px-3 text-center">
                        {isReversed ? (
                          <span className="text-[11px] text-slate-400 italic font-mono">
                            Bekor bo&apos;lgan
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReversalTarget({
                                type: "settlement",
                                id: s.id,
                                docNo: s.settlement_no || s.id.slice(0, 8),
                                title: `To'lov №${s.settlement_no || s.id.slice(0, 8)}`,
                                details: `${s.direction === "client_to_seller" ? "Mijoz → Sotuvchi" : "Sotuvchi → Menejer"}: ${partyName} — Lom: ${formatScreenGrams(s.scrap_weight_grams, 2)}, Pul: ${formatScreenUZS(s.cash_paid_amount)}`,
                                direction: s.direction,
                              });
                              setReversalReason("");
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition"
                          >
                            ↩️ Bekor qilish
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {settlements.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-[#475569]">
                      Hozircha hisob-kitoblar ro&apos;yxati bo&apos;sh.
                    </td>
                  </tr>
                )}
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
          availableFactoryReceipts={factoryReceipts.filter((r) => r.status !== "reversed")}
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
          models={models}
          factoryReceipts={factoryReceipts}
          onRefresh={loadData}
          loading={loading}
        />
      )}

      {/* TAB 8: BARTENDER MODELS & QR */}
      {activeTab === "models" && (
        <BarTenderModelManager
          models={models}
          onAddModel={handleAddNewModel}
          onUpdateModelPhoto={handleUpdateModelPhoto}
          isBusy={busy}
        />
      )}

      {/* TAB 9: SCANNER 564 DIAGNOSTICS */}
      {activeTab === "diagnostics" && <ScannerDiagnostics />}

      {/* TAB 10: USER MANAGEMENT & TELEGRAM */}
      {activeTab === "users" && <TelegramUsersSection />}

      {/* TAB 11: GOOGLE SHEETS IMPORT */}
      {activeTab === "sheets_import" && <SheetsImportSection />}


      {/* MODAL 1: DAILY SCRAP RATE */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={(e) => void handleSaveDailyRate(e)}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-amber-200 text-[#0F172A]"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-[#0F172A]">Kunlik Lom Kursini Kiritish</h3>
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
                <label className="block text-xs font-bold text-[#475569] mb-1">Kurs (1 gramm lom 585 uchun UZS):</label>
                <input
                  type="number"
                  step="1000"
                  value={newRateAmount}
                  onChange={(e) => setNewRateAmount(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-base font-bold text-[#0F172A] focus:ring-2 focus:ring-amber-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">Sana:</label>
                <input
                  type="date"
                  value={newRateDate}
                  onChange={(e) => setNewRateDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">Izoh:</label>
                <input
                  type="text"
                  placeholder="Bozor kursi bo'yicha tasdiqlandi..."
                  value={newRateNotes}
                  onChange={(e) => setNewRateNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
                />
              </div>

              <div className="text-[11px] text-[#475569] bg-slate-50 p-2.5 rounded-xl border">
                ℹ️ Qoida 6: Ushbu kurs bo&apos;yicha mijozdan olingan naqd pullar o&apos;sha operatsiya sanasidagi kurs bilan lom grammiga aylantiriladi va tarixiy qiymati o&apos;zgarmaydi.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowRateModal(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-100 text-[#475569]"
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
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-blue-200 text-[#0F172A]"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-lg text-[#0F172A]">
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
                <label className="block text-xs font-bold text-[#475569] mb-1">Toifa:</label>
                <select
                  value={presetType}
                  onChange={(e) => setPresetType(e.target.value as "factory_markup" | "client_markup")}
                  disabled={editingPreset != null}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-[#0F172A]"
                >
                  <option value="factory_markup">Zavod Ustamasi (Factory Markup)</option>
                  <option value="client_markup">Mijozga Sotish Ustamasi (Client Markup)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">Ustama Foizi (%):</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="Masalan: 14.5"
                    value={presetPercentage}
                    onChange={(e) => setPresetPercentage(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-sm text-[#0F172A]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">Tartib (Display Order):</label>
                  <input
                    type="number"
                    value={presetOrder}
                    onChange={(e) => setPresetOrder(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm text-[#0F172A]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">Nomi (Tavsifi):</label>
                <input
                  type="text"
                  placeholder="Masalan: Zavod 14% (Katta Partiya)"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
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
                <label htmlFor="presetDefaultCheck" className="text-xs text-[#475569] font-medium">
                  Ushbu toifa uchun standart (default) qilib belgilash
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPresetModalOpen(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-100 text-[#475569]"
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
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-indigo-200 text-[#0F172A]"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-[#0F172A]">Boshqaruvchiga Tushumni Qabul Qilish</h3>
                <div className="text-xs text-[#475569]">
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
                <div className="flex justify-between text-[#475569]">
                  <span>Sotuvchi kassasidagi lom:</span>
                  <span className="font-mono font-bold text-[#0F172A]">
                    {formatScreenGrams(surrenderSeller.seller_till_scrap_grams, 2)}
                  </span>
                </div>
                <div className="flex justify-between text-[#475569]">
                  <span>Sotuvchi kassasidagi naqd (UZS):</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {formatScreenUZS(surrenderSeller.seller_till_cash_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-[#475569]">
                  <span>Sotuvchi kassasidagi valyuta (USD):</span>
                  <span className="font-mono font-bold text-blue-700">
                    ${Number(surrenderSeller.seller_till_usd_amount || 0).toLocaleString()} USD
                  </span>
                </div>
                <div className="flex justify-between text-amber-900 font-semibold border-t pt-1">
                  <span>Sotuvchi majburiyati (Bozor qarzi):</span>
                  <span className="font-mono font-bold">
                    {formatScreenGrams(surrenderSeller.current_factory_obligation_grams || surrenderSeller.remaining_factory_gold_due_grams, 2)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  Qabul qilinayotgan Lom Oltin (g):
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={surrenderScrapWeight}
                  onChange={(e) => setSurrenderScrapWeight(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#0F172A]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    Naqd Pul (UZS):
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
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    Valyuta (USD $):
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={surrenderUsdAmount}
                    onChange={(e) => setSurrenderUsdAmount(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold text-blue-700"
                  />
                </div>
              </div>

              {Number(surrenderUsdAmount || 0) > 0 && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-[#475569]">
                      USD Kursi (UZS / 1$):
                    </label>
                    {cbuUsdRate && (
                      <button
                        type="button"
                        onClick={() => setSurrenderUsdRate(String(cbuUsdRate))}
                        className="text-[10px] text-blue-600 hover:underline"
                      >
                        MB: {cbuUsdRate.toLocaleString()}
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    placeholder="Masalan: 12800"
                    value={surrenderUsdRate}
                    onChange={(e) => setSurrenderUsdRate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm text-[#0F172A]"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">Izoh:</label>
                <input
                  type="text"
                  placeholder="Kassir qabul qildi..."
                  value={surrenderNotes}
                  onChange={(e) => setSurrenderNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-[#0F172A]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setSurrenderModalOpen(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-100 text-[#475569]"
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

      {/* 7-STEP SELLER RECONCILIATION MODAL (A-G) */}
      {selectedReconSeller && (
        <SellerReconciliationModal
          sellerId={selectedReconSeller.id}
          sellerName={selectedReconSeller.name}
          isOpen={reconModalOpen}
          onClose={() => {
            setReconModalOpen(false);
            setSelectedReconSeller(null);
          }}
        />
      )}

      {/* REVERSAL / CORRECTION CONFIRMATION MODAL */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 text-slate-800">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-xl font-black shrink-0">
                  ↩️
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{reversalTarget.title}</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{reversalTarget.details}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReversalTarget(null);
                  setReversalError(null);
                }}
                className="text-slate-400 hover:text-slate-700 font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
              <p className="font-bold">⚠️ Moliyaviy Kompensatsiya Ogohlantirishi:</p>
              <p>
                Ushbu operatsiya bazadan fizik o&apos;chirilmaydi! Barcha tegishli ombor, qarz va kassalarga audit qilingan teskari kompensatsiya yoziladi.
              </p>
            </div>

            {reversalError && (
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-rose-700">
                  <span>🛑</span> Server Xatoligi (Reversal Error):
                </div>
                <div className="font-mono text-[11px] whitespace-pre-wrap break-words">{reversalError}</div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Bekor qilish sababi (Audit talabi) <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="Masalan: Klient tovarini qaytardi, noto'g'ri raqam yoki xatolik sabab..."
                className="w-full text-xs p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => {
                  setReversalTarget(null);
                  setReversalError(null);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 transition"
              >
                Bekor qilmaslik
              </button>
              <button
                type="button"
                disabled={reversalBusy || !reversalReason.trim()}
                onClick={() => void handleExecuteReversal()}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {reversalBusy ? "Bajarilmoqda..." : "Tasdiqlash & Bekor qilish"}
              </button>
            </div>
          </div>
        </div>
      )}






    </div>
  );
}
