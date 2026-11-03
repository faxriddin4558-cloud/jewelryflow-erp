# Goldia Sales 075 — HAQIQIY STAGING’da A–H audit (haqiqiy Supabase Auth)

**Sana:** 2026-11-03 · **Staging:** `vouehtlmsunebracahon`, migratsiya 075 POSTFLIGHT PASS · **Frontend:** `ddff86f` (staging, egasi tasdiqlagan)
**Qayerda:** haqiqiy staging Supabase — haqiqiy GoTrue loginlari (parol bilan), haqiqiy staging PostgREST, RLS rol `authenticated`.
**Brauzer (Playwright) qismi staging’da BAJARILMADI:** sessiya tarmoq siyosati `jewelryflow-sales-staging.vercel.app` ni rad etdi (proxy 403, audit oxirida qayta tekshirildi).
Quyidagi natijalar **API testlari** — brauzer testi deb ko‘rsatilmaydi. Lokal brauzer natijalari (`docs/audits/goldia-075-real-auth`) staging natijasi emas.

Yozuvlar faqat ikki sintetik tashkilotda: `GOLDIA-AUDIT-075-A` (direktor, menejer, 3 sotuvchi, worker) va `GOLDIA-AUDIT-075-B` (direktor, menejer, sotuvchi),
+ xodimsiz login. Production, JFS Demo, manufacturing ERP — tegilmagan. Parollar faqat konteynerdagi `0600` faylda; audit oxirida 10 login bloklandi (login → 400).

## Natijalar

| Bosqich | Tekshiruv | Natija | Evidence |
|---|---|---|---|
| A | Mijoz yaratish RPC orqali: o‘z raqamlash (`CUST-0001…`), org B mustaqil, dublikat nom, menejer → sotuvchi C, rad: worker / boshqa sotuvchi uchun / boshqa org sotuvchisi / xodimsiz; **direct INSERT** (4 rol, uzun kod) → 403; direct UPDATE kod/org → rad, telefon → ok, begona direktor → 0 qator; **30 + 10 parallel** yaratish → kolliziyasiz ketma-ket kodlar; F-STG-2 | **9/9** | `A-customers.json` (har operatsiya ID bilan) |
| B–H | Kirim (+retry), partiya, barcode / vazn sotuvi (dona tanlash, tanlanmasa rad, begona dona rad), Toshkent sanasi, sotuvchi LOM/USD kurslari, ±diapazon, `ERR_RATE_MISMATCH`, so‘m+USD+lom, eski qarz, kurs o‘zgargach topshiruv, begona kassa rad, xarid (kurs farqi), ustama farqi, bekor qilish, ikkinchi bekor qilish rad, dona qaytarish, afinaj, zavodga topshirish, sotuvchi izolyatsiyasi | **30/30** | `finance.json` |
| Rekonsilyatsiya | Mijoz qarzi/avansi, sotuvchi majburiyati/qarzi, dona saqlanishi, menejer ombori/so‘m/USD, zavod majburiyati, ilova hisoboti | **14/14, 0.0000 g** | `reconciliation.json` |
| Zero-Reset | menejer/sotuvchi/noto‘g‘ri kod rad; direktor → org A balanslari 0 (072 kassa puli ham); boshqa barcha tashkilotlar o‘zgarmagan | **3/3 × 4** | `reset-*.json` |
| F-073 | reset’dan keyin topshiruv aynan 2.0 g | **PASS** | `post-reset-f073.json` |
| 30 kun | pastda | **PASS** | `sim30-d30a.json` |
| Concurrency | bir donani 3 parallel sotish → 1; bir donadan 2 parallel 4 g → 1, dona 2 g; to‘lovni bir kalit bilan 4 parallel → 1 to‘lov; bir kassani 2 parallel topshirish → 1; sotuv va qaytarish parallel → 1 | **5/5** | `concurrency-rls.json` |
| RLS | o‘qish: 43 jadval × 9 login, ikki yo‘nalish (387) → 0; UPDATE/DELETE: 42 jadval × 3 login org B qatorlariga (252) → 0, org B qatorlari o‘zgarmagan; begona INSERT rad; begona sotuvchi/mijoz uchun RPC’lar rad | **4/4** (RLS4 birinchi urinishda FAIL — pastda) | `concurrency-rls.json`, `rls4-recheck.json` |

### 30 kunlik simulyatsiya (`harness/sim30.js`, seed 3030)

