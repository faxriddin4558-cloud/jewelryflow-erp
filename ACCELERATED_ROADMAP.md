# JEWELRYFLOW ERP — ACCELERATED MULTI-AGENT DEVELOPMENT ROADMAP
**Hujjat Versiyasi:** 1.1.0-USER-WORKFLOW-VERIFIED  
**Sana:** 2026-10-16  
**Loyiha:** JewelryFlow ERP (Goldia Factory Core ERP & Multi-Tenant SaaS)  
**Asosiy Branch:** `dev/manufacturing-erp-saas`  
**Rollar & Dvigatellar:** Google Antigravity (Backend, DB, Security, Core Engine) & Jules (Frontend, UI/UX, Hardware & Operator Experience)  
**Texnik Lider:** Principal Software Architect / Full-Stack & Security Lead  
**Holat:** 23 ta SQL Migratsiya, 111 ta Vitest Unit Test, 30 ta Real PostgreSQL Integratsiya Testi, 10-Partiya E2E Simulyatsiyasi (0.0000g leak), 32 ta Production Sahifa  

---

## 1. LOYIHA STRATEGIYASI VA MAQSADLAR

1. **Goldia Factory 4–6 Haftalik Pilot Ishga Tushirish:**
   - Goldia zavodi zargarlik ishlab chiqarish jarayonini (quyishdan tayyor omborga qadar 20 bosqich, Ponza/Zircon bypass qilingan holda) to'liq avtomatlashtirish.
   - Oltin balansi, yo'qotishlar (loss), tarozi farqlari (discrepancy) va ish haqi hisobini 100% qat'iy nazorat ostiga olish.
2. **Multi-Tenant SaaS Arxitekturasi:**
   - Boshqa zargarlik fabrikalariga alohida dasturiy ta'minot sifatida taqdim etish (har bir fabrika o'zining bosqichlari, uskunalari va xodimlariga ega bo'ladi).
   - Qat'iy ma'lumotlar izolyatsiyasi (Row Level Security - RLS) orqali hech qachon fabrikalar ma'lumotlari aralashib ketmasligi.
3. **Mavjud Imkoniyatlarni Saqlash:**
   - 001 dan 023 gacha bo'lgan barcha SQL migratsiyalar, 16 ta atomik RPC funksiya, 111 ta Vitest va 30 ta real ma'lumotlar bazasi integratsiya testlari saqlanadi va kengaytiriladi.

---

## 2. TO'LIQ MODULLAR INVENTARIZATSIYASI (MODULE INVENTORY)

