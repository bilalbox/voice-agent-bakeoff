import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { resetDatabase } from "./test-helper";

describe("Voice Client Session & Security Auth", () => {
  beforeEach(async () => {
    await resetDatabase(env);
  });

  const postJson = async (path: string, body?: Record<string, unknown>, headers?: Record<string, string>) => {
    const res = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} },
    );
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  };

  describe("POST /api/voice/auth", () => {
    it("rejects authentication with invalid token", async () => {
      const { status, json } = await postJson("/api/voice/auth", { token: "bad-token" });
      expect(status).toBe(401);
      expect(json.ok).toBe(false);
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects authentication when no credentials provided", async () => {
      const { status, json } = await postJson("/api/voice/auth");
      expect(status).toBe(401);
      expect(json.ok).toBe(false);
    });

    it("authenticates with valid token in JSON body", async () => {
      const { status, json } = await postJson("/api/voice/auth", { token: "dev-seed-token" });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.token).toBe("dev-seed-token");
    });

    it("authenticates with valid x-demo-token header", async () => {
      const { status, json } = await postJson("/api/voice/auth", {}, { "x-demo-token": "dev-seed-token" });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it("authenticates with valid Bearer token header", async () => {
      const { status, json } = await postJson("/api/voice/auth", {}, { Authorization: "Bearer dev-seed-token" });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
    });
  });

  describe("POST /api/voice/session", () => {
    it("rejects session creation without security token", async () => {
      const { status, json } = await postJson("/api/voice/session", {
        architecture: "livekit",
      });
      expect(status).toBe(401);
      expect(json.ok).toBe(false);
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects session creation with invalid security token", async () => {
      const { status, json } = await postJson(
        "/api/voice/session",
        { architecture: "livekit" },
        { "x-demo-token": "invalid-passkey" },
      );
      expect(status).toBe(401);
      expect(json.ok).toBe(false);
    });

    it("creates Cloudflare Voice Agent session when authorized", async () => {
      const { status, json } = await postJson(
        "/api/voice/session",
        {
          architecture: "cloudflare",
          scenario: "sarah",
          caller_phone: "+15550104200",
        },
        { "x-demo-token": "dev-seed-token" },
      );

      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.architecture).toBe("cloudflare");
      expect(json.agent_url).toBeDefined();
      expect(json.ws_url).toBeDefined();
      expect(json.dynamic_variables).toEqual(
        expect.objectContaining({
          customer_name: "Sarah",
          job_id: "1042",
          parts_status: "in_stock",
        }),
      );
    });

    it("handles LiveKit session creation when authorized", async () => {
      // In test env, LIVEKIT_API_TOKEN may or may not be set
      const { status, json } = await postJson(
        "/api/voice/session",
        {
          architecture: "livekit",
          scenario: "omar",
        },
        { Authorization: "Bearer dev-seed-token" },
      );

      // Either succeeds (200) if token configured or 500 with descriptive error
      if (status === 200) {
        expect(json.ok).toBe(true);
        expect(json.architecture).toBe("livekit");
        expect(json.server_url).toBeDefined();
        expect(json.token).toBeDefined();
        expect(json.room_name).toBeDefined();
      } else {
        expect(status).toBe(500);
        expect(json.error).toContain("LiveKit token or credentials not configured");
      }
    });

    it("detects JWT token mistakenly configured as LIVEKIT_API_SECRET", async () => {
      const prevSecret = env.LIVEKIT_API_SECRET;
      const prevKey = env.LIVEKIT_API_KEY;
      try {
        (env as any).LIVEKIT_API_KEY = "APITestKey";
        (env as any).LIVEKIT_API_SECRET = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig";

        const { status, json } = await postJson(
          "/api/voice/session",
          {
            architecture: "livekit",
            scenario: "sarah",
          },
          { Authorization: "Bearer dev-seed-token" },
        );

        expect(status).toBe(500);
        expect(json.ok).toBe(false);
        expect(json.error).toContain("Invalid LIVEKIT_API_SECRET configuration");
      } finally {
        (env as any).LIVEKIT_API_KEY = prevKey;
        (env as any).LIVEKIT_API_SECRET = prevSecret;
      }
    });

    it("generates valid LiveKit JWT when API key and secret are provided", async () => {
      const prevSecret = env.LIVEKIT_API_SECRET;
      const prevKey = env.LIVEKIT_API_KEY;
      try {
        (env as any).LIVEKIT_API_KEY = "APITestKey123";
        (env as any).LIVEKIT_API_SECRET = "super-secret-hmac-key-for-testing-12345";

        const { status, json } = await postJson(
          "/api/voice/session",
          {
            architecture: "livekit",
            scenario: "sarah",
            caller_phone: "+15550104200",
          },
          { Authorization: "Bearer dev-seed-token" },
        );

        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.architecture).toBe("livekit");
        expect(typeof json.token).toBe("string");
        const tokenParts = (json.token as string).split(".");
        expect(tokenParts.length).toBe(3);

        // Decode payload to verify claims
        const payload = JSON.parse(Buffer.from(tokenParts[1], "base64url").toString());
        expect(payload.iss).toBe("APITestKey123");
        expect(payload.video.room).toBe(json.room_name);
        expect(payload.video.roomJoin).toBe(true);
        expect(payload.metadata).toContain("+15550104200");
      } finally {
        (env as any).LIVEKIT_API_KEY = prevKey;
        (env as any).LIVEKIT_API_SECRET = prevSecret;
      }
    });

    it("rejects Cloudflare turn proxy without token", async () => {
      const { status, json } = await postJson("/api/voice/cloudflare/turn", {
        transcript: "hello",
      });
      expect(status).toBe(401);
      expect(json.ok).toBe(false);
    });

    it("proxies Cloudflare turn with valid security token", async () => {
      const { status, json } = await postJson(
        "/api/voice/cloudflare/turn",
        {
          transcript: "yes",
          caller_phone: "+15550104200",
        },
        { "x-demo-token": "dev-seed-token" },
      );
      expect(status).toBe(200);
      expect(typeof json.text).toBe("string");
      expect(json.text).toBeTruthy();
      expect(typeof json.total_turn_rtt_ms).toBe("number");
    });
  });
});
