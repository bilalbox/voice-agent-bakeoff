#!/usr/bin/env bash
# tests/ratchets/ratchet-contract.test.sh
#
# Shrink-only quality ratchets. Pins the shared compare CLI contract.
#
# Run: pnpm run test:ratchets
#
# Seam: scripts/ratchets/compare.ts — black-box over fixture findings + baseline.

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compare=(pnpm exec tsx "$repo_root/scripts/ratchets/compare.ts")
fixtures="$repo_root/tests/ratchets/fixtures"

failures=0
checks=0

expect_exit() {
	local want="$1" description="$2"
	shift 2
	checks=$((checks + 1))

	local out status
	out="$("$@" 2>&1)"
	status=$?

	if [ "$status" -ne "$want" ]; then
		echo "  ✗ $description"
		echo "      want exit $want   got $status"
		echo "      output: $out"
		failures=$((failures + 1))
		return
	fi
	echo "  ✓ $description"
}

expect_output_contains() {
	local needle="$1" description="$2"
	shift 2
	checks=$((checks + 1))

	local out status
	out="$("$@" 2>&1)"
	status=$?

	if [[ "$out" != *"$needle"* ]]; then
		echo "  ✗ $description"
		echo "      missing: $needle"
		echo "      output: $out"
		failures=$((failures + 1))
		return
	fi
	echo "  ✓ $description (exit $status)"
}

echo "Green tree matching baseline → success"
expect_exit 0 "matching findings succeed" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-green.json" \
	--findings "$fixtures/findings-green.json"

echo
echo "Novel finding ID not in baseline → failure"
expect_exit 1 "novel finding fails" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-green.json" \
	--findings "$fixtures/findings-novel.json"
expect_output_contains "exports|src/b.ts|newThing" "novel ID named in output" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-green.json" \
	--findings "$fixtures/findings-novel.json"

echo
echo "Baseline row that no longer appears → failure (stale prune)"
expect_exit 1 "stale baseline fails" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-stale.json" \
	--findings "$fixtures/findings-stale.json"
expect_output_contains "exports|src/gone.ts|removed" "stale ID named in output" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-stale.json" \
	--findings "$fixtures/findings-stale.json"

echo
echo "Score regression on a baselined finding → failure"
expect_exit 1 "score regression fails" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-scored.json" \
	--findings "$fixtures/findings-regression.json"
expect_output_contains "src/app/foo.ts|handler" "regression ID named in output" \
	"${compare[@]}" \
	--baseline "$fixtures/baseline-scored.json" \
	--findings "$fixtures/findings-regression.json"

echo
echo "Baseline update under CI=true → refused"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
cp "$fixtures/baseline-green.json" "$tmpdir/baseline.json"
expect_exit 2 "CI refuses --update" \
	env CI=true "${compare[@]}" \
	--baseline "$tmpdir/baseline.json" \
	--findings "$fixtures/findings-novel.json" \
	--update
expect_output_contains "CI" "CI refusal mentions CI" \
	env CI=true "${compare[@]}" \
	--baseline "$tmpdir/baseline.json" \
	--findings "$fixtures/findings-novel.json" \
	--update

echo
echo "Baseline update locally rewrites the baseline"
cp "$fixtures/baseline-green.json" "$tmpdir/baseline-local.json"
expect_exit 0 "local --update succeeds" \
	env -u CI "${compare[@]}" \
	--baseline "$tmpdir/baseline-local.json" \
	--findings "$fixtures/findings-novel.json" \
	--update
if node -e '
const b=require(process.argv[1]);
const ids=b.findings.map(f=>f.id).sort();
if(!ids.includes("exports|src/b.ts|newThing")) process.exit(1);
' "$tmpdir/baseline-local.json"; then
	echo "  ✓ local --update wrote novel ID into baseline"
	checks=$((checks + 1))
else
	echo "  ✗ local --update did not write novel ID into baseline"
	checks=$((checks + 1))
	failures=$((failures + 1))
fi

echo
if [ "$failures" -ne 0 ]; then
	echo "FAIL: $failures / $checks ratchet contract checks failed"
	exit 1
fi
echo "OK: $checks ratchet contract checks passed"
