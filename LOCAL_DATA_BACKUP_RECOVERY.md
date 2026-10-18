# JewelryFlow ERP — Lokal Ma'lumotlarni Zaxiralash va Qayta Tiklash Qo'llanmasi (Backup & Recovery)

> **Xavfsizlik Qoidasi:**  
> Har qanday ma'lumotlarni qayta tiklash yoki eksperimental sinovlardan oldin zaxira nusxa yaratish qat'iy talab etiladi.  
> Ushbu mexanizm 100% oflayn ishlaydi va bulutli xarajatlarni talab qilmaydi.

---

## 1. Zaxira Nusxa Yaratish (Backup)

JewelryFlow ERP da zaxira nusxa yaratishning ikkita usuli mavjud:

### Usul 1: Buyruqlar qatori orqali (Tavsiya etiladi)
Terminalda quyidagi buyruqni bajaring:

```bash
npm run db:backup
```

Yoki to'g'ridan-to'g'ri:
```bash
node scripts/backup-local-db.js
```

**Bu buyruq nima qiladi?**
1. Agar server ishlab turgan bo'lsa: `POST http://127.0.0.1:54321/staging/backup` orqali tranzaksiyalar to'liq yozilgan (flushed) holatda xavfsiz nusxa oladi.
2. Agar server to'xtatilgan bo'lsa: `.local-pilot-data/db` papkasini to'liq tekshirib, snapshot yaratadi.
3. Nusxa `.local-backups/backup-YYYY-MM-DDTHH-mm-ss-sssZ/db` manziliga saqlanadi.
4. Har bir zaxira papkasida `metadata.json` fayli yaratilib, unda timestamp, tizim versiyasi va fayllar ro'yxati qayd etiladi.

### Usul 2: REST API orqali (Jonli zaxira)
```bash
curl -X POST http://127.0.0.1:54321/staging/backup \
  -H "Authorization: Bearer <DIRECTOR_TOKEN>" \
  -H "Content-Type: application/json"
```

---

## 2. Ma'lumotlarni Qayta Tiklash (Restore)

### A. Eng so'nggi zaxira nusxasidan tiklash:
```bash
npm run db:restore
```

### B. Muayyan zaxira nusxasidan tiklash:
```bash
node scripts/restore-local-db.js .local-backups/backup-2026-10-17T17-27-16-519Z
```

### Tiklash Jarayonidagi Himoya Qatlamlari:
1. **Server holati tekshiruvi:** Agar server ishlab turgan bo'lsa (`db.lock` faol bo'lsa), tiklash darhol to'xtatiladi. Ma'lumotlar buzilishining oldi olinadi.
2. **Pre-restore Safety Snapshot:** Tiklashdan oldin mavjud ma'lumotlar avtomatik ravishda `.local-backups/pre-restore-safety-TIMESTAMP/db` manziliga saqlanadi. Shuning uchun hech qanday xato bilan ma'lumotlar tasodifan yo'qolib ketmaydi.
3. **PGlite yaxlitlik tekshiruvi (Integrity Check):** Zaxira fayllari ko'chirilgach, PGlite dvigateli mustaqil ochilib, tashkilotlar (`organizations`) va partiyalar (`batches`) jadvallari o'qilishi tekshiriladi. Faqat tekshiruv muvaffaqiyatli o'tsagina operatsiya yakunlanadi.

---

## 3. Favqulodda Falokatdan Tiklash (Disaster Recovery Plan)

Agar kompyuterning qattiq diskida nosozlik yuz bersa yoki operatsion tizim qayta o'rnatilsa:
1. `.local-backups` papkasidagi eng oxirgi `backup-*` papkasini yangi o'rnatilgan tizimga ko'chiring.
2. `node scripts/restore-local-db.js <backup_papka_yo'li>` buyrug'ini ishga tushiring.
3. `npm run start:offline` orqali ERP tizimini oching. Barcha oltin partiyalari, tarozilar tarixi va mijozlar qarzlari saqlanib qoladi.
