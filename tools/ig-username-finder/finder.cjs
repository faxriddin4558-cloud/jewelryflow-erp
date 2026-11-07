#!/usr/bin/env node
"use strict";

/**
 * Instagram qisqa username qidiruvchi (2–4 belgi, faqat harf/raqam).
 *
 * Nima qiladi:
 *   1. Barcha 2, 3, 4 belgili kombinatsiyalarni generatsiya qilib, esda qolarlik bo'yicha baholaydi.
 *   2. Eng yaxshi nomzodlarning OMMAVIY profil sahifasini (instagram.com/<nik>/) sekin ochib,
 *      dastlabki saralash qiladi.
 *   3. Natijalarni CSV ga yozadi va eng yaxshi 50 nomzodni alohida chiqaradi.
 *
 * Nima QILMAYDI:
 *   - Login qilmaydi, parol/cookie so'ramaydi va saqlamaydi (har safar toza, saqlanmaydigan brauzer konteksti).
 *   - CAPTCHA, rate-limit, login-wall yoki boshqa himoyani chetlab o'tmaydi (User-Agent ham almashtirilmaydi).
 *     Shunday signal ko'rinsa — tekshiruv darhol TO'XTAYDI.
 *   - "Profil topilmadi"ni "bo'sh" deb e'lon qilmaydi. Yakuniy tekshiruv — Instagram ilovasida qo'lda.
 */

const fs = require("node:fs");
const path = require("node:path");
const { rankCandidates, interleaveByType } = require("./lib/candidates.cjs");
const { STATUS, STOP_STATUSES, classify } = require("./lib/classify.cjs");
const { toCsv, readCsv } = require("./lib/csv.cjs");

function parseArgs(argv) {
  const opts = {
    lengths: [2, 3, 4],
    types: ["digits", "letters", "mixed"],
    maxChecks: 40,
    minDelay: 12,
    maxDelay: 25,
    minScore: 25,
    maxUnknownStreak: 5,
    outDir: path.join(__dirname, "output"),
    dryRun: false,
    headed: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--lengths": opts.lengths = next().split(",").map(Number).filter((n) => n >= 2 && n <= 4); break;
      case "--types": opts.types = next().split(","); break;
      case "--max-checks": opts.maxChecks = Number(next()); break;
      case "--min-delay": opts.minDelay = Number(next()); break;
      case "--max-delay": opts.maxDelay = Number(next()); break;
      case "--min-score": opts.minScore = Number(next()); break;
      case "--max-unknown-streak": opts.maxUnknownStreak = Number(next()); break;
      case "--out-dir": opts.outDir = path.resolve(next()); break;
      case "--dry-run": opts.dryRun = true; break;
      case "--headed": opts.headed = true; break;
      case "-h": case "--help":
        console.log(`Foydalanish: node finder.cjs [parametrlar]
  --lengths 2,3,4            Uzunliklar (standart: 2,3,4)
  --types digits,letters,mixed  Turlar (standart: hammasi)
  --max-checks 40            Bir ishga tushirishda maksimal tekshiruvlar (standart: 40)
  --min-delay 12 --max-delay 25   So'rovlar orasidagi pauza, soniya (minimal 5)
  --min-score 25             Shundan past balli nomzodlar tashlab yuboriladi
  --max-unknown-streak 5     Ketma-ket shuncha "noma'lum" bo'lsa — to'xtash
  --out-dir ./output         Natijalar papkasi
  --dry-run                  Tarmoqsiz: faqat generatsiya va baholash
  --headed                   Brauzer oynasini ko'rsatish`);
        process.exit(0);
      default:
        console.error(`Noma'lum parametr: ${a}`);
        process.exit(2);
    }
  }
  // Juda tez so'rov yuborishga yo'l qo'ymaymiz.
  opts.minDelay = Math.max(5, opts.minDelay);
  opts.maxDelay = Math.max(opts.minDelay, opts.maxDelay);
  opts.maxChecks = Math.max(0, Math.min(opts.maxChecks, 200));
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

