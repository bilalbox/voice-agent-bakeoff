import { Hono } from "hono";
import type { Env } from "../env";
import { assertAdmin } from "../lib/auth";
import { createWorkizClient } from "../workiz/create-client";

/** Workiz-shaped paginated façade for Stack 1 demos / Postman. Only served in mock mode. */
export const mockWorkizRoutes = new Hono<{ Bindings: Env }>();

mockWorkizRoutes.use("*", async (c, next) => {
	if ((c.env.WORKIZ_MODE ?? "mock") !== "mock") {
		return c.json({ error: "Not Found" }, 404);
	}
	if (!assertAdmin(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return next();
});

mockWorkizRoutes.get("/job/all", async (c) => {
	const offset = Number(c.req.query("offset") ?? "0");
	const limit = Number(c.req.query("limit") ?? "10");
	const client = createWorkizClient(c.env);
	const page = await client.listJobs({ offset, limit });
	return c.json({
		data: page.items,
		offset,
		limit,
		has_more: page.hasMore,
	});
});

mockWorkizRoutes.get("/team/all", async (c) => {
	const offset = Number(c.req.query("offset") ?? "0");
	const limit = Number(c.req.query("limit") ?? "10");
	const client = createWorkizClient(c.env);
	const page = await client.listTeam({ offset, limit });
	return c.json({
		data: page.items,
		offset,
		limit,
		has_more: page.hasMore,
	});
});
