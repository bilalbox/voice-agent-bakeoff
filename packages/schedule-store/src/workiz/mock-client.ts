import { type JobRow, jobFromRow, type TechRow, techFromRow } from "../db-rows";
import type {
	Job,
	NewJobInput,
	Page,
	PageArgs,
	Technician,
	WorkizClient,
} from "../types";
import { normalizePhone } from "./mappers/fromWorkizApi";

/**
 * D1-backed mock CRM or in-memory fallback.
 */
export class MockWorkizClient implements WorkizClient {
	constructor(
		private readonly db?: D1Database | null,
		private readonly pageDelayMs = 0,
	) {}

	async findJobsByPhone(phone: string): Promise<Job[]> {
		if (!this.db) return [];
		const normalized = normalizePhone(phone);
		const { results } = await this.db
			.prepare(
				`SELECT j.*, t.name AS tech_name
         FROM jobs j
         LEFT JOIN technicians t ON t.id = j.assigned_tech_id
         WHERE j.phone = ? OR j.phone = ?`,
			)
			.bind(normalized, phone)
			.all<JobRow & { tech_name: string | null }>();

		return (results ?? []).map((r) => jobFromRow(r, r.tech_name));
	}

	async getJob(id: string): Promise<Job | null> {
		if (!this.db) return null;
		const row = await this.db
			.prepare(
				`SELECT j.*, t.name AS tech_name
         FROM jobs j
         LEFT JOIN technicians t ON t.id = j.assigned_tech_id
         WHERE j.id = ?`,
			)
			.bind(id)
			.first<JobRow & { tech_name: string | null }>();

		return row ? jobFromRow(row, row.tech_name) : null;
	}

	async listJobs(page: PageArgs): Promise<Page<Job>> {
		if (this.pageDelayMs > 0) await sleep(this.pageDelayMs);
		if (!this.db) return { items: [], hasMore: false };

		const { results } = await this.db
			.prepare(
				`SELECT j.*, t.name AS tech_name
         FROM jobs j
         LEFT JOIN technicians t ON t.id = j.assigned_tech_id
         ORDER BY j.id
         LIMIT ? OFFSET ?`,
			)
			.bind(page.limit + 1, page.offset)
			.all<JobRow & { tech_name: string | null }>();

		const rows = results ?? [];
		const hasMore = rows.length > page.limit;
		const items = rows
			.slice(0, page.limit)
			.map((r) => jobFromRow(r, r.tech_name));
		return { items, hasMore };
	}

	async listTeam(page: PageArgs): Promise<Page<Technician>> {
		if (this.pageDelayMs > 0) await sleep(this.pageDelayMs);
		if (!this.db) return { items: [], hasMore: false };

		const { results } = await this.db
			.prepare(`SELECT * FROM technicians ORDER BY id LIMIT ? OFFSET ?`)
			.bind(page.limit + 1, page.offset)
			.all<TechRow>();

		const rows = results ?? [];
		const hasMore = rows.length > page.limit;
		const items = rows.slice(0, page.limit).map(techFromRow);
		return { items, hasMore };
	}

	async updateJob(id: string, patch: Partial<Job>): Promise<Job> {
		if (!this.db) {
			return {
				id,
				phone: patch.phone ?? "+15550100000",
				customerName: patch.customerName ?? "Customer",
				appliance: patch.appliance ?? "Appliance",
				status: patch.status ?? "Scheduled",
				partsStatus: patch.partsStatus ?? "none",
				...patch,
			};
		}
		const current = await this.getJob(id);
		if (!current) throw new Error(`Job not found: ${id}`);

		const next: Job = { ...current, ...patch };
		await this.db
			.prepare(
				`UPDATE jobs SET
          phone = ?,
          customer_name = ?,
          appliance = ?,
          model_serial = ?,
          status = ?,
          parts_status = ?,
          parts_eta = ?,
          assigned_tech_id = ?,
          scheduled_at = ?,
          zone = ?,
          skill = ?
         WHERE id = ?`,
			)
			.bind(
				next.phone,
				next.customerName,
				next.appliance,
				next.modelSerial ?? null,
				next.status,
				next.partsStatus,
				next.partsEta ?? null,
				next.assignedTechId ?? null,
				next.scheduledAt ?? null,
				next.zone ?? null,
				next.skill ?? null,
				id,
			)
			.run();

		const updated = await this.getJob(id);
		if (!updated) throw new Error(`Job missing after update: ${id}`);
		return updated;
	}

	async createJob(input: NewJobInput): Promise<Job> {
		const id = input.id ?? `book-${Date.now().toString(36)}`;
		if (!this.db) {
			return {
				id,
				phone: normalizePhone(input.phone),
				customerName: input.customerName,
				appliance: input.appliance,
				modelSerial: input.modelSerial,
				status: input.status ?? "Scheduled",
				partsStatus: input.partsStatus ?? "none",
				partsEta: input.partsEta,
				assignedTechId: input.assignedTechId,
				scheduledAt: input.scheduledAt,
				zone: input.zone,
				skill: input.skill,
			};
		}

		await this.db
			.prepare(
				`INSERT INTO jobs (
          id, phone, customer_name, appliance, model_serial, status,
          parts_status, parts_eta, assigned_tech_id, scheduled_at, zone, skill
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				normalizePhone(input.phone),
				input.customerName,
				input.appliance,
				input.modelSerial ?? null,
				input.status ?? "Scheduled",
				input.partsStatus ?? "none",
				input.partsEta ?? null,
				input.assignedTechId ?? null,
				input.scheduledAt ?? null,
				input.zone ?? null,
				input.skill ?? null,
			)
			.run();

		const created = await this.getJob(id);
		if (!created) throw new Error(`Job missing after create: ${id}`);
		return created;
	}
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}
