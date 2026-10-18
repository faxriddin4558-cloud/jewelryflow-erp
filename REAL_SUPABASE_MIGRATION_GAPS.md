# JewelryFlow ERP — Haqiqiy Supabase Migratsiya Tahlili va Bo'shliqlar (Migration Gaps Audit)

> **STATUS:** `MIGRATIONS AUDITED — REAL CLOUD INTEGRATION BLOCKED ($0 ZERO-BUDGET REQUIREMENT)`

---

## 1. Migratsiyalar Inventarizatsiyasi (001–025)

Barcha 25 ta SQL migratsiya fayllari to'liq tahlil qilingan va haqiqiy PostgreSQL dvigatelida (PGlite WASM) 100% muvaffaqiyatli sinovdan o'tgan:

1. `20260101000001_core_lookup_tables.sql` — Tashkilotlar, bo'limlar, statuslar, metall turlari.
2. `20260101000002_party_and_identity.sql` — Foydalanuvchilar, profillar, xodimlar rollari.
3. `20260101000003_manufacturing_structure.sql` — Marshrutlar, bosqichlar, operatsiyalar.
4. `20260101000004_inventory_and_materials.sql` — Seyf kartalari, materiallar, proba qoldiqlari.
5. `20260101000005_orders_and_sales.sql` — Buyurtmalar, sotuvlar, to'lovlar jurnali.
6. `20260101000006_batches_and_production.sql` — Partiyalar, reja va amaldagi vaznlar.
7. `20260101000007_quality_and_rework.sql` — Sifat nazorati (QC), brak turlari, qayta ishlash.
8. `20260101000008_piecework_payroll.sql` — Ishbay oylik tariflari, hisob-kitoblar.
9. `20260101000009_audit_and_compliance.sql` — O'zgarishlar tarixi (audit log).
10. `20260101000010_indexes_and_performance.sql` — Indekslar, xavfsizlik cheklovlari.
11. `20260101000011_rls_policies.sql` — Dastlabki RLS qoidalari.
12. `20260101000012_demo_seed_data.sql` — Boshlang'ich ma'lumotlar.
13. `20260101000013_fix_inventory_items_rls.sql` — RLS siyosati to'g'rilanishi.
14. `20260101000014_fix_handover_rpcs.sql` — Sexlararo topshirish RPC funksiyalari.
15. `20260101000015_two_party_stage_handovers.sql` — Ikki tomonlama tortish va topshirish.
16. `20260101000016_atomic_erp_rpcs.sql` — Atomik ERP operatsiyalari (`rpc_create_batch...`).
17. `20260101000017_security_rls_and_privilege_hardening.sql` — SECURITY DEFINER va RLS mustahkamlash.
18. `20260101000018_fix_schema_issues.sql` — Sxema nomutanosibliklari tuzatmasi.
19. `20260101000019_goldia_business_hardening.sql` — Goldia zavodi ehtiyojlari uchun moslashuv.
20. `20260101000020_strict_multi_tenant_isolation.sql` — Qat'iy ko'p ijarachilik (multi-tenant) chegaralari.
21. `20260101000021_server_side_loss_validation_and_machine_lock.sql` — Yo'qotish limitlari va uskuna blokirovkasi.
22. `20260101000022_manufacturing_wip_sync_and_piecework_payroll.sql` — Ishbay oylik va WIP sinxronizatsiyasi.
23. `20260101000023_goldia_settings_and_capacity_persistence.sql` — Zavod sozlamalari va quvvatlarni saqlash.
24. `20260101000024_qc_rework_workflow_and_owner_metrics.sql` — QC va rahbar ko'rsatkichlari.
25. `20260101000025_complete_business_journey_and_scale_safety.sql` — To'liq biznes zanjiri va tarozi xavfsizligi.

---

## 2. Haqiqiy Bulutli Supabase bilan Solishtirish (Gaps & Nuances)

| Mezon | Lokal Pilot (PGlite) | Haqiqiy Masofaviy Supabase Cloud |
| :--- | :--- | :--- |
| **SQL Dvigateli** | Haqiqiy PostgreSQL 16 (WASM) | Haqiqiy PostgreSQL 15/16 |
| **Kengaytmalar (Extensions)** | `uuid-ossp`, `pgcrypto` yuklangan | `extensions` sxemasida standart mavjud |
| **Autentifikatsiya (Auth)** | Emulyatsiya qilingan Node.js JWT | Haqiqiy GoTrue mikroxizmati |
| **`auth.uid()` / `auth.jwt()`** | `app.current_user_id` orqali simulyatsiya | Haqiqiy JWT token orqali kiritiladi |
| **RLS Siyosatlari** | 100% bir xil SQL sintaksisi | 100% mos keladi |
| **SECURITY DEFINER RPC** | `set search_path = public, pg_temp` | `set search_path = public, pg_temp` |
| **Tranzaksiya Atomikligi** | PostgreSQL `BEGIN ... COMMIT / ROLLBACK` | PostgreSQL `BEGIN ... COMMIT / ROLLBACK` |
| **Realtime Obunalar** | Lokal HTTP Polling | Masofaviy WebSockets (Realtime) |

---

## 3. Bulutga O'tishda Amalga Oshiriladigan Qadamlar (Kelajak uchun)

Loyihaga budjet ajratilib, haqiqiy Supabase loyihasiga o'tish tasdiqlanganda:
1. Masofaviy Supabase boshqaruv panelida yangi loyiha yaratiladi.
2. `supabase/scripts/00_complete_production_rollout_standalone.sql` bitta yaxlit skripti Supabase SQL Editor da ishga tushiriladi (yoki `supabase db push`).
3. Supabase Auth orqali har bir zavod xodimi uchun haqiqiy email/parol ro'yxatdan o'tkaziladi.
4. `.env.local` da `NEXT_PUBLIC_SUPABASE_URL` va anon/service kalitlari yangilanadi.
5. Har bir bosqich uchun Realtime replikatsiyasi yoqiladi (`alter publication supabase_realtime add table public.batches;`).