| Modul | Qism / Komponent | Hozirgi Holat | Real DB / Test | Mas'ul Agent | Izoh |
|---|---|---|---|---|---|
| **Gold Accounting** | Xomashyo SAFE balansi va 585/750/999 sof oltin | **DONE** | PASS (Test 1, 6) | Antigravity | Formulalar va 4-6 kasr aniqlik real DB da tasdiqlangan |
| **Gold Accounting** | Ligatura / Qotishma hisoblagich (Alloying) | **DONE** | PASS | Antigravity / Jules | `rpc_execute_alloy_transaction` ishlaydi, UI mavjud |
| **Gold Accounting** | Affinaj / Qayta eritish (Refining) | **DONE** | PASS | Antigravity / Jules | `rpc_execute_affinaj_transaction` ishlaydi, UI mavjud |
| **Gold Accounting** | Qirqim va Litnik (Sprue/Scrap) qaytarish | **DONE** | PASS (Test 7) | Antigravity | `rpc_return_sprue_to_scrap_inventory` ishlaydi |
| **Manufacturing** | Partiya ochish va xomashyo ajratish | **DONE** | PASS (Test 1) | Antigravity | `rpc_create_batch_with_gold_issue` ishlaydi |
| **Manufacturing** | Qisman WIP ko'chirish (Partial WIP Move) | **DONE** | PASS (Test 7, 8) | Antigravity | Bosqich mass balansi va ortiqcha oltin paydo bo'lishidan himoyalangan |
| **Manufacturing** | Server-side texnologik yo'qotish (Loss) nazorati | **DONE** | PASS (Test 9-11) | Antigravity | 021-migratsiya: me'yordan oshganda bloklash va direktor tasdig'i |
| **Manufacturing** | Ikki tomonlama topshirish (Two-Party Handover) | **DONE** | PASS (Test 13-15) | Antigravity / Jules | 0.05g farqda `DISCREPANCY_FLAGGED`, supervisor override mavjud |
| **Manufacturing** | Dastgohlar konkurentligi (Machine Locking) | **DONE** | PASS (Test 16-19) | Antigravity | Atomik band qilish, double-booking bloklash, bo'shatish |
| **Manufacturing** | Partiyani bo'lish (Batch Split) | **DONE** | PASS | Antigravity | `rpc_split_batch` bolalar partiyasini va WIP ni yaratadi |
| **Manufacturing** | Goldia 9 va 13-bosqichlarni chetlab o'tish (Bypass) | **DONE** | PASS (14 tests) | Antigravity | `factory-config.ts` va `organization_factory_settings` to'liq ishlaydi |
| **Manufacturing** | 15 ta bo'lim taxtalari (Department Boards) | **DONE** | PASS | Antigravity / Jules | Clean Architecture sahifalari mavjud, hub va planshet ko'rinishi ulangan |
| **Manufacturing** | Sex xodimi planshet interfeysi (Operator Touch UI) | **DONE** | PASS | Jules / Antigravity | `ShopfloorOperatorWorkspace` barcha 6 ta Jules komponenti bilan ulandi |
| **Manufacturing** | Elektron tarozi integratsiyasi (Web Serial API) | **PARTIAL** | NOT VERIFIED | Jules | Server-side &plusmn;0.05g tarozi nazorati ishlaydi; Web Serial API drayveri kelgusida ulanadi |
| **Manufacturing** | Shtrix-kod / QR-kod generatsiyasi va skaneri | **DONE** | PASS (12 tests) | Antigravity | `qr-generator.ts` orqali 58x40mm SVG va brauzerda chop etish ishlaydi |
| **Products & BOM** | Mahsulotlar katalogi va BOM spetsifikatsiyasi | **DONE** | PASS | Antigravity | `rpc_create_product_with_bom` ishlaydi |
| **Products & BOM** | Tayyor omborga avtomatik kirim (25-bosqich) | **DONE** | PASS (Test 20) | Antigravity | 25-bosqichga o'tganda `products.stock` avtomatik oshadi |
| **Sales & Finance** | Buyurtma olish va avans qabul qilish | **DONE** | PASS | Antigravity | `rpc_create_order_with_advance` ishlaydi |
| **Sales & Finance** | Buyurtmani ishlab chiqarishga yo'naltirish | **DONE** | PASS | Antigravity | `rpc_launch_order_production_chain` ishlaydi |
| **Sales & Finance** | Ombordan yechish bilan sotuv va kassa | **DONE** | PASS (Test 21, 22) | Antigravity | Manfiy qoldiq rad etiladi, kassa va qarz yoziladi |
| **Sales & Finance** | Mijoz qarzini to'lash va hisob-kitob | **DONE** | PASS (Test 23, 24) | Antigravity | `rpc_record_debt_repayment` tenant himoyasi bilan ishlaydi |
| **HR & Payroll** | Xodimlar ro'yxati va rollar | **DONE** | PASS | Antigravity | Supabase Auth va RBAC bilan integratsiya qilingan |
| **HR & Payroll** | Ish haqi daftari (Salary Ledger) | **DONE** | PASS | Antigravity | `rpc_record_salary_entry` ishlaydi |
| **HR & Payroll** | Ishbay (grammabay) avtomatik tariflash | **DONE** | PASS | Antigravity | `rpc_calculate_piecework_salary` faqat qabul qilingan topshirishdan keyin |
| **Multi-Tenant SaaS** | Tashkilotlar jadvali va sozlamalari (018/023) | **DONE** | PASS (Test 25-27) | Antigravity | `organization_factory_settings` bazada persist bo'ladi |
| **Multi-Tenant SaaS** | Barcha 46 ta jadvalda qat'iy tenant RLS | **DONE** | PASS (Test 2-5) | Antigravity | Operator B Org A ga tegolmaydi |
| **Multi-Tenant SaaS** | Tenant Sozlamalari Boshqaruvi | **DONE** | PASS | Antigravity | `/settings` dagi 🏭 Korxona Profili orqali bazaga saqlanadi |
| **Audit & QC** | Xavfsizlik auditi logi (`audit_logs`) | **DONE** | PASS (Test 11) | Antigravity | Barcha jiddiy o'zgarishlar va override lar qayd etiladi |
| **Audit & QC** | Sifat nazorati inspeksiyasi (QC Defect Routing) | **DONE** | PASS (Test 28-30) | Antigravity | `rpc_record_qc_inspection` orqali nuqsonlar saqlanadi va rework ga yo'naltiriladi |
| **Reconciliation** | Korxona miqyosidagi oltin rekonsilyatsiyasi | **DONE** | PASS | Antigravity | 21-hisobot `auditFactoryIntegrity` kamomadlarni avtomatik aniqlaydi |

