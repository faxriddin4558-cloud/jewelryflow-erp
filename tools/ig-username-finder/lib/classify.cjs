"use strict";

/**
 * Ommaviy profil sahifasidan olingan signallarni holatga aylantiradi.
 * MUHIM: "topilmadi" hech qachon "bo'sh" degani emas. Akkaunt o'chirilgan, bloklangan,
 * vaqtincha o'chirilgan yoki Instagram tomonidan band qilingan bo'lishi mumkin.
 */

const STATUS = {
  TAKEN: "band", // ommaviy profil mavjud
  POSSIBLE: "ehtimol_bosh", // ommaviy sahifa topilmadi — FAQAT ilovada qo'lda tekshiring
  UNKNOWN: "nomalum", // aniq signal yo'q
  RATE_LIMITED: "cheklov", // 429 / "try again later" — tekshiruv to'xtatiladi
  LOGIN_WALL: "login_talab", // login sahifasiga yo'naltirildi — chetlab o'tilmaydi, to'xtatiladi
  CHALLENGE: "captcha_yoki_challenge", // CAPTCHA/challenge — chetlab o'tilmaydi, to'xtatiladi
  ERROR: "xato",
};

/** Bu holatlardan birida butun tekshiruv to'xtaydi. */
const STOP_STATUSES = new Set([STATUS.RATE_LIMITED, STATUS.LOGIN_WALL, STATUS.CHALLENGE]);

const RATE_LIMIT_PATTERNS = [
  /please wait a few minutes/i,
  /try again later/i,
  /too many requests/i,
  /we restrict certain activity/i,
  /rate limit/i,
];
const NOT_FOUND_PATTERNS = [
  /sorry, this page isn'?t available/i,
  /the link you followed may be broken/i,
  /page not found/i,
  /profile isn'?t available/i,
];

/**
 * @param {object} s
 * @param {string} s.username
 * @param {number|null} s.httpStatus
 * @param {string} s.finalUrl
 * @param {string} s.title
 * @param {string} s.ogTitle
 * @param {string} s.ogUrl
 * @param {string} s.description
 * @param {string} s.bodyText
 * @param {boolean} s.hasCaptcha
 */
function classify(s) {
  const u = s.username.toLowerCase();
  const url = (s.finalUrl || "").toLowerCase();
  const text = `${s.title || ""}\n${s.bodyText || ""}`;

  if (s.httpStatus === 429 || RATE_LIMIT_PATTERNS.some((r) => r.test(text))) {
    return { status: STATUS.RATE_LIMITED, note: "So'rovlar cheklandi" };
  }
  if (s.hasCaptcha || /\/challenge\//.test(url) || /captcha/i.test(url)) {
    return { status: STATUS.CHALLENGE, note: "CAPTCHA/challenge aniqlandi" };
  }
  if (/\/accounts\/login/.test(url) || /\/accounts\/suspended/.test(url)) {
    return { status: STATUS.LOGIN_WALL, note: "Login sahifasiga yo'naltirildi" };
  }

  const handle = `(@${u})`;
  const meta = `${s.ogTitle || ""} ${s.title || ""}`.toLowerCase();
  const ogUrl = (s.ogUrl || "").toLowerCase();
  const desc = (s.description || "").toLowerCase();
  if (
    meta.includes(handle) ||
    ogUrl.replace(/\/+$/, "").endsWith(`/${u}`) ||
    (/followers/.test(desc) && desc.includes(`@${u}`))
  ) {
    return { status: STATUS.TAKEN, note: "Ommaviy profil mavjud" };
  }

  if (s.httpStatus === 404 || NOT_FOUND_PATTERNS.some((r) => r.test(text))) {
    return {
      status: STATUS.POSSIBLE,
      note: "Ommaviy sahifa yo'q — bo'sh deb hisoblanmaydi, ilovada qo'lda tekshiring",
    };
  }

  if (s.httpStatus && s.httpStatus >= 500) {
    return { status: STATUS.ERROR, note: `Server xatosi ${s.httpStatus}` };
  }
  return { status: STATUS.UNKNOWN, note: "Aniq signal topilmadi" };
}

module.exports = { STATUS, STOP_STATUSES, classify };
