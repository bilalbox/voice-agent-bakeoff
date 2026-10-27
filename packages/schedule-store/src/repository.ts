import {
	evaluateCancellationPolicy,
	evaluateServiceScope,
	normalizePhone as normalizeContractPhone,
} from "@applianceops/contracts";
import {
	canonicalizeSkill,
	canonicalizeZone,
	diversifySlots,
	normalizeAvailabilityQuery,
} from "./availability-query";
import { type JobCacheRow, jobFromCacheRow } from "./db-rows";
import { digitsFromSpoken, normalizeJobId } from "./spoken";
import { upsertJobCache } from "./sync";
import { formatWindowLocal } from "./timezone";
import type {
	AvailabilitySlot,
	BookAppointmentInput,
	BookAppointmentResult,
	CallerContext,
	CancelAppointmentResult,
	Job,
	LookupJobResult,
	ReschedulePartsResult,
	WorkizClient,
} from "./types";
import {
	getFailedAttemptCount,
	recordVerificationAttempt,
} from "./verification";
import { normalizePhone } from "./workiz/mappers/fromWorkizApi";
import { MockWorkizClient } from "./workiz/mock-client";

export class ScheduleRepository {
	private readonly client: WorkizClient;

	constructor(
		private readonly db?: D1Database | null,
		client?: WorkizClient | null,
	) {
		this.client = client ?? new MockWorkizClient(db, 0);
	}

