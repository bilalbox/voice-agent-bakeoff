/**
 * ApplianceOps Domain Policy Engine & Authoritative Business Rules
 *
 * Implements the deep in-process policy module governing:
 * - Two-factor ownership verification (account phone vs spoken / caller ID)
 * - 24-hour late cancellation fee determination ($85 fee window)
 * - Anti-enumeration security masking (phone mismatches masked as not_found)
 * - Brute-force verification attempt capping (max 3 failed attempts)
 * - Service scope guardrails (residential kitchen and laundry only)
 * - Parts installation rescheduling criteria (in_stock vs backordered ETA)
 */

export const CANCELLATION_POLICY = {
  FEE_WINDOW_HOURS: 24,
  FEE_AMOUNT_DOLLARS: 85,
  MAX_VERIFICATION_ATTEMPTS: 3,
} as const;

export const SUPPORTED_SKILLS = [
  "refrigeration",
  "dishwasher",
  "laundry",
  "cooking",
  "bosch",
  "miele",
  "gaggenau",
  "sub-zero",
  "compressor",
] as const;

export type SupportedSkill = (typeof SUPPORTED_SKILLS)[number];

export const SUPPORTED_SERVICES_PUBLIC = [
  "refrigeration",
  "dishwasher",
  "laundry",
  "cooking",
  "bosch",
  "miele",
  "gaggenau",
  "sub-zero",
] as const;

export const UNSUPPORTED_SERVICES = [
  "pool heater",
  "water heater",
  "hvac",
  "furnace",
  "outdoor plumbing",
  "commercial equipment",
  "lawnmower",
  "small countertop appliance",
] as const;

/** Canonical mapping from common customer phrases to supported canonical skills */
export const SKILL_ALIASES: Record<string, SupportedSkill> = {
  dishwasher: "dishwasher",
  "dishwasher repair": "dishwasher",
  dishwashers: "dishwasher",
  refrigeration: "refrigeration",
  refrigerator: "refrigeration",
  fridge: "refrigeration",
  freezer: "refrigeration",
  "sub-zero": "sub-zero",
  subzero: "sub-zero",
  laundry: "laundry",
  washer: "laundry",
  dryer: "laundry",
  "washing machine": "laundry",
  cooking: "cooking",
  range: "cooking",
  oven: "cooking",
  cooktop: "cooking",
  stove: "cooking",
  bosch: "bosch",
  miele: "miele",
  gaggenau: "gaggenau",
  compressor: "compressor",
};

const GENERIC_SERVICE_TOKENS = new Set([
  "",
  "general",
  "appliance",
  "appliances",
  "appliance service",
  "appliance repair",
  "service",
  "diagnostic",
]);

export function collapseString(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith("+")) return `+${digits}`;
  return digits ? `+${digits}` : phone;
}

export interface ServiceScopeCheck {
  supported: boolean;
  canonicalSkill?: SupportedSkill;
  raw?: string;
  category?: string;
  reason?: string;
  action: "proceed" | "decline_and_refer";
  message: string;
  speak_this: string;
  supported_services: typeof SUPPORTED_SERVICES_PUBLIC;
}

export type ScopeEvaluation = ServiceScopeCheck;

/**
 * Checks whether an appliance or skill request falls within company service scope.
 */
