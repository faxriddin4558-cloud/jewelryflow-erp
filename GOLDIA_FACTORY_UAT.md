# JEWELRYFLOW ERP — GOLDIA ZAVODI FOYDALANUVCHILARINI QABUL QILISH SINOVLARI (USER ACCEPTANCE TESTING - UAT)

**Hujjat Maqsadi:** Goldia zargarlik zavodi xodimlari uchun tizimni amalda sinash va qabul qilish bo'yicha bosqichma-bosqich qo'llanma.  
**Sana:** 16-oktabr 2026  
**Til:** O'zbekcha / Русский / English  

---

## 1. ROLLLAR BO'YICHA SINOV ISHTIROKCHILARI

| Rol | Ism-Sharif / Test Akkaunt | Asosiy Mas'uliyati |
| :--- | :--- | :--- |
| **Bosh Direktor (Director)** | `director@goldia.uz` | Umumiy zavod monitoringi, hisobotlar, korxona sozlamalari |
| **Ishlab Chiqarish Boshlig'i (Manager)** | `manager@goldia.uz` | Partiyalar ochish, sexlararo oqimni boshqarish, nomuvofiqliklarni tasdiqlash |
| **Sex Ustasi / Operatori (Operator)** | `operator@goldia.uz` | Operatsiyalarni bajarish, tarozi orqali topshirish va qabul qilish |
| **Sifat Nazoratchisi (QC Inspector)** | `qc@goldia.uz` | Tayyor va oraliq mahsulot sifatini tekshirish, nuqsonlarni reworkga yo'naltirish |
| **Omborchi (Warehouse Keeper)** | `warehouse@goldia.uz` | Xomashyo (oltin, ligatura) kirim/chiqimi va zaxiralash |
| **Bosh Hisobchi (Accountant)** | `accountant@goldia.uz` | Ishbay oyliklar, metall reconciliatsiyasi, sotuv va mijozlar qarzdorligi |

---

## 2. BOSQICHMA-BOSQICH SINOV SSENARIYLARI (STEP-BY-STEP UAT SCENARIOS)

### Ssenariy 1: Xomashyo Chiqimi va Partiya Ochish
1. **Kim bajaradi:** Ishlab chiqarish boshlig'i (`manager@goldia.uz`).
2. **Qadamlar:**
   - `/batches` bo'limiga kiring.
   - "Partiya ochish" tugmasini bosing.
   - Partiya ID (`BATCH-UAT-001`), Model (`Uzuk Klassika 585`), Proba (`585`), Miqdor (`20 dona`), Berilgan Oltin (`52.000g`) ni kiriting.
   - "Saqlash" tugmasini bosing.
3. **Kutilgan Natija:**
   - Partiya ro'yxatda paydo bo'ladi.
   - Seyfdagi Oltin 585 qoldig'i $52.000$g ga kamayadi.
   - Partiyaga biriktirilgan QR kodli yorliq ekranda ko'rinadi va chop etishga tayyor bo'ladi.

### Ssenariy 2: Uskunani Band Qilish (Machine Station Lock)
1. **Kim bajaradi:** Quyuv sex ustasi (`operator@goldia.uz`).
2. **Qadamlar:**
   - `/manufacturing` bo'limida Quyuv (`CAST-01`) uskunasi kartasini oching.
   - Partiya raqamini tanlang va "Stansiyani band qilish" tugmasini bosing.
3. **Kutilgan Natija:**
   - Uskuna holati `BUSY` ga o'zgaradi.
   - Boshqa usta shu vaqtning o'zida ayni uskunani band qilishga urinsa, "Uskuna hozirda band" ogohlantirishi chiqadi.

### Ssenariy 3: Ikki Tomonlama Topshirish va Tarozi Integratsiyasi (Handover)
1. **Kim bajaradi:** Qolip ustasi (Sender) va Pardozchi (Receiver).
2. **Qadamlar:**
   - Qolip ustasi partiyani keyingi bosqichga topshirish formasini ochadi.
   - Tarozi orqali og'irlik o'lchanadi: masalan, $45.500$g.
   - "Topshirish" tugmasi bosiladi (Holat: `PENDING_ACCEPTANCE`).
   - Qabul qiluvchi pardozchi o'z kompyuterida topshirishni tasdiqlash oynasini ochadi va taroziga qo'yadi.
3. **Kutilgan Natija (Normal holat):**
   - Agar farq $\le 0.05$g bo'lsa, topshirish darhol `ACCEPTED` bo'ladi.
   - Qolip ustasiga ishbay maosh hisoblanadi.
4. **Kutilgan Natija (Nomuvofiqlik holati):**
   - Agar tarozi farqi $> 0.05$g bo'lsa, tizim qabul qilishni to'xtatadi (`DISCREPANCY_FLAGGED`).
   - Ishbay maosh berilmaydi.
   - Supervayzer kelib sababini yozib tasdiqlagandagina partiya keyingi bosqichga o'tadi (`ACCEPTED_WITH_OVERRIDE`).

### Ssenariy 4: Sifat Nazorati va Qayta Ishlash (QC Defect & Rework)
1. **Kim bajaradi:** Sifat nazoratchisi (`qc@goldia.uz`) va Usta.
2. **Qadamlar:**
   - Nazoratchi 14-bosqichda buyumlarni tekshiradi.
   - 2 dona buyumda g'ovaklik aniqlanadi va QC formasida "G'ovaklik (CASTING_POROSITY)" belgilanib, 8-bosqichga (Quyuv) yo'naltiriladi.
3. **Kutilgan Natija:**
   - QC yozuvi `IN_REWORK` holatiga tushadi.
   - 8-bosqich WIP ro'yxatida 2 dona qayta ishlash buyumi paydo bo'ladi.
   - Usta qayta eritib tuzatgandan so'ng `rpc_complete_qc_rework` orqali qaytaradi (`REWORK_COMPLETED`).
   - Nazoratchi qayta tekshirib `APPROVED` qiladi.

### Ssenariy 5: Sotuv, Qarz va Oltin Reconciliatsiyasi
1. **Kim bajaradi:** Bosh hisobchi (`accountant@goldia.uz`).
2. **Qadamlar:**
   - 25-bosqichga yetgan buyum avtomatik tayyor mahsulotlar omborida paydo bo'ladi.
   - `/sales` bo'limida mijozga 1 dona sotuv rasmiylashtiriladi (qarzga).
   - Mijoz qarzidan 500,000 UZS so'ndiriladi.
3. **Kutilgan Natija:**
   - Qarz balansi to'g'ri kamayadi.
   - Ortiqcha to'lov kiritilsa, tizim tranzaksiyani to'xtatadi.
   - `/reports` bo'limida kunlik oltin balansi $0.0000$g aniqlikda chiqadi.

---

## 3. MUAMMOLAR VA TAKLIFLARNI QAYD QILISH (INCIDENT LOGGING)

Sinov davomida kutilmagan xatoliklar yuzaga kelsa, har bir xodim quyidagi ma'lumotlarni qayd qilishi lozim:
1. Ishlatilgan foydalanuvchi emaili va roli.
2. Partiya raqami (`batch_no`) va bosqich nomi.
3. Ekranda chiqqan aniq xatolik matni.
4. Skrinshot yoki tarozi ko'rsatkichi.