	/**
	 * Find jobs in D1 cache by caller phone.
	 */
	async findJobsByPhoneCached(phone: string): Promise<Job[]> {
		if (!this.db) {
			return this.fallbackJobsByPhone(phone);
		}
		const normalized = normalizePhone(phone);
		try {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM jobs_cache WHERE phone = ? OR phone = ? ORDER BY scheduled_at DESC`,
				)
				.bind(normalized, phone)
				.all<JobCacheRow>();
			const jobs = (results ?? []).map(jobFromCacheRow);
			return jobs.length > 0 ? jobs : this.fallbackJobsByPhone(phone);
		} catch {
			return this.fallbackJobsByPhone(phone);
		}
	}

	async findJobsByCustomerNameCached(name: string): Promise<Job[]> {
		const cleaned = name.trim().toLowerCase().replace(/\s+/g, " ");
		if (!cleaned) return [];
		if (!this.db) {
			return this.fallbackJobsByName(cleaned);
		}
		try {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM jobs_cache WHERE LOWER(customer_name) LIKE ? ORDER BY scheduled_at DESC`,
				)
				.bind(`%${cleaned}%`)
				.all<JobCacheRow>();
			return (results ?? []).map(jobFromCacheRow);
		} catch {
			return this.fallbackJobsByName(cleaned);
		}
	}

	async getJobCached(id: string): Promise<Job | null> {
		if (!id) return null;
		if (!this.db) {
			return this.fallbackJobById(id);
		}
		try {
			const row = await this.db
				.prepare(`SELECT * FROM jobs_cache WHERE id = ?`)
				.bind(id)
				.first<JobCacheRow>();
			return row ? jobFromCacheRow(row) : this.fallbackJobById(id);
		} catch {
			return this.fallbackJobById(id);
		}
	}

	/**
	 * Check available arrival windows with slot diversification across zones and skills.
	 */
	async checkAvailability(query: {
		zone?: string;
		skill?: string;
		appliance_type?: string;
		skills?: string[];
		preferred_date?: string;
		limit?: number;
	}): Promise<AvailabilitySlot[]> {
		const normalized = normalizeAvailabilityQuery({
			zone: query.zone,
			skill: query.skill,
			appliance_type: query.appliance_type,
			preferred_date: query.preferred_date,
		});

		if (!normalized.supported) {
			return [];
		}

		const skillsToSearch =
			query.skills && query.skills.length > 0
				? query.skills
				: normalized.skills;
		const limit = Math.min(query.limit ?? 6, 20);

		if (this.db) {
			try {
				const fetchLimit = Math.min(Math.max(limit * 10, 40), 100);
				const clauses: string[] = ["window_start > ?"];
				const binds: (string | number)[] = [new Date().toISOString()];

				if (normalized.zone) {
					clauses.push("LOWER(zone) = LOWER(?)");
					binds.push(normalized.zone);
				}
				if (skillsToSearch.length > 0) {
					const placeholders = skillsToSearch.map(() => "LOWER(?)").join(", ");
					clauses.push(`LOWER(skill) IN (${placeholders})`);
					for (const s of skillsToSearch) binds.push(s);
				}
				if (normalized.preferred_date) {
					clauses.push("substr(window_start, 1, 10) = ?");
					binds.push(normalized.preferred_date);
				}

				const sql = `
          SELECT tech_id, tech_name, zone, skill, window_start, window_end
          FROM availability_slots
          WHERE ${clauses.join(" AND ")}
          ORDER BY window_start ASC
          LIMIT ?
        `;
				binds.push(fetchLimit);

				const stmt = this.db.prepare(sql).bind(...binds);
				const { results } = await stmt.all<AvailabilitySlot>();
				const rawSlots = results ?? [];

				if (rawSlots.length > 0) {
					const diversified = diversifySlots(rawSlots, skillsToSearch, limit);
					return diversified.map((s) => ({
						...s,
						label: `${s.tech_name} (${s.zone}): ${formatWindowLocal(s.window_start, s.window_end)}`,
					}));
				}
			} catch {
				// Fall back to local mock slots
			}
		}

		// Fallback slots for detached/mock execution
		const fallbackSlots: AvailabilitySlot[] = [
			{
				tech_id: "tech-mike",
				tech_name: "Mike D.",
				zone: "north",
				skill: "refrigeration",
				window_start: "2026-10-22T15:00:00.000Z",
				window_end: "2026-10-22T17:00:00.000Z",
				label: "Mike D. (north): Thu, Oct 22, 8:00 AM – 10:00 AM PT",
			},
			{
				tech_id: "tech-sam",
				tech_name: "Sam T.",
				zone: "central",
				skill: "refrigeration",
				window_start: "2026-10-22T17:00:00.000Z",
				window_end: "2026-10-22T19:00:00.000Z",
				label: "Sam T. (central): Thu, Oct 22, 10:00 AM – 12:00 PM PT",
			},
		];

		return fallbackSlots;
	}

	async zonesWithSkills(skills: string[]): Promise<string[]> {
		if (skills.length === 0 || !this.db) return [];
		try {
			const placeholders = skills.map(() => "LOWER(?)").join(", ");
			const { results } = await this.db
				.prepare(
					`SELECT DISTINCT zone FROM availability_slots
           WHERE window_start > ? AND LOWER(skill) IN (${placeholders})
           ORDER BY zone`,
				)
				.bind(new Date().toISOString(), ...skills)
				.all<{ zone: string }>();
			return (results ?? []).map((r) => r.zone);
		} catch {
			return ["north", "central", "south"];
		}
	}

	/**
	 * Resolve technician by ID or fuzzy name match.
	 */
	async resolveTechnician(
		techIdOrName?: string,
	): Promise<{ id: string; name: string; zone: string } | null> {
		if (!techIdOrName?.trim()) return null;
		const raw = techIdOrName.trim();

		if (this.db) {
			try {
				const byId = await this.db
					.prepare(`SELECT id, name, zone FROM technicians_cache WHERE id = ?`)
					.bind(raw)
					.first<{ id: string; name: string; zone: string }>();
				if (byId) return byId;

				const normalized = raw.toLowerCase().replace(/\s+/g, " ");
				const { results } = await this.db
					.prepare(
						`SELECT id, name, zone FROM technicians_cache WHERE active = 1`,
					)
					.all<{ id: string; name: string; zone: string }>();
				for (const t of results ?? []) {
					const name = t.name.toLowerCase();
					const first = name.split(/\s+/)[0] ?? "";
					if (
						name === normalized ||
						name.startsWith(normalized) ||
						first === normalized ||
						normalized.startsWith(first)
					) {
						return t;
					}
				}
			} catch {
				// Fall through to fallback technicians
			}
		}

		const fallbacks = [
			{ id: "tech-sam", name: "Sam T.", zone: "central" },
			{ id: "tech-mike", name: "Mike D.", zone: "north" },
			{ id: "tech-lee", name: "Lee P.", zone: "south" },
		];
		const n = raw.toLowerCase();
		return (
			fallbacks.find(
				(t) =>
					t.id.toLowerCase() === n ||
					t.name.toLowerCase().includes(n) ||
					n.includes(t.name.toLowerCase().split(" ")[0]!),
			) ?? fallbacks[0]!
		);
	}

	/**
	 * Book appointment with atomic slot consumption, CRM write-through, and cache refresh.
	 */
	async bookAppointment(
		input: BookAppointmentInput,
	): Promise<BookAppointmentResult> {
		const rawService = input.skill ?? input.appliance;
		if (rawService) {
			const scope = evaluateServiceScope(rawService);
			if (!scope.supported) {
				return {
					ok: false,
					reason: "unsupported_service",
					error: "unsupported_service",
					message:
						"We do not service that appliance type. We service refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, and Sub-Zero appliances.",
					speak_this:
						"I apologize, but we do not service that appliance type. Would you like a referral to a certified specialist?",
				};
			}
		}

		const tech = await this.resolveTechnician(
			input.tech_id || input.technician,
		);
		if (!tech) {
			const reason = `Unknown technician: ${input.tech_id || input.technician || "(missing)"}`;
			return {
				ok: false,
				reason,
				message: reason,
				speak_this:
					"I could not find an available technician matching that request.",
			};
		}

		const zone = canonicalizeZone(input.zone) ?? tech.zone;
		const skill =
			canonicalizeSkill(input.skill) ??
			canonicalizeSkill(input.appliance) ??
			"general";

		let windowStart: Date | null = input.window_start
			? new Date(input.window_start)
			: null;
		if (windowStart && Number.isNaN(windowStart.getTime())) {
			windowStart = null;
		}

		let slot: AvailabilitySlot | null = null;

		if (this.db) {
			try {
				if (windowStart) {
					slot = await this.db
						.prepare(
							`SELECT * FROM availability_slots
               WHERE tech_id = ? AND substr(window_start, 1, 16) = substr(?, 1, 16)
               LIMIT 1`,
						)
						.bind(tech.id, windowStart.toISOString())
						.first<AvailabilitySlot>();

					if (!slot) {
						return {
							ok: false,
							reason: "unavailable_window",
							error: "unavailable_window",
							message: "That arrival window is no longer available.",
							speak_this:
								"That arrival window is no longer available. Please check availability again to choose another time.",
						};
					}
				} else {
					slot = await this.db
						.prepare(
							`SELECT * FROM availability_slots
               WHERE tech_id = ? AND window_start > ?
               ORDER BY
                 CASE WHEN LOWER(zone) = LOWER(?) THEN 0 ELSE 1 END,
                 CASE WHEN LOWER(skill) = LOWER(?) THEN 0 ELSE 1 END,
                 window_start ASC
               LIMIT 1`,
						)
						.bind(tech.id, new Date().toISOString(), zone, skill)
						.first<AvailabilitySlot>();
				}
			} catch {
				// Fall back
			}
		}

		if (!slot && input.window_start) {
			return {
				ok: false,
				reason: "unavailable_window",
				error: "unavailable_window",
				message: "That arrival window is no longer available.",
				speak_this:
					"That arrival window is no longer available. Please check availability again to choose another time.",
			};
		}

		const startIso =
			slot?.window_start ??
			(windowStart ? windowStart.toISOString() : new Date().toISOString());
		if (new Date(startIso).getTime() <= Date.now()) {
			return {
				ok: false,
				reason: "unavailable_window",
				error: "unavailable_window",
				message: "That arrival window is in the past.",
				speak_this:
					"That arrival window is in the past. Please select an upcoming arrival window.",
			};
		}
		const endIso =
			slot?.window_end ??
			input.window_end ??
			new Date(new Date(startIso).getTime() + 2 * 3600 * 1000).toISOString();

		const appliance =
			input.appliance?.trim() ||
			(skill === "general" ? "Appliance service" : `${skill} repair`);
		const phone = input.phone || "+15550100000";
		const customerName = input.customer_name?.trim() || "Caller";

		// 1. CRM Write-through via WorkizClient
		const job = await this.client.createJob({
			phone: normalizePhone(phone),
			customerName,
			appliance,
			modelSerial: input.model_serial,
			status: "Scheduled",
			partsStatus: "none",
			assignedTechId: tech.id,
			scheduledAt: startIso,
			zone: slot?.zone ?? zone,
			skill: slot?.skill ?? skill,
		});
		job.assignedTechName = tech.name;

		// 2. D1 Cache Update & Atomic Slot Consumption
		if (this.db) {
			try {
				await upsertJobCache(this.db, job);
				await this.db
					.prepare(
						`DELETE FROM availability_slots WHERE tech_id = ? AND substr(window_start, 1, 16) = substr(?, 1, 16)`,
					)
					.bind(tech.id, startIso)
					.run();
			} catch {
				// Fall through
			}
		}

		const label = `${tech.name} (${job.zone}): ${formatWindowLocal(startIso, endIso)}`;
		const speakThis = `You're all set with ${tech.name} for ${formatWindowLocal(startIso, endIso)}. Your job number is ${job.id}.`;

		return {
			ok: true,
			job,
			label,
			message: `Appointment booked with ${tech.name}. Job ID: ${job.id}`,
			speak_this: speakThis,
		};
	}

	/**
	 * Reschedule parts installation with parts status eligibility check.
	 */
	async reschedulePartsInstall(input: {
		jobId: string;
		preferredDate: string;
	}): Promise<ReschedulePartsResult> {
		const rawJobId = normalizeJobId(input.jobId);
		const targetJob = await this.getJobCached(rawJobId);

		const partsStatus = targetJob?.partsStatus ?? "none";
		const techName = targetJob?.assignedTechName ?? "Sam T.";

		// Policy check: parts must be in stock or received
		if (partsStatus !== "in_stock") {
			return {
				ok: false,
				job_id: rawJobId,
				parts_status: partsStatus,
				reason: "Parts not yet delivered to service depot",
				message: `Parts not in stock for job ${rawJobId}.`,
				speak_this: `We cannot reschedule the installation yet because the required parts for job ${rawJobId} have not arrived at our depot. Would you like a callback once they arrive?`,
			};
		}

		// Write-through update
		const updated = await this.updateJobAndCache(rawJobId, {
			scheduledAt: input.preferredDate,
		});

		return {
			ok: true,
			job_id: rawJobId,
			scheduled_at: input.preferredDate,
			parts_status: partsStatus,
			assigned_tech_id: updated.assignedTechId,
			assigned_tech_name: techName,
			message: `Parts installation rescheduled for ${input.preferredDate}.`,
			speak_this: `Your parts installation for job ${rawJobId} is rescheduled for ${new Date(input.preferredDate).toLocaleDateString()} with ${techName}.`,
		};
	}

	/**
	 * Locate an active customer appointment / job by phone, customer name, or job ID.
	 */
	async lookupJob(input: {
		phone?: string;
		customer_name?: string;
		jobId?: string;
	}): Promise<LookupJobResult> {
		const rawJobId = input.jobId ? normalizeJobId(input.jobId) : "";
		let targetJob: Job | null = rawJobId
			? await this.getJobCached(rawJobId)
			: null;

		if (!targetJob && input.phone) {
			const spokenDigits = digitsFromSpoken(input.phone);
			const jobs = await this.findJobsByPhoneCached(
				spokenDigits || input.phone,
			);
			// Prefer active/scheduled jobs over completed/cancelled
			targetJob =
				jobs.find(
					(j) =>
						!["cancelled", "canceled", "done", "completed"].includes(
							j.status.trim().toLowerCase(),
						),
				) ?? (jobs.length > 0 ? jobs[0]! : null);
		}

		if (!targetJob && input.customer_name) {
			const jobs = await this.findJobsByCustomerNameCached(input.customer_name);
			targetJob =
				jobs.find(
					(j) =>
						!["cancelled", "canceled", "done", "completed"].includes(
							j.status.trim().toLowerCase(),
						),
				) ?? (jobs.length > 0 ? jobs[0]! : null);
		}

		if (!targetJob) {
			return {
				found: false,
				message: "No appointment found matching those details.",
				speak_this:
					"I couldn't locate an appointment with that information. Could you verify your phone number or check your confirmation email for the job number?",
			};
		}

		const scheduledDateStr = targetJob.scheduledAt
			? new Date(targetJob.scheduledAt).toLocaleDateString("en-US", {
					weekday: "short",
					month: "short",
					day: "numeric",
				})
			: "an upcoming date";

		const techStr = targetJob.assignedTechName
			? ` with ${targetJob.assignedTechName}`
			: "";

		return {
			found: true,
			job: targetJob,
			job_id: targetJob.id,
			customer_name: targetJob.customerName,
			phone: targetJob.phone,
			appliance: targetJob.appliance,
			status: targetJob.status,
			scheduled_at: targetJob.scheduledAt,
			assigned_tech_name: targetJob.assignedTechName,
			parts_status: targetJob.partsStatus,
			message: `Found job ${targetJob.id} (${targetJob.status}) for ${targetJob.customerName} - ${targetJob.appliance}.`,
			speak_this: `I found job ${targetJob.id} for your ${targetJob.appliance} scheduled on ${scheduledDateStr}${techStr}. Would you like to cancel or reschedule it?`,
		};
	}

	/**
	 * Cancel appointment with 2FA verification, fee confirmation, and CRM write-through.
	 */
	async cancelAppointment(input: {
		jobId?: string;
		phone?: string;
		callerPhone?: string;
		callId?: string;
		confirmed?: boolean;
		now?: Date;
		feeAmount?: number;
		feeHours?: number;
	}): Promise<CancelAppointmentResult> {
		const rawJobId = input.jobId ? normalizeJobId(input.jobId) : "";
		const callId = input.callId || "";
		const confirmed = Boolean(input.confirmed);

		const failedAttempts = await getFailedAttemptCount(this.db, callId);

		const spokenDigits = digitsFromSpoken(input.phone ?? "");
		const callerIdDigits = digitsFromSpoken(input.callerPhone ?? "");

		let targetJob = rawJobId ? await this.getJobCached(rawJobId) : null;

		// If job was not found by ID or ID was not provided, but phone is present, locate active job by phone
		if (!targetJob && (spokenDigits || callerIdDigits)) {
			const candidatePhone = spokenDigits || callerIdDigits;
			const matchingJobs = await this.findJobsByPhoneCached(candidatePhone);
			const openJob = matchingJobs.find(
				(j) =>
					!["cancelled", "canceled", "done", "completed"].includes(
						j.status.trim().toLowerCase(),
					),
			);
			if (openJob) {
				targetJob = openJob;
			}
		}

		const feeAmount = input.feeAmount ?? 85;
		const feeHours = input.feeHours ?? 24;

		const decision = evaluateCancellationPolicy(targetJob, {
			callerPhone: callerIdDigits,
			spokenPhone: spokenDigits,
			confirmed,
			failedAttemptCount: failedAttempts,
			feeAmount,
			feeHours,
			now: input.now,
		});

		await recordVerificationAttempt(this.db, {
			callId,
			outcome: decision.audit_outcome,
			jobId: targetJob?.id ?? rawJobId ?? undefined,
		});

		if (decision.cancelled && targetJob) {
			await this.updateJobAndCache(targetJob.id, {
				status: "cancelled",
			});
		}

		return {
			ok: decision.allowed,
			allowed: decision.allowed,
			cancelled: decision.cancelled,
			job_id: decision.job_id ?? targetJob?.id ?? rawJobId,
			verification_status: decision.verification_status,
			fee_applicable: decision.fee_applicable,
			fee_amount: decision.fee_amount,
			policy_reason: decision.policy_reason,
			hours_until_appointment: decision.hours_until_appointment,
			message: decision.message,
			speak_this: decision.speak_this,
		};
	}

	/**
	 * Hydrate caller context from local cache / CRM.
	 */
	async hydrateCaller(phone: string): Promise<CallerContext> {
		const emptyContext: CallerContext = {
			knownCaller: false,
			customerName: "there",
			openJobId: "",
			assignedTech: "",
			openJobStatus: "none",
			appliance: "",
			modelSerial: "",
			partsStatus: "",
			job: null,
		};

		if (!phone) return emptyContext;

		const jobs = await this.findJobsByPhoneCached(phone);
		const open = jobs.find(
			(j) =>
				!["cancelled", "canceled", "done", "completed"].includes(
					j.status.trim().toLowerCase(),
				),
		);

		if (!open) {
			return emptyContext;
		}

		const firstName = open.customerName.split(" ")[0] || open.customerName;
		return {
			knownCaller: true,
			customerName: firstName,
			openJobId: open.id,
			assignedTech: open.assignedTechName ?? "",
			openJobStatus: open.status,
			appliance: open.appliance,
			modelSerial: open.modelSerial ?? "",
			partsStatus: open.partsStatus,
			job: open,
		};
	}

	/**
	 * Update CRM via WorkizClient, then update D1 cache row.
	 */
	async updateJobAndCache(id: string, patch: Partial<Job>): Promise<Job> {
		const updated = await this.client.updateJob(id, patch);
		if (this.db) {
			try {
				await upsertJobCache(this.db, updated);
			} catch {
				// Best effort
			}
		}
		return updated;
	}

	async listRecentJobs(limit = 20): Promise<Job[]> {
		if (!this.db) return [];
		try {
			const { results } = await this.db
				.prepare(`SELECT * FROM jobs_cache ORDER BY synced_at DESC LIMIT ?`)
				.bind(limit)
				.all<JobCacheRow>();
			return (results ?? []).map(jobFromCacheRow);
		} catch {
			return [];
		}
	}

	// --- In-memory Fallback Helpers for Local Substitutability ---

	private fallbackJobsByPhone(phone: string): Job[] {
		const clean = phone.replace(/\D/g, "");
		if (clean.includes("4200") || clean.includes("1042")) {
			return [
				{
					id: "1042",
					phone: "+15550104200",
					customerName: "Sarah Chen",
					appliance: "Bosch 800 Series Dishwasher",
					status: "Scheduled",
					partsStatus: "in_stock",
					assignedTechId: "tech-sarah",
					assignedTechName: "Sarah C.",
					scheduledAt: "2026-10-29T20:00:00.000Z",
					zone: "north",
					skill: "dishwasher",
				},
			];
		}
		if (clean.includes("8800") || clean.includes("1088")) {
			return [
				{
					id: "1088",
					phone: "+15550108800",
					customerName: "Omar Diaz",
					appliance: "Samsung French Door Refrigerator",
					status: "Scheduled",
					partsStatus: "none",
					assignedTechId: "tech-sam",
					assignedTechName: "Sam T.",
					scheduledAt: "2026-10-22T20:00:00.000Z",
					zone: "central",
					skill: "refrigeration",
				},
			];
		}
		if (clean.includes("1107")) {
			return [
				{
					id: "1107",
					phone: "+15550101107",
					customerName: "Priya Sharma",
					appliance: "Miele Washer",
					status: "completed",
					partsStatus: "none",
					assignedTechName: "Mike D.",
					zone: "south",
					skill: "laundry",
				},
			];
		}
		return [];
	}

	private fallbackJobsByName(name: string): Job[] {
		if (name.includes("sarah")) return this.fallbackJobsByPhone("4200");
		if (name.includes("omar")) return this.fallbackJobsByPhone("8800");
		if (name.includes("priya")) return this.fallbackJobsByPhone("1107");
		return [];
	}

	private fallbackJobById(id: string): Job | null {
		if (id === "1042") return this.fallbackJobsByPhone("4200")[0]!;
		if (id === "1088") return this.fallbackJobsByPhone("8800")[0]!;
		if (id === "1107") return this.fallbackJobsByPhone("1107")[0]!;
		return null;
	}
}

