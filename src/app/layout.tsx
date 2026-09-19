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

  // XAVFSIZLIK (LOGIN) STATE'LARI
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);

  useEffect(() => {
    // Brauzer xotirasidan foydalanuvchi tizimga kirganini tekshiramiz
    const auth = localStorage.getItem("jf_auth");
    if (auth === "zargar_pro_ok") {
      setIsAuthenticated(true);
    }
    setIsChecking(false);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // MAXFIY PAROL (Hozircha 7777, xohlasangiz shu yerdan o'zgartiring)
    if (password === "7777") {
      localStorage.setItem("jf_auth", "zargar_pro_ok");
      setIsAuthenticated(true);
      setLoginError(false);
    } else {
      setLoginError(true);
      setPassword("");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("jf_auth");
    setIsAuthenticated(false);
  };

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

  // Tekshiruv vaqtida oq ekran bo'lib turadi
  if (isChecking) return <html lang="uz"><body></body></html>;

  // 1️⃣ AGAR PAROL KIRITILMAGAN BO'LSA - FAQAT LOGIN EKRANI CHIQADI
  if (!isAuthenticated) {
    return (
      <html lang="uz">
        <body className="flex h-screen bg-[#171923] items-center justify-center font-sans px-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm text-center transform transition-all duration-500">
            <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold text-3xl mx-auto mb-4 shadow-lg shadow-blue-500/30">J</div>
            <h1 className="text-2xl font-black text-gray-900 mb-1">JewelryFlow</h1>
            <p className="text-sm text-gray-500 mb-8 font-medium">Tizimga kirish uchun parolni kiriting</p>
            
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <input 
                  type="password" 
                  autoFocus
                  required
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  className={`w-full px-4 py-3 rounded-xl border-2 text-center text-xl tracking-[0.5em] font-black focus:outline-none transition-colors ${loginError ? 'border-red-400 bg-red-50 text-red-600 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'}`}
                  placeholder="••••" 
                />
                {loginError && <p className="text-red-500 text-xs font-bold mt-2">Parol xato! Qaytadan urinib ko'ring.</p>}
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20 text-lg">
                Tizimga kirish
              </button>
            </form>
          </div>
        </body>
      </html>
    );
  }

  // 2️⃣ AGAR PAROL TO'G'RI BO'LSA - ASOSIY DASTUR OCHILADI
  return (
    <html lang="uz">
      <body className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">
        <QueryClientProvider client={queryClient}>
          
          <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#171923] text-white flex items-center justify-between px-4 z-50 shadow-md">
            <div className="font-bold text-xl flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">J</div>
              JewelryFlow
            </div>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-2xl focus:outline-none">
              {isMobileMenuOpen ? "✕" : "☰"}
            </button>
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
            
            {/* CHIQISH TUGMASI (LOGOUT) */}
            <div className="p-4 bg-[#11121a]">
              <button 
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              >
                <span>🚪</span> Tizimdan chiqish
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto mt-16 md:mt-0 relative w-full scroll-smooth">
            {children}
          </div>
          
          {isMobileMenuOpen && <div onClick={() => setIsMobileMenuOpen(false)} className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"></div>}

        </QueryClientProvider>
      </body>
    </html>
  );
}