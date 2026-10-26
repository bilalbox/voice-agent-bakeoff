import { z } from "zod";

/**
 * 1. check_tech_availability
 */
export const CheckTechAvailabilityInputSchema = z.object({
  zone: z
    .enum(["north", "central", "south"])
    .optional()
    .describe("Optional service zone. Omit entirely to search all service areas."),
  skill: z
    .string()
    .optional()
    .describe("Canonical skill: refrigeration, dishwasher, laundry, cooking, bosch, miele, gaggenau, sub-zero."),
  appliance_type: z
    .string()
    .optional()
    .describe("Appliance type/category requested by caller (e.g. dishwasher, refrigerator)."),
  preferred_date: z
    .string()
    .optional()
    .describe("Optional ISO date YYYY-MM-DD or datetime."),
});

export type CheckTechAvailabilityInput = z.infer<typeof CheckTechAvailabilityInputSchema>;

export const OpenWindowSchema = z.object({
  tech_id: z.string(),
  technician: z.string(),
  window_start: z.string(),
  window_end: z.string(),
  label: z.string(),
  zone: z.string(),
});

export const CheckTechAvailabilityOutputSchema = z.object({
  supported: z.boolean(),
  count: z.number(),
  open_windows: z.array(OpenWindowSchema),
  hint: z.string().optional(),
  message: z.string(),
});

export type CheckTechAvailabilityOutput = z.infer<typeof CheckTechAvailabilityOutputSchema>;

/**
 * 2. book_appointment
 */
export const BookAppointmentInputSchema = z.object({
  tech_id: z.string().optional().describe("Technician id from open_windows (e.g. tech-lee)."),
  technician: z.string().optional().describe("Technician display name if tech_id is missing."),
  window_start: z.string().describe("arrival_window_start ISO from open_windows (must match an open slot)."),
  window_end: z.string().optional().describe("Optional arrival_window_end ISO."),
  zone: z.string().optional().describe("Service zone (north|central|south)."),
  skill: z.string().optional().describe("Canonical skill e.g. dishwasher, refrigeration."),
  appliance: z.string().optional().describe("Appliance description for the job."),
  appliance_type: z.string().optional().describe("Alias for appliance category."),
  phone: z.string().optional().describe("Caller phone number for the booking record."),
  customer_name: z.string().optional().describe("Caller name when known."),
  model_serial: z.string().optional().describe("Appliance model or serial number if provided."),
});

export type BookAppointmentInput = z.infer<typeof BookAppointmentInputSchema>;

export const BookAppointmentOutputSchema = z.object({
  success: z.boolean(),
  job_id: z.string().optional(),
  customer_name: z.string().optional(),
  phone: z.string().optional(),
  window_start: z.string().optional(),
  window_end: z.string().optional(),
  technician: z.string().optional(),
  message: z.string(),
  speak_this: z.string(),
});

export type BookAppointmentOutput = z.infer<typeof BookAppointmentOutputSchema>;

/**
 * 3. reschedule_parts_install
 */
export const ReschedulePartsInstallInputSchema = z.object({
  job_id: z.string().describe("Workiz / ApplianceOps job id (e.g. 1042)."),
  preferred_date: z.string().describe("Desired install date or datetime in ISO-8601."),
});

export type ReschedulePartsInstallInput = z.infer<typeof ReschedulePartsInstallInputSchema>;

export const ReschedulePartsInstallOutputSchema = z.object({
  ok: z.boolean(),
  job_id: z.string(),
  scheduled_at: z.string().optional(),
  parts_status: z.string(),
  assigned_tech_id: z.string().optional(),
  assigned_tech_name: z.string().optional(),
  earliest_bookable: z.string().optional(),
  reason: z.string().optional(),
  message: z.string(),
  speak_this: z.string(),
});

export type ReschedulePartsInstallOutput = z.infer<typeof ReschedulePartsInstallOutputSchema>;

/**
 * 4. cancel_appointment
 */
export const CancelAppointmentInputSchema = z.object({
  job_id: z.string().optional().describe("Job id (digits ok, e.g. 1088). Optional if account phone number is provided to locate active job."),
  phone: z.string().optional().describe("Account phone number for caller verification. Required to verify ownership."),
  customer_name: z.string().optional().describe("Optional caller name to assist lookup."),
  confirmed: z.boolean().optional().default(false).describe("True only after caller verbally accepts the fee when fee_applicable was returned."),
});

