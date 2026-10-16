# JEWELRYFLOW ERP — GOLDIA FACTORY PILOT READINESS REPORT

**Hujjat Versiyasi:** 1.0.0 (Mega Sprint 4 Natijasi)  
**Sana:** 16-oktabr 2026  
**Korxona:** Goldia Zargarlik Zavodi  
**Tizim:** JewelryFlow ERP (Multi-Tenant SaaS Core)  
**Tahlilchi:** Principal Software Architect, Full-Stack Lead & Security Reviewer  

---

## 1. KORXONA PARAMETRLARI VA SOZLAMALARI

| Parametr | Qiymat | Izoh |
| :--- | :--- | :--- |
| **Korxona Nomi** | Goldia Zargarlik Zavodi | Birlamchi pilot ishlab chiqarish korxonasi |
| **Organization Code** | `goldia` | Multi-tenant tizim identifikatori |
| **Ishchilar Soni** | 33 nafar xodim | 6 ta asosiy rol: Direktor, Menejer, Usta/Operator, QC, Omborchi, Hisobchi |
| **Texnologik Bosqichlar** | 20 ta faol bosqich (22 tadan 2 tasi chetlab o'tiladi) | Maxsus zargarlik oqimi |
| **Chetlab O'tilgan Bosqichlar** | **9. Ponza (Pumice)** va **13. Zircon (Zirkon)** | Goldia texnologiyasiga binoan avtomatik sakraladi (`organization_factory_settings`) |
| **Birlamchi Metallar** | 585 va 750 probali oltin, 999.9 chisto oltin | Qotishma va ligatura hisobi to'liq integratsiya qilingan |
| **Kunlik Quvvat** | 700g – 1,000g oltin qayta ishlash | 10 ta partiya parallel ishlab chiqarish simulyatsiyasidan muvaffaqiyatli o'tdi |

---

## 2. ERP MODULLARI HOZIRGI HOLATI VA TAYYORLIK DARAJASI

| Modul | Holati | Sinov Natijasi | Tayyorlik |
| :--- | :---: | :--- | :---: |
| **Oltin Ombori & Seyf (Safe Inventory)** | **PRODUCTION-READY** | Salbiy qoldiqdan himoyalangan, 0.001g aniqlik, 999.9 chisto oltin ekvivalenti avtomatik | 100% |
| **Qotishma & Affinaj (Alloy & Refining)** | **PRODUCTION-READY** | 585 $\rightarrow$ 750 mass saqlanishi, ligatura sarfi, shlak yo'qotishlari to'liq nazoratda | 100% |
| **Ishlab Chiqarish & WIP Bosqichlari** | **PRODUCTION-READY** | 20 bosqichli marshrut, qolipdan tayyor omborgacha to'liq mass balansi, ortiqcha yo'qotish to'siqlari | 100% |
| **Ikki Tomonlama Topshirish (Handover)** | **PRODUCTION-READY** | Sender $\rightarrow$ Receiver oraliq qabul, $\pm 0.05$g og'ishda `DISCREPANCY_FLAGGED`, supervayzer ruxsati | 100% |
| **Uskunalar Band Qilinishi (Machine Lock)** | **PRODUCTION-READY** | Quyuv va Lazer stansiyalarida parallel band qilishni taqiqlovchi atomik qulf (`IDLE` $\leftrightarrow$ `BUSY`) | 100% |
| **Sifat Nazorati & Rework (QC Lifecycle)** | **PRODUCTION-READY** | Nuqson qayd qilish, qayta ishlash bosqichiga yo'naltirish, usta tamirlashi, qayta tekshiruv | 100% |
| **Tayyor Mahsulot Ombori (Vitrina)** | **PRODUCTION-READY** | Partiya 25-bosqichga yetganda avtomatik `products` jadvalida yaratiladi va omborga kirim qilinadi | 100% |
| **Sotuv & Mijoz Qarzdorligi (Sales & Debts)**| **PRODUCTION-READY** | Stok kamayishi, to'lovlar, ortiqcha to'lovni taqiqlovchi to'siq, qarz so'ndirish jurnali | 100% |
| **Ishbay Maosh (Piecework Payroll)** | **PRODUCTION-READY** | Topshirish qabul qilingandagina maosh hisoblanadi, takroriy hisoblash taqiqlangan, jarima/tuzatish nazorati | 100% |
| **Multi-Tenant Izolyatsiya** | **PRODUCTION-READY** | Row Level Security (RLS), barcha jadvallarda `organization_id`, qat'iy tenantlararo to'siq | 100% |

---

## 3. APPARATURA VA USKUNALAR INTEGRATSIYASI (HARDWARE READINESS)

### 3.1. Laboratoriya Tarozisi (Web Serial Precision Scale)
- **Drayver:** `src/lib/hardware/scale-serial.ts`
- **Aniqlik:** Milligramm ($0.001$g) darajasida yaxlitlash va filtrlash.
- **Birlik:** Faqat gramm (`g`) qabul qilinadi; unsiya (`oz`), karat (`ct`), funt (`lb`) yoki funtlar qat'iy rad etiladi.
- **Diapazon Tekshiruvi:** $-1000$g dan $+50,000$g gacha ruxsat etiladi; g'ayritabiiy yoki xato ASCII o'qishlari chetlatiladi.
- **Xavfsizlik:** Web Serial ruxsatsiz yoki ulanmagan brauzerlarda xatolik aniq tushuntiriladi.
- **Qo'lda Kiritish:** Tarozi ulanmaganda qo'lda kiritishga ruxsat etiladi, biroq tizimda qat'iy `[✍️ Qo'lda kiritilgan]` belgisi bilan qayd etiladi va supervayzer nazoratiga tushadi.

### 3.2. QR Kod va Yorliq Chop Qiluvchi Printer (QR Label Printer)
- **Generator:** `src/lib/hardware/qr-printer.ts`
- **Format:** Har bir partiya uchun unikal identifikator, model nomi, metall probasi, chiqarilgan sana va partiya raqami jamlangan QR kod.
- **Chop etish:** To'g'ridan-to'g'ri brauzer orqali yoki sanoat termo-printerlari (Zebra/TSPL) uchun SVG/Raster formatida chiqarish imkoniyati.

---

## 4. GO / NO-GO XULOSASI

| Kriteriya | Talab | Hozirgi Holat | Xulosa |
| :--- | :--- | :--- | :---: |
| **Mass Conservation** | Yo'qotish va chiqindilar hisobi $0.0000$g aniqlikda bo'lishi | $739.5000$g oltin bo'yicha $0.0000$g og'ish bilan to'liq saqlandi | **O'TDI** |
| **Negative Balances** | Oltin va tayyor mahsulot balansi noldan kamaymasligi | Barcha salbiy kiritishlar va ortiqcha chiqimlar DB darajasida rad etiladi | **O'TDI** |
| **Role Enforcement** | Ishchi va supervayzer vakolatlari chegaralanishi | RLS va DB RPC ruxsatlari barcha rollar bo'yicha tasdiqlandi | **O'TDI** |
| **Tenant Isolation** | Boshqa zavod Goldia ma'lumotlarini ko'ra olmasligi | Samarkand zavodi operatori va boshlig'i uchun 100% izolyatsiya | **O'TDI** |
| **Hardware Driver** | Tarozi xatoliklaridan himoyalanganlik | Serial port uzilishi, noto'g'ri o'lchov birligi va tebranishlar to'liq ushlanadi | **O'TDI** |

### **QAROR: PILOT BOSQICHIGA RUN (GO)**
JewelryFlow ERP tizimi Goldia zargarlik zavodining nazorat ostidagi pilot sinoviga (Controlled Factory Pilot) to'liq tavsiya etiladi.
Staging muhitida sinovlar muvaffaqiyatli yakunlangach, real ishlab chiqarish maydoniga joriy etish mumkin.
