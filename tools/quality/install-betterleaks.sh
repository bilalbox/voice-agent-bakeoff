#!/usr/bin/env bash
# Install the pinned Betterleaks release (Linux x64/arm64) into DEST, refusing
# any archive whose SHA-256 differs from the pin below.
# Usage: ./tools/quality/install-betterleaks.sh [DEST]   (default: ~/.local/bin)
#
# Bumping VERSION: update pins.json betterleaks + copy both linux hashes
# from the release's checksums.txt into this script.
set -euo pipefail

VERSION=1.9.0
dest="${1:-${HOME}/.local/bin}"

case "$(uname -m)" in
	x86_64 | amd64)
		asset="betterleaks_${VERSION}_linux_x64.tar.gz"
		sha256=f8b185a39ffcece2a1ca82bf3a4e7435cd81963ffd16b7a9128daf75f35f6de7
		;;
	aarch64 | arm64)
		asset="betterleaks_${VERSION}_linux_arm64.tar.gz"
		sha256=1d39116e0a58dc94574715e2aa12a2dbd5062f193eee3fec011fef6ba06bd13b
		;;
	*)
		echo "error: no pinned Betterleaks build for $(uname -m)" >&2
		exit 2
		;;
esac

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

curl -fsSL -o "${work}/${asset}" \
	"https://github.com/betterleaks/betterleaks/releases/download/v${VERSION}/${asset}"
if ! (cd "${work}" && printf '%s  %s\n' "${sha256}" "${asset}" | sha256sum --check --status -); then
	echo "error: ${asset} does not match the pinned SHA-256 checksum ${sha256}; not installing" >&2
	exit 1
fi
tar -xzf "${work}/${asset}" -C "${work}" betterleaks
mkdir -p "${dest}"
install -m 0755 "${work}/betterleaks" "${dest}/betterleaks"
"${dest}/betterleaks" version
