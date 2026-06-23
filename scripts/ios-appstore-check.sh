#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f ".env.apple.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.apple.local"
  set +a
fi

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required. Copy .env.apple.example to .env.apple.local and fill it in." >&2
    exit 1
  fi
}

require ASC_KEY_ID
require ASC_ISSUER_ID
require ASC_KEY_PATH

expanded_key_path="${ASC_KEY_PATH/#\~/$HOME}"
if [[ ! -f "$expanded_key_path" ]]; then
  echo "App Store Connect key not found: $expanded_key_path" >&2
  exit 1
fi

mkdir -p ~/.appstoreconnect/private_keys
expected_key_path="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
if [[ "$expanded_key_path" != "$expected_key_path" && ! -f "$expected_key_path" ]]; then
  echo "Tip: altool also searches $expected_key_path. The scripts can use ASC_KEY_PATH directly, so this is informational." >&2
fi

bundle_id="${IOS_BUNDLE_ID:-com.joncooper.beachcar}"

common_args=(
  --api-key "$ASC_KEY_ID"
  --api-issuer "$ASC_ISSUER_ID"
  --p8-file-path "$expanded_key_path"
  --output-format json
)

echo "Checking App Store Connect providers..."
xcrun altool --list-providers "${common_args[@]}"

echo
if [[ -n "${APPLE_PROVIDER_PUBLIC_ID:-}" ]]; then
  echo "Checking for app record with bundle ID $bundle_id..."
  xcrun altool --list-apps \
    --provider-public-id "$APPLE_PROVIDER_PUBLIC_ID" \
    --filter-bundle-id "$bundle_id" \
    "${common_args[@]}"
else
  echo "APPLE_PROVIDER_PUBLIC_ID is not set; after provider check, set it if your account has more than one provider."
  echo "Skipping app-record lookup."
fi
