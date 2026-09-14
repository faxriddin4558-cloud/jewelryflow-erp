import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ManufacturingRepository } from "../../domain/workflow/repository";
import { SupabaseManufacturingRepository } from "./manufacturing.repository";

/**
 * Builds a request-scoped repository bound to the current request's
 * cookies/session. Must be called fresh inside every Server Action /
 * Route Handler (never module-cached) for the same reason
 * `createSupabaseServerClient` itself must not be cached — see its
 * doc comment in `src/lib/supabase/server.ts`.
 */
export async function getManufacturingRepository(): Promise<ManufacturingRepository> {
  const client = await createSupabaseServerClient();
  return new SupabaseManufacturingRepository(client);
}
