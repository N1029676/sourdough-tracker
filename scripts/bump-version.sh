#!/usr/bin/env bash
# Stamp js/version.js with the current UTC date/time (yymmddhhmm). Run before EVERY commit.
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(date -u +%y%m%d%H%M)  # always UTC so the stamp does not depend on the machine timezone
printf '// App version = build date/time in UTC (yymmddhhmm). Refresh with scripts/bump-version.sh before every commit.\nglobalThis.APP_VERSION = "%s";\n' "$v" > js/version.js
echo "APP_VERSION=$v"
