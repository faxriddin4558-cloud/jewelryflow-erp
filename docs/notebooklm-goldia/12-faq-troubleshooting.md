# 12. Savol-javoblar (FAQ) va muammolarni hal qilish

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.
> Har javob oxirida manba ko'rsatilgan. **[089]/[090]/[091]** — production'da hali yo'q funksiya.

## A. Umumiy (1–12)

**1. Goldia Sales nimani hisoblaydi?** — Zavod → menejer → sotuvchi → mijoz zanjiridagi tovar, qarz va kassalarni 585 gramm, so'm va dollarda alohida. *Manba: `src/app/sales/app/page.tsx`, `customer-balance.ts`.*

**2. Nega hamma narsa 585 grammda?** — Asosiy birlik 585 proba; boshqa proba `fizik × proba / 585` bilan keltiriladi. *`rpc_record_client_settlement`.*

**3. So'm va 585 gramm qo'shib ko'rsatiladimi?** — Yo'q, "585 gram, UZS and USD are NEVER added together". Faqat foyda hisobida kurs bilan 585 ga aylantiriladi. *`customer-balance.ts`, `rpc_get_accounting_profit_summary`.*

**4. Production hozir qaysi versiyada?** — Release hisobotlari bo'yicha migration 088; 089, 090, 091 deploy qilinmagan. To'g'ridan-to'g'ri tekshirilmagan (NOT VERIFIED). *`RELEASE-091-REPORT.md`.*

**5. Sana qaysi vaqt zonasida?** — Toshkent (`Asia/Tashkent`); biznes sana `_goldia_business_date`. *Migration 073, `business-date.ts`.*

**6. Internet uzilsa nima bo'ladi?** — Qizil chiziq: "Internet aloqasi yo'q! ... yozish amallari faqat onlayn rejimda ishlaydi." Offline yozuv yo'q. *`layout.tsx`.*

**7. Bir tugmani ikki marta bossam ikki marta yoziladimi?** — Yo'q, deyarli barcha yozish RPC'lari idempotentlik kaliti bilan himoyalangan; takror so'rov birinchi natijani qaytaradi. *`check_and_lock_idempotency` (016).*

**8. Hujjat o'chiriladimi?** — Yo'q; bekor qilinadi (`reversed`) va audit qoladi. *Barcha `rpc_reverse_*`.*

**9. "STAGING DEMO" chizig'i nima?** — Test muhiti; real production emas. *`layout.tsx`.*

**10. Qanday hujjat raqamlari bor?** — ZVD, CONS-BC, SALE-W/BC/UZS/USD, SETTL, CPAY, STL-MGR, HND, BUY, REF, FTX, OPD. *`01-overview.md` §6.*

**11. Menejer va direktor huquqi farq qiladimi?** — Goldia Sales'da bir xil (077 qarori); faqat moliyaviy restart direktorniki. *`sales-role-access.ts`, `rpc_financial_restart`.*

**12. Boshqa tashkilot ma'lumotini ko'ra olamanmi?** — Yo'q, tashkilot izolyatsiyasi RLS va RPC ichida. *`multi-tenant-security.test.ts`.*

## B. Rollar va kirish (13–20)

**13. Sotuvchi qaysi sahifalarni ko'radi?** — Asosiy Panel, Skaner Savdo, Mijozlar va Nasiya, Kassam, Ustama Farqi. *`SELLER_NAVIGATION`.*

**14. Sotuvchi menejer sahifasini URL orqali ochsa?** — `/sales/app?unauthorized=1` ga qaytadi; database ham rad etadi. *`layout.tsx`, `isRouteAllowedForSeller`.*

