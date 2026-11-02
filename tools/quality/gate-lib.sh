#!/usr/bin/env bash
# Shared run-all-then-summarize helpers for Host gates (REFERENCE.md Host gate contract).
# Sourced by tools/quality/<pack>/gate.sh as ../gate-lib.sh. Not a Host entrypoint.
# Host gates set the global `mode` before calling quality_gate_require_mode / finish.
# shellcheck shell=bash

# Clear the failure list (Hosts that parse mode themselves call this instead of require_mode).
quality_gate_begin() {
	failed=()
}

# Validate `mode` (already set by the caller) and clear the failure list.
# Usage string is appended after `$0` on bad input (default: [fast|full]).
quality_gate_require_mode() {
	local usage="${1:-[fast|full]}"
	# shellcheck disable=SC2154 # mode set by Host gate before sourcing this lib
	case "${mode}" in
		fast|full) ;;
		*)
			echo "usage: $0 ${usage}" >&2
			exit 2
			;;
	esac
	quality_gate_begin
}

# Run one named step; failures append to `failed` and do not abort the gate.
step() {
	local name="$1"
	shift
	echo "==> ${name}"
	if ! "$@"; then
		failed+=("${name}")
	fi
}

quality_gate_succeeded() {
	((${#failed[@]} == 0))
}

# Print the success/failure summary and exit (0 or 1).
quality_gate_finish() {
	if quality_gate_succeeded; then
		echo "# gate:${mode} ok"
		exit 0
	fi
	echo
	echo "# gate:${mode} FAILED: ${failed[*]}"
	exit 1
}

# Failure summary without exiting — for Hosts that print extra diagnostics first.
quality_gate_print_failure() {
	echo
	echo "# gate:${mode} FAILED: ${failed[*]}"
}
