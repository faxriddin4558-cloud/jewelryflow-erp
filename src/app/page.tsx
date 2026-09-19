"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function Dashboard() {
  const [stats, setStats] = useState({
    orders: 0,
    batches: 0,
    inventoryCount: 0,
    totalRevenue: 0
  });
  
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    async function fetchData() {
      // Statistikalarni olish
      const [ordersRes, batchesRes, invRes, salesRes] = await Promise.all([
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('batches').select('*', { count: 'exact', head: true }),
        supabase.from('inventory').select('*', { count: 'exact', head: true }),
        supabase.from('sales').select('total_price')
      ]);

      const revenue = salesRes.data ? salesRes.data.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) : 0;

      setStats({
        orders: ordersRes.count || 0,
        batches: batchesRes.count || 0,
        inventoryCount: invRes.count || 0,
        totalRevenue: revenue
      });

      // So'nggi 5 ta sotuvni olish
      const { data: salesData } = await supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      if (salesData) setRecentSales(salesData);

      // Kutilayotgan buyurtmalarni (Kutilmoqda) olish
      const { data: ordersData } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'Kutilmoqda')
        .order('deadline', { ascending: true })
        .limit(5);
      if (ordersData) setPendingOrders(ordersData);

      setLoading(false);
    }
    
    fetchData();
  }, []);

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Asosiy panel (Boshqaruv)</h1>
        <div className="text-sm font-medium text-gray-500 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-100">
          Sana: {new Date().toLocaleDateString('uz-UZ')}
        </div>
      </div>
      
      {/* 4 TA ASOSIY KO'RSATKICH (KARTOCHKALAR) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-green-500 flex items-center justify-between transition-transform hover:scale-105">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Jami Tushum (Kassa)</p>
            <h3 className="text-2xl font-bold text-gray-900">{loading ? "..." : `${stats.totalRevenue.toLocaleString()}`} <span className="text-sm text-gray-500">so'm</span></h3>
          </div>
          <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-xl">💰</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-blue-500 flex items-center justify-between transition-transform hover:scale-105">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Jami Buyurtmalar</p>
            <h3 className="text-2xl font-bold text-gray-900">{loading ? "..." : stats.orders} <span className="text-sm text-gray-500">ta</span></h3>
          </div>
          <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xl">🛍️</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-purple-500 flex items-center justify-between transition-transform hover:scale-105">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Jarayondagi Partiyalar</p>
            <h3 className="text-2xl font-bold text-gray-900">{loading ? "..." : stats.batches} <span className="text-sm text-gray-500">ta</span></h3>
          </div>
          <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xl">⚙️</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-yellow-500 flex items-center justify-between transition-transform hover:scale-105">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Ombordagi Xomashyo</p>
            <h3 className="text-2xl font-bold text-gray-900">{loading ? "..." : stats.inventoryCount} <span className="text-sm text-gray-500">tur</span></h3>
          </div>
          <div className="w-12 h-12 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center text-xl">📦</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* SO'NGGI SOTUVLAR JADVALI */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">📈 So'nggi sotuvlar (Kassa)</h2>
            <Link href="/sales" className="text-sm text-blue-600 hover:underline font-medium">Barchasi &rarr;</Link>
          </div>
          <div className="p-0">
            <table className="w-full text-left text-sm text-gray-600">
              <tbody>
                {recentSales.map((sale, idx) => (
                  <tr key={idx} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="font-bold text-gray-900">{sale.client_name}</div>
                      <div className="text-xs text-gray-500">{new Date(sale.created_at).toLocaleDateString('uz-UZ')}</div>
                    </td>
                    <td className="px-5 py-4">{sale.product_name}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="font-bold text-green-600">+{Number(sale.total_price).toLocaleString()}</div>
                      <div className="text-xs font-medium text-gray-400">{sale.payment_type}</div>
                    </td>
                  </tr>
                ))}
                {recentSales.length === 0 && <tr><td colSpan={3} className="p-8 text-center text-gray-500">Sotuvlar yo'q</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* KUTILAYOTGAN BUYURTMALAR JADVALI */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">⏳ Kutilayotgan buyurtmalar</h2>
            <Link href="/orders" className="text-sm text-blue-600 hover:underline font-medium">Barchasi &rarr;</Link>
          </div>
          <div className="p-0">
            <table className="w-full text-left text-sm text-gray-600">
              <tbody>
                {pendingOrders.map((order, idx) => (
                  <tr key={idx} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="font-bold text-gray-900">{order.client_name}</div>
                      <div className="text-xs text-gray-500">{order.phone}</div>
                    </td>
                    <td className="px-5 py-4 truncate max-w-[150px]" title={order.product_details}>{order.product_details}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="text-xs text-gray-500 mb-1">Muddat:</div>
                      <span className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-bold">{order.deadline}</span>
                    </td>
                  </tr>
                ))}
                {pendingOrders.length === 0 && <tr><td colSpan={3} className="p-8 text-center text-gray-500">Kutilayotgan buyurtmalar yo'q</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}