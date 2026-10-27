import { BenchmarkRunIngestSchema } from "@applianceops/contracts";
import { Hono } from "hono";
import type { Env } from "../env";
import { TelemetryService } from "../services/telemetry";

export const benchmarkRoutes = new Hono<{ Bindings: Env }>();

benchmarkRoutes.post("/telemetry", async (c) => {
	try {
		const rawBody = await c.req.json();
		const parseResult = BenchmarkRunIngestSchema.safeParse(rawBody);

		if (!parseResult.success) {
			return c.json(
				{
					ok: false,
					error: "Invalid benchmark telemetry schema",
					details: parseResult.error.issues,
				},
				400,
			);
		}

		const telemetry = new TelemetryService(c.env.DB);
		const result = await telemetry.recordRun(parseResult.data);

		return c.json({
			ok: true,
			message: "Telemetry recorded successfully",
			...result,
		});
	} catch (err: any) {
		return c.json(
			{
				ok: false,
				error: "Failed to record telemetry",
				message: err.message,
			},
			500,
		);
	}
});

benchmarkRoutes.get("/telemetry", async (c) => {
	try {
		const telemetry = new TelemetryService(c.env.DB);
		const comparison = await telemetry.getComparison();
		return c.json(comparison);
	} catch (err: any) {
		return c.json(
			{
				ok: false,
				error: "Failed to fetch benchmark comparison",
				message: err.message,
			},
			500,
		);
	}
});

benchmarkRoutes.get("/runs", async (c) => {
	try {
		const limit = Number(c.req.query("limit") ?? "50");
		const telemetry = new TelemetryService(c.env.DB);
		const runs = await telemetry.listRuns(limit);
		return c.json({ ok: true, count: runs.length, runs });
	} catch (err: any) {
		return c.json(
			{
				ok: false,
				error: "Failed to list benchmark runs",
				message: err.message,
			},
			500,
		);
	}
});
