import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 074: jewelry_models and stage_loss_configs are tenant isolated (real PostgreSQL RLS, role `authenticated`).
// Before 074 any employee could read/insert/update another organization's models and any director/manager could
// update/delete another organization's loss configs; rpc_create_jewelry_model took a caller-chosen organization.

describe("Goldia 074 — tenant isolation of models and loss configs", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgA = "00000000-0000-0000-0000-0000000a0074";
  const orgB = "00000000-0000-0000-0000-0000000b0074";
  let dirA: { userId: string }, mgrA: { userId: string }, selA: { userId: string }, workerA: { userId: string };
  let dirB: { userId: string }, selB: { userId: string };
  let modelA: string, modelB: string, legacyModel: string;
  const STAGE_A = 9101, STAGE_B = 9102;

  const count = async (sql: string) => Number((await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`)).rows[0]!.n);
  // rows a DML statement changed (RLS silently filters UPDATE/DELETE; INSERT is rejected)
  const changed = async (sql: string) => Number((await t.db.query<{ n: number }>(`WITH x AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM x`)).rows[0]!.n);

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES
      ('${orgA}', 'org-a-074', 'Org A', 'ACTIVE'), ('${orgB}', 'org-b-074', 'Org B', 'ACTIVE')`);
    dirA = await t.addUser(orgA, "dira074@goldia.uz", "DirA", "director");
    mgrA = await t.addUser(orgA, "mgra074@goldia.uz", "MgrA", "production_manager");
    selA = await t.addUser(orgA, "sela074@goldia.uz", "SelA", "sales");
    workerA = await t.addUser(orgA, "wrka074@goldia.uz", "WrkA", "worker");
    dirB = await t.addUser(orgB, "dirb074@goldia.uz", "DirB", "director");
    selB = await t.addUser(orgB, "selb074@goldia.uz", "SelB", "sales");
    await t.asAdmin();
    const ins = async (org: string | null, code: string) => (await t.db.query<{ id: string }>(
      `INSERT INTO public.jewelry_models (organization_id, model_code, name) VALUES (${org ? `'${org}'` : "NULL"}, '${code}', '${code}') RETURNING id`)).rows[0]!.id;
    modelA = await ins(orgA, "T074-A");
    modelB = await ins(orgB, "T074-B");
    legacyModel = await ins(null, "T074-LEGACY");
    await t.db.exec(`INSERT INTO public.stage_loss_configs (stage_order, stage_name, department, organization_id)
      VALUES (${STAGE_A}, 'A stage', 'casting', '${orgA}'), (${STAGE_B}, 'B stage', 'casting', '${orgB}')`);
  });

  it("SELECT: own organization plus legacy shared rows only", async () => {
    await t.asUser(selA.userId);
    expect(await count(`SELECT id FROM public.jewelry_models WHERE id = '${modelA}'`)).toBe(1);
    expect(await count(`SELECT id FROM public.jewelry_models WHERE id = '${legacyModel}'`)).toBe(1);
    expect(await count(`SELECT id FROM public.jewelry_models WHERE organization_id = '${orgB}'`)).toBe(0);
    await t.asUser(dirA.userId);
    expect(await count(`SELECT 1 FROM public.stage_loss_configs WHERE stage_order = ${STAGE_A}`)).toBe(1);
    expect(await count(`SELECT 1 FROM public.stage_loss_configs WHERE organization_id = '${orgB}'`)).toBe(0);
  });

  it("INSERT/UPDATE/DELETE into another organization are refused", async () => {
    for (const u of [dirA, mgrA, selA]) {
      await t.asUser(u.userId);
      await t.expectError(`INSERT INTO public.jewelry_models (organization_id, model_code, name) VALUES ('${orgB}', 'X-${u.userId.slice(0, 6)}', 'x')`, "row-level security");
      expect(await changed(`UPDATE public.jewelry_models SET name = 'TAMPERED' WHERE id = '${modelB}'`)).toBe(0);
      expect(await changed(`DELETE FROM public.jewelry_models WHERE id = '${modelB}'`)).toBe(0);
      expect(await changed(`UPDATE public.stage_loss_configs SET stage_name = 'TAMPERED' WHERE stage_order = ${STAGE_B}`)).toBe(0);
      expect(await changed(`DELETE FROM public.stage_loss_configs WHERE stage_order = ${STAGE_B}`)).toBe(0);
    }
    await t.asUser(dirA.userId);
    await t.expectError(`INSERT INTO public.stage_loss_configs (stage_order, stage_name, department, organization_id) VALUES (9199, 'x', 'casting', '${orgB}')`, "row-level security");
    // moving an own row into another organization is refused too
    await t.expectError(`UPDATE public.jewelry_models SET organization_id = '${orgB}' WHERE id = '${modelA}'`, "row-level security");
    // legacy shared rows are read only
    expect(await changed(`UPDATE public.jewelry_models SET name = 'TAMPERED' WHERE id = '${legacyModel}'`)).toBe(0);
    await t.asAdmin();
    expect(await count(`SELECT 1 FROM public.jewelry_models WHERE name = 'TAMPERED'`)).toBe(0);
    expect(await count(`SELECT 1 FROM public.stage_loss_configs WHERE stage_name = 'TAMPERED' OR stage_order = 9199`)).toBe(0);
  });

  it("legitimate rights in the own organization are kept", async () => {
    // models: director, manager and seller (catalogue rights) — direct insert gets the own organization by default
    for (const [u, code] of [[dirA, "OWN-D"], [mgrA, "OWN-M"], [selA, "OWN-S"]] as const) {
      await t.asUser(u.userId);
      expect(await changed(`INSERT INTO public.jewelry_models (model_code, name) VALUES ('${code}-074', 'own')`)).toBe(1);
      expect(await changed(`UPDATE public.jewelry_models SET name = 'own-upd' WHERE model_code = '${code}-074'`)).toBe(1);
    }
    await t.asUser(dirA.userId);
    expect(await changed(`DELETE FROM public.jewelry_models WHERE model_code = 'OWN-S-074'`)).toBe(1);
    await t.asAdmin();
    expect(await count(`SELECT 1 FROM public.jewelry_models WHERE model_code IN ('OWN-D-074', 'OWN-M-074') AND organization_id = '${orgA}'`)).toBe(2);
    // loss configs: director and manager manage their own
    for (const u of [dirA, mgrA]) {
      await t.asUser(u.userId);
      expect(await changed(`UPDATE public.stage_loss_configs SET stage_name = 'A stage' WHERE stage_order = ${STAGE_A}`)).toBe(1);
    }
    await t.asUser(dirA.userId);
    expect(await changed(`INSERT INTO public.stage_loss_configs (stage_order, stage_name, department) VALUES (9103, 'A new', 'casting')`)).toBe(1);
    expect(await changed(`DELETE FROM public.stage_loss_configs WHERE stage_order = 9103`)).toBe(1);
    // a seller reads loss configs but cannot change them; a worker cannot change the catalogue
    await t.asUser(selA.userId);
    expect(await changed(`UPDATE public.stage_loss_configs SET stage_name = 'x' WHERE stage_order = ${STAGE_A}`)).toBe(0);
    await t.asUser(workerA.userId);
    await t.expectError(`INSERT INTO public.jewelry_models (model_code, name) VALUES ('WRK-074', 'w')`, "row-level security");
  });

  it("model RPCs are pinned to the caller's organization and role", async () => {
    await t.asUser(selA.userId);
    const own = await t.rpc(`public.rpc_create_jewelry_model(p_name := 'RPC own', p_model_code := 'RPC-A-074')`);
    expect(own.organization_id).toBe(orgA);
    await t.expectError(`SELECT public.rpc_create_jewelry_model(p_name := 'RPC foreign', p_organization_id := '${orgB}')`, "boshqa tashkilot");
    await t.expectError(`SELECT public.rpc_update_jewelry_model_photo('${modelB}', 'https://x/y.png')`, "Model topilmadi");
    const photo = await t.rpc(`public.rpc_update_jewelry_model_photo('${modelA}', 'https://x/a.png')`);
    expect(photo.primary_image_url).toBe("https://x/a.png");
    await t.asUser(workerA.userId);
    await t.expectError(`SELECT public.rpc_create_jewelry_model(p_name := 'w')`, "huquqi yo'q");
    await t.asUser(dirB.userId);
    await t.expectError(`SELECT public.rpc_update_jewelry_model_photo('${modelA}', 'https://x/b.png')`, "Model topilmadi");
    await t.asUser(selB.userId);
    expect(await count(`SELECT 1 FROM public.jewelry_models WHERE model_code = 'RPC-A-074'`)).toBe(0);
  });

  it("anon and dangerous privileges are gone; helper is not anon-executable", async () => {
    await t.asAdmin();
    const priv = await t.db.query<{ anon_sel: boolean; auth_trunc: boolean; anon_rpc: boolean; auth_rpc: boolean }>(`SELECT
      has_table_privilege('anon', 'public.jewelry_models', 'SELECT') OR has_table_privilege('anon', 'public.stage_loss_configs', 'SELECT') AS anon_sel,
      has_table_privilege('authenticated', 'public.jewelry_models', 'TRUNCATE') OR has_table_privilege('authenticated', 'public.stage_loss_configs', 'TRUNCATE') AS auth_trunc,
      has_function_privilege('anon', 'public._goldia_can_manage_models()', 'EXECUTE') AS anon_rpc,
      has_function_privilege('authenticated', 'public.rpc_create_jewelry_model(text,text,text,numeric,text,text,uuid,text)', 'EXECUTE') AS auth_rpc`);
    expect(priv.rows[0]).toEqual({ anon_sel: false, auth_trunc: false, anon_rpc: false, auth_rpc: true });
  });
});
