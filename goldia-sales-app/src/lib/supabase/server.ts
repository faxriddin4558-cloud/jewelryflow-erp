import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/shared/types/database.types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client for use inside Server Components, Route Handlers, and
 * Server Actions. Reads/writes the session via Next.js cookies() and
 * therefore respects RLS as the currently authenticated employee.
 *
 * Must be called fresh per-request (do not module-cache the instance)
 * because it captures the request's cookie store.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll is called from a Server Component where cookies are
          // read-only; safe to ignore because middleware refreshes the
          // session on every request (see middleware.ts).
        }
      },
    },
  }) as unknown as SupabaseClient<Database>;
}

/**
 * Privileged client using the service role key. Bypasses Row Level
 * Security entirely. Restricted to trusted server-only contexts: cron
 * jobs, system-generated reports, webhook handlers. NEVER import this
 * from a "use client" component or expose it to a user-triggered request
 * path without an explicit authorization check first.
 */
export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TypedSupabaseServerClient = SupabaseClient<Database>;
