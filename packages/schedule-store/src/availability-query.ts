/** Normalize availability query args into canonical zone/skill filters. */

import {
	collapseString,
	evaluateServiceScope,
	SKILL_ALIASES,
	type SupportedSkill,
} from "@applianceops/contracts";
import type { AvailabilitySlot } from "./types";

const ZONE_ALIASES: Record<string, string> = {
	north: "north",
	northern: "north",
	"north zone": "north",
	"northern zone": "north",
	"northern area": "north",
	"north area": "north",
	central: "central",
	"central zone": "central",
	"central area": "central",
	midtown: "central",
	south: "south",
	southern: "south",
	"south zone": "south",
	"southern zone": "south",
	"southern area": "south",
	"south area": "south",
};

const SKILL_EXPAND: Record<string, string[]> = {
	dishwasher: ["dishwasher", "bosch", "general"],
	refrigeration: ["refrigeration", "compressor", "sub-zero", "general"],
	laundry: ["laundry", "miele", "general"],
	cooking: ["cooking", "bosch", "gaggenau", "general"],
	bosch: ["bosch", "dishwasher", "cooking", "general"],
	miele: ["miele", "laundry", "general"],
	gaggenau: ["gaggenau", "cooking", "general"],
	"sub-zero": ["sub-zero", "refrigeration", "compressor"],
	compressor: ["compressor", "refrigeration"],
	general: ["general"],
};

const ALL_ZONE_TOKENS = new Set([
	"",
	"all",
	"any",
	"all zones",
	"any zone",
	"all areas",
	"any area",
	"all service areas",
	"everywhere",
	"omit",
	"none",
	"n/a",
]);

export type NormalizedAvailabilityQuery = {
	zone?: string;
	skills: string[];
	preferred_date?: string;
	supported: boolean;
	raw: { zone?: string; skill?: string; preferred_date?: string };
};

export function normalizeAvailabilityQuery(input: {
	zone?: string;
	skill?: string;
	appliance_type?: string;
	preferred_date?: string;
}): NormalizedAvailabilityQuery {
	const rawSkill = input.skill ?? input.appliance_type;
	const scope = evaluateServiceScope(rawSkill);

	if (!scope.supported) {
		return {
			zone: canonicalizeZone(input.zone),
			skills: [],
			preferred_date: normalizePreferredDate(input.preferred_date),
			supported: false,
			raw: {
				zone: input.zone,
				skill: rawSkill,
				preferred_date: input.preferred_date,
			},
		};
	}

	const skillCanon =
		scope.canonicalSkill ??
		(rawSkill ? canonicalizeSkill(rawSkill) : undefined);
	const skills = skillCanon ? (SKILL_EXPAND[skillCanon] ?? [skillCanon]) : [];

	return {
		zone: canonicalizeZone(input.zone),
		skills,
		preferred_date: normalizePreferredDate(input.preferred_date),
		supported: true,
		raw: {
			zone: input.zone,
			skill: rawSkill,
			preferred_date: input.preferred_date,
		},
	};
}

export function canonicalizeZone(raw?: string): string | undefined {
	if (!raw?.trim()) return undefined;
	const k = collapseString(raw);
	if (ALL_ZONE_TOKENS.has(k)) return undefined;
	return (
		ZONE_ALIASES[k] ??
		(["north", "central", "south"].includes(k) ? k : undefined)
	);
}

export function canonicalizeSkill(raw?: string): string | undefined {
	if (!raw?.trim()) return undefined;
	const k = collapseString(raw);
	return SKILL_ALIASES[k] ?? k;
}

export function normalizePreferredDate(raw?: string): string | undefined {
	if (!raw?.trim()) return undefined;
	const t = raw.trim();
	const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
	if (m && m[1]) return m[1];
	const d = new Date(t);
	if (!Number.isNaN(d.getTime())) {
		return d.toISOString().slice(0, 10);
	}
	return undefined;
}

export function diversifySlots(
	slots: AvailabilitySlot[],
	skills: string[],
	limit = 6,
): AvailabilitySlot[] {
	const primarySkill = skills[0]?.toLowerCase();
	const exactSkill: AvailabilitySlot[] = [];
	const relatedSkill: AvailabilitySlot[] = [];

	for (const s of slots) {
		if (primarySkill && s.skill.toLowerCase() === primarySkill) {
			exactSkill.push(s);
		} else {
			relatedSkill.push(s);
		}
	}

	const out: AvailabilitySlot[] = [];
	const seenKeys = new Set<string>();

	const pushIfUnique = (s: AvailabilitySlot) => {
		const k = `${s.tech_id}:${s.window_start}`;
		if (!seenKeys.has(k) && out.length < limit) {
			seenKeys.add(k);
			out.push(s);
		}
	};

	for (const s of exactSkill) pushIfUnique(s);
	for (const s of relatedSkill) pushIfUnique(s);

	return out;
}
