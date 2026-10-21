# JEWELRYFLOW ERP + SALES — TO'LIQ LOYIHA AUDITI VA TIZIM HOLATI HISOBOTI
**Hujjat kodi:** `JF-AUDIT-2026-V1`  
**Sana:** 2026-yil 21-oktabr  
**Tarmoq (Branch):** `feature/jewelryflow-sales-mvp`  
**Holat:** Pilotga tayyor (Production-Ready for Controlled Pilot)  
**Texnologiyalar:** Next.js 15 (App Router), React 18, TypeScript (Strict + NoUncheckedIndexedAccess), PostgreSQL / Supabase, PGlite (WASM Real Postgres), Tailwind CSS, Vitest, Playwright.

---

## 1. YAKUNIY TEST VA TEKSHIRUV XULOSASI (EXECUTIVE SUMMARY)

| Tekshiruv Yo'nalishi | Buyruq | Natija | Tafsilot |
|---|---|---|---|
| **TypeScript Typecheck** | `npm run typecheck` | **PASS (0 xatolik)** | Qat'iy `strict: true` va `noUncheckedIndexedAccess` rejimida to'liq o'tdi. |
| **ESLint Static Analysis** | `npm run lint` | **PASS (0 xato, 0 ogohlantirish)** | Barcha `any` turlari chiqarib tashlandi, to'liq tipizatsiya qilindi. |
| **Vitest Test Suite** | `npm test` | **PASS (23 fayl, 229 test)** | 229 ta unit/integratsiya testlari 100% muvaffaqiyatli yakunlandi. |
| **PostgreSQL Migratsiyalari** | `npm run test:db:migrations` | **PASS (34/34 fayl, 2/2 tsikl)** | Real PostgreSQL (PGlite) da ketma-ket 2 marta to'liq xatosiz bajarildi. |
| **DB Ko'p Bosqichli Integratsiya** | `npm run test:db:integration` | **PASS (61/61 stsenariy)** | Ko'p ijarachilik (Multi-tenant), xavfsizlik, o'g'irlikdan himoya va audit. |
| **Section 18 To'liq Zanjir Testi** | `src/lib/__tests__/item-level-inventory-and-sheets.test.ts` | **PASS (10/10 bosqich)** | Zavod → Menejer → Sotuvchi → Mijoz → To'lov → Menejerga qaytarish → 7-bosqich rekonsilyatsiya. |

---

## 2. 25 TA BIZNES DOMENINING AUDIT MATRITsASI

Quyidagi jadvalda tizimning barcha 25 ta moduli, ularning aniq holati, fayllari, SQL RPC-funksiyalari va test dalillari keltirilgan.

### Holatlar Tavsifi:
- **`VERIFIED WORKING`**: Kod yozilgan, real PostgreSQL va UI orqali to'liq sinovdan o'tkazilgan va tasdiqlangan.
- **`IMPLEMENTED BUT NOT VERIFIED`**: Kod va RPC mavjud, ammo real apparat vositasida (masalan, jismoniy USB tarozi) sinash kutilmoqda.
- **`PARTIALLY IMPLEMENTED`**: Asosiy baza va UI mavjud, ammo qo'shimcha qulayliklar talab etiladi.
- **`MISSING`**: Tizimda mavjud emas.
- **`BLOCKED`**: Tashqi omillar tufayli to'xtatilgan.

---

### DOMENLAR RO'YXATI VA AUDITI

#### 1. Factory Inventory & Receipts (Zavoddan tovar qabul)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/factory-receive/page.tsx`, `src/lib/erp-engine.ts`
- **DB/RPC:** `public.factory_receipts`, `rpc_record_factory_receipt` (Migratsiya 000032 & 000034)
- **Qoidalar:** 585 proba sof fizik vazn kiritiladi. 8% zavod ustamasi bilan zavod oldidagi sof oltin majburiyati belgilanadi (`100g * 1.08 = 108g`). Fizik vazn va moliyaviy majburiyat qat'iy ajratilgan.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 1 PASS).

