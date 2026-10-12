import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl =
  (process.env.NEXT_PUBLIC_SUPABASE_URL as string) || "https://placeholder.supabase.co";
const supabaseKey =
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) || "placeholder-key";

export const createSupabaseBrowserClient = () => {
  if (typeof window !== "undefined") {
    return createBrowserClient(supabaseUrl, supabaseKey);
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// Shared Supabase client instance (uses @supabase/ssr cookie synchronization in browser)
export const supabase = createSupabaseBrowserClient();