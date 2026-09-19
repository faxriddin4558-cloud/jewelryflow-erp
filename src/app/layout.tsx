"use client";

import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [queryClient] = useState(() => new QueryClient());

  // === PIN-KOD TIZIMI QAYTARILDI ===
  const [isPinAuthenticated, setIsPinAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
    // Xotiradan PIN kodni tekshirish
    if (localStorage.getItem('erp-pin') === '7777') {
      setIsPinAuthenticated(true);
    }
  }, []);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === '7777') {
      setIsPinAuthenticated(true);
      localStorage.setItem('erp-pin', '7777');
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  // AGAR PIN KOD KIRITILMAGAN BO'LSA, FAQAT SHU EKRAN CHIQADI
  if (!isPinAuthenticated) {
    return (
      <html lang="uz">
        <head>
          <link rel="manifest" href="/manifest.json" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="theme-color" content="#171923" />
        </head>
        <body className="flex h-screen items-center justify-center bg-[#171923] text-white font-sans">
          <form onSubmit={handlePinSubmit} className="bg-[#1e212b] p-8 rounded-2xl shadow-2xl flex flex-col items-center w-80 border border-gray-700">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-3xl mb-4 shadow-lg shadow-blue-600/50">💎</div>
            <h2 className="text-xl font-bold mb-6 tracking-wide text-gray-200">ERP Tizimiga kirish</h2>
            <input 
              type="password" 
              value={pinInput} 
              onChange={(e) => setPinInput(e.target.value)}
              className="w-full text-center text-3xl p-3 rounded-lg bg-[#171923] border border-gray-600 focus:border-blue-500 outline-none text-white tracking-[0.5em] mb-2"
              placeholder="••••" 
              maxLength={4} 
              autoFocus 
            />
            <div className="h-6 mb-2">
              {pinError && <p className="text-red-400 text-sm font-medium">PIN kod noto'g'ri!</p>}
            </div>
            <button type="submit" className="w-full bg-blue-600 p-3 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-md">
              KIRISH
            </button>
          </form>
        </body>
      </html>
    );
  }

  // === ASOSIY MENYULAR (PIN KODDAN O'TGANDAN KEYIN) ===
  const menuGroups = [
    { title: "", items: [{ name: "Asosiy panel", path: "/", icon: "📊" }] },
    { title: "MOLIYA VA SAVDO", items: [{ name: "Sotuv va Kassa", path: "/sales", icon: "💰" }, { name: "Buyurtmalar", path: "/orders", icon: "🛍️" }] },
    { title: "ISHLAB CHIQARISH", items: [{ name: "Partiyalar", path: "/batches", icon: "⚙️" }, { name: "Proba / Ligatura", path: "/calculator", icon: "🧮" }, { name: "Xodimlar", path: "/employees", icon: "👥" }] },
    { title: "OMBOR VA NAZORAT", items: [{ name: "Xomashyo", path: "/inventory", icon: "📦" }, { name: "Sarfiyat", path: "/consumption", icon: "🔥" }, { name: "Tayyor mahsulotlar", path: "/products", icon: "💎" }] }
  ];

  return (
    <html lang="uz">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#171923" />
      </head>
      <body className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">
        <QueryClientProvider client={queryClient}>
          <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#171923] text-white flex items-center justify-between px-4 z-50 shadow-md">
            <div className="font-bold text-xl flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">J</div>
              JewelryFlow
            </div>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-2xl focus:outline-none">{isMobileMenuOpen ? "✕" : "☰"}</button>
          </div>
          <div className={`fixed inset-y-0 left-0 bg-[#171923] w-64 text-gray-300 flex flex-col transition-transform duration-300 z-40 md:relative md:translate-x-0 ${isMobileMenuOpen ? "translate-x-0 mt-16 md:mt-0" : "-translate-x-full"}`}>
            <div className="p-6 hidden md:flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-600/30">J</div>
              <span className="text-xl font-bold text-white tracking-wide">JewelryFlow</span>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {menuGroups.map((group, idx) => (
                <div key={idx} className="mb-6">
                  {group.title && <div className="px-6 text-[11px] font-bold text-gray-500 mb-3 tracking-widest">{group.title}</div>}
                  <ul>
                    {group.items.map((item, i) => {
                      const isActive = pathname === item.path;
                      return (
                        <li key={i} className="px-3 mb-1">
                          <Link href={item.path} onClick={() => setIsMobileMenuOpen(false)} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${isActive ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-white/10 hover:text-white text-gray-400'}`}>
                            <span className="text-lg">{item.icon}</span><span className="font-medium text-sm">{item.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="p-4 bg-[#11121a] text-xs text-center text-gray-600 font-medium border-t border-gray-800">
              <button onClick={() => { localStorage.removeItem('erp-pin'); window.location.reload(); }} className="mt-2 text-gray-500 hover:text-white transition">Chiqish (Qulflash)</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto mt-16 md:mt-0 relative w-full scroll-smooth bg-gray-50">{children}</div>
          {isMobileMenuOpen && <div onClick={() => setIsMobileMenuOpen(false)} className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"></div>}
        </QueryClientProvider>
      </body>
    </html>
  );
}