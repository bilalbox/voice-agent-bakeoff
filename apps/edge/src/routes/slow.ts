import { Hono } from "hono";
import type { Env } from "../env";
import { extractArgs, type RetellFunctionBody } from "../retell/parse";
import { checkAvailabilityUncached } from "../services/schedule";
import { createWorkizClient } from "../workiz/create-client";

/** Stack 1: uncached paginated CRM lookups (intentional dead air). */
export const slowRoutes = new Hono<{ Bindings: Env }>();

slowRoutes.post("/check-availability", async (c) => {
  const body = (await c.req.json()) as RetellFunctionBody;
  const args = extractArgs(body);
  const client = createWorkizClient(c.env); // includes mock page delay
  const result = await checkAvailabilityUncached(client, {
    zone: typeof args.zone === "string" ? args.zone : undefined,
    skill:
      typeof args.skill === "string"
        ? args.skill
        : typeof args.appliance_type === "string"
          ? args.appliance_type
          : undefined,
    preferred_date:
      typeof args.preferred_date === "string" ? args.preferred_date : undefined,
  });

  return c.json(
    {
      open_windows: result.slots,
      count: result.slots.length,
      source: "uncached_paginated_workiz",
      pages_fetched: result.pagesFetched,
      latency_ms: result.ms,
      warning:
        "This path mirrors n8n → sequential Workiz /job/all + /team/all mid-call.",
    },
    200,
    {
      "X-Tool-Latency-Ms": String(result.ms),
      "Server-Timing": `app;dur=${result.ms}`,
    },
  );
});
