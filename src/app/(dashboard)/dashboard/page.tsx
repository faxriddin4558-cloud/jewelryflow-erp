"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function DashboardPage() {
  const [goldTx, setGoldTx] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [consumption, setConsumption] = useState<any[]>([]);

  useEffect(() => {
    const loadAll = async () => {
      const [g, b, o, s, m, c] = await Promise.all([
        supabase.from("gold_transactions").select("*"),
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("orders").select("*"),
        supabase.from("sales").select("*"),
        supabase.from("machines").select("*"),
        supabase.from("consumption").select("*")
      ]);
      if (g.data) setGoldTx(g.data);
      if (b.data) setBatches(b.data);
      if (o.data) setOrders(o.data);
      if (s.data) setSales(s.data);
      if (m.data) setMachines(m.data);
      if (c.data) setConsumption(c.data);
    };
    loadAll();
  }, []);

  // Jonli KPI hisob-kitoblari
  const vaultGold = goldTx.filter(t => t.transaction_type === "kirim").reduce((s, t) => s + Number(t.gross_weight || 0), 0);
  const vaultPure = goldTx.filter(t => t.transaction_type === "kirim").reduce((s, t) => s + Number(t.pure_gold || 0), 0);
  const activeBatches = batches.filter(b => b.status !== "Tugatildi");
  const wipGold = activeBatches.reduce((s, b) => s + Number(b.actual_gram || b.planned_gram || 0), 0);
  const totalLoss = consumption.reduce((s, c) => s + Number(c.loss_weight ?? (Number(c.given_weight || 0) - Number(c.returned_weight || 0))), 0);
  const kassaIn = sales.filter(s => s.tx_type !== "chiqim").reduce((s, x) => s + Number(x.total_amount || x.amount || 0), 0);
  const kassaOut = sales.filter(s => s.tx_type === "chiqim").reduce((s, x) => s + Number(x.total_amount || x.amount || 0), 0);
  const busyMachines = machines.filter(m => m.status === "band").length;

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">💎 JewelryFlow ERP — Boshqaruv Markazi</h1>
          <p className="text-xs text-slate-500 mt-1">Korxonaning barcha oltin qoldiqlari, partiyalar oqimi, yo'qotishlar va moliya ko'rsatkichlari</p>
        </div>
        <div className="flex gap-2">
          <Link href="/batches" className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm">+ Yangi Partiya</Link>
          <Link href="/inventory" className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm">+ Xomashyo Kirim</Link>
        </div>
      </div>

      {/* 6 TA ASOSIY KORXONA KPI KARTALARI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <span className="text-xs font-bold uppercase text-amber-600">📦 Ombordagi Xomashyo (Seyf)</span>
          <div className="text-2xl font-black text-slate-900 mt-1">{vaultGold.toFixed(2)} gr</div>
          <div className="text-xs text-slate-500 mt-1">Sof oltin (999.9) ekvivalenti: <b className="text-amber-700">{vaultPure.toFixed(2)} gr</b></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <span className="text-xs font-bold uppercase text-purple-600">⚙️ Ishlab chiqarishda (WIP)</span>
          <div className="text-2xl font-black text-slate-900 mt-1">{wipGold.toFixed(2)} gr <span className="text-sm font-semibold text-purple-600">({activeBatches.length} ta partiya)</span></div>
          <div className="text-xs text-slate-500 mt-1">Tugatilgan partiyalar: <b>{batches.length - activeBatches.length} ta</b></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <span className="text-xs font-bold uppercase text-red-600">🔥 Jami Pateriya (Yo'qotish)</span>
          <div className="text-2xl font-black text-red-600 mt-1">{totalLoss.toFixed(2)} gr</div>
          <div className="text-xs text-slate-500 mt-1">Qayd etilgan partiya hisobotlari: <b>{consumption.length} ta</b></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <span className="text-xs font-bold uppercase text-emerald-600">💰 Sof Kassa Balansi</span>
          <div className="text-2xl font-black text-emerald-600 mt-1">{(kassaIn - kassaOut).toLocaleString()} so'm</div>
          <div className="text-xs text-slate-500 mt-1">Jami sotuv amaliyotlari: <b>{sales.length} ta</b></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <span className="text-xs font-bold uppercase text-blue-600">🛍️ Mijoz Buyurtmalari (Zakazlar)</span>
          <div className="text-2xl font-black text-slate-900 mt-1">{orders.length} ta</div>
          <div className="text-xs text-slate-500 mt-1">Shoshilinch (VIP): <b className="text-red-600">{orders.filter(o => o.priority === "Shoshilinch (VIP)").length} ta</b></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <span className="text-xs font-bold uppercase text-indigo-600">🔬 Apparatlar va Lazerlar</span>
          <div className="text-2xl font-black text-slate-900 mt-1">{busyMachines} / {machines.length || 12} <span className="text-sm font-normal text-slate-500">band</span></div>
          <div className="text-xs text-emerald-600 font-semibold mt-1">Bo'sh uskunalar: {Math.max(0, (machines.length || 12) - busyMachines)} ta</div>
        </div>
      </div>

      {/* SO'NGGI PARTIYALAR HOLATI JADVALI */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-bold text-slate-800">🚀 Jarayondagi so'nggi partiyalar va texnologik bosqichlar</h2>
          <Link href="/batches" className="text-xs font-bold text-purple-600 hover:underline">Barchasini ko'rish →</Link>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
              <th className="p-3">Partiya No</th>
              <th className="p-3">Mahsulot</th>
              <th className="p-3">Mas'ul Usta</th>
              <th className="p-3">Joriy Bosqich (25-Step Flow)</th>
              <th className="p-3 text-right">Massa</th>
              <th className="p-3 text-center">Holati</th>
            </tr>
          </thead>
          <tbody>
            {batches.slice(0, 6).map((b, i) => (
              <tr key={i} className="border-b hover:bg-slate-50">
                <td className="p-3 font-bold text-slate-900">{b.batch_no || b.number || `B-00${i + 1}`}</td>
                <td className="p-3">{b.product_name || b.product || "Komplekt"}</td>
                <td className="p-3 text-blue-600 font-medium">{b.master_name || b.master || "Valijon"}</td>
                <td className="p-3"><span className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded text-xs font-semibold">{b.current_step || "7. Quyish"}</span></td>
                <td className="p-3 text-right font-bold">{Number(b.actual_gram || b.planned_gram || 0)} gr</td>
                <td className="p-3 text-center">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${b.status === "Tugatildi" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {b.status || "Jarayonda"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}