Production chain copy gate failure of 2026-11-06 ("business fingerprint unchanged by 077..080: NO", chainTo=false),
reproduced and fixed on a disposable LOCAL production-shaped copy (076 stand-in, 60 organizations) under Windows
conditions: repository copy with CRLF .sql files (core.autocrlf) + psql wrapper that prints CRLF like psql.exe.

before-fix/  current code (71eee1f): chain applied, postflights true, missing 0, 26 function bodies differ,
             "business fingerprint unchanged by 077..080: NO", chainTo=false, RESULT NO-GO  -> same as production.
Cause: the copy gate split psql output on "\n" only and compared whole lines. On Windows every line but the last keeps
"\r". The fingerprint has no outer ORDER BY; 077 alters jewelry_sales (its pg_class row moves) and creates tables, so
the line that was last before the chain ("rows jewelry_sales|52|", no "\r") is in the middle afterwards ("...|52|\r"):
the old check flagged it although the value is identical (52 rows before and after). All 76 category values identical.
The SQL-side gates inside the chain transaction compare values, so they passed (chain "applied").
Second Windows effect: migrations / rollbacks run from CRLF files store "\r" in function bodies (the 26 md5 differences).

after-fix/   fixed code: value-per-category CR-safe comparison (fingerprintDiff: still reports any changed hash, row
             count, missing or duplicated category), all chain / rollback SQL normalized to LF, every public function
             classified (identical / crlf_only / DIFFERENT / MISSING / EXTRA; any real difference fails), fingerprints
             and diffs saved: chain PASS, function bodies identical=168 different=0, fingerprint unchanged (76
             categories), emergency rollback 080->077 back to 076 (schema + fingerprint), re-apply PASS, chainTo=true.
