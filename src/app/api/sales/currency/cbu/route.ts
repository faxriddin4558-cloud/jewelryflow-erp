import { NextResponse } from "next/server";

interface CbuRateItem {
  id: number;
  Code: string;
  Ccy: string;
  CcyNm_RU: string;
  CcyNm_UZ: string;
  CcyNm_UZC: string;
  CcyNm_EN: string;
  Nominal: string;
  Rate: string;
  Diff: string;
  Date: string;
}

interface CachedRate {
  rate: number;
  formattedRate: string;
  date: string;
  diff: string;
  currency: string;
  currencyName: string;
  fetchedAt: number;
}

let memoryCache: CachedRate | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

export async function GET() {
  const now = Date.now();

  if (memoryCache && now - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      success: true,
      cached: true,
      data: memoryCache,
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch("https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/", {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "JewelryFlow-Sales/2.0",
      },
      next: { revalidate: 3600 },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`CBU API returned HTTP status ${res.status}`);
    }

    const json = (await res.json()) as CbuRateItem[];
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error("Invalid response structure from CBU API");
    }

    const usd = json[0];
    if (!usd || !usd.Rate) {
      throw new Error("Invalid currency record in CBU response");
    }
    const parsedRate = parseFloat(usd.Rate.replace(/,/g, ""));

    memoryCache = {
      rate: parsedRate,
      formattedRate: usd.Rate,
      date: usd.Date,
      diff: usd.Diff,
      currency: usd.Ccy,
      currencyName: usd.CcyNm_UZ,
      fetchedAt: now,
    };

    return NextResponse.json(
      {
        success: true,
        cached: false,
        data: memoryCache,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);

    // If cache exists (even expired), return it with stale warning
    if (memoryCache) {
      return NextResponse.json({
        success: true,
        cached: true,
        stale: true,
        warning: `CBU API error (${errMessage}), returning stale cache`,
        data: memoryCache,
      });
    }

    // Default fallback rate if never fetched
    return NextResponse.json(
      {
        success: false,
        error: errMessage,
        fallback: {
          rate: 12850.0,
          date: new Date().toISOString().split("T")[0],
          currency: "USD",
        },
      },
      { status: 502 }
    );
  }
}
