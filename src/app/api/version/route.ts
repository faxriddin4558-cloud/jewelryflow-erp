import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
    "HEAD";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let ref = "unknown";
  try {
    if (supabaseUrl) {
      const url = new URL(supabaseUrl);
      ref = url.hostname.split(".")[0] || "unknown";
    }
  } catch {
    ref = "parse_error";
  }

  return NextResponse.json({
    status: "ok",
    commit: commitSha.slice(0, 7),
    full_commit: commitSha,
    env: process.env.NEXT_PUBLIC_APP_ENV || (process.env.NEXT_PUBLIC_STAGING_MODE === "true" ? "staging" : "unknown"),
    staging_mode: process.env.NEXT_PUBLIC_STAGING_MODE === "true",
    supabase_ref: ref,
    timestamp: new Date().toISOString(),
  });
}
