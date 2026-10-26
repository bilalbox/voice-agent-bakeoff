import type { Job, PartsStatus, Technician } from "../../types";

export function mapWorkizPartsStatus(raw: string | undefined | null): PartsStatus {
  if (!raw) return "none";
  const n = raw.toLowerCase();
  if (n.includes("backorder")) return "backordered";
  if (n.includes("in stock") || n.includes("received") || n.includes("arrived")) {
    return "in_stock";
  }
  if (n === "in_stock" || n === "backordered" || n === "none") return n;
  return "none";
}

export function jobFromWorkizApi(raw: Record<string, unknown>): Job {
  const partsRaw =
    (raw.PartsStatus as string) ??
    (raw.parts_status as string) ??
    (raw["Parts Status"] as string);

  return {
    id: String(raw.UUID ?? raw.uuid ?? raw.id ?? ""),
    phone: normalizePhone(String(raw.Phone ?? raw.phone ?? raw.ClientPhone ?? "")),
    customerName: String(raw.ClientName ?? raw.client_name ?? raw.customerName ?? ""),
    appliance: String(raw.JobType ?? raw.job_type ?? raw.appliance ?? raw.Description ?? ""),
    modelSerial: optionalString(raw.ModelSerial ?? raw.model_serial ?? raw["Model Serial"]),
    status: String(raw.Status ?? raw.status ?? "open"),
    partsStatus: mapWorkizPartsStatus(partsRaw),
    partsEta: optionalString(raw.PartsETA ?? raw.parts_eta ?? raw["Parts ETA"]),
    assignedTechId: optionalString(raw.TechUUID ?? raw.tech_uuid ?? raw.assignedTechId),
    assignedTechName: optionalString(raw.TechName ?? raw.tech_name ?? raw.assignedTechName),
    scheduledAt: optionalString(raw.JobDateTime ?? raw.job_date_time ?? raw.scheduledAt),
    zone: optionalString(raw.Postal ?? raw.zone ?? raw.ServiceArea),
    skill: optionalString(raw.Skill ?? raw.skill ?? raw.Trade),
  };
}

export function techFromWorkizApi(raw: Record<string, unknown>): Technician {
  const skillsRaw = raw.Skills ?? raw.skills ?? raw.Tags ?? raw.tags;
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.map(String)
    : typeof skillsRaw === "string"
      ? skillsRaw.split(",").map((s) => s.trim())
      : [];

  return {
    id: String(raw.UUID ?? raw.uuid ?? raw.id ?? ""),
    name: String(raw.Name ?? raw.name ?? ""),
    skills,
    zone: String(raw.Area ?? raw.zone ?? raw.ServiceArea ?? ""),
    active: Boolean(raw.Active ?? raw.active ?? true),
  };
}

export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (raw.startsWith("+")) return raw;
  return d ? `+${d}` : "";
}

function optionalString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}
