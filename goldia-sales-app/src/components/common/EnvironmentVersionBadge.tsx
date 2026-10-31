"use client";

import { useEffect, useState } from "react";

export function EnvironmentVersionBadge() {
  const [mounted, setMounted] = useState(false);
  const [envName, setEnvName] = useState<"PRODUCTION" | "STAGING" | "LOCAL">("STAGING");
  const [sha, setSha] = useState<string>("HEAD");

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;

    const host = window.location.hostname;
    const isProd =
      process.env.NEXT_PUBLIC_APP_ENV === "production" ||
      host.includes("goldia-sales-production") ||
      (host.includes("production") && !host.includes("staging"));

    const isLocal = host === "localhost" || host === "127.0.0.1";

    if (isProd) {
      setEnvName("PRODUCTION");
    } else if (isLocal) {
      setEnvName("LOCAL");
    } else {
      setEnvName("STAGING");
    }

    const commitSha =
      process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      "da6e930";
    setSha(commitSha.slice(0, 7));
  }, []);

  if (!mounted) return null;

  const isProd = envName === "PRODUCTION";
  const isStg = envName === "STAGING";

  return (
    <div
      id="env-version-badge"
      className="fixed bottom-2 right-2 z-50 pointer-events-none select-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[10px] font-bold shadow-lg border backdrop-blur-md transition-opacity opacity-80 hover:opacity-100"
      style={{
        backgroundColor: isProd ? "rgba(6, 78, 59, 0.92)" : isStg ? "rgba(120, 53, 15, 0.92)" : "rgba(15, 23, 42, 0.92)",
        borderColor: isProd ? "#10b981" : isStg ? "#f59e0b" : "#475569",
        color: isProd ? "#a7f3d0" : isStg ? "#fde68a" : "#cbd5e1",
      }}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isProd ? "bg-emerald-400" : isStg ? "bg-amber-400 animate-pulse" : "bg-sky-400"
        }`}
      />
      <span>{envName}</span>
      <span className="opacity-40">|</span>
      <span>{sha}</span>
    </div>
  );
}
