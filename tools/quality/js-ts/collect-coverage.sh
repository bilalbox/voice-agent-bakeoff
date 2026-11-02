#!/usr/bin/env bash
# js-ts coverage collector → findings JSON on stdout.
# Runs the Target's tests under coverage and emits one finding per package (or
# "." for a single-package repo) with score = line coverage percent.
#   Vitest Targets (`test` script calls vitest): `vitest run` with Vitest's own
#     V8 coverage (needs @vitest/coverage-v8). c8 sees nothing from Vitest's
#     workers. Other commands chained in `test` are not run by this step.
#   Otherwise: c8 wraps `pnpm test`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${REPO_ROOT}"

if ! command -v pnpm >/dev/null 2>&1; then
	echo "error: pnpm is required for js-ts coverage collection" >&2
	exit 2
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT
report_dir="${tmpdir}/coverage"

test_script="$(node -p 'require("./package.json").scripts?.test ?? ""')"
if [[ "${test_script}" =~ (^|[^[:alnum:]_-])vitest([^[:alnum:]_-]|$) ]]; then
	if ! node -e 'require.resolve("@vitest/coverage-v8/package.json")' >/dev/null 2>&1; then
		vitest_version="$(pnpm exec vitest --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
		echo "error: Vitest coverage needs @vitest/coverage-v8 (same version as vitest)" >&2
		echo "fix: pnpm add -D @vitest/coverage-v8@${vitest_version:-<vitest version>}" >&2
		exit 2
	fi
	# Test files are excluded by Vitest's defaults; tests/** helpers are not.
	pnpm exec vitest run \
		--coverage.enabled \
		--coverage.provider=v8 \
		--coverage.reporter=json-summary \
		--coverage.reportsDirectory="${report_dir}" \
		--coverage.exclude='**/tests/**' \
		>/dev/null
else
	# c8 wraps the Target's test script. JSON summary is per-file; we aggregate.
	pnpm exec c8 \
		--reporter=json-summary \
		--reports-dir="${report_dir}" \
		--exclude='**/node_modules/**' \
		--exclude='**/dist/**' \
		--exclude='**/coverage/**' \
		--exclude='**/tests/**' \
		--exclude='**/*.test.*' \
		--exclude='**/*.spec.*' \
		pnpm test >/dev/null
fi

summary="${report_dir}/coverage-summary.json"
if [[ ! -f "${summary}" ]]; then
	echo "error: no coverage summary at ${summary}" >&2
	exit 1
fi

python3 - "${summary}" "${REPO_ROOT}" <<'PY'
import json, sys
from pathlib import Path

summary = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
root = Path(sys.argv[2]).resolve()

# Prefer workspace package dirs when present; else one "." total.
packages: list[str] = []
pkg_json = root / "package.json"
ws = root / "pnpm-workspace.yaml"
if ws.is_file():
    # Shallow package discovery: */package.json and packages/*/package.json
    for pattern in ("*/package.json", "packages/*/package.json", "apps/*/package.json"):
        for p in root.glob(pattern):
            rel = str(p.parent.relative_to(root)).replace("\\", "/")
            if rel not in (".",) and rel not in packages:
                packages.append(rel)
packages.sort()

def line_pct(entry: dict) -> float:
    lines = entry.get("lines") or {}
    pct = lines.get("pct")
    if isinstance(pct, (int, float)):
        return round(float(pct), 2)
    return 0.0

findings: list[dict] = []
if not packages:
    total = summary.get("total") or {}
    findings.append({"id": ".", "score": line_pct(total)})
else:
    # Aggregate file entries under each package prefix.
    files = {k: v for k, v in summary.items() if k != "total"}
    for pkg in packages:
        covered = 0
        total_lines = 0
        prefix = str((root / pkg).resolve())
        for path, entry in files.items():
            try:
                resolved = str(Path(path).resolve())
            except OSError:
                resolved = path
            if resolved == prefix or resolved.startswith(prefix + "/"):
                lines = entry.get("lines") or {}
                total_lines += int(lines.get("total") or 0)
                covered += int(lines.get("covered") or 0)
        pct = round((100.0 * covered / total_lines), 2) if total_lines else 0.0
        findings.append({"id": pkg, "score": pct})

print(json.dumps({"findings": findings}, indent="\t"))
PY