| | |
|---|---|
| Operatsiyalar | **732**, hammasi muvaffaqiyatli; har biri `id`, kun, aktor, expected/actual bilan |
| Savdolar | **238** (barcode 129, vazn 109 — har biri tanlangan donadan) |
| To‘lovlar | **197** (so‘m / USD / lom 585 va 750, kunlik o‘zgaruvchan sotuvchi kurslarida) |
| Ombor operatsiyalari | **86** (kirim 6, partiya 21, dona qaytarish 47, xarid 6, zavodga topshirish 6) |
| Boshqa | bekor qilish 36, topshiruv 30, kurs o‘zgarishi 121 (30 kunlik rasmiy kurs tarixi + sotuvchi kurslari), mijoz 24 |
| expected ≠ actual | **0** |
| Mustaqil model bilan farq (har mijoz, har sotuvchi, har dona, gramm saqlanishi, menejer ombori/kassa, zavod majburiyati) | **0, maks. 0.0000 g** |

Cheklov: staging soati haqiqiy — hujjatlar server sanasi (Toshkent, bugun) bilan yoziladi; 30 kun = 30 kunlik ish tsikli va kurs tarixi, sanalar soxtalashtirilmagan.

## Muvaffaqiyatsiz bo‘lgan / qayta bajarilgan qadamlar (yashirilmagan)

1. **RLS4 — FAIL (test klassifikatori).** Direktor org B sotuvchisi uchun `rpc_get_seller_markup_difference_report` chaqirdi; RPC xato o‘rniga `status: ok`, bo‘sh natija qaytardi va test buni oqish deb sanadi.
   Qayta tekshiruv (`rls4-recheck.json`): org B’da haqiqiy farq **0.1 g**; org B direktori 0.1 ni ko‘radi, org A direktori **0 va 0 ta yozuv** oladi — ma’lumot oqmaydi.
   **Kuzatuv O-1 (LOW):** bu RPC begona sotuvchi uchun rad etmaydi, jim 0 qaytaradi (`rpc_get_seller_rates` esa rad etadi) — xato emas, lekin chalg‘itishi mumkin.
2. **Rekonsilyatsiya evidence’i bir marta ustidan yozildi:** `recon.js` ni 30 kunlik simulyatsiyadan keyin (o‘z ssenariysi bo‘lmagan holatda) adashib ishga tushirdim → 608.8 g “farq” (ma’nosiz).
   Tashkilot reset qilindi, B–H zanjiri toza holatda qayta bajarildi: 30/30, rekonsilyatsiya 14/14, 0.0000 g — `reconciliation.json` shu natija.
3. Brauzer qismi — yuqorida: tarmoq ruxsati yo‘q.

## Topilmalar

- Kritik, yuqori yoki o‘rta darajadagi xato topilmadi. F-STG-1 va F-STG-2 staging’da yopilgani tasdiqlandi.
- O-1 (LOW) — yuqorida.

## Xulosa: **LIMITED GO**

Staging’dagi DB/API qatlami haqiqiy Auth bilan to‘liq o‘tdi: A 9/9, B–H 30/30, 732 operatsiyali 30 kun 0.0000 g, concurrency 5/5, RLS 0 oqish, Zero-Reset va F-073 PASS.
**FULL GO emas**, chunki talab qilingan Playwright brauzer auditi staging frontend’ida bajarilmadi (host bloklangan).
FULL GO uchun: `jewelryflow-sales-staging.vercel.app` ni Allowed domains’ga qo‘shib, yangi sessiyada Playwright qismini (A UI, vazn sotuvi UI, 3 rol sahifalari, mobil/desktop) staging’da bajarish.

## Takrorlash

`harness/setup.js` (yangi foydalanuvchilar) → `a-customers.js` → `reset.js` → `finance.js` → `recon.js` → `reset.js` → `post-reset.js` → `sim30.js` → `conc-rls.js` → `reset.js` → `ban-users.js`.
Bloklangan loginlarni qayta yoqish: `node ban-users.js none` (parollar shu konteynerdagi faylda; yangi konteynerda `setup.js` yangi foydalanuvchilar yaratadi).

---

## Yangilanish: brauzer UI auditi staging saytida bajarildi → `UI-README.md`

Staging domeniga ruxsat berilgach, haqiqiy saytda Playwright bilan yakuniy UI tekshiruvlari: **90 ta, 85 PASS, 5 FAIL** (jami urinishlar bilan 111);
UI sessiyasi rekonsilyatsiyasi **26/26, 0.0000 g**. 5 FAIL — F-UI-1 (sotuvchi to‘lov oynasi rasmiy kursni yuboradi, CBU 503 → USD kursi bo‘sh) va
F-UI-3 (kassa qabulida USD kursi majburiy). Hisob buzilmaydi (server rad etadi), lekin sotuvchi kursni qo‘lda kiritmaguncha to‘lov/qabul bo‘lmaydi.
69 ta funksiya tanasi farqi — CRLF, ta’siri yo‘q: `docs/releases/staging-075/FUNCTION-BODY-PARITY.md`. Production preflight: `docs/releases/production-075/`.

**REAL GOLD qarori: LIMITED GO** (shartlar `UI-README.md` va yakuniy hisobotda).
