import initSql from "../migrations/0001_init.sql?raw";
import telemetrySql from "../migrations/0002_benchmark_telemetry.sql?raw";
import { seedMockCrm } from "../src/db/seed";
import type { Env } from "../src/env";
import { syncFromWorkiz } from "../src/services/sync";
import { createWorkizClient } from "../src/workiz/create-client";

export async function resetDatabase(env: Env) {
	// Strip comments and split by semicolon
	const allSql = `${initSql}\n${telemetrySql}`;
	const cleanSql = allSql.replace(/--.*$/gm, "");
	const statements = cleanSql
		.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	for (const statement of statements) {
		try {
			await env.DB.prepare(statement).run();
		} catch {
			// Table or index may already exist
		}
	}

	// Clear tables
	const tables = [
		"customers",
		"technicians",
		"jobs",
		"jobs_cache",
		"technicians_cache",
		"availability_slots",
		"verification_attempts",
		"benchmark_runs",
		"benchmark_turn_metrics",
	];
	for (const table of tables) {
		try {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		} catch {
			// Ignore if table doesn't exist yet
		}
	}

	// Re-seed mock crm and sync cache
	await seedMockCrm(env.DB);
	const client = createWorkizClient(env, { pageDelayMs: 0 });
	await syncFromWorkiz(env.DB, client);
}