**15. Sotuvchi LOM kursini o'zgartira oladimi?** — Rasmiy kursni yo'q ("⚙️ Kurs" ko'rinmaydi); o'z kurslarini "Mening kurslarim"da belgilaydi. *`rpc_set_my_seller_rates` (072).*

**16. Menejer sotuvchi kursini o'zgartira oladimi?** — Yo'q, "kursni faqat sotuvchi o'zi uchun belgilaydi"; menejer faqat ko'radi va operatsiyada boshqa kurs kirita oladi. *072, 084.*

**17. Buxgalter nimalar qila oladi?** — Ayrim RPC'lar ruxsat beradi: SETTL, zavod kirimi, zavodga topshirish, xarid, kunlik kurs, eski qarzni bekor qilish; menyuda "Moliyaviy Hisobotlar". *RPC rol ro'yxatlari.*

**18. Kim moliyaviy hisobni qayta boshlay oladi?** — Faqat direktor. *`rpc_financial_restart`.*

**19. Sotuvchi o'z mijozini boshqa sotuvchiga o'tkaza oladimi?** — Yo'q. *`_goldia_guard_customer_assignment` (079).*

**20. "Permission denied: no active employee profile" nima?** — Foydalanuvchining faol `employees` yozuvi yo'q yoki nofaol. Admin xodim profilini faollashtirishi kerak. *`assert_erp_permission`.*

## C. Savdo (21–38)

**21. Vazn bo'yicha savdo qanday hisoblanadi?** — `qarz = vazn × (1 + mijoz%)`; 10 g @12% = 11.2 g. *`rpc_record_weight_sale`.*

**22. Mijoz foizi standart qancha?** — Formada 12.0 ("Standart: 12.0% yoki 15.0%"); server foizni majburiy talab qiladi, yashirin standart yo'q. *`CustomerLedgerAndSheetsSection.tsx`, `ERR_MARKUP_REQUIRED`.*

**23. Foiz 100% dan ko'p bo'lishi mumkinmi?** — Yo'q, 0–100. *`ERR_MARKUP_OUT_OF_RANGE`.*

**24. Vazn savdosida donani tanlash shartmi?** — Yo'q (076); tanlanmasa eng eski donalardan olinadi, faqat oxirgisi kesiladi. *`_goldia_consume_weight_sale_pieces`.*

**25. `ERR_PIECE_EXTRA` nima?** — Tanlangan donalardan oxirgisi kerak emas edi (oldingilari vaznni qoplaydi). *`rpc_record_weight_sale`.*

**26. `ERR_INSUFFICIENT_SELLER_STOCK` chiqdi.** — Sotuvchi omborida yetarli gramm yo'q; menejer avval tovar tarqatsin. *O'sha.*

**27. Savdo sotuvchi majburiyatini o'zgartiradimi?** — Yo'q; majburiyat konsignatsiyada yaratilgan, savdo faqat omborni kamaytiradi. *`recalc_seller_gold_account`, 085 hisobot.*

**28. Mijozda avans bo'lsa savdo qanday yoziladi?** — Avans avtomatik ishlatiladi: `min(avans, qarz)`. *`rpc_record_weight_sale`.*

**29. Dona savdosida qarz qanday?** — `w × (1 + mijoz%)`; 5 g @15% = 5.75 g. *`rpc_record_barcode_piece_sale`.*

**30. Dollar narxida sotish mumkinmi?** — Ha, "Aniq USD" (yoki "Aniq UZS"); qarz valyutada yoziladi, 585 qarz o'zgarmaydi. *`rpc_record_currency_sale` (077).*

**31. Valyuta savdosi omborni kamaytiradimi?** — Ha, vazn bo'yicha. *O'sha.*

**32. Valyuta savdosida ustama farqi hisoblanadimi?** — Yo'q (`markup_difference_g = NULL`). *`trg_goldia_sale_markup_snapshot`.*

**33. Arxivlangan mijozga sotsa bo'ladimi?** — Yo'q, `ERR_CUSTOMER_ARCHIVED`; avval tiklang. *079.*

**34. Sotuvchi boshqa sotuvchining mijoziga sota oladimi?** — Yo'q; biriktirilmagan mijozga mumkin (mijoz avtomatik biriktirilmaydi). *076, 079.*

**35. Butun partiyani bir mijozga sotish?** — Sotuvchi mobil "🏷️ Nasiya" — faqat tegilmagan partiya; aks holda `ERR_CONSIGNMENT_PARTIALLY_USED`. *`rpc_record_client_jewelry_sale`.*

**36. Savdo chekini qayta chop etish?** — Chek savdodan keyin ochiladi ("🖨️ Chop etish", "📋 Nusxa olish"). Keyinchalik qayta ochish yo'li `/sales/app` ichida tekshirilmagan — NOT VERIFIED. *`SalesReceiptModal.tsx`.*

**37. Savdo sanasini o'zgartirish mumkinmi?** — Savdo sanasi server biznes sanasi (bugun). [090] tahrirlashda yangi savdo bugungi sana bilan yoziladi. *`rpc_record_weight_sale`, `rpc_edit_client_sale`.*

**38. Mijozga sotuvchi biriktirilmagan bo'lsa?** — Mijozlar sahifasidagi savdo formasi rad etadi: "Mijozga sotuvchi biriktirilmagan. Avval mijozni sotuvchiga biriktiring." *`CustomerLedgerAndSheetsSection.tsx`.*

## D. Mijoz qarzi va avans (39–52)

**39. Mijoz qarzi manfiy ko'rinyapti.** — Manfiy = avans, biz mijozga qarzdormiz. *`customer-balance.ts`.*

**40. "Mijozlar sof qarzi" qanday hisoblanadi?** — Σ ochiq qarz − Σ ochiq avans, har birlik alohida. *`ManagerSimplePanel`.*

**41. Mijoz avansi sotuvchi majburiyatiga ta'sir qiladimi?** — Yo'q. *`customer-balance.ts` izohi.*

**42. Ortiqcha to'lov nima bo'ladi?** — Avansga o'tadi va keyingi savdoda ishlatiladi. *`rpc_record_client_settlement`.*

**43. Eski daftardagi qarzni qanday kiritaman?** — "📋 Eski qarz" → qayta solishtirish yoki to'g'ridan-to'g'ri → sana va daftar izohi majburiy. *`rpc_record_client_legacy_debt`.*

**44. Sotuvchi eski qarzni kamaytira oladimi?** — Yo'q, faqat qo'shadi; kamaytirish — menejer/direktor. *076.*

**45. Sotuvchi avans kirita oladimi?** — Ha (081), faqat qarzi yo'q o'z mijoziga va faqat qo'shish sifatida. *081.*

**46. Eski qarz sotuvchi majburiyatini oshiradimi?** — Ha, qarz turidagi eski qarz yozuvlari majburiyatga 1:1 qo'shiladi (manfiy bo'lmaydi). *`recalc_seller_gold_account`, test 076.*