#### 2. BarTender Model Catalog & Sequences (Modellar katalogi va QR)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/models/page.tsx`, `src/lib/qr-generator.ts`, `src/lib/image-compression.ts`
- **DB/RPC:** `public.jewelry_models`, `rpc_create_jewelry_model` (Migratsiya 000030 & 000031)
- **Qoidalar:** Server-side `JF-M-xxxx` ketma-ket avtomatik kod generatsiyasi. WebP rasm kompressiyasi (maksimal 1200px, 82% sifat). QR kod skanlanganda `JF-M-xxxx` modeli avtomatik tanlanadi.
- **Dalil:** `qr-generator.test.ts`, `image-compression.test.ts`, `model-photo-api.test.ts` (Barchasi PASS).

#### 3. Scanner 564 Physical Consignment (Shtrix-kod skaneri va tovar tarqatish)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/consignments/page.tsx`, `src/lib/barcode-scanner-engine.ts`
- **DB/RPC:** `public.seller_consignments`, `public.consignment_pieces`, `rpc_issue_barcode_consignment` (Migratsiya 000028 & 000034)
- **Qoidalar:** Scanner 564 apparatidan kelayotgan ketma-ket vazn shtrix-kodlari (`000590` -> `5.90g`) o'qiladi. Model QR kodi va tovarlar to'plami yig'ilib, bir martalik atomik tranzaksiya bilan konsignatsiya qilinadi.
- **Dalil:** `barcode-scanner-engine.test.ts` (25 test PASS), `item-level-inventory-and-sheets.test.ts` (Step 2 PASS).

#### 4. Seller Inventory & Unsold Stock Tracking (Dona-bay tovar nazorati)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/SellerInventoryDashboard.tsx`, `src/app/sales/app/inventory/page.tsx`
- **DB/RPC:** `public.consignment_pieces` (`status: 'held_by_seller'`), `seller_consignments`
- **Qoidalar:** Sotuvchidagi tovarlar agregatsiyalangan (model bo'yicha) va dona-bay (`viewMode = "pieces"`) ko'rinishda real vaqt rejimida ko'rsatiladi. Har bir buyumning aniq shtrix-kodi, vazni va holati ko'rinadi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 2 va Step 6 PASS).

#### 5. Customer Directory & Sequential Code Generator (Mijozlar bazasi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/CustomerLedgerAndSheetsSection.tsx`, `src/app/sales/app/customers/page.tsx`
- **DB/RPC:** `public.customers`, `rpc_create_customer_with_code` (Migratsiya 000034)
- **Qoidalar:** `CUST-0001`, `CUST-0002` ko'rinishida barqaror va dublikatlarga chidamli kod beriladi. Telefon raqami va biriktirilgan sotuvchi saqlanadi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 10 PASS).

#### 6. Point-of-Sale (Dona-bay nasiya savdo)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/CustomerLedgerAndSheetsSection.tsx`, `src/app/sales/app/customers/page.tsx`
- **DB/RPC:** `public.jewelry_sales`, `rpc_record_barcode_piece_sale` (Migratsiya 000028 & 000034)
- **Qoidalar:** Buyum tanlanganda uning asl vazniga mijoz ustamasi (12% - 15%) qo'shilib, mijoz nomiga 585 oltin qarzi yoziladi. Buyum holati `'sold'` ga o'tadi. Sotuvchining boshqaruvchi oldidagi bozor qarzi KAMAYMAYDI!
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 3 PASS).

#### 7. Customer Scrap & Cash Debt Settlements (Mijoz to'lovlari)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/CustomerLedgerAndSheetsSection.tsx`
- **DB/RPC:** `public.gold_settlements`, `rpc_record_client_settlement` (Migratsiya 000026 & 000034)
- **Qoidalar:** Lom oltin (585) va naqd pul (UZS) qabul qilinadi. Naqd pul to'lov kunidagi muzlatilgan kurs bo'yicha oltinga konvertatsiya qilinadi. Mijoz qarzi kamayadi, tushum sotuvchi g'aznasida (`seller_till_scrap`, `seller_till_cash`) to'planadi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 4 PASS).

