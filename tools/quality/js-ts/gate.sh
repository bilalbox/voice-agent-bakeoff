#!/usr/bin/env bash
# quality-kit js-ts gate.
# Usage: ./tools/quality/js-ts/gate.sh [fast|full] [extra-pnpm-script…]
#   fast — lint + secrets + graph + complexity + typecheck (+ Fragment scripts)
#   full — fast + vulns + coverage ratchet (default for CI / pre-push)
# Every step runs even after a failure so one invocation reports everything.
# Fragment Packs append their pnpm script names as extra args (via Desired state).
# Local multi-Host Targets use the composed ./tools/quality/gate.sh instead.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Target layout: tools/quality/gate-lib.sh (shared layer). Kit path differs.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../gate-lib.sh"

mode="${1:-full}"
if (($# > 0)); then
	shift
fi
extras=("$@")
quality_gate_require_mode "[fast|full] [extra-pnpm-script…]"

echo "# gate:${mode}"
step lint pnpm lint
step secrets pnpm lint:secrets
step graph pnpm lint:graph
step complexity pnpm lint:complexity
step typecheck pnpm typecheck
for frag in "${extras[@]}"; do
	step "${frag}" pnpm "${frag}"
done

if [[ "${mode}" == "full" ]]; then
	step vulns pnpm lint:vulns
	step coverage pnpm lint:coverage
fi

quality_gate_finish
