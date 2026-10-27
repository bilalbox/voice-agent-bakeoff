import { evaluateCancellationPolicy } from "@applianceops/contracts";
import type { Context } from "hono";
import type { Env } from "../env";
import { digitsFromSpoken, normalizeJobId } from "../lib/spoken";
import { extractArgs, type RetellFunctionBody } from "../retell/parse";
import type { ScheduleService } from "../services/schedule";
import {
	getFailedAttemptCount,
	recordVerificationAttempt,
} from "../services/verification";
import type { Job } from "../workiz/types";

export async function handleCancelJob(
	c: Context<{ Bindings: Env }>,
	schedule: ScheduleService,
	body: RetellFunctionBody,
): Promise<Response> {
	const t0 = performance.now();
	const args = extractArgs(body);
	const confirmed = Boolean(args.confirmed);
	const callId =
		body.call?.call_id ??
		(typeof args.call_id === "string" ? args.call_id : "") ??
		c.req.header("x-call-id") ??
		"";

	// Check attempt cap per call to mitigate brute-force enumeration
	const failedAttempts = await getFailedAttemptCount(c.env.DB, callId);

	// Extract phone credentials: spoken/supplied phone and telephony caller ID
	const rawSpokenPhone =
		typeof args.phone === "string" || typeof args.phone === "number"
			? String(args.phone)
			: typeof args.account_phone === "string" ||
					typeof args.account_phone === "number"
				? String(args.account_phone)
				: typeof args.caller_phone === "string" ||
						typeof args.caller_phone === "number"
					? String(args.caller_phone)
					: "";
	const spokenDigits = digitsFromSpoken(rawSpokenPhone);

	const rawCallerId =
		typeof body.call?.from_number === "string" ||
		typeof body.call?.from_number === "number"
			? String(body.call.from_number)
			: "";
	const callerIdDigits = digitsFromSpoken(rawCallerId);

	const rawJobId =
		typeof args.job_id === "string" || typeof args.job_id === "number"
			? String(args.job_id)
			: "";
	const jobId = normalizeJobId(rawJobId);

	let targetJob: Job | null = null;

	if (jobId) {
		targetJob = await schedule.getJobCached(jobId);
	} else {
		// Phone-based lookup when job_id is omitted
		const phoneToLookup = spokenDigits || callerIdDigits;
		if (!phoneToLookup) {
			const ms = Math.round(performance.now() - t0);
			return c.json(
				{
					ok: false,
					cancelled: false,
					verification_status: "verification_required",
					error: "job_id_and_phone_required",
					speak_this:
						"I need the job number and the phone number on the account to cancel an appointment.",
					latency_ms: ms,
				},
				200,
				{ "X-Tool-Latency-Ms": String(ms) },
			);
		}

		const matches = await schedule.findJobsByPhoneCached(phoneToLookup);
		const open = matches.filter(
			(j) =>
				!["cancelled", "canceled", "done", "completed"].includes(
					j.status.trim().toLowerCase(),
				),
		);
		const pool = open.length > 0 ? open : matches;

		if (pool.length === 0) {
			targetJob = null;
		} else if (pool.length > 1) {
			const ms = Math.round(performance.now() - t0);
			return c.json(
				{
					ok: false,
					cancelled: false,
					verification_status: "verification_required",
					error: "multiple_jobs",
					job_ids: pool.slice(0, 3).map((j) => j.id),
					speak_this: `I found ${pool.length} appointments under that phone number: ${pool
						.slice(0, 3)
						.map((j) => j.id)
						.join(", ")}. Which job number would you like to cancel?`,
					latency_ms: ms,
				},
				200,
				{ "X-Tool-Latency-Ms": String(ms) },
			);
		} else {
			targetJob = pool[0]!;
		}
	}

	const feeAmount = Number(c.env.CANCEL_FEE_AMOUNT ?? "85");
	const feeHours = Number(c.env.CANCEL_FEE_HOURS ?? "24");

	// Authoritative domain policy evaluation (deep module)
	const decision = evaluateCancellationPolicy(targetJob, {
		callerPhone: callerIdDigits,
		spokenPhone: spokenDigits,
		confirmed,
		failedAttemptCount: failedAttempts,
		feeAmount,
		feeHours,
	});

	// Persist attempt audit log across the database seam
	await recordVerificationAttempt(c.env.DB, {
		callId,
		outcome: decision.audit_outcome,
		jobId: targetJob?.id ?? jobId ?? undefined,
	});

	// State update on successful cancellation
	if (decision.cancelled && targetJob) {
		await schedule.updateJobAndCache(targetJob.id, {
			status: "cancelled",
		});
	}

	const ms = Math.round(performance.now() - t0);
	const responsePayload = {
		...decision,
		...(decision.job_id
			? { job_id: decision.job_id }
			: jobId
				? { job_id: jobId }
				: {}),
		latency_ms: ms,
	};

	return c.json(responsePayload, 200, {
		"X-Tool-Latency-Ms": String(ms),
		...(decision.cancelled ? { "Server-Timing": `app;dur=${ms}` } : {}),
	});
}
