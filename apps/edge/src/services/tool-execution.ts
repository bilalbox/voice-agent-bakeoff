import {
  CheckTechAvailabilityInputSchema,
  LookupJobInputSchema,
  BookAppointmentInputSchema,
  ReschedulePartsInstallInputSchema,
  CancelAppointmentInputSchema,
  TransferToDispatcherInputSchema,
  SUPPORTED_SERVICES_PUBLIC,
  evaluateServiceScope,
  type CheckTechAvailabilityInput,
  type LookupJobInput,
  type BookAppointmentInput,
  type ReschedulePartsInstallInput,
  type CancelAppointmentInput,
  type TransferToDispatcherInput,
} from "@applianceops/contracts";
import type { ScheduleRepository } from "@applianceops/schedule-store";
import { formatWindowLocal } from "@applianceops/schedule-store";

export interface ToolExecutionContext {
  callId?: string;
  callerPhone?: string;
  feeAmount?: number;
  feeHours?: number;
}

export interface ToolExecutionResult {
  status?: number;
  data: Record<string, unknown>;
  latencyMs: number;
}

/**
 * Deep Tool Execution Engine.
 * Single source of truth for tool execution, input validation, and policy compliance
 * behind the edge boundary.
 */
export class ToolExecutionService {
  constructor(private readonly schedule: ScheduleRepository) {}