**47. "Takroriy so'rov: ... 10 daqiqa ichida kiritilgan" xatosi?** — Bir xil eski qarz 10 daqiqa ichida qayta yuborilgan; ikki marta qo'shilmagan. *081.*

**48. Mijozni o'chirsam qarz yo'qoladimi?** — Yo'q; arxivda qarz qoladi, to'lov qabul qilinadi. *078 SEC-3.*

**49. Arxivdan qanday qaytaraman?** — "🗄️ Arxivlangan mijozlar" → "♻️ Tiklash". *`rpc_archive_customer`.*

**50. Mijoz kodi qanday beriladi?** — Tashkilot ichida avtomatik (CUST-0001...), 9999 dan katta raqamlar kesilmaydi. *075.*

**51. Bir xil ismli mijoz ikki marta yaratiladimi?** — Bir tashkilotda bir xil ism — mavjud mijoz qaytariladi. *Test 075.*

**52. Oylik hisobotda "Boshlang'ich / Eski Qarz" nima?** — Oy boshidagi qoldiq va eski qarz yozuvlari. *`rpc_get_customer_monthly_report`.*

## E. To'lovlar, valyuta, LOM (53–75)

**53. SETTL va CPAY farqi?** — SETTL 585 gramm qarzni, CPAY so'm/dollar qarzni yopadi. *`payment-hints.ts`.*

**54. Mijoz 585 qarzini so'mda to'lasa?** — SETTL: `so'm / LOM kursi` gramm yopiladi. 1 800 000 / 900 000 = 2 g. *`rpc_record_client_settlement`.*

**55. Dollar bilan 585 qarz to'lansa?** — `$ × USD kursi / LOM kursi`; 100 × 12 600 / 900 000 = 1.4 g. *O'sha.*

**56. Lom bilan to'lansa?** — `fizik × proba / 585`; 10 g 750 = 12.8205 g. *O'sha.*

**57. Lom probasi qanday chegarada?** — 300–1000. *O'sha.*

**58. `ERR_DAILY_RATE_NOT_SET`?** — Naqd/dollar uchun 585 kurs yo'q; kunlik kursni kiriting yoki operatsiyada kurs bering. *O'sha.*

**59. `ERR_RATE_REQUIRED: Dollar (USD) to'lovi uchun USD kursini kiriting`?** — USD kursi kiritilmagan; tizim taxminiy kurs ishlatmaydi. *084.*

