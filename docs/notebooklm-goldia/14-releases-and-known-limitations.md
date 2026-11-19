# 14. Versiyalar (release) va ma'lum cheklovlar

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

## 1. Production'ning tasdiqlanish darajasi

| Da'vo | Dalil | Holat |
|---|---|---|
| Production DB = 088 | `RELEASE-091-REPORT.md` sarlavhasi "production 088 → 089 → 090 → 091 in one release"; `RELEASE-089-REPORT.md` "DB 088 → 089"; commit `f6fedcc` (egasining 089 release logi: backup paytida production'da yozuv bo'lgani uchun NO-GO) | Hujjatlar bo'yicha; **to'g'ridan-to'g'ri NOT VERIFIED** (bu sessiya production'ga ulanmaydi) |
| 089 production'da yo'q | `f6fedcc` NO-GO; keyingi hisobotlar ham 088 dan release rejalashtiradi | Hujjatlar bo'yicha |
| P0/P1 UI (`28cf104`, `3d87193`) production'da | `b64b76d` UI-only rejim qo'shilgan; bajarilgani haqida hisobot topilmadi | **NOT VERIFIED** |
| Staging darajasi | 090/091 E2E "locally (on 091)", "runs on real staging after the staging release" | **NOT VERIFIED** |

## 2. Migratsiyalar xronologiyasi (Goldia savdo qismi)

| Migration | Mazmun (qisqa) |
|---|---|
| 026–029 | Savdo, konsignatsiya, oltin daftari, ustama presetlari, shtrix-kod donalar, reversallar |
| 032–042 | Sheets pariteti (zavod, xarid, afinaj), rollar/Telegram, dona darajasidagi ombor, xavfsizlik |
| 043–050 | Goldia moliyaviy parite, ko'p valyuta, seyf va kassalar, foyda va baseline, davr qulfi |
| 051–064 | Eski qarz, universal reversallar, skaner vazn modeli, FIFO, kapital, zavod avansi, oylik hisobot, audit tuzatishlari |
| 065 | Blocker/high audit tuzatishlari (foiz majburiy, sotuvchi faqat o'z kassasi, rasmiy kurs) |
| 066 | Kompaniya kurs farqi daftari |
| 067 | Ustama farqi ("Ustama farqi") |
| 068 | Vazn savdosi donalari va zavod hisoblagichlari |
| 069 | Anonim RPC kirishini yopish |
| 070 | Qabul auditi tuzatishlari |
| 071 | Sotuvchi seyf/kompaniya omborini ko'rmaydi |
| 072 | Sotuvchining mustaqil kurslari, qiymatlangan kassa havzasi |
| 073–075 | Release candidate, tashkilot izolyatsiyasi, mijoz kodlari |
| 076 | Eski qarz menejer va sotuvchi uchun, dona tanlash ixtiyoriy |
| 077 | Menejer = direktor, valyuta savdolari, davriy hisobot |
| 078–079 | Mijoz arxivi, davrni qayta ochish, arxivlangan mijozga savdo taqiqi |
| 080–082 | Hisobot tezligi, sotuvchi eski avansi, oylik hisobot ishorali balans |
| 083 | Qisman vozvratlar |
| 084 | Operatsiya kurslari va valyuta baholash |
| 085 | Moliyaviy restart va boshlang'ich hisob |
| 086–087 | Moliyaviy freeze, backup freeze ichida |
| **088** | factory_settled, kurssiz F qarzlar — **production darajasi** |
| 089 | Eski savdo vozvrati, CPAY jurnal, valyuta tuzatish, kassa sanog'i, ombor harakati — *deploy qilinmagan* |
| 090 | Konsignatsiya bekor qilish (taqsimot), zavodga tovar qaytarish, savdo tahriri, sotuvchi bekor cheklovi — *deploy qilinmagan* |
| 091 | Zavod topshiruvi C2 tuzatish, sotuvchi LOM xaridi — *deploy qilinmagan* |

## 3. Production (088) da ma'lum muammolar (tuzatish deploy qilinmagan)

| # | Muammo | Tuzatish | Manba |
|---|---|---|---|
| L1 | Zavodga oltin topshirish `total_factory_handed_over_g` ni topshiruvlar yig'indisiga tenglaydi — boshlang'ich C2 (va C) zavod hisobidan tushadi | 091 (eski qiymatlar tuzatilmaydi) | RELEASE-090 §3, RELEASE-091 §1 |
| L2 | Konsignatsiyani bekor qilish: ko'p kirimli FIFO'da noto'g'ri kirimga qaytarish, vozvratni ikki marta ayirish, davr hisobotida ikki marta sanash, sotuvchi hisobini yangilamaslik, B konsignatsiyani bekor qilish | 090 | RELEASE-090 §1b |
| L3 | Noto'g'ri valyutadagi to'lovni tuzatish uchun ikki alohida amal (bekor + qayta) | 089 | RELEASE-089 |
| L4 | T0 dan oldin sotilgan tovar qaytsa yozish yo'li yo'q | 089 | RELEASE-089 |
| L5 | Menejer omboridan zavodga tovar qaytarish RPC'si yo'q | 090 | RELEASE-090 §1c |
| L6 | Savdoni tahrirlash yo'q (faqat bekor + qayta) | 090 | RELEASE-090 §1d |

## 4. Kod darajasidagi cheklovlar (091 da ham)

- **Rasmiy kurs tarixiy emas:** foyda va baholash joriy/kiritilgan kurs bilan; kurs `daily_gold_rates` ning eng so'nggi (tasdiqlangan) qiymati.
- **Foyda faqat "jonli":** kelajak sanasi bilan foyda so'ralsa — `unsupported_pilot_period` ("Pilot davrida faqat bugungi kungacha..."). Savdo marjasi va kurs farqi alohida ajratilmagan ("pilot_notice").
- **Xarajat faqat menejer kassasidan** (sotuvchi kassasidan chiqim yo'q).
- **Faqat 585 tayyor mahsulot:** boshqa probadagi tayyor mahsulot kirim qilinmaydi.
- **Dona vazni ≤ 1000 g.**
- **Klassik `/sales` sahifasi** — moliyaviy ta'siri bu hujjatda tekshirilmagan (NOT VERIFIED).
- **Takroriy eski qarz** 10 daqiqa oynasi bilan cheklanadi; boshqa takroriy holatlar idempotentlik kaliti bilan.
- **Ombor harakati sahifasi** faqat ko'rsatadi, tuzatmaydi (089).
- **Kunlik kurs** UI'da faqat proba 585 uchun.

## 5. 089/090/091 ni production'ga chiqarish (egasining rejasi, hujjatdan)

Staging release (egasi, Windows PowerShell) → staging tekshiruvi → direktorning alohida yozma roziligi → to'liq production release (`-UiOnly` emas): prelaunch 088 → backup + zanjir 088→091 + postflight → frontend → production-post → read-only smoke. Rollback: `rollback_0xx_with_history.sql` (yangi hujjat yo'q bo'lsa). *Manba: RELEASE-089 §5, RELEASE-091.*
