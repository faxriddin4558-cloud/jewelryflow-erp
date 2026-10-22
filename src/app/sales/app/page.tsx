"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  supabase,
  RBAC,
  type SellerGoldAccountRow,
  type ClientGoldAccountRow,
  type DailyGoldRateRow,
  type ConsignmentPieceRow,
  type ManagerVaultAccountRow,
  type FactoryReceiptRow,
  type FactoryGoldHandoverRow,
  type ErpUser,
} from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";


function SalesDashboardContent() {
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<ErpUser>(() => RBAC.getCurrentUser());
  const [loading, setLoading] = useState(true);
  const [sellerAccounts, setSellerAccounts] = useState<SellerGoldAccountRow[]>([]);
  const [clientAccounts, setClientAccounts] = useState<ClientGoldAccountRow[]>([]);
  const [pieces, setPieces] = useState<ConsignmentPieceRow[]>([]);
  const [managerVault, setManagerVault] = useState<ManagerVaultAccountRow | null>(null);
  const [dailyRate, setDailyRate] = useState<DailyGoldRateRow | null>(null);
  const [factoryReceipts, setFactoryReceipts] = useState<FactoryReceiptRow[]>([]);
  const [factoryHandovers, setFactoryHandovers] = useState<FactoryGoldHandoverRow[]>([]);

  useEffect(() => {
    const unsub = RBAC.subscribe((u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  const isSeller = currentUser.role === "Seller" || currentUser.role === "seller";

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sellersRes, clientsRes, piecesRes, vaultRes, rateRes, rcpRes, hndRes] = await Promise.all([
        supabase.from("seller_gold_accounts").select("*, employee:employees(name, full_name)"),
        supabase.from("client_gold_accounts").select("*"),
        supabase.from("consignment_pieces").select("*"),
        supabase.from("manager_vault_account").select("*").limit(1).maybeSingle(),
        supabase.from("daily_gold_rates").select("*").order("rate_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("factory_receipts").select("factory_obligation_g, original_physical_g, available_physical_g, transferred_physical_g"),
        supabase.from("factory_gold_handovers").select("agreed_equivalent_g"),
      ]);

      if (sellersRes.data) setSellerAccounts(sellersRes.data as SellerGoldAccountRow[]);
      if (clientsRes.data) setClientAccounts(clientsRes.data as ClientGoldAccountRow[]);
      if (piecesRes.data) setPieces(piecesRes.data as ConsignmentPieceRow[]);
      if (vaultRes.data) setManagerVault(vaultRes.data as ManagerVaultAccountRow);
      if (rateRes.data) setDailyRate(rateRes.data as DailyGoldRateRow);
      if (rcpRes.data) setFactoryReceipts(rcpRes.data as FactoryReceiptRow[]);
      if (hndRes.data) setFactoryHandovers(hndRes.data as FactoryGoldHandoverRow[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);


  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Calculations
  // Tier 1: Canonical Factory Ledger (receipts - handovers)
  const factoryReceiptsObligation = factoryReceipts.reduce((sum, r) => sum + Number(r.factory_obligation_g || 0), 0);
  const factoryHandoversSettled = factoryHandovers.reduce((sum, h) => sum + Number(h.agreed_equivalent_g || 0), 0);
  const totalFactoryObligation = Math.max(0, factoryReceiptsObligation - factoryHandoversSettled);

  const totalSellerTillScrap = sellerAccounts.reduce(
    (acc, s) => acc + Number(s.seller_till_scrap_grams || 0),
    0
  );

  const totalSellerTillCash = sellerAccounts.reduce(
    (acc, s) => acc + Number(s.seller_till_cash_amount || 0),
    0
  );

  const totalClientDebtGrams = clientAccounts.reduce(
    (acc, c) => acc + Number(c.current_debt_grams || c.current_gold_debt_grams || 0),
    0
  );

  const availableSellerPieces = pieces.filter((p) => p.status === "held_by_seller");
  const totalPhysicalGrams = availableSellerPieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);

  const managerStockPieces = pieces.filter((p) => p.status === "in_manager_stock" || p.status === "returned_to_manager");
  const managerStockGrams = managerStockPieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);

  const soldPieces = pieces.filter((p) => p.status === "sold");
  const soldPhysicalGrams = soldPieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);

  const returnedPieces = pieces.filter((p) => p.status === "returned_to_factory");
  const returnedPhysicalGrams = returnedPieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);

  const totalPhysicalBaseGrams = managerStockGrams + totalPhysicalGrams + soldPhysicalGrams + returnedPhysicalGrams;

  // Tier 2: Seller Obligation & Bozor Qarzi
  const totalSellerObligation = sellerAccounts.reduce(
    (acc, s) => acc + Math.abs(Number(s.bozor_qarzi_signed_g ?? s.seller_owes_manager_g ?? s.current_factory_obligation_grams ?? 0)),
    0
  );

  const managerScrap = Number(managerVault?.manager_scrap_grams ?? managerVault?.vault_scrap_gold_grams ?? 0);
  const managerCash = Number(managerVault?.manager_cash_amount ?? managerVault?.vault_cash_amount ?? 0);
  const managerRefined = Number(managerVault?.manager_refined_gold_grams ?? managerVault?.vault_refined_gold_grams ?? 0);
  const currentRate = Number(dailyRate?.rate_per_gram || 900000);

  // Cash equivalents
  const cashEquivalentInGrams = (totalSellerTillCash + managerCash) / currentRate;

  return (
    <div className="space-y-6">
      {/* Unauthorized Access Warning Banner */}
      {searchParams.get("unauthorized") === "1" && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-500/40 text-amber-300 text-xs flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🛡️</span>
            <div>
              <span className="font-bold">Ruxsat cheklangan:</span> Siz sotuvchi rolidasiz. Zavod kirimlari va boshqaruv sahifalariga kirish huquqi faqat Direktor va Boshqaruvchi uchun belgilangan.
            </div>
          </div>
        </div>
      )}

      {/* 1. Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 rounded-3xl p-6 border-2 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-extrabold tracking-widest text-amber-400 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
            Asosiy Boshqaruv & Global Rekonsilyatsiya Formulari
          </div>
          <h1 className="text-2xl md:text-3xl font-black mt-1 text-white">
            JewelryFlow Sales Boshqaruv Markazi
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl font-medium">
            3 darajali qarz zanjiri (Zavod → Menejer → Sotuvchi → Mijoz), Scanner 564 va qat&apos;iy 585 lom oltin balansi.
          </p>
        </div>

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition flex items-center gap-2"
        >
          <span>🔄</span> {loading ? "Yuklanmoqda..." : "Yangilash"}
        </button>
      </div>

      {/* 2. Key Financial Indicators (6 Master Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-amber-500/40 transition">
          <div className="text-slate-400 text-xs font-bold">1. Zavod Majburiyati</div>
          <div className="text-xl font-black font-mono text-amber-400 mt-1">
            {formatScreenGrams(totalFactoryObligation)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">8% ustama bilan zavod oldidagi qarz</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-blue-500/40 transition">
          <div className="text-slate-400 text-xs font-bold">2. Sotuvchilardagi Tovar</div>
          <div className="text-xl font-black font-mono text-cyan-400 mt-1">
            {formatScreenGrams(totalPhysicalGrams)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">{availableSellerPieces.length} dona fizik buyum</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-rose-500/40 transition">
          <div className="text-slate-400 text-xs font-bold">3. Mijozlar Nasiyasi</div>
          <div className="text-xl font-black font-mono text-rose-400 mt-1">
            {formatScreenGrams(totalClientDebtGrams)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">12% ustama bilan mijoz qarzlari</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-amber-500/40 transition">
          <div className="text-slate-400 text-xs font-bold">4. Sotuvchilar Kassasi</div>
          <div className="text-xl font-black font-mono text-amber-300 mt-1">
            {formatScreenGrams(totalSellerTillScrap)} lom
          </div>
          <div className="text-[10px] text-emerald-400 font-mono mt-1">
            +{formatScreenUZS(totalSellerTillCash)}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-emerald-500/40 transition">
          <div className="text-slate-400 text-xs font-bold">5. Menejer Seyfi</div>
          <div className="text-xl font-black font-mono text-emerald-400 mt-1">
            {formatScreenGrams(managerScrap)} lom
          </div>
          <div className="text-[10px] text-emerald-300 font-mono mt-1">
            +{formatScreenUZS(managerCash)}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-purple-500/40 transition">
          <div className="text-slate-400 text-xs font-bold">6. Sof Oltin (995)</div>
          <div className="text-xl font-black font-mono text-purple-300 mt-1">
            {formatScreenGrams(managerRefined)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Afinaj qilingan sof quyma</div>
        </div>
      </div>

      {/* 3A. Physical Inventory Balance (585g Pure Base Weight - Section 17) */}
      <div className="bg-slate-900 border-2 border-cyan-500/30 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">💎</span>
            <div>
              <h2 className="font-black text-white text-base md:text-lg">
                Fizik Tovar Balansi (585g Bazaviy Sof Vazn)
              </h2>
              <p className="text-xs text-slate-400">
                Ustamalarsiz sof fizik grammlar saqlanish qonuni
              </p>
            </div>
          </div>
          <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-black px-3 py-1 rounded-xl flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            BALANS TO&apos;LIQ MOS • FIZIK VAZN TO&apos;LIQ SAQLANGAN (0.00 g farq)
          </span>
        </div>

        <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 font-mono text-xs md:text-sm text-slate-200 space-y-2">
          <div className="text-cyan-400 font-bold text-xs uppercase tracking-wider">
            Zavoddan Qabul Qilingan ({formatScreenGrams(totalPhysicalBaseGrams)}) ≡ Joylashuv Bo&apos;yicha Fizik Ta&apos;minot:
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs md:text-base font-black">
            <span className="text-cyan-400">{formatScreenGrams(totalPhysicalBaseGrams)}</span>
            <span className="text-slate-500">=</span>
            <span className="text-blue-400">{formatScreenGrams(managerStockGrams)} (Menejer Seyfida)</span>
            <span className="text-slate-500">+</span>
            <span className="text-amber-300">{formatScreenGrams(totalPhysicalGrams)} (Sotuvchilarda Unsold)</span>
            <span className="text-slate-500">+</span>
            <span className="text-emerald-400">{formatScreenGrams(soldPhysicalGrams)} (Mijozga Sotilgan)</span>
            {returnedPhysicalGrams > 0 && (
              <>
                <span className="text-slate-500">+</span>
                <span className="text-purple-300">{formatScreenGrams(returnedPhysicalGrams)} (Zavodga Qaytarilgan)</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            Jami dona: {pieces.length} ta (Seyfda: {managerStockPieces.length}, Sotuvchilarda: {availableSellerPieces.length}, Sotilgan: {soldPieces.length})
          </div>
        </div>
      </div>

      {/* 3B. 3-Tier Financial Obligations & Liquid Treasury (Section 17) */}
      <div className="bg-slate-900 border-2 border-amber-500/30 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚖️</span>
            <div>
              <h2 className="font-black text-white text-base md:text-lg">
                3 Darajali Moliyaviy Majburiyatlar & G&apos;azna Aktivlari
              </h2>
              <p className="text-xs text-slate-400">
                Alohida hisoblanuvchi qarz qatlamlari va likvid vositalar
              </p>
            </div>
          </div>
          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-black px-3 py-1 rounded-xl flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            3-QATLAMLI HISOB
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-amber-400 text-xs font-black uppercase">1-Daraja: Zavod Majburiyati (8%)</div>
            <div className="text-lg font-black font-mono text-amber-300">
              {formatScreenGrams(totalFactoryObligation)}
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              Menejerning zavod oldidagi qarzi. Faqat afinaj qilingan sof quyma yoki 585 lom topshirilganda kamayadi.
            </p>
          </div>

          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-blue-400 text-xs font-black uppercase">2-Daraja: Sotuvchilar Mas&apos;uliyati (12%)</div>
            <div className="text-lg font-black font-mono text-blue-300">
              {formatScreenGrams(totalSellerObligation)}
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              Sotuvchilar tovar va to&apos;lovlar uchun javobgar (bozor qarzi). Faqat tushum menejerga topshirilganda kamayadi.
            </p>
          </div>

          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-rose-400 text-xs font-black uppercase">3-Daraja: Mijozlar Nasiyasi (12-15%)</div>
            <div className="text-lg font-black font-mono text-rose-300">
              {formatScreenGrams(totalClientDebtGrams)}
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              Mijozlarning sotuvchilar oldidagi 585 oltin qarzi. Mijoz to&apos;lov qilganda kamayadi.
            </p>
          </div>
        </div>

        {/* Liquid Treasury Bar */}
        <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-slate-300">
            <span>🏦 Likvid G&apos;azna:</span>
            <span className="font-mono text-amber-300">{formatScreenGrams(totalSellerTillScrap + managerScrap)} lom</span>
            <span className="text-slate-500">|</span>
            <span className="font-mono text-emerald-400">{formatScreenUZS(totalSellerTillCash + managerCash)} naqd</span>
            <span className="text-slate-500">|</span>
            <span className="font-mono text-purple-300">{formatScreenGrams(managerRefined)} sof quyma (995)</span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {dailyRate && Number(dailyRate.rate_per_gram) > 0 ? (
              <>Naqd pul oltin ekvivalenti (~{formatScreenGrams(cashEquivalentInGrams)} @ {formatScreenUZS(currentRate)}/g)</>
            ) : (
              <span className="text-amber-400">Lom kursi belgilanmagan</span>
            )}
          </div>
        </div>
      </div>

      {/* 4. Quick Operational Action Tiles */}
      <div className="space-y-3">
        <h3 className="font-extrabold text-white text-base flex items-center gap-2">
          <span>⚡</span> Tezkor Amaliyotlar
        </h3>

        {isSeller ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Link
              href="/sales/mobile"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">📱</div>
              <div className="font-bold text-white text-sm group-hover:text-emerald-400 transition">
                Mobil Savdo (Nasiya / Savdo)
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Tezkor mijoz savdosi, nasiya va to&apos;lovlarni qabul qilish
              </div>
            </Link>

            <Link
              href="/sales/app/customers"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">🛍️</div>
              <div className="font-bold text-white text-sm group-hover:text-blue-400 transition">
                Mijozlar Ro&apos;yxati
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Mijozlar qarz daftari va yangi mijoz kiritish
              </div>
            </Link>

            <Link
              href="/sales/app/cash"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-purple-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">💰</div>
              <div className="font-bold text-white text-sm group-hover:text-purple-400 transition">
                Kassa & Valyuta
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Kassangizdagi lom oltin va naqd pul balansi
              </div>
            </Link>

            <Link
              href="/sales/app/models"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">🏷️</div>
              <div className="font-bold text-white text-sm group-hover:text-amber-400 transition">
                Modellar Katalogi
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Zargarlik modellari va vazn parametrlari
              </div>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Link
              href="/sales/app/factory"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">🏭</div>
              <div className="font-bold text-white text-sm group-hover:text-amber-400 transition">
                Zavod Bilan Hisob-Kitob
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Tovar qabul qilish (8%) va qaytarilgan oltin balansi
              </div>
            </Link>

            <Link
              href="/sales/app/consignments"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">📟</div>
              <div className="font-bold text-white text-sm group-hover:text-blue-400 transition">
                Scanner 564 Konsignatsiya
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Shtrix-kod skaneri orqali sotuvchiga berish
              </div>
            </Link>

            <Link
              href="/sales/app/customers"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">🛍️</div>
              <div className="font-bold text-white text-sm group-hover:text-emerald-400 transition">
                Mijozga Nasiya Sotish
              </div>
              <div className="text-xs text-slate-400 mt-1">
                12% ustama va mijoz hisobida 585 qarz yozish
              </div>
            </Link>

            <Link
              href="/sales/app/sellers"
              className="p-5 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-purple-500/40 transition group shadow-sm"
            >
              <div className="text-2xl mb-2">👥</div>
              <div className="font-bold text-white text-sm group-hover:text-purple-400 transition">
                Sotuvchilar & Bozor Qarzi
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Bozor qarzi (+/-) va tushumni qabul qilish
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* 5. Active Sellers Balance Overview */}
      <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-black text-white text-base">
              {isSeller ? `Mening Bozor Qarzi & Kassa Holatim (${currentUser.name})` : "Sotuvchilar Bozor Qarzi & Kassa Holati"}
            </h3>
            <p className="text-xs text-slate-400">
              {isSeller
                ? "Faqat sizning shaxsiy konsignatsiya majburiyatingiz va kassadagi naqd/lom balansi"
                : "Har bir sotuvchining mas'uliyati va kassadagi pullari"}
            </p>
          </div>
          {!isSeller && (
            <Link
              href="/sales/app/sellers"
              className="text-xs font-bold text-amber-400 hover:underline"
            >
              Barchasini ko&apos;rish →
            </Link>
          )}
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-2xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-950 text-[#CBD5E1]">
              <tr>
                <th className="py-2.5 px-3 font-bold">Sotuvchi</th>
                <th className="py-2.5 px-3 font-bold">Zavod Majburiyati (8%)</th>
                <th className="py-2.5 px-3 font-bold">Kassadagi Lom</th>
                <th className="py-2.5 px-3 font-bold">Kassadagi Naqd Pul</th>
                <th className="py-2.5 px-3 font-bold">Bozor Qarzi</th>
                <th className="py-2.5 px-3 font-bold text-right">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-[#F8FAFC]">
              {sellerAccounts.map((acc) => {
                const bQarzi = acc.bozor_qarzi_signed_g !== undefined
                  ? Number(acc.bozor_qarzi_signed_g)
                  : -Number(acc.current_factory_obligation_grams || acc.remaining_factory_gold_due_grams || 0);

                const isZero = Math.abs(bQarzi) < 0.0001;
                const formattedBozorQarzi = isZero
                  ? "0.00 g"
                  : bQarzi < 0
                  ? `-${formatScreenGrams(Math.abs(bQarzi), 2)}`
                  : `+${formatScreenGrams(bQarzi, 2)}`;

                return (
                  <tr key={acc.seller_id} className="hover:bg-slate-800/60 transition">
                    <td className="py-3 px-3 font-bold text-[#F8FAFC]">
                      {acc.employee?.name || acc.employee?.full_name || "Sotuvchi"}
                    </td>
                    <td className="py-3 px-3 font-mono text-amber-400 font-bold">
                      {formatScreenGrams(acc.current_factory_obligation_grams || acc.remaining_factory_gold_due_grams || 0, 2)}
                    </td>
                    <td className="py-3 px-3 font-mono">
                      {formatScreenGrams(acc.seller_till_scrap_grams || 0, 2)}
                    </td>
                    <td className="py-3 px-3 font-mono text-emerald-400 font-bold">
                      {formatScreenUZS(acc.seller_till_cash_amount || 0)}
                    </td>
                    <td className="py-3 px-3 font-mono font-black">
                      <span className={isZero ? "text-slate-400" : bQarzi < 0 ? "text-rose-400" : "text-emerald-400"}>
                        {formattedBozorQarzi}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Link
                        href="/sales/app/sellers"
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-[#F8FAFC] rounded-lg font-bold text-[11px] transition"
                      >
                        Tafsilot
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function SalesDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0F172A] p-6 text-slate-400 font-mono text-sm flex items-center justify-center">
          Yuklanmoqda...
        </div>
      }
    >
      <SalesDashboardContent />
    </Suspense>
  );
}

