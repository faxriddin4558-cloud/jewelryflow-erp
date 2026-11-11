#!/usr/bin/env node
/*
 * GOLDIA SALES - READ-ONLY production smoke test in a real browser (Playwright, installed Edge / Chrome).
 *
 * NOTHING is written to the business database. Every browser request goes through a write guard:
 *   allowed : GET / HEAD / OPTIONS, Supabase Auth login (POST /auth/v1/token), and POST /rest/v1/rpc/<name> ONLY for the
 *             read RPCs in READ_RPCS (their bodies are checked by 02_post_release_readonly.sql: no insert/update/delete)
 *   blocked : everything else (sales, payments, customers, receipts, handovers, rates, login audit, the customer ledger
 *             RPC that refreshes the debt cache, factory settings lazy insert, Next.js POSTs, ...). A blocked request is
 *             aborted in the browser before it leaves the computer and is listed in the report.
 * No button that submits anything is clicked; the script only logs in, opens pages and reads.
 * Requests to any Supabase project other than the target are aborted and FAIL the run.
 *
 * Checks: 1 /api/version (commit, Supabase ref, env), 2 director / manager / seller login + pages without 5xx/401/403
 * or crashes, 3 seller's own LOM / USD rates shown = server values, 4/5 director's balances (customer debt, stock, tills,
 * vault, factory obligation) = the organization line of the post-release SQL baseline, 6 RLS through safe GET reads
 * (other organization / other seller / anonymous), 7 mobile 390 px without horizontal overflow.
 *
 *   node scripts/goldia-prod-smoke-readonly.js --target production [--expect-commit fec64ec] [--baseline <01_baseline.txt>]
 *        [--channel msedge|chrome|chromium] [--out <dir>] [--roles director,manager,seller] [--no-screenshots]
 * Passwords are asked hidden; they are never printed or written. Output: <out>/smoke-<target>-<time>/ (SUMMARY.txt and
 * RESULT.json: aggregates only; screenshots/*.png show real screens - keep the folder private).
 * Exit: 0 PASS, 2 REVIEW, 1 FAIL.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const TARGETS = {
  production: { base: "https://goldia-sales-production.vercel.app", ref: "vrozlllcaxinavzxueif", env: "production" },
  staging: { base: "https://jewelryflow-sales-staging.vercel.app", ref: "vouehtlmsunebracahon", env: "staging" },
};
const FORBIDDEN_REFS = ["yvvbdoqncubtwlzskgml", "hbbuskyifxkowlozsaym", "vrozlilcaxinavzxueif"];
// e-mails the production login page and middleware refuse before / after Supabase Auth (src/app/sales/login/page.tsx,
// src/lib/supabase/middleware.ts) - only used to EXPLAIN a failed login, the e-mail itself is never printed
const DEMO_EMAILS = new Set(["director@goldia.uz", "manager@goldia.uz", "seller@goldia.uz", "dilshod@jewelryflow.uz", "jasur@jewelryflow.uz",
  "worker@goldia.uz", "accountant@goldia.uz", "xodim@goldia.uz", "jamshid@jewelryflow.uz", "demo.director@goldia.uz", "demo.seller@goldia.uz", "admin@goldia.uz"]);
const READ_RPCS = new Set([
  "current_employee_id", "current_employee_role_text", "get_manager_available_stock_grams", "get_seller_available_stock_grams",
  "rpc_get_accounting_profit_summary", "rpc_get_active_sales_markups", "rpc_get_company_rate_difference_report",
  "rpc_get_customer_monthly_report", "rpc_get_daily_sales_ledger", "rpc_get_manager_available_stock_grams",
  "rpc_get_seller_markup_difference_report", "rpc_get_seller_rates", "rpc_get_seller_reconciliation_statement",
  "rpc_get_period_report", // 077 (STABLE, no writes - checked by 02_post_release_readonly.sql)
  // 084 / 085: declared STABLE in the database - PostgreSQL itself refuses any INSERT / UPDATE / DELETE inside them
  "rpc_get_operation_rate_review", "rpc_get_opening_state",
]);
// writes the app makes on page view / login - blocked and reported, not a failure
// rpc_preview_*: staging-only test-cleanup tab (VOLATILE, body has no write today) - kept blocked on purpose
const EXPECTED_BLOCKS = new Set(["rpc_record_login_audit", "rpc_get_unified_customer_ledger", "rpc_get_factory_settings",
  "rpc_preview_selective_test_cleanup", "rpc_preview_full_test_reset"]);
const PAGES = {
  director: ["/sales/app", "/sales/director", "/sales/app/factory", "/sales/app/inventory", "/sales/app/consignments", "/sales/app/sellers",
    "/sales/app/scan", "/sales/app/customers", "/sales/app/cash", "/sales/app/refining", "/sales/app/purchases", "/sales/app/reports",
    "/sales/app/models", "/sales/app/users", "/sales/app/settings", "/sales/app/handovers", "/sales/app/markup", "/sales/app/factory-receive", "/sales/app/period-report", "/sales/app/opening"],
  manager: ["/sales/app", "/sales/app/factory", "/sales/app/inventory", "/sales/app/consignments", "/sales/app/sellers", "/sales/app/scan",
    "/sales/app/customers", "/sales/app/cash", "/sales/app/refining", "/sales/app/purchases", "/sales/app/reports", "/sales/app/handovers", "/sales/app/period-report", "/sales/app/opening"],
  seller: ["/sales/app", "/sales/app/scan", "/sales/app/customers", "/sales/app/kassam"],
};
// the external Central Bank (CBU) currency endpoint can fail; the app then uses the stored rates (F-UI fix) - reported once
const EXTERNAL = ["/api/sales/currency/cbu"];
const isHydration = (m) => /Minified React error #(418|423|425)\b/.test(m);
const MOBILE_PAGES = { director: ["/sales/app"], manager: ["/sales/app"], seller: ["/sales/app", "/sales/app/scan", "/sales/app/customers", "/sales/app/kassam"] };

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf("--" + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const flag = (name) => argv.includes("--" + name);
const targetName = opt("target", "");
if (!TARGETS[targetName]) { console.error("STOPPED: --target production|staging is required"); process.exit(1); }
const T = TARGETS[targetName];
if (flag("self-test-guard") && targetName !== "staging") { console.error("STOPPED: --self-test-guard is accepted only with --target staging"); process.exit(1); }
const expectCommit = opt("expect-commit", "");
const baselineFile = opt("baseline", "");
const roles = opt("roles", "director,manager,seller").split(",").map((s) => s.trim()).filter(Boolean);
for (const r of roles) if (!PAGES[r]) { console.error("STOPPED: unknown role " + r); process.exit(1); }
const channel = opt("channel", process.platform === "win32" ? "msedge" : "chromium");
const screenshots = !flag("no-screenshots");
const outRoot = path.resolve(opt("out", path.join(os.homedir(), "GoldiaBackups")));
const repo = path.resolve(__dirname, "..");
if (outRoot.toLowerCase().startsWith(repo.toLowerCase())) { console.error("STOPPED: the output folder must be outside the repository"); process.exit(1); }
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const outDir = path.join(outRoot, `smoke-${targetName}-${stamp}`);
fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });

let playwright;
try { playwright = require("playwright"); } catch { try { playwright = require("@playwright/test"); } catch { console.error("STOPPED: Playwright is not installed - run `npm ci` in the repository (it does not touch any database)"); process.exit(1); } }

// ---------------------------------------------------------------- results
const R = []; // { id, area, state: PASS|REVIEW|FAIL|INFO, title, detail }
const log = (s) => { console.log(s); fs.appendFileSync(path.join(outDir, "SUMMARY.txt"), s + os.EOL); };
function check(id, area, state, title, detail = "") {
  R.push({ id, area, state, title, detail });
  const tag = state.padEnd(6);
  log(`${tag} ${id} ${title}${detail ? " | " + String(detail).slice(0, 400) : ""}`);
}
const near = (a, b, eps = 0.00005) => Math.abs(Number(a) - Number(b)) <= eps;
const digits = (s) => String(s || "").replace(/[^0-9]/g, "");

// ---------------------------------------------------------------- prompts
function promptVisible(q) {
  return new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); resolve(a.trim()); }); });
}
function promptHidden(q) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") { console.error("STOPPED: an interactive terminal is needed for the hidden password prompt"); process.exit(1); }
    process.stdout.write(q); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let v = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); process.stdout.write(os.EOL); resolve(v); return; }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") v = v.slice(0, -1); else v += ch;
      }
    };
    stdin.on("data", onData);
  });
}
async function credentials() {
  const c = {};
  // test-only: a credentials file is accepted for staging, never for production
  if (process.env.GOLDIA_SMOKE_CREDS_FILE) {
    if (targetName !== "staging") { console.error("STOPPED: GOLDIA_SMOKE_CREDS_FILE is accepted only with --target staging"); process.exit(1); }
    const f = JSON.parse(fs.readFileSync(process.env.GOLDIA_SMOKE_CREDS_FILE, "utf8"));
    for (const r of roles) c[r] = f[r];
    return c;
  }
  for (const r of roles) {
    const email = await promptVisible(`${r} email: `);
    const password = await promptHidden(`${r} password (hidden): `);
    if (!email || !password) { console.error(`STOPPED: empty ${r} credentials`); process.exit(1); }
    c[r] = { email, password };
  }
  return c;
}

// ---------------------------------------------------------------- write guard
function supabaseRef(u) { const m = /^https:\/\/([a-z0-9]+)\.supabase\.co\//.exec(u); return m ? m[1] : null; }
async function guard(ctx, S) {
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url(); const method = req.method();
    const ref = supabaseRef(url);
    const bad = FORBIDDEN_REFS.find((f) => url.includes(f));
    if (bad || (ref && ref !== T.ref)) { S.foreign.push(method + " " + url.split("?")[0]); return route.abort("blockedbyclient"); }
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
    const p = url.split("?")[0];
    if (ref && method === "POST" && p.endsWith("/auth/v1/token")) return route.continue();
    if (ref && method === "POST" && p.includes("/rest/v1/rpc/")) {
      const name = p.split("/rest/v1/rpc/")[1];
      if (READ_RPCS.has(name)) return route.continue();
      S.blocked.push({ method, what: "rpc " + name, expected: EXPECTED_BLOCKS.has(name), page: S.page });
      return route.abort("blockedbyclient");
    }
    S.blocked.push({ method, what: ref ? p.replace(/^https:\/\/[^/]+/, "") : p.replace(T.base, ""), expected: false, page: S.page });
    return route.abort("blockedbyclient");
  });
}
function observe(page, S) {
  page.on("pageerror", (e) => S.pageErrors.push({ page: S.page, msg: String(e.message || e).slice(0, 200) }));
  page.on("console", (m) => { if (m.type() === "error") S.consoleErrors.push({ page: S.page, msg: m.text().slice(0, 200) }); });
  page.on("request", (q) => { const h = q.headers(); if (supabaseRef(q.url()) === T.ref && h.authorization && /^Bearer /.test(h.authorization) && h.apikey) { if (h.authorization.slice(7) !== h.apikey) S.token = h.authorization.slice(7); S.apikey = h.apikey; } });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) { try { S.nav.push(new URL(f.url()).pathname); } catch { /* ignore */ } } });
  page.on("response", async (r) => {
    const u = r.url(); const ref = supabaseRef(u); const own = u.startsWith(T.base);
    // Supabase Auth password login: status + error code only (the body is read only when the login FAILED - no token)
    if (ref && u.split("?")[0].endsWith("/auth/v1/token") && r.request().method() === "POST") {
      const a = { status: r.status() };
      if (r.status() >= 400) { try { const b = await r.json(); a.code = String(b.error_code || b.error || b.code || "").slice(0, 60); a.msg = String(b.msg || b.error_description || b.message || "").slice(0, 120); } catch { /* ignore */ } }
      S.auth.push(a);
    }
    if (!ref && !own) return;
    const p = u.split("?")[0].replace(/^https:\/\/[^/]+/, "");
    if (r.status() >= 400) S.http.push({ page: S.page, status: r.status(), path: p });
    if (ref && p === "/rest/v1/rpc/rpc_get_seller_rates" && r.status() === 200) { try { S.sellerRates = await r.json(); } catch { /* ignore */ } }
  });
}