export function evaluateServiceScope(raw?: string): ServiceScopeCheck {
  if (!raw || !raw.trim()) {
    return {
      supported: true,
      raw,
      category: "general",
      action: "proceed",
      message: "Supported service scope.",
      speak_this: "",
      supported_services: SUPPORTED_SERVICES_PUBLIC,
    };
  }

  const collapsed = collapseString(raw);

  if (GENERIC_SERVICE_TOKENS.has(collapsed)) {
    return {
      supported: true,
      raw,
      category: "general",
      action: "proceed",
      message: "Supported service scope.",
      speak_this: "",
      supported_services: SUPPORTED_SERVICES_PUBLIC,
    };
  }

  // Explicit check against unsupported list
  for (const unsupp of UNSUPPORTED_SERVICES) {
    if (collapsed.includes(unsupp)) {
      return {
        supported: false,
        raw,
        category: "unsupported",
        reason: "unsupported_service",
        action: "decline_and_refer",
        message:
          "We do not service that appliance type. We service refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, and Sub-Zero appliances.",
        speak_this:
          "We don't service that appliance type. I can connect you with a dispatcher or provide a referral.",
        supported_services: SUPPORTED_SERVICES_PUBLIC,
      };
    }
  }

  // Exact alias match
  if (SKILL_ALIASES[collapsed]) {
    const canon = SKILL_ALIASES[collapsed];
    return {
      supported: true,
      canonicalSkill: canon,
      category: canon,
      raw,
      action: "proceed",
      message: `Supported service: ${canon}`,
      speak_this: "",
      supported_services: SUPPORTED_SERVICES_PUBLIC,
    };
  }

  // Substring match for compound phrases, e.g. "bosch dishwasher", "sub-zero fridge"
  for (const [alias, canon] of Object.entries(SKILL_ALIASES)) {
    const collapsedAlias = collapseString(alias);
    if (collapsed.includes(collapsedAlias)) {
      return {
        supported: true,
        canonicalSkill: canon,
        category: canon,
        raw,
        action: "proceed",
        message: `Supported service: ${canon}`,
        speak_this: "",
        supported_services: SUPPORTED_SERVICES_PUBLIC,
      };
    }
  }

  // Check supported skills list
  for (const supp of SUPPORTED_SKILLS) {
    if (collapsed.includes(supp)) {
      return {
        supported: true,
        canonicalSkill: supp,
        category: supp,
        raw,
        action: "proceed",
        message: `Supported service: ${supp}`,
        speak_this: "",
        supported_services: SUPPORTED_SERVICES_PUBLIC,
      };
    }
  }

  // Default to general supported scope when not matching an unsupported service
  return {
    supported: true,
    raw,
    category: "general",
    action: "proceed",
    message: "Supported service scope.",
    speak_this: "",
    supported_services: SUPPORTED_SERVICES_PUBLIC,
  };
}

export interface JobRecord {
  id: string;
  phone: string;
  customerName?: string;
  appliance?: string;
  modelSerial?: string | null;
  status: string;
  partsStatus?: string;
  partsEta?: string | null;
  assignedTechId?: string | null;
  assignedTechName?: string | null;
  scheduledAt?: string | null;
  zone?: string | null;
  skill?: string | null;
}

export interface CancellationContext {
  callerPhone?: string;
  spokenPhone?: string;
  confirmed?: boolean;
  failedAttemptCount?: number;
  feeAmount?: number;
  feeHours?: number;
  now?: Date;
}

export interface CancellationEvaluationInput {
  scheduledAt?: string | null;
  callerPhone?: string;
  spokenPhone?: string;
  jobPhone?: string;
  confirmed?: boolean;
  failedAttemptCount?: number;
  feeAmount?: number;
  feeHours?: number;
  now?: Date;
}

export interface CancellationEvaluationResult {
  ok: boolean;
  allowed: boolean;
  cancelled: boolean;
  verification_status:
    | "verified"
    | "verification_required"
    | "verification_mismatch"
    | "not_found"
    | "attempt_cap_exceeded";
  verificationStatus:
    | "verified"
    | "verification_required"
    | "verification_mismatch"
    | "not_found"
    | "attempt_cap_exceeded";
  fee_applicable: boolean;
  feeApplicable: boolean;
  fee_amount: number;
  feeAmount: number;
  policy_reason: string;
  policyReason: string;
  hours_until_appointment: number | null;
  hoursUntilAppointment: number | null;
  requires_confirmation?: boolean;
  error?: string;
  action?: string;
  transfer_required?: boolean;
  action_required?: string;
  job_id?: string;
  status?: string;
  customer_name?: string;
  appliance?: string;
  message: string;
  speak_this: string;
  speakThis: string;
  audit_outcome:
    | "verified"
    | "verification_required"
    | "verification_mismatch"
    | "not_found"
    | "attempt_cap_exceeded";
}

