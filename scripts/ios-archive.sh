#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f ".env.apple.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.apple.local"
  set +a
fi

IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-com.joncooper.beachcar}"
IOS_MARKETING_VERSION="${IOS_MARKETING_VERSION:-0.1.0}"
IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
ARCHIVE_ROOT="${IOS_ARCHIVE_ROOT:-build/ios}"
ARCHIVE_PATH="${IOS_ARCHIVE_PATH:-${ARCHIVE_ROOT}/Beachcar-${IOS_BUILD_NUMBER}.xcarchive}"
DERIVED_DATA="${IOS_DERIVED_DATA:-ios/DerivedDataRelease}"

auth_args=()
if [[ -n "${ASC_KEY_ID:-}" || -n "${ASC_ISSUER_ID:-}" || -n "${ASC_KEY_PATH:-}" ]]; then
  if [[ -z "${ASC_KEY_ID:-}" || -z "${ASC_ISSUER_ID:-}" || -z "${ASC_KEY_PATH:-}" ]]; then
    echo "ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH must be set together." >&2
    exit 1
  fi
  expanded_key_path="${ASC_KEY_PATH/#\~/$HOME}"
  if [[ ! -f "$expanded_key_path" ]]; then
    echo "App Store Connect key not found: $expanded_key_path" >&2
    exit 1
  fi
  auth_args=(
    -authenticationKeyPath "$expanded_key_path"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
fi

signing_settings=(
  CODE_SIGN_STYLE=Automatic
  PRODUCT_BUNDLE_IDENTIFIER="$IOS_BUNDLE_ID"
  MARKETING_VERSION="$IOS_MARKETING_VERSION"
  CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER"
)

if [[ -n "${APPLE_TEAM_ID:-}" ]]; then
  signing_settings+=(DEVELOPMENT_TEAM="$APPLE_TEAM_ID")
fi

mkdir -p "$ARCHIVE_ROOT"

scripts/ios-generate-icons.sh
xcodegen generate --spec ios/project.yml

echo "Archiving Beachcar ${IOS_MARKETING_VERSION} (${IOS_BUILD_NUMBER})..."
cmd=(
  xcodebuild
  -project ios/Beachcar.xcodeproj
  -scheme Beachcar
  -configuration Release
  -destination "generic/platform=iOS"
  -archivePath "$ARCHIVE_PATH"
  -derivedDataPath "$DERIVED_DATA"
  -allowProvisioningUpdates
)
if ((${#auth_args[@]})); then
  cmd+=("${auth_args[@]}")
fi
cmd+=("${signing_settings[@]}" archive)
"${cmd[@]}"

printf '%s\n' "$ARCHIVE_PATH" > "$ARCHIVE_ROOT/latest-archive-path"

cat <<EOF

Archive complete:
  $ARCHIVE_PATH

Build settings:
  Bundle ID: $IOS_BUNDLE_ID
  Version:   $IOS_MARKETING_VERSION
  Build:     $IOS_BUILD_NUMBER
EOF
if [[ -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "  Team:      $APPLE_TEAM_ID"
else
  echo "  Team:      inferred by xcodebuild"
fi
