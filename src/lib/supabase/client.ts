import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/shared/types/database.types";

/**
 * Supabase client for use inside Client Components ("use client").
 * Respects RLS using the end user's session — never use the service
 * role key here.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
