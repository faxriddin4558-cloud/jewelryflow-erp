#!/usr/bin/env node
// PreToolUse(Bash) guard: refuse any shell command that names a protected Supabase project (production, its typo
// ref, JFS demo, manufacturing ERP) or runs a production write script without the local-rehearsal flag.
// Exit 2 = block (the reason is shown to Claude and the user). Any parse problem also blocks (fail closed).
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  try { cmd = String((JSON.parse(raw).tool_input || {}).command || ""); } catch { process.stderr.write("guard: unreadable hook input - blocked\n"); process.exit(2); }
  const refs = ["vrozlllcaxinavzxueif", "vrozlilcaxinavzxueif", "yvvbdoqncubtwlzskgml", "hbbuskyifxkowlozsaym"];
  const hit = refs.find((r) => cmd.includes(r));
  if (hit) { process.stderr.write(`BLOCKED: the command names a protected project (${hit}). Production / JFS demo / manufacturing ERP are read-only for Claude sessions.\n`); process.exit(2); }
  if (/apply-prod-|sync-vercel-prod-env|backup-prod-data|\.env\.production/.test(cmd)) {
    process.stderr.write("BLOCKED: production scripts / production env files are not run from Claude sessions (the owner runs releases in his own PowerShell).\n"); process.exit(2);
  }
  if (/goldia-prod-release\.js/.test(cmd) && !/--local-rehearsal/.test(cmd)) {
    process.stderr.write("BLOCKED: goldia-prod-release.js only with --local-rehearsal from Claude sessions.\n"); process.exit(2);
  }
  process.exit(0);
});
