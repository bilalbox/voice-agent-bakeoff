#!/usr/bin/env bash
# osv-scanner dependency vulnerability scan — shared layer, used by every Host Pack.
# Usage: ./tools/quality/run-vuln-scan.sh [-- osv-scanner args…]
#
# Scans the repo recursively for lockfiles (pnpm, pub, Gradle, uv, …). Online by
# default (needs the OSV DB). Ignores live in osv-scanner.toml and must carry
# both an id and a non-empty reason.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

extra_args=()
for arg in "$@"; do
	case "${arg}" in
		--) ;;
		*) extra_args+=("${arg}") ;;
	esac
done

if ! command -v osv-scanner >/dev/null 2>&1; then
	echo "error: osv-scanner not found on PATH." >&2
	echo "  Linux: ./tools/quality/install-osv-scanner.sh (pinned, checksum-verified)" >&2
	echo "  See quality-kit languages/shared/MODULE.md" >&2
	exit 2
fi

config="${REPO_ROOT}/osv-scanner.toml"

# Upstream treats reason as optional; the kit requires id + non-empty reason.
validate_ignores() {
	local file="$1"
	[[ -f "${file}" ]] || return 0
	awk '
		function fail(msg) {
			printf "error: %s\n", msg > "/dev/stderr"
			exit 1
		}
		function flush() {
			if (!in_section) return
			if (id == "") fail("osv-scanner.toml [[IgnoredVulns]] is missing id")
			if (reason == "") fail("osv-scanner.toml [[IgnoredVulns]] id=" id " is missing a non-empty reason")
			in_section = 0
			id = ""
			reason = ""
		}
		function unquote(v) {
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
			if (v ~ /^".*"$/) { sub(/^"/, "", v); sub(/"$/, "", v) }
			else if (v ~ /^'\''.*'\''$/) { sub(/^'\''/, "", v); sub(/'\''$/, "", v) }
			return v
		}
		/^\[\[IgnoredVulns\]\]/ {
			flush()
			in_section = 1
			next
		}
		/^\[/ {
			flush()
			next
		}
		in_section && /^[[:space:]]*id[[:space:]]*=/ {
			sub(/^[^=]*=/, "", $0)
			id = unquote($0)
			next
		}
		in_section && /^[[:space:]]*reason[[:space:]]*=/ {
			sub(/^[^=]*=/, "", $0)
			reason = unquote($0)
			next
		}
		END { flush() }
	' "${file}"
}

validate_ignores "${config}"

args=(scan source -r . --allow-no-lockfiles)
if [[ -f "${config}" ]]; then
	args+=(--config "${config}")
fi
args+=("${extra_args[@]+"${extra_args[@]}"}")

osv-scanner "${args[@]}"
