#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

scripts/ios-archive.sh

TESTFLIGHT_INTERNAL_ONLY=NO \
TESTFLIGHT_ASSIGN_INTERNAL_GROUP=NO \
scripts/ios-upload-testflight.sh

TESTFLIGHT_EXTERNAL=YES \
TESTFLIGHT_BETA_GROUP_NAME="Beachcar Friends" \
bun scripts/ios-assign-testflight-group.mjs

cat <<'EOF'

Beachcar Friends release submitted for external beta review.
After Apple approves the build, invite a friend with:
  bun run friend:invite -- --name "Friend Name" --email friend@example.com
EOF
