import { Hono, type Context } from "hono";
import type { Env } from "../env";

export const voiceRoutes = new Hono<{ Bindings: Env }>();

/**
 * Validates demo security token from Authorization Bearer or x-demo-token header
 */
export function isVoiceAuthorized(c: Context<{ Bindings: Env }>): boolean {
  const authHeader = c.req.header("Authorization");
  const tokenHeader = c.req.header("x-demo-token");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const candidate = tokenHeader || bearerToken;
  if (!candidate) return false;

  if (candidate === "dev-seed-token") return true;
  if (c.env.DEMO_VOICE_TOKEN && candidate === c.env.DEMO_VOICE_TOKEN) return true;
  if (c.env.SEED_TOKEN && candidate === c.env.SEED_TOKEN) return true;
  if (c.env.DEMO_PASSWORD && candidate === c.env.DEMO_PASSWORD) return true;

  return false;
}

/**
 * Generate LiveKit Access Token JWT using standard Web Crypto HMAC-SHA256
 */
async function generateLiveKitJwt(options: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds || 3600;
  const payload: Record<string, unknown> = {
    iss: options.apiKey,
    sub: options.identity,
    identity: options.identity,
    name: options.identity,
    video: {
      roomJoin: true,
      room: options.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
    iat: now,
    nbf: now,
    exp: now + ttl,
  };

  if (options.metadata) {
    payload.metadata = JSON.stringify(options.metadata);
  }

  const b64Url = (input: string | Uint8Array) => {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };

  const unsignedToken = `${b64Url(JSON.stringify(header))}.${b64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(unsignedToken),
  );
  const signatureB64 = b64Url(new Uint8Array(signature));

  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Build dynamic variables for caller persona presets
 */
function getScenarioVariables(scenario?: string, callerPhone?: string): Record<string, string> {
  const phone = callerPhone || "";

  if (scenario === "sarah" || phone.includes("1042") || phone.includes("4200")) {
    return {
      customer_name: "Sarah",
      open_job_status: "Parts Install Scheduled",
      assigned_tech: "Mike R.",
      job_id: "1042",
      appliance: "Sub-Zero Refrigerator",
      model_serial: "WRF535SWHZ04",
      parts_status: "in_stock",
      known_caller: "true",
    };
  }

  if (scenario === "omar" || phone.includes("1088") || phone.includes("8800")) {
    return {
      customer_name: "Omar",
      open_job_status: "Repair Scheduled",
      assigned_tech: "Sam T.",
      job_id: "1088",
      appliance: "Bosch Dishwasher",
      model_serial: "SHPM78Z55N",
      parts_status: "none",
      known_caller: "true",
    };
  }

  if (scenario === "security-cancel-someone-elses-job" || scenario === "intruder") {
    return {
      customer_name: "Intruder",
      open_job_status: "none",
      assigned_tech: "",
      job_id: "1088",
      appliance: "Bosch Dishwasher",
      model_serial: "",
      parts_status: "",
      known_caller: "false",
    };
  }

  if (scenario === "security-book-unsupported-service" || scenario === "pool-heater") {
    return {
      customer_name: "Customer",
      open_job_status: "none",
      assigned_tech: "",
      job_id: "",
      appliance: "Pool Heater",
      model_serial: "",
      parts_status: "",
      known_caller: "false",
    };
  }

  // New Customer / General Booking
  return {
    customer_name: "there",
    open_job_status: "none",
    assigned_tech: "",
    job_id: "",
    appliance: "",
    model_serial: "",
    parts_status: "",
    known_caller: "false",
  };
}

/**
 * 1. Verify Authentication
 */
voiceRoutes.post("/auth", async (c) => {
  let candidateToken: string | undefined;

  try {
    const body = await c.req.json();
    candidateToken = body.token || body.password;
  } catch {
    // Body is optional if passed via header
  }

  const authHeader = c.req.header("Authorization");
  const tokenHeader = c.req.header("x-demo-token");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = candidateToken || tokenHeader || bearerToken;

  const isValid =
    token === "dev-seed-token" ||
    (c.env.DEMO_VOICE_TOKEN && token === c.env.DEMO_VOICE_TOKEN) ||
    (c.env.SEED_TOKEN && token === c.env.SEED_TOKEN) ||
    (c.env.DEMO_PASSWORD && token === c.env.DEMO_PASSWORD);

  if (!token || !isValid) {
    return c.json(
      {
        ok: false,
        error: "Unauthorized",
        message: "Invalid security token or password.",
      },
      401,
    );
  }

  return c.json({
    ok: true,
    message: "Demo session authenticated successfully.",
    token,
  });
});

/**
 * 2. Create Voice Session (Protected)
 */
voiceRoutes.post("/session", async (c) => {
  if (!isVoiceAuthorized(c)) {
    return c.json(
      {
        ok: false,
        error: "Unauthorized",
        message: "Security token required to create voice session.",
      },
      401,
    );
  }

  let body: {
    architecture?: "retell" | "livekit" | "cloudflare";
    scenario?: string;
    caller_phone?: string;
  } = {};

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const architecture = body.architecture || "retell";
  const scenario = body.scenario || "sarah";
  const callerPhone = body.caller_phone || (scenario === "sarah" ? "+15550104200" : scenario === "omar" ? "+15550108800" : "");
  const dynamicVars = getScenarioVariables(scenario, callerPhone);

  // ---------------------------------------------------------------------------
  // Architecture A: Retell AI Managed
  // ---------------------------------------------------------------------------
  if (architecture === "retell") {
    const apiKey = c.env.RETELL_API_KEY;
    const agentId = c.env.RETELL_AGENT_ID || "agent_5eb84d600795d3d2f65684b721";

    if (!apiKey) {
      return c.json(
        {
          ok: false,
          error: "RETELL_API_KEY is not configured in environment.",
        },
        500,
      );
    }

    try {
      const resp = await fetch("https://api.retellai.com/v2/create-web-call", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: agentId,
          retell_llm_dynamic_variables: dynamicVars,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return c.json(
          {
            ok: false,
            error: "Failed to create Retell Web Call",
            details: errText,
          },
          resp.status as any,
        );
      }

      const data = (await resp.json()) as { access_token: string; call_id: string; agent_id?: string };
      return c.json({
        ok: true,
        architecture: "retell",
        access_token: data.access_token,
        call_id: data.call_id,
        agent_id: data.agent_id || agentId,
        scenario,
        dynamic_variables: dynamicVars,
      });
    } catch (err: any) {
      return c.json(
        {
          ok: false,
          error: "Error contacting Retell API",
          message: err.message,
        },
        500,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Architecture B: LiveKit Agents
  // ---------------------------------------------------------------------------
  if (architecture === "livekit") {
    const wsUrl = c.env.LIVEKIT_WS_URL || c.env.LIVEKIT_URL || "wss://demo1-fhb0ecf7.livekit.cloud";
    let roomName = `applianceops-${Date.now().toString(36)}`;
    let token = c.env.LIVEKIT_API_TOKEN;

    if (c.env.LIVEKIT_API_SECRET?.startsWith("eyJ")) {
      return c.json(
        {
          ok: false,
          error: "Invalid LIVEKIT_API_SECRET configuration: LIVEKIT_API_SECRET is currently set to a client JWT token (starts with 'eyJ') rather than your LiveKit project API Secret. Retrieve your API Secret from https://cloud.livekit.io (Project Settings > Keys).",
        },
        500,
      );
    }

    if (c.env.LIVEKIT_API_KEY && c.env.LIVEKIT_API_SECRET) {
      try {
        token = await generateLiveKitJwt({
          apiKey: c.env.LIVEKIT_API_KEY,
          apiSecret: c.env.LIVEKIT_API_SECRET,
          room: roomName,
          identity: `caller-${Date.now().toString(36).slice(-5)}`,
          metadata: { caller_phone: callerPhone, scenario },
        });
      } catch (err: any) {
        return c.json(
          {
            ok: false,
            error: "Failed to generate LiveKit token",
            message: err.message,
          },
          500,
        );
      }
    } else if (token) {
      // Validate static token if provided
      try {
        const payloadStr = atob(token.split(".")[1]);
        const payload = JSON.parse(payloadStr);
        if (payload.exp && payload.exp < Date.now() / 1000) {
          return c.json(
            {
              ok: false,
              error: `Configured LIVEKIT_API_TOKEN has expired (expired at ${new Date(payload.exp * 1000).toISOString()}). Provide valid LIVEKIT_API_KEY and LIVEKIT_API_SECRET.`,
            },
            500,
          );
        }
        if (payload.video?.room) {
          roomName = payload.video.room;
        }
      } catch {}
    }

    if (!token) {
      return c.json(
        {
          ok: false,
          error: "LiveKit token or credentials not configured. Please set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
        },
        500,
      );
    }

    if (c.env.LIVEKIT_CONTAINER_URL) {
      const containerUrl = c.env.LIVEKIT_CONTAINER_URL.replace(/\/$/, "");
      try {
        c.executionCtx?.waitUntil?.(
          fetch(`${containerUrl}/start`, { method: "POST" }).catch(() => {})
        );
      } catch {}
    }

    return c.json({
      ok: true,
      architecture: "livekit",
      server_url: wsUrl,
      token,
      room_name: roomName,
      scenario,
      caller_phone: callerPhone,
    });
  }

  // ---------------------------------------------------------------------------
  // Architecture C: Cloudflare Voice Agents (Edge Native)
  // ---------------------------------------------------------------------------
  if (architecture === "cloudflare") {
    const agentUrl = c.env.CLOUDFLARE_AGENT_URL || "https://applianceops-agent-cloudflare.23p.workers.dev";
    const wsUrl = agentUrl.replace(/^http/, "ws") + "/agents/voice/default";

    return c.json({
      ok: true,
      architecture: "cloudflare",
      agent_url: agentUrl,
      ws_url: wsUrl,
      scenario,
      caller_phone: callerPhone,
      dynamic_variables: dynamicVars,
    });
  }

  return c.json({ ok: false, error: `Unknown architecture: ${architecture}` }, 400);
});

/**
 * 3. Cloudflare DO Turn Execution Proxy (Protected)
 */
voiceRoutes.post("/cloudflare/turn", async (c) => {
  if (!isVoiceAuthorized(c)) {
    return c.json(
      {
        ok: false,
        error: "Unauthorized",
        message: "Security token required.",
      },
      401,
    );
  }

  try {
    const body = await c.req.json();
    const agentUrl = c.env.CLOUDFLARE_AGENT_URL || "https://applianceops-agent-cloudflare.23p.workers.dev";
    
    let resp: Response;
    if (c.env.CLOUDFLARE_AGENT_SERVICE) {
      resp = await c.env.CLOUDFLARE_AGENT_SERVICE.fetch("https://internal/simulate-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      resp = await fetch(`${agentUrl}/simulate-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!resp.ok) {
      const errText = await resp.text();
      return c.json(
        {
          ok: false,
          error: `Cloudflare agent error (HTTP ${resp.status})`,
          message: errText,
        },
        resp.status as any,
      );
    }

    const data = await resp.json();
    return c.json(data, resp.status as any);
  } catch (err: any) {
    return c.json(
      {
        ok: false,
        error: "Failed to execute Cloudflare agent turn",
        message: err.message,
      },
      500,
    );
  }
});
