import {
	CANCELLATION_POLICY,
	evaluateCancellationPolicy,
	evaluatePartsReschedule,
	evaluateServiceScope,
	type JobRecord,
} from "@applianceops/contracts";
import { describe, expect, it } from "vitest";

describe("Deep Domain Module — ApplianceOps Policy Engine", () => {
	describe("Cancellation Policy & 2FA Ownership Invariants", () => {
		const mockJob: JobRecord = {
			id: "1088",
			phone: "+15550108800",
			customerName: "Omar Diaz",
			appliance: "Bosch Dishwasher",
			status: "Scheduled",
			scheduledAt: new Date(Date.now() + 14 * 3600 * 1000).toISOString(), // 14 hours away (< 24h)
		};

		it("enforces attempt cap and transfers to dispatcher when failed attempts limit reached", () => {
			const decision = evaluateCancellationPolicy(mockJob, {
				failedAttemptCount: 3,
				callerPhone: "+15550108800",
			});

			expect(decision.ok).toBe(false);
			expect(decision.cancelled).toBe(false);
			expect(decision.verification_status).toBe("attempt_cap_exceeded");
			expect(decision.action).toBe("transfer");
			expect(decision.transfer_required).toBe(true);
			expect(decision.audit_outcome).toBe("attempt_cap_exceeded");
			expect(decision.speak_this).toContain("dispatcher");
		});

		it("returns not_found with neutral speech when job record does not exist", () => {
			const decision = evaluateCancellationPolicy(null, {
				spokenPhone: "555-010-8800",
				failedAttemptCount: 0,
			});

			expect(decision.ok).toBe(false);
			expect(decision.cancelled).toBe(false);
			expect(decision.verification_status).toBe("not_found");
			expect(decision.error).toBe("appointment_not_found");
			expect(decision.audit_outcome).toBe("not_found");
			expect(decision.speak_this).toContain("I can't find an appointment");
		});

		it("requires verification when valid job is provided without any phone", () => {
			const decision = evaluateCancellationPolicy(mockJob, {
				failedAttemptCount: 0,
			});

			expect(decision.ok).toBe(false);
			expect(decision.cancelled).toBe(false);
			expect(decision.verification_status).toBe("verification_required");
			expect(decision.error).toBe("verification_required");
			expect(decision.audit_outcome).toBe("verification_required");
			expect(decision.speak_this).toContain(
				"what is the phone number on the account?",
			);
		});

		it("masks verification_mismatch identically to appointment_not_found to prevent enumeration probing", () => {
			const decision = evaluateCancellationPolicy(mockJob, {
				spokenPhone: "+15550109999", // attacker / intruder phone
				failedAttemptCount: 0,
			});

			expect(decision.ok).toBe(false);
			expect(decision.cancelled).toBe(false);
			expect(decision.verification_status).toBe("verification_mismatch");
			expect(decision.error).toBe("appointment_not_found");
			expect(decision.audit_outcome).toBe("verification_mismatch");

			// Verify identical speech to unknown job
			const notFoundDecision = evaluateCancellationPolicy(null, {
				spokenPhone: "+15550109999",
			});
			expect(decision.speak_this).toBe(notFoundDecision.speak_this);
			expect(decision.message).toBe(notFoundDecision.message);
		});

		it("rejects cancellation of already closed or completed jobs", () => {
			const completedJob: JobRecord = {
				...mockJob,
				status: "Completed",
			};

			const decision = evaluateCancellationPolicy(completedJob, {
				spokenPhone: "+15550108800",
			});

			expect(decision.ok).toBe(false);
			expect(decision.cancelled).toBe(false);
			expect(decision.verification_status).toBe("verified");
			expect(decision.error).toBe("already_closed");
			expect(decision.speak_this).toContain("already completed");
		});

		it("enforces verbal fee confirmation inside 24h cancellation window when unconfirmed", () => {
			const decision = evaluateCancellationPolicy(mockJob, {
				spokenPhone: "+15550108800",
				confirmed: false,
			});

			expect(decision.ok).toBe(false);
			expect(decision.allowed).toBe(true);
			expect(decision.cancelled).toBe(false);
			expect(decision.verification_status).toBe("verified");
			expect(decision.fee_applicable).toBe(true);
			expect(decision.fee_amount).toBe(85);
			expect(decision.requires_confirmation).toBe(true);
			expect(decision.speak_this).toContain("85 dollar cancellation fee");
			expect(decision.speak_this).toContain("Omar");
			expect(decision.speak_this).toContain("Bosch Dishwasher");
		});

		it("cancels appointment and assesses $85 fee when caller confirms verbal agreement inside 24h", () => {
			const decision = evaluateCancellationPolicy(mockJob, {
				spokenPhone: "+15550108800",
				confirmed: true,
			});

			expect(decision.ok).toBe(true);
			expect(decision.allowed).toBe(true);
			expect(decision.cancelled).toBe(true);
			expect(decision.verification_status).toBe("verified");
			expect(decision.fee_applicable).toBe(true);
			expect(decision.fee_amount).toBe(85);
			expect(decision.speak_this).toContain("job 1088 is cancelled");
			expect(decision.speak_this).toContain(
				"85 dollar cancellation fee applies",
			);
		});

		it("cancels appointment with zero fee when outside 24h cancellation window", () => {
			const farFutureJob: JobRecord = {
				...mockJob,
				scheduledAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), // 48h away
			};

			const decision = evaluateCancellationPolicy(farFutureJob, {
				callerPhone: "+15550108800",
			});

			expect(decision.ok).toBe(true);
			expect(decision.cancelled).toBe(true);
			expect(decision.fee_applicable).toBe(false);
			expect(decision.fee_amount).toBe(0);
			expect(decision.speak_this).toContain("There's no cancellation fee");
		});
	});

	describe("Service Scope Guardrails & Canonical Aliases", () => {
		it("approves supported kitchen and laundry appliances", () => {
			expect(evaluateServiceScope("refrigerator").supported).toBe(true);
			expect(evaluateServiceScope("Sub-Zero").canonicalSkill).toBe("sub-zero");
			expect(evaluateServiceScope("Bosch dishwasher").supported).toBe(true);
			expect(evaluateServiceScope("dryer").canonicalSkill).toBe("laundry");
			expect(evaluateServiceScope("oven repair").canonicalSkill).toBe(
				"cooking",
			);
		});

		it("rejects unsupported appliances and directs to dispatcher/referral", () => {
			const poolCheck = evaluateServiceScope("pool heater");
			expect(poolCheck.supported).toBe(false);
			expect(poolCheck.action).toBe("decline_and_refer");
			expect(poolCheck.speak_this).toContain(
				"We don't service that appliance type",
			);

			const waterCheck = evaluateServiceScope("commercial water heater");
			expect(waterCheck.supported).toBe(false);
			expect(waterCheck.action).toBe("decline_and_refer");

			const furnaceCheck = evaluateServiceScope("furnace HVAC");
			expect(furnaceCheck.supported).toBe(false);
		});

		it("allows generic service inquiries without rejecting", () => {
			expect(evaluateServiceScope("").supported).toBe(true);
			expect(evaluateServiceScope("appliance service").supported).toBe(true);
			expect(evaluateServiceScope("diagnostic").supported).toBe(true);
		});
	});

	describe("Parts Rescheduling Criteria", () => {
		it("refuses rescheduling when parts are backordered", () => {
			const job: JobRecord = {
				id: "1042",
				phone: "+15550104200",
				status: "Diagnostic Completed",
				partsStatus: "backordered",
				partsEta: "2026-11-15T00:00:00.000Z",
			};

			const res = evaluatePartsReschedule(job, "2026-11-01T10:00:00.000Z");
			expect(res.ok).toBe(false);
			expect(res.reason).toContain("backordered");
		});

		it("refuses rescheduling when preferred date is before parts ETA", () => {
			const job: JobRecord = {
				id: "1042",
				phone: "+15550104200",
				status: "Diagnostic Completed",
				partsStatus: "in_stock",
				partsEta: "2026-11-10T00:00:00.000Z",
			};

			const res = evaluatePartsReschedule(job, "2026-11-05T10:00:00.000Z");
			expect(res.ok).toBe(false);
			expect(res.reason).toContain("before parts arrival");
		});

		it("approves rescheduling when parts are in stock and date is valid", () => {
			const job: JobRecord = {
				id: "1042",
				phone: "+15550104200",
				status: "Diagnostic Completed",
				partsStatus: "in_stock",
				assignedTechId: "tech-mike",
				assignedTechName: "Mike R.",
			};

			const res = evaluatePartsReschedule(job, "2026-11-02T10:00:00.000Z");
			expect(res.ok).toBe(true);
			if (res.ok) {
				expect(res.assigned_tech_id).toBe("tech-mike");
				expect(res.message).toContain("Keeping primary technician");
			}
		});
	});
});
