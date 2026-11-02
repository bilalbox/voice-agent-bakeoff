#!/usr/bin/env bash
# Betterleaks v1 secret scan — shared layer, used by every Host Pack.
# Usage: ./tools/quality/run-secret-scan.sh [--staged] [--verbose] [-- betterleaks args…]
#
# Modes:
#   --staged       pre-commit: `betterleaks git --staged`
#   (default)      local gate: `betterleaks dir .` (working tree + untracked)
#   CI=true        `betterleaks git --log-opts=origin/$GITHUB_BASE_REF..HEAD`
#                  (fallback: full `git` when GITHUB_BASE_REF is unset / unresolvable)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BETTERLEAKS_MAJOR=1
cd "${REPO_ROOT}"

is_ci() {
	case "${CI:-}" in
		"" | 0 | [Ff][Aa][Ll][Ss][Ee]) return 1 ;;
		*) return 0 ;;
	esac
}

is_staged=0
is_verbose=0
extra_args=()
for arg in "$@"; do
	case "${arg}" in
		--staged) is_staged=1 ;;
		--verbose) is_verbose=1 ;;
		--) ;;
		*) extra_args+=("${arg}") ;;
	esac
done

if ! is_ci; then
	is_verbose=1
fi

version_major() {
	local out="$1"
	if [[ "${out}" =~ ^v?([0-9]+)\. ]]; then
		printf '%s\n' "${BASH_REMATCH[1]}"
	fi
}

try_bin() {
	local cmd="$1"
	local out
	if ! out="$("${cmd}" version 2>&1)"; then
		return 1
	fi
	printf '%s\n' "${out}"
}

resolve_bin() {
	local out major
	if out="$(try_bin betterleaks-v1)"; then
		major="$(version_major "${out}")"
		if [[ "${major}" == "${BETTERLEAKS_MAJOR}" ]]; then
			printf 'betterleaks-v1\n'
			return 0
		fi
	fi
	if out="$(try_bin betterleaks)"; then
		major="$(version_major "${out}")"
		if [[ "${major}" == "${BETTERLEAKS_MAJOR}" ]]; then
			printf 'betterleaks\n'
			return 0
		fi
		echo "error: found betterleaks ${out}, but quality-kit pins 1.x until v2 is stable." >&2
		echo "Install v1.9.0+ — see quality-kit languages/shared/MODULE.md" >&2
		exit 2
	fi
	echo "error: betterleaks 1.x not found on PATH." >&2
	echo "  macOS: brew install --cask betterleaks/tap/betterleaks@1" >&2
	echo "  Linux: ./tools/quality/install-betterleaks.sh (pinned, checksum-verified)" >&2
	exit 2
}

bin="$(resolve_bin)"
args=()

if ((is_staged)); then
	args+=(git --staged)
elif is_ci; then
	# PR workflows set GITHUB_BASE_REF; Host ci.yml uses fetch-depth: 0 so the
	# remote-tracking base ref is present. workflow_dispatch / missing ref → full git.
	base_ref="${GITHUB_BASE_REF:-}"
	if [[ -n "${base_ref}" ]] && git rev-parse --verify "origin/${base_ref}" >/dev/null 2>&1; then
		args+=(git --log-opts="origin/${base_ref}..HEAD")
	else
		args+=(git)
	fi
else
	args+=(dir .)
fi

args+=(--no-banner --redact)
if ((is_verbose)); then
	args+=(--verbose)
fi

# Betterleaks takes one config, so the shared config and every
# .betterleaks.d/*.toml (Pack and Target allowlists) are concatenated into it.
if [[ -f "${REPO_ROOT}/.betterleaks.toml" ]]; then
	config="$(mktemp)"
	trap 'rm -f "${config}"' EXIT
	for part in "${REPO_ROOT}/.betterleaks.toml" "${REPO_ROOT}"/.betterleaks.d/*.toml; do
		if [[ -f "${part}" ]]; then
			cat "${part}"
			echo
		fi
	done >"${config}"
	args+=(-c "${config}")
fi
if [[ -f "${REPO_ROOT}/.betterleaksignore" ]]; then
	args+=(-i "${REPO_ROOT}/.betterleaksignore")
fi

args+=("${extra_args[@]+"${extra_args[@]}"}")

"${bin}" "${args[@]}"