  /**
   * Canonical tool dispatch by name.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext = {},
  ): Promise<ToolExecutionResult> {
    const t0 = performance.now();
    const normalizedName = name.trim().toLowerCase().replace(/[-_]/g, "_");

    let resultData: Record<string, unknown>;
    let status = 200;

    switch (normalizedName) {
      case "check_availability":
      case "check_tech_availability": {
        const parsed = CheckTechAvailabilityInputSchema.safeParse(args);
        if (!parsed.success) {
          resultData = {
            ok: false,
            error: "invalid_arguments",
            validation_errors: parsed.error.issues,
            message: "Invalid arguments provided for availability check.",
          };
          status = 400;
          break;
        }
        resultData = await this.checkAvailability(parsed.data);
        break;
      }

      case "book_appointment": {
        const parsed = BookAppointmentInputSchema.safeParse(args);
        if (!parsed.success) {
          resultData = {
            ok: false,
            error: "invalid_arguments",
            validation_errors: parsed.error.issues,
            message: "Invalid arguments provided for booking appointment.",
          };
          status = 400;
          break;
        }
        resultData = await this.bookAppointment(parsed.data, ctx);
        break;
      }

      case "reschedule_parts":
      case "reschedule_parts_install": {
        const parsed = ReschedulePartsInstallInputSchema.safeParse(args);
        if (!parsed.success) {
          resultData = {
            ok: false,
            error: "invalid_arguments",
            validation_errors: parsed.error.issues,
            message: "Invalid arguments provided for parts rescheduling.",
          };
          status = 400;
          break;
        }
        resultData = await this.rescheduleParts(parsed.data);
        break;
      }

      case "cancel_job":
      case "cancel_appointment": {
        const parsed = CancelAppointmentInputSchema.safeParse(args);
        if (!parsed.success) {
          resultData = {
            ok: false,
            error: "invalid_arguments",
            validation_errors: parsed.error.issues,
            message: "Invalid arguments provided for cancellation.",
          };
          status = 400;
          break;
        }
        resultData = await this.cancelAppointment(parsed.data, ctx);
        break;
      }

      case "lookup_job":
      case "locate_job":
      case "find_job": {
        const parsed = LookupJobInputSchema.safeParse(args);
        if (!parsed.success) {
          resultData = {
            ok: false,
            error: "invalid_arguments",
            validation_errors: parsed.error.issues,
            message: "Invalid arguments provided for job lookup.",
          };
          status = 400;
          break;
        }
        resultData = await this.lookupJob(parsed.data, ctx);
        break;
      }

      case "transfer_to_dispatcher": {
        const parsed = TransferToDispatcherInputSchema.safeParse(args);
        const reason = parsed.success
          ? parsed.data.reason
          : (args.reason as string) || "Customer escalation";
        resultData = this.transferToDispatcher({ reason });
        break;
      }

      case "call_inbound":
      case "caller_context": {
        const phone =
          (args.phone as string) ||
          (args.from_number as string) ||
          ctx.callerPhone ||
          "";
        resultData = await this.getCallerContext(phone);
        break;
      }

      default: {
        resultData = {
          ok: false,
          error: "unknown_tool",
          message: `Tool '${name}' is not recognized.`,
        };
        status = 404;
      }
    }

    const latencyMs = Math.round(performance.now() - t0);
    resultData.latency_ms = latencyMs;

    return {
      status,
      data: resultData,
      latencyMs,
    };
  }

  async checkAvailability(
    input: CheckTechAvailabilityInput,
  ): Promise<Record<string, unknown>> {
    const rawAppliance = input.appliance_type || input.skill;
    if (rawAppliance) {
      const scope = evaluateServiceScope(rawAppliance);
      if (!scope.supported) {
        return {
          ok: false,
          supported: false,
          error: "unsupported_service",
          supported_services: SUPPORTED_SERVICES_PUBLIC,
          open_windows: [],
          timezone: "America/Los_Angeles",
          count: 0,
          query: {
            zone: input.zone ?? null,
            skills: [],
            preferred_date: input.preferred_date ?? null,
          },
          message:
            "We do not service that appliance type. We service refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, and Sub-Zero appliances.",
          speak_this:
            "We don't service that appliance type. We only service kitchen and laundry appliances like refrigerators, dishwashers, washers, dryers, and cooking appliances. Would you like me to connect you with a dispatcher or provide a referral?",
          source: "d1_schedule_cache",
        };
      }
    }

    const slots = await this.schedule.checkAvailability({
      zone: input.zone,
      skill: input.skill,
      appliance_type: input.appliance_type,
      preferred_date: input.preferred_date,
    });

    const openWindows = slots.map((s) => ({
      technician: s.tech_name,
      tech_id: s.tech_id,
      zone: s.zone,
      skill: s.skill,
      arrival_window_start: s.window_start,
      arrival_window_end: s.window_end,
      label: s.label || `${s.tech_name} (${s.zone}): ${formatWindowLocal(s.window_start, s.window_end)}`,
    }));

    return {
      ok: true,
      supported: true,
      open_windows: openWindows,
      timezone: "America/Los_Angeles",
      count: openWindows.length,
      query: {
        zone: input.zone ?? null,
        skill: input.skill ?? null,
        preferred_date: input.preferred_date ?? null,
      },
      message: `Found ${openWindows.length} available arrival windows.`,
      source: "d1_schedule_cache",
    };
  }

  async bookAppointment(
    input: BookAppointmentInput,
    ctx: ToolExecutionContext = {},
  ): Promise<Record<string, unknown>> {
    const rawAppliance = input.appliance || input.appliance_type;
    const rawSkill = input.skill;

    const appScope = evaluateServiceScope(rawAppliance);
    const skillScope = evaluateServiceScope(rawSkill);

    if (!appScope.supported || !skillScope.supported) {
      return {
        ok: false,
        booked: false,
        supported: false,
        error: "unsupported_service",
        reason: "unsupported_service",
        supported_services: SUPPORTED_SERVICES_PUBLIC,
        message:
          "We do not service that appliance type. We service refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, and Sub-Zero appliances.",
        speak_this:
          "We don't service that appliance type. I can connect you with a dispatcher or provide a referral.",
      };
    }

    const phone = input.phone || ctx.callerPhone || "+15550000000";
    const res = await this.schedule.bookAppointment({
      tech_id: input.tech_id,
      technician: input.technician,
      window_start: input.window_start,
      window_end: input.window_end,
      zone: input.zone,
      skill: input.skill,
      appliance: input.appliance || input.appliance_type,
      model_serial: input.model_serial,
      phone,
      customer_name: input.customer_name,
    });

    if (!res.ok) {
      const isUnavailable = res.reason === "unavailable_window";
      return {
        ok: false,
        booked: false,
        error: res.reason,
        reason: res.reason,
        message: res.message,
        speak_this: isUnavailable
          ? "That arrival window is no longer available. Please check availability again to choose another time."
          : res.speak_this,
      };
    }

    const endIso =
      input.window_end ||
      new Date(
        new Date(res.job.scheduledAt!).getTime() + 2 * 3600 * 1000,
      ).toISOString();

    return {
      ok: true,
      success: true,
      booked: true,
      job_id: res.job.id,
      status: res.job.status,
      technician: res.job.assignedTechName,
      tech_id: res.job.assignedTechId,
      zone: res.job.zone,
      skill: res.job.skill,
      appliance: res.job.appliance,
      model_serial: res.job.modelSerial ?? null,
      customer_name: res.job.customerName,
      phone,
      scheduled_at: res.job.scheduledAt,
      window_start: res.job.scheduledAt,
      window_end: endIso,
      arrival_window_label: res.label,
      arrival_window_local: formatWindowLocal(res.job.scheduledAt!, endIso),
      message: res.message,
      speak_this: res.speak_this,
    };
  }

  async rescheduleParts(
    input: ReschedulePartsInstallInput,
  ): Promise<Record<string, unknown>> {
    const res = await this.schedule.reschedulePartsInstall({
      jobId: input.job_id,
      preferredDate: input.preferred_date,
    });

    return {
      ...res,
      success: res.ok,
    };
  }

  async cancelAppointment(
    input: CancelAppointmentInput,
    ctx: ToolExecutionContext = {},
  ): Promise<Record<string, unknown>> {
    const res = await this.schedule.cancelAppointment({
      jobId: input.job_id,
      phone: input.phone,
      callerPhone: ctx.callerPhone,
      callId: ctx.callId,
      confirmed: input.confirmed,
      feeAmount: ctx.feeAmount ?? 85,
      feeHours: ctx.feeHours ?? 24,
    });

    return {
      ok: res.allowed,
      allowed: res.allowed,
      cancelled: res.cancelled,
      job_id: res.job_id,
      verification_status: res.verification_status,
      fee_applicable: res.fee_applicable,
      fee_amount: res.fee_amount,
      policy_reason: res.policy_reason,
      hours_until_appointment: res.hours_until_appointment,
      speak_this: res.speak_this,
      message: res.message,
    };
  }

  async lookupJob(
    input: LookupJobInput,
    ctx: ToolExecutionContext = {},
  ): Promise<Record<string, unknown>> {
    const res = await this.schedule.lookupJob({
      phone: input.phone || ctx.callerPhone,
      customer_name: input.customer_name,
      jobId: input.job_id,
    });

    return {
      ok: res.found,
      ...res,
    };
  }

  transferToDispatcher(input: { reason: string }): Record<string, unknown> {
    return {
      ok: true,
      transferred: true,
      destination: "dispatcher_queue",
      reason: input.reason,
      message: "Connecting to human dispatcher...",
      speak_this:
        "I'm connecting you with a human dispatcher right now. Please hold on for just a moment.",
    };
  }

  async getCallerContext(phone: string): Promise<Record<string, unknown>> {
    const ctx = await this.schedule.hydrateCaller(phone);
    return {
      ok: true,
      known_caller: ctx.knownCaller ? "true" : "false",
      customer_name: ctx.customerName,
      open_job_status: ctx.openJobStatus,
      assigned_tech: ctx.assignedTech,
      job_id: ctx.openJobId,
      appliance: ctx.appliance,
      model_serial: ctx.modelSerial,
      parts_status: ctx.partsStatus,
    };
  }
}
