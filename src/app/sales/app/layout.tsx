"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  supabase,
  RBAC,
  resolveEmployeeRole,
  type DailyGoldRateRow,
  type ErpUser,
  type ErpRole,
} from "@/lib/erp-engine";

interface NavItem {
  name: string;
  href: string;
  icon: string;
  roles?: string[]; // Allowed roles (if omitted, all)
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAVIGATION_GROUPS: NavGroup[] = [
  {
    title: "BOSHQARUV & BALANS",
    items: [
      { name: "Asosiy Panel", href: "/sales/app", icon: "📊" },
      { name: "Zavod Bilan Hisob", href: "/sales/app/factory", icon: "🏭", roles: ["Director", "Production Manager", "manager"] },
    ],
  },
  {
    title: "OMBOR & KONSIGNATSIYA",
    items: [
      { name: "Boshqaruvchi Ombori", href: "/sales/app/inventory", icon: "🏦", roles: ["Director", "Production Manager", "manager"] },
      { name: "Scanner 564 Tarqatish", href: "/sales/app/consignments", icon: "📟", roles: ["Director", "Production Manager", "manager"] },
    ],
  },
  {
    title: "SAVDO & KASSALAR",
    items: [
      { name: "Sotuvchilar & Bozor Qarzi", href: "/sales/app/sellers", icon: "👥", roles: ["Director", "Production Manager", "manager"] },
      { name: "Mijozlar va Nasiya", href: "/sales/app/customers", icon: "🛍️" },
      { name: "Kassa & Valyuta", href: "/sales/app/cash", icon: "💰" },
    ],
  },
  {
    title: "AFINAJ & ZAVOD BALANSI",
    items: [
      { name: "Afinaj / Lom Pateriya", href: "/sales/app/refining", icon: "⚗️", roles: ["Director", "Production Manager", "manager"] },
      { name: "Naqdga Oltin Xarid", href: "/sales/app/purchases", icon: "🪙", roles: ["Director", "Production Manager", "manager"] },
    ],
  },
  {
    title: "TAHLIL & TIZIM",
    items: [
      { name: "Moliyaviy Hisobotlar", href: "/sales/app/reports", icon: "📑", roles: ["Director", "Production Manager", "manager", "Accountant"] },
      { name: "BarTender & Modellar", href: "/sales/app/models", icon: "🏷️" },
      { name: "Xodimlar & Telegram", href: "/sales/app/users", icon: "👤", roles: ["Director", "Production Manager", "manager"] },
      { name: "Sozlamalar & Import", href: "/sales/app/settings", icon: "⚙️", roles: ["Director", "Production Manager", "manager"] },
    ],
  },
];

export default function SalesAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<ErpUser>(() => RBAC.getCurrentUser());
  const [dailyRate, setDailyRate] = useState<DailyGoldRateRow | null>(null);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isMounted, setIsMounted] = useState(false);

  // Rate update modal
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [newRateValue, setNewRateValue] = useState("900000");

  useEffect(() => {
    setIsMounted(true);
    // Monitor RBAC user
    const unsub = RBAC.subscribe((u) => setCurrentUser(u));

    // Online / Offline listeners
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);

    // Sync user session from Supabase Auth
    const syncAuthSession = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const userMeta = (user.user_metadata || {}) as Record<string, unknown>;
          const cleanEmail = (user.email || "").trim().toLowerCase();

          // Lookup matching employee
          const { data: empData } = await supabase
            .from("employees")
            .select("*")
            .or(`email.ilike.${cleanEmail},name.ilike.%${cleanEmail.split("@")[0]}%`)
            .limit(1);

          const matchedEmp = empData && empData.length > 0 ? empData[0] : null;
          const resolvedRole = matchedEmp
            ? resolveEmployeeRole(matchedEmp)
            : (userMeta.role_type === "director" || userMeta.role === "admin"
                ? "Director"
                : userMeta.role_type === "seller" || userMeta.role === "sales"
                ? "Seller"
                : "Production Manager");

          const resolvedName =
            matchedEmp?.name ||
            matchedEmp?.full_name ||
            (userMeta.full_name as string) ||
            cleanEmail.split("@")[0] ||
            "Xodim";

          RBAC.setCurrentUser({
            id: matchedEmp?.id || user.id,
            name: resolvedName,
            email: cleanEmail,
            role: resolvedRole as ErpRole,
            department: matchedEmp?.department || (userMeta.department as string) || "Savdo",
          });
        }
      } catch {
        // ignore
      }
    };
    void syncAuthSession();

    // Load daily rate
    const loadRate = async () => {
      try {
        const { data } = await supabase
          .from("daily_gold_rates")
          .select("*")
          .order("rate_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data && data.rate_per_gram) {
          setDailyRate(data as DailyGoldRateRow);
          setNewRateValue(String(data.rate_per_gram));
        } else {
          setDailyRate(null);
          setNewRateValue("");
        }
      } catch {
        setDailyRate(null);
        setNewRateValue("");
      }
    };
    void loadRate();

    return () => {
      unsub();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // F01 Route Guard: prevent sellers from accessing privileged manager/director pages directly
  useEffect(() => {
    if (!currentUser || !pathname) return;
    const isSeller = currentUser.role === "Seller" || currentUser.role === "seller";
    const RESTRICTED_FOR_SELLER = [
      "/sales/app/factory",
      "/sales/app/factory-receive",
      "/sales/app/refining",
      "/sales/app/purchases",
      "/sales/app/consignments",
      "/sales/app/users",
      "/sales/app/settings",
      "/sales/app/sellers",
      "/sales/app/inventory",
    ];

    if (isSeller && RESTRICTED_FOR_SELLER.some((prefix) => pathname.startsWith(prefix))) {
      router.replace("/sales/app?unauthorized=1");
    }
  }, [currentUser, pathname, router]);

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateNum = parseFloat(newRateValue);
    if (!rateNum || rateNum <= 0) return;

    try {
      const today = new Date().toISOString().split("T")[0];
      const idempotencyKey = `daily_rate_${today}_${Date.now()}`;

      // Try canonical RPC first
      const { error: rpcErr } = await supabase.rpc("rpc_set_daily_gold_rate", {
        p_rate_per_gram: rateNum,
        p_proba: 585,
        p_rate_date: today,
        p_currency: "UZS",
        p_notes: "Savdo ilovasidan yangilandi",
        p_idempotency_key: idempotencyKey,
      });

      if (rpcErr) {
        // Direct upsert fallback
        await supabase.from("daily_gold_rates").upsert(
          {
            rate_date: today,
            proba: 585,
            rate_per_gram: rateNum,
            currency: "UZS",
            notes: "Savdo ilovasidan yangilandi",
            is_confirmed: true,
          },
          { onConflict: "organization_id, rate_date, proba" }
        );
      }

      // Re-fetch latest confirmed rate
      const { data: latest } = await supabase
        .from("daily_gold_rates")
        .select("*")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest && latest.rate_per_gram) {
        setDailyRate(latest as DailyGoldRateRow);
      }
      setRateModalOpen(false);
    } catch {
      setRateModalOpen(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    RBAC.resetUser();
    if (typeof window !== "undefined") {
      window.location.href = "/sales/login";
    } else {
      router.push("/sales/login");
      router.refresh();
    }
  };

  const roleName = isMounted ? (currentUser.role || "Worker") : "Worker";
  const isSeller = isMounted && (roleName.toLowerCase() === "seller" || roleName.toLowerCase() === "sotuvchi");
  const displayName = isMounted ? (currentUser.name || "Foydalanuvchi") : "Foydalanuvchi";
  const displayEmail = isMounted ? (currentUser.email || "Lokal sessiya") : "Lokal sessiya";
  const avatarLetter = isMounted && currentUser.name ? currentUser.name.slice(0, 1).toUpperCase() : "U";

  const isStaging =
    isMounted &&
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_APP_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_APP_ENV === "staging" ||
      process.env.NEXT_PUBLIC_STAGING_MODE === "true" ||
      window.location.hostname.includes("staging"));

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Offline Status Warning Bar */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-rose-600 text-white text-xs font-black py-1.5 px-4 text-center shadow-lg flex items-center justify-center gap-2">
          <span>⚠️</span>
          <span>Internet aloqasi yo&apos;q! Moliyaviy xavfsizlik uchun yozish amallari faqat onlayn rejimda ishlaydi.</span>
        </div>
      )}

      {/* Backdrop for Mobile Drawer */}
      {isMobileDrawerOpen && (
        <div
          onClick={() => setIsMobileDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* ========================================================================= */}
      {/* 1. PERMANENT VERTICAL LEFT SIDEBAR (Desktop 260px+, Fixed, Custom Scroll) */}
      {/* ========================================================================= */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 md:w-72 bg-[#0b1120] border-r border-slate-800/80 flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
          isMobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <Link href="/sales/app" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-400 to-amber-200 text-slate-950 flex items-center justify-center font-black text-base shadow-lg shadow-amber-500/20 border border-amber-300">
              JF
            </div>
            <div>
              <div className="font-black text-white text-base tracking-tight flex items-center gap-1.5">
                JewelryFlow <span className="text-amber-400 text-xs px-1.5 py-0.5 rounded-md bg-amber-400/10 border border-amber-400/30">585</span>
              </div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                Savdo & Boshqaruv
              </div>
            </div>
          </Link>
          <button
            onClick={() => setIsMobileDrawerOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white text-lg p-1"
          >
            ✕
          </button>
        </div>

        {/* Current User Card */}
        <div className="p-3 mx-3 my-2 bg-slate-900/90 rounded-2xl border border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 truncate">
              <div
                suppressHydrationWarning
                className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-amber-400 text-xs"
              >
                {avatarLetter}
              </div>
              <div className="truncate">
                <div suppressHydrationWarning className="font-bold text-white truncate">{displayName}</div>
                <div suppressHydrationWarning className="text-[10px] text-slate-400 font-mono truncate">{displayEmail}</div>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              title="Chiqish"
              className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition text-sm"
            >
              🚪
            </button>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px]">
            <span
              suppressHydrationWarning
              className={`px-2 py-0.5 rounded-md font-black tracking-wider uppercase ${
                isSeller
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : roleName === "Director"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
              }`}
            >
              {roleName}
            </span>
            <span className="text-slate-400 flex items-center gap-1 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Onlayn
            </span>
          </div>
        </div>

        {/* Daily Gold Rate Card */}
        <div className="mx-3 mb-2 p-2.5 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 rounded-2xl border border-amber-500/30 flex items-center justify-between text-xs shadow-sm">
          <div>
            <div className="text-[10px] uppercase font-bold text-amber-400">Bugungi Lom (585)</div>
            <div className="font-mono font-black text-white text-sm">
              {dailyRate && Number(dailyRate.rate_per_gram) > 0 ? (
                <>
                  {Number(dailyRate.rate_per_gram).toLocaleString()}
                  <span className="text-[10px] text-slate-400 font-normal"> UZS/g</span>
                </>
              ) : (
                <span className="text-amber-400 font-bold text-xs">Kurs belgilanmagan</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setRateModalOpen(true)}
            className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-[11px] rounded-lg transition"
          >
            ⚙️ Kurs
          </button>
        </div>

        {/* Navigation Items (15 Operational Destinations) */}
        <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-4 text-xs font-semibold scrollbar-thin scrollbar-thumb-slate-800">
          {NAVIGATION_GROUPS.map((group, gIdx) => {
            // Filter items by role if specified
            const visibleItems = group.items.filter((item) => {
              if (!item.roles) return true;
              return item.roles.includes(roleName);
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={gIdx} className="space-y-1">
                <div className="px-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsMobileDrawerOpen(false)}
                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition ${
                          isActive
                            ? "bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30 shadow-sm"
                            : "text-slate-300 hover:bg-slate-900 hover:text-white"
                        }`}
                      >
                        <span className="text-base">{item.icon}</span>
                        <span className="truncate">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom Sidebar Utility */}
        <div className="p-3 border-t border-slate-800 text-[11px] space-y-1.5 text-slate-400">
          <Link
            href="/sales/mobile"
            className="flex items-center justify-between p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-blue-300 font-bold transition border border-slate-800"
          >
            <span className="flex items-center gap-2">
              <span>📱</span> Mobil PWA Ko&apos;rinish
            </span>
            <span>→</span>
          </Link>
          <div className="text-center text-[10px] text-slate-600 pt-1">
            JewelryFlow Sales • 2026
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. MAIN CONTENT AREA WITH TOP BAR */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-900">
        {/* Staging Notice Bar */}
        {isStaging && (
          <div className="bg-amber-500 text-slate-950 px-4 py-1.5 flex items-center justify-between text-xs font-black shadow-md border-b border-amber-600 shrink-0 z-30">
            <div className="flex items-center gap-2">
              <span className="bg-slate-950 text-amber-300 text-[10px] uppercase font-black px-1.5 py-0.5 rounded">
                STAGING DEMO
              </span>
              <span className="font-semibold text-slate-950 text-[11px] md:text-xs">
                Alohida Staging Muhiti • Faqat sun&apos;iy test ma&apos;lumotlari • Real productionga bog&apos;lanmagan
              </span>
            </div>
            <span className="font-mono text-[10px] md:text-xs font-bold text-slate-900 hidden sm:inline">
              Safe Demo Mode
            </span>
          </div>
        )}

        {/* Top Header */}
        <header className="h-14 bg-[#0b1120] border-b border-slate-800 px-4 md:px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileDrawerOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-slate-800 text-slate-200 hover:text-white focus:outline-none"
            >
              ☰
            </button>
            <div className="text-xs md:text-sm font-bold text-slate-300 flex items-center gap-2">
              <span className="text-amber-400 font-black">Savdo Markazi</span>
              <span className="text-slate-600">/</span>
              <span className="text-white capitalize">
                {pathname.replace("/sales/app", "").replace("/", "") || "Asosiy Panel"}
              </span>
            </div>
          </div>

          {/* Quick Actions in Header */}
          <div className="flex items-center gap-2">
            <Link
              href="/sales/app/consignments"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow-md shadow-amber-500/20"
            >
              <span>⚡</span> Scanner 564
            </Link>
            <Link
              href="/sales/app/customers"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition border border-slate-700"
            >
              <span>+</span> Yangi Nasiya
            </Link>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition border border-slate-700 flex items-center gap-1"
            >
              <span>🚪</span> <span className="hidden sm:inline">Chiqish</span>
            </button>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-6 text-[#F8FAFC]">
          {children}
        </main>
      </div>

      {/* Gold Rate Update Modal */}
      {rateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveRate}
            className="bg-slate-900 border-2 border-amber-500/40 text-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-amber-400 flex items-center gap-2">
                <span>⚙️</span> Bugungi Lom Kursi (585)
              </h3>
              <button
                type="button"
                onClick={() => setRateModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
                Kurs (1 gramm 585 uchun UZS):
              </label>
              <input
                type="number"
                step="1000"
                min="100000"
                required
                value={newRateValue}
                onChange={(e) => setNewRateValue(e.target.value)}
                placeholder="Masalan: 900000"
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-xl font-mono text-lg font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRateModalOpen(false)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition"
              >
                Bekor qilish
              </button>
              <button
                type="submit"
                disabled={!newRateValue || parseFloat(newRateValue) <= 0}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition"
              >
                Saqlash
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
