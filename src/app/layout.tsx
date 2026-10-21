"use client";

import "./globals.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  supabase,
  RBAC,
  resolveEmployeeRole,
  type EmployeeRow,
} from "@/lib/erp-engine";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [queryClient] = useState(() => new QueryClient());
  const [sessionUser, setSessionUser] = useState(() => RBAC.getCurrentUser());

  // === PWA O'RNATISH (INSTALL) TIZIMI ===
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // Telegram Mini App compatibility initialization
    if (typeof window !== "undefined") {
      const tg = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void } } }).Telegram?.WebApp;
      if (tg) {
        try {
          tg.ready();
          tg.expand();
        } catch {}
      }
    }

    const unsubscribeRbac = RBAC.subscribe((updatedUser) => {
      setSessionUser(updatedUser);
    });

    const syncAuthSession = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          RBAC.resetUser();
          return;
        }

        let emp: EmployeeRow | null = null;
        const { data: byUserIdRows, error: byUserIdErr } = await supabase
          .from("employees")
          .select("*")
          .eq("user_id", user.id)
          .limit(1);

        if (!byUserIdErr && byUserIdRows && byUserIdRows[0]) {
          emp = byUserIdRows[0] as EmployeeRow;
        } else if (user.email) {
          const { data: byEmailRows, error: byEmailErr } = await supabase
            .from("employees")
            .select("*")
            .ilike("email", user.email.trim())
            .limit(1);
          if (!byEmailErr && byEmailRows && byEmailRows[0]) {
            emp = byEmailRows[0] as EmployeeRow;
          }
        }

        if (!emp) {
          const { data: byIdRows, error: byIdErr } = await supabase
            .from("employees")
            .select("*")
            .eq("id", user.id)
            .limit(1);
          if (!byIdErr && byIdRows && byIdRows[0]) {
            emp = byIdRows[0] as EmployeeRow;
          }
        }

        let resolvedRole = resolveEmployeeRole(emp);
        // Security guard: Director role is strictly reserved for verified, linked user_id accounts
        if (resolvedRole === "Director" && emp?.user_id !== user.id) {
          resolvedRole = "Worker";
        }
        const resolvedUser = {
          id: emp?.id != null ? String(emp.id) : user.id,
          email: user.email,
          name: emp?.name || emp?.full_name || user.email || "Tasdiqlangan Xodim",
          role: resolvedRole,
          department: emp?.department || "Ishlab chiqarish",
        };
        RBAC.setCurrentUser(resolvedUser);
      } catch {
        RBAC.resetUser();
      }
    };

    void syncAuthSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void syncAuthSession();
    });

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      unsubscribeRbac();
      authListener.subscription.unsubscribe();
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    RBAC.resetUser();
    setSessionUser(RBAC.getCurrentUser());
    router.push("/login");
    router.refresh();
  };

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/reset-password");

  const menuGroups = [
    { title: "", items: [{ name: "Asosiy panel", path: "/", icon: "📊" }] },
    {
      title: "MOLIYA VA SAVDO",
      items: [
        { name: "Sotuv va Kassa", path: "/sales", icon: "💰" },
        { name: "Buyurtmalar", path: "/orders", icon: "🛍️" },
      ],
    },
    {
      title: "ISHLAB CHIQARISH",
      items: [
        { name: "Partiyalar", path: "/batches", icon: "⚙️" },
        { name: "Sexlar va Operator", path: "/manufacturing", icon: "🏭" },
        { name: "Proba / Ligatura", path: "/calculator", icon: "🧮" },
        { name: "Xodimlar", path: "/employees", icon: "👥" },
      ],
    },
    {
      title: "OMBOR VA NAZORAT",
      items: [
        { name: "Xomashyo", path: "/inventory", icon: "📦" },
        { name: "Sarfiyat", path: "/consumption", icon: "🔥" },
        { name: "Tayyor mahsulotlar", path: "/products", icon: "💎" },
      ],
    },
    {
      title: "TAHLIL VA TIZIM",
      items: [
        { name: "Hisobotlar", path: "/reports", icon: "📑" },
        { name: "Sozlamalar", path: "/settings", icon: "⚙️" },
      ],
    },
  ];

  return (
    <html lang="uz">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-512x512.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#171923" />
      </head>
      <body className="flex h-screen bg-gray-50 overflow-hidden text-gray-900 font-sans">
        <QueryClientProvider client={queryClient}>
          {isAuthPage ? (
            <div className="flex-1 overflow-y-auto w-full bg-gray-50">{children}</div>
          ) : (
            <>
              <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#171923] text-white flex items-center justify-between px-4 z-50 shadow-md">
                <div className="font-bold text-xl flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">J</div>
                  JewelryFlow
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="text-2xl focus:outline-none"
                >
                  {isMobileMenuOpen ? "✕" : "☰"}
                </button>
              </div>

              <div
                className={`fixed inset-y-0 left-0 bg-[#171923] w-64 text-gray-300 flex flex-col transition-transform duration-300 z-40 md:relative md:translate-x-0 ${
                  isMobileMenuOpen ? "translate-x-0 mt-16 md:mt-0" : "-translate-x-full"
                }`}
              >
                <div className="p-6 hidden md:flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-600/30">
                    J
                  </div>
                  <span className="text-xl font-bold text-white tracking-wide">JewelryFlow</span>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                  {menuGroups.map((group, idx) => (
                    <div key={idx} className="mb-6">
                      {group.title && (
                        <div className="px-6 text-[11px] font-bold text-gray-500 mb-3 tracking-widest">
                          {group.title}
                        </div>
                      )}
                      <ul>
                        {group.items.map((item, i) => {
                          const isActive = pathname === item.path;
                          return (
                            <li key={i} className="px-3 mb-1">
                              <Link
                                href={item.path}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                                  isActive
                                    ? "bg-blue-600 text-white shadow-md"
                                    : "hover:bg-white/10 hover:text-white text-gray-400"
                                }`}
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

                <button
                  onClick={() => {
                    if (installPrompt) {
                      void installPrompt.prompt();
                    } else {
                      alert(
                        "Ilovani o'rnatish uchun brauzer menyusidagi (⋮) tugmani bosing va 'Ekranga qo'shish' bandini tanlang."
                      );
                    }
                  }}
                  className="mx-4 my-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 shadow-md transition-all border border-emerald-500"
                >
                  📱 Ilovani o&apos;rnatish
                </button>

                <div className="p-4 bg-[#11121a] text-xs text-center text-gray-400 font-medium border-t border-gray-800 space-y-1">
                  <div className="truncate text-gray-300 font-bold">{sessionUser.name}</div>
                  <div className="text-[11px] text-blue-400">Rol: {sessionUser.role}</div>
                  <button
                    onClick={() => void handleSignOut()}
                    className="mt-1 text-gray-400 hover:text-white transition underline"
                  >
                    Chiqish (Tizimdan chiqish)
                  </button>
                </div>
              </div>

              <div
                key={`${sessionUser.id ?? "anon"}-${sessionUser.role}`}
                className="flex-1 overflow-y-auto mt-16 md:mt-0 relative w-full scroll-smooth bg-gray-50"
              >
                {children}
              </div>
              {isMobileMenuOpen && (
                <div
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
                ></div>
              )}
            </>
          )}
        </QueryClientProvider>
      </body>
    </html>
  );
}