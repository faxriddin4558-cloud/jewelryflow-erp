# Goldia Sales — tasdiqlangan topilmalar (batafsil)

Darajalar: **BLOCKER** — real oltin bilan ishlashni to‘xtatadi · **HIGH** — pul/oltin yo‘qolishi yoki
maxfiy moliyaviy ma’lumot oqishi · **MEDIUM** — noto‘g‘ri hisobot, nazorat kamchiligi, cheklangan ta’sir ·
**LOW** — kosmetik / himoya qatlami.

Barcha "qayta tiklash" qadamlari `harness/` dagi skriptlar bilan avtomatik takrorlanadi
(`harness/t/regression.js` — F1…F10; 069 bazada 1/16, 070 bazada 16/16).

---

## HIGH — 070 da tuzatildi

### F1. Har qanday autentifikatsiyalangan foydalanuvchi istalgan tashkilotning to‘liq moliyaviy holatini o‘qiydi
- **Qayta tiklash:** Supabase’da istalgan login (xodim yozuvi yo‘q bo‘lsa ham) →
  `POST /rest/v1/rpc/rpc_get_accounting_profit_summary {"p_org_id":"00000000-0000-0000-0000-000000000001"}`.
- **Kutilgan:** 42501 rad.
- **Haqiqiy (069):** xodimsiz, tashkilotsiz, nofaol sotuvchi, boshqa tashkilot direktori — hammasiga to‘liq
  javob: menejer ombori, sotuvchilar zaxirasi, mijoz qarzlari, kassa (so‘m/USD), zavod qarzi, baza, foyda
  (`evidence/before-069/…`, `regression-before-069.log` F1). Goldia tashkilot ID si migratsiyalardagi
  standart qiymat (`…0001`), ya’ni taxmin qilish shart emas.
- **Moliyaviy ta’sir:** maxfiy moliyaviy holat oshkor bo‘ladi. Agar Supabase Auth’da ochiq ro‘yxatdan
  o‘tish yoqilgan bo‘lsa (Supabase standarti — yoqilgan), internetdagi har kim anon kalit bilan akkaunt
  ochib, buni o‘qiy oladi → bu holda **BLOCKER**.
- **Ildiz sababi:** `v_org_id := coalesce(p_org_id, current_organization_id())`, rol yoki tashkilot
  tekshiruvi yo‘q. 069 faqat `anon` ni yopgan, `authenticated` qolgan.
- **Tuzatish:** JWT bilan chaqirilsa `p_org_id` faqat o‘z tashkiloti bo‘lishi mumkin va
  `assert_erp_permission` (direktor/menejer/buxgalter).

### F1b. Kompaniya foydasi biznes xarajatlari summasiga oshirib ko‘rsatiladi
- **Qayta tiklash:** baza tasdiqlang → 500 000 so‘m xarajat (`business_expense`) → foyda xulosasi.
- **Kutilgan:** "Sof aktiv o‘zgarishi (kapital harakatlariga tuzatilgan)" = −0.5 g (UI formulasi:
  "Joriy aktiv − Boshlang‘ich − Kiritilgan + Yechilgan"; yonida "Rasmiy xarajatlar: −0.50 g").
- **Haqiqiy (069):** 0.00 g. Ssenariyda: 1.5 g xarajat bo‘lsa ham natija +0.528 g ko‘rsatiladi (070: −0.972 g).
- **Moliyaviy ta’sir:** direktor kompaniya foydasini barcha xarajatlar miqdorida ortiqcha ko‘radi; foyda
  taqsimoti qarorlari noto‘g‘ri bo‘ladi.
- **Ildiz sababi:** `v_period_accounting_res := (net − base) − cap_in + cap_out + v_expenses_g …` — xarajat
  allaqachon sof aktivni kamaytirgan, so‘ng yana qo‘shib qo‘yilgan.
- **Tuzatish:** xarajat qo‘shilmaydi; `operational_trading_result_585_g` (xarajatdan oldingi natija) alohida
  qaytariladi. ⚠️ Hisob siyosati — direktor tasdiqlashi kerak.

