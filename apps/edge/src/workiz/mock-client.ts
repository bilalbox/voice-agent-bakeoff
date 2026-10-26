import type { Env } from "../env";
import {
  jobFromRow,
  techFromRow,
  type JobRow,
  type TechRow,
} from "../db/rows";
import { normalizePhone } from "./mappers/fromWorkizApi";
import type {
  Job,
  NewJobInput,
  Page,
  PageArgs,
  Technician,
  WorkizClient,
} from "./types";

/**
 * D1-backed mock CRM. listJobs/listTeam simulate Workiz offset pagination
 * (and optional delay) so Stack 1 can reproduce mid-call dead air.
 */
export class MockWorkizClient implements WorkizClient {
  constructor(
    private readonly db: D1Database,
    private readonly pageDelayMs = 0,
  ) {}

  static fromEnv(env: Env): MockWorkizClient {
    const delay = Number(env.MOCK_PAGE_DELAY_MS ?? "400");
    return new MockWorkizClient(env.DB, Number.isFinite(delay) ? delay : 400);
  }

  async findJobsByPhone(phone: string): Promise<Job[]> {
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
    await sleep(this.pageDelayMs);
    const limit = Math.max(1, Math.min(page.limit, 50));
    const offset = Math.max(0, page.offset);

    const { results } = await this.db
      .prepare(
        `SELECT j.*, t.name AS tech_name
         FROM jobs j
         LEFT JOIN technicians t ON t.id = j.assigned_tech_id
         ORDER BY j.id
         LIMIT ? OFFSET ?`,
      )
      .bind(limit + 1, offset)
      .all<JobRow & { tech_name: string | null }>();

    const rows = results ?? [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => jobFromRow(r, r.tech_name));
    return { items, hasMore };
  }

  async listTeam(page: PageArgs): Promise<Page<Technician>> {
    await sleep(this.pageDelayMs);
    const limit = Math.max(1, Math.min(page.limit, 50));
    const offset = Math.max(0, page.offset);

    const { results } = await this.db
      .prepare(
        `SELECT * FROM technicians ORDER BY id LIMIT ? OFFSET ?`,
      )
      .bind(limit + 1, offset)
      .all<TechRow>();

    const rows = results ?? [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(techFromRow);
    return { items, hasMore };
  }

  async updateJob(id: string, patch: Partial<Job>): Promise<Job> {
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
