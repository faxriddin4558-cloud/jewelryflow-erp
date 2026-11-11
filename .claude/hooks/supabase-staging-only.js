#!/usr/bin/env node
// PreToolUse(Supabase MCP) guard: a permission rule cannot see the project_id argument, this hook can. Only the
// staging project may be used; any other project (production included) or a missing / unreadable id is blocked.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input = {}; let tool = "";
  try { const j = JSON.parse(raw); input = j.tool_input || {}; tool = String(j.tool_name || ""); } catch { process.stderr.write("guard: unreadable hook input - blocked\n"); process.exit(2); }
  const id = String(input.project_id || input.project_ref || "");
  // tools without any project argument (account-level listings, docs) cannot touch a database
  const accountLevel = /__(list_projects|list_organizations|get_organization|search_docs|get_cost|confirm_cost)$/.test(tool);
  if (!id && accountLevel && input.project_id === undefined) process.exit(0);
  if (id !== "vouehtlmsunebracahon") {
    process.stderr.write(`BLOCKED: Supabase tools are limited to the staging project (vouehtlmsunebracahon); got "${id || "none"}".\n`); process.exit(2);
  }
  process.exit(0);
});
