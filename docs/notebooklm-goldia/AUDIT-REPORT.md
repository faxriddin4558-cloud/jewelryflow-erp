# AUDIT-REPORT — hujjatlarning kodga mustaqil solishtiruvi

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

Hujjatlar yozilgandan keyin ular "mustaqil auditor" sifatida kod, migration va testlarga qaytadan solishtirildi. Production'ga hech qanday so'rov yuborilmadi; hech qanday migration, deploy yoki biznes ma'lumotiga yozuv bajarilmadi.

## 1. Avtomatik tekshiruvlar

| Tekshiruv | Usul | Natija |
|---|---|---|
| Hujjatlardagi har bir funksiya nomi (`rpc_*`, `_goldia_*`, `get_*`, `recalc_*`, `trg_*` ...) | 91 ta migration fayldan olingan 202 funksiya indeksi + jadvallar ro'yxati bilan solishtirish | **0 ta topilmagan nom** |
| Har bir xato kodi (`ERR_*`) | 147 ta `raise exception 'ERR_...'` yozuvi indeksi bilan | **0 ta topilmagan kod** |
| `RPC (NNN)` ko'rinishidagi migration raqamlari | Funksiyaning eng so'nggi ta'rifi bilan | **0 ta nomuvofiqlik** |
| Fayl yo'llari | `os.path.exists` | 2 ta qisqartma yo'l → to'liq yo'llar bilan almashtirildi |
| Qo'shtirnoqdagi UI matnlari (537 ta) | `src/`, migrations va audit hujjatlarida normallashtirilgan qidiruv | 476 to'g'ridan-to'g'ri topildi; 61 tasi qo'lda ko'rildi: ko'pchiligi o'zgaruvchili shablon (kodda tasdiqlandi), mening misol savollarim yoki atamalar; **5 ta haqiqiy noaniqlik tuzatildi** (§3) |
| Privatlik skaneri | Real ismlar/raqamlar (production hisobotlaridagi), email, kalit, `service_role`, loyiha ID'lari | **Topilmadi** |
| Testlar | `npx vitest run` (lokal PGlite, 001→091) | **62 fayl / 521 test PASS** |

## 2. Qo'lda chuqur tekshirilgan qoidalar (namuna)

| Da'vo | Tasdiqlovchi manba |
|---|---|
| Savdo sotuvchi majburiyatini o'zgartirmaydi | `recalc_seller_gold_account` (majburiyat = konsignatsiya + eski qarz + boshlang'ich − topshiruv), 085 hisobot |
| SETTL pulini havzaga to'lov grammi bilan kiritish | `trg_goldia_seller_till_pool` (`till_pool_cash_585_g := cash_equivalent_grams`) |
| Topshiruvda qiymatlangan pul havza grammini yopadi, farq kompaniyaniki | `rpc_record_seller_to_manager_settlement` (085) `v_val_cash_g`, `v_rate_diff_g` |
| Vozvrat qarzni, keyin avansni oshiradi; naqd yo'q | `rpc_record_sale_return` (083) |
| Vozvratda sotuvchi majburiyati o'zgarmaydi | konsignatsiya `seller_obligation_g` yangilanmaydi (083) — dastlabki matn tuzatildi |
| Sotuvchi mijozni faqat o'ziga yaratadi | `rpc_create_customer_with_code` 48–49-qatorlar |
| Arxivlangan mijozga savdo taqiqi xabari | `_goldia_guard_sale_archived_customer` (079) |
| Freeze/draft xabarlari va 12 jadval | `_goldia_guard_opening_draft` (086), migration 085 136–141-qatorlar |
| C2 xatosi va 091 tuzatishi | `rpc_record_factory_gold_handover` (091) + RELEASE-090 §3 |
| Kurs chegaralari (100 000–3 000 000; 5 000–30 000; 25%) | `_goldia_seller_rate_limits` (072) |
| `CompanyRateDifferenceCard` joylashuvi | `DirectorSalesWorkspace.tsx` 1290-qator (faqat `/sales/director` banneri) — dastlabki matn tuzatildi |

