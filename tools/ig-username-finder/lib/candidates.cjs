"use strict";

/**
 * Qisqa username nomzodlarini generatsiya qilish va "esda qolarlik" bo'yicha baholash.
 * Tarmoqqa umuman murojaat qilmaydi — sof funksiyalar.
 */

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const ALPHABET = LETTERS + DIGITS;
const VOWELS = new Set("aeiou".split(""));
// Ko'zga bir-biriga o'xshab ketadigan belgilar (o/0, l/1, i/l)
const CONFUSABLE = new Set(["o", "0", "l", "1", "i"]);
const LUCKY_DIGITS = new Set(["7", "8", "9", "1", "0"]);
const PREMIUM_LETTERS = new Set("xzqvkjy".split(""));

function charType(ch) {
  return DIGITS.includes(ch) ? "digit" : "letter";
}

function usernameType(u) {
  const types = new Set(u.split("").map(charType));
  if (types.size === 2) return "mixed";
  return types.has("digit") ? "digits" : "letters";
}

/** Barcha uzunliklardagi kombinatsiyalarni generator orqali beradi (xotirani tejaydi). */
function* generateAll(lengths = [2, 3, 4], alphabet = ALPHABET) {
  for (const len of lengths) {
    const idx = new Array(len).fill(0);
    while (true) {
      yield idx.map((i) => alphabet[i]).join("");
      let p = len - 1;
      while (p >= 0 && ++idx[p] === alphabet.length) {
        idx[p] = 0;
        p--;
      }
      if (p < 0) break;
    }
  }
}

function isSequential(s, step) {
  for (let i = 1; i < s.length; i++) {
    const a = ALPHABET.indexOf(s[i - 1]);
    const b = ALPHABET.indexOf(s[i]);
    if (charType(s[i]) !== charType(s[i - 1]) || b - a !== step) return false;
  }
  return true;
}

/** Undosh/unli shabloni: "nova" -> "CVCV" (raqam -> D). */
function shape(u) {
  return u
    .split("")
    .map((c) => (DIGITS.includes(c) ? "D" : VOWELS.has(c) ? "V" : "C"))
    .join("");
}

/**
 * Esda qolarlik balli. Yuqori ball = chiroyliroq/qisqaroq nik.
 * Qaytaradi: { score, reasons: string[] }
 */
function scoreUsername(u) {
  const reasons = [];
  let score = 0;
  const add = (pts, why) => {
    score += pts;
    reasons.push(`${why}(${pts > 0 ? "+" : ""}${pts})`);
  };

  const len = u.length;
  add({ 2: 60, 3: 35, 4: 15 }[len] ?? 0, `uzunlik${len}`);

  const type = usernameType(u);
  const unique = new Set(u).size;
  const rev = u.split("").reverse().join("");
  const sh = shape(u);

  if (unique === 1) add(45, "bir_xil_belgi"); // aaa, 7777
  else if (len > 2 && unique === 2) add(15, "faqat_2_xil_belgi"); // 7112, 1001
  else if (len === 4 && unique === 3) add(4, "takror_bor");

  if (len > 2 && u === rev && unique > 1) add(15, "palindrom"); // 1221, aba
  if (len === 4 && u[0] === u[2] && u[1] === u[3] && u[0] !== u[1]) add(14, "ABAB"); // 1212
  if (len === 4 && u[0] === u[1] && u[2] === u[3] && u[0] !== u[2]) add(12, "AABB"); // 1122
  if (len === 4 && u[1] === u[2] && u[0] !== u[1] && u[2] !== u[3] && u[0] !== u[3]) add(6, "ABBC"); // 7112

  if (len > 2 && (isSequential(u, 1) || isSequential(u, -1))) add(22, "ketma-ket"); // 123, abcd

  // Harf + raqam: f1, x7, k9, a12
  if (/^[a-z][0-9]+$/.test(u)) add(len === 2 ? 25 : 12, "harf+raqam");
  if (/^[0-9]+[a-z]$/.test(u)) add(len === 2 ? 18 : 8, "raqam+harf");
  if (type === "mixed") {
    if ([...u].some((c) => PREMIUM_LETTERS.has(c) || c === "f")) add(4, "kuchli_harf"); // x7, f1, z9
    if ([...u].some((c) => "179".includes(c))) add(3, "kuchli_raqam");
  }
  if (type === "mixed" && !/^[a-z][0-9]+$/.test(u) && !/^[0-9]+[a-z]$/.test(u)) {
    add(-12, "aralash_tartibsiz"); // a1b2, 1ab2
  }

  if (type === "letters") {
    if (["CVCV", "CVC", "VCV", "CV", "VC", "CVVC", "CVCC"].includes(sh)) add(12, "talaffuz_oson");
    if (/CCC/.test(sh)) add(-10, "undoshlar_toʻplami");
    if ([...u].some((c) => PREMIUM_LETTERS.has(c))) add(4, "noyob_harf");
  }

  if (type === "digits") {
    if (/^[1-9]0+$/.test(u)) add(14, "yaxlit_son"); // 100, 7000
    const lucky = [...u].filter((c) => LUCKY_DIGITS.has(c)).length;
    if (lucky === len) add(5, "omadli_raqamlar");
    if (u[0] === "0") add(-6, "0_bilan_boshlanadi");
  }

  if (type === "mixed") {
    const conf = [...u].filter((c) => CONFUSABLE.has(c)).length;
    if (conf >= 2) add(-10, "chalkash_belgilar"); // l1, o0
  }

  return { score, reasons };
}

/**
 * Barcha nomzodlarni baholab, eng yaxshilarini qaytaradi.
 * 4 belgili kombinatsiyalar ~1.7 mln, shuning uchun faqat minScore dan yuqorilarini saqlaymiz.
 */
function rankCandidates({ lengths = [2, 3, 4], minScore = 25, types = ["digits", "letters", "mixed"] } = {}) {
  const out = [];
  for (const u of generateAll(lengths)) {
    const type = usernameType(u);
    if (!types.includes(type)) continue;
    const { score, reasons } = scoreUsername(u);
    if (score < minScore) continue;
    out.push({ username: u, length: u.length, type, score, reasons: reasons.join(" ") });
  }
  out.sort((a, b) => b.score - a.score || a.length - b.length || a.username.localeCompare(b.username));
  return out;
}

/**
 * Har bir turdan (digits/letters/mixed) navbatma-navbat oladi,
 * shunda tekshiruv navbati faqat raqamlarga to'lib qolmaydi.
 */
function interleaveByType(list) {
  const buckets = { digits: [], letters: [], mixed: [] };
  for (const c of list) buckets[c.type].push(c);
  const out = [];
  const keys = Object.keys(buckets);
  for (let i = 0; out.length < list.length; i++) {
    for (const k of keys) if (buckets[k][i]) out.push(buckets[k][i]);
  }
  return out;
}

module.exports = {
  ALPHABET,
  generateAll,
  usernameType,
  scoreUsername,
  rankCandidates,
  interleaveByType,
  shape,
};
