import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { resetDatabase } from "./test-helper";

describe("Seam 2 — Decoupled REST Tool Execution Port (/api/tools/*)", () => {
  beforeEach(async () => {
    await resetDatabase(env);
  });

  const callRestTool = async (
    endpoint: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = { "x-demo-token": "dev-seed-token" },
  ) => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/tools/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} },
    );
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json, headers: res.headers };
  };

  describe("Authentication Seam", () => {
    it("rejects unauthenticated tool request with 401 when no token is provided", async () => {
      const res = await worker.fetch(
        new Request("http://localhost/api/tools/check_tech_availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appliance_type: "refrigerator" }),
        }),
        env,
        { waitUntil: () => {}, passThroughOnException: () => {} },
      );

      // When RETELL_VERIFY=true or SEED_TOKEN is configured
      if (env.SEED_TOKEN || env.DEMO_VOICE_TOKEN) {
        expect(res.status).toBe(401);
      }
    });

    it("succeeds with standard Bearer token without requiring Retell HMAC signatures", async () => {
      const token = env.SEED_TOKEN || "dev-seed-token";
      const { status, json } = await callRestTool(
        "check_tech_availability",
        { appliance_type: "refrigerator" },
        { Authorization: `Bearer ${token}` },
      );

      expect(status).toBe(200);
      expect(json.supported).toBe(true);
      expect(Array.isArray(json.open_windows)).toBe(true);
    });
  });

  describe("Canonical Tool Execution & Input Validation", () => {
    it("check_tech_availability: returns open arrival windows for supported appliances", async () => {
      const { status, json, headers } = await callRestTool("check_tech_availability", {
        appliance_type: "refrigerator",
      });

      expect(status).toBe(200);
      expect(json.supported).toBe(true);
      expect(json.count).toBeGreaterThan(0);
      expect(headers.get("X-Tool-Latency-Ms")).toBeDefined();
    });

    it("check_tech_availability: declines unsupported service plainly without suggesting broadening", async () => {
      const { status, json } = await callRestTool("check_tech_availability", {
        appliance_type: "pool heater",
      });

      expect(status).toBe(200);
      expect(json.supported).toBe(false);
      expect(json.error).toBe("unsupported_service");
      expect(json.count).toBe(0);
    });

    it("book_appointment: rejects unsupported appliance without consuming slots", async () => {
      const initialSlots = await env.DB.prepare("SELECT COUNT(*) as c FROM availability_slots").first<{ c: number }>();

      const { status, json } = await callRestTool("book_appointment", {
        technician: "Sam T.",
        tech_id: "tech-sam",
        appliance: "pool heater",
        phone: "+15550109999",
        window_start: "2026-10-22T17:00:00.000Z",
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.error).toBe("unsupported_service");

      const finalSlots = await env.DB.prepare("SELECT COUNT(*) as c FROM availability_slots").first<{ c: number }>();
      expect(finalSlots?.c).toBe(initialSlots?.c);
    });

    it("book_appointment: rejects unavailable/stale window without silent substitution", async () => {
      const { status, json } = await callRestTool("book_appointment", {
        technician: "Sam T.",
        tech_id: "tech-sam",
        window_start: "2026-10-25T03:00:00.000Z", // Outside business hours
        appliance: "refrigerator",
        phone: "+15550109999",
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.error).toBe("unavailable_window");
    });

    it("book_appointment: successfully books open window and atomically consumes slot in D1", async () => {
      const slot = await env.DB.prepare(
        "SELECT * FROM availability_slots WHERE tech_id = 'tech-sam' AND window_start > datetime('now') LIMIT 1",
      ).first<{ window_start: string; window_end: string; tech_id: string; tech_name: string }>();

      expect(slot).toBeDefined();

      const { status, json } = await callRestTool("book_appointment", {
        tech_id: slot!.tech_id,
        technician: slot!.tech_name,
        window_start: slot!.window_start,
        window_end: slot!.window_end,
        appliance: "refrigerator",
        phone: "+15550108800",
        customer_name: "Omar Diaz",
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.job_id).toBeDefined();

      // Verify slot is consumed from availability_slots
      const checkSlot = await env.DB.prepare(
        "SELECT * FROM availability_slots WHERE tech_id = ? AND substr(window_start, 1, 16) = substr(?, 1, 16)",
      )
        .bind(slot!.tech_id, slot!.window_start)
        .first();
      expect(checkSlot).toBeNull();
    });

    it("cancel_appointment: rejects mismatched phone without leaking details", async () => {
      const { status, json } = await callRestTool("cancel_appointment", {
        job_id: "1042",
        phone: "+15550109999", // Mismatched attacker phone
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.cancelled).toBe(false);
      expect(json.verification_status).toBe("verification_mismatch");
      expect(json).not.toHaveProperty("customer_name");
      expect(json).not.toHaveProperty("scheduled_at");
    });

    it("cancel_appointment: requires confirmation when under 24 hours ($85 fee)", async () => {
      // Job 1088 belongs to Omar Diaz (+15550108800), scheduled in ~14h
      const { status, json } = await callRestTool("cancel_appointment", {
        job_id: "1088",
        phone: "+15550108800",
        confirmed: false,
      });

      expect(status).toBe(200);
      expect(json.fee_applicable).toBe(true);
      expect(json.fee_amount).toBe(85);
      expect(json.cancelled).toBe(false);

      // Confirm with confirmed: true
      const confirmedRes = await callRestTool("cancel_appointment", {
        job_id: "1088",
        phone: "+15550108800",
        confirmed: true,
      });

      expect(confirmedRes.status).toBe(200);
      expect(confirmedRes.json.cancelled).toBe(true);
    });

    it("transfer_to_dispatcher: transfers caller with escalation reason", async () => {
      const { status, json } = await callRestTool("transfer_to_dispatcher", {
        reason: "Customer requested human dispatcher",
      });

      expect(status).toBe(200);
      expect(json.transferred).toBe(true);
      expect(json.destination).toBe("dispatcher_queue");
    });

    it("lookup_job: locates active customer job ID by phone when job ID is unknown", async () => {
      // Omar Diaz: +15550108800, Job 1088
      const { status, json, headers } = await callRestTool("lookup_job", {
        phone: "+15550108800",
      });

      expect(status).toBe(200);
      expect(json.found).toBe(true);
      expect(json.job_id).toBe("1088");
      expect(json.customer_name).toBe("Omar Diaz");
      expect(json.appliance).toBe("Bosch Dishwasher");
      expect(headers.get("X-Tool-Latency-Ms")).toBeDefined();
    });

    it("lookup_job: returns found=false gracefully when phone does not match any appointment", async () => {
      const { status, json } = await callRestTool("lookup_job", {
        phone: "+15550109999",
      });

      expect(status).toBe(200);
      expect(json.found).toBe(false);
      expect(json.message).toContain("No appointment found");
    });

    it("cancel_appointment: locates active job and enforces fee when job_id is omitted but phone is provided", async () => {
      // Omar Diaz: phone +15550108800 without explicit job_id
      const { status, json } = await callRestTool("cancel_appointment", {
        phone: "+15550108800",
        confirmed: false,
      });

      expect(status).toBe(200);
      expect(json.job_id).toBe("1088");
      expect(json.verification_status).toBe("verified");
      expect(json.fee_applicable).toBe(true);
      expect(json.fee_amount).toBe(85);
      expect(json.cancelled).toBe(false);
    });

    it("call-inbound: returns caller context dynamic variables", async () => {
      const { status, json } = await callRestTool("call-inbound", {
        phone: "+15550104200", // Sarah Chen
      });

      expect(status).toBe(200);
      expect(json.known_caller).toBe("true");
      expect(json.customer_name).toBe("Sarah");
      expect(json.job_id).toBe("1042");
    });
  });
});