---

## 3. 4–6 HAFATLIK GOLDIA ZAVODI PILOT REJASI (CRITICAL PATH)

Goldia fabrikasida real qimmatbaho metallar (oltin, kumush, brilliant) bilan xatoliksiz ishlash uchun quyidagi kritik yo'nalish belgilanadi:

```
[1-2 HAFTA: HARDWARE & TOUCH UI]
   ├── HW-01: Tarozi (Web Serial) drayveri integratsiyasi
   ├── HW-02: QR-kodli yorliq (Zebra/Xprinter) chop etish va skaner
   └── UI-01: Sex operatorlari uchun yirik planshet interfeysi (Operator Touch Mode)
         │
         ▼
[3-4 HAFTA: UNIFIED WORKFLOW & PIECE-RATE PAYROLL]
   ├── WF-01: 15 ta bo'lim taxtasini `batch_stage_wip` bilan to'liq sinxronlash
   ├── HR-01: Har bir topshirilgan operatsiya uchun avtomatik ishbay oylik hisoblash
   └── QC-01: 22-bosqich (Sifat nazorati) vizual nuqson qayd qilish dialogi
         │
         ▼
[5-6 HAFTA: FACTORY PILOT & AUDIT]
   ├── E2E-01: 10 ta real partiyani to'liq 20 bosqichdan o'tkazish
   ├── SEC-01: Kunlik oltin balansi tekshiruvi (Discrepancy & Loss Audit)
   └── PROD-01: Boshqaruv kengashi uchun TV Dashboard va hisobotlarni topshirish
```

---

## 4. AGENTLAR O'RTASIDA ISH TAQSIMOTI VA FAYL HUQUQLARI (NON-OVERLAPPING OWNERSHIP)

To'qnashuvlar (merge conflicts) va xavfli buzilishlarning oldini olish uchun fayllarga egalik huquqi qat'iy taqsimlandi:

