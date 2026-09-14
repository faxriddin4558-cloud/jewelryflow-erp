import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/shared/types/database.types";

/**
 * Supabase client for use inside Server Components, Route Handlers, and
 * Server Actions. Reads/writes the session via Next.js cookies() and
 * therefore respects RLS as the currently authenticated employee.
 *
 * Must be called fresh per-request (do not module-cache the instance)
 * because it captures the request's cookie store.
 */
export async function createSupabaseServerClient() {
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
      setAll(cookiesToSet) {
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
  });
}

/**
 * Privileged client using the service role key. Bypasses Row Level
 * Security entirely. Restricted to trusted server-only contexts: cron
 * jobs, system-generated reports, webhook handlers. NEVER import this
 * from a "use client" component or expose it to a user-triggered request
 * path without an explicit authorization check first.
 */
export function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  // Lazily imported to guarantee this code path never ships in a client bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@supabase/supabase-js");
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
