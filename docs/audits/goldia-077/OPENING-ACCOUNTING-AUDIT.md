# Goldia Sales — boshlang'ich hisob, nazoratli qayta boshlash va 077–084 release holati

**PHASE A + B, 2026-11-11, faqat READ-ONLY.** Production'ga, staging'ga, JFS Demo va Manufacturing ERP'ga hech narsa yozilmadi. Kod va migration o'zgartirilmadi.

Belgilar:
- **VERIFIED** — shu sessiyada haqiqiy tizimdan o'qildi.
- **KOD** — production versiyasining kodi (DB migration 001–080, frontend `2b48df9`) qatorma-qator o'qib aniqlandi. Ammo production'da yurgizib ko'rilmadi.
- **NOT VERIFIED** — tekshirib bo'lmadi.

## 1. Versiyalar

| Nima | Holat | Dalil |
|---|---|---|
| Production DB versiyasi | **NOT VERIFIED** | Sessiya tarmog'i production'ga yo'l bermaydi (proxy 403, Supabase ulagichi faqat staging'ni ko'radi). "080" faqat egasining 2026-11-06 xabaridan (`PRODUCTION-DRIFT-AUDIT.md`). 081 bo'lishi ham mumkin. |
| Production frontend commiti | **NOT VERIFIED** | `goldia-sales-production.vercel.app` → proxy 403. "2b48df9" yana o'sha xabardan. |
| Staging DB | **VERIFIED: 081** | 81 ta migration, 075…081 uzluksiz, uzilish yo'q. |
| Staging frontend | **VERIFIED: 28596c3** | `/api/version`: commit 28596c3, env staging, ref `vouehtlmsunebracahon`. |
| Git | **VERIFIED** | Branch `claude/goldia-sales-077-parity-period-currency` = `claude/goldia-sales-staging-audit-qtrq1d` = `b0fcadad`, worktree toza. Migration chain 001…084 uzluksiz; 081 → 084 lokal mashqi PASS. |

Production versiyasini egasi o'z kompyuterida faqat o'qiydigan buyruq bilan tasdiqlaydi:

```
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-drift-audit
```

### 077–084 qaysi muhitda bor
Production 080 deb faraz qilinganda (tasdiqlanmagan):