### F2. To‘langan sotuvni bekor qilish mijozning to‘lovini yo‘q qiladi
- **Qayta tiklash:** CA1 ga 3.25 g @10% (3.575 g) → mijoz lom+naqd bilan 3.5767 g to‘laydi (qarz 0, avans
  0.0017) → menejer `rpc_reverse_barcode_piece_sale`.
- **Kutilgan:** dona sotuvchiga qaytadi, mijoz to‘lagan 3.575 g avansga (kreditga) aylanadi → avans 3.5767 g.
- **Haqiqiy (069):** qarz 0, avans **0.0017 g** — 3.575 g to‘lov izsiz yo‘qoldi (rekonsilyatsiya
  `CUST CUST-0001`: kutilgan −1.0767, haqiqiy +2.4983). Qisman to‘langan sotuvda ham xuddi shunday.
- **Moliyaviy ta’sir:** mijozdan olingan oltin/pul hisobdan chiqib ketadi, kompaniya sof aktivi va foydasi
  shuncha oshadi; mijozga qaytariladigan summa tizimda yo‘q.
- **Ildiz sababi:** UI to‘lovlarni mijoz hisobiga (sotuvga bog‘lamay, `p_sale_id = null`) yozadi, lekin
  bekor qilish sotuv qatoridagi `settled_gold_grams` (doim 0) dan foydalanadi va qarzni `greatest(0, …)` bilan
  kesadi.
- **Yumshatuvchi omil:** mijozlar sahifasi (`rpc_get_unified_customer_ledger`) ochilganda kesh hujjatlardan
  qayta yoziladi va to‘g‘rilanadi (M-13). Ungacha dashboard, foyda, sotuvchi ekrani va keyingi sotuvdagi
  avans hisobi noto‘g‘ri qiymatdan foydalanadi.
- **Tuzatish:** bekor qilish mijoz hisobining sof pozitsiyasidan (qarz − avans − sotuv summasi) hisoblanadi;
  manfiy bo‘lsa avans.

### F3. Yangi mijozga parallel to‘lovlarda avans yo‘qoladi (lost update)
- **Qayta tiklash:** hali `client_gold_accounts` qatori yo‘q mijozga 3 ta parallel 1 000 000 so‘m to‘lov
  (`scripts/verify-acceptance-audit-concurrency-local.sh`, `harness/t/conc.js` C3).
- **Kutilgan:** sotuvchi kassasi 3 000 000, mijoz avansi 3.0 g.
- **Haqiqiy (069):** kassa 3 000 000, avans **1.0 g** — 2 g mijoz krediti yo‘qoldi.
- **Ildiz sababi:** `SELECT … FOR UPDATE` qator yo‘q bo‘lsa hech narsani qulflamaydi; keyingi `ON CONFLICT DO
  UPDATE` qarz/avansni absolyut qiymat bilan yozadi.
- **Tuzatish:** avval `INSERT … ON CONFLICT DO NOTHING`, keyin `FOR UPDATE`. Qo‘shimcha: mijoz hisobida
  USD jami (`total_usd_paid_amount`) endi yangilanadi (069 da doim 0 edi).

### F4. Qisman sotilgan partiyani butunicha qayta sotish (oversell) va cheklanmagan ustama
- **Qayta tiklash:** C ga 10 g (bitta dona) va 2+3 g partiyalar → C 11 g vazn sotuvi (10 g + 2-partiyadan 1 g)
  → C `rpc_record_client_jewelry_sale` bilan 2-partiyani butunicha, ustama 200%.
- **Kutilgan:** rad (partiya allaqachon qisman ishlatilgan; ustama 0–100%).
- **Haqiqiy (069):** qabul qilindi — 15 g zaxiradan **16 g** sotildi, mijozga 15 g qarz yozildi; sotuvchi
  zaxirasi `greatest(0, …)` tufayli 0 ko‘rinadi (1 g yashirinadi). Dashboard: "NOMUVOFIQLIK: 1.00 g".
- **Moliyaviy ta’sir:** mavjud bo‘lmagan oltin sotiladi, mijoz qarzi sun’iy oshadi, sotuvchida hisobsiz 1 g
  qoladi. Mobil UI dropdown’i faqat `held_by_seller` partiyalarni ko‘rsatgani uchun asosan to‘g‘ridan-to‘g‘ri
  RPC (sotuvchining o‘z tokeni bilan) orqali qilinadi.
