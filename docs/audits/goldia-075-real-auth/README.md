# Goldia Sales 075 — haqiqiy Auth + Playwright bilan A–H audit (lokal PG17 stend)

**Sana:** 2026-11-03 · **Muhit:** lokal, bir martalik: PostgreSQL 17.11 + **haqiqiy GoTrue v2.177 (Supabase Auth)** + PostgREST 12.2.3 + Kong o‘rnidagi gateway
+ shu branch’dan `next build` qilingan frontend. Sxema: staging shaklidagi stand-in 074 → release skripti orqali 075.
**Nega staging emas:** 075 ni staging’ga qo‘llash uchun ruxsat yo‘q (staging hali 074 da, u yerda mijoz yaratish hozir ham buzuq); sessiyada staging anon kaliti va Vercel ruxsati yo‘q.

Loginlar — GoTrue admin API orqali yaratilgan haqiqiy parol bilan kirish (`/sales/login`), sessiya cookie’si, PostgREST’da rol `authenticated` va RLS.
Parollar faqat konteynerdagi `0600` faylda. Har bir kutilgan qiymat skriptning o‘zida mustaqil hisoblanadi va bazadan (service role) tekshiriladi.

## A–H natijalari

| Bosqich | Qanday | Natija |
|---|---|---|
| **A** Mijoz yaratish | **UI** (desktop, mobil 390px, double-click, menejer → sotuvchi C, uzun kod bor org 56) + direct INSERT/UPDATE bypass urinishlari haqiqiy JWT bilan + rol/`p_seller_id` + F-STG-2 | **11/11** (`evidence/A-customers.json`) |
| **B** Zavod kirimi (+ idempotent retry) | API, haqiqiy JWT | PASS |
| **C** Menejer → sotuvchilar (dona bilan) | API | PASS |
| **D** Sotuv: barcode, vazn (dona tanlash), dona tanlanmasa rad, begona dona rad | API + **UI** vazn sotuvi (dona tanlash, double-click → 1 sotuv, aynan tanlangan donadan 1 g) | PASS |
| **E** To‘lovlar: sotuvchi LOM/USD kurslari, so‘m+USD+lom, `ERR_RATE_MISMATCH`, eski qarz | API | PASS |
| **F** Topshiruv: kurs o‘zgargandan keyin, begona kassa rad | API | PASS |
| **G** Xarid (kurs farqi), afinaj, zavodga topshirish, ustama farqi | API | PASS |
| **H** Bekor qilish, qaytarish, nol-reset (rol, kod, faqat o‘z tashkiloti), F-073, izolyatsiya | API | PASS |
| B–H jami (`finance.js`) | | **30/30** |
| Mustaqil rekonsilyatsiya (`recon.js`) | | **14/14, 0.0000 g** |
| Reset ×4, F-073 | | 3/3 ×4, 1/1 |
| UI sahifalari: sotuvchi menyusi (5 bo‘lim), taqiqlangan URL’lar, 5 sahifa × 2 o‘lcham, menejer 7 sahifa, direktor 3 sahifa, refresh, noto‘g‘ri parol | Playwright | **36/36**, xato API chaqiruvi yo‘q |

## Hajmli tekshiruv (`harness/volume.js`)

3 sotuvchi **parallel**, har biri 70 qadam: 075 RPC orqali 24 mijoz (parallel), 6 kirim, 9 partiya (~90 dona), barcode va vazn sotuvlari,
so‘m/USD/lom to‘lovlari o‘zgaruvchan sotuvchi kurslarida, kurs o‘zgarishi, menejer bekor qilishlari, dona qaytarish, topshiruvlar.
Mustaqil model har mijoz (qarz − avans), har sotuvchi (majburiyat, topshirilgan, qarz, qo‘ldagi dona, kassa = 0), har dona,
gramm saqlanishi (qo‘lda + sotilgan + qaytarilgan = berilgan) va menejer (ombor, so‘m, USD, zavod majburiyati) bo‘yicha solishtiriladi.

| Seed | Muvaffaqiyatli yozuv | Kutilmagan xato | Farq | Maks. farq |
|---|---|---|---|---|
| 11 | 247 | 0 | 0 | 0.0000 g |
| 75075 | 248 | 0 | 0 | 0.0000 g |
| 2026 | 243 | 0 | 0 | 0.0000 g |
| 404 | 242 | 0 | 0 | 0.0000 g |
| **Jami** | **980** | **0** | **0** | **0.0000 g** |

Har bir run’da 24/24 mijoz kodi noyob.

### Muvaffaqiyatsiz bo‘lgan qadamlar (yashirilmagan)

1. **`volume-vol1.json` — FAIL (59 farq, 2 xato).** Sabab: harness modeli. (a) sotilgan donalar og‘irligi noto‘g‘ri solishtirilgan;
   (b) kesilgan donadan qilingan vazn sotuvi bekor qilinganda, dona keyinroq to‘liq sotilgan bo‘lsa, tizim qaytgan grammlarni **yangi dona**
   qilib yozadi (`_goldia_restore_weight_sale_allocations`, 073) — model eski donaga qo‘shgan. Bazada grammlar saqlangan; mahsulot xatosi emas.
   Model tuzatildi → `volume-vol2.json` PASS.
2. **`volume-vol-s11.json`, `volume-vol-s11-exact.json` — FAIL (0.0001 g).** Sabab: modeldagi JS float yaxlitlash (`8.165 × 1.13 = 9.22645` → JS `9.2264`,
   PostgreSQL `numeric` → `9.2265`, to‘g‘ri). Ikkinchi fayl tuzatish qo‘llanmasdan ishlagan. Model butun sonli aniq yaxlitlashga o‘tkazildi → yuqoridagi 4 run PASS.
3. Stand-in seed’da 13 ta `rpc_record_gold_purchase` rad etildi (`ERR_INSUFFICIENT_VAULT_CASH`) — kutilgan biznes qoidasi, seed shunday yozilgan.
4. Birinchi release rehearsal `initdb` da to‘xtadi (lokal PG17 vositalarida `postgresql.conf.sample` havolasi buzuq edi) — vosita tuzatildi, staging skriptida o‘zgarish yo‘q.
5. Test yozish paytida topilgan haqiqiy xato: `lpad(...,4)` 10000+ raqamlarni kesardi — 075 ga kiritildi (test: `CUST-9999 → CUST-10000 → CUST-10001`).

## Cheklovlar

- Staging’da emas, staging shaklidagi lokal stend’da (60 tashkilot, 200 login, ekilgan `CUST-T056_1793002353699`). Staging’da A–H ni takrorlash 075 qo‘llangandan va frontend deploy’dan keyin mumkin.
- B, C, E, F, G, H UI orqali emas, UI chaqiradigan aynan shu RPC’lar orqali haqiqiy JWT bilan bajarildi; UI orqali: A, D (vazn sotuvi), sahifalar.
