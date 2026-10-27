import type { Job, PartsStatus, Technician } from "../types";

/**
 * Expected Workiz REST field names (trial OpenAPI / developer.workiz.com).
 * Fill RealWorkizClient by mapping these into domain Job/Technician.
 *
 * Jobs (illustrative):
 * - UUID / Job ID → id
 * - Phone / Client Phone → phone
 * - Client Name → customerName
 * - Job Type / Description → appliance
 * - Custom: Model Serial → modelSerial
 * - Status → status
 * - Custom: Parts Status ("In Stock / Received" | "Backordered") → partsStatus
 * - Custom: Parts ETA → partsEta (ISO)
 * - Primary Tech ID / Name → assignedTechId / assignedTechName
 * - Job Date Time → scheduledAt (ISO)
 * - Postal / Service Area → zone
 * - Skill / Trade → skill
 *
 * Team:
 * - UUID → id
 * - Name → name
 * - Skills / Tags → skills[]
 * - Area → zone
 * - Active → active
 */

export function mapWorkizPartsStatus(
	raw: string | undefined | null,
): PartsStatus {
	if (!raw) return "none";
	const n = raw.toLowerCase();
	if (n.includes("backorder")) return "backordered";
	if (
		n.includes("in stock") ||
		n.includes("received") ||
		n.includes("arrived")
	) {
		return "in_stock";
	}
	if (n === "in_stock" || n === "backordered" || n === "none") return n;
	return "none";
}

/** Placeholder mapper for live Workiz job payloads — refine against trial responses. */
export function jobFromWorkizApi(raw: Record<string, unknown>): Job {
	const partsRaw =
		(raw.PartsStatus as string) ??
		(raw.parts_status as string) ??
		(raw["Parts Status"] as string);

	return {
		id: String(raw.UUID ?? raw.uuid ?? raw.id ?? ""),
		phone: normalizePhone(
			String(raw.Phone ?? raw.phone ?? raw.ClientPhone ?? ""),
		),
		customerName: String(
			raw.ClientName ?? raw.client_name ?? raw.customerName ?? "",
		),
		appliance: String(
			raw.JobType ?? raw.job_type ?? raw.appliance ?? raw.Description ?? "",
		),
		modelSerial: optionalString(
			raw.ModelSerial ?? raw.model_serial ?? raw["Model Serial"],
		),
		status: String(raw.Status ?? raw.status ?? "open"),
		partsStatus: mapWorkizPartsStatus(partsRaw),
		partsEta: optionalString(raw.PartsETA ?? raw.parts_eta ?? raw["Parts ETA"]),
		assignedTechId: optionalString(
			raw.TechUUID ?? raw.tech_uuid ?? raw.assignedTechId,
		),
		assignedTechName: optionalString(
			raw.TechName ?? raw.tech_name ?? raw.assignedTechName,
		),
		scheduledAt: optionalString(
			raw.JobDateTime ?? raw.job_date_time ?? raw.scheduledAt,
		),
		zone: optionalString(raw.Postal ?? raw.zone ?? raw.ServiceArea),
		skill: optionalString(raw.Skill ?? raw.skill ?? raw.Trade),
	};
}

export function techFromWorkizApi(raw: Record<string, unknown>): Technician {
	const skillsRaw = raw.Skills ?? raw.skills ?? raw.Tags ?? "";
	const skills =
		typeof skillsRaw === "string"
			? skillsRaw
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: Array.isArray(skillsRaw)
				? skillsRaw.map(String)
				: [];

	return {
		id: String(raw.UUID ?? raw.uuid ?? raw.id ?? ""),
		name: String(raw.Name ?? raw.name ?? ""),
		skills,
		zone: String(raw.Area ?? raw.zone ?? raw.Postal ?? ""),
		active:
			raw.Active === false || raw.active === 0 || raw.active === false
				? false
				: true,
	};
}

function optionalString(v: unknown): string | undefined {
	if (v === null || v === undefined || v === "") return undefined;
	return String(v);
}

export function normalizePhone(phone: string): string {
	const digits = phone.replace(/\D/g, "");
	if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
	if (digits.length === 10) return `+1${digits}`;
	if (phone.startsWith("+")) return `+${digits}`;
	return digits ? `+${digits}` : phone;
}
