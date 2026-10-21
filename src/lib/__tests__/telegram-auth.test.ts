import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  verifyTelegramInitData,
  parseTelegramInitData,
  type TelegramInitDataVerificationResult,
} from "../telegram-auth";

function createValidInitData(
  botToken: string,
  userObj: Record<string, unknown>,
  authDateSec: number
): string {
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

  const params: Record<string, string> = {
    auth_date: String(authDateSec),
    query_id: "AAG7h5cOAAAAALuHlw4bK9o3",
    user: JSON.stringify(userObj),
  };

  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");

  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Construct URL encoded query string
  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    urlParams.set(k, v);
  }
  urlParams.set("hash", hash);

  return urlParams.toString();
}

describe("Telegram WebApp Authentication & Security (HMAC-SHA256)", () => {
  const TEST_BOT_TOKEN = "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ_test_token";

  it("successfully verifies valid Telegram WebApp initData", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const user = {
      id: 987654321,
      first_name: "Alisher",
      last_name: "Direktor",
      username: "alisher_goldia",
      language_code: "uz",
    };

    const validInitData = createValidInitData(TEST_BOT_TOKEN, user, nowSec);

    const result: TelegramInitDataVerificationResult = verifyTelegramInitData(validInitData, {
      botToken: TEST_BOT_TOKEN,
    });

    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.user?.id).toBe(987654321);
    expect(result.data?.user?.username).toBe("alisher_goldia");
    expect(result.data?.user?.first_name).toBe("Alisher");
  });

  it("rejects tampered data with mismatched hash", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const user = { id: 111222, first_name: "Hacker" };
    const validInitData = createValidInitData(TEST_BOT_TOKEN, user, nowSec);

    // Tamper with one character in hash
    const tampered = validInitData.replace("hash=", "hash=f");

    const result = verifyTelegramInitData(tampered, { botToken: TEST_BOT_TOKEN });
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/imzo noto'g'ri|soxtalashtirilgan/i);
  });

  it("rejects expired auth_date to prevent replay attacks (> 24 hours)", () => {
    // 25 hours ago
    const expiredSec = Math.floor(Date.now() / 1000) - 25 * 3600;
    const user = { id: 555666, first_name: "Late User" };
    const expiredInitData = createValidInitData(TEST_BOT_TOKEN, user, expiredSec);

    const result = verifyTelegramInitData(expiredInitData, {
      botToken: TEST_BOT_TOKEN,
      maxAgeSeconds: 86400,
    });

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/muddati o'tgan|24 soat/i);
  });

  it("rejects empty or missing hash", () => {
    const invalid = "user=%7B%22id%22%3A123%7D&auth_date=1700000000";
    const result = verifyTelegramInitData(invalid, { botToken: TEST_BOT_TOKEN });
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/hash mavjud emas/i);
  });

  it("correctly parses raw Telegram initData params", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const user = { id: 777888, username: "rustam_mgr" };
    const initData = createValidInitData(TEST_BOT_TOKEN, user, nowSec);

    const parsed = parseTelegramInitData(initData);
    expect(parsed.user?.id).toBe(777888);
    expect(parsed.user?.username).toBe("rustam_mgr");
    expect(parsed.auth_date).toBe(nowSec);
    expect(parsed.hash).toBeDefined();
  });
});
