# Goldia Sales — NotebookLM bilim bazasi

> **Tekshiruv pasporti**
> - Kod: Git commit `052ad17` — branch `claude/goldia-sales-staging-audit-qtrq1d` (2026-11-19 12:11 UTC). Hujjatlar shu kod ustida, alohida branch'da (`claude/goldia-notebooklm-docs-2t12zc`) faqat `docs/notebooklm-goldia/` papkasi qo'shilgan.
> - Schema: migration `20260101000091` (kodda eng so'nggi).
> - Production: **088** — release hisobotlari bo'yicha (`docs/audits/goldia-077/RELEASE-089-REPORT.md`, `RELEASE-090-REPORT.md`, `RELEASE-091-REPORT.md`). Bu ish davomida production'ga **ulanilmagan** (strict read-only); shuning uchun production darajasi **NOT VERIFIED**.
> - Testlar: lokal `npx vitest run` — **62 fayl / 521 test PASS** (2026-11-19).
> - Maxfiylik: real mijoz ismlari, telefonlar, tranzaksiyalar, qoldiqlar, kalitlar va parollar **ko'chirilmagan**; barcha misollar sintetik. Skrinshotlar lokal test muhitidan (sintetik "AUDIT"/"RR84"/"RT83" foydalanuvchilar).

## 1. Fayllar

| Fayl | Mazmuni |
|---|---|
| `01-overview.md` | Ilova nima, qarz zanjiri, birliklar, menyu xaritasi, hujjat prefikslari, production/deploy holati |
| `02-roles-permissions.md` | Rollar, sotuvchi cheklovlari, amallar bo'yicha huquqlar jadvali (database bo'yicha) |
| `03-sales.md` | 4 xil savdo: vazn, dona (skaner), so'm/dollar narx, partiya; formulalar va xatolar |
| `04-customer-debts.md` | Mijoz balansi modeli (585/UZS/USD), avans, Mijozlar sahifasi, yangi mijoz, arxiv, eski qarz, boshlang'ich qarz |
| `05-payments-currency-lom.md` | 585 proba, LOM, SETTL, CPAY, USD/UZS konvertatsiya, kassa topshiruvi, havza, kurslar, LOM xaridi, kassa sanog'i, valyuta tuzatish |
| `06-inventory-consignment.md` | Menejer/sotuvchi ombori, Scanner 564 tarqatish, donalar, qaytarish, konsignatsiya reversali, ombor harakati |
| `07-factory-manager-accounting.md` | Zavod kirimi va topshirish, C2 xatosi, kartalar, xarid, afinaj, kapital/xarajat, zavodga tovar qaytarish, boshlang'ich hisob/restart/freeze |
| `08-returns-reversals.md` | Barcha bekor qilish va vozvratlar — ta'sirlangan hisoblar jadvallari bilan |
| `09-dashboard-reports.md` | Asosiy panel, sotuvchi paneli, Bozor qarzi, davriy hisobot, foyda formulasi, ustama farqi |
| `10-complete-user-manual.md` | Sahifama-sahifa qo'llanma (20+ sahifa), kunlik ish tartibi |
| `11-business-formulas.md` | 53 ta formula/qoida, har biri sonli misol va manba bilan |
| `12-faq-troubleshooting.md` | **120 ta savol-javob** + muammolarni hal qilish jadvali |
| `13-technical-architecture.md` | Texnologiyalar, kod tuzilmasi, jadvallar, xavfsizlik mexanizmlari |
| `14-releases-and-known-limitations.md` | Production darajasi dalillari, migratsiyalar xronologiyasi, ma'lum muammolar va cheklovlar |
| `15-glossary.md` | Lug'at (ilovadagi real atamalar) |
| `16-end-to-end-business-examples.md` | 10 ta to'liq sintetik misol (zanjir, valyuta, bekor qilish, vozvrat, F qarz, foyda, ustama farqi) |
| `17-verified-test-scenarios.md` | Ishga tushirilgan testlar natijasi, ssenariylar, 15 ta biznes invariant |
| `18-source-index.md` | Savol → hujjat → kod xaritasi; sahifa → komponent → RPC; **94 ta savdo RPC** indeksi; xato kodlari |
| `CONFLICTS.md` | 14 ta qarama-qarshi/noaniq qoida (tuzatilmagan, egasining qarori kerak) |
| `AUDIT-REPORT.md` | Mustaqil auditor tekshiruvi: nima tekshirildi, nima tuzatildi, nima tasdiqlanmagan |
| `screenshots/` | 10 ta sintetik skrinshot |
| `bundles/` | NotebookLM'ga yuklash uchun 7 ta birlashtirilgan PDF (va ularning Markdown manbalari) |

## 2. Muhim biznes savoliga javob qayerda?

| Savol | Fayl |
|---|---|
| "Mijoz qarzi qanday hisoblanadi?" | 03 §1, 04 §1, 11 §D |
| "Mijoz dollarda to'lasa nima bo'ladi?" | 05 §3–4, 11 §E |
| "585 proba / LOM / fizik vazn nima?" | 05 §1, 15 |
| "Sotuvchining majburiyati (Bozor qarzi) qanday?" | 06 §3, 09 §3, 11 §C |
| "Kassa topshirishda kurs o'zgarsa?" | 05 §5, 16 Misol 1 |
| "Savdo bekor qilinsa qaysi hisoblar o'zgaradi?" | 08 §1, 16 Misol 3 |
| "To'lov qaytarilsa (bekor qilinsa)?" | 08 §4, 16 Misol 8 |
| "Konsignatsiya reversalida nima bo'ladi?" | 06 §7, 08 §5, 16 Misol 5 |
| "Zavod qarzi va avansi qanday?" | 07 §2–4 |
| "Foyda qanday hisoblanadi?" | 09 §5, 16 Misol 9 |
| "Bu funksiya production'da bormi?" | 01 §7, 14 |
| "Bu tugma qayerda / nima qiladi?" | 10, 18 §2 |
| "Bu xato nimani bildiradi?" | 12, 18 §5 |

## 3. NotebookLM'ga nima yuklash kerak

**Tavsiya (eng qulay): `bundles/` papkasidagi 7 ta PDF:**
1. `bundles/01-umumiy-rollar-qollanma.pdf` — 01, 02, 10, 15
2. `bundles/02-savdo-mijozlar.pdf` — 03, 04
3. `bundles/03-tolov-valyuta-lom.pdf` — 05
4. `bundles/04-ombor-zavod-boshlangich.pdf` — 06, 07
5. `bundles/05-bekor-qilish-hisobotlar.pdf` — 08, 09
6. `bundles/06-formulalar-misollar-faq.pdf` — 11, 16, 12
7. `bundles/07-texnik-versiyalar-testlar-manbalar.pdf` — 13, 14, 17, 18, CONFLICTS, AUDIT-REPORT, README

PDF'lar skrinshotlarni o'z ichiga oladi. Agar NotebookLM PDF'ni yaxshi o'qimasa — xuddi shu tarkibdagi `bundles/*.md` fayllarini yuklang (Markdown, rasmsiz). Yoki barcha 21 ta `.md` faylni alohida yuklash mumkin (NotebookLM manbalar soni chegarasiga e'tibor bering).

## 4. Belgilar

- **[089] / [090] / [091]** yoki "deploy qilinmagan" — kodda bor, production'da hali yo'q.
- **NOT VERIFIED** — kod/test bilan tasdiqlab bo'lmagan da'vo.
- **Manba** — `fayl:qator`, RPC nomi (eng so'nggi migration raqami qavsda) yoki test nomi.
