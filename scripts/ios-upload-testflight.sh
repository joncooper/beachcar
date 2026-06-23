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

bool_plist_tag() {
  case "${1:-}" in
    YES|yes|true|TRUE|1) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

require ASC_KEY_ID
require ASC_ISSUER_ID
require ASC_KEY_PATH

expanded_key_path="${ASC_KEY_PATH/#\~/$HOME}"
if [[ ! -f "$expanded_key_path" ]]; then
  echo "App Store Connect key not found: $expanded_key_path" >&2
  exit 1
fi

archive_root="${IOS_ARCHIVE_ROOT:-build/ios}"
if [[ -z "${IOS_ARCHIVE_PATH:-}" ]]; then
  if [[ ! -f "$archive_root/latest-archive-path" ]]; then
    echo "No archive path supplied and $archive_root/latest-archive-path does not exist. Run npm run ios:archive first." >&2
    exit 1
  fi
  IOS_ARCHIVE_PATH="$(cat "$archive_root/latest-archive-path")"
fi

if [[ ! -d "$IOS_ARCHIVE_PATH" ]]; then
  echo "Archive not found: $IOS_ARCHIVE_PATH" >&2
  exit 1
fi

export_path="${IOS_EXPORT_PATH:-${archive_root}/export}"
plist_path="$archive_root/ExportOptions.AppStoreConnect.generated.plist"
internal_only_tag="$(bool_plist_tag "${TESTFLIGHT_INTERNAL_ONLY:-YES}")"
bundle_id="${IOS_BUNDLE_ID:-com.joncooper.beachcar}"
profile_name="${IOS_PROVISIONING_PROFILE_NAME:-}"
signing_certificate="${IOS_SIGNING_CERTIFICATE:-Apple Distribution}"

mkdir -p "$export_path" "$archive_root"

cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>upload</string>
  <key>method</key>
  <string>app-store-connect</string>
PLIST

if [[ -n "$profile_name" ]]; then
  if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "APPLE_TEAM_ID is required when IOS_PROVISIONING_PROFILE_NAME is set." >&2
    exit 1
  fi
  cat >> "$plist_path" <<PLIST
  <key>signingStyle</key>
  <string>manual</string>
  <key>teamID</key>
  <string>$(xml_escape "$APPLE_TEAM_ID")</string>
  <key>signingCertificate</key>
  <string>$(xml_escape "$signing_certificate")</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>$(xml_escape "$bundle_id")</key>
    <string>$(xml_escape "$profile_name")</string>
  </dict>
PLIST
else
  cat >> "$plist_path" <<PLIST
  <key>signingStyle</key>
  <string>automatic</string>
PLIST
  if [[ -n "${APPLE_TEAM_ID:-}" ]]; then
    cat >> "$plist_path" <<PLIST
  <key>teamID</key>
  <string>$(xml_escape "$APPLE_TEAM_ID")</string>
PLIST
  fi
fi

cat >> "$plist_path" <<PLIST
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>uploadSymbols</key>
  <true/>
  <key>testFlightInternalTestingOnly</key>
  <${internal_only_tag}/>
</dict>
</plist>
PLIST

echo "Uploading archive to App Store Connect / TestFlight..."
xcodebuild   -exportArchive   -archivePath "$IOS_ARCHIVE_PATH"   -exportPath "$export_path"   -exportOptionsPlist "$plist_path"   -allowProvisioningUpdates   -authenticationKeyPath "$expanded_key_path"   -authenticationKeyID "$ASC_KEY_ID"   -authenticationKeyIssuerID "$ASC_ISSUER_ID"

if [[ "${TESTFLIGHT_ASSIGN_INTERNAL_GROUP:-YES}" != "NO" ]]; then
  echo
  echo "Assigning uploaded build to TestFlight beta group..."
  node scripts/ios-assign-testflight-group.mjs
fi

cat <<EOF

Upload submitted.

Archive:
  $IOS_ARCHIVE_PATH

Export logs/output:
  $export_path

Next: check App Store Connect > TestFlight for processing status. Processing can take several minutes.
EOF
