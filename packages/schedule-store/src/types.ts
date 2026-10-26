/**
 * Canonical domain & repository types for ApplianceOps scheduling & CRM integration.
 */

export type PartsStatus = "in_stock" | "backordered" | "none";

export type Job = {
  id: string;
  phone: string;
  customerName: string;
  appliance: string;
  modelSerial?: string;
  status: string;
  partsStatus: PartsStatus;
  partsEta?: string;
  assignedTechId?: string;
  assignedTechName?: string;
  scheduledAt?: string;
  zone?: string;
  skill?: string;
};

export type Technician = {
  id: string;
  name: string;
  skills: string[];
  zone: string;
  active: boolean;
};

export type AvailabilitySlot = {
  tech_id: string;
  tech_name: string;
  zone: string;
  skill: string;
  window_start: string;
  window_end: string;
  label?: string;
};

export type Page<T> = {
  items: T[];
  hasMore: boolean;
};

export type PageArgs = {
  offset: number;
  limit: number;
};

export type NewJobInput = {
  id?: string;
  phone: string;
  customerName: string;
  appliance: string;
  modelSerial?: string;
  status?: string;
  partsStatus?: PartsStatus;
  partsEta?: string;
  assignedTechId?: string;
  scheduledAt?: string;
  zone?: string;
  skill?: string;
};

export interface WorkizClient {
  findJobsByPhone(phone: string): Promise<Job[]>;
  getJob(id: string): Promise<Job | null>;
  listJobs(page: PageArgs): Promise<Page<Job>>;
  listTeam(page: PageArgs): Promise<Page<Technician>>;
  updateJob(id: string, patch: Partial<Job>): Promise<Job>;
  createJob(input: NewJobInput): Promise<Job>;
}

export type BookAppointmentInput = {
  tech_id?: string;
  technician?: string;
  window_start?: string;
  window_end?: string;
  zone?: string;
  skill?: string;
  appliance?: string;
  model_serial?: string;
  phone?: string;
  customer_name?: string;
};

export type BookAppointmentResult =
  | {
      ok: true;
      job: Job;
      label: string;
      message: string;
      speak_this: string;
    }
  | {
      ok: false;
      reason: string;
      error?: string;
      message: string;
      speak_this: string;
    };

export type ReschedulePartsResult = {
  ok: boolean;
  job_id: string;
  scheduled_at?: string;
  parts_status: string;
  assigned_tech_id?: string;
  assigned_tech_name?: string;
  reason?: string;
  message: string;
  speak_this: string;
};

export type CancelAppointmentResult = {
  ok: boolean;
  allowed: boolean;
  cancelled: boolean;
  job_id?: string;
  verification_status:
    | "verified"
    | "verification_required"
    | "verification_mismatch"
    | "not_found"
    | "attempt_cap_exceeded";
  fee_applicable: boolean;
  fee_amount: number;
  policy_reason: string;
  hours_until_appointment?: number | null;
  message: string;
  speak_this: string;
  latency_ms?: number;
};

export type LookupJobResult = {
  found: boolean;
  job?: Job;
  job_id?: string;
  customer_name?: string;
  phone?: string;
  appliance?: string;
  status?: string;
  scheduled_at?: string | null;
  assigned_tech_name?: string | null;
  parts_status?: string;
  message: string;
  speak_this: string;
};

export type CallerContext = {
  knownCaller: boolean;
  customerName: string;
  openJobId: string;
  assignedTech: string;
  openJobStatus: string;
  appliance: string;
  modelSerial: string;
  partsStatus: string;
  job: Job | null;
};
