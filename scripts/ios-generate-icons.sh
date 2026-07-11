#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source_icon="${IOS_ICON_SOURCE:-assets/brand/beachcar-icon.png}"
asset_root="ios/BeachcarApp/Resources/Assets.xcassets"
appicon_dir="$asset_root/AppIcon.appiconset"
accent_dir="$asset_root/AccentColor.colorset"

if [[ ! -f "$source_icon" ]]; then
  echo "Icon source not found: $source_icon" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick is required to generate iOS icons. Install with: brew install imagemagick" >&2
  exit 1
fi

mkdir -p "$appicon_dir" "$accent_dir"

make_icon() {
  local px="$1"
  local file="$2"
  local target="$appicon_dir/$file"
  local generated
  generated="$(mktemp "$appicon_dir/.${file}.XXXXXX")"
  if ! magick "$source_icon" \
      -resize "${px}x${px}" \
      -background '#f7f4ec' \
      -gravity center \
      -extent "${px}x${px}" \
      -alpha remove \
      -alpha off \
      "png:$generated"; then
    rm -f "$generated"
    return 1
  fi
  if [[ -f "$target" ]] && magick compare -metric AE "$target" "$generated" null: >/dev/null 2>&1; then
    rm -f "$generated"
  else
    mv "$generated" "$target"
  fi
}

make_icon 40 AppIcon-20@2x.png
make_icon 60 AppIcon-20@3x.png
make_icon 58 AppIcon-29@2x.png
make_icon 87 AppIcon-29@3x.png
make_icon 80 AppIcon-40@2x.png
make_icon 120 AppIcon-40@3x.png
make_icon 120 AppIcon-60@2x.png
make_icon 180 AppIcon-60@3x.png
make_icon 1024 AppIcon-1024.png

cat > "$appicon_dir/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "AppIcon-20@2x.png", "idiom" : "iphone", "scale" : "2x", "size" : "20x20" },
    { "filename" : "AppIcon-20@3x.png", "idiom" : "iphone", "scale" : "3x", "size" : "20x20" },
    { "filename" : "AppIcon-29@2x.png", "idiom" : "iphone", "scale" : "2x", "size" : "29x29" },
    { "filename" : "AppIcon-29@3x.png", "idiom" : "iphone", "scale" : "3x", "size" : "29x29" },
    { "filename" : "AppIcon-40@2x.png", "idiom" : "iphone", "scale" : "2x", "size" : "40x40" },
    { "filename" : "AppIcon-40@3x.png", "idiom" : "iphone", "scale" : "3x", "size" : "40x40" },
    { "filename" : "AppIcon-60@2x.png", "idiom" : "iphone", "scale" : "2x", "size" : "60x60" },
    { "filename" : "AppIcon-60@3x.png", "idiom" : "iphone", "scale" : "3x", "size" : "60x60" },
    { "filename" : "AppIcon-1024.png", "idiom" : "ios-marketing", "scale" : "1x", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON

cat > "$asset_root/Contents.json" <<'JSON'
{
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON

cat > "$accent_dir/Contents.json" <<'JSON'
{
  "colors" : [
    {
      "color" : {
        "color-space" : "srgb",
        "components" : { "alpha" : "1.000", "blue" : "0.373", "green" : "0.435", "red" : "0.184" }
      },
      "idiom" : "universal"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON

echo "Generated iOS icons in $appicon_dir"
