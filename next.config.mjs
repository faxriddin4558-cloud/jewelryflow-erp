import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let gitSha = "";
try {
  gitSha = execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {}
// Release SHA baked into the build. The deploy scripts pass the verified release candidate explicitly
// (vercel deploy --build-env NEXT_PUBLIC_GIT_COMMIT_SHA=<full sha>); that value must win. Before this fix the
// explicit value was overwritten by `git rev-parse` - which fails on Vercel CLI builds because .vercelignore
// excludes .git - and then by the stale hard-coded "da6e930", so /api/version showed da6e930 for every deploy.
const releaseSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || gitSha || "unknown";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  env: {
    NEXT_PUBLIC_GIT_COMMIT_SHA: releaseSha,
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []),
        "**/.local-pilot-data/**",
      ],
    };
    return config;
  },
};
export default nextConfig;