const CLOSED_JOB_STATUSES = new Set(["cancelled", "canceled", "done", "completed"]);

/**
 * Authoritative evaluation of appointment cancellation policy and 2FA ownership verification.
 * Accepts either (job, context) or a single input object for backwards compatibility.
 */
export function evaluateCancellationPolicy(
  jobOrInput: JobRecord | CancellationEvaluationInput | null,
  maybeCtx?: CancellationContext,
): CancellationEvaluationResult {
  let job: JobRecord | null = null;
  let ctx: CancellationContext = {};

  if (maybeCtx !== undefined) {
    job = jobOrInput as JobRecord | null;
    ctx = maybeCtx;
  } else if (jobOrInput) {
    const input = jobOrInput as CancellationEvaluationInput;
    if ("phone" in input && "status" in input && "id" in input) {
      job = input as unknown as JobRecord;
      ctx = {};
    } else {
      ctx = {
        callerPhone: input.callerPhone,
        spokenPhone: input.spokenPhone,
        confirmed: input.confirmed,
        failedAttemptCount: input.failedAttemptCount,
        feeAmount: input.feeAmount,
        feeHours: input.feeHours,
        now: input.now,
      };
      if (input.jobPhone || input.scheduledAt !== undefined) {
        job = {
          id: "job",
          phone: input.jobPhone || "",
          status: "Scheduled",
          scheduledAt: input.scheduledAt,
        };
      }
    }
  }

  const failedCount = ctx.failedAttemptCount ?? 0;
  const maxAttempts = CANCELLATION_POLICY.MAX_VERIFICATION_ATTEMPTS;

  const buildResult = (fields: {
    ok: boolean;
    allowed: boolean;
    cancelled: boolean;
    verification_status: CancellationEvaluationResult["verification_status"];
    fee_applicable: boolean;
    fee_amount: number;
    policy_reason: string;
    hours_until_appointment: number | null;
    requires_confirmation?: boolean;
    error?: string;
    action?: string;
    transfer_required?: boolean;
    action_required?: string;
    job_id?: string;
    status?: string;
    customer_name?: string;
    appliance?: string;
    message: string;
    speak_this: string;
    audit_outcome: CancellationEvaluationResult["audit_outcome"];
  }): CancellationEvaluationResult => ({
    ...fields,
    verificationStatus: fields.verification_status,
    feeApplicable: fields.fee_applicable,
    feeAmount: fields.fee_amount,
    policyReason: fields.policy_reason,
    hoursUntilAppointment: fields.hours_until_appointment,
    speakThis: fields.speak_this,
  });

  // 1. Attempt cap check (Brute-force protection)
  if (failedCount >= maxAttempts) {
    return buildResult({
      ok: false,
      allowed: false,
      cancelled: false,
      verification_status: "attempt_cap_exceeded",
      error: "attempt_cap_exceeded",
      action: "transfer",
      transfer_required: true,
      fee_applicable: false,
      fee_amount: 0,
      policy_reason: "Verification attempt limit reached. Connecting to a dispatcher.",
      hours_until_appointment: null,
      message: "Verification attempt limit reached. Connecting to a dispatcher.",
      speak_this:
        "I'm having trouble verifying your appointment details. Let me connect you with a dispatcher who can help you directly.",
      audit_outcome: "attempt_cap_exceeded",
    });
  }

  // 2. Job existence check
  if (!job) {
    return buildResult({
      ok: false,
      allowed: false,
      cancelled: false,
      verification_status: "not_found",
      error: "appointment_not_found",
      fee_applicable: false,
      fee_amount: 0,
      policy_reason: "Appointment not found.",
      hours_until_appointment: null,
      message:
        "I can't find an appointment that matches those details. Could you confirm the job number, or provide the phone number on the account?",
      speak_this:
        "I can't find an appointment that matches those details. Could you confirm the job number, or provide the phone number on the account?",
      audit_outcome: "not_found",
    });
  }

  // 3. Two-factor phone presence check
  const normSpoken = ctx.spokenPhone ? normalizePhone(ctx.spokenPhone) : "";
  const normCallerId = ctx.callerPhone ? normalizePhone(ctx.callerPhone) : "";
  const jobPhoneNorm = normalizePhone(job.phone);
  const hasProvidedPhone = Boolean(normSpoken || normCallerId);

  if (!hasProvidedPhone) {
    return buildResult({
      ok: false,
      allowed: false,
      cancelled: false,
      verification_status: "verification_required",
      job_id: job.id,
      error: "verification_required",
      action_required: "Ask for the phone number on the account to verify ownership",
      fee_applicable: false,
      fee_amount: 0,
      policy_reason: "Account phone number is required to verify ownership.",
      hours_until_appointment: null,
      message: "For security, what is the phone number on the account?",
      speak_this: "For security, what is the phone number on the account?",
      audit_outcome: "verification_required",
    });
  }

  // 4. Two-factor phone ownership verification
  const phoneMatches =
    (normSpoken && normSpoken === jobPhoneNorm) ||
    (normCallerId && normCallerId === jobPhoneNorm);

  if (!phoneMatches) {
    // Anti-enumeration security: neutral response indistinguishable from not_found
    return buildResult({
      ok: false,
      allowed: false,
      cancelled: false,
      verification_status: "verification_mismatch",
      job_id: job.id,
      error: "appointment_not_found",
      fee_applicable: false,
      fee_amount: 0,
      policy_reason: "Phone number does not match account on file.",
      hours_until_appointment: null,
      message:
        "I can't find an appointment that matches those details. Could you confirm the job number, or provide the phone number on the account?",
      speak_this:
        "I can't find an appointment that matches those details. Could you confirm the job number, or provide the phone number on the account?",
      audit_outcome: "verification_mismatch",
    });
  }

  // 5. Job closed check
  if (CLOSED_JOB_STATUSES.has(job.status.trim().toLowerCase())) {
    return buildResult({
      ok: false,
      allowed: false,
      cancelled: false,
      verification_status: "verified",
      job_id: job.id,
      status: job.status,
      error: "already_closed",
      fee_applicable: false,
      fee_amount: 0,
      policy_reason: `Job is already ${job.status.toLowerCase()}.`,
      hours_until_appointment: null,
      message: `Job ${job.id} is already ${job.status.toLowerCase()}. There's nothing left to cancel.`,
      speak_this: `Job ${job.id} is already ${job.status.toLowerCase()}. There's nothing left to cancel.`,
      audit_outcome: "verified",
    });
  }

  // 6. Fee calculation and verbal confirmation invariant
  const feeAmount = ctx.feeAmount ?? CANCELLATION_POLICY.FEE_AMOUNT_DOLLARS;
  const feeHours = ctx.feeHours ?? CANCELLATION_POLICY.FEE_WINDOW_HOURS;
  const now = ctx.now ?? new Date();

  let feeApplicable = false;
  let hoursUntil: number | null = null;

  if (job.scheduledAt) {
    const jobTime = new Date(job.scheduledAt).getTime();
    hoursUntil = Math.round(((jobTime - now.getTime()) / (1000 * 60 * 60)) * 10) / 10;
    if (hoursUntil < feeHours && hoursUntil > 0) {
      feeApplicable = true;
    }
  }

  const customerName = job.customerName || "there";
  const appliance = job.appliance || "appliance";

  if (feeApplicable && !ctx.confirmed) {
    return buildResult({
      ok: false,
      allowed: true,
      cancelled: false,
      verification_status: "verified",
      job_id: job.id,
      customer_name: customerName,
      appliance,
      fee_applicable: true,
      fee_amount: feeAmount,
      policy_reason: `Under ${feeHours}h notice`,
      hours_until_appointment: hoursUntil,
      requires_confirmation: true,
      action_required:
        "Collect verbal confirmation of the fee, then call again with confirmed=true and the same job_id",
      message: `Because your appointment is within ${feeHours} hours, an $${feeAmount} cancellation fee applies. Do you want to confirm?`,
      speak_this: `I found job ${job.id} for ${customerName} — the ${appliance}. Because it's inside ${feeHours} hours, there's an ${feeAmount} dollar cancellation fee. Do you want me to cancel it anyway?`,
      audit_outcome: "verified",
    });
  }

  const feeNote = feeApplicable
    ? ` A ${feeAmount} dollar cancellation fee applies.`
    : " There's no cancellation fee.";

  return buildResult({
    ok: true,
    allowed: true,
    cancelled: true,
    verification_status: "verified",
    job_id: job.id,
    customer_name: customerName,
    appliance,
    fee_applicable: feeApplicable,
    fee_amount: feeApplicable ? feeAmount : 0,
    policy_reason: feeApplicable
      ? `Under ${feeHours}h notice`
      : `Outside ${feeHours}h cancellation window`,
    hours_until_appointment: hoursUntil,
    requires_confirmation: feeApplicable,
    message: `Job ${job.id} is cancelled.${feeNote}`,
    speak_this: `You're all set — job ${job.id} is cancelled.${feeNote}`,
    audit_outcome: "verified",
  });
}

