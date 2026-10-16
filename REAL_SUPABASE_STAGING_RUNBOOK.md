# JEWELRYFLOW ERP — REAL SUPABASE STAGING RUNBOOK

**Maqsad:** Alohida va izolyatsiya qilingan haqiqiy Supabase Staging loyihasini yaratish, sozlash va xavfsiz sinovdan o'tkazish yo'riqnomasi.  
**Sana:** 16-oktabr 2026  
**Status:** **REAL SUPABASE TESTING BLOCKED** (Lokal Docker daemoni va alohida staging hisob ma'lumotlari mavjud emasligi sababli)  

---

## 1. HOZIRGI HOLAT VA BLOKIROVKA SABABI (STATUS REPORT)

> [!WARNING]
> **REAL SUPABASE TESTING BLOCKED**  
> Lokal ishlab chiquvchi mashinasida Docker Desktop / Docker daemoni o'rnatilmagan yoki ishga tushirilmagan. Shu sababli lokal `supabase start` CLI buyrug'i bajarilmaydi.
> Shuningdek, xavfsizlik qoidalariga muvofiq, **production** Supabase loyihasiga (`eutrcfqgldwlzjrwubhh`) hech qachon test yoki staging maqsadida ulanish mumkin emas.
> 
> **Qo'llanilgan Muqobil Yechim:**
> Barcha 25 ta migratsiya va to'liq Playwright brauzer E2E testlari xotiradagi izolatsiyalangan disposable **PGlite (Real PostgreSQL 18/16 WASM)** dvigatelida to'liq haqiqiy Auth va REST serveri bilan muvaffaqiyatli o'tkazildi (15 ta brauzer testi, 61 ta DB ssenariysi).

---

## 2. REAL SUPABASE STAGING LOYIHASINI YARATISH QADAMLARI (RUNBOOK)

Kelgusida alohida bulutli yoki serverli Supabase Staging muhitini o'rnatish uchun quyidagi aniq qadamlarni bajaring:

### 2.1. Yangi Staging Loyihasini Ochish (Web UI)
1. Supabase Dashboard (https://supabase.com/dashboard) ga kiring.
2. Yangi loyiha yarating:
   - **Project Name:** `jewelryflow-staging-goldia`
   - **Region:** `eu-central-1` (Frankfurt) yoki `ap-south-1` (Mumbai)
   - **Database Password:** Yuqori xavfsizlikka ega tasodifiy parol (parolni saqlang).
3. **DIQQAT:** Hech qachon production loyihasi (`eutrcfqgldwlzjrwubhh`) sozlamalarini bu yerga aralashtirmang!

### 2.2. Supabase CLI bilan Bog'lash
Lokal terminalda quyidagi buyruqlarni bajaring:

```bash
# 1. Supabase hisobiga kirish
npx supabase login

# 2. Yangi staging loyihasiga bog'lash (PROJECT_REF ni loyihangizdan oling)
npx supabase link --project-ref <YOUR_STAGING_PROJECT_REF>

# 3. Barcha 001-025 migratsiyalarni toza staging bazasiga qo'llash
npx supabase db push
```

### 2.3. Boshlang'ich Ma'lumotlarni Yuklash (Seed Data)
Staging muhitiga Goldia zavodi, xodimlari va dastlabki oltin seyfi qoldiqlarini kiritish:

```bash
# Staging bazasiga test foydalanuvchilar va sozlamalarni yuklash
npx supabase db execute --file scripts/staging-seed-goldia.sql
```

---

## 3. ATROF-MUHIT O'ZGARUVCHILARI (.env.staging)

Staging Next.js dasturi uchun faqat quyidagi o'zgaruvchilarni belgilang:

```env
# JEWELRYFLOW ERP — ISOLATED STAGING CONFIGURATION
NEXT_PUBLIC_APP_URL=https://staging.jewelryflow.uz
NEXT_PUBLIC_SUPABASE_URL=https://<YOUR_STAGING_PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<YOUR_STAGING_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<YOUR_STAGING_SERVICE_ROLE_KEY>
NEXT_PUBLIC_APP_ENV=staging
```

---

## 4. XAVFSIZLIK KAFOLATLARI (PRODUCTION SAFETY RULES)

1. **Production Bazasiga Qat'iy Tegilmaydi:**
   - Hech qanday test skripti, E2E sinov yoki yangi migratsiya production bazaga avtomatik yo'naltirilmaydi.
2. **Git Filiali Xavfsizligi:**
   - Barcha o'zgarishlar faqat `dev/manufacturing-erp-saas` filialida saqlanadi. `main` filialiga to'g'ridan-to'g'ri push qilish taqiqlanadi.
3. **Kredensiallarni Saqlash:**
   - `.env` yoki `.env.local` fayllari Git omboriga qo'shilmaydi (`.gitignore` bilan himoyalangan).
