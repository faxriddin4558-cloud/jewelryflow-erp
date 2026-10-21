import crypto from "crypto";

export interface TelegramUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramVerifyOptions {
  botToken?: string;
  maxAgeSeconds?: number;
}

export interface TelegramVerifyResult {
  valid: boolean;
  isValid: boolean; // Alias for test compatibility
  user?: TelegramUser;
  authDate?: number;
  data?: {
    user?: TelegramUser;
    auth_date?: number;
    query_id?: string;
    hash?: string;
  };
  error?: string;
}

export type TelegramInitDataVerificationResult = TelegramVerifyResult;


/**
 * Parses raw Telegram initData string into structured object without cryptographic verification.
 */
export function parseTelegramInitData(initData: string): {
  user?: TelegramUser;
  auth_date?: number;
  query_id?: string;
  hash?: string;
  raw: Record<string, string>;
} {
  const params = new URLSearchParams(initData);
  const raw: Record<string, string> = {};
  params.forEach((v, k) => {
    raw[k] = v;
  });

  let user: TelegramUser | undefined;
  const userStr = params.get("user");
  if (userStr) {
    try {
      user = JSON.parse(userStr) as TelegramUser;
    } catch {}
  }

  const authDateStr = params.get("auth_date");
  const authDate = authDateStr ? parseInt(authDateStr, 10) : undefined;

  return {
    user,
    auth_date: authDate,
    query_id: params.get("query_id") || undefined,
    hash: params.get("hash") || undefined,
    raw,
  };
}

/**
 * Validates Telegram WebApp initData string against BOT_TOKEN using HMAC-SHA256.
 * Implements official Telegram WebApp signature verification and anti-replay check (< 24h).
 */
export function verifyTelegramInitData(
  initData: string,
  optionsOrToken?: string | TelegramVerifyOptions
): TelegramVerifyResult {
  if (!initData || typeof initData !== "string") {
    return { valid: false, isValid: false, error: "initData bo'sh yoki noto'g'ri formatda." };
  }

  let botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  let maxAgeSeconds = 86400; // 24 hours default

  if (typeof optionsOrToken === "string") {
    botToken = optionsOrToken;
  } else if (typeof optionsOrToken === "object" && optionsOrToken !== null) {
    if (optionsOrToken.botToken !== undefined) botToken = optionsOrToken.botToken;
    if (optionsOrToken.maxAgeSeconds !== undefined) maxAgeSeconds = optionsOrToken.maxAgeSeconds;
  }

  // Parse key-value pairs
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return { valid: false, isValid: false, error: "initData ichida hash mavjud emas (imzo yo'q)." };
  }

  // Check auth_date for replay attack protection
  const authDateStr = params.get("auth_date");
  if (!authDateStr) {
    return { valid: false, isValid: false, error: "initData ichida 'auth_date' mavjud emas." };
  }

  const authDate = parseInt(authDateStr, 10);
  const currentTime = Math.floor(Date.now() / 1000);

  if (isNaN(authDate) || currentTime - authDate > maxAgeSeconds) {
    return {
      valid: false,
      isValid: false,
      error: "Telegram sessiya muddati o'tgan (24 soatdan ortiq). Iltimos, ilovani qayta ishga tushiring.",
    };
  }

  // Extract user payload
  const userStr = params.get("user");
  let user: TelegramUser | undefined;
  if (userStr) {
    try {
      user = JSON.parse(userStr) as TelegramUser;
    } catch {
      return { valid: false, isValid: false, error: "User payload JSON formatida emas." };
    }
  }

  // If no bot token configured in environment (local dev mode demonstration)
  if (!botToken) {
    if (process.env.NODE_ENV !== "production") {
      return {
        valid: true,
        isValid: true,
        user,
        authDate,
        data: { user, auth_date: authDate, query_id: params.get("query_id") || undefined, hash },
        error: "TELEGRAM_BOT_TOKEN sozlanmagan (Lokal rejimda foydalanuvchi qabul qilindi).",
      };
    }
    return { valid: false, isValid: false, error: "Serverda TELEGRAM_BOT_TOKEN sozlanmagan." };
  }

  // Construct data_check_string according to Telegram documentation:
  // Sort alphabetically by key, format key=value, joined with newline '\n', excluding hash.
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") {
      pairs.push(`${key}=${value}`);
    }
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // calculated_hash = HMAC_SHA256(secret_key, dataCheckString).hex()
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison to protect against timing attacks
  const calcBuf = Buffer.from(calculatedHash, "utf-8");
  const hashBuf = Buffer.from(hash, "utf-8");
  if (calcBuf.length !== hashBuf.length || !crypto.timingSafeEqual(calcBuf, hashBuf)) {
    return {
      valid: false,
      isValid: false,
      error: "Telegram imzosi (hash) noto'g'ri yoki ma'lumotlar soxtalashtirilgan. Ruxsatsiz murojaat!",
    };
  }


  return {
    valid: true,
    isValid: true,
    user,
    authDate,
    data: { user, auth_date: authDate, query_id: params.get("query_id") || undefined, hash },
  };
}