export type PartsRescheduleResult =
  | {
      ok: true;
      job_id: string;
      scheduled_at: string;
      assigned_tech_id?: string | null;
      assigned_tech_name?: string | null;
      parts_status: string;
      message: string;
      speak_this: string;
    }
  | {
      ok: false;
      job_id: string;
      reason: string;
      earliest_bookable?: string | null;
      parts_status: string;
      speak_this: string;
    };

/**
 * Authoritative evaluation of parts installation rescheduling criteria.
 */
export function evaluatePartsReschedule(
  job: JobRecord,
  preferredDateIso: string,
): PartsRescheduleResult {
  if (job.partsStatus === "backordered") {
    return {
      ok: false,
      job_id: job.id,
      reason: "Parts are backordered; cannot book install until parts arrive",
      earliest_bookable: job.partsEta,
      parts_status: job.partsStatus,
      speak_this:
        "The required parts are currently on backorder. We cannot schedule the installation until the parts arrive.",
    };
  }

  if (job.partsStatus === "in_stock") {
    const preferred = new Date(preferredDateIso);
    if (Number.isNaN(preferred.getTime())) {
      return {
        ok: false,
        job_id: job.id,
        reason: "Invalid preferred_date; use ISO-8601",
        parts_status: job.partsStatus,
        speak_this: "Please provide a valid preferred appointment date.",
      };
    }

    let earliest = preferred;
    if (job.partsEta) {
      const eta = new Date(job.partsEta);
      if (!Number.isNaN(eta.getTime()) && preferred < eta) {
        return {
          ok: false,
          job_id: job.id,
          reason: "Preferred date is before parts arrival / ready date",
          earliest_bookable: job.partsEta,
          parts_status: job.partsStatus,
          speak_this: `The parts are scheduled to arrive on ${job.partsEta}. Please pick a date after that.`,
        };
      }
      if (!Number.isNaN(eta.getTime()) && preferred < eta) earliest = eta;
    }

    return {
      ok: true,
      job_id: job.id,
      scheduled_at: earliest.toISOString(),
      assigned_tech_id: job.assignedTechId,
      assigned_tech_name: job.assignedTechName,
      parts_status: job.partsStatus,
      message: "Parts in stock / received. Keeping primary technician from diagnostic visit.",
      speak_this: `Your parts installation is rescheduled for ${earliest.toLocaleDateString()}.`,
    };
  }

  return {
    ok: false,
    job_id: job.id,
    reason: "Job has no parts install status; cannot reschedule parts install",
    parts_status: job.partsStatus || "none",
    speak_this: "This appointment does not have parts on file to reschedule.",
  };
}
