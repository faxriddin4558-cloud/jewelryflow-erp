# Goldia Sales — PHASE C: migration 085 (nazoratli qayta boshlash + boshlang'ich hisob)

Sana: 2026-11-11.

**Faqat lokal ishlab chiqish.** Production va staging o'zgartirilmadi; haqiqiy moliyaviy ma'lumotga hech narsa yozilmadi.

- **Production versiyasi hali VERIFIED emas.** Bu sessiyadan production'ga ulanib bo'lmaydi (tarmoq 403). DB 080/081 va frontend `2b48df9` faqat egasining xabaridan.
- Staging (VERIFIED, 2026-11-11): DB 081, frontend `28596c3`.

## 1. Migration 085 nima yaratadi

Migration faqat schema va funksiyalarni yaratadi — qayta boshlash o'z-o'zidan ishga tushmaydi.

| Obyekt | Vazifa |
|---|---|
| `financial_restarts` | Har bir qayta boshlash: T0, sabab, direktor, backup tasdig'i, arxivlangan hujjatlar soni. |
| `financial_restart_items` | Arxivga o'tgan har bir qator: jadval, id, eski holati (audit). |
| `financial_backup_verifications` | "Backup olindi va alohida nusxaga tiklab sinaldi" tasdig'i. **Faqat release vositasi (service role) yozadi**; foydalanuvchi yoza olmaydi. |
| `opening_periods` | Boshlang'ich davr: `draft` → `locked` (baseline bilan) → `closed` (keyingi qayta boshlashda). Tashkilotda bir vaqtda faqat bitta draft. |
| `opening_documents` | Boshlang'ich hujjatlar. Har birida: davr ID, hujjat raqami, kim, qachon, T0, asl summa, birlik / valyuta, kurs snapshoti, fizik g va proba, qarshi tomon, izoh. |
| `rpc_financial_restart` | Faqat direktor. Terilgan tasdiq matni, sabab, T0 va 24 soat ichidagi, hali ishlatilmagan backup tasdig'i talab qilinadi. Hammasi bitta tranzaksiyada. |
| `rpc_record_opening_document` | Menejer / direktor; faqat draft davrda; har bir so'rov o'z kaliti bilan, takror bosish ikki marta yozmaydi. |
| `rpc_cancel_opening_document` | Baseline'gacha har bir turni aniq teskari qiladi; boshqa hujjat bog'liq bo'lsa, manba himoyalanadi. |
| `rpc_get_opening_state` | Solishtirish paneli: jami qoldiqlar, sotuvchilar, tekshiruvlar. |
| Moslashtirilgan funksiyalar (generator orqali) | Sotuvchi majburiyatini qayta hisoblash, davr hisoboti effektlari, foyda xulosasi, baseline (sotuvchi kassasi bo'sh bo'lmasa rad etadi va davrni qulflaydi). |

