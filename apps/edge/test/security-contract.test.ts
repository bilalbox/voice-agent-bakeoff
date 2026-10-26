import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { resetDatabase } from "./test-helper";

describe("Seam 1 — Security & Tool HTTP Contract", () => {
  beforeEach(async () => {
    await resetDatabase(env);
  });

  const callTool = async (path: string, body: Record<string, unknown>, headers?: Record<string, string>) => {
    const res = await worker.fetch(
      new Request(`http://localhost${path}`, {
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
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  };

  describe("Cancellation Ownership", () => {
    it("rejects cancel with valid job id and mismatched phone without leaking customer details", async () => {
      // Job 1042 belongs to Sarah Chen (+15550104200)
      const attackerPhone = "+15550107777";
      const { status, json } = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-1", from_number: attackerPhone },
        args: {
          job_id: "1042",
          phone: attackerPhone,
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.cancelled).toBe(false);
      expect(json.verification_status).toBe("verification_mismatch");

      // Verify NO customer data is leaked in the response
      expect(json).not.toHaveProperty("customer_name");
      expect(json).not.toHaveProperty("appliance");
      expect(json).not.toHaveProperty("scheduled_at");
      expect(json).not.toHaveProperty("phone");

      // Verify response shape is neutral and indistinguishable from an unknown job id
      const unknownRes = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-2", from_number: attackerPhone },
        args: {
          job_id: "999999",
          phone: attackerPhone,
        },
      });
      expect(unknownRes.json.speak_this).toBe(json.speak_this);
      expect(unknownRes.json.error).toBe(json.error);

      // Verify DB state did not change
      const jobRow = await env.DB.prepare("SELECT status FROM jobs_cache WHERE id = '1042'").first<{ status: string }>();
      expect(jobRow?.status).not.toBe("cancelled");
    });

    it("requires verification when valid job id is provided with no phone or caller ID", async () => {
      const { status, json } = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-no-phone" },
        args: {
          job_id: "1042",
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.cancelled).toBe(false);
      expect(json.verification_status).toBe("verification_required");

      // Must not leak customer fields
      expect(json).not.toHaveProperty("customer_name");
      expect(json).not.toHaveProperty("appliance");
      expect(json).not.toHaveProperty("scheduled_at");
      expect(json).not.toHaveProperty("phone");

      // Verify DB state unchanged
      const jobRow = await env.DB.prepare("SELECT status FROM jobs_cache WHERE id = '1042'").first<{ status: string }>();
      expect(jobRow?.status).not.toBe("cancelled");
    });

    it("succeeds with valid job id and correct phone; fee applies and requires confirmation", async () => {
      // Job 1088 belongs to Omar Diaz (+15550108800), scheduled in ~14h (< 24h notice)
      const resWithoutConfirm = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-omar" },
        args: {
          job_id: "1088",
          phone: "+15550108800",
        },
      });

      expect(resWithoutConfirm.status).toBe(200);
      expect(resWithoutConfirm.json.ok).toBe(false);
      expect(resWithoutConfirm.json.cancelled).toBe(false);
      expect(resWithoutConfirm.json.verification_status).toBe("verified");
      expect(resWithoutConfirm.json.fee_applicable).toBe(true);
      expect(resWithoutConfirm.json.fee_amount).toBe(85);

      // Job not yet cancelled
      let jobRow = await env.DB.prepare("SELECT status FROM jobs_cache WHERE id = '1088'").first<{ status: string }>();
      expect(jobRow?.status).toBe("Scheduled");

      // Now call with confirmed=true
      const resWithConfirm = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-omar" },
        args: {
          job_id: "1088",
          phone: "+15550108800",
          confirmed: true,
        },
      });

      expect(resWithConfirm.status).toBe(200);
      expect(resWithConfirm.json.ok).toBe(true);
      expect(resWithConfirm.json.cancelled).toBe(true);
      expect(resWithConfirm.json.fee_applicable).toBe(true);

      // Job cancelled in DB
      jobRow = await env.DB.prepare("SELECT status FROM jobs_cache WHERE id = '1088'").first<{ status: string }>();
      expect(jobRow?.status).toBe("cancelled");
    });

    it("succeeds when caller ID matches the job phone without spoken phone", async () => {
      // Job 1042 scheduled > 24h away (outside fee window)
      const { status, json } = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-sarah", from_number: "+15550104200" },
        args: {
          job_id: "1042",
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.cancelled).toBe(true);
      expect(json.verification_status).toBe("verified");
      expect(json.fee_applicable).toBe(false);

      const jobRow = await env.DB.prepare("SELECT status FROM jobs_cache WHERE id = '1042'").first<{ status: string }>();
      expect(jobRow?.status).toBe("cancelled");
    });

    it("reports closed status for an already-closed job without disclosing unrelated details", async () => {
      // Job 1107 has status "Completed" and belongs to Priya Nair (+15550100003)
      const { status, json } = await callTool("/retell/cancel-job", {
        call: { call_id: "test-call-priya", from_number: "+15550100003" },
        args: {
          job_id: "1107",
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.cancelled).toBe(false);
      expect(json.verification_status).toBe("verified");
      expect(json.error).toBe("already_closed");
      expect(json.status).toBe("Completed");

      // Must not leak unrelated account details
      expect(json).not.toHaveProperty("customer_name");
      expect(json).not.toHaveProperty("appliance");
      expect(json).not.toHaveProperty("phone");
    });

    it("enforces attempt cap on repeated failed verifications per call", async () => {
      const callId = "brute-force-call-id";
      // Perform 3 failed attempts
      for (let i = 0; i < 3; i++) {
        const { json } = await callTool("/retell/cancel-job", {
          call: { call_id: callId, from_number: "+15550109999" },
          args: { job_id: "1042", phone: `+1555000000${i}` },
        });
        expect(json.cancelled).toBe(false);
      }

      // 4th attempt should hit the cap
      const { json } = await callTool("/retell/cancel-job", {
        call: { call_id: callId, from_number: "+15550109999" },
        args: { job_id: "1042", phone: "+15550104200" }, // Even with correct phone!
      });

      expect(json.ok).toBe(false);
      expect(json.cancelled).toBe(false);
      expect(json.verification_status).toBe("attempt_cap_exceeded");
      expect(json.action).toBe("transfer");
      expect(json.transfer_required).toBe(true);
    });
  });

  describe("Service Scope & Catalog", () => {
    it("returns unsupported outcome and supported list for unsupported availability request", async () => {
      const { status, json } = await callTool("/retell/check-availability", {
        args: {
          appliance_type: "pool heater",
        },
      });

      expect(status).toBe(200);
      expect(json.supported).toBe(false);
      expect(json.error).toBe("unsupported_service");
      expect(Array.isArray(json.supported_services)).toBe(true);
      expect(json.supported_services).toContain("refrigeration");
      expect(json.supported_services).toContain("dishwasher");
      expect(json.open_windows).toEqual([]);
      expect(json.count).toBe(0);
      // Must not suggest broadening search
      expect(json.hint).toBeUndefined();
    });

    it("returns open windows for supported appliance availability request", async () => {
      const { status, json } = await callTool("/retell/check-availability", {
        args: {
          appliance_type: "refrigerator",
        },
      });

      expect(status).toBe(200);
      expect(json.supported).not.toBe(false);
      expect((json.open_windows as unknown[]).length).toBeGreaterThan(0);
      expect(json.count).toBeGreaterThan(0);
    });

    it("rejects booking for unsupported appliance, creates no job, consumes no slot", async () => {
      // Get initial count of slots and jobs
      const initialSlots = await env.DB.prepare("SELECT COUNT(*) as c FROM availability_slots").first<{ c: number }>();
      const initialJobs = await env.DB.prepare("SELECT COUNT(*) as c FROM jobs_cache").first<{ c: number }>();

      const { status, json } = await callTool("/retell/book-appointment", {
        args: {
          technician: "Sam T.",
          tech_id: "tech-sam",
          appliance: "pool heater",
          phone: "+15550109999",
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.booked).toBe(false);
      expect(json.error).toBe("unsupported_service");
      expect(Array.isArray(json.supported_services)).toBe(true);

      // Verify no job created
      const finalJobs = await env.DB.prepare("SELECT COUNT(*) as c FROM jobs_cache").first<{ c: number }>();
      expect(finalJobs?.c).toBe(initialJobs?.c);

      // Verify no slot consumed
      const finalSlots = await env.DB.prepare("SELECT COUNT(*) as c FROM availability_slots").first<{ c: number }>();
      expect(finalSlots?.c).toBe(initialSlots?.c);
    });

    it("rejects booking with an unavailable/stale window without silent substitution", async () => {
      const initialJobs = await env.DB.prepare("SELECT COUNT(*) as c FROM jobs_cache").first<{ c: number }>();

      // Supply a window_start that does not exist in availability_slots (e.g. 03:00 UTC outside business hours)
      const nonExistentWindow = "2026-10-25T03:00:00.000Z";
      const { status, json } = await callTool("/retell/book-appointment", {
        args: {
          technician: "Sam T.",
          tech_id: "tech-sam",
          window_start: nonExistentWindow,
          appliance: "refrigerator",
          phone: "+15550109999",
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(false);
      expect(json.booked).toBe(false);
      expect(json.error).toBe("unavailable_window");

      // Verify no job created (no silent fallback!)
      const finalJobs = await env.DB.prepare("SELECT COUNT(*) as c FROM jobs_cache").first<{ c: number }>();
      expect(finalJobs?.c).toBe(initialJobs?.c);
    });

    it("books supported appliance with open window against the right account phone", async () => {
      // Find an open slot for Sam T.
      const slot = await env.DB.prepare(
        "SELECT * FROM availability_slots WHERE tech_id = 'tech-sam' AND window_start > datetime('now') LIMIT 1",
      ).first<{ window_start: string; window_end: string; tech_id: string; tech_name: string }>();

      expect(slot).toBeDefined();

      const { status, json } = await callTool("/retell/book-appointment", {
        args: {
          tech_id: slot!.tech_id,
          window_start: slot!.window_start,
          window_end: slot!.window_end,
          appliance: "refrigerator",
          phone: "+15550108888",
          customer_name: "Test Customer",
        },
      });

      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.booked).toBe(true);
      expect(json.phone).toBe("+15550108888");

      // Verify job was created in DB
      const jobId = json.job_id as string;
      const jobRow = await env.DB.prepare("SELECT * FROM jobs_cache WHERE id = ?").bind(jobId).first<{ phone: string }>();
      expect(jobRow?.phone).toBe("+15550108888");

      // Verify slot was consumed
      const remainingSlot = await env.DB.prepare(
        "SELECT * FROM availability_slots WHERE tech_id = ? AND window_start = ?",
      ).bind(slot!.tech_id, slot!.window_start).first();
      expect(remainingSlot).toBeNull();
    });
  });

  describe("Mock CRM Surface Guarding", () => {
    it("returns 404 when WORKIZ_MODE is not mock", async () => {
      const prodEnv = { ...env, WORKIZ_MODE: "live" as const };
      const res = await worker.fetch(
        new Request("http://localhost/mock-workiz/job/all"),
        prodEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} },
      );
      expect(res.status).toBe(404);
    });

    it("requires admin token when SEED_TOKEN is configured in mock mode", async () => {
      const securedEnv = { ...env, WORKIZ_MODE: "mock" as const, SEED_TOKEN: "secret-token-123" };

      // Unauthorized request without token
      const unauthRes = await worker.fetch(
        new Request("http://localhost/mock-workiz/job/all"),
        securedEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} },
      );
      expect(unauthRes.status).toBe(401);

      // Authorized request with token
      const authRes = await worker.fetch(
        new Request("http://localhost/mock-workiz/job/all", {
          headers: { "x-seed-token": "secret-token-123" },
        }),
        securedEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} },
      );
      expect(authRes.status).toBe(200);
    });
  });
});
