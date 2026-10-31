# Goldia Sales — video-prezentatsiya (Remotion)

Direktor uchun ~3,5 daqiqalik o‘zbekcha subtitrli video. Dizayn: dark navy + gold.
Bu papka **mustaqil loyiha**: Goldia Sales production kodiga, Supabase bazasiga yoki
Vercel sozlamalariga hech qanday ta’sir qilmaydi.

## Muhim: ekranlar haqida

Ekran yozuvlari mavjud emas edi. Shuning uchun videodagi ilova ekranlari Goldia Sales
kodidagi haqiqiy UI tuzilmasi (`src/app/sales/app/layout.tsx` menyusi,
`ProfitAccountingBanner`, `ScannerConsignmentSection`, `SellerMobileWorkspace`,
`SellerReconciliationModal`, `MarkupDifferenceCard`, `CompanyRateDifferenceCard` va boshqalar)
asosida chizilgan **demo maketlar**. Har bir bunday sahnada
`DEMO MAKET · haqiqiy UI asosida · ma’lumotlar namunaviy` belgisi turadi.
Barcha raqamlar, mijoz ismlari va hujjat raqamlari **o‘ylab topilgan** — haqiqiy
ma’lumot yoki moliyaviy operatsiya ishlatilmagan.

## Tuzilma

```
goldia-sales-video/
├── src/
│   ├── data/script.json         ← o‘zbekcha ovoz matni (har sahna uchun) — subtitrlar shundan olinadi
│   ├── data/audio-manifest.json ← skript yaratadi (ovoz fayllari ro‘yxati va davomiyligi)
│   ├── data/settings.json       ← fon musiqasi yoqish/o‘chirish, ovoz balandligi
│   ├── timeline.mjs             ← sahna vaqtlari va subtitr bo‘linishi (Node + Remotion uchun umumiy)
│   ├── theme.ts                 ← ranglar, shriftlar
│   ├── components/ui.tsx        ← fon, kartalar, ilova/telefon ramkalari, subtitr, ikonlar
│   ├── scenes/part1.tsx, part2.tsx ← 14 ta sahna
│   ├── Video.tsx, Root.tsx      ← kompozitsiyalar: GoldiaSales (to‘liq), GoldiaTest (10 s)
├── public/fonts/                ← Inter + Playfair Display (OFL litsenziya, lokal)
├── public/music/ambient-pad.mp3 ← skript bilan sintez qilingan original fon musiqasi
├── public/voiceover/            ← ovoz fayllari shu yerga qo‘yiladi
└── scripts/                     ← make-srt, scan-audio, make-music
```

## Ishga tushirish (istalgan kompyuter yoki cloud)

Talab: Node.js 18+ va FFmpeg (Remotion o‘zining FFmpeg’ini ham olib keladi).

```bash
cd goldia-sales-video
npm install
npm run studio          # brauzerda ko‘rish va tahrirlash
npm run render:test     # 10 soniyalik test → out/goldia-test-10s.mp4
npm run render          # to‘liq video   → out/goldia-sales.mp4
npm run srt             # out/goldia-sales.uz.srt + out/voiceover-script.txt
```

Agar Remotion Chrome’ni yuklab ololmasa (internet cheklangan muhit), tayyor
Chromium/Chrome headless yo‘lini bering:

```bash
REMOTION_BROWSER=/path/to/chrome-headless-shell npm run render
```

Render vaqti: 4 yadroli cloud mashinada ~17–20 daqiqa (6 372 kadr, 1920×1080, 30 fps).

## Ovoz (voiceover) qo‘shish

ElevenLabs yoki boshqa TTS ulanishi bu sessiyada yo‘q edi, shuning uchun video hozircha
**subtitr + fon musiqasi** bilan. Ovoz qo‘shish uchun:

1. `out/voiceover-script.txt` (yoki `src/data/script.json`) dagi matnni diktorga yoki
   TTS xizmatiga (masalan, ElevenLabs — o‘zbek tili) bering.
2. Har bir sahna uchun alohida fayl saqlang, nomi sahna ID’si bilan bir xil bo‘lsin:
   `public/voiceover/01-intro.mp3`, `02-problem.mp3`, … `14-outro.mp3`.
3. `npm run audio:scan` — fayllar o‘lchanadi, har bir sahna uzunligi ovozga moslashadi,
   subtitr vaqtlari ham qayta hisoblanadi; musiqa avtomatik pastroq ovozga tushadi.
4. `npm run render`.

Bitta umumiy audio fayl bo‘lsa, uni sahnalar bo‘yicha bo‘lib chiqing (masalan, FFmpeg
`-ss/-to` bilan) — shunda sinxronlik aniq bo‘ladi.

## Matn yoki raqamlarni o‘zgartirish

* Ovoz/subtitr matni: `src/data/script.json` (sahna uzunligi matn uzunligiga qarab avtomatik).
* Ekrandagi demo raqamlar: `src/scenes/part1.tsx`, `src/scenes/part2.tsx` (fayl boshidagi massivlar).
* Musiqani o‘chirish: `src/data/settings.json` → `"enabled": false`.

## Litsenziyalar

* Shriftlar: Inter, Playfair Display — SIL Open Font License (`@fontsource` paketlaridan).
* Musiqa: `scripts/make-music.mjs` bilan noldan sintez qilingan, tashqi namuna ishlatilmagan.
* Remotion: kompaniya hajmiga qarab tijorat litsenziyasi talab qilinishi mumkin —
  https://remotion.dev/license ni tekshiring.
