#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2018-present Raman Marozau
#
# Runs the full E2E test suite against the npm-packed tarball.
#
# This simulates what a user gets after `npm install -g versionings`:
# 1. Builds the project
# 2. Creates the tarball via `npm pack`
# 3. Extracts it into a temp directory
# 4. Installs production dependencies
# 5. Runs ALL E2E tests with CLI_PATH pointing to the packed binary
# 6. Cleans up
#
# Usage: npm run test:e2e:pack

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$PACK_DIR"
  rm -f "$PROJECT_ROOT"/versionings-*.tgz
}
trap cleanup EXIT

echo "→ Building..."
npm run build --prefix "$PROJECT_ROOT"

echo "→ Packing..."
cd "$PROJECT_ROOT"
TARBALL=$(npm pack --json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0].filename)")

echo "→ Extracting $TARBALL to $PACK_DIR..."
tar xzf "$TARBALL" -C "$PACK_DIR"

echo "→ Installing production deps..."
cd "$PACK_DIR/package"
npm install --omit=dev --ignore-scripts 2>/dev/null

CLI_BIN="$PACK_DIR/package/out/dist/index.js"
echo "→ CLI binary: $CLI_BIN"
echo "→ Smoke test:"
node "$CLI_BIN" --help | head -3

echo ""
echo "→ Running full E2E suite against packed binary..."
cd "$PROJECT_ROOT"
VERSIONINGS_CLI_PATH="$CLI_BIN" npx jest \
  --testPathPattern='__tests__/e2e/' \
  --testPathIgnorePatterns='pack.integrity' \
  --no-coverage \
  --forceExit

echo ""
echo "✓ All E2E tests passed against npm-packed binary."
