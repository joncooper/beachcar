#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

DEVICE_NAME="${IOS_DEVICE:-iPhone 16 Pro Max}"
DEVICE_TYPE="${IOS_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max}"
RUNTIME="${IOS_RUNTIME:-$(xcrun simctl list runtimes | awk '/^iOS / { runtime = $NF } END { print runtime }')}"
DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=${DEVICE_NAME}}"
DERIVED_DATA="${DERIVED_DATA:-ios/DerivedData}"
LAUNCH_ARGS=()

if [[ -n "${CLERK_DEV_SIGN_IN_TOKEN:-}" ]]; then
  LAUNCH_ARGS=(--clerk-ticket "$CLERK_DEV_SIGN_IN_TOKEN")
fi

if ! xcrun simctl list devices available | grep -q "${DEVICE_NAME} ("; then
  if [[ -z "$RUNTIME" ]]; then
    echo "No iOS simulator runtime found. Install one with: xcodebuild -downloadPlatform iOS" >&2
    exit 1
  fi
  echo "Creating ${DEVICE_NAME} simulator on ${RUNTIME}..."
  xcrun simctl create "$DEVICE_NAME" "$DEVICE_TYPE" "$RUNTIME" >/dev/null
fi

xcodegen generate --spec ios/project.yml
xcodebuild \
  -project ios/Beachcar.xcodeproj \
  -scheme Beachcar \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  build

APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/Beachcar.app"
xcrun simctl boot "$DEVICE_NAME" 2>/dev/null || true
xcrun simctl install booted "$APP_PATH"
if ((${#LAUNCH_ARGS[@]})); then
  xcrun simctl launch booted com.joncooper.beachcar "${LAUNCH_ARGS[@]}"
else
  xcrun simctl launch booted com.joncooper.beachcar
fi
