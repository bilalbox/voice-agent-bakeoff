import { Hono } from "hono";
import { seedMockCrm } from "../db/seed";
import type { Env } from "../env";
import { assertAdmin } from "../lib/auth";
import { syncFromWorkiz } from "../services/sync";
import { createWorkizClient } from "../workiz/create-client";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.post("/sync", async (c) => {
	if (!assertAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
	const client = createWorkizClient(c.env, { pageDelayMs: 0 });
	const result = await syncFromWorkiz(c.env.DB, client);
	return c.json({
		ok: true,
		...result,
		workiz_mode: c.env.WORKIZ_MODE ?? "mock",
	});
});

adminRoutes.post("/seed", async (c) => {
	if (!assertAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
	if ((c.env.WORKIZ_MODE ?? "mock") !== "mock") {
		return c.json(
			{
				error:
					"Seed only applies in WORKIZ_MODE=mock. Use /admin/sync for live.",
			},
			400,
		);
	}
	const seeded = await seedMockCrm(c.env.DB);
	const client = createWorkizClient(c.env, { pageDelayMs: 0 });
	const synced = await syncFromWorkiz(c.env.DB, client);
	return c.json({ ok: true, seeded, synced });
});

adminRoutes.get("/jobs", async (c) => {
	if (!assertAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
	const limit = Math.min(Number(c.req.query("limit") ?? "25"), 100);
	const { results } = await c.env.DB.prepare(
		`SELECT * FROM jobs_cache ORDER BY synced_at DESC LIMIT ?`,
	)
		.bind(limit)
		.all();
	return c.json({ ok: true, count: results?.length ?? 0, jobs: results ?? [] });
});

adminRoutes.get("/jobs/:id", async (c) => {
	const id = c.req.param("id");
	const row = await c.env.DB.prepare(`SELECT * FROM jobs_cache WHERE id = ?`)
		.bind(id)
		.first();
	if (!row) return c.json({ error: "Not found" }, 404);
	return c.json(row);
});
