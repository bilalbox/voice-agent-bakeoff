#!/usr/bin/env bash
# Install the pinned osv-scanner release (Linux amd64/arm64) into DEST, refusing
# any binary whose SHA-256 differs from the pin below.
# Usage: ./tools/quality/install-osv-scanner.sh [DEST]   (default: ~/.local/bin)
#
# Bumping VERSION: change osvScanner in pins.json and copy both linux hashes
# from that release's osv-scanner_SHA256SUMS into this script.
set -euo pipefail

VERSION=2.7.0
dest="${1:-${HOME}/.local/bin}"

case "$(uname -m)" in
	x86_64 | amd64)
		asset="osv-scanner_linux_amd64"
		sha256=160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b
		;;
	aarch64 | arm64)
		asset="osv-scanner_linux_arm64"
		sha256=4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7
		;;
	*)
		echo "error: no pinned osv-scanner build for $(uname -m)" >&2
		exit 2
		;;
esac

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

curl -fsSL -o "${work}/${asset}" \
	"https://github.com/google/osv-scanner/releases/download/v${VERSION}/${asset}"
if ! (cd "${work}" && printf '%s  %s\n' "${sha256}" "${asset}" | sha256sum --check --status -); then
	echo "error: ${asset} does not match the pinned SHA-256 checksum ${sha256}; not installing" >&2
	exit 1
fi
mkdir -p "${dest}"
install -m 0755 "${work}/${asset}" "${dest}/osv-scanner"
"${dest}/osv-scanner" --version