### A. Google Antigravity Mas'uliyati (Backend, Security, Core Engine)
- **Fayl hududi (Exclusive):**
  - `supabase/migrations/*` (barcha SQL, RLS, DDL, triggerlar)
  - `src/lib/erp-engine.ts`, `src/lib/factory-config.ts`, `src/lib/two-party-handover.ts`, `src/lib/machine-queue.ts`
  - `src/lib/supabase/*` (client, server, middleware, auth guards)
  - `scripts/*` (DB migratsiyalari, PGlite integratsiya testlari)
  - `src/lib/__tests__/*` (Vitest test to'plamlari)
  - `src/modules/manufacturing/application/*` (Use caselar)
  - `src/modules/manufacturing/domain/*` (Domen modellari va qoidalar)
  - `src/modules/manufacturing/infrastructure/*` (Repositorylar, DB mappers)

### B. Jules Mas'uliyati (Frontend, UI/UX, Hardware & Operator Experience)
- **Fayl hududi (Exclusive):**
  - `src/app/(dashboard)/manufacturing/*` (Barcha sex sahifalari)
  - `src/modules/manufacturing/presentation/components/*` (Kanban doskalari, kartalar, dialoglar)
  - `src/modules/manufacturing/presentation/hooks/*` (UI hooklari)
  - `src/components/*` (UI kit, dialoglar, formalar, badge lar)
  - `src/app/batches/components/*` (Partiya UI qismlari, tarozi modali)
  - `src/app/sales/*`, `src/app/orders/*`, `src/app/inventory/*`, `src/app/consumption/*` (UI dizayni va operator qulayligi)
  - Hardware integratsiyasi: `src/lib/hardware/scale-serial.ts`, `src/lib/hardware/barcode-printer.ts`

### C. Birgalikdagi Shartnomalar (Contracts & Interfaces)
- `src/shared/types/database.types.ts` — Faqat Antigravity tomonidan yangilanadi, Jules undan foydalanadi.
- `src/shared/types/domain.ts` — Birgalikda kelishilgan holda kengaytiriladi.
- API / RPC parametrlari o'zgarmas shartnoma hisoblanadi.

---

## 5. BRANCH VA INTEGRATSIYA STRATEGIYASI (GIT WORKFLOW)

1. **Himoyalangan Branchlar:**
   - `main`: Faqat ishlab chiqarishga chiqariladigan versiyalar (hech qachon to'g'ridan-to'g'ri push qilinmaydi).
   - `dev/manufacturing-erp-saas`: Asosiy barqaror integratsiya branchi.
2. **Agent Ishchi Branchlari:**
   - Antigravity: `feature/ag-<task-id>-<description>`
   - Jules: `feature/jules-<task-id>-<description>`
3. **Qabul Qilish Darvozalari (Quality Gates on PR):**
   - [ ] `npm run test:db:all` — Barcha 21 migratsiya va 24 integratsiya testi toza real PostgreSQL da 100% o'tishi kerak.
   - [ ] `npm test` — Barcha 78 ta Vitest testi muvaffaqiyatli bo'lishi kerak.
   - [ ] `npm run typecheck` — TypeScript turlarida 0 ta xatolik bo'lishi kerak.
   - [ ] `npm run lint` — ESLint da 0 ta warning va 0 ta error bo'lishi kerak.
   - [ ] `npm run build` — Next.js production build 31/31 sahifada muvaffaqiyatli bo'lishi kerak.

---

## 6. DASTLABKI 14 KUNLIK IJRO REJASI (SPRINT BACKLOG)

### KUN 1–3: Hardware & Sex Tarozi Integratsiyasi (Hardware Enablers)
- **TASK-HW-01 [Priority: P0] [Owner: Jules]**: Web Serial API orqali laboratoriya tarozi drayveri (Cas, Sartorius, Ohaus).
  - *Qabul mezonlari:* Operator "Tarozidan olish" tugmasini bosganda, USB/COM port orqali og'irlik 0.0001g aniqlikda `received_weight_gram` maydoniga tushishi kerak.
- **TASK-AG-01 [Priority: P0] [Owner: Antigravity]**: `rpc_accept_stage_handover` da avtomatik tarozi tekshiruvini qat'iylashtirish.
  - *Qabul mezonlari:* Tarozi orqali olingan qiymat bilan jo'natilgan qiymat farqi 0.05g dan oshsa, `DISCREPANCY_DETECTED` statusi o'rnatilib, sabab talab qilinishi kerak.

### KUN 4–7: Ishlab chiqarish Bo'lim Taxtalari & Sinxronizatsiya
- **TASK-WF-02 [Priority: P0] [Owner: Antigravity]**: `src/modules/manufacturing` bilan `batch_stage_wip` ni to'liq integratsiya qilish.
  - *Qabul mezonlari:* Sex taxtalarida (`/manufacturing/casting`, va h.k.) operatsiyalar bajarilganda, `batch_stage_wip` jadvallari va Goldia bypass sozlamalari real vaqtda bir xil holatda bo'lishi kerak.
- **TASK-UI-02 [Priority: P0] [Owner: Jules]**: Sex operatorlari uchun "Operator Touch Mode" interfeysi.
  - *Qabul mezonlari:* 10-dyuymli planshetda qo'lqop bilan bosishga qulay, katta status tugmalari, partiya QR-kodini kamera orqali o'qish oynasi.

### KUN 8–10: Ishbay Oylik (Piece-Rate Payroll) & QC Inspeksiyasi
- **TASK-AG-03 [Priority: P1] [Owner: Antigravity]**: Bosqichni muvaffaqiyatli tugatganda avtomatik ishbay oylik yozish triggeri.
  - *Qabul mezonlari:* `batch_stage_wip` da qism topshirilganda, xodimning `salary_type = 'Grammabay'` bo'lsa, `salary_ledger` ga `completed_qty * weight * tariff` avtomatik yozilishi kerak.
- **TASK-UI-03 [Priority: P1] [Owner: Jules]**: 22-bosqich (Sifat nazorati) interfeysi va nuqsonlar kartasi.
  - *Qabul mezonlari:* QC tekshiruvida "Qayta ishlashga" (Rework) qaytarilganda, defekt turi (G'ovaklik, Geometriya, Qolip xatosi) va fotosurat ilova qilish imkoniyati.

### KUN 11–14: Barcode Chop Etish & Zavod E2E Sinovi
- **TASK-HW-02 [Priority: P1] [Owner: Jules]**: Partiya yorliqlarini (Label) termoprinterda chop etish (Zebra/TSPL).
  - *Qabul mezonlari:* Partiya ochilganda "Yorliq chop etish" tugmasi bosilib, 50x30mm o'lchamda Batch No, Mahsulot nomi, Proba va QR kod chiqarilishi kerak.
- **TASK-TEST-04 [Priority: P0] [Owner: Antigravity]**: 10 ta to'liq partiyani 20 bosqichdan o'tkazish bo'yicha integratsion simulyator.
  - *Qabul mezonlari:* Eritish -> Quyish -> Jilolash -> Sifat -> Tayyor Ombor zanjiri to'liq tekshirilib, oltin balansi 0.0000g xatolik bilan tasdiqlanishi kerak.

---

## 7. BAZA VA XAVFSIZLIK TO'SIQLARI (CRITICAL BLOCKERS BEFORE REAL FACTORY DATA)

Zavodning real oltin va moliyaviy ma'lumotlarini kiritishdan oldin quyidagi 3 ta blokirovka hal qilinishi shart:

1. **BLOCKER-01 (Production Supabase Migration Sync):**
   - *Holat:* Lokal PGlite bazasida 001–021 migratsiyalar 100% o'tdi. Ammo masofaviy Supabase (`hbbuskyifxkowlozsaym`) loyihasida 015–021 migratsiyalari hali qo'llanilmagan.
   - *Yechim:* Avval masofaviy bazaning to'liq zahirasi (`pg_dump`) olinadi, so'ngra 015 dan 021 gacha bo'lgan tuzatilgan skriptlar navbat bilan qo'llaniladi.
2. **BLOCKER-02 (Hardware Calibration & Zero-Tolerant Weighing):**
   - *Holat:* Tarozilar kalibrlanmagan bo'lsa, xodimlar o'rtasida 0.05g dan ortiq sun'iy tafovutlar kelib chiqadi va tizim partiyalarni to'xtatib qo'yadi.
   - *Yechim:* Zavod tarozi etalonlari bilan tekshirilib, har bir bo'lim uchun ruxsat etilgan xatolik me'yori (`handover_tolerance_gram = 0.0500`) sozlanishi kerak.
3. **BLOCKER-03 (Role-Linked Real User Accounts):**
   - *Holat:* Direktor roli faqat tasdiqlangan `user_id` larga berilishi shart. Anonim yoki worker rollari direktor funksiyalarini ishlata olmasligi kerak.
   - *Yechim:* Xodimlar uchun Supabase Auth orqali rasmiy email taklifnomalari yuborilib, `employees.user_id` bilan bog'lanishi shart.

---

## 8. XULOSA VA KEYINGI QADAMLAR

Ushbu yo'l xaritasi (Roadmap) JewelryFlow ERP tizimini tarqoq ishlab chiqishdan **qat'iy rejalashtirilgan, multi-agent (Antigravity + Jules) konveyeriga** aylantiradi. Hech qanday qayta boshlashga hojat yo'q — mavjud mustahkam poydevor ustiga ishlab chiqarishga tayyor interfeys va apparat integratsiyalari quriladi.