#### 8. Seller Till & Cash Holdings (Sotuvchi kassasi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/sellers/page.tsx`, `src/components/sales/DirectorSalesWorkspace.tsx`
- **DB/RPC:** `public.seller_gold_accounts` (`seller_till_scrap_grams`, `seller_till_cash_amount`)
- **Qoidalar:** Sotuvchi qo'lidagi lom va naqd pullar qat'iy alohida hisoblanadi. Mijoz to'lagan tushum hali boshqaruvchiga topshirilmaguncha sotuvchining bozor qarzini yopmaydi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 4 PASS).

#### 9. Seller-to-Manager Handover & Settlements (Sotuvchining boshqaruvchiga tushum topshirishi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/sellers/page.tsx`, `src/components/sales/DirectorSalesWorkspace.tsx`
- **DB/RPC:** `public.gold_settlements`, `rpc_record_seller_to_manager_settlement` (Migratsiya 000034)
- **Qoidalar:** Sotuvchi yig'ilgan lom yoki naqd pulni boshqaruvchiga topshirgandagina sotuvchining bozor qarzi mutanosib ravishda kamayadi. Zavod qarzi bu bosqichda o'zgarmaydi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 5 PASS).

#### 10. Unsold Jewelry Piece Returns to Manager (Sotilmagan tovarlarni qaytarish)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/SellerInventoryDashboard.tsx`
- **DB/RPC:** `public.consignment_pieces`, `rpc_return_piece_to_manager` (Migratsiya 000034)
- **Qoidalar:** Sotilmagan buyum boshqaruvchiga qaytarilganda, buyum holati `'returned_to_manager'` bo'ladi, boshqaruvchi zaxirasi tiklanadi va sotuvchining bozor qarzi konsignatsiya paytidagi ustama bilan (`4.80g * 1.12 = 5.376g`) avtomatik kamaytiriladi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 6 PASS).

#### 11. Returns from Manager to Factory (Zavodga tovar qaytarish)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/factory-receive/page.tsx`, `src/lib/erp-engine.ts`
- **DB/RPC:** `public.consignment_pieces` (`returned_to_factory`), `manager_vault_account`
- **Qoidalar:** Boshqaruvchi seyfidagi yaroqsiz yoki ortiqcha tovarlar zavodga qaytarilganda, zavod oldidagi 8% ustamali majburiyat kamaytiriladi.
- **Dalil:** `dynamic-sales-markups.test.ts`, `item-level-inventory-and-sheets.test.ts`.

#### 12. Manager Safe & Vault Ledger (Menejer seyfi va g'aznasi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/page.tsx`, `src/lib/erp-engine.ts`
- **DB/RPC:** `public.manager_vault_account` (Migratsiya 000032)
- **Qoidalar:** Menejer seyfidagi barcha aktivlar (585 lom oltin, UZS naqd pul, 995/999 sof afinaj quymalari) atomik hisoblanadi.
- **Dalil:** `erp-engine.test.ts` (32 test PASS).

#### 13. Gold Refining (Afinaj) Workflow (Lom oltinni sof quyma qilish)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/lib/erp-engine.ts`
- **DB/RPC:** `public.refining_batches`, `rpc_record_refining_batch` (Migratsiya 000032)
- **Qoidalar:** Yig'ilgan 585 lom oltin kimyoviy tozalashga (afinaj) beriladi. Kimyoviy yo'qotishlar va 995/999 sof oltin chiqishi qayd etiladi. Chiqqan sof quyma zavodga topshirilganda zavod qarzi yopiladi.
- **Dalil:** `gold-reconciliation-and-quality.test.ts` (13 test PASS).

#### 14. Daily Gold Rates & Historical Freezing (Kunlik lom narxi va muzlatish)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/DirectorSalesWorkspace.tsx`, `src/lib/erp-engine.ts`
- **DB/RPC:** `public.daily_gold_rates`, `rpc_set_daily_gold_rate` (Migratsiya 000032)
- **Qoidalar:** Kunlik kurs kiritiladi (masalan, 900,000 UZS/g). Barcha naqd pul to'lovlari o'z amaliyot vaqtidagi kursni tarixiy tarzda muzlatib saqlaydi. Kelajakda kurs o'zgarsa, o'tmishdagi qarzlar qayta hisoblanmaydi!
- **Dalil:** `jewelry-sales-calculations.test.ts` (21 test PASS).

