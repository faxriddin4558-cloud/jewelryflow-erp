# JEWELRYFLOW ERP — XAVFSIZLIK VA OLTIN HISOBI AUDITI (SECURITY & ACCOUNTING AUDIT)

**Hujjat Maqsadi:** Tizimning qimmatbaho metallar hisobi va ma'lumotlar bazasi xavfsizligi bo'yicha to'liq auditi.  
**Sana:** 16-oktabr 2026  
**Auditor:** Autonomous Principal Engineer, Security Reviewer & ERP Architect  
**Xavfsizlik Holati:** **PASSED / AUDITED**  

---

## 1. QAT'IY MULTI-TENANT IZOLYATSIYA AUDITI (STRICT MULTI-TENANT ISOLATION)

### 1.1. Row Level Security (RLS) Himoyasi
- Barcha ishlab chiqarish, moliya, ombor va xodimlar jadvallarida `ENABLE ROW LEVEL SECURITY` faollashtirilgan.
- Jadvallar: `batches`, `batch_stage_wip`, `two_party_handovers`, `inventory_items`, `inventory_reservations`, `gold_transactions`, `products`, `sales`, `debt_repayments`, `salary_ledger`, `machines`, `quality_control`, `organization_factory_settings`, `audit_logs`.
- Politsiyalar: `organization_id = public.current_organization_id()`. Har qanday so'rov faqat foydalanuvchining o'z korxonasiga tegishli qatorlarni filtrlaydi.
- Anonim va ruxsatsiz so'rovlar fail-closed tamoyilida rad etiladi.

### 1.2. SECURITY DEFINER Funksiyalari Ichidagi Tekshiruvlar
- Har bir atomik RPC (`rpc_create_batch_with_gold_issue`, `rpc_move_partial_wip`, `rpc_dispatch_stage_handover`, `rpc_accept_stage_handover`, `rpc_record_qc_inspection`, `rpc_complete_qc_rework`, `rpc_reinspect_qc`, `rpc_record_sale`, `rpc_repay_customer_debt`, `rpc_calculate_piecework_salary`, `rpc_adjust_piecework_salary`):
  1. `v_caller_org := public.current_organization_id();` tekshiruvidan boshlanadi. Agar bo'sh bo'lsa, `42501` xatosi chiqariladi.
  2. Partiya yoki buyumning `organization_id` qiymati `v_caller_org` bilan solishtiriladi. Boshqa korxona ma'lumotlariga teginish urinishida `Cross-tenant violation` xatosi otiladi.
  3. `public.assert_erp_permission(...)` orqali xodimning roli tekshiriladi.

### 1.3. Multi-Tenant Kalitlar To'qnashuviga Qarshilik (Collision Resistance)
- Barcha `UNIQUE` cheklovlar faqat bitta korxona doirasida ishlaydi (`organization_id, batch_no`, `organization_id, order_no`, `organization_id, code`).
- Org A va Org B bir vaqtning o'zida bir xil raqamli partiya (`BATCH-SHARED-001`) va buyurtma (`ORD-SHARED-001`) ochganda ham to'qnashuv yuzaga kelmaydi va bir-birining balanslariga ta'sir qilmaydi (Phase I, Test 31–34 tasdiqlagan).

---

## 2. QIMMATBAHO METALLAR VA MOLIYAVIY HISOB AUDITI (FINANCIAL & GOLD ACCOUNTING)

