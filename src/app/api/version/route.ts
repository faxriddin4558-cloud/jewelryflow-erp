import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Release SHA = the value the deploy script baked into the build (next.config.mjs, --build-env
  // NEXT_PUBLIC_GIT_COMMIT_SHA=<verified release candidate>). Vercel's own git metadata is only a fallback and is
  // reported separately so a mismatch is visible; nothing secret is returned.
  const buildSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "";
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "";
  const commitSha = buildSha || vercelSha || "unknown";
  const shaSource = buildSha ? "build" : vercelSha ? "vercel_git" : "none";
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
    sha_source: shaSource,
    vercel_git_commit: vercelSha || null,
    timestamp: new Date().toISOString(),
  });
}
