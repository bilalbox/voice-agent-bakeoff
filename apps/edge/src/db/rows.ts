import type { Job, PartsStatus, Technician } from "../workiz/types";
import { mapWorkizPartsStatus } from "../workiz/mappers/fromWorkizApi";

export type JobRow = {
  id: string;
  phone: string;
  customer_name: string;
  appliance: string;
  model_serial: string | null;
  status: string;
  parts_status: string;
  parts_eta: string | null;
  assigned_tech_id: string | null;
  scheduled_at: string | null;
  zone: string | null;
  skill: string | null;
};

export type JobCacheRow = JobRow & {
  assigned_tech_name: string | null;
  synced_at: string;
};

export type TechRow = {
  id: string;
  name: string;
  skills: string;
  zone: string;
  active: number;
};

export function jobFromRow(row: JobRow, techName?: string | null): Job {
  return {
    id: row.id,
    phone: row.phone,
    customerName: row.customer_name,
    appliance: row.appliance,
    modelSerial: row.model_serial ?? undefined,
    status: row.status,
    partsStatus: mapWorkizPartsStatus(row.parts_status) as PartsStatus,
    partsEta: row.parts_eta ?? undefined,
    assignedTechId: row.assigned_tech_id ?? undefined,
    assignedTechName: techName ?? undefined,
    scheduledAt: row.scheduled_at ?? undefined,
    zone: row.zone ?? undefined,
    skill: row.skill ?? undefined,
  };
}

export function jobFromCacheRow(row: JobCacheRow): Job {
  return jobFromRow(row, row.assigned_tech_name);
}

export function techFromRow(row: TechRow): Technician {
  return {
    id: row.id,
    name: row.name,
    skills: row.skills.split(",").map((s) => s.trim()).filter(Boolean),
    zone: row.zone,
    active: row.active === 1,
  };
}
