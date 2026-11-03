#!/bin/bash
# Reset the local "staging" stand-in (port 55437) to the 062 baseline with synthetic data.
B=/opt/goldia-audit/pg17bin/native/bin; W=/opt/goldia-audit/pg17
runuser -u postgres -- $B/pg_ctl -D $W/data -m immediate stop >/dev/null 2>&1
rm -rf $W && cp -a /opt/goldia-audit/pg17-base062 $W && runuser -u postgres -- $B/pg_ctl -D $W/data -o "-p 55437 -k $W -c listen_addresses=127.0.0.1" -l $W/pg.log -w start >/dev/null
