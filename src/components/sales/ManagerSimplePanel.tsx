"use client";

// Goldia Sales — simple main screen for the director / manager (077). Read-only: it only shows the key balances
// (each in its own unit — physical grams, 585 grams, UZS, USD are never added together) and links to the actions.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { fetchManagerAvailableStockGrams } from "@/lib/sales-role-access";

type Totals = {
  managerStockG: number | null;
  managerScrapG585: number;
  managerUzs: number;
  managerUsd: number;
  factoryNetG585: number;
  sellerStockG: number;
  sellerOwesG585: number;
  sellerTillUzs: number;
  sellerTillUsd: number;
  sellerTillScrapG585: number;
  customerDebtG585: number;
  customerAdvanceG585: number;
  customerDebtUzs: number;
  customerDebtUsd: number;
};

const sum = <T,>(rows: T[] | null | undefined, f: (r: T) => unknown) => (rows ?? []).reduce((a, r) => a + Number(f(r) || 0), 0);
const usd = (v: number) => `$${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`;

export function ManagerSimplePanel() {
  const [t, setT] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [vault, sellers, clients, currency, stock] = await Promise.all([
      supabase.from("manager_vault_account").select("manager_scrap_grams, manager_cash_amount, manager_usd_amount, current_factory_obligation_g, current_factory_advance_g"),
      supabase.from("seller_gold_accounts").select("current_physical_stock_g, seller_owes_manager_g, seller_till_cash_amount, seller_till_usd_amount, seller_till_scrap_grams"),
      supabase.from("client_gold_accounts").select("current_debt_grams, advance_balance_grams"),
      supabase.from("client_currency_accounts").select("currency, debt_amount, advance_amount"),
      fetchManagerAvailableStockGrams(supabase),
    ]);
    const err = vault.error || sellers.error || clients.error;
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    // client_currency_accounts exists from migration 077; before it the currency totals are simply 0
    const cur = currency.error ? [] : (currency.data ?? []);
    setT({
      managerStockG: stock.data,
      managerScrapG585: sum(vault.data, (r) => r.manager_scrap_grams),
      managerUzs: sum(vault.data, (r) => r.manager_cash_amount),
      managerUsd: sum(vault.data, (r) => r.manager_usd_amount),
      factoryNetG585: sum(vault.data, (r) => Number(r.current_factory_obligation_g || 0) - Number(r.current_factory_advance_g || 0)),
      sellerStockG: sum(sellers.data, (r) => r.current_physical_stock_g),
      sellerOwesG585: sum(sellers.data, (r) => r.seller_owes_manager_g),
      sellerTillUzs: sum(sellers.data, (r) => r.seller_till_cash_amount),
      sellerTillUsd: sum(sellers.data, (r) => r.seller_till_usd_amount),
      sellerTillScrapG585: sum(sellers.data, (r) => r.seller_till_scrap_grams),
      customerDebtG585: sum(clients.data, (r) => r.current_debt_grams),
      customerAdvanceG585: sum(clients.data, (r) => r.advance_balance_grams),
      customerDebtUzs: sum(cur.filter((r) => r.currency === "UZS"), (r) => Number(r.debt_amount) - Number(r.advance_amount)),
      customerDebtUsd: sum(cur.filter((r) => r.currency === "USD"), (r) => Number(r.debt_amount) - Number(r.advance_amount)),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const Card = ({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) => (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4" data-testid={testid}>
      <div className="text-slate-400 text-xs font-bold">{title}</div>
      <div className="mt-1 space-y-0.5 font-mono text-white">{children}</div>
    </div>
  );

  return (
    <section className="space-y-3" data-testid="manager-simple-panel">
      {error && <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700 text-rose-200 text-xs">Ma&apos;lumot yuklanmadi: {error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Card title="🏦 Menejer ombori" testid="simple-manager-stock">
          <div className="text-xl font-black text-amber-300">{t ? (t.managerStockG != null ? formatScreenGrams(t.managerStockG) : "—") : "…"}</div>
          <div className="text-[11px] text-slate-400">fizik gramm (tayyor mahsulot)</div>
        </Card>
        <Card title="👥 Sotuvchilardagi oltin" testid="simple-seller-stock">
          <div className="text-xl font-black text-amber-300">{t ? formatScreenGrams(t.sellerStockG) : "…"}</div>
          <div className="text-[11px] text-slate-400">fizik gramm</div>
        </Card>
        <Card title="🛍️ Mijozlarning jami qarzi" testid="simple-customer-debt">
          <div className="text-lg font-black text-rose-300">{t ? formatScreenGrams(t.customerDebtG585) : "…"} <span className="text-[11px] text-slate-400">585</span></div>
          {t && t.customerAdvanceG585 > 0 && <div className="text-[11px] text-cyan-300">avans: {formatScreenGrams(t.customerAdvanceG585)}</div>}
          <div className="text-sm">{t ? formatScreenUZS(t.customerDebtUzs) : "…"}</div>
          <div className="text-sm">{t ? usd(t.customerDebtUsd) : "…"}</div>
        </Card>
        <Card title="📋 Sotuvchilar majburiyati" testid="simple-seller-obligation">
          <div className="text-xl font-black text-rose-300">{t ? formatScreenGrams(t.sellerOwesG585) : "…"}</div>
          <div className="text-[11px] text-slate-400">585 gramm (menejerga qaytarilishi kerak)</div>
        </Card>
        <Card title="💰 Kassa" testid="simple-cash">
          <div className="text-sm">Menejer: {t ? formatScreenUZS(t.managerUzs) : "…"} · {t ? usd(t.managerUsd) : "…"} · LOM {t ? formatScreenGrams(t.managerScrapG585) : "…"}</div>
          <div className="text-sm">Sotuvchilarda: {t ? formatScreenUZS(t.sellerTillUzs) : "…"} · {t ? usd(t.sellerTillUsd) : "…"} · LOM {t ? formatScreenGrams(t.sellerTillScrapG585) : "…"}</div>
        </Card>
        <Card title="🏭 Zavod majburiyati" testid="simple-factory">
          <div className="text-xl font-black text-amber-400">{t ? formatScreenGrams(t.factoryNetG585) : "…"}</div>
          <div className="text-[11px] text-slate-400">585 gramm (avans ayirilgan)</div>
        </Card>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="simple-actions">
        {([
          ["/sales/app/factory-receive", "🏭 Zavoddan kirim"],
          ["/sales/app/consignments", "📟 Sotuvchiga berish"],
          ["/sales/app/customers", "🛍️ Mijozlar va savdo"],
          ["/sales/app/handovers", "🤝 Kassa topshiruvi"],
          ["/sales/app/cash", "💰 Kassa va valyuta"],
          ["/sales/app/period-report", "📑 Davriy hisobot"],
        ] as [string, string][]).map(([href, label]) => (
          <Link key={href} href={href} className="px-3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-center text-xs font-bold text-white">
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}