**60. `ERR_RATE_OUT_OF_RANGE`?** — Kurs chegaradan tashqarida (standart LOM 100 000–3 000 000, USD 5 000–30 000) yoki sotuvchi LOM kursi rasmiydan 25% dan ko'p farq qiladi. *072.*

**61. So'm qarzni dollar bilan to'lash?** — CPAY UZS: `kredit = $ × USD kursi`; 100 × 12 600 = 1 260 000 so'm; kassaga dollar tushadi. *CPAY.*

**62. Dollar qarzni so'm bilan to'lash?** — CPAY USD: `kredit = so'm / USD kursi`. *CPAY.*

**63. Nega "so'mga aylantirmang" deb yozilgan?** — Dollar so'mga aylantirib kiritilsa kassada noto'g'ri valyuta bo'ladi; tizim dollar maydonini alohida talab qiladi va butun dollar so'm summasida ogohlantiradi. *P1 UI `3d87193`, `payment-hints.ts`.*

**64. Noto'g'ri valyutada kiritilgan to'lovni qanday tuzataman?** — Production'da: to'lovni bekor qilib qayta kiritish. [089]: "💱 Valyutani tuzatish" bitta amalda. *`rpc_correct_client_payment`.*

**65. To'lov sotuvchi majburiyatini kamaytiradimi?** — Yo'q; faqat menejerga topshiruv kamaytiradi. *`recalc_seller_gold_account`.*

**66. "Qiymatlangan pul havzasi" nima?** — 072'dan beri SETTL bilan olingan pul to'lov paytidagi gramm qiymatini saqlaydi; topshiruvda aynan shu gramm yopiladi. *`trg_goldia_seller_till_pool`.*

**67. Topshiruv kuni kurs o'zgarsa sotuvchi zarar ko'radimi?** — Yo'q; qiymatlangan pul to'lov grammini yopadi, farq kompaniya kurs farqi sifatida yoziladi. *085 D-2.*

**68. Valyuta savdosidan kelgan pul qanday topshiriladi?** — Qiymatlanmagan; topshiruv kursida grammga aylantiriladi (maydon: "LOM / 585 kursi (UZS/g) — faqat qiymatlanmagan pul uchun:"). *`rpc_record_seller_to_manager_settlement`.*

**69. Sotuvchi kassadagidan ko'p topshira oladimi?** — Yo'q: `ERR_INSUFFICIENT_SCRAP_BALANCE` / `CASH` / `USD`. *O'sha.*

**70. Topshiruvni kim yozadi?** — UI'da menejer qabul qiladi; database sotuvchiga faqat o'z kassasini ruxsat beradi. *`kassam/page.tsx`, RPC.*

**71. Kurs operatsiyadan keyin o'zgarsa eski hujjat qayta hisoblanadimi?** — Yo'q, kurs hujjatda snapshot. *084.*

**72. Kurssiz boshlang'ich so'm qarzi qanday baholanadi?** — Har to'lov o'z kursida, faqat boshlang'ich qarzga tushgan qismi. *088.*

**73. `ERR_OPENING_DEBT_OTHER_SELLER`?** — Mijozning boshlang'ich qarzi boshqa sotuvchi majburiyatida; to'lov o'sha sotuvchi kassasiga qabul qilinadi. *088.*

**74. Sotuvchi bozordan lom sotib ola oladimi?** — [091] Ha, kassadagi so'mdan; production'da hali yo'q. *`rpc_record_seller_lom_purchase`.*

**75. Kassa sanog'i nima uchun?** — [089] Haqiqiy pulni qayd etish (shaxsiy ishlatilgan / yetishmovchilik); balans o'zgarmaydi. *`rpc_record_seller_till_count`.*

## F. Ombor va konsignatsiya (76–86)

**76. Sotuvchiga tovar qanday beriladi?** — Scanner 564 Tarqatish: sotuvchi, foizlar, skaner, tasdiqlash. *`rpc_issue_barcode_consignment`.*

**77. Sotuvchi majburiyati qanday hisoblanadi?** — `bazaviy × (1 + sotuvchi%)`; 15 g @12% = 16.8 g. *O'sha.*

**78. Standart foizlar?** — Zavod 8%, sotuvchi 12% (UI). *`ScannerConsignmentSection.tsx`.*

**79. Tarqatish zavod qarzini o'zgartiradimi?** — Yo'q. *Test 085 D1-3.*

**80. FIFO nima?** — Kirim tanlanmasa eng eski kirimdan boshlab olinadi. *`rpc_issue_barcode_consignment`.*

