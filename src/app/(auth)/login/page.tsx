"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const isProduction =
    process.env.NEXT_PUBLIC_APP_ENV === "production" ||
    (typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1" &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1") &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("localhost"));

  const isLocalPilot =
    !isProduction &&
    (process.env.NEXT_PUBLIC_APP_ENV === "local_offline" ||
      (process.env.NEXT_PUBLIC_SUPABASE_URL || "").includes("127.0.0.1") ||
      (process.env.NEXT_PUBLIC_SUPABASE_URL || "").includes("localhost") ||
      (typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1")));

  const executeSignIn = async (userEmail: string, userPass: string) => {
    setLoading(true);
    setError("");

    // Priority 6: Production Security Guard - Never allow demo credentials in production
    if (isProduction && (userPass === "GoldiaPassword2026!" || userEmail.endsWith("@goldia.uz"))) {
      setError("Xavfsizlik: Ishlab chiqarish (Production) tizimida demo parollardan foydalanish qat'iyan taqiqlangan!");
      setLoading(false);
      return;
    }

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: userEmail.trim(),
        password: userPass,
      });

      if (authError) {
        // Use console.warn instead of console.error to avoid triggering Next.js dev error overlay
        console.warn("[AUTH-REJECTED]", authError.message);
        setError(
          authError.message ||
            "Email yoki parol noto'g'ri! Iltimos, ma'lumotlarni qayta tekshiring."
        );
        setLoading(false);
        return;
      }

      // Successful login redirect resolution
      const redirectedFrom = searchParams.get("redirectedFrom");
      let targetPath = "/";

      if (
        redirectedFrom &&
        redirectedFrom.startsWith("/") &&
        !redirectedFrom.startsWith("//") &&
        !redirectedFrom.startsWith("/login")
      ) {
        targetPath = redirectedFrom;
      } else {
        const lowerEmail = userEmail.toLowerCase();
        const isSeller = lowerEmail.includes("seller") || lowerEmail.includes("sotuvchi");
        targetPath = isSeller ? "/sales/mobile" : "/";
      }

      router.push(targetPath);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Tizimga kirishda kutilmagan xatolik";
      console.warn("[AUTH-EXCEPTION]", msg);
      setError(msg);
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSignIn(email, password);
  };

  const handleDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("GoldiaPassword2026!");
    await executeSignIn(demoEmail, "GoldiaPassword2026!");
  };

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-100">
      <div className="mb-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white font-bold text-xl mb-3 shadow-md shadow-blue-500/20">
          J
        </div>
        <h1 className="text-2xl font-bold text-gray-900">JewelryFlow ERP</h1>
        <p className="mt-1 text-xs text-gray-500">
          Zavod va savdo boshqaruv tizimiga kirish
        </p>
      </div>

      {isLocalPilot && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 space-y-3">
          <div className="flex items-center justify-between font-bold text-amber-950">
            <span className="flex items-center gap-1.5">
              <span>⚡</span> LOKAL PILOT REJIMI
            </span>
            <span className="text-[10px] bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono">
              ZERO-BUDGET
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-800">
            PostgreSQL PGlite offline bazasi faol. 1-bosishda sinov akkaunti bilan kiring:
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleDemoLogin("director@goldia.uz")}
              className="p-2.5 bg-white border border-amber-300 rounded-lg text-left hover:bg-amber-100/60 transition shadow-sm group disabled:opacity-50"
            >
              <div className="font-bold text-amber-950 flex items-center gap-1">
                <span>👑</span> Direktor
              </div>
              <div className="text-[10px] text-amber-700 truncate mt-0.5">
                director@goldia.uz
              </div>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleDemoLogin("seller@goldia.uz")}
              className="p-2.5 bg-white border border-amber-300 rounded-lg text-left hover:bg-amber-100/60 transition shadow-sm group disabled:opacity-50"
            >
              <div className="font-bold text-amber-950 flex items-center gap-1">
                <span>📱</span> Sotuvchi
              </div>
              <div className="text-[10px] text-amber-700 truncate mt-0.5">
                seller@goldia.uz
              </div>
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600 font-medium">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Email manzil
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isLocalPilot ? "director@goldia.uz yoki seller@goldia.uz" : "xodim@zavod.uz"}
            required
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Parol
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-blue-400 disabled:cursor-not-allowed mt-2"
        >
          {loading ? "Kirilmoqda..." : "Kirish"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50/80 px-4 py-8">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center text-sm text-gray-500">
            Yuklanmoqda...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}