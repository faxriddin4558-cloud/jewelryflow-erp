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

  // MOTORNI ISHGA TUSHIRISH
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  const menuGroups = [
    {
      title: "",
      items: [
        { name: "Asosiy panel", path: "/", icon: "📊" },
      ]
    },
    {
      title: "MOLIYA VA SAVDO",
      items: [
        { name: "Sotuv va Kassa", path: "/sales", icon: "💰" },
        { name: "Buyurtmalar", path: "/orders", icon: "🛍️" },
      ]
    },
    {
      title: "ISHLAB CHIQARISH",
      items: [
        { name: "Partiyalar", path: "/batches", icon: "⚙️" },
        { name: "Proba / Ligatura", path: "/calculator", icon: "🧮" },
        { name: "Xodimlar", path: "/employees", icon: "👥" },
      ]
    },
    {
      title: "OMBOR VA NAZORAT",
      items: [
        { name: "Xomashyo", path: "/inventory", icon: "📦" },
        { name: "Sarfiyat", path: "/consumption", icon: "🔥" },
        { name: "Tayyor mahsulotlar", path: "/products", icon: "💎" },
      ]
    }
  ];

  return (
    <html lang="uz">
      {/* MANA O'SHA MAJBURIY BUYRUQLAR (To'g'ri joylashdi va to'liq yozildi) */}
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#171923" />
        <link rel="icon" href="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Diamond_emoji.png/192px-Diamond_emoji.png" />
        <link rel="apple-touch-icon" href="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Diamond_emoji.png/192px-Diamond_emoji.png" />
      </head>

      <body className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">
        <QueryClientProvider client={queryClient}>
          
          {/* MOBIL TELEFONLAR UCHUN TEPADAGI QORA SHAPKA */}
          <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#171923] text-white flex items-center justify-between px-4 z-50 shadow-md">
            <div className="font-bold text-xl flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">J</div>
              JewelryFlow
            </div>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-2xl focus:outline-none">
              {isMobileMenuOpen ? "✕" : "☰"}
            </button>
          </div>

          {/* ASOSIY QORA MENYU (SIDEBAR) */}
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
                          <Link 
                            href={item.path} 
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${isActive ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-white/10 hover:text-white text-gray-400'}`}
                          >
                            <span className="text-lg">{item.icon}</span>
                            <span className="font-medium text-sm">{item.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="p-4 bg-[#11121a] text-xs text-center text-gray-600 font-medium">
              ERP System v1.0
            </div>
          </div>

          {/* O'NG TOMON - ASOSIY OYNA */}
          <div className="flex-1 overflow-y-auto mt-16 md:mt-0 relative w-full scroll-smooth">
            {children}
          </div>
          
          {/* MOBILDA MENYU OCHILGANDA ORQA FONNI QORAYTIRISH */}
          {isMobileMenuOpen && <div onClick={() => setIsMobileMenuOpen(false)} className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"></div>}

        </QueryClientProvider>
      </body>
    </html>
  );
}