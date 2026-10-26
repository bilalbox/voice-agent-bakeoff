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
  db: D1Database,
  callId: string,
): Promise<number> {
  if (!callId) return 0;

  try {
    // Check D1 if table exists
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
  db: D1Database,
  opts: {
    callId: string;
    outcome: VerificationOutcome;
    jobId?: string;
  },
): Promise<number> {
  const { callId, outcome, jobId } = opts;

  // Log sanitization: NEVER log customer name or full phone number
  console.log(
    JSON.stringify({
      event: "verification_attempt",
      call_id: callId || "unknown",
      outcome,
      job_id: jobId || "none",
      timestamp: new Date().toISOString(),
    }),
  );

  if (!callId) return 0;

  const isFailed = outcome === "verification_mismatch" || outcome === "not_found";

  const currentCount = isolateAttemptCounts.get(callId) ?? 0;
  const newCount = isFailed ? currentCount + 1 : currentCount;
  if (isFailed) {
    isolateAttemptCounts.set(callId, newCount);
  }

  try {
    // Ensure table exists
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS verification_attempts (
          call_id TEXT NOT NULL,
          outcome TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
      )
      .run();

    await db
      .prepare(
        `INSERT INTO verification_attempts (call_id, outcome, created_at) VALUES (?, ?, ?)`,
      )
      .bind(callId, outcome, new Date().toISOString())
      .run();
  } catch {
    // Table write failure should not disrupt the request
  }

  return newCount;
}
