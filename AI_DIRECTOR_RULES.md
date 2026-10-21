# JEWELRYFLOW ERP — AI DIRECTOR & ORCHESTRATOR GOVERNANCE RULES
**Hujjat Nomi:** AI_DIRECTOR_RULES.md  
**Versiya:** 1.0.0  
**Amal qilish sanasi:** 16-oktabr 2026  
**Rejim:** `AUTOPILOT_MODE=READ_ONLY`  

---

## 1. YAGONA DIREKTOR PRINSIPI
- Hech qachon ikkita mustaqil yozuvchi AI direktor tizimi parallel ishga tushirilmaydi.
- Hozirgi kunda ChatGPT suhbatidagi qo'lda boshqariladigan muhandislik qarorlari — yagona vakolatli boshqaruvchi hisoblanadi.
- Autopilot tizimi faqat READ-ONLY rejimida ishlaydi (kuzatish, xotirada saqlash, sinxronizatsiya, taklif kiritish).

---

## 2. KOD YOZUVCHI AGENTLARNI BOSHQARISH QOIDALARI

### A. Jules (Masofaviy Coding Agent)
- Jules API orqali yangi sessiya yaratish uchun loyiha egasining alohida tasdig'i shart.
- Jules yangi topshiriq olganda uning boshlang'ich commit'i albatta `dev/manufacturing-erp-saas` ning eng so'nggi tasdiqlangan commit'i bo'lishi shart (`06ad6de` yoki `8b99ff7`).
- Hech qachon `main` yoki eski `4ddc0d0` commitidan yangi sessiya ochilmaydi.
- Jules faqat o'ziga ruxsat etilgan frontend fayllariga (`src/components/manufacturing/*`, `src/hooks/manufacturing/*`, `src/app/(dashboard)/manufacturing/*`) teginadi.

### B. Antigravity (Lokal Muhandislik Agenti)
- Baza migratsiyalari (`supabase/migrations/*`), biznes mantiq (`src/lib/*`), xavfsizlik (RLS, Auth), va E2E testlariga to'liq javobgar.
- Barcha o'zgarishlar lokal izolyatsiyalangan muhitda qat'iy tekshiriladi va faqat tasdiqdan so'ng commit qilinadi.
- Masofaviy remote'ga push faqat inson tasdig'i bilan amalga oshiriladi.

---

## 3. XOTIRA VA TASK REGISTRY (MEMORY.DB) QOIDALARI
- Barcha faol va o'tgan topshiriqlar `memory/memory.db` SQLite bazasida qayd etiladi.
- Hech qachon ikkita faol topshiriq bir vaqtda bitta faylni tahrirlash huquqiga ega bo'lmaydi (Exclusive File Locks).
- API kalitlari, parollar va maxfiy ma'lumotlar SQLite xotirasiga yoki audit loglariga yozilishi qat'iyan taqiqlanadi.

---

## 4. XAVFSIZLIK VA TO'XTATISH (KILL SWITCH)
- Loyiha egasi istalgan vaqtda yagona buyruq orqali barcha tashqi avtomatik amallarni to'xtatish huquqiga ega.
- Hech qanday AI avtomatik tarzda `git push`, PR merge yoki production deployment amallarini bajara olmaydi.
