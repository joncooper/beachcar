#!/bin/sh

set -eu

beachcar_package_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$beachcar_package_dir/scripts/install-beachcar-codex.sh"
