#!/bin/sh

# Install Beachcar's local Codex skill and configure its reduced-scope MCP
# connection without putting the bearer token in command-line arguments or
# Codex's TOML configuration.

set -eu
set +x
umask 077

beachcar_mcp_endpoint="${BEACHCAR_MCP_ENDPOINT:-https://beachcar-watch.jon-cooper.workers.dev/mcp}"
beachcar_codex_dir="${BEACHCAR_CODEX_DIR:-$HOME/.codex}"
beachcar_env_file="$beachcar_codex_dir/.env"
beachcar_config_file="$beachcar_codex_dir/config.toml"
beachcar_skill_destination="$beachcar_codex_dir/skills/beachcar-daily-run"
beachcar_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
beachcar_skill_source="${BEACHCAR_SKILL_SOURCE:-$beachcar_script_dir/../.agents/skills/beachcar-daily-run}"
beachcar_terminal=/dev/tty
beachcar_echo_disabled=0
beachcar_env_tmp=
beachcar_config_tmp=

restore_terminal() {
  if [ "$beachcar_echo_disabled" -eq 1 ]; then
    stty echo < "$beachcar_terminal" 2>/dev/null || true
    beachcar_echo_disabled=0
    printf '\n' > "$beachcar_terminal" 2>/dev/null || true
  fi
}

cleanup() {
  restore_terminal
  if [ -n "$beachcar_env_tmp" ] && [ -f "$beachcar_env_tmp" ]; then
    rm -f "$beachcar_env_tmp"
  fi
  if [ -n "$beachcar_config_tmp" ] && [ -f "$beachcar_config_tmp" ]; then
    rm -f "$beachcar_config_tmp"
  fi
}

trap cleanup 0
trap 'cleanup; exit 1' HUP INT TERM

fail() {
  printf 'Beachcar setup stopped: %s\n' "$1" >&2
  exit 1
}

command -v codex >/dev/null 2>&1 || fail "Codex is not installed or is not on PATH."
[ -r "$beachcar_skill_source/SKILL.md" ] || fail "Beachcar skill not found next to this installer."
tty -s || fail "Run this installer from an interactive terminal."

printf '%s\n' \
  'Paste the Beachcar recurring token shown once in the app.' \
  'Required scopes: setup:read, setup:write, sources:read, runs:publish, events:read.' \
  'The token will not be displayed or added to command history.' > "$beachcar_terminal"
stty -echo < "$beachcar_terminal"
beachcar_echo_disabled=1
printf 'Beachcar token: ' > "$beachcar_terminal"
IFS= read -r beachcar_token < "$beachcar_terminal" || fail "Could not read the token."
restore_terminal

case "$beachcar_token" in
  bcauto_?*.?*) ;;
  *) fail "Expected a bcauto_ recurring token, not an OAuth access token." ;;
esac
case "$beachcar_token" in
  *[!A-Za-z0-9._-]*) fail "The token contains unexpected characters." ;;
esac

mkdir -p "$beachcar_codex_dir" "$beachcar_skill_destination/agents"

beachcar_env_tmp=$(mktemp "$beachcar_env_file.beachcar.XXXXXX")
if [ -f "$beachcar_env_file" ]; then
  awk '
    /^[[:space:]]*(export[[:space:]]+)?BEACHCAR_MCP_TOKEN=/ { next }
    { print }
  ' "$beachcar_env_file" > "$beachcar_env_tmp"
fi
# printf is a shell builtin here: the token never becomes another process's
# argument or environment variable.
printf 'BEACHCAR_MCP_TOKEN=%s\n' "$beachcar_token" >> "$beachcar_env_tmp"
chmod 600 "$beachcar_env_tmp"
mv -f "$beachcar_env_tmp" "$beachcar_env_file"
beachcar_env_tmp=
chmod 600 "$beachcar_env_file"
unset beachcar_token

cp "$beachcar_skill_source/SKILL.md" "$beachcar_skill_destination/SKILL.md"
if [ -r "$beachcar_skill_source/agents/openai.yaml" ]; then
  cp "$beachcar_skill_source/agents/openai.yaml" "$beachcar_skill_destination/agents/openai.yaml"
fi
chmod 644 "$beachcar_skill_destination/SKILL.md"
if [ -f "$beachcar_skill_destination/agents/openai.yaml" ]; then
  chmod 644 "$beachcar_skill_destination/agents/openai.yaml"
fi

# Replacing only the named Beachcar entry makes the installer idempotent and
# leaves every unrelated MCP server and Codex preference intact.
codex mcp remove beachcar >/dev/null 2>&1 || true
codex mcp add beachcar \
  --url "$beachcar_mcp_endpoint" \
  --bearer-token-env-var BEACHCAR_MCP_TOKEN >/dev/null

[ -f "$beachcar_config_file" ] || fail "Codex did not create its configuration file."
beachcar_config_tmp=$(mktemp "$beachcar_config_file.beachcar.XXXXXX")
awk '
  function emit_taste_prompt() {
    if (!taste_prompt_emitted) {
      print ""
      print "[mcp_servers.beachcar.tools.save_taste_calibration]"
      print "approval_mode = \"prompt\""
      taste_prompt_emitted = 1
    }
  }
  BEGIN { in_beachcar = 0; found_beachcar = 0; taste_prompt_emitted = 0 }
  /^\[mcp_servers\.beachcar\]$/ {
    print
    print "enabled_tools = [\"get_setup_context\", \"plan_daily_research\", \"save_taste_calibration\", \"search_bat_cache\", \"submit_candidates\", \"publish_run\", \"verify_latest_run\", \"list_automation_events\"]"
    print "default_tools_approval_mode = \"approve\""
    in_beachcar = 1
    found_beachcar = 1
    next
  }
  in_beachcar && /^\[/ { emit_taste_prompt(); in_beachcar = 0 }
  in_beachcar && /^[[:space:]]*(enabled_tools|default_tools_approval_mode)[[:space:]]*=/ { next }
  { print }
  END {
    if (in_beachcar) emit_taste_prompt()
    if (!found_beachcar) exit 42
  }
' "$beachcar_config_file" > "$beachcar_config_tmp" || fail "Could not narrow the Beachcar MCP configuration."
chmod 600 "$beachcar_config_tmp"
mv -f "$beachcar_config_tmp" "$beachcar_config_file"
beachcar_config_tmp=
chmod 600 "$beachcar_config_file"
codex mcp get beachcar --json >/dev/null || fail "This Codex version did not accept the scoped Beachcar MCP configuration."

printf '%s\n' \
  '' \
  'Beachcar is connected to local Codex.' \
  'Restart Codex once so it loads the token, skill, and MCP approval policy.' \
  'Run one interactive Beachcar task first, then create the recurring automation.' \
  'At the scheduled time, this Mac must be awake and Codex must be running.'
