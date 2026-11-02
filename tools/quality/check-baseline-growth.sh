#!/usr/bin/env bash
# Compare committed quality baselines on HEAD against a git base ref.
# Fails when HEAD adds rows (or raises a ratchet score). Shrinks pass.
# Usage: ./tools/quality/check-baseline-growth.sh --base <ref> [--repo-root DIR] [--allow]
# Override: --allow or ALLOW_BASELINE_GROWTH=1 (CI also skips via PR label allow-baseline-growth).
set -euo pipefail

repo_root=""
base_ref=""
allow=0

while [[ $# -gt 0 ]]; do
	case "$1" in
	--base)
		base_ref="${2:-}"
		shift 2
		;;
	--repo-root)
		repo_root="${2:-}"
		shift 2
		;;
	--allow)
		allow=1
		shift
		;;
	-h | --help)
		sed -n '2,6p' "$0"
		exit 0
		;;
	*)
		echo "error: unknown argument: $1" >&2
		exit 2
		;;
	esac
done

if [[ -z "${repo_root}" ]]; then
	repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
cd "${repo_root}"

if [[ -z "${base_ref}" ]]; then
	if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
		base_ref="origin/${GITHUB_BASE_REF}"
	else
		echo "baseline-growth: no --base / GITHUB_BASE_REF; skipping"
		exit 0
	fi
fi

if [[ "${allow}" -eq 1 || "${ALLOW_BASELINE_GROWTH:-}" == "1" ]]; then
	echo "baseline-growth: override set; allowing growth"
	exit 0
fi

if ! git rev-parse --verify -q "${base_ref}^{commit}" >/dev/null; then
	echo "error: base ref not found: ${base_ref}" >&2
	echo "  CI: ensure actions/checkout fetch-depth: 0 so origin/\$GITHUB_BASE_REF exists." >&2
	exit 2
fi

# Fixed paths + globs. osv-scanner.toml is a #14 hook (watched when present).
mapfile -t candidates < <(
	{
		printf '%s\n' \
			baselines/complexity.json \
			baselines/biome-diagnostics.json \
			baselines/coverage.json \
			.rev-dep.baseline.json \
			.rev-dep.duplicates.json \
			.betterleaksignore \
			vulture_whitelist.py \
			osv-scanner.toml
		# Module-scoped kotlin baselines (may be absent).
		find . -name detekt-baseline.xml -o -name lint-baseline.xml
	} | sed 's|^\./||' | sort -u
)

export BASELINE_GROWTH_BASE="${base_ref}"
export BASELINE_GROWTH_LIST
BASELINE_GROWTH_LIST="$(printf '%s\n' "${candidates[@]}")"

python3 - <<'PY'
import json, os, re, subprocess, sys
from pathlib import Path

base_ref = os.environ["BASELINE_GROWTH_BASE"]
paths = [p for p in os.environ.get("BASELINE_GROWTH_LIST", "").splitlines() if p]


def git_show(ref: str, path: str) -> str | None:
    r = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return None
    return r.stdout


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def line_rows(text: str) -> set[str]:
    rows: set[str] = set()
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        rows.add(s)
    return rows


def ratchet_rows(text: str) -> dict[str, float]:
    data = json.loads(text)
    out: dict[str, float] = {}
    for f in data.get("findings", []):
        out[str(f["id"])] = float(f.get("score", 0))
    return out


def ratchet_worse_when(text: str) -> str:
    data = json.loads(text)
    w = data.get("worseWhen", "higher")
    return w if w in ("higher", "lower") else "higher"


def rev_dep_baseline_rows(text: str) -> set[str]:
    data = json.loads(text)
    rows: set[str] = set()
    for ws, checks in (data.get("workspaces") or {}).items():
        if not isinstance(checks, dict):
            continue
        for check, items in checks.items():
            if not isinstance(items, list):
                continue
            for item in items:
                rows.add(f"{ws}|{check}|{canonical(item)}")
    return rows


def rev_dep_dup_rows(text: str) -> set[str]:
    data = json.loads(text)
    return {canonical(d) for d in data.get("duplications") or []}


def detekt_rows(text: str) -> set[str]:
    return {m.group(1).strip() for m in re.finditer(r"<ID>(.*?)</ID>", text, re.S)}


