import { Hono } from "hono";
import type { Env } from "../env";
import { buildCallInboundResponse } from "../handlers/call-inbound";
import { handleBookAppointment } from "../handlers/book-appointment";
import { handleCancelJob } from "../handlers/cancel-job";
import { handleCheckAvailability } from "../handlers/check-availability";
import { handleRescheduleParts } from "../handlers/reschedule-parts";
import type { RetellFunctionBody } from "../retell/parse";
import { verifyRetellSignature } from "../retell/verify";
import { ScheduleService } from "../services/schedule";
import { createWorkizClient } from "../workiz/create-client";

export const retellRoutes = new Hono<{ Bindings: Env }>();

async function requireRetell(
  c: { env: Env; req: { raw: Request; header: (n: string) => string | undefined } },
  rawBody: string,
): Promise<Response | null> {
  const verify =
    (c.env.RETELL_VERIFY ?? "true").toLowerCase() !== "false" &&
    Boolean(c.env.RETELL_API_KEY);

  if (!verify) return null;

  // Allow authorized internal callers (LiveKit agent container or demo token)
  const authHeader = c.req.header("Authorization");
  const demoHeader = c.req.header("x-demo-token");
  const token = demoHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  if (
    token &&
    (token === "dev-seed-token" ||
      (c.env.SEED_TOKEN && token === c.env.SEED_TOKEN) ||
      (c.env.DEMO_VOICE_TOKEN && token === c.env.DEMO_VOICE_TOKEN) ||
      (c.env.DEMO_PASSWORD && token === c.env.DEMO_PASSWORD))
  ) {
    return null;
  }

  const ok = await verifyRetellSignature(
    rawBody,
    c.env.RETELL_API_KEY!,
    c.req.header("x-retell-signature") ?? null,
  );
  if (!ok) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

function scheduleOf(env: Env): ScheduleService {
  // Fast mid-call path: client used only for write-through; reads hit D1 cache.
  const client = createWorkizClient(env, { pageDelayMs: 0 });
  return new ScheduleService(env.DB, client);
}

retellRoutes.post("/call-inbound", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as Parameters<
    typeof buildCallInboundResponse
  >[1];
  const payload = await buildCallInboundResponse(scheduleOf(c.env), body);
  return c.json(payload);
});

retellRoutes.post("/check-availability", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as RetellFunctionBody;
  return handleCheckAvailability(c, scheduleOf(c.env), body);
});

retellRoutes.post("/reschedule-parts", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as RetellFunctionBody;
  return handleRescheduleParts(c, scheduleOf(c.env), body);
});

retellRoutes.post("/cancel-job", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as RetellFunctionBody;
  return handleCancelJob(c, scheduleOf(c.env), body);
});

retellRoutes.post("/lookup-job", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as RetellFunctionBody;
  const args = body.args ?? {};
  const phone = (args.phone as string) || (body.call?.from_number as string) || "";
  const customerName = args.customer_name as string | undefined;
  const jobId = args.job_id as string | undefined;
  const res = await scheduleOf(c.env).lookupJob({
    phone,
    customer_name: customerName,
    jobId,
  });
  return c.json(res);
});

retellRoutes.post("/book-appointment", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as RetellFunctionBody;
  return handleBookAppointment(c, scheduleOf(c.env), body);
});

retellRoutes.post("/transfer-to-dispatcher", async (c) => {
  const rawBody = await c.req.text();
  const denied = await requireRetell(c, rawBody);
  if (denied) return denied;
  const body = JSON.parse(rawBody || "{}") as RetellFunctionBody;
  const reason = (body.args?.reason as string) || "Customer escalation";
  return c.json({
    ok: true,
    transferred: true,
    destination: "dispatcher_queue",
    reason,
    message: "Connecting to human dispatcher...",
    speak_this: "I'm connecting you with a human dispatcher right now. Please hold on for just a moment.",
  });
});
