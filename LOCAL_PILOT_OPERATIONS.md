# JewelryFlow ERP — Lokal Pilot Muhitini Boshqarish Qo'llanmasi (Local Pilot Operations)

> **OGOHLANTIRISH / DEMARCATION:**  
> Ushbu muhit **NO-ISHLAB CHIQARISH (NON-PRODUCTION / LOCAL PILOT)** hisoblanadi.  
> U faqat Goldia zargarlik zavodida ichki jarayonlarni sinash, xodimlar malakasini oshirish va UAT (User Acceptance Testing) uchun mo'ljallangan.  
> HTTP javob sarlavhasi: `X-JewelryFlow-Environment: LOCAL-PILOT-EMULATED-NOT-PRODUCTION`.

---

## 1. Tizim Arxitekturasi va Resurs Tejamkorligi ($0 Zero-Budget)

JewelryFlow ERP lokal pilot muhiti tashqi pullik xizmatlar, Docker va og'ir virtualizatsiyasiz ishlaydi:
- **Ma'lumotlar bazasi dvigateli:** PGlite (Haqiqiy PostgreSQL 16 WASM arxitekturasi).
- **Saqlash qatlami (Storage):** Fayl tizimida doimiy (`.local-pilot-data/db`) - server to'xtatilganda yoki kompyuter o'chirilganda ma'lumotlar saqlanib qoladi.
- **Tarmoq xavfsizligi:** Server qat'iy ravishda `127.0.0.1` (loopback) interfeysiga ulanadi. Tashqi tarmoqqa yoki `0.0.0.0` ga hech qachon ochilmaydi.
- **Operativ xotira (RAM) sarfi:** ~40-60 MB (Docker Desktop talab qiladigan 4-6 GB o'rniga).

---

## 2. Serverni Ishga Tushirish va To'xtatish

### A. Lokal Pilotni Ishga Tushirish
Lokal ERP serverini (PGlite DB + REST API + Auth Emulyatsiyasi) ishga tushirish uchun:

```bash
npm run start:offline
```

Standart port: `http://127.0.0.1:54321` (yoki avtomatik keyingi bo'sh port).  
Frontend ilova: `http://localhost:3000` (Next.js).

Ishga tushirish paytida:
1. `.local-pilot-data/db.lock` fayl qulfi tekshiriladi (ikkita server bir vaqtda bir xil fayllarga yozishining oldi olinadi).
2. `public.schema_migrations` jadvali tekshirilib, yangi migratsiyalar faqat bir marta qo'llanadi.
3. `public.local_db_metadata` jadvali tekshirilib, agar foydalanuvchi ma'lumotlari mavjud bo'lsa, demo boshlang'ich ma'lumotlar ustidan yozilmaydi.

### B. Serverni Xavfsiz To'xtatish
Serverni to'xtatish uchun terminalda `Ctrl + C` bosing.
- `SIGINT` / `SIGTERM` hodisasida PGlite bazasi diskka to'liq yozilib (`flush`), `db.lock` qulfi xavfsiz yechiladi.

---

## 3. Demo va Test Foydalanuvchi Hisoblari (Goldia Zavodi)

| Rol | Email | Parol | Mas'uliyat sohasi |
| :--- | :--- | :--- | :--- |
| **Bosh Direktor** | `director@goldia.uz` | `GoldiaPassword2026!` | Barcha bo'limlar, tasdiqlash, kassa, balans |
| **Ishlab chiqarish boshlig'i** | `production@goldia.uz` | `GoldiaPassword2026!` | Partiyalar ochish, metall berish, bosqichlar |
| **Usta (Zargar)** | `worker1@goldia.uz` | `GoldiaPassword2026!` | Operatsiyalarni qabul qilish, bajarish |
| **Sifat nazoratchisi (QC)** | `qc@goldia.uz` | `GoldiaPassword2026!` | OTK nazorati, brak/qayta ishlash |
| **Omborchi (Materiallar)** | `warehouse@goldia.uz` | `GoldiaPassword2026!` | Oltin kirimi, sof metall, qoldiq |
| **Buxgalter / Kassir** | `accountant@goldia.uz` | `GoldiaPassword2026!` | Sotuvlar, naqd pul, mijoz qarzlari |

---

## 4. Diagnostika va Monitoring Endpointlari

- **Salomatlik tekshiruvi:** `GET http://127.0.0.1:54321/staging/health`  
  Qaytariladigan ma'lumot:
  ```json
  {
    "status": "ok",
    "persistent": true,
    "dataDir": "C:\\...\\.local-pilot-data\\db",
    "engine": "pglite-wasm-postgres"
  }
  ```
- **Jonli zaxira nusxa yaratish:** `POST http://127.0.0.1:54321/staging/backup` (Admin/Direktor tokeni bilan).

---

## 5. Favqulodda Holatlar va Nosozliklarni Bartaraf Qilish

1. **`Database is already locked by PID ...` xatosi:**  
   Agar kompyuter to'satdan o'chib qolsa yoki jarayon majburiy yopilsa, `.local-pilot-data/db.lock` qolib ketishi mumkin. Server eski jarayon mavjud emasligini avtomatik tekshiradi. Agar kerak bo'lsa, `.local-pilot-data/db.lock` faylini qo'lda o'chirib, qayta ishga tushiring.
2. **Port band bo'lishi (Port conflict):**  
   Agar 54321 porti band bo'lsa, server avtomatik ravishda 54322, 54323 portlarini tanlaydi.
