# JewelryFlow ERP — Oflayn Xavfsizlik Cheklovlari va Demarkatsiya (Offline Security Limitations)

> **STATUS:** `LOCAL PILOT / EMULATED / NOT-PRODUCTION`  
> **XAVFSIZLIK BELGISI:** `X-JewelryFlow-Environment: LOCAL-PILOT-EMULATED-NOT-PRODUCTION`

---

## 1. Nima Uchun Ushbu Muhit "Production" Emas?

JewelryFlow ERP ning ushbu bosqichdagi oflayn muhiti **Zero-Budget ($0 xarajat)** strategiyasi asosida ishlab chiqilgan.  
U zavod ichida texnologik jarayonlarni sinash va xodimlarni o'rgatish uchun to'liq funksional bo'lsa-da, quyidagi xavfsizlik cheklovlariga ega:

### A. Autentifikatsiya (Authentication Emulation)
- **Hozirgi holat:** GoTrue / Supabase Auth o'rniga engil Node.js JWT emulyatori ishlatiladi.
- **Cheklov:** Parollar lokal xeshlanadi, ikki bosqichli autentifikatsiya (2FA/MFA), SMS tasdiqlash va OAuth provayderlari oflayn rejimda mavjud emas.
- **Production Status:** `EMULATED / BLOCKED FOR PRODUCTION USE`.

### B. Tarmoq va Shifrlash (Network & Transport)
- **Hozirgi holat:** Server qat'iy ravishda faqat `127.0.0.1` (localhost) interfeysiga ulanadi.
- **Taqiq:** Tizim `0.0.0.0` orqali lokal tarmoqqa (LAN) yoki ochiq internetga ochilmasligi shart, chunki ichki HTTP trafigi TLS/HTTPS bilan shifrlanmagan.

### C. Masofaviy Baza Himoyasi (Leakage Guard)
- **Qat'iy blokirovka:** Server skriptlarida masofaviy Supabase (`eutrcfqgldwlzjrwubhh.supabase.co`) manziliga tasodifiy so'rovlar yuborilishini to'suvchi avtomatik tekshiruv mavjud.
- Agar `.env.local` faylida masofaviy Supabase URL aniqlansa, lokal server xavfsizlik maqsadida ishga tushishni rad etadi.

---

## 2. Multi-Tenant Izolyatsiyasi Holati

Lokal pilot muhitida barcha 25 ta SQL migratsiyalari va Row Level Security (RLS) siyosatlari to'liq yuklangan:
- `organization_id` har bir tranzaksiyada tekshiriladi.
- `rpc_create_batch_with_gold_issue`, `rpc_move_partial_wip`, `rpc_record_sale_with_stock_deduction` funksiyalarida tashkilot chegarasi server darajasida (`set search_path = public, pg_temp; security definer`) qat'iy himoyalangan.
- Biroq, PGlite dvigatelida Supabase Auth ning `auth.uid()` funksiyasi `current_setting('app.current_user_id', true)` orqali simulyatsiya qilinadi.

---

## 3. Haqiqiy Tijoriy SaaS va Production Talablari

Kelajakda tizimni ommaviy tijoriy SaaS ga o'tkazish yoki masofaviy ishlab chiqarishga chiqarish uchun quyidagilar talab etiladi:
1. **Haqiqiy Supabase Pro / Team Cloud Instance:**
   - Haqiqiy PostgreSQL 15/16 ma'lumotlar bazasi.
   - GoTrue Microservice (Argon2 / bcrypt parollar xeshi, email/SMS tasdiqlash, sessiyalar boshqaruvi).
2. **Kriptografik Tokenlar:**
   - Supabase JWT Secret orqali imzolangan asimmetrik tokenlar.
3. **SSL/TLS Sertifikatlari:**
   - Shifrlangan HTTPS va WSS (WebSockets) protokollari.
4. **Metrologik Nazorat:**
   - Qimmatbaho metallar bo'yicha tarozilar har oy akkreditatsiyalangan davlat metrologiya laboratoriyasi tomonidan tekshirilib, dalolatnoma tuzilishi lozim.
