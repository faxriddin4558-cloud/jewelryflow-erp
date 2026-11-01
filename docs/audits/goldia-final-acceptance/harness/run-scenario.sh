#!/bin/bash
# Full business scenario + concurrency + RLS + reconciliation on the current disposable DB. $1 = label
L=$1; cd /opt/goldia-audit; E=evidence/$L; mkdir -p $E
for s in s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s12 s11 s13; do node t/$s.js > $E/$s.log 2>&1; done
node t/conc.js > $E/conc.log 2>&1
node t/show.js > $E/state.log 2>&1
node t/rls.js > $E/rls.log 2>&1; cp rls-matrix.json $E/
node t/sweep.js > $E/sweep.log 2>&1; cp sweep.json $E/
node t/recon.js $PWD/$E/recon.json > $E/recon.log 2>&1
tail -1 $E/recon.log
