#!/bin/bash
# usage: as.sh <uuid|anon> <sql...>  -- runs SQL as PostgREST would: SET ROLE + request.jwt.claims
U=$1; shift
if [ "$U" = anon ]; then PRE="set role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',false);"
else PRE="set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\",\"role\":\"authenticated\"}',false);"; fi
/usr/lib/postgresql/16/bin/psql -h /opt/goldia-audit/pg -p 55432 -U postgres -d postgres -X -q -tA -c "$PRE" -c "$*" 2>&1 | grep -v '^{"role\|^{"sub\|^$' 
