/** Canonical domain types — not raw Workiz JSON */

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

export type Page<T> = {
  items: T[];
  hasMore: boolean;
};

export type PageArgs = {
  offset: number;
  limit: number;
};

/**
 * CRM port. Retell handlers and policy code must depend on this interface only.
 * Swap MockWorkizClient → RealWorkizClient via WORKIZ_MODE without rewriting tools.
 */
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