### 2.1. Massaning Saqlanish Qonuni (Mass Balance Conservation)
- Formulalar:
  $$\text{Chiqarilgan Oltin} = \text{Tayyor Buyum} + \text{Sprues (Qolip quyish qoldiqlari)} + \text{Scrap (Qirindi/Qayta eritish)} + \text{Loss (Yo'qotish)}$$
- 10 ta partiya bo'yicha $739.5000$g oltin ishlab chiqarishga kiritildi.
- Chiqishlar:
  - Tayyor zargarlik buyumlari: $625.5600$g ($84.59\%$)
  - Qaytarilgan quyuv qoldiqlari (sprues): $86.0000$g ($11.63\%$)
  - Qaytarilgan qirindilar (scraps): $26.6000$g ($3.60\%$)
  - Hujjatlashtirilgan ruxsat etilgan yo'qotish (loss): $1.3400$g ($0.18\%$)
  - **Noqonuniy / Hisobga olinmagan farq (Unaccounted Leak):** **$0.0000$g ($0.0000\%$)** — MUKAMMAL SAQLANISH.

### 2.2. Salbiy Qoldiqlardan Himoya (Negative Balance Guards)
- Seyfdan oltin chiqim qilishda (`rpc_inventory_transaction`): agar so'ralgan og'irlik mavjud zaxiradan (`on_hand - reserved`) bitta milligrammga ko'p bo'lsa ham tranzaksiya to'xtatiladi.
- Manfiy og'irlik (`p_weight <= 0`) kiritish qat'iy bloklangan. `abs()` yordamida ayyorona manfiy sonni musbatga aylantirish zaxirasi yopilgan.
- Tayyor buyumlarni sotishda (`rpc_record_sale`): sotuv soni mavjud erkin stokka teng yoki kam bo'lishi shart.
- Qarz to'lashda (`rpc_repay_customer_debt`): to'lov summasi mijozning amaldagi qarzidan ortiq bo'lsa tranzaksiya rad etiladi (Phase N, Test 60).

---

## 3. KONKURENTLIK VA IDEMPOTENTLIK AUDITI (CONCURRENCY & IDEMPOTENCY)

- Barcha muhim operatsiyalar `idempotency_keys` jadvali va `check_and_lock_idempotency` funksiyasi bilan himoyalangan.
- Tarmoqdagi uzilish yoki mijoz tugmani ikki marta bosganda bir xil `idempotency_key` bilan takroriy so'rov kelsa:
  - Yangi yozuv yaratilmaydi;
  - Balanslar yoki ishbay maoshlar ikkinchi marta o'zgarmaydi;
  - Avvalgi muvaffaqiyatli natija keshdan qaytariladi.
- Uskunalar stansiyalari (Machine stations): quyuv va lazer uskunalarini parallel egallashga urinishda PostgreSQL qator darajasidagi atomik qulflash (`for update`) orqali ikkinchi so'rovni xatosiz rad etadi (Phase E, Test 17).

---

## 4. APPARATURA VA TAROZI XAVFSIZLIGI AUDITI (HARDWARE DRIVER AUDIT)

- **Drayver:** `src/lib/hardware/scale-serial.ts`
- Web Serial drayveri ASCII oqimini doimiy parse qiladi.
- Tekshiruvlar:
  1. `isUnitValid`: Faqat `g` birligi qabul qilinadi. Boshqa birliklar rad etiladi.
  2. `isReadingPlausible`: $-1000$g dan $+50,000$g gacha bo'lmagan, noto'g'ri simvollar yoki bo'sh qatorlar darhol chetlatiladi.
  3. `mode: "AUTO_SCALE"`: Avtomatik tarozi orqali o'qilgan ma'lumotlar bazaga `measurement_mode = 'AUTO_SCALE'` sifatida yoziladi.
  4. `mode: "MANUAL_ENTRY"`: Agar tarozi ishlamasa, qo'lda kiritilgan qiymatlar vizual tarzda `[✍️ Qo'lda kiritilgan]` tamg'asi bilan ko'rsatiladi va audit logiga tushadi.
- Tarozi o'zboshimchalik bilan o'zgartirilishi yoki nomuvofiqlik bo'lsa:
  - Discrepancy $\pm 0.05$g dan oshganda partiya qabul qilinmaydi (`DISCREPANCY_FLAGGED`).
  - Ishbay maosh berilishi to'xtatiladi.
  - Faqatgina ruxsat etilgan supervayzer yozma sabab ko'rsatib tasdiqlagandagina o'tadi (`ACCEPTED_WITH_OVERRIDE` / `SUPERVISOR_OVERRIDDEN`).