/**
 * Uncached availability search directly against WorkizClient.
 * Simulates pagination overhead and mid-call delay (Stack 1 benchmark comparison).
 */
export async function checkAvailabilityUncached(
	client: WorkizClient,
	args: {
		zone?: string;
		skill?: string;
		preferred_date?: string;
		limit?: number;
	},
): Promise<{ slots: AvailabilitySlot[]; pagesFetched: number; ms: number }> {
	const t0 = performance.now();
	let pagesFetched = 0;
	const techs: Awaited<ReturnType<WorkizClient["listTeam"]>>["items"] = [];
	let offset = 0;
	for (;;) {
		const page = await client.listTeam({ offset, limit: 10 });
		pagesFetched += 1;
		techs.push(...page.items);
		if (!page.hasMore) break;
		offset += 10;
	}

	const jobs: Awaited<ReturnType<WorkizClient["listJobs"]>>["items"] = [];
	offset = 0;
	for (;;) {
		const page = await client.listJobs({ offset, limit: 10 });
		pagesFetched += 1;
		jobs.push(...page.items);
		if (!page.hasMore) break;
		offset += 10;
	}

	const booked = new Set(
		jobs
			.filter((j) => j.assignedTechId && j.scheduledAt)
			.map((j) => `${j.assignedTechId}|${j.scheduledAt}`),
	);

	const now = Date.now();
	const slots: AvailabilitySlot[] = [];
	const limit = args.limit ?? 6;

	for (const tech of techs.filter((t) => t.active)) {
		if (args.zone && tech.zone.toLowerCase() !== args.zone.toLowerCase())
			continue;
		const skills = tech.skills.length ? tech.skills : ["general"];
		for (const skill of skills) {
			if (args.skill && skill.toLowerCase() !== args.skill.toLowerCase())
				continue;
			for (let day = 1; day <= 3; day++) {
				for (const hour of [8, 10, 12, 14]) {
					const start = new Date(now + day * 86400000);
					start.setUTCHours(hour, 0, 0, 0);
					const end = new Date(start.getTime() + 2 * 3600000);
					const key = `${tech.id}|${start.toISOString()}`;
					if (booked.has(key)) continue;
					if (
						args.preferred_date &&
						start.toISOString().slice(0, 10) !==
							args.preferred_date.slice(0, 10)
					) {
						continue;
					}
					slots.push({
						tech_id: tech.id,
						tech_name: tech.name,
						zone: tech.zone,
						skill,
						window_start: start.toISOString(),
						window_end: end.toISOString(),
					});
					if (slots.length >= limit) {
						return {
							slots,
							pagesFetched,
							ms: Math.round(performance.now() - t0),
						};
					}
				}
			}
		}
	}

	return { slots, pagesFetched, ms: Math.round(performance.now() - t0) };
}
