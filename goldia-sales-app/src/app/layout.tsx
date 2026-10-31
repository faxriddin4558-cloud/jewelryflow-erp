"use client";

import "./globals.css";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  supabase,
  RBAC,
  resolveEmployeeRole,
  type EmployeeRow,
} from "@/lib/erp-engine";
import { EnvironmentVersionBadge } from "@/components/common/EnvironmentVersionBadge";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [sessionUser, setSessionUser] = useState(() => RBAC.getCurrentUser());

  // === PWA O'RNATISH (INSTALL) TIZIMI ===

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

    return () => {
      unsubscribeRbac();
      authListener.subscription.unsubscribe();
    };
  }, []);

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
          <div key={`${sessionUser.id ?? "anon"}-${sessionUser.role}`} className="flex-1 overflow-y-auto w-full bg-gray-50">
            {children}
          </div>
          <EnvironmentVersionBadge />
        </QueryClientProvider>
      </body>
    </html>
  );
}
