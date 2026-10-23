"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  supabase,
  RBAC,
  resolveEmployeeRole,
  type EmployeeRow,
  type ErpRole,
} from "@/lib/erp-engine";

interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramWebAppObject {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    auth_date?: number;
    hash?: string;
  };
  ready?: () => void;
  expand?: () => void;
  close?: () => void;
}

const DEMO_EMAILS = [
  "director@goldia.uz",
  "manager@goldia.uz",
  "seller@goldia.uz",
  "dilshod@jewelryflow.uz",
  "jasur@jewelryflow.uz",
  "worker@goldia.uz",
  "accountant@goldia.uz",
];

function SalesLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Telegram WebApp detection
  const [tgUser, setTgUser] = useState<TelegramWebAppUser | null>(null);
  const [tgInitData, setTgInitData] = useState<string>("");
  const [tgLinkCode, setTgLinkCode] = useState<string>("");
  const [tgIsChecking, setTgIsChecking] = useState<boolean>(false);
  const [tgNeedsOtp, setTgNeedsOtp] = useState<boolean>(false);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isStaging =
    isMounted &&
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_APP_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_APP_ENV === "staging" ||
      process.env.NEXT_PUBLIC_STAGING_MODE === "true" ||
      window.location.hostname.includes("staging"));

  const isLocalPilot =
    isMounted &&
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_APP_ENV !== "production" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      process.env.NEXT_PUBLIC_APP_ENV === "local_offline");

  const isProduction =
    isMounted &&
    typeof window !== "undefined" &&
    (process.env.NEXT_PUBLIC_APP_ENV === "production" ||
      (!isStaging && !isLocalPilot && !window.location.hostname.includes("staging")));

  const showDemoSwitcher = !isProduction && (isLocalPilot || isStaging);

  // Check Telegram WebApp on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebAppObject } }).Telegram?.WebApp;
    if (tg && tg.initData) {
      try {
        tg.ready?.();
        tg.expand?.();
      } catch {}

      setTgInitData(tg.initData);
      const user = tg.initDataUnsafe?.user;
      if (user) {
        setTgUser(user);
      }

      // Check if this Telegram account is already linked to an employee
      void verifyTelegramAccount(tg.initData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const verifyTelegramAccount = async (initData: string) => {
    setTgIsChecking(true);
    try {
      const res = await fetch("/api/sales/telegram/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.linked && data.employee) {
        // Successfully recognized linked employee
        setSuccessMessage(`Xush kelibsiz, ${data.employee.name || data.employee.full_name} (${data.role})!`);
        
        // Set session user
        RBAC.setCurrentUser({
          id: data.employee.id,
          name: data.employee.name || data.employee.full_name,
          email: data.employee.email,
          role: (data.role || "Seller") as ErpRole,
          department: data.employee.department || "Savdo",
        });

        // Record audit
        await recordAuditLog(data.employee.id, data.employee.email, data.role, "telegram", "success");

        // Redirect based on role
        setTimeout(() => {
          redirectUserAfterLogin(data.role);
        }, 600);
      } else {
        // Not linked yet — prompt for 6-digit OTP
        setTgNeedsOtp(true);
      }
    } catch {
      setTgNeedsOtp(true);
    } finally {
      setTgIsChecking(false);
    }
  };

  const handleLinkTelegramWithOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tgLinkCode.trim()) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/sales/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkCode: tgLinkCode.trim(),
          initData: tgInitData,
          telegramUserId: tgUser ? String(tgUser.id) : undefined,
          telegramUsername: tgUser?.username,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.error || "Ulanish kodi noto'g'ri yoki muddati o'tgan");
        setLoading(false);
        return;
      }

      setSuccessMessage(`Telegram muvaffaqiyatli bog'landi: ${data.employee.name || data.employee.full_name}!`);
      
      RBAC.setCurrentUser({
        id: data.employee.id,
        name: data.employee.name || data.employee.full_name,
        email: data.employee.email,
        role: (data.role || "Seller") as ErpRole,
        department: data.employee.department || "Savdo",
      });

      await recordAuditLog(data.employee.id, data.employee.email, data.role, "telegram", "success");

      setTimeout(() => {
        redirectUserAfterLogin(data.role);
      }, 700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Ulanishda xatolik: ${msg}`);
      setLoading(false);
    }
  };

  const recordAuditLog = async (
    employeeId: string | undefined,
    userEmail: string | undefined,
    role: string,
    method: string,
    status: "success" | "failed"
  ) => {
    try {
      await supabase.rpc("rpc_record_login_audit", {
        p_employee_id: employeeId || null,
        p_role: role,
        p_login_method: method,
        p_telegram_user_id: tgUser ? String(tgUser.id) : null,
        p_ip_address: null,
        p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        p_status: status,
        p_failure_reason: userEmail ? `Kiruvchi: ${userEmail}` : null,
      });
    } catch {

      // audit log error should not block login
    }
  };

  const redirectUserAfterLogin = (_role?: string) => {
    const redirectedFrom = searchParams.get("redirectedFrom");
    const targetUrl =
      redirectedFrom &&
      redirectedFrom.startsWith("/") &&
      !redirectedFrom.startsWith("//") &&
      !redirectedFrom.startsWith("/sales/login")
        ? redirectedFrom
        : "/sales/app";

    if (typeof window !== "undefined") {
      window.location.href = targetUrl;
    } else {
      router.push(targetUrl);
      router.refresh();
    }
  };

  const executeLogin = async (userEmail: string, userPass: string) => {
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = userEmail.trim().toLowerCase();

    // In production, block demo accounts strictly
    if (isProduction && DEMO_EMAILS.includes(cleanEmail)) {
      setErrorMessage(
        "Xavfsizlik qoidasi: Production muhitida demo akkauntlar orqali kirish qat'iyan taqiqlangan! Iltimos, shaxsiy tasdiqlangan xodim hisobingizdan foydalaning."
      );
      setLoading(false);
      await recordAuditLog(undefined, cleanEmail, "Unknown", "password", "failed");
      return;
    }

    try {
      // 1. Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: userPass,
      });

      if (authError || !authData?.user) {
        setErrorMessage(
          authError?.message || "Email yoki parol noto'g'ri! Iltimos, ma'lumotlarni qayta tekshiring."
        );
        setLoading(false);
        await recordAuditLog(undefined, cleanEmail, "Unknown", "password", "failed");
        return;
      }

      // 2. Lookup matching employee row in DB
      let matchedEmp: EmployeeRow | null = null;
      try {
        const { data: empData } = await supabase
          .from("employees")
          .select("*")
          .or(`email.ilike.${cleanEmail},name.ilike.%${cleanEmail.split("@")[0]}%`)
          .limit(1);

        if (empData && empData.length > 0) {
          matchedEmp = empData[0] as EmployeeRow;
        }
      } catch {
        // DB lookup failure should not break valid login
      }

      const userMeta = (authData.user.user_metadata || {}) as Record<string, unknown>;
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

      // 3. Set RBAC Session (synced to localStorage)
      RBAC.setCurrentUser({
        id: matchedEmp?.id || authData.user.id,
        name: resolvedName,
        email: cleanEmail,
        role: resolvedRole as ErpRole,
        department: matchedEmp?.department || (userMeta.department as string) || "Savdo",
      });

      setSuccessMessage(`Muvaffaqiyatli kirdingiz: ${resolvedName}!`);
      await recordAuditLog(matchedEmp?.id || authData.user.id, cleanEmail, resolvedRole, "password", "success");

      setTimeout(() => {
        redirectUserAfterLogin(resolvedRole);
      }, 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Tizimga kirishda xatolik: ${msg}`);
      setLoading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage("Iltimos, email va parolni kiriting!");
      return;
    }
    await executeLogin(email, password);
  };

  const handleQuickPilotLogin = async (
    pilotEmail: string,
    roleTitle: string,
    empName: string
  ) => {
    if (isProduction) {
      setErrorMessage("Xavfsizlik talabi: Production muhitida demo tezkor login o'chirilgan.");
      return;
    }
    const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "GoldiaPassword2026!";
    setEmail(pilotEmail);
    setPassword(demoPassword);
    setSuccessMessage(`${roleTitle} (${empName}) sifatida tizimga kirilmoqda...`);
    await executeLogin(pilotEmail, demoPassword);
  };


  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans">
      {/* Decorative Gold & Indigo background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full relative z-10 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-amber-600 via-amber-400 to-amber-200 text-slate-950 font-black text-2xl shadow-xl shadow-amber-500/20 border-2 border-amber-300">
            JF
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            JewelryFlow <span className="text-amber-400">Sales</span>
          </h1>
          <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">
            Boshqaruv, Konsignatsiya & Moliya Tizimi
          </p>
        </div>

        {/* Telegram WebApp Detected Banner */}
        {tgUser && (
          <div className="bg-blue-950/60 border-2 border-blue-500/40 rounded-3xl p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 text-blue-400 font-bold">
              <span>✈️</span> Telegram Mini App orqali ochildi
            </div>
            <div className="text-slate-200">
              Salom, <span className="font-bold text-white">{tgUser.first_name}</span>{" "}
              {tgUser.username && <span className="text-blue-300 font-mono">(@{tgUser.username})</span>}
            </div>

            {tgIsChecking && (
              <div className="text-amber-300 animate-pulse font-medium">
                Telegram hisobi tekshirilmoqda...
              </div>
            )}

            {tgNeedsOtp && (
              <form onSubmit={handleLinkTelegramWithOtp} className="pt-2 space-y-2 border-t border-blue-900/60">
                <div className="text-[11px] text-slate-300">
                  Hisobingizni bog&apos;lash uchun Direktor/Boshqaruvchi bergan 6 xonali OTP kodini kiriting:
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={tgLinkCode}
                    onChange={(e) => setTgLinkCode(e.target.value.replace(/\D/g, ""))}
                    className="flex-1 px-3 py-2 bg-slate-900 border border-blue-400/50 rounded-xl text-center font-mono text-lg font-black tracking-widest text-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    type="submit"
                    disabled={loading || tgLinkCode.length < 6}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-md transition"
                  >
                    Bog&apos;lash
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Login Card */}
        <div className="bg-slate-900/90 backdrop-blur-md rounded-3xl p-6 md:p-8 border border-slate-800 shadow-2xl space-y-5">
          {/* Staging Notice */}
          {isStaging && (
            <div className="bg-amber-500/15 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-between">
              <span>🛡️ STAGING TEST MUHITI • SUN&apos;IY DEMO BAZA</span>
              <span className="text-[10px] bg-amber-500/30 px-2 py-0.5 rounded text-amber-200 uppercase font-black">
                Demo
              </span>
            </div>
          )}

          {/* Notifications */}
          {errorMessage && (
            <div className="bg-rose-950/80 border border-rose-500/60 text-rose-200 px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between">
              <span>⚠️ {errorMessage}</span>
              <button onClick={() => setErrorMessage(null)} className="font-bold opacity-60">✕</button>
            </div>
          )}
          {successMessage && (
            <div className="bg-emerald-950/80 border border-emerald-500/60 text-emerald-200 px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between">
              <span>✅ {successMessage}</span>
              <button onClick={() => setSuccessMessage(null)} className="font-bold opacity-60">✕</button>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Xodim Emaili
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isProduction ? "xodim@goldia.uz" : "masalan: jamshid@jewelryflow.uz"}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-2xl text-sm font-medium text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Maxfiy Parol
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-2xl text-sm font-medium text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-black text-sm rounded-2xl shadow-lg shadow-amber-500/20 transition active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? "Kirilmoqda..." : "Tizimga Kirish →"}
            </button>
          </form>

          {/* Staging / Local Demo 1-Click Role Switcher */}
          {showDemoSwitcher && (
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400">
                  {isStaging ? "Staging Demo: 1-Click Rollar" : "Lokal Pilot: 1-Click Rollar"}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {isStaging ? "Online Staging" : "Dev/Pilot"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => handleQuickPilotLogin("director@goldia.uz", "Direktor", "Alisher")}
                  className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-amber-500/30 text-amber-300 text-left transition hover:border-amber-400"
                >
                  <div className="text-[10px] text-slate-400">Direktor</div>
                  <div className="truncate">👑 Alisher</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickPilotLogin("manager@goldia.uz", "Boshqaruvchi", "Rustam")}
                  className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-blue-500/30 text-blue-300 text-left transition hover:border-blue-400"
                >
                  <div className="text-[10px] text-slate-400">Boshqaruvchi</div>
                  <div className="truncate">💼 Rustam</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickPilotLogin("seller@goldia.uz", "Sotuvchi", "Jamshid")}
                  className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-emerald-500/30 text-emerald-300 text-left transition hover:border-emerald-400"
                >
                  <div className="text-[10px] text-slate-400">Sotuvchi (Toshkent)</div>
                  <div className="truncate">🛍️ Jamshid</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickPilotLogin("dilshod@jewelryflow.uz", "Sotuvchi", "Dilshod")}
                  className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-purple-500/30 text-purple-300 text-left transition hover:border-purple-400"
                >
                  <div className="text-[10px] text-slate-400">Sotuvchi (Navoiy)</div>
                  <div className="truncate">🛍️ Dilshod</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickPilotLogin("jasur@jewelryflow.uz", "Sotuvchi", "Jasur")}
                  className="col-span-2 p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 text-left transition hover:border-slate-500"
                >
                  <div className="text-[10px] text-slate-400">Sotuvchi (Buxoro)</div>
                  <div className="truncate">🛍️ Jasur Sotuvchi</div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-slate-500 space-y-1">
          <div>JewelryFlow Sales v2.0 • Avtonom Savdo & Konsignatsiya Tizimi</div>
          <div className="flex justify-center gap-4 text-[11px] pt-1">
            <Link href="/" className="hover:text-slate-400 underline">
              ERP Ishlab chiqarish
            </Link>
            <span>•</span>
            <Link href="/sales/mobile" className="hover:text-slate-400 underline">
              Mobil Sotuv
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SalesLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-amber-400 font-bold">
          Yuklanmoqda...
        </div>
      }
    >
      <SalesLoginContent />
    </Suspense>
  );
}
