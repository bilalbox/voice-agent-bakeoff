import { SUPPORTED_SERVICES_PUBLIC } from "@applianceops/contracts";
import type { Context } from "hono";
import type { Env } from "../env";
import { formatWindowLocal } from "../lib/timezone";
import { extractArgs, type RetellFunctionBody } from "../retell/parse";
import { normalizeAvailabilityQuery } from "../services/availability-query";
import type { ScheduleService } from "../services/schedule";

export async function handleCheckAvailability(
	c: Context<{ Bindings: Env }>,
	schedule: ScheduleService,
	body: RetellFunctionBody,
): Promise<Response> {
	const t0 = performance.now();
	const args = extractArgs(body);
	const normalized = normalizeAvailabilityQuery({
		zone: typeof args.zone === "string" ? args.zone : undefined,
		skill: typeof args.skill === "string" ? args.skill : undefined,
		appliance_type:
			typeof args.appliance_type === "string" ? args.appliance_type : undefined,
		preferred_date:
			typeof args.preferred_date === "string" ? args.preferred_date : undefined,
	});

	const ms = Math.round(performance.now() - t0);
	const scope =
		normalized.zone === undefined ? "all_zones" : `zone:${normalized.zone}`;

	if (!normalized.supported) {
		return c.json(
			{
				ok: false,
				supported: false,
				error: "unsupported_service",
				supported_services: SUPPORTED_SERVICES_PUBLIC,
				open_windows: [],
				timezone: "America/Los_Angeles",
				count: 0,
				query: {
					zone: normalized.zone ?? null,
					skills: [],
					preferred_date: normalized.preferred_date ?? null,
					scope,
					raw: normalized.raw,
				},
				message:
					"We do not service that appliance type. We service refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, and Sub-Zero appliances.",
				speak_this:
					"We don't service that appliance type. We only service kitchen and laundry appliances like refrigerators, dishwashers, washers, dryers, and cooking appliances. Would you like me to connect you with a dispatcher or provide a referral?",
				source: "d1_schedule_cache",
				latency_ms: ms,
			},
			200,
			{
				"X-Tool-Latency-Ms": String(ms),
				"Server-Timing": `app;dur=${ms}`,
			},
		);
	}

	const slots = await schedule.checkAvailability({
		zone: normalized.zone,
		skills: normalized.skills,
		preferred_date: normalized.preferred_date,
	});

	let zones_with_skill: string[] = [];
	if (slots.length === 0 && normalized.skills.length > 0) {
		zones_with_skill = await schedule.zonesWithSkills(normalized.skills);
	}

	return c.json(
		{
			open_windows: slots.map((s) => ({
				technician: s.tech_name,
				tech_id: s.tech_id,
				zone: s.zone,
				skill: s.skill,
				arrival_window_start: s.window_start,
				arrival_window_end: s.window_end,
				label: `${s.tech_name} (${s.zone}): ${formatWindowLocal(s.window_start, s.window_end)}`,
			})),
			timezone: "America/Los_Angeles",
			count: slots.length,
			query: {
				zone: normalized.zone ?? null,
				skills: normalized.skills,
				preferred_date: normalized.preferred_date ?? null,
				scope,
				raw: normalized.raw,
			},
			...(slots.length === 0
				? {
						hint:
							zones_with_skill.length > 0
								? `No windows matched this filter. Dishwasher/related coverage exists in: ${zones_with_skill.join(", ")}. Retry with zone omitted for all areas, or one of those zones.`
								: "No windows matched. Try omitting zone (all areas), broadening skill, or omitting preferred_date.",
						zones_with_skill,
					}
				: {}),
			source: "d1_schedule_cache",
			latency_ms: ms,
		},
		200,
		{
			"X-Tool-Latency-Ms": String(ms),
			"Server-Timing": `app;dur=${ms}`,
		},
	);
}
