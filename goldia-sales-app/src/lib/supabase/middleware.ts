import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/shared/types/database.types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * session cookie in sync between the browser and server. Called from the
 * root `middleware.ts`. Route-level auth gating (redirect unauthenticated
 * users away from `(dashboard)`, redirect authenticated users away from
 * `(auth)`) also lives here so every protected route benefits without
 * per-page boilerplate.
 */
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
    );
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/sales/login");

  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/sales/telegram") ||
    pathname.startsWith("/api/sales/import") ||
    pathname.startsWith("/api/sales/employees") ||
    pathname.startsWith("/api/sales/currency") ||
    pathname.startsWith("/api/models/photo") ||
    pathname.startsWith("/api/version") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js";

  const isProductionEnv = process.env.NEXT_PUBLIC_APP_ENV === "production";
  const DEMO_EMAILS_SET = new Set([
    "director@goldia.uz",
    "manager@goldia.uz",
    "seller@goldia.uz",
    "dilshod@jewelryflow.uz",
    "jasur@jewelryflow.uz",
    "worker@goldia.uz",
    "accountant@goldia.uz",
    "demo.director@goldia.uz",
    "demo.manager@goldia.uz",
    "demo.seller@goldia.uz",
    "admin@goldia.uz",
  ]);

  // SERVER-SIDE SECURITY GUARD: Strictly block demo logins in production mode
  if (user && user.email && isProductionEnv) {
    const emailLower = user.email.toLowerCase().trim();
    if (DEMO_EMAILS_SET.has(emailLower) || emailLower.startsWith("demo.")) {
      await supabase.auth.signOut();
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/sales/login";
      redirectUrl.searchParams.set("error", "demo_blocked_in_production");
      const blockedResponse = NextResponse.redirect(redirectUrl);
      request.cookies.getAll().forEach((c) => blockedResponse.cookies.delete(c.name));
      return blockedResponse;
    }
  }

  const host = request.headers.get("host") || "";
  const isSalesDomain =
    host.includes("sales") ||
    host.includes("goldia") ||
    pathname.startsWith("/sales");

  if (!user && !isAuthRoute && !isPublicAsset) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/sales/login";
    redirectUrl.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/sales";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectFrom = request.nextUrl.searchParams.get("redirectedFrom");
    const safeTarget =
      redirectFrom && redirectFrom.startsWith("/") && !redirectFrom.startsWith("//") && redirectFrom !== "/"
        ? redirectFrom
        : isSalesDomain
        ? "/sales"
        : "/";
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = safeTarget;
    redirectUrl.searchParams.delete("redirectedFrom");
    return NextResponse.redirect(redirectUrl);
  }


  return response;
}