async function inspect(page, username) {
  let httpStatus = null;
  try {
    const resp = await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    httpStatus = resp ? resp.status() : null;
    // Sahifa klient tomonda chiziladi — biroz kutamiz.
    await page.waitForTimeout(3000);
  } catch (e) {
    return { status: STATUS.ERROR, note: `Yuklanmadi: ${e.message.split("\n")[0]}`, httpStatus };
  }
  const sig = await page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
    return {
      title: document.title || "",
      ogTitle: meta('meta[property="og:title"]'),
      ogUrl: meta('meta[property="og:url"]'),
      description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
      bodyText: (document.body?.innerText || "").slice(0, 5000),
      hasCaptcha: !!document.querySelector(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="arkose"], iframe[src*="captcha"], #captcha',
      ),
    };
  });
  return { ...classify({ username, httpStatus, finalUrl: page.url(), ...sig }), httpStatus };
}

function writeOutputs(opts, ranked, results) {
  const byName = new Map(results.map((r) => [r.username, r]));
  const resultRows = ranked
    .filter((c) => byName.has(c.username))
    .map((c) => ({ ...c, ...byName.get(c.username) }));
  fs.writeFileSync(path.join(opts.outDir, "results.csv"), toCsv(resultRows));

  // Top 50: band bo'lganlar chiqariladi; "ehtimol bo'sh" birinchi, keyin tekshirilmagan/noma'lum.
  const rank = { [STATUS.POSSIBLE]: 0, [STATUS.UNKNOWN]: 1, "": 2 };
  const candidatesTop = ranked
    .map((c) => ({ ...c, status: "", http_status: "", checked_at: "", note: "tekshirilmagan", ...byName.get(c.username) }))
    .filter((c) => c.status !== STATUS.TAKEN)
    .map((c) => (c.status in rank ? c : { ...c, status: "", note: `qayta tekshirish kerak (${c.status})` }))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.score - a.score);
  // Har bir holat guruhi ichida raqamli/harfli/aralash turlarni navbatma-navbat olamiz.
  const top = [0, 1, 2]
    .flatMap((g) => interleaveByType(candidatesTop.filter((c) => rank[c.status] === g)))
    .slice(0, 50)
    .map((c) => ({ ...c, status: c.status || "tekshirilmagan", manual_check: "KERAK" }));
  fs.writeFileSync(
    path.join(opts.outDir, "top50.csv"),
    toCsv(top, ["username", "length", "type", "score", "status", "note", "manual_check"]),
  );
  return top;
}

