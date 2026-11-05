import { describe, it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

// /api/version must report the release SHA the deploy script baked into the build, never a stale fallback.
const KEYS = ["NEXT_PUBLIC_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_ENV"];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.resetModules(); });

async function version(env: Record<string, string | undefined>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const { GET } = await import("../route");
  return (await GET()).json();
}

const RC = "d7537d9e1e5c0e4c8e0f3b3f6a1b2c3d4e5f6a7b";

describe("/api/version", () => {
  it("the explicit build SHA wins over Vercel git metadata", async () => {
    const v = await version({ NEXT_PUBLIC_GIT_COMMIT_SHA: RC, VERCEL_GIT_COMMIT_SHA: "1111111111111111111111111111111111111111", NEXT_PUBLIC_SUPABASE_URL: "https://vouehtlmsunebracahon.supabase.co", NEXT_PUBLIC_APP_ENV: "staging" });
    expect(v.full_commit).toBe(RC);
    expect(v.commit).toBe("d7537d9");
    expect(v.sha_source).toBe("build");
    expect(v.vercel_git_commit).toBe("1111111111111111111111111111111111111111");
    expect(v.supabase_ref).toBe("vouehtlmsunebracahon");
  });
  it("falls back to Vercel git metadata, then to 'unknown' - never to a hard-coded commit", async () => {
    expect((await version({ VERCEL_GIT_COMMIT_SHA: RC })).sha_source).toBe("vercel_git");
    const none = await version({});
    expect(none.full_commit).toBe("unknown");
    expect(none.sha_source).toBe("none");
  });
});

describe("next.config.mjs release SHA (Vercel CLI build: .git excluded by .vercelignore)", () => {
  const resolve = (env: Record<string, string>) => execFileSync(process.execPath, ["-e",
    `import(${JSON.stringify(path.resolve(__dirname, "../../../../../next.config.mjs"))}).then((m) => process.stdout.write(m.default.env.NEXT_PUBLIC_GIT_COMMIT_SHA))`],
    { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", GIT_DIR: "/nonexistent-goldia", ...env }, encoding: "utf8" });
  it("keeps the --build-env release SHA when git is unavailable (before the fix: da6e930)", () => {
    expect(resolve({ NEXT_PUBLIC_GIT_COMMIT_SHA: RC })).toBe(RC);
  });
  it("uses Vercel git metadata only without an explicit SHA, else 'unknown'", () => {
    expect(resolve({ VERCEL_GIT_COMMIT_SHA: RC })).toBe(RC);
    expect(resolve({})).toBe("unknown");
  });
});
