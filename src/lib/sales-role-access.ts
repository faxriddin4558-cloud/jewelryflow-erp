// Goldia Sales — which screens each role may open. This only shapes the UI; the database (RLS and
// SECURITY DEFINER role guards) is the authority and rejects anything a seller is not allowed to read.

import type { SupabaseClient } from "@supabase/supabase-js";

const SELLER_ROLE_TOKENS = new Set(["seller", "sales", "sotuvchi"]);

export function isSellerUiRole(role?: string | null): boolean {
  return SELLER_ROLE_TOKENS.has(String(role ?? "").trim().toLowerCase());
}

// Sellers may open only these Sales routes. Everything else (manager vault, factory, refining, purchases,
// inventory, consignments, sellers, reports, cash vault, models, users, settings, director panel) is
// management-only. Exact match for the dashboard, prefix match for the others.
const SELLER_EXACT_ROUTES = ["/sales/app", "/sales/mobile"];
const SELLER_PREFIX_ROUTES = ["/sales/app/customers", "/sales/mobile/", "/sales/login"];

export function isRouteAllowedForSeller(pathname: string): boolean {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  if (SELLER_EXACT_ROUTES.includes(p)) return true;
  return SELLER_PREFIX_ROUTES.some((prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

// Management-only company stock (migration 071). Falls back to the pre-071 helper only when the wrapper
// does not exist yet (frontend deployed before the migration); a permission error is returned as is.
export async function fetchManagerAvailableStockGrams(
  client: SupabaseClient
): Promise<{ data: number | null; error: { message: string } | null }> {
  const res = await client.rpc("rpc_get_manager_available_stock_grams");
  let data: unknown = res.data;
  let error = res.error;
  if (error && (error.code === "PGRST202" || /could not find the function/i.test(error.message || ""))) {
    const legacy = await client.rpc("get_manager_available_stock_grams");
    data = legacy.data;
    error = legacy.error;
  }
  if (error) return { data: null, error: { message: error.message } };
  const n = Number(data);
  return { data: data !== null && Number.isFinite(n) ? n : null, error: null };
}