// ---------------------------------------------------------------- REST reads (GET only) with the browser session
async function apiGet(S, pathQuery, { anon = false, range } = {}) {
  const headers = { apikey: S.apikey, Accept: "application/json" };
  if (!anon) headers.Authorization = "Bearer " + S.token;
  if (range) { headers["Range-Unit"] = "items"; headers.Range = range; }
  const r = await S.ctx.request.get(`https://${T.ref}.supabase.co/rest/v1/${pathQuery}`, { headers, failOnStatusCode: false });
  let body = null; try { body = await r.json(); } catch { body = null; }
  return { status: r.status(), body };
}
async function apiAll(S, table, select) {
  const rows = []; const page = 1000;
  for (let from = 0; from < 200000; from += page) {
    const r = await apiGet(S, `${table}?select=${select}`, { range: `${from}-${from + page - 1}` });
    if (r.status >= 400 || !Array.isArray(r.body)) return { status: r.status, rows: null };
    rows.push(...r.body);
    if (r.body.length < page) break;
  }
  return { status: 200, rows };
}
const sum = (rows, k) => rows.reduce((a, x) => a + Number(x[k] || 0), 0);
function jwtSub(t) { try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).sub; } catch { return null; } }

// ---------------------------------------------------------------- browser steps
async function openPage(S, p, label) {
  S.page = p;
  const http0 = S.http.length; const err0 = S.pageErrors.length;
  let nav = null;
  try { nav = await S.p.goto(T.base + p, { waitUntil: "networkidle", timeout: 45000 }); }
  catch { try { nav = await S.p.goto(T.base + p, { waitUntil: "load", timeout: 45000 }); } catch (e) { return { ok: false, why: "navigation failed: " + String(e.message).slice(0, 120) }; } }
  await S.p.waitForTimeout(1500);
  const finalPath = new URL(S.p.url()).pathname;
  const text = (await S.p.locator("body").innerText().catch(() => "")) || "";
  const crash = /Application error|Unhandled Runtime Error|Internal Server Error|This page could not be found/i.test(text);
  const httpAll = S.http.slice(http0);
  const http = httpAll.filter((h) => !EXTERNAL.includes(h.path));
  const fatal = http.filter((h) => h.status >= 500 || h.status === 401 || h.status === 403);
  const other4xx = http.filter((h) => h.status >= 400 && h.status < 500 && h.status !== 401 && h.status !== 403);
  const errs = S.pageErrors.slice(err0).filter((e) => !isHydration(e.msg));
  const hydration = S.pageErrors.slice(err0).some((e) => isHydration(e.msg));
  if (screenshots) await S.p.screenshot({ path: path.join(outDir, "screenshots", `${label}${p.replace(/\//g, "_")}.png`), fullPage: false }).catch(() => {});
  return { ok: true, status: nav ? nav.status() : 0, finalPath, crash, fatal, other4xx, errs, hydration, text };
}
async function login(br, role, cred, viewport) {
  const ctx = await br.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, locale: "uz-UZ" });
  const S = { role, ctx, page: "/sales/login", blocked: [], foreign: [], http: [], pageErrors: [], consoleErrors: [], token: null, apikey: null, sellerRates: null, auth: [], nav: [] };
  await guard(ctx, S);
  S.p = await ctx.newPage(); observe(S.p, S);
  await S.p.goto(T.base + "/sales/login", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await S.p.fill('input[type="email"]', cred.email);
  await S.p.fill('input[type="password"]', cred.password);
  await Promise.all([S.p.waitForURL((u) => !u.pathname.startsWith("/sales/login"), { timeout: 45000 }).catch(() => {}), S.p.click('button[type="submit"]')]);
  await S.p.waitForTimeout(2500);
  S.loggedIn = !new URL(S.p.url()).pathname.startsWith("/sales/login") && !!S.token;
  if (!S.loggedIn) {
    // why: Auth answer, the message the login page shows, where the browser went, demo-account block - no secrets
    const banner = await S.p.locator("text=/⚠️/").first().innerText({ timeout: 2000 }).catch(() => "");
    const a = S.auth[S.auth.length - 1];
    const reason = !S.auth.length ? (DEMO_EMAILS.has(String(cred.email).trim().toLowerCase()) || String(cred.email).trim().toLowerCase().startsWith("demo.")
      ? "the e-mail is a demo account - production refuses it before Supabase Auth" : "no Supabase Auth request was sent (login page did not submit)")
      : a.status === 200 ? (S.nav.some((x) => x.startsWith("/sales/app")) ? "Auth OK, the app page sent the browser back to the login page (no session on the server)" : "Auth OK, but the page did not leave the login page")
      : a.status === 429 ? "Supabase Auth rate limit (too many attempts) - wait and retry"
      : /invalid_credentials|invalid_grant/i.test(`${a.code} ${a.msg}`) ? "Supabase Auth refused e-mail / password (invalid_credentials) - check the typed credentials"
      : /banned/i.test(`${a.code} ${a.msg}`) ? "the Auth user is banned"
      : /not.?confirmed/i.test(`${a.code} ${a.msg}`) ? "the Auth user's e-mail is not confirmed"
      : `Supabase Auth HTTP ${a.status}`;
    S.loginWhy = { reason, auth: S.auth, page_message: String(banner).replace(/\s+/g, " ").replace(/✕/g, "").trim().slice(0, 160), navigation: S.nav.slice(-6) };
  }
  return S;
}

