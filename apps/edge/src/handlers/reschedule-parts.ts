import type { Context } from "hono";
import type { Env } from "../env";
import { extractArgs, type RetellFunctionBody } from "../retell/parse";
import { evaluatePartsReschedule } from "@applianceops/contracts";
import type { ScheduleService } from "../services/schedule";

export async function handleRescheduleParts(
  c: Context<{ Bindings: Env }>,
  schedule: ScheduleService,
  body: RetellFunctionBody,
): Promise<Response> {
  const t0 = performance.now();
  const args = extractArgs(body);
  const jobId = String(args.job_id ?? "");
  const preferredDate = String(args.preferred_date ?? "");

  if (!jobId || !preferredDate) {
    return c.json(
      { ok: false, error: "job_id and preferred_date are required" },
      400,
    );
  }

  const job = await schedule.getJobCached(jobId);
  if (!job) {
    return c.json({ ok: false, error: `Job not found: ${jobId}` }, 404);
  }

  const decision = evaluatePartsReschedule(job, preferredDate);
  if (!decision.ok) {
    const ms = Math.round(performance.now() - t0);
    return c.json(
      { ...decision, latency_ms: ms },
      200,
      { "X-Tool-Latency-Ms": String(ms) },
    );
  }

  const updated = await schedule.updateJobAndCache(jobId, {
    scheduledAt: decision.scheduled_at,
    status: "Parts Install Scheduled",
    assignedTechId: decision.assigned_tech_id ?? job.assignedTechId,
  });

  const ms = Math.round(performance.now() - t0);
  return c.json(
    {
      ok: true,
      job_id: updated.id,
      scheduled_at: updated.scheduledAt,
      assigned_tech_id: updated.assignedTechId,
      assigned_tech_name: updated.assignedTechName,
      parts_status: updated.partsStatus,
      message: decision.message,
      latency_ms: ms,
    },
    200,
    {
      "X-Tool-Latency-Ms": String(ms),
      "Server-Timing": `app;dur=${ms}`,
    },
  );
}
