#!/usr/bin/env python3
"""Shared shrink-only ratchet compare (findings + coverage).

Contract:
- novelty: finding IDs absent from the baseline fail
- stale prune: baseline rows that no longer reproduce fail
- score regression: same ID, worse score than baseline fails
  - worseWhen "higher" (default): current > baseline fails
  - worseWhen "lower" (coverage): current < baseline fails
- floor (coverage): score below baseline.floor fails
- empty coverage baseline: only floor is enforced (adopt / greenfield)
- --update rewrites the baseline to current findings, refused when CI=true

Usage: python3 tools/quality/ratchets/compare.py \\
  --baseline <path> --findings <path> [--update] [--result-json <path>]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def is_ci(env: dict[str, str] | None = None) -> bool:
    e = env if env is not None else os.environ
    v = e.get("CI")
    if v is None or v == "" or v == "0":
        return False
    return v.lower() != "false"


def worse_when(baseline: dict[str, Any]) -> str:
    w = baseline.get("worseWhen", "higher")
    if w not in ("higher", "lower"):
        raise SystemExit(f"error: baseline worseWhen must be higher|lower, got {w!r}")
    return w


def floor_of(baseline: dict[str, Any]) -> float | None:
    if "floor" not in baseline:
        return None
    return float(baseline["floor"])


def compare_findings(
    baseline: dict[str, Any], current: list[dict[str, Any]]
) -> dict[str, Any]:
    direction = worse_when(baseline)
    floor = floor_of(baseline)
    baseline_by_id = {str(f["id"]): f for f in baseline.get("findings", [])}
    current_by_id = {str(f["id"]): f for f in current}
    empty_baseline = len(baseline_by_id) == 0 and direction == "lower"

    novel = sorted(i for i in current_by_id if i not in baseline_by_id)
    stale = sorted(i for i in baseline_by_id if i not in current_by_id)

    # Greenfield / pre-adopt coverage: empty findings → floor only (no novelty/stale).
    if empty_baseline:
        novel = []
        stale = []

    regressions: list[dict[str, Any]] = []
    below_floor: list[dict[str, Any]] = []

    for fid, cur in current_by_id.items():
        cur_score = cur.get("score")
        if floor is not None and isinstance(cur_score, (int, float)) and cur_score < floor:
            below_floor.append({"id": fid, "floor": floor, "current": cur_score})

        if empty_baseline:
            continue
        base = baseline_by_id.get(fid)
        if base is None:
            continue
        base_score = base.get("score")
        if not isinstance(base_score, (int, float)) or not isinstance(
            cur_score, (int, float)
        ):
            continue
        if direction == "higher" and cur_score > base_score:
            regressions.append(
                {"id": fid, "baseline": base_score, "current": cur_score}
            )
        elif direction == "lower" and cur_score < base_score:
            regressions.append(
                {"id": fid, "baseline": base_score, "current": cur_score}
            )

    regressions.sort(key=lambda r: r["id"])
    below_floor.sort(key=lambda r: r["id"])

    ok = (
        len(novel) == 0
        and len(stale) == 0
        and len(regressions) == 0
        and len(below_floor) == 0
    )
    return {
        "ok": ok,
        "novel": novel,
        "stale": stale,
        "regressions": regressions,
        "belowFloor": below_floor,
    }


def rewrite_baseline(
    previous: dict[str, Any], current: list[dict[str, Any]]
) -> dict[str, Any]:
    prev_by_id = {str(f["id"]): f for f in previous.get("findings", [])}
    findings: list[dict[str, Any]] = []
    for f in sorted(current, key=lambda x: str(x["id"])):
        fid = str(f["id"])
        prev = prev_by_id.get(fid)
        row: dict[str, Any] = {"id": fid}
        if isinstance(f.get("score"), (int, float)):
            row["score"] = f["score"]
        elif prev is not None and isinstance(prev.get("score"), (int, float)):
            row["score"] = prev["score"]
        row["note"] = (
            prev.get("note")
            if prev and prev.get("note")
            else "Added via --update; replace with owning issue note."
        )
        if prev is not None and isinstance(prev.get("issue"), int):
            row["issue"] = prev["issue"]
        findings.append(row)

    out: dict[str, Any] = {"version": 1, "findings": findings}
    if "worseWhen" in previous:
        out["worseWhen"] = previous["worseWhen"]
    if "floor" in previous:
        out["floor"] = previous["floor"]
    return out


def report_failure(result: dict[str, Any]) -> None:
    if result["novel"]:
        print("Novel findings (not in baseline):", file=sys.stderr)
        for i in result["novel"]:
            print(f"  + {i}", file=sys.stderr)
    if result["stale"]:
        print(
            "Stale baseline rows (finding gone — prune the baseline entry):",
            file=sys.stderr,
        )
        for i in result["stale"]:
            print(f"  - {i}", file=sys.stderr)
    if result["regressions"]:
        print("Score regressions (worse than baseline):", file=sys.stderr)
        for r in result["regressions"]:
            print(
                f"  ^ {r['id']}  baseline={r['baseline']} current={r['current']}",
                file=sys.stderr,
            )
    if result.get("belowFloor"):
        print("Below configured floor:", file=sys.stderr)
        for r in result["belowFloor"]:
            print(
                f"  v {r['id']}  floor={r['floor']} current={r['current']}",
                file=sys.stderr,
            )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Shared shrink-only ratchet compare",
    )
    p.add_argument("--baseline", required=True)
    p.add_argument("--findings", required=True)
    p.add_argument("--update", action="store_true")
    p.add_argument("--result-json", default=None)
    args = p.parse_args(argv)

    baseline_path = Path(args.baseline)
    findings_path = Path(args.findings)
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    findings_file = json.loads(findings_path.read_text(encoding="utf-8"))
    findings = findings_file.get("findings", [])

    if args.update:
        if is_ci():
            print(
                "Refusing baseline --update under CI=true. "
                "Baseline growth is a conscious human act.",
                file=sys.stderr,
            )
            return 2
        next_b = rewrite_baseline(baseline, findings)
        baseline_path.write_text(
            json.dumps(next_b, indent="\t") + "\n", encoding="utf-8"
        )
        print(
            f"Updated baseline {baseline_path} ({len(next_b['findings'])} findings)."
        )
        return 0

    result = compare_findings(baseline, findings)
    if args.result_json:
        Path(args.result_json).write_text(
            json.dumps(result, indent="\t") + "\n", encoding="utf-8"
        )
    if not result["ok"]:
        # When --result-json is set, the caller (run-tool.ts) prints the report.
        if not args.result_json:
            report_failure(result)
        return 1
    if not args.result_json:
        print(f"Ratchet OK ({len(findings)} findings match baseline).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
