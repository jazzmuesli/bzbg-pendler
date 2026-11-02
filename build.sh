#!/usr/bin/env bash
# build.sh - Build simulation.html from source modules.
#
# Steps:
#   1. Run the automated test suite (must pass before building)
#   2. Build simulation.html (inlines all JS + data into a single self-contained HTML)
#
# Usage:
#   ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "== Running test suite =="
node test/simulation_test.js

echo "== Building simulation.html =="
python3 build_simulation.py

echo "== Build complete =="
echo "   Output: simulation.html ($(wc -c < simulation.html) bytes)"
echo "   Open:   open simulation.html"
