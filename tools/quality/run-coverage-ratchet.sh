#!/usr/bin/env bash
# Compare measured coverage against baselines/coverage.json (shrink-only / raise-only).
#
# Usage: ./tools/quality/run-coverage-ratchet.sh [--update] [--findings PATH]
#
# Without --findings, runs every Host collector matching
#   tools/quality/*/collect-coverage.sh
# Each collector prints findings JSON on stdout; results are merged by id.
#
# Convention for multi-Host local gate composition (#9): keep invoking this script
# by path; Hosts only add tools/quality/<pack>/collect-coverage.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

update=0
findings_path=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--)
		shift
		;;
	--update)
		update=1
		shift
		;;
	--findings)
		findings_path="${2:-}"
		shift 2
		;;
	-h | --help)
		sed -n '2,14p' "$0"
		exit 0
		;;
	*)
		echo "error: unknown argument: $1" >&2
		exit 2
		;;
	esac
done

baseline="${REPO_ROOT}/baselines/coverage.json"
if [[ ! -f "${baseline}" ]]; then
	echo "error: missing ${baseline}" >&2
	echo "  apply the Shared layer, or copy languages/shared/templates/baselines/coverage.json" >&2
	exit 2
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT
out="${tmpdir}/findings.json"

if [[ -n "${findings_path}" ]]; then
	cp "${findings_path}" "${out}"
else
	mapfile -t collectors < <(
		# shellcheck disable=SC2012 # intentional glob listing of Host collectors
		ls tools/quality/*/collect-coverage.sh 2>/dev/null | sort -u || true
	)
	if [[ ${#collectors[@]} -eq 0 ]]; then
		echo "error: no coverage collector at tools/quality/*/collect-coverage.sh" >&2
		echo "  Host Packs place collect-coverage.sh under tools/quality/<pack>/." >&2
		exit 2
	fi
	merged='{"findings":[]}'
	for c in "${collectors[@]}"; do
		part="${tmpdir}/part-$(basename "$(dirname "${c}")").json"
		bash "${c}" >"${part}"
		merged="$(
			python3 - "${merged}" "${part}" <<'PY'
import json, sys
a = json.loads(sys.argv[1])
b = json.loads(open(sys.argv[2], encoding="utf-8").read())
by_id = {str(f["id"]): f for f in a.get("findings", [])}
for f in b.get("findings", []):
    by_id[str(f["id"])] = f
print(json.dumps({"findings": list(by_id.values())}, indent="\t"))
PY
		)"
	done
	printf '%s\n' "${merged}" >"${out}"
fi

args=(
	python3 "${REPO_ROOT}/tools/quality/ratchets/compare.py"
	--baseline "${baseline}"
	--findings "${out}"
)
if [[ "${update}" -eq 1 ]]; then
	args+=(--update)
fi

echo "==> coverage ratchet"
exec "${args[@]}"