## 3. Audit natijasida kiritilgan tuzatishlar

1. `08-returns-reversals.md` — vozvratda "majburiyat yangi dona bo'yicha" degan noaniq ibora → "sotuvchi majburiyati o'zgarmaydi" (kod bo'yicha).
2. `07`, `09`, `18` — `CompanyRateDifferenceCard` "Naqdga Oltin Xarid" sahifasida emas, `/sales/director` bannerida.
3. `07` — factory_settled tugmasi real yorlig'i: "Zavod bilan oldin hisob-kitob qilingan".
4. `07` — `ERR_FINANCIAL_TRANSACTION_IMMUTABLE` o'zgartirishni emas, **o'chirishni** taqiqlaydi.
5. `05`, `12` — topshiruvdagi LOM kursi maydonining to'liq yorlig'i; topshiruv oynasidagi alohida yorliqlar.
6. `07` — 084-izohni iqtibos sifatida emas, bayon sifatida.
7. `01` — sarlavha qismlari alohida ko'rsatildi.
8. `13` — sahifalar soni 22 → 20 (ichki sahifa), komponentlar 30.
9. `10` — "📷 Kamera Skaner" tugmasining to'liq nomi.

## 4. Tasdiqlanmagan (NOT VERIFIED) qismlar

| # | Qism | Sabab |
|---|---|---|
| U1 | Production DB darajasi (088) | Production'ga ulanish taqiqlangan/yo'q; faqat release hisobotlari |
| U2 | P0/P1 UI production'da ekanligi | UI-only release bajarilgani haqida dalil yo'q |
| U3 | Staging darajasi | Hisobotlarda aniq emas |
| U4 | Klassik `/sales` sahifasining moliyaviy ta'siri | Tekshirilmagan (asosiy oqim emas) |
| U5 | Chekni keyinchalik qayta ochish yo'li | Topilmadi |
| U6 | C-03 (lom topshiruvi ustunlari) va C-05 (mahsulot konsignatsiyasi) amaliy ta'siri | Real ma'lumot ko'rilmadi |
| U7 | Playwright e2e testlar | Ishga tushirilmagan (server + DB kerak) |
| U8 | Skrinshotlar 077–085 lokal darajasidan; joriy UI biroz farq qilishi mumkin | Yangi skrinshot olinmadi (DB yo'q) |
| U9 | Production'dagi C2 farqining haqiqiy qiymati | Faqat read-only SQL bilan aniqlanadi (`factory_cards_readonly.sql`) |

## 5. Qamrov ko'rsatkichlari

| Ko'rsatkich | Son |
|---|---|
| Hujjatlashtirilgan sahifalar | 20 ta `/sales/app/*` ichki sahifa + `/sales/app` bosh panel + 4 ta qo'shimcha (`/sales/director`, `/sales/login`, `/sales/mobile`, `/sales`) = **25** (qo'llanmada har biri; `/sales` — qisman) |
| Indekslangan savdo RPC'lari | **94** (fayl:qator, holat, hujjat bo'limi bilan; `18-source-index.md` §4) |
| Tanasi to'liq o'qilgan RPC/funksiyalar | ~30 (savdo, to'lov, topshiruv, konsignatsiya, zavod, xarid, afinaj, kapital, vozvrat, reversal, eski qarz, foyda, davr, yordamchi va guard funksiyalar) |
| Qoidalari/rad etish shartlari skanerlangan qo'shimcha RPC'lar | 22 (reversallar, arxiv, davr, kurslar, tahrir, tuzatish, sanoq, LOM xaridi, tovar qaytarish) |
| Biznes qoidalari | 53 formula/qoida (11) + 15 invariant (17) + 39 huquq qatori (02) |
| Xato kodlari | 105 (`18-source-index.md` §5) |
| Savol-javoblar | **120** (`12-faq-troubleshooting.md`) |
| End-to-end misollar | 10 |
| Qarama-qarshiliklar | 14 (`CONFLICTS.md`) |
| Skrinshotlar | 10 (sintetik) |
