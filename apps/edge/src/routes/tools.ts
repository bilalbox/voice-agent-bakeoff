import { Hono } from "hono";
import type { Env } from "../env";
import { ToolExecutionService } from "../services/tool-execution";
import { ScheduleRepository, createWorkizClient } from "@applianceops/schedule-store";

export const toolRoutes = new Hono<{ Bindings: Env }>();

/**
 * Standard REST authorization middleware for tools API.
 * Accepts standard Bearer token or x-demo-token without requiring Retell HMAC signatures.
 */
function checkAuth(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}): Response | null {
  const verify = (c.env.RETELL_VERIFY ?? "true").toLowerCase() !== "false";
  const authHeader = c.req.header("Authorization");
  const demoHeader = c.req.header("x-demo-token");
  const token = demoHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  // If local / dev seed token allowed
  if (
    token &&
    (token === "dev-seed-token" ||
      (c.env.SEED_TOKEN && token === c.env.SEED_TOKEN) ||
      (c.env.DEMO_VOICE_TOKEN && token === c.env.DEMO_VOICE_TOKEN) ||
      (c.env.DEMO_PASSWORD && token === c.env.DEMO_PASSWORD))
  ) {
    return null;
  }

  // If no auth secret configured and verification turned off in local dev
  if (!verify && !c.env.SEED_TOKEN && !c.env.DEMO_VOICE_TOKEN) {
    return null;
  }

  return new Response(
    JSON.stringify({ ok: false, error: "Unauthorized", message: "Valid authorization token required." }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function toolExecutionServiceOf(env: Env): ToolExecutionService {
  const client = createWorkizClient(env, { pageDelayMs: 0 });
  const repo = new ScheduleRepository(env.DB, client);
  return new ToolExecutionService(repo);
}

// Inbound caller context endpoint
toolRoutes.post("/call-inbound", async (c) => {
  const denied = checkAuth(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const service = toolExecutionServiceOf(c.env);
  const phone =
    (body.phone as string) ||
    (body.from_number as string) ||
    c.req.header("x-caller-phone") ||
    "";

  const result = await service.execute("call_inbound", { phone }, {
    callerPhone: phone,
    callId: c.req.header("x-call-id"),
  });

  return c.json(result.data, (result.status || 200) as any, {
    "X-Tool-Latency-Ms": String(result.latencyMs),
  });
});

// Canonical dynamic tool execution endpoint by tool name
toolRoutes.post("/:toolName", async (c) => {
  const denied = checkAuth(c);
  if (denied) return denied;

  const toolName = c.req.param("toolName");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const service = toolExecutionServiceOf(c.env);

  const callId =
    (typeof body.call_id === "string" ? body.call_id : "") ||
    c.req.header("x-call-id") ||
    "";
  const callerPhone =
    (typeof body.caller_phone === "string" ? body.caller_phone : "") ||
    c.req.header("x-caller-phone") ||
    "";

  const result = await service.execute(toolName, body, {
    callId,
    callerPhone,
    feeAmount: Number(c.env.CANCEL_FEE_AMOUNT ?? "85"),
    feeHours: Number(c.env.CANCEL_FEE_HOURS ?? "24"),
  });

  return c.json(result.data, (result.status || 200) as any, {
    "X-Tool-Latency-Ms": String(result.latencyMs),
  });
});