**81. Sotuvchi donani qaytara oladimi?** — Ha, sotilmagan o'z donasini; majburiyat `w × (1+s%)` ga kamayadi. *`rpc_return_piece_to_manager`.*

**82. Konsignatsiyani bekor qilish mumkinmi?** — Ha, management, sotilgan donasi bo'lmasa. 090'da kirim taqsimoti bo'yicha aniq qaytariladi. *`rpc_reverse_barcode_consignment`.*

**83. Menejer ombori qanday hisoblanadi?** — Faol kirimlar `available_physical_g` + kirimsiz konsignatsiyadan qaytgan donalar. *`get_manager_available_stock_grams`.*

**84. Boshqa probadagi tovar kirim qilinadimi?** — Yo'q, faqat 585. *`rpc_record_factory_receipt`.*

**85. Donalar soni va grammi mosligini qayerda ko'raman?** — [089] "Ombor harakati" sahifasi; production'da Boshqaruvchi Ombori sahifasi. *`rpc_get_seller_stock_movements`.*

**86. Dona vazni chegarasi?** — 0 < w ≤ 1000 g. *`rpc_issue_barcode_consignment`.*

## G. Zavod, seyf, afinaj (87–97)

**87. Zavod qarzi qanday hosil bo'ladi?** — Kirim × (1 + zavod%); 100 g @8% = 108 g. *`rpc_record_factory_receipt`.*

**88. Zavod qarzi qanday kamayadi?** — Zavodga oltin topshirish (585eq) va [090] tovar qaytarish. *`rpc_record_factory_gold_handover`.*

**89. Zavodga qanday oltin topshiriladi?** — Afinaj oltini, xarid oltini, kapital toza oltin, lom. *O'sha.*

**90. Zavod hisobi manfiy bo'lsa?** — Zavod menejerga qarzdor (bizning avansimiz). *`factoryNetWording`.*

**91. "Kartalar zavod hisobi bilan mos emas" ogohlantirishi?** — Kartalar yig'indisi seyf netidan farq qiladi; production 088 kodida C2 topshiruv xatosi sabab bo'lishi mumkin (091 tuzatadi, eski qiymatni tuzatmaydi). *`factory-account-summary.ts`, RELEASE-090/091.*

**92. Afinaj pateriyasi qanday?** — `kirish585 − chiqish585`; 100 g 585 → 58 g 995 = 1.3504 g. *`rpc_record_refining_batch`.*

**93. Afinajda chiqish kirishdan ko'p bo'lsa?** — Rad: "Anomalous refining result". *O'sha.*

**94. Naqdga oltin xaridida dollar ishlatsam?** — USD kursi majburiy; valyuta USD yoki MIXED. *`rpc_record_gold_purchase`.*

**95. Seyfda pul yetmasa xarid?** — `ERR_INSUFFICIENT_VAULT_CASH` / `USD`. *O'sha.*

**96. Xarajatni qanday kiritaman?** — Asosiy panel → "💸 Xarajat / Kapital amali" → "Ofis va operatsion xarajat". *`rpc_record_financial_transaction`.*

**97. Xarajat sotuvchi kassasidan bo'la oladimi?** — Kodda chiqim/xarajat faqat menejer so'm/$/lom kassasidan; sotuvchi kassasiga faqat kapital kirimi. *O'sha.*

## H. Bekor qilish va vozvrat (98–108)

**98. Savdoni bekor qilsam to'langan pul nima bo'ladi?** — Mijozga avans bo'ladi. *`rpc_reverse_client_sale`.*

**99. Vozvrat qilingan savdoni butunlay bekor qilish?** — Yo'q, `ERR_SALE_HAS_RETURNS`; qolgan qismini vozvrat qiling. *083.*

**100. Vozvratda naqd pul qaytariladimi?** — Yo'q, qarz kamayadi, ortig'i avans. *083.*

**101. Vozvrat qiymati bugungi kursdami?** — Yo'q, asl savdo qiymatining ulushi. *083.*

**102. Dona savdosini qisman qaytarish?** — Yo'q, faqat butun dona. *083.*

**103. Kim "Menejer qabul qiladi" ni tanlay oladi?** — Faqat menejer/direktor. *083.*

