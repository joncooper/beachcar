#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

xcodegen generate --spec ios/project.yml
xcodebuild \
  -project ios/Beachcar.xcodeproj \
  -scheme Beachcar \
  -sdk "${IOS_SDK:-iphoneos}" \
  -arch "${IOS_ARCH:-arm64}" \
  CODE_SIGNING_ALLOWED="${CODE_SIGNING_ALLOWED:-NO}" \
  build