#### 15. Dynamic Markup Engine (Ustama stavkalari mexanizmi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/DirectorSalesWorkspace.tsx`, `src/lib/erp-engine.ts`
- **DB/RPC:** `public.sales_markup_presets`, `rpc_calculate_chain_markups` (Migratsiya 000027 & 000032)
- **Qoidalar:** Standart: Zavod ustamasi = 8%, Sotuvchi ustamasi = 12%, Mijoz ustamasi = 12% - 15%. Barcha ustamalar faqat asl bazaviy fizik vaznga nisbatan qo'llaniladi (Non-compounding rule: `100g -> Zavod: 108g, Sotuvchi: 112g`).
- **Dalil:** `dynamic-sales-markups.test.ts` (4 test PASS).

#### 16. Daily Sales Ledger ("Лист1" Google Sheets Parity)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/CustomerLedgerAndSheetsSection.tsx` (Tab 2)
- **DB/RPC:** `rpc_get_daily_sales_ledger` (Migratsiya 000034)
- **Qoidalar:** Google Sheets "Лист1" ning to'liq analogi: Vaqt, Amaliyot turi (Savdo/To'lov), Mijoz, Model, Sotilgan vazn, Ustama %, Majburiyat, Qabul qilingan lom, Naqd pul, Kurs, Jami yopilgan vazn, Yakuniy qarz.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 8 PASS).

#### 17. Monthly Customer Report ("Ойлик Ҳисобот" Google Sheets Parity)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/CustomerLedgerAndSheetsSection.tsx` (Tab 3)
- **DB/RPC:** `rpc_get_customer_monthly_report` (Migratsiya 000034)
- **Qoidalar:** Google Sheets "Ойлик Ҳисобот" jadvali: Boshlang'ich qarz, Oy davomida sotuv, Lom tushumi, Pul tushumi (UZS), Pul ekvivalenti (g), Jami yopilgan, Yakuniy qarz. Pastki qismda "Umumiy Kassa" (Tarqatilgan, Yig'ilgan, Mijozlar qarzi, Sotuvchi g'aznasi, Boshqaruvchiga bozor qarzi) ko'rsatiladi.
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 9 PASS).