| Migration | Imkoniyat | Production (080 bo'lsa) | Staging (081) | Lokal |
|---|---|---|---|---|
| 077 | Direktor = menejer, so'm/dollar savdo, valyuta to'lovi, davr hisoboti | bor | bor | bor |
| 078 | Mijozni arxivlash, davrni qayta ochish | bor | bor | bor |
| 079 | Arxiv / biriktirish himoyasi | bor | bor | bor |
| 080 | Davr hisoboti tezligi | bor | bor | bor |
| 081 | Sotuvchi o'z mijoziga eski avans kiritishi | **yo'q** | bor | bor |
| 082 | Oylik hisobotda ishorali sof qoldiq | **yo'q** | **yo'q** | bor |
| 083 | Vozvrat | **yo'q** | **yo'q** | bor |
| 084 | Kursni operatsiyada qo'lda kiritish, snapshot, kurs ko'rigi, valyuta qarzi foydada | **yo'q** | **yo'q** | bor |

**Production 080'da sotuvchi kursni o'zgartira olmaydi:** boshqa kurs yuborsa `ERR_RATE_MISMATCH` chiqadi. Siz tasdiqlagan qoida production'da hali ishlamaydi.

## 2. Oldingi auditning tugallanmagan qismi — barkodsiz konsignatsiya

**KOD.** "📟 Scanner 564 Tarqatish" sahifasida (`/sales/app/consignments`, ScannerConsignmentSection) barkodsiz ishlash mumkin:

1. "Sotuvchini tanlang".
2. "2. Zavod Ustamasi (%)" — konsignatsiyaga faqat yozib qo'yiladi.
3. "3. Sotuvchi Majburiyati Ustamasi (%)" — standart qiymati 12.
4. Kirim: "Avtomatik FIFO (Mavjud kirimdan kamaytirish)" yoki aniq kirimni tanlash.
5. Model ixtiyoriy.
6. Vazn maydoniga grammni **qo'lda yozib Enter** bosiladi (masalan `14.52`). Har bir Enter bitta dona bo'ladi; ruxsat etilgan oraliq 0.05–1000 g.
7. Tasdiqlash belgisi (checkbox) qo'yilib, "Topshirish" bosiladi.

Natija:
- menejer omboridan shu vazn kamayadi (menejer omborida yetarli qoldiq bo'lishi shart);
- sotuvchi ombori ortadi;
- sotuvchi majburiyati = vazn × (1 + sotuvchi foizi).

**Misol: sotuvchida 100 g mahsulot bor, menejerga 112 g majburiyati bor.** Avval mahsulot menejer omboriga 100 g qilib kiritiladi. Keyin 12 % bilan sotuvchiga 100 g topshiriladi. Natijada sotuvchida 100 g fizik mahsulot va 112 g majburiyat bo'ladi.

## 3. Production'dagi noto'g'ri qoldiqlar (7 450 000 so'm, 700 USD, −1 323.43 USD)

- **Hujjatlarni ochib ko'rish: NOT VERIFIED** (production'ga yo'l yo'q).
- **Mexanizm: KOD.** Valyuta qarzi bo'lmagan mijozga "💵 Valyuta qarzi / to'lov" orqali to'lov yozilsa, butun summa **avansga** o'tadi va pul **sotuvchi kassasiga** qo'shiladi.
- **Arifmetika mos keladi:** 7 450 000 ÷ 11 950 = 623.43 USD; 623.43 + 700 = **1 323.43 USD** — aynan ekrandagi manfiy USD balans.

Bu taxmin, ammo juda kuchli. Uni o'qiydigan so'rov bilan tasdiqlash kerak (6-bo'lim, B4).

| Savol | Javob |
|---|---|
| Qaysi hujjatlar? | Ehtimol `client_currency_settlements` (CPAY-…) qatorlari: naqd so'm va USD, `to_advance` = to'liq summa. Bu NOT VERIFIED; muqobil manba — "Kapital Kiritish → Sotuvchi Kassasi". |
| Qaysi mijoz va kassa? | Har bir mijoz kartasidagi "💵 Valyuta qarzi / to'lov" oynasida to'lovlar tarixi ko'rinadi. Pul hujjatdagi sotuvchining kassasiga tushgan. |
| Nimaga ta'sir qilgan? | Sotuvchi kassasi (so'm / USD) ortgan. Mijozning USD avansi ortgan. 080 foyda modelida sotuvchi kassasi **aktiv**, valyuta avansi esa **majburiyat sifatida hisoblanmaydi**. Shuning uchun aktivlar soxta pulga oshgan. |
| Bekor qilish | Mavjud: menejer yoki direktor shu oynadagi "↩️" tugmasi bilan, sabab yozib bekor qiladi. Natijada kassadan pul chiqadi, avans bekor bo'ladi, audit izi qoladi. Pul topshirilgan bo'lsa → `ERR_TILL_ALREADY_HANDED_OVER`. **Bu moliyaviy reversal — faqat sizning alohida ruxsatingiz bilan (PHASE F).** |
| Asl valyuta qarzini qayta kiritish | **MISSING FUNCTION.** Production'da eski so'm / dollar qarzini kiritadigan funksiya yo'q: faqat haqiqiy valyuta savdosi qarz yaratadi. Soxta savdo yoki soxta to'lov bilan aylanib o'tish man qilinadi. |
| Muhim tartib | "Hisobni boshlash" bosilishidan **oldin** tuzatilishi shart. Aks holda soxta pul boshlang'ich nuqtaga kiradi, keyingi tuzatish esa "zarar" bo'lib ko'rinadi. |

**2 877.48 g = 2 877.48 g (KOD).** 076 qoidasiga ko'ra, sotuvchiga bog'langan eski mijoz qarzi o'sha sotuvchining menejer oldidagi majburiyatiga teng miqdorda qo'shiladi. Ombor 0 bo'lgani bilan ham mos keladi: bu majburiyat faqat eski qarzlardan kelgan.

## 4. "Kapital Kiritish" oynasi (`rpc_record_financial_transaction`, 070 tanasi) — KOD

Joyi: Asosiy Panel → "💸 Xarajat / Kapital amali" → "📈 Kapital Kiritish". Kategoriya — "Ta'sischi hissasi".

| Aktiv | Joy | Server nima qiladi | Baho |
|---|---|---|---|
| Pul UZS | Menejer Seyfi | menejer naqd puli + | SUPPORTED |
| Pul USD | Menejer Seyfi | menejer USD + (USD kursi talab qilinadi) | SUPPORTED |
| Lom Oltin | Menejer Seyfi | menejer lomi: fizik g va 585 ekvivalenti (fizik × proba / 585); proba hujjatda saqlanadi | SUPPORTED. Proba oralig'i serverda tekshirilmaydi, shuning uchun to'g'ri yozish shart. |
| Toza Quyma | Menejer (har doim) | kapital toza oltin: 585 ekvivalent va fizik g | SUPPORTED |
| Tayyor Buyum | "Sotuvchi" tanlansa ham **menejer omboriga** | 0 % zavod majburiyatli kirim yaratadi; menejer ombori ortadi | Menejer uchun SUPPORTED (zavodga qarzsiz mol). Sotuvchiga to'g'ridan-to'g'ri kiritib bo'lmaydi: konsignatsiya orqali beriladi. |
| Pul / LOM | Sotuvchi Kassasi | sotuvchi kassasi ortadi, lekin **grammga baholanmaydi** | **UNSAFE** (pastga qarang) |

- **Foyda buziladimi?** Hisobni boshlashdan **oldingi** kapital faqat boshlang'ich holatga kiradi. **Keyingi** kapital natijadan ayiriladi, ya'ni foyda deb sanalmaydi.
- **Kurs eslatmasi.** So'mning 585 ekvivalenti kiritish kunidagi kurs bo'yicha yoziladi; kurs topilmasa, 080'da 880 000 taxminiy kurs ishlatiladi (084 buni olib tashlaydi). Keyin kurs o'zgarsa, so'm saqlagani uchun oltin hisobida farq ko'rinadi.
- **Ikki marta hisoblanmaydi.** Tayyor buyum faqat kirim qoldig'i orqali sanaladi. Lom fizik va 585 ekvivalent ustunlariga bir marta yoziladi.
- **Sotuvchi kassasi nega UNSAFE?** Bu pul to'lov paytida grammga baholanmagan. Topshirilganda sotuvchi majburiyatini o'sha kungi kurs bo'yicha kamaytiradi. Agar bu pul tizimdagi biror majburiyatga tegishli bo'lmasa (masalan, eski savdo tushumi), sotuvchi majburiyati noto'g'ri kamayadi.
- **Xulosa:** bu oyna menejerning pul, LOM, toza oltin va qarzsiz tayyor mahsuloti uchun ochilish oynasi sifatida ishlaydi. Sotuvchi qoldiqlari uchun ishlatilmaydi.

## 5. "Hisobni boshlash" (`rpc_confirm_accounting_baseline`, 077 tanasi) — KOD

- Faqat joriy qoldiqlarni **snapshot** qiladi. Tarix o'chmaydi va o'zgarmaydi.
- Bugungi tasdiqlangan 585 kursi talab qilinadi. USD kursi faqat kassalarda USD bo'lsa talab qilinadi; aks holda 1.0 yoziladi, va keyin kelgan dollar 1 so'm deb baholanadi (084'da tuzatilgan, production'da yo'q).
- **Hisobga oladi:**
  - menejer va sotuvchi ombori;
  - lom, toza oltin, xarid oltini, afinaj;
  - mijozlarning 585 qarzi (aktiv) va avansi (majburiyat);
  - menejer va sotuvchi so'm / USD kassasi;
  - zavod qarzi yoki avansi.
- **Hisobga olmaydi (080):** mijozlarning so'm / USD qarz va avanslari.
- **Sotuvchining menejerga majburiyati** foyda hisobida yo'q — bu kompaniya ichidagi hisob.
- Qayta tasdiqlash mumkin: eskisi arxivlanadi. Keyin kiritilgan eski qarzlar natijadan ayiriladi, ombor va kassa esa ayirilmaydi — **barcha qoldiqlarni boshlashdan oldin kiritish shart**.
- **Bugun bosish: XAVFLI (NO-GO).** Soxta so'm / USD kassasi va valyuta avansi kiradi, ombor va zavod majburiyati esa kiritilmagan.

## 6. "Sozlamalar → 🧹 Sinov Tozalash" (`rpc_execute_full_test_reset`, 073 tanasi) — KOD

Direktor huquqi va `RESET_TEST_ACCOUNT_2026` kodi bilan production'da ham ishlaydi. Staging bilan cheklanmagan.

| Savol | Javob |
|---|---|
| Mijozlar, telefonlar, sotuvchiga biriktirish | **o'chmaydi** (customers jadvaliga tegmaydi) |
| Sotuvchilar, loginlar, rollar, modellar, sozlamalar, sotuvchi kurslari | **o'chmaydi** |
| Savdolar, to'lovlar, topshiruvlar, eski qarzlar, konsignatsiya, zavod kirimlari, zavodga topshiruvlar, afinaj, kapital va xarajat, xaridlar | o'chirilmaydi, **"reversed / cancelled"** deb belgilanadi va izoh qo'shiladi (tarix qoladi) |
| Menejer va sotuvchi ombori, kassa (so'm / USD), lom, toza oltin | **0** |
| Mijozlarning 585 qarz va avansi | **0** |
| Zavod majburiyati, sotuvchi majburiyati | **0** |
| Faol boshlang'ich hisob (baseline) | **arxivlanadi**; jami bitta audit yozuvi qoladi |
| **Mijozlarning so'm / USD qarz va avansi** | **TEGMAYDI — qoladi** |
| **Valyuta to'lovlari** | **"tasdiqlangan" bo'lib qoladi**, kassa esa 0 → hujjat bilan kassa mos kelmaydi; keyin bekor qilib ham bo'lmaydi (`ERR_TILL_ALREADY_HANDED_OVER`) |
| Valyuta savdolari | "reversed" bo'ladi, lekin ularning valyuta qarzi qoladi → savdosiz qarz |
| Yopilgan davrlar | tegmaydi; hisobot 077 qoidasi bo'yicha hujjatlardan hisoblanadi |
| Takror ishga tushirish | qayta 0 qiladi (qisman idempotent); backup yoki tiklash yo'q |

**Hukm: UNSAFE — production'da ishlatmang.**
- So'm / USD hisobini yarim tozalaydi va hujjatlar bilan qoldiqlar o'rtasida mos kelmaslik qoldiradi.
- "Sinov" uchun mo'ljallangan, real qayta boshlash uchun emas.
- Backup va tiklash bosqichi yo'q.

## 7. Boshlang'ich qoldiqlar jadvali (production 080 kodi bo'yicha)

Ustunlar: Ma'lumot | Production'da mavjudmi | Qaysi sahifa / tugma | Muammo | Kerakli yechim.

| # | Ma'lumot | Mavjudmi | Sahifa / tugma | Muammo | Yechim |
|---|---|---|---|---|---|
| 1 | Menejerdagi tayyor mahsulot (zavodga qarzsiz) | SUPPORTED | Asosiy Panel → Xarajat / Kapital → Kapital Kiritish → Tayyor Buyum (vazn, proba 585, nom) | model bog'lanmaydi | — |
| 1b | Menejerdagi tayyor mahsulot (zavodga hali qarz) | PARTIALLY | "Zavoddan Tovar Qabul Qilish" (nom, fizik g, zavod foizi) | hujjat "bugun zavoddan kirim" deb ko'rinadi | ochilish belgili kirim (085) |
| 2 | Sotuvchidagi mahsulot + majburiyat | SUPPORTED (2 qadam) | 1 yoki 1b → "Scanner 564 Tarqatish" (qo'lda gramm + sotuvchi foizi) | menejer omborida avval qoldiq bo'lishi shart | — |
| 3–4 | Menejerdagi so'm / USD | SUPPORTED | Kapital Kiritish → Pul UZS / USD → Menejer Seyfi | — | — |
| 5 | Menejerdagi LOM va proba | SUPPORTED | Kapital Kiritish → Lom Oltin (fizik g, proba) → Menejer | proba tekshirilmaydi | to'g'ri yozish |
| 6 | Menejerdagi toza oltin | SUPPORTED | Kapital Kiritish → Toza Quyma (fizik g, proba) | — | — |
| 7–9 | Sotuvchilardagi so'm / USD / LOM | **UNSAFE** | (Kapital → Sotuvchi Kassasi) | topshirishda majburiyatni noto'g'ri kamaytiradi | bugun: pulni menejerga olib, 3–5 sifatida kiritish; yoki 085 + majburiyat qarori |
| 10 | Menejerning zavodga 585 g majburiyati (mahsulotsiz) | **MISSING** | — | faqat mahsulot bilan kirim orqali | 085: ochilish zavod majburiyati |
| 11 | Sotuvchining majburiyati (mahsulot va qarzdan tashqari) | **MISSING** | — | faqat konsignatsiya va eski qarzdan hosil bo'ladi | 085: ochilish sotuvchi majburiyati |
| 12 | Mijozning eski 585 g qarzi | SUPPORTED | "Mijozlar va Nasiya" → mijoz → "📋 Eski qarz" (Qayta solishtirish yoki Qo'lda qo'shish, sana) | sotuvchi majburiyatiga teng qo'shiladi (076) | — |
| 13–14 | Mijozning eski so'm / USD qarzi | **MISSING** | — | faqat haqiqiy valyuta savdosi | 085: eski valyuta qarzi + D-C3 qarori |
| 15 | Mijoz avansi, 585 g | SUPPORTED | "📋 Eski qarz" → avans (faqat menejer / direktor) | — | — |
| 15b | Mijoz avansi, so'm / USD | **MISSING** | (ortiqcha to'lov soxta kassa kirimi bo'ladi) | — | 085 |
| 16 | Zavodga oldindan berilgan LOM / oltin avansi | PARTIALLY | Kapital → Lom (menejerga), keyin "Zavodga Oltin Topshirish" | hujjat bugungi sana bilan | 085: ochilish zavod avansi |
| 17 | Boshqa aktiv / majburiyatlar (qarz olingan pul va h.k.) | **MISSING** | — | — | qaror kerak |
| — | Boshlang'ich snapshot | PARTIALLY | Asosiy Panel → "🎯 Hisobni boshlash" | valyuta qarzi yo'q; USD 1.0 xatosi | 084 bilan birga |
| — | Mijozlarni saqlab qayta boshlash | **UNSAFE** (mavjud reset) | Sozlamalar → Sinov Tozalash | valyuta qismi yarim qoladi | 085: nazoratli qayta boshlash |

## 8. Tavsiya: mijozlarni saqlagan holda yangi hisobni boshlash arxitekturasi (085, PHASE C)

Hech narsa o'chirilmaydi. Eski moliyaviy hujjatlar arxivda qoladi, yangi hisob bitta aniq **ochilish vaqti T0** dan boshlanadi.

1. **Backup va tiklash sinovi.** Mavjud release vositasi production'dan backup oladi va uni alohida nusxaga tiklab sinaydi. Shundan keyingina keyingi qadam qilinadi.
2. **`rpc_financial_restart` (yangi, faqat direktor, terilgan kod, sabab, T0):**
   - barcha ochiq moliyaviy hujjatlarni "restart bilan yopildi" deb belgilaydi — **so'm / USD hujjatlari ham**;
   - barcha qoldiqlarni 0 qiladi: gramm, so'm / USD, kassa, ombor, majburiyat;
   - baseline'ni arxivlaydi; T0 dan oldingi davrlarni yopiq saqlaydi;
   - mijozlar, telefonlar, biriktirish, xodimlar, rollar, modellar, sozlamalar va kurs sozlamalariga tegmaydi;
   - idempotent: ikkinchi marta hech narsa qilmaydi;
   - restart yozuvi va audit izi qoladi.
3. **Ochilish hujjatlari (yangi, T0 sanali, "opening" belgili, takror bosishdan himoyalangan):**
   - menejer tayyor mahsuloti (zavod foizi bilan yoki foizsiz);
   - sotuvchi mahsuloti — mavjud konsignatsiya orqali;
   - menejerning zavodga majburiyati yoki avansi (mahsulotsiz);
   - sotuvchining qo'shimcha majburiyati;
   - mijozning 585 / so'm / USD qarz va avansi;
   - menejer kassasi (so'm, USD, LOM proba bilan, toza oltin);
   - qarorga ko'ra: sotuvchi kassasi va unga mos majburiyat.

   Bular **baseline tasdiqlanguncha** tuzatiladi yoki bekor qilinadi, tasdiqlangandan keyin qulflanadi.
4. **Tekshiruv, keyin baseline.** "Ochilish qoldiqlari" hisoboti mustaqil oracle bilan solishtiriladi, shundan so'ng "Hisobni boshlash" bosiladi (084 baseline: valyuta qarzi bilan, USD 1.0 xatosisiz).
5. **T0 gacha tashqarida bo'lgan savdolar qayta kiritilmaydi.** T0 paytidagi haqiqiy qoldiqlar (sanab olingan) kiritiladi: savdo, qaytarish va to'lovlar natijasi shu qoldiqlarda allaqachon bor.

## 9. Minimal o'zgarishlar rejasi (PHASE C)

- **Migration 085:** yuqoridagi restart va ochilish RPC'lari, ochilish hisoboti, reset'ning valyuta kamchiligi tuzatiladi. Eski "Sinov Tozalash" production'da yashiriladi yoki qayta boshlash bilan almashtiriladi.
- **Frontend:** "Ochilish hisobi" sahifasi (menejer / direktor), bosqichma-bosqich forma va solishtirish jadvali.
- **Release to'plami:** 081 (production 080 bo'lsa) → 082 → 083 → 084 → 085, alohida migrationlar, har biri postflight va rollback bilan.
- **Release xavfsizligi:** eski himoyasiz `scripts/apply-prod-migration-0NN.js` lar arxivlanadi; `.claude/settings.json` staging-only variantga o'tkaziladi (`CLAUDE-SETTINGS-RISK-AUDIT.md`, sizning ruxsatingiz bilan).

## 10. Moliyaviy xavflar va sizdan kerakli qarorlar (BUSINESS DECISION REQUIRED)

Ochilish uchun:

| # | Savol | Oddiy misol | Variantlar |
|---|---|---|---|
| O-1 | T0 qachon? | "15-noyabr 09:00" | sana va vaqt; o'sha paytdagi sanoq |
| O-2 | Sotuvchi qo'lidagi naqd / LOM | sotuvchida 5 mln so'm | (a) T0 da menejerga topshiriladi — eng xavfsiz; (b) sotuvchida qoladi va unga teng majburiyat yoziladi |
| O-3 | Eski so'm / USD qarz sotuvchiga majburiyat yaratadimi? | mijoz 500 USD qarz | (a) yo'q, faqat mijoz qarzi; (b) sotuvchi gramm majburiyati, kurs bo'yicha; (c) sotuvchi USD majburiyati |
| O-4 | Menejerdagi mahsulot | 300 g mol | zavodga to'langanmi (0 %) yoki qarzmi (8 %…) |
| O-5 | Hozirgi 2 877.48 g eski qarzlar | — | qayta sanab T0 qoldig'i sifatida kiritish yoki tekshirib qoldirish |
| O-6 | Qarz olingan pul va boshqa majburiyatlar | — | hisobga kiritilsinmi? |

Kurs bo'yicha (084'dan qolgan):

| # | Savol | Oddiy misol | Variantlar va xavf |
|---|---|---|---|
| R-1 | Kurs farqini kim ko'taradi? | rasmiy 900 000, sotuvchi 850 000 kiritdi: mijoz 900 000 so'm uchun 1.0588 g qarzdan qutuldi, kompaniya 1 g lik pul oldi | hozir farqni kompaniya ko'taradi; muqobil — sotuvchi |
| R-2 | Valyutali tushum topshirilganda qaysi kurs? | so'm savdo puli topshirilganda | to'lov kuni yoki topshirish kuni; topshirish kuni → sotuvchi kursni tanlab majburiyatini kamaytirishi mumkin |
| R-3 | So'm / USD savdo qaysi kun kursi bilan baholanadi? (D-C3) | 1 000 USD savdo | savdo, to'lov yoki topshirish kuni |
| R-4 | Cheklovlar va ogohlantirish | USD 5 000–30 000 | foiz chegarasi menejer va USD uchun ham kerakmi? |
| R-5 | Eskirgan kurs | 10 kun oldin saqlangan kurs | N kundan eski bo'lsa ogohlantirish |
| R-6 | Noto'g'ri kursni tuzatish | — | faqat bekor qilish + yangi hujjat (hozirgi tartib) |
| R-7 | Hisobot uchun USD kursi manbai | — | CBU yoki qo'lda kiritilgan |

## 11. Staging test rejasi (PHASE D, real staging, sintetik tashkilot)

1. Release 081 → 085 avtomatik daraja aniqlash bilan: backup, tiklash sinovi, postflight, schema parity, RLS, emergency rollback mashqi.
2. Bo'sh ochilish → menejer ombori → sotuvchiga konsignatsiya → mijozga savdo (gramm va valyuta) → to'lov → topshiruv → vozvrat.
3. Ochilish qoldiqlari: 585 / so'm / USD qarz va avans, sotuvchi va zavod majburiyati, naqd va LOM (proba). Har bir balans mustaqil oracle bilan.
4. Restart: mijozlar, telefonlar va biriktirishlar saqlanadi; barcha qoldiqlar, shu jumladan valyuta, 0; hujjatlar arxivda; ikkinchi ishga tushirish hech narsani o'zgartirmaydi; backup'dan tiklash ishlaydi.
5. Ikki marta hisoblash yo'qligi: fizik oltin, qarz, kassa.
6. Foyda va baseline: ochilishdan keyin foyda 0; kapital foyda emas.
7. RLS va sotuvchi izolyatsiyasi; menejer = direktor parity; kurs snapshotlari va kurs ko'rigi; 076–084 regressiya to'plami; telefon UI (390 px).

## 12. Taxminiy vaqt

Bu sanoq qarorlarini hisobga olmagan ish vaqti:
- PHASE C (085 + UI + lokal testlar): taxminan 2–3 ish kuni.
- PHASE D (staging: sizning release buyrug'ingiz + test to'plami): 1 kun.
- PHASE E (production release oynasi): 1–2 soat.
- PHASE F (sanoq va kiritish): sanoqqa bog'liq.

## 13. Verdikt

- **OPENING ACCOUNTING: NO-GO.**
  - Eski so'm / USD qarzlar, mahsulotsiz zavod va sotuvchi majburiyatlari uchun funksiya yo'q.
  - Soxta so'm / USD kassa va avanslar bor (tasdiqlanmagan).
  - Mavjud reset valyutani yarim tozalaydi.
  - Production versiyasi tasdiqlanmagan.
- **077–084 PRODUCTION: NO-GO.**
  - Real staging'da 082–084 sinalmagan.
  - 085 (ochilish) hali yo'q.
  - Production versiyasi tasdiqlanmagan.
  - Qarorlar (10-bo'lim) kutilmoqda.
