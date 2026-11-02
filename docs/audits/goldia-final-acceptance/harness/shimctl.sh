#!/bin/bash
# usage: shimctl.sh restart [ttl]
cd /opt/goldia-audit
for p in $(pgrep -f "^node shim.js"); do kill $p; done; sleep 0.5
set -a; . ./shim.env; set +a
SHIM_JWT_TTL=${2:-3600} setsid nohup node shim.js > shim.log 2>&1 < /dev/null &
sleep 1.2; cat shim.log