- **Ildiz sababi:** tekshiruv faqat `sold_quantity < quantity` va "dona sotilganmi"ga qaraydi; vazn sotuvi
  boshqa partiyaning donasidan gramm kesganda bu partiyaning `sold_quantity` o‘zgarmaydi.
- **Tuzatish:** butun partiya faqat `held_by_seller`, vazn ajratmalari va sotuvlari yo‘q, dona vaznlari
  yig‘indisi `base_weight_grams` ga teng bo‘lsa sotiladi; ustama 0–100 va aniq; sotuvchi bo‘yicha advisory lock.

### F5. Zavod kirimining idempotency kaliti saqlanmaydi
- **Qayta tiklash:** `rpc_record_factory_receipt(…, p_idempotency_key := 'fr-1')` ikki marta.
- **Kutilgan:** bitta kirim, ikkinchi javob — birinchisi.
- **Haqiqiy (069):** ikkita kirim, zavod majburiyati 108 → 216 g. Qo‘shimcha: `manager_physical_stock_g`
  har kirimdan keyin oxirgi kirim vazniga oshib turadi (trigger + RPC ikki marta qo‘shadi), masalan 270 g
  o‘rniga 290 g.
- **Moliyaviy ta’sir:** tarmoq retry’i zavod qarzini ikki baravar qiladi (UI har bosishda yangi kalit
  yaratadi, ya’ni asosan proxy/retry holati).
- **Tuzatish:** kalit ustunga yoziladi va `save_idempotency_response`; menejer zaxirasi kanonik funksiyadan.

### F6. `public.currency_rates` hech bir migratsiyada yaratilmagan
- **Qayta tiklash:** migratsiyalardan qurilgan bazada direktor UI’dan kapital/xarajat kiritadi, USD kursi
  maydoni bo‘sh (odatiy holat).
- **Haqiqiy (069):** `relation "public.currency_rates" does not exist` — kapital ham, xarajat ham yozilmaydi.
- **Ta’sir:** repo’dan bazani qayta tiklash (disaster recovery) mumkin emas; production’da jadval qo‘lda
  yaratilgan bo‘lmasa — kapital/xarajat moduli ishlamaydi. Production holati tekshirilmadi.
- **Tuzatish:** jadval mavjud bo‘lsagina dinamik so‘rov; USD summasi uchun kurs majburiy (yashirin 12 800 yo‘q).

### F9. Tashkilotlararo xodim boshqaruvi va `organization_id` o‘zgartirish
- **Qayta tiklash:** Org B direktori `UPDATE employees SET is_active=false WHERE id=<Goldia direktori>`;
  Goldia sotuvchisi `UPDATE employees SET organization_id=<Org B> WHERE id=<o‘zi>`.
- **Haqiqiy (069):** ikkalasi ham bajarildi; Org B direktori Goldia’ning barcha xodimlarini (email, telefon),
  audit loglarini va idempotency javoblarini (moliyaviy) o‘qidi. Direktor o‘zini boshqa tashkilotga
  ko‘chirib, u yerning direktoriga aylanishi mumkin.
- **Ta’sir:** ko‘p tashkilotli production’da — boshqa tashkilotni egallab olish. Bitta tashkilot bo‘lsa —
  latent, lekin sotuvchi o‘zini "yo‘qotib" qo‘yishi mumkin.
- **Ildiz sababi:** `admin manage employees` va select siyosatlari tashkilot bilan cheklanmagan;
  `prevent_employee_privilege_escalation` `organization_id` ni tekshirmaydi.
- **Tuzatish:** siyosatlar tashkilot bilan cheklandi; JWT orqali `organization_id` o‘zgarmaydi; audit/idempotency
  o‘qish ham tashkilot bilan cheklandi.

## MEDIUM — 070 da tuzatildi

