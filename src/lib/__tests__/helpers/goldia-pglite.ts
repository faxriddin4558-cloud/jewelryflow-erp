import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";

export type Json = Record<string, unknown>;

// Disposable database with every migration applied, Supabase-style default grants and RLS on.
// Business calls run as the real `authenticated` role (see asUser).
export async function createGoldiaDb() {
  const db = new PGlite({ extensions: { uuid_ossp, pg_trgm, btree_gist } });
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated'); $$;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true)); $$;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, owner UUID,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), public BOOLEAN DEFAULT false);
    CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT,
      name TEXT, owner UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), metadata JSONB);
    CREATE OR REPLACE FUNCTION moddatetime() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  `);

  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8")
      .replace(/create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi, "-- moddatetime handled")
      .replace(/create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi, "-- pgcrypto handled");
    // GOLDIA_TEST_CRLF_FROM=<version>: apply later migrations with Windows line endings (CRLF) to prove that a
    // release run from a Windows checkout behaves identically (function bodies then differ only by \r).
    const crlfFrom = process.env.GOLDIA_TEST_CRLF_FROM;
    await db.exec(crlfFrom && file.slice(0, 14) > crlfFrom ? sql.replace(/\r?\n/g, "\r\n") : sql);
  }

  const asAdmin = () => db.exec(`RESET ROLE;`);
  const asUser = (userId: string) =>
    db.exec(`
      RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

  async function rpc(sql: string): Promise<Json> {
    const res = await db.query<{ r: unknown }>(`SELECT (${sql}) AS r`);
    const raw = res.rows[0]!.r;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Json;
  }

  async function scalar(sql: string): Promise<number> {
    const res = await db.query<{ v: unknown }>(`SELECT (${sql})::numeric AS v`);
    return Number(res.rows[0]!.v);
  }

  async function expectError(sql: string, fragment: string) {
    let message = "";
    try {
      await db.query(sql);
    } catch (err: unknown) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message, `expected error containing "${fragment}"`).toContain(fragment);
  }

  async function addUser(orgId: string, email: string, name: string, role: string) {
    await asAdmin();
    const userId = (await db.query<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('${email}') RETURNING id`)).rows[0]!.id;
    const employeeId = (await db.query<{ id: string }>(`
      INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
      VALUES ('${orgId}', '${userId}', '${name}', '${name}', '${role}', true) RETURNING id`)).rows[0]!.id;
    return { userId, employeeId };
  }

  return { db, asAdmin, asUser, rpc, scalar, expectError, addUser };
}

// 073: weight sales name their physical pieces. Returns the seller's held pieces in the former automatic (068) order —
// consignment, then piece creation, then id — cut to the shortest prefix that covers `grams`, as an SQL argument.
// Runs as the table owner; call it before switching to the seller session (or re-switch afterwards).
export async function pieceIdsArg(db: PGlite, sellerEmployeeId: string, grams: number): Promise<string> {
  const res = await db.query<{ id: string }>(`
    SELECT id FROM (
      SELECT cp.id, sum(cp.weight_grams) OVER (ORDER BY sc.created_at, cp.created_at, cp.id) - cp.weight_grams AS before
        FROM public.consignment_pieces cp JOIN public.seller_consignments sc ON sc.id = cp.consignment_id
       WHERE cp.seller_id = '${sellerEmployeeId}' AND cp.status = 'held_by_seller' AND cp.sale_id IS NULL
         AND sc.status IN ('held_by_seller', 'partially_sold', 'fully_sold')
    ) x WHERE before < ${grams} - 0.00005`);
  return `p_piece_ids := ARRAY[${res.rows.map((r) => `'${r.id}'`).join(",")}]::uuid[]`;
}