def lint_rows(text: str) -> set[str]:
    rows: set[str] = set()
    for m in re.finditer(r"<issue\b[^>]*>.*?</issue>", text, re.S):
        block = m.group(0)
        iid = re.search(r'\bid="([^"]*)"', block)
        loc = re.search(
            r'<location\b[^>]*\bfile="([^"]*)"[^>]*\bline="([^"]*)"[^>]*\bcolumn="([^"]*)"',
            block,
        )
        if not loc:
            loc = re.search(
                r'<location\b[^>]*\bline="([^"]*)"[^>]*\bcolumn="([^"]*)"[^>]*\bfile="([^"]*)"',
                block,
            )
            if loc:
                file, line, col = loc.group(3), loc.group(1), loc.group(2)
            else:
                file = line = col = "?"
        else:
            file, line, col = loc.group(1), loc.group(2), loc.group(3)
        rows.add(f"{iid.group(1) if iid else '?'}:{file}:{line}:{col}")
    return rows


def osv_rows(text: str) -> set[str]:
    return set(re.findall(r'(?m)^\s*id\s*=\s*"([^"]+)"', text))


def classify(path: str) -> str:
    name = Path(path).name
    if name in ("complexity.json", "biome-diagnostics.json", "coverage.json"):
        return "ratchet"
    if name == ".rev-dep.baseline.json":
        return "rev-dep-baseline"
    if name == ".rev-dep.duplicates.json":
        return "rev-dep-dup"
    if name == "detekt-baseline.xml":
        return "detekt"
    if name == "lint-baseline.xml":
        return "lint"
    if name == ".betterleaksignore":
        return "lines"
    if name == "vulture_whitelist.py":
        return "lines"
    if name == "osv-scanner.toml":
        return "osv"
    return "lines"


def extract(kind: str, text: str):
    if kind == "ratchet":
        return ratchet_rows(text)
    if kind == "rev-dep-baseline":
        return rev_dep_baseline_rows(text)
    if kind == "rev-dep-dup":
        return rev_dep_dup_rows(text)
    if kind == "detekt":
        return detekt_rows(text)
    if kind == "lint":
        return lint_rows(text)
    if kind == "osv":
        return osv_rows(text)
    return line_rows(text)


added_reports: list[tuple[str, list[str]]] = []

for path in paths:
    head_text = Path(path).read_text(encoding="utf-8") if Path(path).is_file() else None
    base_text = git_show(base_ref, path)
    if head_text is None and base_text is None:
        continue
    kind = classify(path)
    if head_text is None:
        # deleted on HEAD → shrink
        continue
    if base_text is None:
        head_rows = extract(kind, head_text)
        if kind == "ratchet":
            assert isinstance(head_rows, dict)
            grown = sorted(f"{i} (score={s})" for i, s in head_rows.items())
        else:
            assert isinstance(head_rows, set)
            grown = sorted(head_rows)
        if grown:
            added_reports.append((path, grown))
        continue

    head_rows = extract(kind, head_text)
    base_rows = extract(kind, base_text)
    if kind == "ratchet":
        assert isinstance(head_rows, dict) and isinstance(base_rows, dict)
        # Coverage (worseWhen=lower): a *decrease* is growth (mirrors score rise).
        direction = ratchet_worse_when(head_text)
        grown = []
        for i, s in head_rows.items():
            if i not in base_rows:
                grown.append(f"{i} (score={s})")
            elif direction == "lower" and s < base_rows[i]:
                grown.append(f"{i} (score {base_rows[i]} → {s})")
            elif direction != "lower" and s > base_rows[i]:
                grown.append(f"{i} (score {base_rows[i]} → {s})")
        grown.sort()
    else:
        assert isinstance(head_rows, set) and isinstance(base_rows, set)
        grown = sorted(head_rows - base_rows)
    if grown:
        added_reports.append((path, grown))

if not added_reports:
    print("baseline-growth: OK (no added rows vs base)")
    sys.exit(0)

print("baseline-growth: FAIL — baselines grew vs base (use label allow-baseline-growth to override):")
for path, rows in added_reports:
    print(f"  {path}")
    for row in rows:
        print(f"    + {row}")
sys.exit(1)
PY
