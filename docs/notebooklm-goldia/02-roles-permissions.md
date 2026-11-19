# 02. Rollar va huquqlar

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.

## 1. Ikki qatlamli himoya

1. **UI qatlami** (faqat ko'rinish): `src/lib/sales-role-access.ts`. Fayl boshidagi izoh: *"This only shapes the UI; the database (RLS and SECURITY DEFINER role guards) is the authority"*.
2. **Database qatlami** (haqiqiy hakam): har bir RPC `SECURITY DEFINER` bo'lib, ichida `assert_erp_permission(array[...])` yoki `_goldia_is_seller_role(...)` / `_goldia_is_management_role(...)` tekshiruvi bor; jadvallarda RLS.

`assert_erp_permission` (migration 016): foydalanuvchi tizimga kirgan bo'lishi, `employees` jadvalida faol (`is_active`, status `active`/`faol`) profili bo'lishi va roli ruxsat etilgan ro'yxatda bo'lishi shart; aks holda `Permission denied ...` (kod `42501`).

## 2. Rol tokenlari

| Guruh | Tokenlar (kodda) | Manba |
|---|---|---|
| Direktor | `director`, `admin`, `owner`, `direktor`, `rahbar` | `DIRECTOR_ROLE_TOKENS` |
| Menejer (management) | yuqoridagilar + `production manager`, `production_manager`, `manager`, `boshqaruvchi` | `MANAGEMENT_ROLE_TOKENS` |
| Sotuvchi | `seller`, `sales`, `sotuvchi` | `SELLER_ROLE_TOKENS` |
| Buxgalter (cheklangan) | `accountant`, `buxgalter` | ayrim RPC ro'yxatlarida (masalan `rpc_record_client_settlement`, `rpc_set_daily_gold_rate`, `rpc_record_factory_receipt`) |

**Muhim qaror (077, 2026-11-05):** *"director and production manager have the SAME rights in Goldia Sales"* (`sales-role-access.ts`). Test: `goldia-077-parity-currency-report.test.ts` → "A: the manager can do what was director-only (accounting baseline, reclassification, presets, product consignment)".

**Yagona istisno:** moliyaviy hisobni qayta boshlash (`rpc_financial_restart`) — *"only the director (owner / admin) restarts the books - not the manager"* (migration 085/091, funksiya ichidagi izoh).

## 3. Sotuvchi ko'ra oladigan sahifalar

`isRouteAllowedForSeller` (`sales-role-access.ts`):
- Aniq: `/sales/app`, `/sales/mobile`
- Prefiks: `/sales/app/scan`, `/sales/app/customers`, `/sales/app/kassam`, `/sales/app/markup`, `/sales/mobile/`, `/sales/login`

Boshqa sahifani ochsa, `layout.tsx` uni `/sales/app?unauthorized=1` ga qaytaradi va bannerda: *"🛡️ Ruxsat cheklangan: bu sahifa faqat Direktor va Boshqaruvchi uchun."* Sotuvchi `/sales/app`dan tashqari ERP sahifalariga kirsa ham Goldia Sales'ga qaytariladi (`shouldSendSellerToSalesApp`).

Sotuvchi kursni ("⚙️ Kurs" tugmasi) ko'rmaydi: `{!isSeller && (<button>⚙️ Kurs</button>)}`.

## 4. Amallar bo'yicha huquqlar jadvali (database bo'yicha tekshirilgan)

Belgilar: ✅ ruxsat, ❌ rad, ⚠️ shartli.

| Amal | RPC | Direktor | Menejer | Sotuvchi | Shart / izoh |
|---|---|---|---|---|---|
| Vazn bo'yicha savdo | `rpc_record_weight_sale` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z nomidan, o'z yoki biriktirilmagan mijozga (076) |
| Dona (shtrix-kod) savdo | `rpc_record_barcode_piece_sale` | ✅ | ✅ | ⚠️ | "Sotuvchi faqat o'z nomidan sotuv qila oladi" |
| So'm/dollar narxdagi savdo | `rpc_record_currency_sale` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z omboridan |
| Savdoni bekor qilish | `rpc_reverse_client_sale` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z savdosini; 090'dan: o'zi kiritgan, keyin to'lov bo'lmagan, davr ochiq |
| Vozvrat (qaytarish) | `rpc_record_sale_return` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z savdosidan; "Menejer qabul qiladi" faqat management |
| Savdoni tahrirlash *(090)* | `rpc_edit_client_sale` | ✅ | ✅ | ⚠️ | Sotuvchi: o'z, o'zi kiritgan, to'lovsiz, vozvratsiz, ochiq davr |
| 585 qarzga to'lov (SETTL) | `rpc_record_client_settlement` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z kassasiga, o'z mijoziga; buxgalter ham ✅ |
| SETTL bekor qilish | `rpc_reverse_client_settlement` | ✅ | ✅ | ❌ | |
| So'm/USD qarzga to'lov (CPAY) | `rpc_record_client_currency_settlement` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z kassasiga |
| CPAY bekor qilish | `rpc_reverse_client_currency_settlement` | ✅ | ✅ | ❌ | |
| To'lov valyutasini tuzatish *(089)* | `rpc_correct_client_payment` | ✅ | ✅ | ❌ | Ichida bekor qilish RPC'si chaqiriladi (o'z huquq tekshiruvi bilan); UI faqat management'ga ko'rsatadi |
| Kassa topshiruvini yozish | `rpc_record_seller_to_manager_settlement` | ✅ | ✅ | ⚠️ | Database sotuvchiga faqat o'z kassasini ruxsat beradi; UI'da topshiruvni **menejer** yozadi ("Topshirishni boshqaruvchi qabul qilib yozadi" — `kassam/page.tsx`) |
| Topshiruvni bekor qilish | `rpc_reverse_seller_to_manager_settlement` | ✅ | ✅ | ❌ | |
| Kassa sanog'i *(089)* | `rpc_record_seller_till_count` | ✅ | ✅ | ❌ | |
| Bozordan LOM xaridi *(091)* | `rpc_record_seller_lom_purchase` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z kassasidan |
| Yangi mijoz | `rpc_create_customer_with_code` | ✅ | ✅ | ✅ | Sotuvchi mijozni faqat o'ziga biriktiradi |
| Mijozni arxivlash/tiklash | `rpc_archive_customer` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'z mijozini (078) |
| Mijozni boshqa sotuvchiga o'tkazish | to'g'ridan-to'g'ri yozish | ✅ | ✅ | ❌ | `_goldia_guard_customer_assignment` (079) |
| Eski qarz kiritish | `rpc_record_client_legacy_debt` | ✅ | ✅ | ⚠️ | Sotuvchi: faqat o'z mijoziga qarz **qo'shish**; avans faqat qarzi yo'q mijozga (081); kamaytirish — faqat management |
| Eski qarzni bekor qilish | `rpc_reverse_client_legacy_debt` | ✅ | ✅ | ❌ | buxgalter ✅ |
| Eski savdo vozvrati *(089)* | `rpc_record_opening_sale_return` | ✅ | ✅ | ❌ | |
| Zavoddan kirim | `rpc_record_factory_receipt` | ✅ | ✅ | ❌ | buxgalter ✅; "Sotuvchi ... zavod tovar kirimini saqlay olmaydi" |
| Sotuvchiga tarqatish (skaner) | `rpc_issue_barcode_consignment` | ✅ | ✅ | ❌ | `inventory_manager` ham ✅ |
| Mahsulot (dona) konsignatsiyasi | `rpc_issue_seller_consignment` | ✅ | ✅ | ❌ | UI'da `canDirect` |
| Donani menejerga qaytarish | `rpc_return_piece_to_manager` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'ziga biriktirilgan, sotilmagan donani |
| Zavodga oltin topshirish | `rpc_record_factory_gold_handover` | ✅ | ✅ | ❌ | buxgalter ✅ |
| Menejer → zavodga tovar qaytarish *(090)* | `rpc_return_goods_to_factory` | ✅ | ✅ | ❌ | |
| Naqdga oltin xarid | `rpc_record_gold_purchase` | ✅ | ✅ | ❌ | buxgalter, inventory_manager ✅ |
| Afinaj | `rpc_record_refining_batch` | ✅ | ✅ | ❌ | |
| Kapital / xarajat | `rpc_record_financial_transaction` | ✅ | ✅ | ❌ | |
| Kunlik LOM kursi | `rpc_set_daily_gold_rate` | ✅ | ✅ | ❌ | buxgalter ✅ |
| O'z kurslarini belgilash | `rpc_set_my_seller_rates` | ❌ | ❌ | ✅ | "kursni faqat sotuvchi o'zi uchun belgilaydi" (072) |
| Ustama presetlari | `rpc_manage_sales_markup_preset` | ✅ | ✅ | ❌ | |
| Hisobot davrini yopish/qayta ochish | `rpc_close_report_period` / `rpc_reopen_report_period` | ✅ | ✅ | ❌ | Faqat oxirgi davr qayta ochiladi |
| Davriy hisobot | `rpc_get_period_report` | ✅ | ✅ | ❌ | `_goldia_is_management_role` |
| Ombor harakati *(089)* | `rpc_get_seller_stock_movements` | ✅ | ✅ | ⚠️ | Sotuvchi faqat o'zini ko'radi (sahifa esa menyuda faqat management'da) |
| Boshlang'ich hujjat | `rpc_record_opening_document` | ✅ | ✅ | ❌ | Faqat draft davrda |
| Moliyaviy restart | `rpc_financial_restart` | ✅ | ❌ | ❌ | Faqat direktor |
| Baseline tasdiqlash | `rpc_confirm_accounting_baseline` | ✅ | ✅ | ❌ | |

## 5. Sotuvchining mijozga oid cheklovlari

- Boshqa sotuvchiga biriktirilgan mijozga sotish/to'lov olish: *"Ruxsat etilmadi: Ushbu mijoz boshqa sotuvchiga biriktirilgan"* (`rpc_record_weight_sale`, 076).
- Biriktirilmagan mijozga sotish mumkin va bu uni avtomatik biriktirmaydi (test 079 "D-A2: selling to an unassigned customer still works and does not assign it").
- Arxivlangan mijozga hech kim yangi savdo qila olmaydi (`ERR_CUSTOMER_ARCHIVED`, trigger `_goldia_guard_sale_archived_customer`, 079).

## 6. Tashkilotlar orasidagi izolyatsiya

Har bir RPC `current_organization_id()` bilan ishlaydi; boshqa tashkilot ma'lumoti ko'rinmaydi va yozilmaydi (testlar: `multi-tenant-security.test.ts`, `goldia-074-tenant-isolation.test.ts`, `goldia-075-...`). Mijoz kodlari har tashkilotda alohida raqamlanadi (075).

## 7. Anonim kirish

069-migration: *"deny anonymous access to SECURITY DEFINER RPCs"* (commit xabari `9805ffa`); test `goldia-security-hotfix.test.ts`.
