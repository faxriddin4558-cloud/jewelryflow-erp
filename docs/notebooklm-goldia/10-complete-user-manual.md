# 10. To'liq foydalanuvchi qo'llanmasi (sahifama-sahifa)

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.
> Belgilar: **[PROD]** — production'da (≤088); **[089]/[090]/[091]** — kodda bor, production'ga deploy qilinmagan.

## 0. Kirish va umumiy elementlar

**Kirish:** `/sales/login` → email va parol → "Tizimga Kirish →". Chiqish: chap kartadagi 🚪 yoki yuqoridagi "🚪 Chiqish".
**Chap panel:** foydalanuvchi kartasi (ism, email, rol belgisi, "Onlayn"), **"Bugungi Lom (585)"** kartasi (kurs yoki "Kurs belgilanmagan"; management uchun "⚙️ Kurs"), menyu guruhlari, pastda "Goldia Sales • 2026".
**Ogohlantirish chiziqlari:** internet yo'q — *"Internet aloqasi yo'q! Moliyaviy xavfsizlik uchun yozish amallari faqat onlayn rejimda ishlaydi."*; test muhitida — "STAGING DEMO · Alohida Staging Muhiti • Faqat sun'iy test ma'lumotlari • Real productionga bog'lanmagan".
**Telefonda:** "☰" menyuni ochadi.
**Kursni o'zgartirish [PROD]:** "⚙️ Kurs" → yangi qiymat → "Saqlash" (`rpc_set_daily_gold_rate`, proba 585, bugungi Toshkent sanasi). Xato bo'lsa: "Kursni saqlab bo'lmadi: ...".

---