**Qayta boshlash nimalarni qamraydi.**
- Hujjatlar arxivlanadi (o'chirilmaydi, "reversed / cancelled" + vaqt):
  - savdolar va vozvratlar;
  - gramm to'lovlar va topshiruvlar;
  - **valyuta to'lovlari**;
  - eski qarzlar;
  - donalar va konsignatsiyalar;
  - zavod kirimlari va zavodga topshiruvlar;
  - afinaj;
  - kapital va xarajatlar;
  - xaridlar;
  - oldingi boshlang'ich hujjatlar.
- Qoldiqlar 0 bo'ladi: mijozlarning 585 / **so'm / USD** qarz va avanslari, sotuvchi ombori, majburiyati va kassasi, menejer seyfi, zavod hisobi. Baseline arxivlanadi.
- **Saqlanadi:** mijozlar, telefonlar, sotuvchiga biriktirish, xodimlar, loginlar, rollar, modellar, sozlamalar, kurs sozlamalari.
- Arxivlangan hujjatlar davr hisobotida qayta boshlash kunida aniq nolga chiqadi; testda effektlar yig'indisi = hisob qoldiqlari.

## 2. Boshlang'ich hujjatlar (A–L) va biznes qoidalari

| Tur | Qanday ishlaydi | Qaror |
|---|---|---|
| A. Menejer ombori | T0 sanali alohida "BOSHLANG'ICH HISOB" zavod kirimi; zavod foizi har bir hujjatda (default yo'q). 100 g @8 % → ombor 100, zavod 108. | O-4 |
| B. Sotuvchi ombori | (a) menejerning boshlang'ich omboridan: menejerdan kamayadi, ikki marta sanalmaydi; (b) faqat sotuvchida: shu grammga kirim yaratilib, darhol to'liq beriladi — menejer ombori oshmaydi. 50 g @12 % → ombor 50, majburiyat 56. | O-4, §6 |
| C. Zavod majburiyati / avansi | Mahsulotsiz, 585 g. Menejer seyfining zavod hisobiga, foyda va baseline'ga qo'shiladi; sotuvchi majburiyatidan alohida. | — |
| D. Sotuvchi majburiyati | 585 g + majburiy asos (izoh). | — |
| E. Mijoz 585 qarzi / avansi | Eski qarz yozuvi (`opening` turi); qarz sotuvchi majburiyatini 076 qoidasi bo'yicha yaratadi. | O-5 |
| F. Mijoz so'm / USD qarzi / avansi | Asl valyuta va summa mijoz hisobida qoladi. Qarz sotuvchining 585 g majburiyatini **bir marta**, kiritilgan kurs bilan yaratadi (8 600 000 / 860 000 = 10 g; USD: summa × USD kursi / 585 kursi). Kurs keyin o'zgarsa qayta hisoblanmaydi. Kurs bo'lmasa — rad. Bir mijoz va valyutaga bitta hujjat. | O-3 |
| G. Menejer kassasi | so'm / USD (kapital emas, kapital bilan aralashmaydi). | O-2 |
| H. Menejer LOM | fizik g + proba (300–1000), 585 ekvivalenti. | — |
| I. Toza oltin | fizik g + proba (900–1000); seyfning "toza oltin (afinaj)" ustunlarida. | — |
| J. Boshqa aktiv / majburiyat | Yo'nalish, tur, valyuta yoki proba, summa, 585 ekvivalenti, kurs, qarshi tomon. Zavod, sotuvchi va mijoz qarziga **qo'shilmaydi**; foyda va baseline'da alohida qatorlar. | O-6 |
| K. Solishtirish | Jami qoldiqlar; sotuvchilar jadvali; 6 tekshiruv: sotuvchi kassasi bo'sh, sotuvchi ombori = donalar, mijoz 585 / so'm / USD = hujjatlar, qayta boshlashdan keyingi oddiy hujjatlar = 0. | — |
| L. Tasdiqlash | Baseline: sotuvchi kassasi bo'sh bo'lmasa rad (O-2); keyin davr qulflanadi, hujjat qo'shish va bekor qilish rad etiladi. | O-1, O-2 |

**Ikki marta hisoblanmaydi:**
- valyuta to'lovi yangi sotuvchi majburiyatini yaratmaydi;
- topshiruv mavjud majburiyatni kamaytiradi (testda 860 000 so'm @860 000 = aniq 1 g);
- savdo ombordan oladi, majburiyatni o'zgartirmaydi.

## 3. UI

Yangi sahifa: **"🧾 Boshlang'ich hisob"** (`/sales/app/opening`; menyuda menejer va direktor uchun).
- "⚠️ Moliyaviy hisobni qayta boshlash" — faqat direktorga ko'rinadi.
  - Maydonlar: T0, sabab, backup tanlovi va tasdiq matni `MOLIYAVIY HISOBNI QAYTA BOSHLASH`.
  - Matn aynan yozilmaguncha tugma o'chiq.
- "Boshlang'ich hujjat qo'shish": tur tanlanadi, kerakli maydonlar chiqadi.
- Hujjatlar ro'yxati: raqam, tur, kim / kimga, miqdor, 585 g, hisob formulasi, kurslar, kiritgan va vaqt; draft davrda "Bekor" tugmasi.
- "Solishtirish": jami qoldiqlar, sotuvchilar jadvali, ✅ / ❌ tekshiruvlar, "Boshlang'ich hisobni tasdiqlash va qulflash" (USD kursi bilan) — tekshiruvlar yashil bo'lmaguncha o'chiq.

Eski "Sozlamalar → 🧹 Sinov Tozalash" endi faqat staging rejimida ko'rinadi.

## 4. Testlar

| Test | Natija |
|---|---|
| vitest — 085 ssenariylari (restart, atomiklik, A–J, bekor qilish, solishtirish, qulf, keyingi savdo / to'lov / topshiruv / vozvrat, kurs snapshoti, RLS, rollback va postflight) | **PASS 14/14** |
| vitest — to'liq to'plam | **PASS 428/428** |
| TypeScript (`tsc --noEmit`) | **PASS** |
| `eslint src --max-warnings 0` | **PASS** |
| `eslint .` (butun repo) | **FAIL (eski)**: `docs/releases` dagi 6 ta eski test faylida 24 ta muammo — 085'dan oldin ham aynan shunday. |
| `next build` | **PASS** |
| Release mashqi 081 → 082 → 083 → 084 → 085 (dry run + apply): postflight 073–085, schema parity 0 farq, RLS (o'qish 10 835 va yozish 20 000 tekshiruv), emergency rollback 085 → 081, qayta qo'llash, balanslar o'zgarmadi | **PASS** |
| Postflight 085 (toza 001–085 stack) | **PASS 12/12** |
| Rollback 085: restart yoki boshlang'ich hujjat bor bo'lsa rad etiladi | **PASS** |
| 077–084 regressiya va UI (Playwright, real login) | 5-bo'limga qarang |

Testdagi asosiy holatlar:
1. Mijozlarni saqlagan holda restart — PASS.
2. Valyuta hisoblari va kassalar to'liq 0 — PASS.
3. Takror so'rov (o'sha kalit) — o'sha natija; yangi restart draft tugaguncha rad — PASS.
4. Restart o'rtasidagi xato → hech narsa o'zgarmaydi, backup ishlatilmagan holda qoladi — PASS.
5–8. Gramm, so'm, USD qarz va avanslar — PASS.
9–12. Ombor, zavod va sotuvchi majburiyatlari — PASS.
13–14. Kassa, LOM, toza oltin, boshqa majburiyatlar — PASS.
15–16. Solishtirish va qulf — PASS.
17–19. Keyingi savdo, to'lov, topshiruv, vozvrat — PASS.
20. Kurs snapshoti va audit — PASS.
21. Sotuvchi kiritolmaydi; boshqa tashkilot ko'rmaydi va bekor qilolmaydi; sotuvchi faqat o'zinikini ko'radi — PASS.
22. 077–084 regressiya — 5-bo'lim.

## 5. 077–084 regressiya + 085 UI (lokal, real GoTrue + Next.js)

| To'plam | Natija |
|---|---|
| **085 ochilish UI** (opening-085): backup tasdig'ini faqat service role yozadi; direktor UI restart (noto'g'ri matnda tugma o'chiq, ikki marta bosish → bitta restart); identifikatorlar saqlangan, qoldiqlar 0; menejer UI'da 4 hujjat (ombor 70, zavod 108, sotuvchi 30); so'm qarzi 8.6 mln → majburiyat 43.6 g; tekshiruvlar yashil, qulf, keyin kiritish rad; 390 px'da toshish yo'q; keyingi savdo | **PASS 8/8** |
| rate-084 (kurslar, snapshot, ko'rik, UI) | **PASS 18/18** |
| ret-083 (vozvrat, FIFO, UI) | **PASS 28/28** |
| balance-082 | **PASS 19/19** |
| adv-081 (sotuvchi eski avansi) | **PASS 11/11** |
| ui-076 (eski qarz, reversal) | **PASS 17/17** |
| ui-077 (direktor = menejer, kapital, valyuta) | **PASS 21/21** |
| ui-078 (arxiv) / davr hisoboti poygasi | **PASS 10/10** / **PASS 1/1** |
| da-079 | **PASS 14/14** |
| Parity matrix (direktor ↔ menejer) | **0 farq, 0 yetishmagan** |
| Valyuta stress | **PASS 13/13** |
| stress-076 (izolyatsiya va hujum holatlari) | **PASS 16/16** |
| Faqat staging'da yuradigan harnesslar (stg-076-api, role matrix, integrity, recon-079, report-080, staging-077/078) | **NOT TESTED** (real staging kerak) |

## 6. `.claude/settings.json` (texnik himoya)

- **Avtomatik ruxsat faqat** lokal stand-in (`psql -h 127.0.0.1 -p 55437 …`) va lokal release mashqi uchun.
- **So'raladi:** Supabase SQL, boshqa `psql`, `scripts/*`.
- **Taqiqlangan:** `apply_migration`, `apply-prod-*`, `sync-vercel-prod-env`, `backup-prod-data`, `.env.production.local` ni o'qish.
- **Hooklar:**
  - `.claude/hooks/block-protected-refs.js` — buyruqda production, uning typo ref'i, JFS yoki ERP ref'i bo'lsa yoki production yozuvchi skript bo'lsa, bloklaydi (shu sessiyada sinaldi: bloklandi);
  - `.claude/hooks/supabase-staging-only.js` — Supabase vositalarini faqat staging loyihasi bilan ishlatadi.
  - Xato yoki o'qib bo'lmaydigan kirishda ham bloklaydi.

## 7. Qolgan xavflar

1. **Production versiyasi tasdiqlanmagan.** Release vositasi darajani o'zi aniqlaydi va uzilishda to'xtaydi.
2. **Qayta boshlash juda kuchli amal.**
   - Himoya: faqat direktor, terilgan matn, tiklab sinalgan backup (24 soat, bir marta).
   - Backup tasdig'ini yozadigan release qadami hali yo'q — PHASE E da qo'shiladi; hozircha faqat service role qo'lda yoza oladi.
3. **Draft davomida oddiy savdo bloklanmaydi.** Faqat solishtirishda "oddiy hujjatlar soni" ko'rinadi va UI tasdiqlashni to'xtatadi. Server baseline faqat O-2 ni tekshiradi; asosiy paneldagi eski "Hisobni boshlash" tugmasi tekshiruvlarsiz bosilishi mumkin.
4. **"Boshqa" aktiv / majburiyatlarni keyin to'lash yoki yopish funksiyasi yo'q** — ular baseline'da qotib turadi.
5. **Eski "Sinov Tozalash" serverda hamon bor** (UI faqat staging'da). Valyutani tozalamaydi.
6. **Hujjatlar sanasi.** Boshlang'ich zavod kirimi va konsignatsiya T0 sanali, lekin `created_at` haqiqiy kiritish vaqti (audit uchun to'g'ri).

## 8. Biznes qarorini talab qiladigan masalalar

- **D-1. Sotuvchidagi mahsulot zavodga qarzmi?**
  - O-4 faqat menejer mahsulotini aytadi. Hozir sotuvchi uchun ham zavod foizi majburiy.
  - 0 % ham zavod majburiyatini vazn miqdorida yaratadi. "Zavodga qarzsiz" varianti yo'q.
- **D-2. Valyuta qarzi to'langanda kurs farqi.**
  - Majburiyat ochilishda 860 000 bilan yozilgan; pul topshirilganda kiritilgan kurs bilan yopiladi.
  - Kurs farqini kim ko'taradi (R-1 / R-2)?
- **D-3. Valyuta avansi** sotuvchi majburiyatini kamaytiradimi? Hozir yo'q (585 avans qoidasidek).
- **D-4. Draft davomida oddiy operatsiyalar** serverda bloklansinmi? Asosiy paneldagi "Hisobni boshlash" yashirilsinmi?
- **D-5. "Boshqa" qarzlarni keyin to'lash** jarayoni kerakmi?
- **D-6. Toza oltin** seyfning "afinaj toza oltini" ustunida yuritilsinmi (zavodga topshirish mumkin), yoki alohida ustun kerakmi?
- **Kurs qarorlari (084'dan):** cheklovlar, eskirgan kurs, tuzatish tartibi, hisobot USD kursi, so'm / USD savdo qaysi kun kursi bilan baholanadi.

## 9. Verdikt

- **Staging'ga chiqish: GO.** Sizning ruxsatingiz bilan, PHASE D.
- **Production: NO-GO.** Versiya tasdiqlanmagan, real staging sinovi yo'q, D-1…D-6 qarorlari kutilmoqda.

**Keyingi qadam (PHASE D):**
1. O'z PowerShell oynangizda:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
   ```
   (081 → 082 → 083 → 084 → 085 va frontend).
2. Keyin men staging sintetik tashkilotida to'liq to'plamni yuritaman, ochilish UI testi ham kiradi (`GA_TARGET=staging GA_ALLOW_RESTART=1`). Sintetik foydalanuvchilar test oldidan ochiladi, keyin yana bloklanadi.

## 10. D-1 qarori (2026-11-11) — FACTORY → MANAGER → SELLER → CUSTOMER

| Talab | Qanday ta'minlanadi | Dalil |
|---|---|---|
| 1. Menejer va sotuvchidagi barcha mahsulot zavoddan olingan mahsulotning bir qismi | Solishtirishdagi yangi tekshiruv: menejer ombori + sotuvchilar ombori = boshlang'ich zavod kirimlari grammi (`inventory_equals_opening_receipts`) | D1-2, O7 |
| 2. Zavod majburiyati faqat zavod → menejer bosqichida | Majburiyat faqat boshlang'ich zavod kirimida (A, yoki B "faqat sotuvchida" — u ham shu bosqich) va mahsulotsiz C hujjatida yaratiladi | D1-1, D1-4 |
| 3. Menejer → sotuvchi topshiruvi zavod majburiyatini yaratmaydi va kamaytirmaydi | Konsignatsiya zavod hisobiga tegmaydi; testda 60 g va keyin 10 g topshirilganda zavod 108 / 138 bo'lib qoldi | D1-1, D1-3 |
| 4. Topshiruv menejer omborini kamaytiradi, sotuvchinikini oshiradi, sotuvchi majburiyatini yaratadi | 100 → 40 / 60, majburiyat 67.2; keyin 30 / 70, majburiyat 78.4 | D1-1, D1-3 |
| 5. T0 dagi jami fizik mahsulot boshlang'ich kirimlar bilan moslashtiriladi | Tekshiruv yashil bo'lmasa, baseline **serverda** rad etiladi (`ERR_OPENING_NOT_RECONCILED`) | L, D1-3 |
| 6. T0 gacha sotilgan, zavodga hali to'lanmagan mahsulot zavod majburiyatida qoladi | C hujjati (mahsulotsiz zavod majburiyati); zavod hisobi = kirimlar + C − avans (`factory_obligation_equals_documents`); solishtirishda "mahsulotdan" va "mahsulotsiz" alohida | D1-2 |
| 7. Tarixiy topshiruvlar soxta yangi savdo sifatida yaratilmaydi | Draft davrdagi har qanday oddiy hujjat (kirim, konsignatsiya, eski qarz, kapital, zavodga topshirish, xarid, savdo, to'lov) sanaladi va baseline'ni to'xtatadi | L (oddiy kirim → rad) |
| 8. Foizlar asl fizik grammga, ko'paytirilmaydi | Sotuvchi majburiyati = vazn × (1 + sotuvchi foizi); 60 × 1.12 = 67.2 (60 × 1.08 × 1.12 emas) | D1-1 |

**Qo'shimcha xavfsizlik tuzatishlari:**
- Asosiy paneldagi "Hisobni boshlash" endi serverda ham solishtirishsiz o'tmaydi.
- Eski "Sinov Tozalash" boshlang'ich hisob yuritiladigan tashkilotda serverda rad etiladi (`ERR_USE_FINANCIAL_RESTART`).
- Direktor panelidagi "Sotuvchilardagi Zavod Qarzi" yozuvi "Sotuvchilarning menejerga majburiyati (zavod qarzi emas)" ga o'zgartirildi — u zavod majburiyati bilan adashtirilib, ikki marta sanalgandek ko'rinardi.

**Qayta sinov (D-1 dan keyin):**
- vitest 433/433 (D-1 zanjiri 5/5, 085 14/14);
- release mashqi 081 → 085 PASS;
- ochilish UI 8/8 (8 ta tekshiruv yashil);
- 077–084 regressiya to'liq PASS;
- tsc, `src` lint va build PASS.

D-1 bilan **D-1 qarori yopildi**. 8-bo'limdagi D-2 … D-6 hali ochiq.

## 11. Yakuniy qoidalar D-2 … D-6 (2026-11-11)

085 hech qayerda qo'llanmagan (staging 081 — VERIFIED; production ≤ 081), shuning uchun tuzatishlar 085'ning o'ziga kiritildi, 086 kerak bo'lmadi.

| Qaror | Amalga oshirilishi | Dalil |
|---|---|---|
| D-2 Kurs farqi | Boshlang'ich so'm/USD qarzga to'lov sotuvchi kassasining "baholangan" pooliga qarzning 585 g snapshoti bilan tushadi. Topshiruvda majburiyat aynan shu grammga yopiladi. Topshirish kursi (kiritilgan, bo'lmasa rasmiy) bilan farq `company_rate_difference_585_g` sifatida topshiruv hujjatida va foyda xulosasida alohida yoziladi. Mijoz qarzi, sotuvchi majburiyati va kassa qayta o'zgartirilmaydi. Snapshotlar o'zgarmaydi. | 8 600 000 @860 000 → 900 000 da topshirildi: majburiyat −10 g bir marta, farq 0.4444 g; USD 1.4 g → farq 0.0111 g; reversal hammasini aniq qaytaradi |
| D-3 Valyuta avansi | Avans qismi poolga **0 g** bilan tushadi: na to'lovda, na topshiruvda sotuvchi majburiyatini kamaytirmaydi. Avans — majburiyat, kassa — aktiv; davr natijasi o'zgarmaydi. | final-rules D-3 |
| D-4 Draft blokirovkasi | 12 ta moliyaviy jadvalda baza triggeri: draft davomida oddiy INSERT/UPDATE/DELETE rad (`ERR_OPENING_DRAFT`). Faqat restart, boshlang'ich hujjatlar va ularni bekor qilish o'z tranzaksiyasini belgilaydi. Qayta boshlash bilan parallel yozuvlar tartiblanadi (kutmasdan rad, deadlock yo'q). Eski reset va baseline orqali aylanib o'tib bo'lmaydi. | final-rules D-4 (direktor / menejer / sotuvchi, 9 xil RPC); OP-9 (10 parallel REST so'rov — hammasi rad); OP-10 (restart + 10 parallel yozuv — hech biri draftda tirik qolmadi) |
| D-5 Boshqa qarzlar | Opening'da kiritiladi va hisobotda alohida ko'rinadi. To'lash/yopish — **backlog**. | O4 |
| D-6 Toza oltin | Seyfning "afinaj toza oltini" ustuni — haqiqiy fizik toza oltin aktivi (zavodga `refined_gold` sifatida beriladi). Qayta ishlatildi, yangi ustun qo'shilmadi. 20 g @999 → 34.1538 g (585) / 19.98 g toza; zavodga 10 g berilganda faqat shu ustun va zavod majburiyati kamaydi. | final-rules D-6 |

**Backlog (D-5):** "boshqa" aktiv/majburiyatni qisman yoki to'liq yopish hujjati — hisobot va audit bilan.

**Cheklov (D-2):** lom (scrap) bilan to'langan qismning kurs farqi alohida yozilmaydi — lom o'z 585 grammi bilan yopiladi.
