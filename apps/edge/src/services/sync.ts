import {
	addCalendarDays,
	calendarPartsInZone,
	wallTimeToUtc,
} from "../lib/timezone";
import type { WorkizClient } from "../workiz/types";

const SLOT_TZ = "America/Los_Angeles";
const BUSINESS_HOURS_PT = [8, 10, 12, 14, 16];

const PAGE_SIZE = 25;

/**
 * Paginate WorkizClient → upsert D1 mid-call cache.
 * Same entrypoint for mock seed refresh and live trial pull.
 */
export async function syncFromWorkiz(
	db: D1Database,
	client: WorkizClient,
): Promise<{ jobs: number; technicians: number; slots: number }> {
	const syncedAt = new Date().toISOString();
	let jobs = 0;
	let technicians = 0;

	// Reset cache tables for a clean sync (demo-scale data)
	await db.batch([
		db.prepare("DELETE FROM jobs_cache"),
		db.prepare("DELETE FROM technicians_cache"),
		db.prepare("DELETE FROM availability_slots"),
	]);

	let offset = 0;
	for (;;) {
		const page = await client.listTeam({ offset, limit: PAGE_SIZE });
		for (const tech of page.items) {
			await db
				.prepare(
					`INSERT INTO technicians_cache (id, name, skills, zone, active, synced_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					tech.id,
					tech.name,
					tech.skills.join(","),
					tech.zone,
					tech.active ? 1 : 0,
					syncedAt,
				)
				.run();
			technicians += 1;
		}
		if (!page.hasMore) break;
		offset += PAGE_SIZE;
	}

	offset = 0;
	const techNameById = new Map<string, string>();
	const { results: techRows } = await db
		.prepare("SELECT id, name FROM technicians_cache")
		.all<{ id: string; name: string }>();
	for (const t of techRows ?? []) techNameById.set(t.id, t.name);

	for (;;) {
		const page = await client.listJobs({ offset, limit: PAGE_SIZE });
		for (const job of page.items) {
			const techName =
				job.assignedTechName ??
				(job.assignedTechId
					? techNameById.get(job.assignedTechId)
					: undefined) ??
				null;
			await db
				.prepare(
					`INSERT INTO jobs_cache (
            id, phone, customer_name, appliance, model_serial, status,
            parts_status, parts_eta, assigned_tech_id, assigned_tech_name,
            scheduled_at, zone, skill, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
					techName,
					job.scheduledAt ?? null,
					job.zone ?? null,
					job.skill ?? null,
					syncedAt,
				)
				.run();
			jobs += 1;
		}
		if (!page.hasMore) break;
		offset += PAGE_SIZE;
	}

	const slots = await rebuildAvailabilitySlots(db, syncedAt);
	return { jobs, technicians, slots };
}

/** Precompute open 2-hour arrival windows from tech zones/skills minus booked jobs. */
async function rebuildAvailabilitySlots(
	db: D1Database,
	syncedAt: string,
): Promise<number> {
	const { results: techs } = await db
		.prepare(
			`SELECT id, name, skills, zone FROM technicians_cache WHERE active = 1`,
		)
		.all<{ id: string; name: string; skills: string; zone: string }>();

	const { results: booked } = await db
		.prepare(
			`SELECT assigned_tech_id, scheduled_at FROM jobs_cache
       WHERE scheduled_at IS NOT NULL AND status NOT IN ('cancelled', 'Canceled', 'done', 'completed')`,
		)
		.all<{ assigned_tech_id: string | null; scheduled_at: string }>();

	const bookedKeys = new Set(
		(booked ?? [])
			.filter((b) => b.assigned_tech_id && b.scheduled_at)
			.map((b) => `${b.assigned_tech_id}|${hourBucket(b.scheduled_at)}`),
	);

	const now = new Date();
	const todayLA = calendarPartsInZone(now, SLOT_TZ);
	const stmts: D1PreparedStatement[] = [];
	let slots = 0;

	for (const tech of techs ?? []) {
		const skills = tech.skills
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		for (let day = 0; day < 5; day++) {
			const cal = addCalendarDays(todayLA, day);
			for (const hour of BUSINESS_HOURS_PT) {
				const start = wallTimeToUtc(
					cal.year,
					cal.month,
					cal.day,
					hour,
					0,
					SLOT_TZ,
				);
				if (start.getTime() <= now.getTime()) continue;

				const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
				const key = `${tech.id}|${hourBucket(start.toISOString())}`;
				if (bookedKeys.has(key)) continue;

				for (const skill of skills.length ? skills : ["general"]) {
					const id = `${tech.id}-${start.toISOString()}-${skill}`;
					stmts.push(
						db
							.prepare(
								`INSERT INTO availability_slots (
                  id, tech_id, tech_name, zone, skill, window_start, window_end, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
							)
							.bind(
								id,
								tech.id,
								tech.name,
								tech.zone,
								skill,
								start.toISOString(),
								end.toISOString(),
								syncedAt,
							),
					);
					slots += 1;
				}
			}
		}
	}

	// D1 batch limit ~100 statements — chunk
	for (let i = 0; i < stmts.length; i += 50) {
		await db.batch(stmts.slice(i, i + 50));
	}

	return slots;
}

function hourBucket(iso: string): string {
	const d = new Date(iso);
	d.setUTCMinutes(0, 0, 0);
	return d.toISOString();
}

/** Refresh a single job row in cache after a mid-call write. */
export async function upsertJobCache(
	db: D1Database,
	job: import("../workiz/types").Job,
): Promise<void> {
	const syncedAt = new Date().toISOString();
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
