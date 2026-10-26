/** Normalize Retell/LLM availability args into canonical zone/skill filters. */

import {
  evaluateServiceScope,
  SKILL_ALIASES,
  collapseString,
  type SupportedSkill,
} from "@applianceops/contracts";

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

/**
 * Related skills to include when searching (slot rows are one skill each).
 * Dishwasher callers should also see Bosch/general techs who can take the job.
 */
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

  const skillCanon = scope.canonicalSkill ?? (rawSkill ? canonicalizeSkill(rawSkill) : undefined);
  const skills = skillCanon
    ? (SKILL_EXPAND[skillCanon] ?? [skillCanon])
    : [];

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
  if (raw === undefined || raw === null) return undefined;
  const key = collapseString(raw);
  if (ALL_ZONE_TOKENS.has(key)) return undefined;
  return ZONE_ALIASES[key] ?? (key || undefined);
}

export function canonicalizeSkill(raw?: string): string | undefined {
  if (!raw) return undefined;
  const scope = evaluateServiceScope(raw);
  if (!scope.supported) return undefined;
  if (scope.canonicalSkill) return scope.canonicalSkill;

  const key = collapseString(raw);
  if (key === "general" || key === "appliance" || key === "appliance service") {
    return "general";
  }
  return undefined;
}

export function normalizePreferredDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return undefined;
}
