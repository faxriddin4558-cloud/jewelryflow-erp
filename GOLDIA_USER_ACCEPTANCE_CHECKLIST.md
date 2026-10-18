# Goldia Zargarlik Zavodi — ERP Foydalanuvchi Qabul Qilish Sinovlari (UAT Checklist)

Ushbu hujjat Goldia zargarlik zavodining barcha mas'ul xodimlari uchun JewelryFlow ERP tizimini amaliy sinovdan o'tkazish bo'yicha qadamma-qadam qo'llanma hisoblanadi.

---

## Rol 1: Bosh Direktor (Director)
- **Login:** `director@goldia.uz` | **Parol:** `GoldiaPassword2026!`
- [ ] **1.1. Kirish va Dashboard:** Tizimga kiring. Asosiy sahifada Goldia zavodi balansi, faol partiyalar soni va metall qoldiqlari to'g'ri ko'rsatilayotganini tekshiring.
- [ ] **1.2. Korxona Profili va Sozlamalar (`/settings`):** "Korxona Profili" bo'limiga o'ting. Goldia uchun bypass qilingan bosqichlar (9-Ponza va 13-Sirkon terish) o'chirilganligini va quvvatlar (500 dona/oy) saqlanganligini tekshiring.
- [ ] **1.3. Moliyaviy va Qarz Balansi:** Buxgalteriya va hisobotlar bo'limida umumiy tushum va mijozlar qarzdorligi yig'indisini solishtiring.

---

## Rol 2: Ishlab Chiqarish Boshlig'i (Production Manager)
- **Login:** `production@goldia.uz` | **Parol:** `GoldiaPassword2026!`
- [ ] **2.1. Buyurtmalar (`/orders`):** Mijozdan yangi buyurtma qabul qiling (masalan, 10 dona 585 probadagi uzuk).
- [ ] **2.2. Partiya Yaratish va Oltin Berish (`/batches`):**
  - "Yangi partiya ochish" tugmasini bosing.
  - Ombor kartasidan kerakli qotishmani tanlang (masalan, 45.000g sof/qotishma oltin).
  - Partiya raqami (`BATCH-2026-001`) va ustani biriktiring.
  - Oltin omboridan metall kamayganligini va partiyaning 1-bosqichga (`1. Eritish`) tushganini tekshiring.
- [ ] **2.3. Sexlararo Marshrut Nazorati (`/manufacturing`):** Partiyaning bosqichma-bosqich harakatini kuzatib boring.

---

## Rol 3: Usta / Zargar (Worker)
- **Login:** `worker1@goldia.uz` | **Parol:** `GoldiaPassword2026!`
- [ ] **3.1. Ishlarni Qabul Qilish:** O'zingizga biriktirilgan partiyani ko'ring.
- [ ] **3.2. Tarozida Tortish va Yozish:**
  - Ish boshlanishida kirish vaznini tekshiring.
  - Operatsiya tugagach, chiqish vazni (`good`), arrali qirindi (`sprue`), qayta eritiladigan parcha (`scrap`) va yo'qotish (`loss`) miqdorlarini kiriting.
  - *Diqqat:* Agar jami chiqish kirishdan oshib ketsa, tizim xato berishi va operatsiyani to'xtatishi shart (Mass Balance Guard).
- [ ] **3.3. Keyingi Bosqichga Topshirish:** Mahsulotni keyingi bosqich ustasiga dalolatnoma bilan topshiring.

---

## Rol 4: Sifat Nazorati Mutaxassisi (QC Inspector)
- **Login:** `qc@goldia.uz` | **Parol:** `GoldiaPassword2026!`
- [ ] **4.1. OTK Tekshiruvi:** Tayyorlanayotgan partiyani ko'rikdan o'tkazing.
- [ ] **4.2. Sifat Dalolatnomasi:**
  - Agar buyum nuqsonsiz bo'lsa: "Tasdiqlash" (Approved) bosing.
  - Agar nuqson aniqlansa: "Qayta ishlashga qaytarish" (Rework/Reject) bosing va sababini yozing (masalan: "G'ovaklik mavjud").
- [ ] **4.3. Qayta Tekshirish (Re-inspection):** Usta nuqsonni to'g'rilagach, buyumni qayta qabul qiling.

---

## Rol 5: Xomashyo Omborchisi (Warehouse)
- **Login:** `warehouse@goldia.uz` | **Parol:** `GoldiaPassword2026!`
- [ ] **5.1. Metall Kirimi (`/inventory`):** Yangi sof oltin (999.9 proba) yoki lom qabul qiling.
- [ ] **5.2. Sof Oltin Ekvivalenti:** Tizim kiritilgan probalar bo'yicha sof oltin (`pure_gold`) hisob-kitobini to'g'ri bajarganini tekshiring (`vazn * proba / 1000`).
- [ ] **5.3. Seyf Qoldig'i:** Ishlab chiqarishga berilgan va omborda qolgan metall mutanosibligini tekshiring.

---

## Rol 6: Buxgalter / Sotuv Mutaxassisi (Accountant / Sales)
- **Login:** `accountant@goldia.uz` | **Parol:** `GoldiaPassword2026!`
- [ ] **6.1. Sotuvni Rasmiylashtirish (`/sales`):**
  - Tayyor ombordan buyumni tanlang.
  - Mijoz nomi, to'lov turi (Naqd pul / Karta / Nasiya) va summalarni kiriting (masalan, jami 3.5M, to'langan 2.0M, qarz 1.5M).
  - Tayyor mahsulot soni 1 taga kamayganligini tekshiring.
- [ ] **6.2. Mijoz Qarzini Qabul Qilish:**
  - Mijoz qisman to'lov qilganda (500,000 UZS) to'lovni yozing.
  - Qarz miqdori 1,000,000 UZS gacha aniq kamayganligini tekshiring.
  - Agar to'lov summasi mavjud qarzdan ko'p kiritilsa, tizim to'lovni rad etishini tekshiring.
- [ ] **6.3. Ishbay Oylik Hisobi (Piecework Salary):** Har bir ustaning bajargan operatsiyalari va tasdiqlangan donalari bo'yicha hisoblangan ish haqini tekshiring.