function printSummary(top, results, stopReason) {
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log("\n================ XULOSA ================");
  console.log(`Tekshirilgan: ${results.length} | band: ${count(STATUS.TAKEN)} | ehtimol bo'sh: ${count(STATUS.POSSIBLE)} | noma'lum: ${count(STATUS.UNKNOWN)}`);
  if (stopReason) console.log(`TO'XTATILDI: ${stopReason}`);
  console.log("\nEng yaxshi 50 nomzod (top50.csv):");
  console.log("  #  nik    tur      ball  holat");
  top.forEach((c, i) =>
    console.log(`${String(i + 1).padStart(3)}  ${c.username.padEnd(6)} ${c.type.padEnd(8)} ${String(c.score).padStart(4)}  ${c.status}`),
  );
  console.log(`
!!! YAKUNIY MAVJUDLIK TEKSHIRUVI — FAQAT QO'LDA, INSTAGRAM ILOVASIDA !!!
  1. Instagram ilovasini oching -> Profil -> "Profilni tahrirlash" -> "Foydalanuvchi nomi".
  2. Nomzodni yozing. Ilova darhol ✓ (bo'sh) yoki "Bu nom band" deb ko'rsatadi.
  3. ✓ ko'rinsa — darhol "Tayyor"ni bosing (qisqa niklarni boshqalar ham qidiradi).
  4. Bu dastur natijasi faqat SARALASH. "ehtimol_bosh" = ommaviy sahifa yo'q, xolos:
     nik o'chirilgan, bloklangan, vaqtincha o'chirilgan yoki Instagram tomonidan
     band qilingan bo'lishi mumkin. 2–3 belgili niklarning deyarli hammasi band.
`);
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(opts.outDir, { recursive: true });

  console.log(`Nomzodlar generatsiya qilinmoqda (uzunlik: ${opts.lengths.join(",")}, tur: ${opts.types.join(",")})...`);
  const ranked = interleaveByType(rankCandidates({ lengths: opts.lengths, minScore: opts.minScore, types: opts.types }));
  fs.writeFileSync(path.join(opts.outDir, "candidates.csv"), toCsv(ranked.slice(0, 5000), ["username", "length", "type", "score", "reasons"]));
  console.log(`${ranked.length} ta nomzod baholandi; eng yaxshi ${Math.min(5000, ranked.length)} tasi candidates.csv ga yozildi.`);

  // Avvalgi natijalarni davom ettirish: yakuniy holatdagilarni qayta so'ramaymiz.
  const resultsFile = path.join(opts.outDir, "results.csv");
  const prior = readCsv(resultsFile).filter((r) => [STATUS.TAKEN, STATUS.POSSIBLE, STATUS.UNKNOWN].includes(r.status));
  const results = prior.map((r) => ({ username: r.username, status: r.status, http_status: r.http_status, checked_at: r.checked_at, note: r.note }));
  const done = new Set(results.map((r) => r.username));
  if (done.size) console.log(`Avvalgi ${done.size} ta natija yuklandi, ular qayta tekshirilmaydi.`);

  let stopReason = null;
  if (opts.dryRun || opts.maxChecks === 0) {
    stopReason = opts.dryRun ? "--dry-run: tarmoq so'rovlari yuborilmadi" : null;
  } else {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: !opts.headed });
    // Saqlanmaydigan toza kontekst: cookie/login yo'q, hech narsa diskka yozilmaydi.
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    let interrupted = false;
    process.once("SIGINT", () => {
      interrupted = true;
      console.log("\nTo'xtatish so'raldi, joriy holat saqlanmoqda...");
    });

    const queue = ranked.filter((c) => !done.has(c.username)).slice(0, opts.maxChecks);
    let unknownStreak = 0;
    try {
      for (let i = 0; i < queue.length; i++) {
        if (interrupted) { stopReason = "foydalanuvchi to'xtatdi (Ctrl+C)"; break; }
        const c = queue[i];
        const r = await inspect(page, c.username);
        const row = { username: c.username, status: r.status, http_status: r.httpStatus ?? "", checked_at: now(), note: r.note };
        console.log(`[${i + 1}/${queue.length}] ${c.username.padEnd(5)} -> ${r.status} ${r.httpStatus ?? ""} ${r.note}`);

        if (STOP_STATUSES.has(r.status)) {
          stopReason = `${r.status}: ${r.note}. Himoya chetlab o'tilmaydi — keyinroq (bir necha soat) qayta ishga tushiring.`;
          break;
        }
        results.push(row);
        unknownStreak = r.status === STATUS.UNKNOWN || r.status === STATUS.ERROR ? unknownStreak + 1 : 0;
        writeOutputs(opts, ranked, results);
        if (unknownStreak >= opts.maxUnknownStreak) {
          stopReason = `ketma-ket ${unknownStreak} ta aniqlanmagan javob — ehtimol Instagram cheklov qo'ydi`;
          break;
        }
        if (i < queue.length - 1) {
          const wait = (opts.minDelay + Math.random() * (opts.maxDelay - opts.minDelay)) * 1000;
          await sleep(wait);
        }
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }

  const top = writeOutputs(opts, ranked, results);
  printSummary(top, results, stopReason);
  console.log(`Fayllar: ${opts.outDir}/{candidates.csv, results.csv, top50.csv}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
