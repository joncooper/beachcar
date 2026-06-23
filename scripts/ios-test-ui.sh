#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEVICE_NAME="${IOS_DEVICE:-iPhone 16 Pro Max}"
DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=${DEVICE_NAME}}"
DERIVED_DATA="${DERIVED_DATA:-ios/DerivedDataUITests}"

xcodegen generate --spec ios/project.yml
xcodebuild \
  -project ios/Beachcar.xcodeproj \
  -scheme Beachcar \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  test