**104. SETTL'ni bekor qila olmayapman — "kassadagi ... yetarli emas".** — Pul/lom allaqachon menejerga topshirilgan; avval topshiruvni bekor qiling. *`rpc_reverse_client_settlement`.*

**105. `ERR_TILL_ALREADY_HANDED_OVER`?** — CPAY'dan keyin topshiruv bo'lgan; tartib: topshiruvni bekor → to'lovni bekor → qayta topshirish. *088.*

**106. Sotuvchi o'z savdosini bekor qila oladimi?** — Production'da: o'z savdosini. [090]: faqat o'zi kiritgan, to'lovsiz, ochiq davrdagi savdoni. *077, 090.*

**107. Savdoni tahrirlash?** — [090] "✏️ Tahrirlash": eski bekor + yangi savdo bitta tranzaksiyada. *`rpc_edit_client_sale`.*

**108. Zavod kirimini bekor qila olmayapman.** — Kirimdan tovar tarqatilgan; avval konsignatsiyalarni bekor qiling. *`rpc_reverse_factory_receipt`.*

## I. Hisobot, davr, boshlang'ich hisob (109–120)

**109. Davriy hisobot nimani ko'rsatadi?** — Davr boshi/oxiri qoldiqlari, operatsiya turlari bo'yicha harakatlar, sotuvchilar kesimi. *`rpc_get_period_report`.*

**110. "Yangi davrni boshlash" qoldiqlarni nolga tushiradimi?** — Yo'q; faqat davrni yopib nusxa saqlaydi. *`period-report/page.tsx`.*

**111. Yopilgan davrni qayta ochish?** — Faqat oxirgi saqlangan davr, management. *078.*

**112. Foyda qanday hisoblanadi?** — Sof aktiv o'zgarishi − kapital kirimi + kapital chiqimi − eski qarz deltalari (585 g). *`rpc_get_accounting_profit_summary`.*

**113. Foyda "Hisoblanmagan" deyapti.** — Baseline yo'q yoki kurs (585/USD) yo'q. *O'sha.*

**114. Ustama farqi kimniki?** — Kompaniyaniki (Goldia), sotuvchi majburiyatiga ta'sir qilmaydi. *067.*

**115. Boshlang'ich hisob nima?** — T0 dagi haqiqiy qoldiqlarni A–J hujjatlar bilan kiritish va qulflash. *085.*

**116. `ERR_OPENING_DRAFT` chiqyapti.** — Boshlang'ich davr qoralama yoki restart davom etmoqda; oddiy moliyaviy yozuvlar qulflangan. *`_goldia_guard_opening_draft`.*

**117. `ERR_FINANCIAL_FREEZE`?** — Backup → restart oynasi; yozuvlar vaqtincha to'xtatilgan. *086.*

**118. Baseline sotuvchi kassasi bo'sh bo'lmasa?** — Rad (O-2): kassa T0 dan oldin menejerga topshirilishi kerak. *085.*

**119. "Sinov Tozalash" production'da bormi?** — Yo'q, faqat staging rejimida. *`settings/page.tsx`.*

**120. Restart'da mijozlar o'chadimi?** — Yo'q; mijozlar, xodimlar, modellar, sozlamalar saqlanadi, qoldiqlar 0, hujjatlar arxivlanadi. *OPENING-085-REPORT §1.*

## J. Muammolarni hal qilish jadvali

| Belgi | Ehtimoliy sabab | Qadam |
|---|---|---|
| Tugma bosilmaydi (kulrang) | Majburiy maydon bo'sh / ombordan ko'p / tasdiq katakchasi yo'q | Maydonlarni tekshiring |
| "Kurs belgilanmagan" | `daily_gold_rates` da 585 kurs yo'q | Menejer "⚙️ Kurs" |
| `42501 Ruxsat etilmadi` | Rol yoki mijoz/sotuvchi mos emas | `02-roles-permissions.md` |
| `55000 ERR_OPENING_DRAFT / ERR_FINANCIAL_FREEZE` | Boshlang'ich/restart jarayoni | Direktor bilan bog'laning |
| Qarz kutilganidan katta | Avans/eski qarz yozuvlari | Kunlik jurnal va eski qarz tarixini tekshiring |
| Sotuvchi majburiyati kamaymayapti | Faqat to'lov yozilgan, topshiruv yo'q | Menejer kassani qabul qilsin |
| Kartalar mos emas | C2 topshiruv xatosi (088 kodi) | `factory_cards_readonly.sql` (read-only) |