- **F7.** `rpc_record_weight_sale`: idempotency tekshiruvi zaxira tekshiruvidan keyin edi — muvaffaqiyatli
  sotuvning retry’i `ERR_INSUFFICIENT_SELLER_STOCK` qaytaradi, foydalanuvchi sotuv bo‘lmagan deb o‘ylaydi.
- **F8.** Sotuvchi `rpc_get_financial_reconciliation_summary`, `rpc_get_three_tier_ledger_summary`
  (menejer seyfi, zavod qarzi, barcha sotuvchilar jami) va boshqa sotuvchining donalarini
  (`rpc_get_seller_available_pieces(p_seller_id)`) o‘qiy oladi. UI bu funksiyalarni sotuvchi uchun chaqirmaydi.
- **F10.** `rpc_set_daily_gold_rate` `set_by` (FK → `employees.id`) ga `auth.uid()` yozadi: `employees.id ≠ user_id`
  bo‘lgan direktor kursni o‘rnata olmaydi (FK xatosi). Production API `id = user_id` qiladi, eski/import
  qilingan xodimlar uchun latent.

## MEDIUM — tuzatilmadi (biznes qarori yoki dizayn kerak)

- **M-1.** Konsignatsiya direktorga yoki nofaol xodimga berilishi mumkin (sotuvchi roli/faolligi tekshirilmaydi).
- **M-2.** Dona probasi tekshirilmaydi: "faqat 585" partiyaga 750 dona qabul qilinadi va 585 sifatida hisoblanadi.
- **M-3.** Sotuvchi boshqa sotuvchining mijoziga sotishi (UUID ma’lum bo‘lsa) va boshqa sotuvchiga
  biriktirilgan mijoz yaratishi mumkin; bunday qarzni faqat o‘sha boshqa sotuvchi undira oladi.
- **M-4.** Nazorat ajratilmagan: sotuvchi o‘zi donani menejerga "qaytaradi" (majburiyati darhol kamayadi,
  menejer tasdig‘isiz) va o‘z sotuvini bekor qiladi. Sotish → pul olish → bekor qilish → "qaytarish" yo‘li
  faqat jismoniy sanoqda aniqlanadi.
- **M-5.** Kurs riski sotuvchida: mijozdan 950 000 kursda olingan naqd/USD menejerga 1 000 000 kursda
  topshirilganda sotuvchi 0.3447 g yo‘qotadi; bu hech qaysi kurs farqi daftarida ko‘rinmaydi (066 faqat xaridlar).
  Menejer topshiruvda istalgan kursni kirita oladi.
- **M-6.** `current_organization_id()` `app.current_organization_id` GUC’ni ishonchli deb qabul qiladi.
  PostgREST orqali o‘rnatib bo‘lmaydi, lekin to‘g‘ridan-to‘g‘ri DB ulanishida tashkilotni almashtirish mumkin.
- **M-7.** Vazn sotuvi shtrix-kodli donalarning vaznini kesadi (tartib `cp.id` — tasodifiy UUID); dona yorlig‘i
  (`BL-04|12.00`) va tizim vazni (2.5 g) ajralib ketadi. Bir nechta partiyadan iborat vazn sotuvida ustama
  farqi birinchi partiya foizi bilan hisoblanadi (masalan −0.55 g, haqiqiy −0.52 g).
- **M-8.** "BALANS TO‘LIQ MOS" faqat fizik grammlarni tekshiradi; mijoz/sotuvchi darajasidagi farqlar
  (F2, F3) ko‘rinmaydi.
- **M-9.** Menejer `p_seller_id` siz vazn sotuvi qilsa — eng birinchi yaratilgan sotuvchiga yoziladi.
- **M-10.** `CustomerLedgerAndSheetsSection` dagi to‘lov, sotuv/to‘lov/eski qarzni bekor qilish va direktor
  panelidagi barcha bekor qilishlar idempotency kalitisiz yuboriladi — sekin tarmoqda qayta bosish ikki yozuv
  yaratishi mumkin (bekor qilishlarda status tekshiruvi himoya qiladi; to‘lovda — yo‘q).
- **M-11.** Bir kunda kursni qayta o‘rnatish `daily_gold_rates` qatorini ustidan yozadi — kun ichidagi kurs
  tarixi yo‘qoladi (hujjatlarda qo‘llangan kurs saqlanadi).
