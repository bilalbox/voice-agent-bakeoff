/**
 * Verification tracking and attempt-capping service.
 * Tracks per-call failed verification attempts to defend against brute-force enumeration.
 */

export const MAX_VERIFICATION_ATTEMPTS = 3;

export type VerificationOutcome =
	| "verified"
	| "verification_required"
	| "verification_mismatch"
	| "not_found"
	| "attempt_cap_exceeded";

// In-memory isolate tracker for fast per-call lookup
const isolateAttemptCounts = new Map<string, number>();

export async function getFailedAttemptCount(
	db: D1Database | null | undefined,
	callId: string,
): Promise<number> {
	if (!callId) return 0;
	if (!db) return isolateAttemptCounts.get(callId) ?? 0;

	try {
		const row = await db
			.prepare(
				`SELECT COUNT(*) as c FROM verification_attempts WHERE call_id = ? AND outcome IN ('verification_mismatch', 'not_found')`,
			)
			.bind(callId)
			.first<{ c: number }>();
		if (row && typeof row.c === "number") {
			return Math.max(row.c, isolateAttemptCounts.get(callId) ?? 0);
		}
	} catch {
		// If table doesn't exist yet, fallback to isolate memory
	}

	return isolateAttemptCounts.get(callId) ?? 0;
}

export async function recordVerificationAttempt(
	db: D1Database | null | undefined,
	opts: {
		callId: string;
		outcome: VerificationOutcome;
		jobId?: string;
	},
): Promise<number> {
	const { callId, outcome, jobId } = opts;
	if (!callId) return 0;

	const current = isolateAttemptCounts.get(callId) ?? 0;
	const isFailed =
		outcome === "verification_mismatch" || outcome === "not_found";
	const nextCount = isFailed ? current + 1 : current;
	isolateAttemptCounts.set(callId, nextCount);

	if (!db) return nextCount;

	try {
		await db
			.prepare(
				`INSERT INTO verification_attempts (call_id, outcome, job_id, timestamp)
         VALUES (?, ?, ?, ?)`,
			)
			.bind(callId, outcome, jobId ?? null, new Date().toISOString())
			.run();
	} catch {
		// Best effort persistence
	}

	return nextCount;
}

export function resetVerificationAttemptsForTest(): void {
	isolateAttemptCounts.clear();
}
