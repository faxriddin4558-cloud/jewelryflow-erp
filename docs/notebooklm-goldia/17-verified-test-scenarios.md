# 17. Tekshirilgan test ssenariylari va biznes invariantlar

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

## 1. Bu hujjat tayyorlanishida testlar haqiqatan ishga tushirildi

| Buyruq | Muhit | Natija |
|---|---|---|
| `npm ci --ignore-scripts` keyin `npx vitest run` | Lokal konteyner, PGlite (migrations 001→091, haqiqiy `authenticated` roli va RLS bilan) — **production/staging'ga ulanilmagan** | **62 ta fayl / 521 ta test — hammasi PASS** (2026-11-19, ~50 s) |
| Playwright e2e (`e2e/*.spec.ts`) | Ishlayotgan server va DB talab qiladi | **Ishga tushirilmagan** (NOT RUN) |

**Muhim:** testlar **091 darajasidagi kodni** tekshiradi. 089–091 testlari production'da yo'q funksiyalarni tasdiqlaydi; production (088) xatti-harakati faqat 088 gacha bo'lgan testlar bilan mos keladi.

## 2. Goldia test fayllari (natija — men ishga tushirgan run)

| Fayl | Testlar | Nima tekshiriladi (asosiy ssenariylar) |
|---|---|---|
| `jewelry-sales-calculations.test.ts` | 21 ✓ | 100 g, zavod 8%, mijoz 12% (108 / 112, ko'paytirilmaydi); 112 g qarz − 70 g lom − 18 000 000 so'm @900 000 = 22 g; ortiqcha to'lov avansga; Sheets: 194.75 g @8% = 210.33 g, @12% = 218.12 g |
| `customer-balance.test.ts` | 6 ✓ | signedNet = Σqarz − Σavans; manfiy jami qirqilmaydi |
| `sales-payment-rates.test.ts` | 9 ✓ | Sotuvchi o'z kurslari; 072 dan beri dollar to'lov paytida qiymatlanadi; 084: saqlangan kurs faqat standart |
| `seller-card-metrics.test.ts` | 4 ✓ | Bozor qarzi yo'nalishi va qiymati |
| `factory-account-summary.test.ts` | 4 ✓ | Tovar qarzi, C, C2 + topshiruvlar = seyf; farq yashirilmaydi |
| `payment-hints.test.ts` | 3 ✓ | SETTL/CPAY matnlari, butun dollar ogohlantiruvi |
| `goldia-blocker-high-fixes.test.ts` | 10 ✓ | Yashirin 15% yo'q; sotuvchi begona sotuvchi nomidan sota olmaydi; absurd kurs rad; dona reversali sold_count'ni tiklaydi |
| `goldia-audit-fixes.test.ts` | 9 ✓ | FIFO (100 g → 80/20), vazn savdosi reversal zanjiri, afinaj 10 g @997 = 17.0427 g, xarid reversali bog'langan topshiruv bilan bloklanadi |
| `goldia-acceptance-audit-fixes.test.ts` | 10 ✓ | Kirim idempotent; qisman sotilgan partiya butun sotilmaydi; to'langan savdo reversali → avans; foyda faqat management |
| `goldia-security-hotfix.test.ts` | 7 ✓ | Anonim EXECUTE yo'q; tashkilotlararo o'qish yo'q |
| `goldia-seller-role-access.test.ts` | 11 ✓ | Sotuvchi kompaniya omborini/hisobotlarini o'qiy olmaydi; 5 ta menyu bandi |
| `goldia-weight-sale-pieces.test.ts` | 6 ✓ | 3×100 g dan 200 g: 2 dona sotilgan, 1 qolgan; reversal aniq bir marta |
| `goldia-markup-difference.test.ts` | 9 ✓ | 100 g, 15% vs 12% → −3 g; 20% → +5 g; jami +2 g; majburiyatlar o'zgarmaydi |
| `goldia-rate-difference-and-chain.test.ts` | 12 ✓ | 890 000 so'm 1 g sifatida, 900 000 da xarid → kompaniya −0.0111 g; 880 000 da → +0.0114 g |
| `goldia-seller-rates.test.ts` | 11 ✓ | Mustaqil sotuvchi kurslari; topshiruv kurs o'zgarsa ham aynan to'lov grammini yopadi |
| `goldia-073-release-candidate.test.ts` | 3 ✓ | Toshkent biznes sanasi; dona tanlash qoidasi |
| `goldia-074-tenant-isolation.test.ts` | 5 ✓ | Modellar va yo'qotish sozlamalari izolyatsiyasi |
| `goldia-075-...` | 10 ✓ | Mijoz kodlari tashkilot bo'yicha; 9999+ kesilmaydi |
| `goldia-076-legacy-debt-roles.test.ts` | 5 ✓ | Sotuvchi o'z mijoziga eski qarz — majburiyat 1:1; kamaytirish faqat menejer |
| `goldia-077-parity-currency-report.test.ts` | 5 ✓ | Menejer = direktor; $2000 savdo 20 g; davriy hisobot: boshlang'ich + harakat = yakuniy |
| `goldia-078-customer-archive.test.ts` | 5 ✓ | Arxivda qarz saqlanadi; faqat oxirgi davr qayta ochiladi |
| `goldia-079-archived-sale-and-assignment.test.ts` | 6 ✓ | Arxivlangan mijozga savdo yo'q; sotuvchi mijozni o'tkaza olmaydi |
| `goldia-081-seller-legacy-advance.test.ts` | 8 ✓ | Sotuvchi 12.5 g avans (qarzsiz mijozga); qarzi bor mijozga rad |
| `goldia-083-sale-returns.test.ts` | 8 ✓ | Vozvrat — alohida hujjat; asl savdo qiymati ulushi; naqd qaytarilmaydi |
| `goldia-085-opening-accounting.test.ts` | 14 ✓ | Restart himoyalari, A–J hujjatlar, qulf, keyingi operatsiyalar |
| `goldia-085-d1-chain.test.ts` | 5 ✓ | Zavod → menejer → sotuvchi zanjiri; zavod qarzi ikki marta sanalmaydi |
| `goldia-085-final-rules.test.ts` | 6 ✓ | D-2 (8 600 000 @860 000 → 10 g, farq 0.4444 g), D-3 (avans majburiyatni o'zgartirmaydi), D-6 (20 g @999 = 34.1538 g) |
| `goldia-086-write-freeze.test.ts` | 9 ✓ | Freeze barcha yozuvlarni to'xtatadi; T0 qoidalari |
| `goldia-087-backup-inside-freeze.test.ts` | 6 ✓ | Backup freeze ichida; bitta freeze — bitta restart |
| `goldia-088-factory-settled-unrated-currency.test.ts` | 7 ✓ | factory_settled; kurssiz F to'lov kursida baholanadi |
| `goldia-088-money-model.test.ts` | 7 ✓ | Qisman topshiruv → reversal tartibi (0 g yo'qotish); 25 qismli to'lovda qoldiq yo'q |
| `goldia-089-remaining-features.test.ts` | 14 ✓ | *(deploy qilinmagan)* eski savdo vozvrati, CPAY jurnal, valyuta tuzatish, kassa sanog'i, ombor harakati |
| `goldia-089-ui.test.ts` | 3 ✓ | Jurnal yorliqlari, kassa farqi, tuzatish payload |
| `goldia-090-consignment-factory-seller-cancel.test.ts` | 9 ✓ | *(deploy qilinmagan)* 39.46 g = 16 + 23.46 g aniq qaytarish; zavodga 5 g → zavod −5.5 g (10%) |
| `goldia-090-sale-edit.test.ts` | 6 ✓ | *(deploy qilinmagan)* savdo tahriri |
| `goldia-091-c2-lom-purchase.test.ts` | 8 ✓ | *(deploy qilinmagan)* 5 g LOM 4 500 000 so'mga; 2 g @750 = 2.5641 g; C2 saqlanadi |
| `goldia-chain-compare.test.ts`, `goldia-level.test.ts` | 5 ✓, 6 ✓ | Release vositalari |
| `multi-tenant-security.test.ts` | 19 ✓ | Tashkilot izolyatsiyasi |
| `item-level-inventory-and-sheets.test.ts`, `sheets-import-engine.test.ts`, `dynamic-sales-markups.test.ts`, `business-date.test.ts` | 10, 11, 4, 16 ✓ | Dona darajasidagi ombor, Sheets import, presetlar, sana |

## 3. Asosiy biznes invariantlari (test bilan tasdiqlangan)

| # | Invariant | Test |
|---|---|---|
| I1 | Ustamalar bazaviy vazndan, ko'paytirilmaydi (100 g → zavod 108, sotuvchi 112; 108×1.12 emas) | `jewelry-sales-calculations` |
| I2 | Fizik balans: tarqatilgan = sotilgan + mavjud + qaytarilgan | o'sha |
| I3 | Sotuvchi javonidagi donalar grammi = sotuvchi ombori | `goldia-weight-sale-pieces` |
| I4 | Savdo sotuvchi majburiyatini o'zgartirmaydi; faqat topshiruv kamaytiradi | `goldia-085-opening-accounting` (T), 085 hisobot |
| I5 | Sotuvchiga tarqatish zavod qarzini o'zgartirmaydi | `goldia-085-d1-chain` D1-3 |
| I6 | Topshiruv to'lov paytidagi grammni yopadi; kurs farqi kompaniyaniki va bir marta | `goldia-seller-rates` G/H, `goldia-085-final-rules` D-2 |
| I7 | Mijoz avansi sotuvchi majburiyatiga ta'sir qilmaydi | `goldia-085-final-rules` D-3 |
| I8 | To'langan savdo bekor qilinsa to'lov avansga o'tadi | `goldia-acceptance-audit-fixes` F2 |
| I9 | Vozvratlar yig'indisi savdodan oshmaydi; naqd qaytarilmaydi | `goldia-083-sale-returns` |
| I10 | Davr: boshlang'ich + harakatlar = yakuniy; yopish hech narsani o'zgartirmaydi | `goldia-077` C |
| I11 | Takror so'rov (idempotentlik) ikki marta yozmaydi | ko'p testlar (M3, F5, F7, H) |
| I12 | Tashkilotlar va sotuvchilar bir-birining ma'lumotini ko'rmaydi | `goldia-security-hotfix`, `multi-tenant-security` |
| I13 | Ustama farqi qarz/majburiyat/kassa/foydani o'zgartirmaydi | `goldia-markup-difference` I+L |
| I14 | Boshlang'ich F qarz majburiyati bir marta yaratiladi; to'lov qayta yaratmaydi | `goldia-085-opening-accounting` O3/T |
| I15 | Freeze/draft paytida oddiy moliyaviy yozuvlar rad | `goldia-086-write-freeze` F2, `goldia-085-final-rules` D-4 |

## 4. Qanday qayta ishga tushirish (lokal, xavfsiz)

```bash
npm ci --ignore-scripts
npx vitest run            # yoki: npx vitest run src/lib/__tests__/goldia-083-sale-returns.test.ts
```
Production yoki staging'ga ulanish talab qilinmaydi (PGlite xotirada).
