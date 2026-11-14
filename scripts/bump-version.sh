#!/usr/bin/env bash
# Stamp js/version.js with the current date/time (yymmddhhmm). Run before EVERY commit.
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(date +%y%m%d%H%M)
printf '// App version = build date/time (yymmddhhmm). Refresh with scripts/bump-version.sh before every commit.\nglobalThis.APP_VERSION = "%s";\n' "$v" > js/version.js
echo "APP_VERSION=$v"