## 1. 📊 Asosiy Panel — `/sales/app` [PROD]
- **Kim:** hamma (sotuvchi o'z paneli — `SellerDashboard`).
- **Menejer:** 6 karta + tezkor tugmalar + foyda banneri + "Batafsil" bo'limi (`09-dashboard-reports.md` §1).
- **Sotuvchi:** Mening bozor qarzim, mijozlarim qarzi, tovarim, kassam, ustama farqim, bugungi savdo/kurslar, tezkor tugmalar.
- Ruxsatsiz sahifaga urinilsa shu yerga `?unauthorized=1` bilan qaytadi.

## 2. 🏭 Zavod Bilan Hisob — `/sales/app/factory` [PROD; 090 qismlari deploy qilinmagan]
- **Kim:** Director, Production Manager, manager.
- **Bo'limlar:** "Hammasi" / "📥" (qabul) / topshirish. Kartalar (Zavoddan olingan tovar, majburiyat, berilgan oltin, joriy qoldiq).
- **Amallar:** "📥 Zavoddan Tovar Qabul Qilish"; "📤 Zavodga Oltin Topshirish & Qarzni Kamaytirish"; ro'yxatlar "Zavoddan Kelgan Tovarlar Ro'yxati" va "Zavodga Topshirilgan Oltinlar Tarixi (Qarz Qoplamasi)" — har birida bekor qilish (tarqatilgan kirim: "🔒 Tarqatilgan").
- **[090]** "↩️ Menejer omboridan zavodga tovar qaytarish".
- Batafsil: `07-factory-manager-accounting.md` §2–4, §8.

## 3. 🏦 Boshqaruvchi Ombori — `/sales/app/inventory` [PROD]
- Partiyalar/donalar/jamlangan ko'rinish; filtrlar; donani "Menejerga Qaytarish" → "Tasdiqlash & Qaytarish". `06` §2, §6.

## 4. 📟 Scanner 564 Tarqatish — `/sales/app/consignments` [PROD]
1. Sotuvchini tanlang. 2. Zavod ustamasi (6/8/10% yoki aniq). 3. Sotuvchi ustamasi (12%). 4. Kirim (FIFO yoki aniq). 5. Skanerlang (yoki ro'yxatdan model tanlang). 6. Katakchani belgilang. 7. "✓ Konsignatsiyani Tasdiqlash". Natija: chek ("Zavod Skaner Konsignatsiya Cheki"), sahifa ombor ko'rinishiga o'tadi. Xato bo'lsa skaner qoralamasi saqlanib qoladi. `06` §3.

## 5. 👥 Sotuvchilar & Bozor Qarzi — `/sales/app/sellers` [PROD; P0 tartib NOT VERIFIED]
- Har sotuvchi kartasi: Bozor qarzi (±), ombor, kassadagi LOM/so'm/$.
- **Kassani qabul qilish:** karta tugmasi → "Boshqaruvchiga Tushumni Qabul Qilish" → lom, so'm, $, LOM kursi (faqat qiymatlanmagan pul uchun), USD kursi, izoh → "Qabul Qilish & Chek". `05` §5.
- **[089]** "🧮 Kassa sanog'i".
- Sotuvchi solishtirma hisoboti (rekonsilyatsiya oynasi) → "Yopish".
- Yig'ma: "Sotuvchilar kurslari", "Operatsiya kurslari tekshiruvi" (filtr "Faqat saqlangan kursdan farqli", "Yangilash").

## 6. 📦 Ombor harakati — `/sales/app/stock-movements` [089]
Sotuvchi/sana filtri → "Yangilash". Faqat o'qish. `06` §8.

## 7. ⚡ Skaner Savdo — `/sales/app/scan` [PROD]
- Tablar: skaner savdo, donalar (vitrina), ombor (partiyalar).
- Qadamlar: "📷 Kamera Skaner" yoki Scanner 564 → vazn shtrix-kodi → topilgan dona → "Xaridor Mijozni Tanlang *" → foiz (preset tugmalari) → izoh → "⚡ Savdoni Tasdiqlash va Chek Berish".
- Vitrinada: "↩️ Qaytarish" (menejerga), "⚡ Sotish".
- Havola: "⚖️ Vazn bo'yicha savdo → Mijozlar". `03` §2.

## 8. 🛍️ Mijozlar va Nasiya — `/sales/app/customers` [PROD; 089/090 tugmalari deploy qilinmagan]
- **Sotuvchi** yuqorida tablar: "📒 Mijozlar daftari", "💰 To'lov olish", "🏷️ Nasiya savdo", "📋 Qarzlar" ("Qarz Daftari (Kim qancha berishi kerak)", "Mijoz Avanslari (Ortiqcha To'lovlar)"), "➕ Yangi mijoz".
- **Mijozlar daftari** (hamma): 👤 Mijozlar Ro'yxati / 📑 Kunlik Savdo Jurnali / 📊 Oylik Hisobot.
- Mijoz qatorida: 📋 Eski qarz · + Nasiya · 💰 To'lov · 💵 Valyuta qarzi / to'lov · 🗑️ Mijozni o'chirish (♻️ Tiklash) · [089] ↩️ Eski savdo vozvrati.
- Jurnal qatorida: ↩️ Vozvrat · [089] 💱 Valyutani tuzatish · [090] ✏️ Tahrirlash · ↩️ Bekor qilish.
- **Savdo qilish:** "+ Nasiya" → "Gramm + %" / "Aniq UZS" / "Aniq USD" → (Gramm+%: "⚖️ Vazn Bo'yicha" yoki "🏷️ Mahsulot Kodi Bo'yicha") → vazn/dona, foiz, izoh → "Nasiyani Rasmiylashtirish". "Jonli Savdo Hisob-Kitobi" bloki: mahsulot vazni, mijozga hisoblanadigan qarz, sotuvchining yangi ombor qoldig'i.
- **585 to'lov:** "💰 To'lov" → lom (g, proba), so'm, $, kurslar, izoh → "To'lovni Tasdiqlash".
- **Valyuta to'lovi:** "💵 Valyuta qarzi / to'lov" → UZS/USD tab → summalar, kurslar → "To'lovni saqlash".
- Batafsil: `03`, `04`, `05`, `08`.

## 9. 💰 Kassa & Valyuta — `/sales/app/cash` [PROD; 091 qismi deploy qilinmagan]
"Kassa & Seyf Balansi — Menejer va sotuvchilar kassalaridagi fizik lom oltin va naqd UZS qoldiqlari." Seyf bo'limlari: "💰 Kassa", afinaj, xaridlar. **[091]** "🪙 Bozordan LOM xarid qilish" (menejer sotuvchini tanlaydi).

## 10. 🏦 Kassam (sotuvchi) — `/sales/app/kassam` [PROD; 091 qismi deploy qilinmagan]
"Mening kurslarim" (LOM, USD → "Kursni saqlash"), "Mening Kassam va Bozor Qarzi (Boshqaruvchi Oldidagi Majburiyat)" (Bozor Qarzi, Kassamdagi Lom, Naqd (UZS), Naqd (USD), Fizik Oltin Qoldig'i, "Oxirgi Savdolarim Tarixi"), **[091]** LOM xaridi, "Boshqaruvchiga topshirishlar" ro'yxati (`STL-MGR-...`, sana, so'm/$/lom → yopilgan gramm; bekor qilingani chizilgan). Menejer ochsa: "Bu sahifa sotuvchining o'z kassasi uchun..." va Kassa & Valyuta havolasi.

## 11. 📈 Ustama Farqi — `/sales/app/markup` [PROD]
`09` §6.

## 12. ⚗️ Afinaj / Lom Pateriya — `/sales/app/refining` [PROD]
"Afinaj (Eritish & Qayta Ishlash)" formasi → "🔬 Afinaj Partiyasini Saqlash (Pateriya Qayd Qilish)"; "Afinaj Partiyalari Ro'yxati ("Lom pateriya")" bekor qilish bilan. `07` §6.

## 13. 🪙 Naqdga Oltin Xarid — `/sales/app/purchases` [PROD]
"Tovar Olish (Naqdga Oltin Xarid Qilish)" → "💵 Oltin Xaridini Qayd Etish"; "Oltin Xaridlari Tarixi ("Tovar olish")". `07` §5.

## 14. 🗓️ Davriy Hisobot — `/sales/app/period-report` [PROD]
`09` §4.

## 15. 🧾 Boshlang'ich hisob — `/sales/app/opening` [PROD (085–088)]
Restart (direktor), hujjat qo'shish ("Kiritish"), ro'yxat ("Bekor", B uchun factory_settled tugmasi), solishtirish va "Boshlang'ich hisobni tasdiqlash va qulflash". `07` §9.

## 16. 📑 Moliyaviy Hisobotlar — `/sales/app/reports` [PROD]
`09` §8.

## 17. 🏷️ BarTender & Modellar — `/sales/app/models` [PROD]
Model qo'shish (kod, nom, kategoriya), rasm, QR. `06` §9.

## 18. 👤 Xodimlar & Telegram — `/sales/app/users` [PROD]
Xodimlar ro'yxati, Telegram bog'lash (`rpc_generate_telegram_link_code`, `rpc_verify_and_link_telegram`, `rpc_unlink_telegram`), yangi xodim (`/api/sales/employees/create`).

## 19. ⚙️ Sozlamalar & Import — `/sales/app/settings` [PROD]
Tablar: "⚙️ Dinamik Foizlar" (ustama presetlari: "Zavod Ustamalari (Factory Markups)", "Mijozga Sotish Ustamalari (Client Markups)", "+", "✏️", faol/nofaol), "📥 Sheets Import" (Google Sheets tarixiy import, `rpc_execute_sheets_historical_import`), "🧹 Sinov Tozalash" — **faqat staging rejimida** ko'rinadi (085: production'da hech qachon).

## 20. Yashirin/qo'shimcha sahifalar
- `/sales/app/factory-receive` — "Zavoddan Tovar Qabul Qilish" (tezkor tugmadan).
- `/sales/app/handovers` — "Zavodga Oltin Topshirish".
- `/sales/director` — "Direktor Savdo & Konsignatsiya Paneli" (barcha tablar: Zavod, Sotuvchilar, Seyf, Scanner, Ombor, Modellar, Mahsulot Topshirish, Presetlar, Mijozlar, Tarix, Xodimlar, Sheets, Diagnostika); "← Savdo Bosh Sahifasi", "📱 Sotuvchi Mobil Paneli", "🏪 Klassik Vitrina".
- `/sales` — klassik vitrina/POS ko'rinishi (Direktor / Sotuvchi mobil / Klassik POS almashtirgichi). **Izoh:** asosiy ish oqimi `/sales/app`; klassik sahifaning moliyaviy hisobga ta'siri bu hujjatda tekshirilmagan — NOT VERIFIED.
- `/sales/mobile` — eski URL, Skaner Savdo'ga yo'naltiradi.

## 21. Kunlik ish tartibi (tavsiya, kod oqimiga asoslangan)
1. Ertalab: menejer "⚙️ Kurs" bilan LOM kursini kiritadi; sotuvchilar "Mening kurslarim"ni tekshiradi.
2. Zavoddan tovar kelsa: "Zavoddan kirim" → Scanner 564 bilan sotuvchilarga tarqatish.
3. Kun davomida: sotuvchi savdo (skaner yoki vazn), to'lov olish (SETTL/CPAY).
4. Kechqurun: menejer sotuvchi kassasini qabul qiladi (Sotuvchilar sahifasi).
5. Lom yig'ilsa: afinaj → zavodga topshirish.
6. Davr oxirida: Davriy hisobot → CSV → "Yangi davrni boshlash".