// ---------------------------------------------------------------- main
(async () => {
  log(`GOLDIA SALES read-only smoke - target ${targetName} ${T.base} (Supabase ${T.ref}) at ${new Date().toISOString()}`);
  log(`write guard: GET/HEAD/OPTIONS + Auth login + ${READ_RPCS.size} read RPCs allowed; every other request is aborted in the browser`);
  const creds = await credentials();

  // 1. version
  let br;
  const launchOpts = channel === "chromium" ? { executablePath: process.env.GOLDIA_CHROMIUM || undefined } : { channel };
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;   // corporate / sandbox proxy, if the computer has one
  if (proxy) launchOpts.proxy = { server: proxy };
  try { br = await playwright.chromium.launch(launchOpts); }
  catch (e) { console.error(`STOPPED: cannot start the browser (${channel}): ${String(e.message).split("\n")[0]} - try --channel chrome`); process.exit(1); }
  const vctx = await br.newContext();
  const vr = await vctx.request.get(T.base + "/api/version", { failOnStatusCode: false });
  let v = null; try { v = await vr.json(); } catch { v = null; }
  fs.writeFileSync(path.join(outDir, "version.json"), JSON.stringify(v, null, 2));
  check("V1", "version", vr.status() === 200 && v && v.status === "ok" ? "PASS" : "FAIL", "/api/version answers", `http ${vr.status()}`);
  if (v) {
    check("V2", "version", v.supabase_ref === T.ref ? "PASS" : "FAIL", "frontend talks to the right Supabase project", `supabase_ref=${v.supabase_ref} expected=${T.ref}`);
    check("V3", "version", !expectCommit || String(v.full_commit || "").startsWith(expectCommit) || String(v.commit || "") === expectCommit.slice(0, 7) ? "PASS" : "FAIL", "deployed commit", `commit=${v.commit} expected=${expectCommit || "(not given)"}`);
    check("V4", "version", v.env === T.env && (targetName !== "production" || v.staging_mode === false) ? "PASS" : "FAIL", "environment flags", `env=${v.env} staging_mode=${v.staging_mode}`);
  }
  await vctx.close();

  let baseLines = null;
  if (baselineFile) {
    baseLines = {};
    for (const l of fs.readFileSync(baselineFile, "utf8").split(/\r?\n/)) { const t = l.trim().replace(/\s*\|\s*/g, "|"); const m = /^BASELINE\|([^|]+)\|(.*)$/.exec(t); if (m) baseLines[m[1]] = m[2]; }
    log(`post-release SQL baseline: ${baselineFile} (${Object.keys(baseLines).length} lines, history ${baseLines["history latest"] || "-"})`);
  }

  const sessions = {};
  for (const role of roles) {
    const S = await login(br, role, creds[role], { width: 1366, height: 860 });
    sessions[role] = S;
    check(`L-${role}`, "login", S.loggedIn ? "PASS" : "FAIL", `${role} logs in`, `landed on ${new URL(S.p.url()).pathname}` + (S.loginWhy ? ` | ${S.loginWhy.reason} | auth=${S.loginWhy.auth.map((x) => `${x.status}${x.code ? " " + x.code : ""}`).join(",") || "none"} | page="${S.loginWhy.page_message}" | nav=${S.loginWhy.navigation.join(">")}` : ""));
    if (!S.loggedIn) continue;
    const sub = jwtSub(S.token);
    const me = await apiGet(S, `employees?select=id,organization_id,role,role_type,is_active&user_id=eq.${sub}`);
    S.emp = Array.isArray(me.body) && me.body[0] ? me.body[0] : null;
    check(`E-${role}`, "login", S.emp && S.emp.is_active ? "PASS" : "FAIL", `${role} has an active employee row (own row readable)`, S.emp ? `role=${S.emp.role} role_type=${S.emp.role_type || "-"}` : `http ${me.status}`);

    // 2. pages
    for (const p of PAGES[role]) {
      const o = await openPage(S, p, role);
      if (!o.ok) { check(`P-${role}${p}`, "pages", "FAIL", `${role} ${p}`, o.why); continue; }
      const st = o.crash || o.fatal.length || o.status >= 500 ? "FAIL" : o.errs.length || o.other4xx.length ? "REVIEW" : "PASS";
      const det = [`http ${o.status}`, o.finalPath !== p ? `-> ${o.finalPath}` : "", o.crash ? "CRASH TEXT" : "", o.fatal.length ? "fatal: " + o.fatal.map((h) => h.status + " " + h.path).join(", ") : "",
        o.other4xx.length ? "4xx: " + [...new Set(o.other4xx.map((h) => h.status + " " + h.path))].join(", ") : "", o.errs.length ? "js: " + o.errs.map((e) => e.msg).join(" / ") : "", o.hydration ? "(React hydration notice #418, recovered on the client)" : ""].filter(Boolean).join(" ");
      check(`P-${role}${p}`, "pages", st, `${role} ${p}`, det);
    }

    // 3. seller's own rates: Kassam card and dashboard show exactly the server values
    if (role === "seller") {
      S.sellerRates = null;
      await openPage(S, "/sales/app/kassam", "seller-rates");
      await S.p.waitForSelector('[data-testid="own-lom-rate"]', { timeout: 15000 }).catch(() => {});
      const own = S.sellerRates && Array.isArray(S.sellerRates.sellers) ? S.sellerRates.sellers[0] : null;
      const lomTxt = await S.p.locator('[data-testid="own-lom-rate"]').first().innerText().catch(() => null);
      const usdTxt = await S.p.locator('[data-testid="own-usd-rate"]').first().innerText().catch(() => null);
      if (!S.sellerRates) check("R1", "rates", "FAIL", "seller rates loaded from the server (rpc_get_seller_rates)", "no response");
      else {
        const expLom = own && own.lom_rate_uzs ? digits(Math.round(Number(own.lom_rate_uzs))) : "";
        const expUsd = own && own.usd_rate_uzs ? digits(Math.round(Number(own.usd_rate_uzs))) : "";
        check("R1", "rates", lomTxt !== null && (expLom ? digits(lomTxt) === expLom : /rasmiy/i.test(lomTxt)) ? "PASS" : "FAIL", "Kassam shows the seller's own LOM rate", `shown="${lomTxt}" server=${own ? own.lom_rate_uzs : "none"} official=${S.sellerRates.official_585_rate}`);
        check("R2", "rates", usdTxt !== null && (expUsd ? digits(usdTxt) === expUsd : /belgilanmagan/i.test(usdTxt)) ? "PASS" : "FAIL", "Kassam shows the seller's own USD rate", `shown="${usdTxt}" server=${own ? own.usd_rate_uzs : "none"}`);
        check("R3", "rates", !own || !own.seller_id || own.seller_id === (S.emp && S.emp.id) ? "PASS" : "FAIL", "the rates returned are the logged-in seller's own", own ? "seller_id matches employee" : "no own rates yet");
        S.page = "/sales/app";
        await openPage(S, "/sales/app", "seller-dashboard");
        const dash = await S.p.locator('[data-testid="dashboard-rates"]').first().innerText().catch(() => null);
        if (dash === null) check("R4", "rates", "REVIEW", "dashboard rate tile", "tile not found");
        else {
          const dd = digits(dash);
          const ok = (!expLom || dd.includes(expLom)) && (!expUsd || dd.includes(expUsd));
          check("R4", "rates", ok ? "PASS" : "FAIL", "dashboard 'Bugungi kurslarim' shows the same LOM / USD", dash.replace(/\s+/g, " ").slice(0, 120));
        }
      }
    }
  }

  // 4/5. director's balances through safe reads = organization line of the post-release SQL baseline
  const D = sessions.director && sessions.director.loggedIn && sessions.director.emp ? sessions.director : null;
  if (D) {
    const org = D.emp.organization_id;
    const cga = await apiAll(D, "client_gold_accounts", "current_debt_grams,advance_balance_grams,organization_id");
    const sga = await apiAll(D, "seller_gold_accounts", "current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount,organization_id");
    const mva = await apiAll(D, "manager_vault_account", "manager_physical_stock_g,manager_cash_amount,manager_usd_amount,current_factory_obligation_g,organization_id");
    if (!cga.rows || !sga.rows || !mva.rows) check("B0", "balances", "FAIL", "director can read the balance tables", `client=${cga.status} seller=${sga.status} vault=${mva.status}`);
    else {
      const api = {
        debt_g: sum(cga.rows, "current_debt_grams"), adv_g: sum(cga.rows, "advance_balance_grams"),
        sel_stock_g: sum(sga.rows, "current_physical_stock_g"), sel_owes_g: sum(sga.rows, "seller_owes_manager_g"),
        till_uzs: sum(sga.rows, "seller_till_cash_amount"), till_usd: sum(sga.rows, "seller_till_usd_amount"),
        mgr_stock_g: sum(mva.rows, "manager_physical_stock_g"), mgr_uzs: sum(mva.rows, "manager_cash_amount"), mgr_usd: sum(mva.rows, "manager_usd_amount"),
        fac_obl_g: sum(mva.rows, "current_factory_obligation_g"),
      };
      const foreign = [...cga.rows, ...sga.rows, ...mva.rows].filter((x) => x.organization_id && x.organization_id !== org).length;
      check("B1", "balances", foreign === 0 ? "PASS" : "FAIL", "director sees only own organization's balance rows", `foreign rows=${foreign}`);
      check("B2", "balances", "INFO", "director's organization totals (API)", Object.entries(api).map(([k, x]) => `${k}=${Number(x).toFixed(4)}`).join(" "));
      fs.writeFileSync(path.join(outDir, "director-balances.json"), JSON.stringify({ organization_id: org, api }, null, 2));
      if (!baseLines) check("B3", "balances", "REVIEW", "balances compared with the post-release SQL baseline", "no --baseline file given");
      else if (!baseLines["org " + org]) check("B3", "balances", "FAIL", "balances compared with the post-release SQL baseline", "organization line not in the baseline file");
      else {
        const b = {}; for (const kv of baseLines["org " + org].split(" ")) { const [k, x] = kv.split("="); b[k] = x; }
        const diffs = Object.keys(api).filter((k) => b[k] !== undefined && !near(api[k], b[k], k.endsWith("_g") ? 0.00005 : 0.005)).map((k) => `${k}: api=${Number(api[k]).toFixed(4)} sql=${b[k]}`);
        check("B3", "balances", diffs.length === 0 ? "PASS" : "REVIEW", "director's balances (debt, advance, stock, tills, vault, factory obligation) = SQL baseline of the organization", diffs.join("; ") || "all equal");
      }
    }
  } else check("B0", "balances", "REVIEW", "balances", "director session not available");

  // 6. RLS through safe GET reads (no write attempts)
  for (const [role, S] of Object.entries(sessions)) {
    if (!S.loggedIn || !S.emp) continue;
    const org = S.emp.organization_id;
    const probes = [["organizations", `organizations?select=id&id=neq.${org}&limit=5`]];
    for (const t of ["customers", "jewelry_sales", "client_gold_accounts", "seller_gold_accounts", "manager_vault_account", "gold_settlements", "employees"]) probes.push([t, `${t}?select=organization_id&organization_id=neq.${org}&limit=5`]);
    if (role === "seller") for (const t of ["seller_gold_accounts", "jewelry_sales", "client_gold_accounts", "gold_settlements", "consignment_pieces"]) probes.push([t + " (other seller)", `${t}?select=seller_id&seller_id=neq.${S.emp.id}&limit=5`]);
    const leaks = []; const errs = [];
    for (const [name, q] of probes) {
      const r = await apiGet(S, q);
      if (r.status === 200 && Array.isArray(r.body)) { if (r.body.length) leaks.push(`${name}=${r.body.length}`); }
      else if (r.status !== 401 && r.status !== 403) errs.push(`${name} http ${r.status}`);
    }
    check(`S-${role}`, "rls", leaks.length ? "FAIL" : errs.length ? "REVIEW" : "PASS", `${role} cannot read other organizations${role === "seller" ? " or other sellers" : ""} (${probes.length} GET probes)`, leaks.join(", ") || errs.join(", ") || "0 foreign rows");
  }
  const any = Object.values(sessions).find((s) => s.apikey);
  if (any) {
    const leaks = [];
    for (const t of ["customers", "jewelry_sales", "client_gold_accounts", "seller_gold_accounts", "manager_vault_account", "employees", "organizations"]) {
      const r = await apiGet(any, `${t}?select=*&limit=1`, { anon: true });
      if (r.status === 200 && Array.isArray(r.body) && r.body.length) leaks.push(t);
    }
    check("S-anon", "rls", leaks.length ? "FAIL" : "PASS", "anonymous (apikey only) reads no business rows", leaks.join(", ") || "7 tables, 0 rows");
  }

  // 7. mobile 390 px
  for (const role of roles) {
    if (!sessions[role] || !sessions[role].loggedIn) continue;
    const S = await login(br, role, creds[role], { width: 390, height: 844 });
    sessions[role + "-mobile"] = S;
    if (!S.loggedIn) { check(`M-${role}`, "mobile", "FAIL", `${role} logs in on mobile`, ""); continue; }
    for (const p of MOBILE_PAGES[role]) {
      const o = await openPage(S, p, role + "-mobile");
      if (!o.ok) { check(`M-${role}${p}`, "mobile", "FAIL", `${role} mobile ${p}`, o.why); continue; }
      const w = await S.p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      const st = o.crash || o.fatal.length ? "FAIL" : w.sw > w.iw + 1 || o.errs.length ? "REVIEW" : "PASS";
      check(`M-${role}${p}`, "mobile", st, `${role} mobile 390px ${p}`, `scrollWidth=${w.sw} innerWidth=${w.iw}${o.fatal.length ? " fatal: " + o.fatal.map((h) => h.status + " " + h.path).join(", ") : ""}${o.errs.length ? " js: " + o.errs.map((e) => e.msg).join(" / ") : ""}`);
    }
  }

  // staging only: prove the guard by attempting real writes from the page (they must never reach the server)
  if (flag("self-test-guard")) {
    if (targetName !== "staging") { console.error("STOPPED: --self-test-guard is accepted only with --target staging"); process.exit(1); }
    const S = sessions.seller && sessions.seller.loggedIn ? sessions.seller : null;
    if (!S) check("GT", "guard", "FAIL", "guard self-test", "seller session missing");
    else {
      const before = S.blocked.length;
      const res = await S.p.evaluate(async ({ ref, token, apikey }) => {
        const h = { "Content-Type": "application/json", apikey, Authorization: "Bearer " + token };
        const out = [];
        for (const [u, m, b] of [[`https://${ref}.supabase.co/rest/v1/rpc/rpc_set_my_seller_rates`, "POST", { p_lom_rate_uzs: 911111, p_usd_rate_uzs: 13333, p_reason: "guard self-test" }],
          [`https://${ref}.supabase.co/rest/v1/rpc/rpc_create_customer_with_code`, "POST", { p_contact_name: "GUARD SELF TEST" }],
          [`https://${ref}.supabase.co/rest/v1/customers?id=eq.00000000-0000-0000-0000-000000000000`, "PATCH", { contact_name: "x" }],
          ["/api/sales/telegram/link", "POST", { linkCode: "000000" }]]) {
          try { const r = await fetch(u, { method: m, headers: h, body: JSON.stringify(b) }); out.push(m + " " + u.split("/").pop() + " -> http " + r.status); } catch (e) { out.push(m + " " + u.split("/").pop() + " -> blocked"); }
        }
        return out;
      }, { ref: T.ref, token: S.token, apikey: S.apikey });
      const allBlocked = res.every((x) => x.endsWith("-> blocked")) && S.blocked.length - before === 4;
      check("GT", "guard", allBlocked ? "PASS" : "FAIL", "guard self-test: 4 real write attempts from the page are aborted before leaving the browser", res.join("; "));
      S.blocked.splice(before);   // self-test attempts are not app behaviour
    }
  }

  const ext = Object.values(sessions).flatMap((s) => s.http.filter((h) => EXTERNAL.includes(h.path)));
  check("X1", "external", "INFO", "Central Bank (CBU) currency service through /api/sales/currency/cbu", ext.length ? `unavailable (${[...new Set(ext.map((h) => h.status))].join(",")}) on ${ext.length} page load(s) - the app keeps working with the stored rates` : "answered on every page");

  // write guard report
  const all = Object.values(sessions);
  const foreign = all.flatMap((s) => s.foreign);
  check("G1", "guard", foreign.length ? "FAIL" : "PASS", "no request to another Supabase project", foreign.slice(0, 5).join(", ") || "none");
  const blocked = all.flatMap((s) => s.blocked.map((b) => ({ role: s.role, ...b })));
  const unexpected = blocked.filter((b) => !b.expected);
  const exp = {}; for (const b of blocked.filter((x) => x.expected)) exp[b.what] = (exp[b.what] || 0) + 1;
  check("G2", "guard", "INFO", "writes the app tried on login / page view, blocked by the guard (expected)", Object.entries(exp).map(([k, n]) => `${k} x${n}`).join(", ") || "none");
  check("G3", "guard", unexpected.length ? "REVIEW" : "PASS", "no other write attempted while only browsing", unexpected.slice(0, 8).map((b) => `${b.role} ${b.page}: ${b.method} ${b.what}`).join(", ") || "none");
  fs.writeFileSync(path.join(outDir, "blocked-requests.json"), JSON.stringify(blocked, null, 2));
  const cons = all.flatMap((s) => s.consoleErrors.map((c) => ({ role: s.role, ...c })));
  fs.writeFileSync(path.join(outDir, "console-errors.json"), JSON.stringify(cons, null, 2));
  check("C1", "errors", "INFO", "browser console errors (mostly the aborted requests)", `${cons.length} - see console-errors.json`);

  await br.close();
  const fails = R.filter((x) => x.state === "FAIL"); const reviews = R.filter((x) => x.state === "REVIEW");
  const result = fails.length ? "FAIL" : reviews.length ? "REVIEW" : "PASS";
  fs.writeFileSync(path.join(outDir, "RESULT.json"), JSON.stringify({ target: targetName, base: T.base, ref: T.ref, version: v, result, counts: { pass: R.filter((x) => x.state === "PASS").length, review: reviews.length, fail: fails.length }, checks: R }, null, 2));
  log("");
  log(`RESULT: ${result} - ${R.filter((x) => x.state === "PASS").length} PASS, ${reviews.length} REVIEW, ${fails.length} FAIL; nothing was written (guard blocked ${blocked.length} write request(s)); folder ${outDir}`);
  process.exit(result === "PASS" ? 0 : result === "REVIEW" ? 2 : 1);
})().catch((e) => { console.error("STOPPED: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" ")); process.exit(1); });
