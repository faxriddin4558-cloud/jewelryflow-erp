// GOLDIA SALES - backup connection over a slow / unstable link (2026-11-18). Pure helpers, no I/O of their own.
//
// Seen on staging (Supavisor logs, 089 run): one pg_dump connection streamed for 133 s from the owner's computer to
// ap-southeast-2, then the CLIENT closed it while busy (keepalives_idle=30 interval=10 count=6 = ~90 s without an
// answer); the next two attempts 15 s / 30 s later never reached the pooler (the computer's link was still down).
// So: a stall of the link no longer kills a dump that is still progressing (longer keepalive tolerance), and a retry
// first waits until the database answers again instead of a fixed pause. Every acceptance check of the backup
// (full schemas, pg_restore --list, SHA256SUMS, restore test, unchanged during the dump) stays where it is.
"use strict";

// probe after 60 s without traffic, every 20 s, give up after 15 unanswered probes (~6 min of silence)
const KEEPALIVE = "keepalives=1 keepalives_idle=60 keepalives_interval=20 keepalives_count=15 connect_timeout=30";
const DUMP_ATTEMPTS = 5;

/** conninfo for pg_dump -d: the database name + the keepalive settings (host / user / password come from PG* env) */
const dumpConninfo = (db) => `dbname=${db} ${KEEPALIVE}`;

/** pause before attempt n+1 (after a failed attempt n): 15, 30, 45, 60, 60 ... seconds */
const pauseAfter = (attempt) => Math.min(60, 15 * attempt);

/**
 * Waits until probe() returns true (the database answers a trivial read), checking every `everySeconds`, at most
 * `maxSeconds`. probe / sleep are injected (sleep takes seconds). Returns { ok, waitedSeconds, probes }.
 */
function waitForNetwork(probe, sleep, { maxSeconds = 600, everySeconds = 15 } = {}) {
  let waited = 0, probes = 0;
  for (;;) {
    probes++;
    if (probe()) return { ok: true, waitedSeconds: waited, probes };
    if (waited + everySeconds > maxSeconds) return { ok: false, waitedSeconds: waited, probes };
    sleep(everySeconds);
    waited += everySeconds;
  }
}

/** the last meaningful stderr lines of a failed pg_dump (the first ERROR line alone hides "could not receive data") */
const stderrTail = (s, n = 3) => String(s || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n).join(" | ");

module.exports = { KEEPALIVE, DUMP_ATTEMPTS, dumpConninfo, pauseAfter, waitForNetwork, stderrTail };