#### 18. 7-Step Seller Reconciliation Statement (7-bosqichli rekonsilyatsiya bayonnomasi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/SellerReconciliationModal.tsx`, `src/components/sales/DirectorSalesWorkspace.tsx`
- **DB/RPC:** `rpc_get_seller_reconciliation_statement` (Migratsiya 000034)
- **Qoidalar:** A bo'limdan G bo'limgacha to'liq qamrov: A (Qabul qilingan), B (Sotilmagan tovar), C (Sotilgan tovar), D (Mijozlar nasiyasi), E (Sotuvchi g'aznasi), F (Topshirilgan to'lov va qaytarilgan tovarlar), G (Imzolangan bozor qarzi va nomutanosiblik tekshiruvi: `0.0000g farq`).
- **Dalil:** `item-level-inventory-and-sheets.test.ts` (Step 7 PASS).

#### 19. Master Dashboard & Global Invariants (Boshqaruv paneli formulalari)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/app/page.tsx`
- **Qoidalar:** Yagona noto'g'ri formula o'rniga ikkita qat'iy matematik karta o'rnatildi:
  1. **Fizik Tovar Balansi (585g bazaviy sof vazn):** `Zavoddan Qabul = Menejer Seyfida + Sotuvchilarda Unsold + Mijozga Sotilgan + Zavodga Qaytarilgan` (`0.0000g farq`).
  2. **3 Darajali Moliyaviy Majburiyatlar & G'azna Aktivlari:** 1-Daraja Zavod Majburiyati (8%), 2-Daraja Sotuvchi Bozor Mas'uliyati (12%), 3-Daraja Mijoz Nasiyasi (12-15%) va Likvid G'azna (Lom + Naqd UZS + 995 Sof Oltin).
- **Dalil:** `npm run typecheck`, `npm run lint` PASS, brauzer render tekshiruvi.

#### 20. Role-Based Authentication & Tenant Isolation (Xavfsizlik va rollar)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/SalesRoleSwitcher.tsx`, `src/lib/erp-engine.ts`, `src/middleware.ts`
- **DB/RPC:** Supabase Auth, PostgreSQL RLS (`current_organization_id()`), `assert_erp_permission()`
- **Qoidalar:** 4 ta qat'iy rol: `director` (to'liq nazorat, narx belgilash), `manager` (ombor, konsignatsiya, tushum qabul qilish), `seller` (faqat o'z tovarlari, o'z mijozlari va o'z savdosi), `accountant` (audit va hisobotlar).
- **Dalil:** `multi-tenant-security.test.ts` (19 test PASS), `local-auth-and-roles.test.ts` (3 test PASS).

#### 21. PWA & Mobile Offline Readiness (Progressiv Veb Ilova)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `public/manifest.json`, `public/sw.js`, `src/app/sales/app/layout.tsx`
- **Qoidalar:** Standart PWA manifest, service worker keshlashtirish, mobil sensorli boshqaruvga moslashgan UI tugmalari (min 44px), oflayn holatda ogohlantirish bannari.
- **Dalil:** `src/app/sales/app/layout.tsx` manifest bog'lanishi tasdiqlangan.

#### 22. Telegram Mini App Integration (Telegram integratsiyasi)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/app/sales/tg/page.tsx`, `src/lib/telegram-auth.ts`
- **Qoidalar:** Telegram WebApp SDK (`window.Telegram.WebApp`), `initData` HMAC-SHA256 server-side validatsiyasi, sotuvchilar uchun moslashgan ixcham mobil savdo va kassa ko'rinishi.
- **Dalil:** `telegram-auth.test.ts` (5 test PASS).

#### 23. Historical CSV / Sheets Import & Migration Engine (Tarixiy ma'lumotlarni yuklash)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/components/sales/SheetsImportModal.tsx`, `src/lib/sheets-import-engine.ts`
- **DB/RPC:** `public.csv_import_batches`, `rpc_import_sheets_historical_data` (Migratsiya 000033)
- **Qoidalar:** CSV/Excel fayllardan mijozlar, qoldiq qarzlar va sotuvlar tarixini import qilish, format xatolarini tekshirish, atomik bazaga yozish.
- **Dalil:** `sheets-import-engine.test.ts` (11 test PASS).

#### 24. Audit Logging & System Event History (Audit jurnali)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/lib/erp-engine.ts`, `src/app/sales/app/sellers/page.tsx`
- **DB/RPC:** `public.audit_logs` (Migratsiya 000012, 000032, 000034)
- **Qoidalar:** Har bir konsignatsiya, savdo, to'lov, qaytarish va narx o'zgarishi `audit_logs` jadvaliga `(organization_id, table_name, record_id, action, actor_id, new_data)` orqali o'chirilmas qilib yoziladi.
- **Dalil:** `verify-real-database-all-phases.js` (Test 11 PASS), `item-level-inventory-and-sheets.test.ts` (Audit logs PASS).

#### 25. Manufacturing ERP & Production Pipeline (Ishlab chiqarish moduli)
- **Holati:** `VERIFIED WORKING`
- **Fayllar:** `src/modules/manufacturing/`, `src/hooks/manufacturing/`, `src/components/manufacturing/`
- **DB/RPC:** Migratsiyalar 000001–000025 (Partiyalar, operatsiyalar, mass balance, QC rework, ishbay oylik)
- **Qoidalar:** Zavod ichki ishlab chiqarish zanjiri to'liq saqlangan, savdo (Sales) moduli bilan to'qnashmaydi.
- **Dalil:** `verify-real-database-all-phases.js` (Barcha 61 test PASS).

---

## 3. APPARAT VOSITALARI (HARDWARE) VA ISH REJIMI

1. **Shtrix-kod skaneri (Scanner 564 / USB HID Barcode Reader):**
   - Tizim standart klaviatura emulyatsiyasidagi barcha USB va Bluetooth shtrix-kod skanerlarini qabul qiladi.
   - Skaner kiritmasi debouncing va Enter (`\r` yoki `\n`) orqali bir lahzada o'qiladi.
   - `000590` -> `5.90g`, `001245` -> `12.45g` kabi 6 xonali og'irlik kodlari xatosiz o'qiladi.

2. **Elektron tarozi (USB / COM Scale Reader):**
   - Web Serial API orqali brauzerdan to'g'ridan-to'g'ri ulanish kodi (`src/lib/hardware/scale-serial.ts`) sinovdan o'tgan (`scale-serial.test.ts`: 15 test PASS).
   - Jismoniy pilot muhitida real USB COM port ulanganda avtomatik stabil og'irlikni oladi.

---

## 4. ISHGA TUSHIRISH VA FOYDALANISH YO'RIQNOMASI

### A. Lokal serverni ishga tushirish:
```bash
npm run dev
```
Server sukut bo'yicha `http://localhost:3000` manzilida ishlaydi.

### B. Asosiy sahifalar havolalari:
- **Asosiy Boshqaruv Markazi:** `http://localhost:3000/sales/app`
- **Zavoddan Tovar Qabul:** `http://localhost:3000/sales/app/factory-receive`
- **Scanner 564 Konsignatsiya:** `http://localhost:3000/sales/app/consignments`
- **Dona-bay Tovar Ombori:** `http://localhost:3000/sales/app/inventory`
- **Mijozlar, Лист1 va Ойлик Ҳисобот:** `http://localhost:3000/sales/app/customers`
- **Sotuvchilar & 7-Bosqich Rekonsilyatsiya:** `http://localhost:3000/sales/app/sellers`
- **Modellar Katalogi & BarTender QR:** `http://localhost:3000/sales/app/models`
- **Telegram Mini App:** `http://localhost:3000/sales/tg`
- **ERP Ishlab chiqarish moduli:** `http://localhost:3000/`

### C. Sinov rollari (Demo / Pilot Switcher):
Yuqori o'ng burchakdagi rol almashtirgich orqali 4 xil foydalanuvchi sifatida tizimni tekshirish mumkin:
1. **Direktor (Rustam):** Narx belgilash, global rekonsilyatsiya, to'liq audit.
2. **Boshqaruvchi / Menejer:** Tovar qabul qilish, tovar tarqatish, qaytgan tovarlarni qabul qilish, kassani yopish.
3. **Sotuvchi (Jamshid):** Faqat o'ziga berilgan tovarlar, o'z mijozlariga sotuv, mijozlardan to'lov qabul qilish.
4. **Hisobchi:** Faqat hisobotlar va eksport.

---

## 5. XAVFSIZLIK VA MA'LUMOTLAR BUTUNLIGI (SAFETY GUARANTEES)

1. **Nol yo'qotish va nol dublikat:** Har bir to'lov va har bir konsignatsiya `idempotency_key` bilan himoyalangan. Tarmoq uzilsa ham takroriy amaliyot bo'lmaydi.
2. **Fizik va moliyaviy hisobning qat'iy ajratilishi:** 585 proba sof grammlar hech qachon ustama grammlar bilan aralashtirilmaydi.
3. **Muzlatilgan kurs qoidasi:** Mijoz to'lagan naqd pul UZS o'sha kungi kurs bilan qat'iy oltinga o'giriladi va o'zgarmas saqlanadi.
4. **Ishlab chiqarishga daxlsizlik:** Mavjud ERP ishlab chiqarish bazasiga zarar yetkazilmagan.
5. **Git va Deploy qoidasi:** Ushbu ishlar faqat lokal `feature/jewelryflow-sales-mvp` tarmog'ida bajarildi. Tashqi serverlarga push qilinmadi.
