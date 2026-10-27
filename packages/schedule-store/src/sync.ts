import type { Job, Technician, WorkizClient } from "./types";

export async function upsertJobCache(
	db: D1Database,
	job: Job,
	syncedAt = new Date().toISOString(),
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO jobs_cache (
        id, phone, customer_name, appliance, model_serial, status,
        parts_status, parts_eta, assigned_tech_id, assigned_tech_name,
        scheduled_at, zone, skill, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phone = excluded.phone,
        customer_name = excluded.customer_name,
        appliance = excluded.appliance,
        model_serial = excluded.model_serial,
        status = excluded.status,
        parts_status = excluded.parts_status,
        parts_eta = excluded.parts_eta,
        assigned_tech_id = excluded.assigned_tech_id,
        assigned_tech_name = excluded.assigned_tech_name,
        scheduled_at = excluded.scheduled_at,
        zone = excluded.zone,
        skill = excluded.skill,
        synced_at = excluded.synced_at`,
		)
		.bind(
			job.id,
			job.phone,
			job.customerName,
			job.appliance,
			job.modelSerial ?? null,
			job.status,
			job.partsStatus,
			job.partsEta ?? null,
			job.assignedTechId ?? null,
			job.assignedTechName ?? null,
			job.scheduledAt ?? null,
			job.zone ?? null,
			job.skill ?? null,
			syncedAt,
		)
		.run();
}
