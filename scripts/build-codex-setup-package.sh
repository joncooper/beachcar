#!/bin/sh

set -eu
umask 077

beachcar_repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
beachcar_output_path=${1:-"$beachcar_repo_dir/docs/build-week/Beachcar-Codex-Setup.zip"}
beachcar_temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/beachcar-codex-setup.XXXXXX")
beachcar_payload_dir="$beachcar_temp_dir/Beachcar-Codex-Setup"

cleanup_beachcar_package() {
  case "$beachcar_temp_dir" in
    "${TMPDIR:-/tmp}"/beachcar-codex-setup.*|/tmp/beachcar-codex-setup.*|/private/tmp/beachcar-codex-setup.*)
      rm -rf "$beachcar_temp_dir"
      ;;
  esac
}

trap cleanup_beachcar_package 0 HUP INT TERM

mkdir -p \
  "$beachcar_payload_dir/scripts" \
  "$beachcar_payload_dir/.agents/skills/beachcar-daily-run/agents" \
  "$(dirname -- "$beachcar_output_path")"

cp "$beachcar_repo_dir/support/codex-setup/Install Beachcar.command" "$beachcar_payload_dir/Install Beachcar.command"
cp "$beachcar_repo_dir/support/codex-setup/README.txt" "$beachcar_payload_dir/README.txt"
cp "$beachcar_repo_dir/support/codex-setup/VERSION.txt" "$beachcar_payload_dir/VERSION.txt"
cp "$beachcar_repo_dir/scripts/install-beachcar-codex.sh" "$beachcar_payload_dir/scripts/install-beachcar-codex.sh"
cp "$beachcar_repo_dir/.agents/skills/beachcar-daily-run/SKILL.md" "$beachcar_payload_dir/.agents/skills/beachcar-daily-run/SKILL.md"
cp "$beachcar_repo_dir/.agents/skills/beachcar-daily-run/agents/openai.yaml" "$beachcar_payload_dir/.agents/skills/beachcar-daily-run/agents/openai.yaml"

chmod 755 "$beachcar_payload_dir/Install Beachcar.command" "$beachcar_payload_dir/scripts/install-beachcar-codex.sh"
chmod 644 \
  "$beachcar_payload_dir/README.txt" \
  "$beachcar_payload_dir/VERSION.txt" \
  "$beachcar_payload_dir/.agents/skills/beachcar-daily-run/SKILL.md" \
  "$beachcar_payload_dir/.agents/skills/beachcar-daily-run/agents/openai.yaml"

/usr/bin/xattr -cr "$beachcar_payload_dir"
/usr/bin/find "$beachcar_payload_dir" -exec /usr/bin/touch -t 202607210000 {} +

rm -f "$beachcar_output_path"
(CDPATH= cd -- "$beachcar_temp_dir" && COPYFILE_DISABLE=1 /usr/bin/zip -X -q -r "$beachcar_output_path" "Beachcar-Codex-Setup")
chmod 644 "$beachcar_output_path"

printf 'Built %s\n' "$beachcar_output_path"