export type CancelAppointmentInput = z.infer<typeof CancelAppointmentInputSchema>;

export const CancelAppointmentOutputSchema = z.object({
  allowed: z.boolean(),
  cancelled: z.boolean(),
  verification_status: z.enum([
    "verified",
    "verification_required",
    "verification_mismatch",
    "not_found",
    "attempt_cap_exceeded",
  ]),
  fee_applicable: z.boolean(),
  fee_amount: z.number(),
  policy_reason: z.string(),
  hours_until_appointment: z.number().nullable().optional(),
  speak_this: z.string(),
  message: z.string(),
});

export type CancelAppointmentOutput = z.infer<typeof CancelAppointmentOutputSchema>;

/**
 * 5. lookup_job
 */
export const LookupJobInputSchema = z.object({
  phone: z.string().optional().describe("Account phone number (e.g. +15550108800 or spoken digits). Used to locate active jobs."),
  customer_name: z.string().optional().describe("Optional caller name on the account to assist lookup."),
  job_id: z.string().optional().describe("Optional job ID if verifying a specific appointment."),
});

export type LookupJobInput = z.infer<typeof LookupJobInputSchema>;

export const LookupJobOutputSchema = z.object({
  found: z.boolean(),
  job_id: z.string().optional(),
  customer_name: z.string().optional(),
  phone: z.string().optional(),
  appliance: z.string().optional(),
  status: z.string().optional(),
  scheduled_at: z.string().nullable().optional(),
  assigned_tech_name: z.string().nullable().optional(),
  parts_status: z.string().optional(),
  message: z.string(),
  speak_this: z.string(),
});

export type LookupJobOutput = z.infer<typeof LookupJobOutputSchema>;

/**
 * 6. transfer_to_dispatcher
 */
export const TransferToDispatcherInputSchema = z.object({
  reason: z.string().describe("Reason for escalating to human dispatcher (e.g. verification failure, complex inquiry)."),
  department: z.string().optional().describe("Optional destination department."),
});

export type TransferToDispatcherInput = z.infer<typeof TransferToDispatcherInputSchema>;

export const TransferToDispatcherOutputSchema = z.object({
  transferred: z.boolean(),
  destination: z.string(),
  reason: z.string(),
  speak_this: z.string(),
});

export type TransferToDispatcherOutput = z.infer<typeof TransferToDispatcherOutputSchema>;

/**
 * Registry of tool definitions for LLM function manifests (Retell, LiveKit, Cloudflare)
 */
export const APPLIANCE_OPS_TOOLS = [
  {
    name: "check_tech_availability",
    description: "Return open 2-hour technician arrival windows for supported appliances (refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, Sub-Zero). Do NOT call for unsupported services like pool heaters or water heaters. Zone is OPTIONAL — omit it to search all service areas.",
    schema: CheckTechAvailabilityInputSchema,
  },
  {
    name: "lookup_job",
    description: "Look up an appointment / job ID when the caller does not know their job ID. Call this with the caller's confirmed account phone number (e.g. +15550108800) to find their job ID, appliance, and scheduled arrival window.",
    schema: LookupJobInputSchema,
  },
  {
    name: "book_appointment",
    description: "Book a technician for an open arrival window for supported appliances. Requires tech_id + window_start from open_windows. Writes a Scheduled job into the CRM cache.",
    schema: BookAppointmentInputSchema,
  },
  {
    name: "reschedule_parts_install",
    description: "Reschedule a parts installation after validating parts status in the CRM. Keeps the primary technician from the diagnostic visit when parts are in stock.",
    schema: ReschedulePartsInstallInputSchema,
  },
  {
    name: "cancel_appointment",
    description: "Cancel an appointment with verified caller ownership. Accepts job_id and/or account phone number. Enforces 24h fee ($85) — if fee_applicable and not yet confirmed, read speak_this, get verbal confirmation, then call again with confirmed=true.",
    schema: CancelAppointmentInputSchema,
  },
  {
    name: "transfer_to_dispatcher",
    description: "Transfer the caller to a human dispatcher when verification fails repeatedly, for unsupported appliance escalations, or upon direct caller request.",
    schema: TransferToDispatcherInputSchema,
  },
] as const;
