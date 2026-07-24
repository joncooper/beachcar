#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

output_dir="assets/brand/build-week"
gallery_dir="$output_dir/gallery-reference"
display_font="ios/BeachcarApp/Resources/Fonts/Archivo-Black.ttf"
mono_font="ios/BeachcarApp/Resources/Fonts/SpaceMono-Bold.ttf"
surrey_art="assets/brand/surrey-key-art.png"

mkdir -p "$output_dir"

magick -size 1920x1080 "xc:#07080a" \
  -fill '#ef5b91' -draw 'rectangle 0,0 1920,18' \
  -fill '#62d18c' -draw 'rectangle 0,830 1920,1080' \
  \( "$surrey_art" -trim -resize '980x700>' \) \
  -gravity southeast -geometry +20+0 -composite \
  -gravity northwest \
  -font "$mono_font" -fill '#ef5b91' -pointsize 28 \
  -annotate +102+120 'OPENAI BUILD WEEK · APPS FOR YOUR LIFE' \
  -font "$display_font" -fill '#f7f4ec' -pointsize 158 -kerning -4 \
  -annotate +90+355 'BEACHCAR' \
  -font "$mono_font" -fill '#ef5b91' -pointsize 42 -kerning 0 \
  -annotate +100+520 'YOUR CODEX. YOUR TASTE.' \
  -font "$display_font" -fill '#f7f4ec' -pointsize 76 \
  -annotate +100+635 'THE ONE.' \
  -fill '#f7f4ec' -draw 'rectangle 100,690 465,696' \
  -font "$mono_font" -pointsize 25 \
  -annotate +100+760 'A PERSONAL AUCTION SCOUT' \
  -depth 8 \
  "$output_dir/beachcar-title-card.png"

hero_photo="$gallery_dir/01-hero-studio.jpg"
if [[ -f "$hero_photo" ]]; then
  magick -size 1920x1080 "xc:#07080a" \
    \( "$hero_photo" -auto-orient -resize '1120x1080^' -gravity center -extent 1120x1080 \) \
    -gravity northwest -geometry +0+0 -composite \
    -fill '#ef5b91' -draw 'rectangle 1120,0 1140,1080' \
    -font "$mono_font" -fill '#62d18c' -pointsize 24 \
    -annotate +1210+120 'THE END-TO-END TEST' \
    -font "$display_font" -fill '#f7f4ec' -pointsize 102 \
    -annotate +1200+300 'IT FOUND' \
    -fill '#ef5b91' -annotate +1200+430 'THE ONE.' \
    -fill '#f7f4ec' -pointsize 88 -annotate +1200+590 'I BOUGHT' \
    -annotate +1200+690 'IT.' \
    -font "$mono_font" -fill '#f7f4ec' -pointsize 24 \
    -annotate +1205+820 '1960 WILLYS DJ-3A SURREY' \
    -fill '#ef5b91' -annotate +1205+865 '$38,000 · JULY 2026' \
    -fill '#8b918e' -pointsize 14 \
    -annotate +1205+1025 'AUCTION PHOTO: BRING A TRAILER LISTING' \
    -depth 8 \
    "$output_dir/beachcar-proof-card.png"
fi

gallery_photos=(
  "$gallery_dir/01-hero-studio.jpg"
  "$gallery_dir/25-grille-detail.jpg"
  "$gallery_dir/55-wheel-detail.jpg"
  "$gallery_dir/65-striped-seat.jpg"
  "$gallery_dir/75-dashboard.jpg"
  "$gallery_dir/115-outdoor-rear.jpg"
)

if [[ -f "${gallery_photos[5]}" ]]; then
  magick montage "${gallery_photos[@]}" \
    -font "$mono_font" \
    -auto-orient -thumbnail '620x390^' -gravity center -extent 620x390 \
    -tile 3x2 -geometry +10+10 -background '#07080a' \
    "$output_dir/.gallery-grid.png"

  magick -size 1920x1080 "xc:#07080a" \
    "$output_dir/.gallery-grid.png" -gravity south -geometry +0+18 -composite \
    -gravity northwest \
    -font "$display_font" -fill '#f7f4ec' -pointsize 82 \
    -annotate +70+112 'PROOF IN PINK.' \
    -font "$mono_font" -fill '#ef5b91' -pointsize 24 \
    -annotate +72+195 'SELECTED FROM THE AUCTION GALLERY · THE CAR, NOT THE CONCEPT' \
    -fill '#8b918e' -pointsize 14 \
    -annotate +1465+195 'PHOTOS: BRING A TRAILER LISTING' \
    -depth 8 \
    "$output_dir/beachcar-gallery-card.png"

  rm "$output_dir/.gallery-grid.png"
fi

echo "Built Build Week brand assets in $output_dir"