- **M-12.** `client_legacy_debts` SELECT siyosati faqat tashkilot bo‘yicha — B sotuvchi A sotuvchining
  mijozlaridagi eski qarzlarni ko‘radi.
- **M-13.** `rpc_get_unified_customer_ledger` (mijozlar sahifasi) **o‘qish paytida** `client_gold_accounts`
  ni hujjatlardan qayta hisoblab yozadi. Natija: 069 da bir xil bazada direktor foydani +3.19 g, menejer
  (sahifa ochilgandan keyin) −2.39 g ko‘rdi. 070 dan keyin kesh hujjatlarga teng, shuning uchun bu yozish
  qiymatlarni o‘zgartirmaydi, lekin "o‘qish = yozish" dizayni xatolarni yashiradi va hisobotlarni kim qaysi
  sahifani ochganiga bog‘liq qiladi.

## LOW

- **L-1.** Vazn minimal 0.05 g deb yozilgan, lekin 0.001 g qabul qilinadi.
- **L-2.** Eskirgan overload’lar: `rpc_record_refining_batch` (8 va 9 argument), `rpc_reverse_financial_transaction`
  (2 va 3 argument) — argument tushirib qoldirilsa PostgREST PGRST203 beradi. UI hozir to‘liq argument yuboradi.
- **L-3.** `save_idempotency_response` `authenticated` uchun ochiq — istalgan kalit/javob yozish mumkin.
- **L-4.** Barcha afinaj oltini zavodga berilgandan keyin `manager_refined_gold_fine_grams` da 0.002 g qoladi
  (fizik vs sof gramm semantikasi aralash).
- **L-5.** React hydration xatosi #418 — `/sales/director`, `/sales/mobile`.
- **L-6.** Sotuvchi `/sales/director` sahifasini ochadi (server ma’lumotni 403 bilan bermaydi).
- **L-7.** `rpc_get_factory_settings` xodimsiz foydalanuvchiga ham standart sozlamalarni qaytaradi.
- **L-8.** Sotuvchi `get_manager_available_stock_grams` orqali menejer zaxirasi jamini ko‘radi.
- **L-9.** Login’dagi xodim qidiruvi foydalanuvchi kiritgan email’ni PostgREST `or=` filtriga to‘g‘ridan-to‘g‘ri
  qo‘yadi (faqat klient tomonidagi rol tanlovi; server RLS himoya qiladi).
- **L-10.** Sotuvchi topshiruvida fizik lom grammi (`p_physical_scrap_g`) kassadagi fizik qoldiq bilan
  solishtirilmaydi (`greatest(0, …)` bilan kesiladi).
- **L-11.** Bekor qilingan sotuv statusi `cancelled` bo‘lsa mijozlar daftari uni hisoblaydi (`status <> 'reversed'`),
  boshqa funksiyalar esa yo‘q. Hozir `cancelled` sotuv yaratadigan yo‘l topilmadi.

## Tasdiqlangan to‘g‘ri ishlaydigan narsalar (tanlab)

Anon uchun barcha `SECURITY DEFINER rpc_*` yopiq (108 funksiya sweep); sotuvchi boshqa sotuvchining
sotuvlari/to‘lovlari/hisobotlarini ko‘rmaydi va ular nomidan operatsiya qila olmaydi; sotuvchi zavod kirimi,
konsignatsiya, xarid, afinaj, zavodga topshiruv, kapital/xarajat, baza va reset qila olmaydi; bir dona ikki
marta sotilmaydi (parallel ham); kassani ikki marta topshirib bo‘lmaydi; ikki marta bekor qilish rad etiladi;
pul sarflangandan keyin topshiruvni bekor qilish rad etiladi; ustama murakkab foiz bilan hisoblanmaydi (har
doim bazaviy vazndan); mijoz qarzi sotuv/to‘lov paytidagi kurs bilan qayd etiladi va bugungi kurs bilan qayta
hisoblanmaydi; afinaj yo‘qotishi, xarid kurs farqi va zavod majburiyati qo‘lda hisoblangan qiymatlarga to‘liq mos.
