import { type Context, Hono } from "hono";
import type { Env } from "../env";

export const voiceRoutes = new Hono<{ Bindings: Env }>();

/**
 * Validates demo security token from Authorization Bearer or x-demo-token header
 */
export function isVoiceAuthorized(c: Context<{ Bindings: Env }>): boolean {
	const authHeader = c.req.header("Authorization");
	const tokenHeader = c.req.header("x-demo-token");
	const bearerToken = authHeader?.startsWith("Bearer ")
		? authHeader.slice(7)
		: null;
	const candidate = tokenHeader || bearerToken;
	if (!candidate) return false;

	if (candidate === "dev-seed-token") return true;
	if (c.env.DEMO_VOICE_TOKEN && candidate === c.env.DEMO_VOICE_TOKEN)
		return true;
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
		const bytes =
			typeof input === "string" ? new TextEncoder().encode(input) : input;
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			const b = bytes[i];
			if (b !== undefined) {
				binary += String.fromCharCode(b);
			}
		}
		return btoa(binary)
			.replace(/=/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");
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
function getScenarioVariables(
	scenario?: string,
	callerPhone?: string,
): Record<string, string> {
	const phone = callerPhone || "";

	if (
		scenario === "sarah" ||
		phone.includes("1042") ||
		phone.includes("4200")
	) {
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

	if (
		scenario === "security-cancel-someone-elses-job" ||
		scenario === "intruder"
	) {
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

	if (
		scenario === "security-book-unsupported-service" ||
		scenario === "pool-heater"
	) {
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
	const bearerToken = authHeader?.startsWith("Bearer ")
		? authHeader.slice(7)
		: null;
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

async function handleRetellSession(
	c: Context<{ Bindings: Env }>,
	scenario: string,
	dynamicVars: Record<string, string>,
): Promise<Response> {
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
				400,
			);
		}

		const data = (await resp.json()) as {
			access_token: string;
			call_id: string;
			agent_id?: string;
		};
		return c.json({
			ok: true,
			architecture: "retell",
			access_token: data.access_token,
			call_id: data.call_id,
			agent_id: data.agent_id || agentId,
			scenario,
			dynamic_variables: dynamicVars,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Error contacting Retell API",
				message: err instanceof Error ? err.message : String(err),
			},
			500,
		);
	}
}

function validateStaticLiveKitToken(
	token: string,
	defaultRoom: string,
):
	| { ok: true; roomName: string }
	| { ok: false; status: 400 | 500; error: string } {
	try {
		const parts = token.split(".");
		const part = parts[1];
		if (!part) {
			return { ok: false, status: 400, error: "Malformed JWT token" };
		}
		const payload = JSON.parse(atob(part)) as {
			exp?: number;
			video?: { room?: string };
		};
		if (payload.exp && payload.exp < Date.now() / 1000) {
			return {
				ok: false,
				status: 500,
				error: `Configured LIVEKIT_API_TOKEN has expired (expired at ${new Date(payload.exp * 1000).toISOString()}). Provide valid LIVEKIT_API_KEY and LIVEKIT_API_SECRET.`,
			};
		}
		return {
			ok: true,
			roomName: payload.video?.room || defaultRoom,
		};
	} catch {
		return { ok: true, roomName: defaultRoom };
	}
}

async function handleLiveKitSession(
	c: Context<{ Bindings: Env }>,
	scenario: string,
	callerPhone: string,
): Promise<Response> {
	const wsUrl =
		c.env.LIVEKIT_WS_URL ||
		c.env.LIVEKIT_URL ||
		"wss://demo1-fhb0ecf7.livekit.cloud";
	let roomName = `applianceops-${Date.now().toString(36)}`;
	let token = c.env.LIVEKIT_API_TOKEN;

	if (c.env.LIVEKIT_API_SECRET?.startsWith("eyJ")) {
		return c.json(
			{
				ok: false,
				error:
					"Invalid LIVEKIT_API_SECRET configuration: LIVEKIT_API_SECRET is currently set to a client JWT token (starts with 'eyJ') rather than your LiveKit project API Secret. Retrieve your API Secret from https://cloud.livekit.io (Project Settings > Keys).",
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
		} catch (err: unknown) {
			return c.json(
				{
					ok: false,
					error: "Failed to generate LiveKit token",
					message: err instanceof Error ? err.message : String(err),
				},
				500,
			);
		}
	} else if (token) {
		const check = validateStaticLiveKitToken(token, roomName);
		if (!check.ok) {
			return c.json({ ok: false, error: check.error }, check.status);
		}
		roomName = check.roomName;
	}

	if (!token) {
		return c.json(
			{
				ok: false,
				error:
					"LiveKit token or credentials not configured. Please set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
			},
			500,
		);
	}

	if (c.env.LIVEKIT_CONTAINER_URL) {
		const containerUrl = c.env.LIVEKIT_CONTAINER_URL.replace(/\/$/, "");
		try {
			c.executionCtx?.waitUntil?.(
				fetch(`${containerUrl}/start`, { method: "POST" }).catch(() => {}),
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

async function handleElevenLabsSession(
	c: Context<{ Bindings: Env }>,
	scenario: string,
	callerPhone: string,
	dynamicVars: Record<string, string>,
): Promise<Response> {
	const apiKey = c.env.ELEVENLABS_API_KEY;
	const agentId = c.env.ELEVENLABS_AGENT_ID;

	if (!apiKey && !agentId) {
		return c.json(
			{
				ok: false,
				error:
					"ElevenLabs credentials not configured. Please set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.",
			},
			500,
		);
	}

	const resolvedAgentId = agentId || "agent_applianceops_elevenlabs";

	// If only ELEVENLABS_AGENT_ID is set (public agent mode), allow direct agentId session
	if (!apiKey) {
		return c.json({
			ok: true,
			architecture: "elevenlabs",
			agent_id: resolvedAgentId,
			mode: "public_agent",
			scenario,
			caller_phone: callerPhone,
			dynamic_variables: dynamicVars,
		});
	}

	try {
		const [tokenResp, signedUrlResp] = await Promise.all([
			fetch(
				`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(resolvedAgentId)}`,
				{ headers: { "xi-api-key": apiKey } },
			),
			fetch(
				`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(resolvedAgentId)}`,
				{ headers: { "xi-api-key": apiKey } },
			),
		]);

		let conversationToken: string | null = null;
		let conversationId: string | null = null;
		let signedUrl: string | null = null;

		if (tokenResp.ok) {
			const tokenData = (await tokenResp.json()) as {
				token?: string;
				conversation_id?: string;
			};
			conversationToken = tokenData.token || null;
			conversationId = tokenData.conversation_id || null;
		}

		if (signedUrlResp.ok) {
			const urlData = (await signedUrlResp.json()) as { signed_url?: string };
			signedUrl = urlData.signed_url || null;
		}

		if (!conversationToken && !signedUrl) {
			const errText = await signedUrlResp.text().catch(() => "Unknown error");
			return c.json(
				{
					ok: false,
					error: "Failed to mint ElevenLabs session token or signed URL",
					details: errText,
				},
				400,
			);
		}

		return c.json({
			ok: true,
			architecture: "elevenlabs",
			agent_id: resolvedAgentId,
			conversation_token: conversationToken,
			signed_url: signedUrl,
			conversation_id: conversationId,
			scenario,
			caller_phone: callerPhone,
			dynamic_variables: dynamicVars,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Error contacting ElevenLabs Conversational AI API",
				message: err instanceof Error ? err.message : String(err),
			},
			500,
		);
	}
}

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
		architecture?: "retell" | "livekit" | "cloudflare" | "elevenlabs";
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
	const callerPhone =
		body.caller_phone ||
		(scenario === "sarah"
			? "+15550104200"
			: scenario === "omar"
				? "+15550108800"
				: "");
	const dynamicVars = getScenarioVariables(scenario, callerPhone);

	if (architecture === "retell") {
		return handleRetellSession(c, scenario, dynamicVars);
	}

	if (architecture === "livekit") {
		return handleLiveKitSession(c, scenario, callerPhone);
	}

	if (architecture === "elevenlabs") {
		return handleElevenLabsSession(c, scenario, callerPhone, dynamicVars);
	}

	if (architecture === "cloudflare") {
		const agentUrl =
			c.env.CLOUDFLARE_AGENT_URL ||
			"https://applianceops-agent-cloudflare.23p.workers.dev";
		const wsUrl = `${agentUrl.replace(/^http/, "ws")}/agents/voice/default`;

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

	return c.json(
		{ ok: false, error: `Unknown architecture: ${architecture}` },
		400,
	);
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
		const body = (await c.req.json()) as Record<string, unknown>;
		const sessionId =
			typeof body.session_id === "string" && body.session_id
				? `?session_id=${encodeURIComponent(body.session_id)}`
				: "";
		const agentUrl =
			c.env.CLOUDFLARE_AGENT_URL ||
			"https://applianceops-agent-cloudflare.23p.workers.dev";

		let resp: Response;
		if (c.env.CLOUDFLARE_AGENT_SERVICE) {
			resp = await c.env.CLOUDFLARE_AGENT_SERVICE.fetch(
				`https://internal/simulate-turn${sessionId}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
			);
		} else {
			resp = await fetch(`${agentUrl}/simulate-turn${sessionId}`, {
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
				502,
			);
		}

		const data = (await resp.json()) as Record<string, unknown>;
		return c.json(data, 200);
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to execute Cloudflare agent turn",
				message: err instanceof Error ? err.message : String(err),
			},
			500,
		);
	}
});

/**
 * 4. Fetch Real Retell Post-Call / Live Call Telemetry (Protected)
 */
voiceRoutes.get("/retell/call/:callId", async (c) => {
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

	const callId = c.req.param("callId");
	const apiKey = c.env.RETELL_API_KEY;
	if (!apiKey) {
		return c.json(
			{
				ok: false,
				error: "RETELL_API_KEY not configured",
			},
			500,
		);
	}

	try {
		const resp = await fetch(
			`https://api.retellai.com/v2/get-call/${encodeURIComponent(callId)}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			},
		);

		if (!resp.ok) {
			const errText = await resp.text();
			return c.json(
				{
					ok: false,
					error: `Retell get-call failed (HTTP ${resp.status})`,
					details: errText,
				},
				400,
			);
		}

		const callData = (await resp.json()) as {
			call_id?: string;
			call_status?: string;
			duration_ms?: number;
			latency?: {
				e2e?: { p50?: number; p95?: number; values?: number[] };
				llm?: { p50?: number; p95?: number; values?: number[] };
				tts?: { p50?: number; p95?: number; values?: number[] };
				s2s?: { p50?: number; p95?: number; values?: number[] };
			};
			call_cost?: {
				combined_cost?: number;
			};
		};

		return c.json({
			ok: true,
			call_id: callData.call_id || callId,
			call_status: callData.call_status || "unknown",
			duration_ms: callData.duration_ms ?? 0,
			latency: {
				e2e_p50_ms: callData.latency?.e2e?.p50 ?? null,
				e2e_p95_ms: callData.latency?.e2e?.p95 ?? null,
				llm_p50_ms: callData.latency?.llm?.p50 ?? null,
				tts_p50_ms: callData.latency?.tts?.p50 ?? null,
				e2e_values: callData.latency?.e2e?.values ?? [],
				llm_values: callData.latency?.llm?.values ?? [],
				tts_values: callData.latency?.tts?.values ?? [],
			},
			cost_usd:
				typeof callData.call_cost?.combined_cost === "number"
					? callData.call_cost.combined_cost / 100
					: null,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to retrieve Retell call telemetry",
				message: err instanceof Error ? err.message : String(err),
			},
			500,
		);
	}
});

/**
 * 5. Fetch Real ElevenLabs Post-Call Conversation Telemetry (Protected)
 */
voiceRoutes.get("/elevenlabs/conversation/:conversationId", async (c) => {
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

	const conversationId = c.req.param("conversationId");
	const apiKey = c.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		return c.json(
			{
				ok: false,
				error: "ELEVENLABS_API_KEY not configured",
			},
			500,
		);
	}

	try {
		const resp = await fetch(
			`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
			{
				method: "GET",
				headers: {
					"xi-api-key": apiKey,
					"Content-Type": "application/json",
				},
			},
		);

		if (!resp.ok) {
			const errText = await resp.text();
			return c.json(
				{
					ok: false,
					error: `ElevenLabs get-conversation failed (HTTP ${resp.status})`,
					details: errText,
				},
				400,
			);
		}

		const convData = (await resp.json()) as {
			conversation_id?: string;
			status?: string;
			metadata?: {
				call_duration_secs?: number;
				cost?: number;
			};
			analysis?: {
				call_successful?: string;
				transcript_summary?: string;
			};
		};

		const durationSecs = convData.metadata?.call_duration_secs ?? 0;
		const estimatedCostUsd =
			Math.round((durationSecs / 60) * 0.088 * 10000) / 10000;

		return c.json({
			ok: true,
			conversation_id: convData.conversation_id || conversationId,
			status: convData.status || "done",
			duration_ms: Math.round(durationSecs * 1000),
			call_successful: convData.analysis?.call_successful || "success",
			transcript_summary: convData.analysis?.transcript_summary || null,
			cost_usd: estimatedCostUsd,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to retrieve ElevenLabs conversation telemetry",
				message: err instanceof Error ? err.message : String(err),
			},
			500,
		);
	}
});
