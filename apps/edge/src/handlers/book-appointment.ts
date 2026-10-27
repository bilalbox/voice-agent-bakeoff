import {
	evaluateServiceScope,
	SUPPORTED_SERVICES_PUBLIC,
} from "@applianceops/contracts";
import type { Context } from "hono";
import type { Env } from "../env";
import { formatWindowLocal } from "../lib/timezone";
import {
	extractArgs,
	extractFromNumber,
	type RetellFunctionBody,
} from "../retell/parse";
import type { ScheduleService } from "../services/schedule";

const DEMO_FALLBACK_PHONE = "+15550000000";

export async function handleBookAppointment(
	c: Context<{ Bindings: Env }>,
	schedule: ScheduleService,
	body: RetellFunctionBody,
): Promise<Response> {
	const t0 = performance.now();
	const args = extractArgs(body);

	const rawAppliance =
		typeof args.appliance === "string"
			? args.appliance
			: typeof args.appliance_type === "string"
				? args.appliance_type
				: undefined;
	const rawSkill = typeof args.skill === "string" ? args.skill : undefined;

	const appScope = evaluateServiceScope(rawAppliance);
	const skillScope = evaluateServiceScope(rawSkill);

	if (!appScope.supported || !skillScope.supported) {
		const ms = Math.round(performance.now() - t0);
		return c.json(
			{
				ok: false,
				booked: false,
				supported: false,
				error: "unsupported_service",
				reason: "unsupported_service",
				supported_services: SUPPORTED_SERVICES_PUBLIC,
				message:
					"We do not service that appliance type. We service refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, and Sub-Zero appliances.",
				speak_this:
					"We don't service that appliance type. I can connect you with a dispatcher or provide a referral.",
				latency_ms: ms,
			},
			200,
			{ "X-Tool-Latency-Ms": String(ms) },
		);
	}

	const techId =
		typeof args.tech_id === "string" && args.tech_id ? args.tech_id : undefined;
	const technician =
		typeof args.technician === "string" && args.technician
			? args.technician
			: typeof args.tech_name === "string"
				? args.tech_name
				: undefined;

	const windowStart =
		typeof args.window_start === "string" && args.window_start
			? args.window_start
			: typeof args.arrival_window_start === "string"
				? args.arrival_window_start
				: undefined;
	const windowEnd =
		typeof args.window_end === "string"
			? args.window_end
			: typeof args.arrival_window_end === "string"
				? args.arrival_window_end
				: undefined;

	let phone =
		extractFromNumber(body, args) ??
		(typeof args.phone === "string" ? args.phone : undefined) ??
		"";
	let phoneAssumed = false;
	if (!phone) {
		phone = DEMO_FALLBACK_PHONE;
		phoneAssumed = true;
	}

	if (!techId && !technician) {
		return c.json(
			{
				ok: false,
				booked: false,
				error:
					"Need tech_id from open_windows (e.g. tech-lee) or technician name (e.g. Lee P.)",
				latency_ms: Math.round(performance.now() - t0),
			},
			200,
		);
	}

	const result = await schedule.bookAppointment({
		tech_id: techId,
		technician,
		window_start: windowStart,
		window_end: windowEnd,
		zone: typeof args.zone === "string" ? args.zone : undefined,
		skill: rawSkill,
		appliance: rawAppliance,
		model_serial:
			typeof args.model_serial === "string" ? args.model_serial : undefined,
		phone,
		customer_name:
			typeof args.customer_name === "string" ? args.customer_name : undefined,
	});

	const ms = Math.round(performance.now() - t0);

	if (!result.ok) {
		const isUnavailableWindow = result.reason === "unavailable_window";
		const isUnsupported = result.reason === "unsupported_service";
		return c.json(
			{
				ok: false,
				booked: false,
				error: result.reason,
				reason: result.reason,
				...(isUnsupported
					? { supported: false, supported_services: SUPPORTED_SERVICES_PUBLIC }
					: {}),
				speak_this: isUnsupported
					? "We don't service that appliance type. I can connect you with a dispatcher or provide a referral."
					: isUnavailableWindow
						? "That arrival window is no longer available. Please check availability again to choose another time."
						: "I wasn't able to complete that booking. Would you like to check other available times?",
				action:
					"Tell the caller booking failed briefly, then offer to pick another window or check availability again. Do not end the call abruptly.",
				latency_ms: ms,
			},
			200,
			{ "X-Tool-Latency-Ms": String(ms) },
		);
	}

	const endIso =
		windowEnd ??
		new Date(
			new Date(result.job.scheduledAt!).getTime() + 2 * 3600 * 1000,
		).toISOString();

	return c.json(
		{
			ok: true,
			booked: true,
			job_id: result.job.id,
			status: result.job.status,
			technician: result.job.assignedTechName,
			tech_id: result.job.assignedTechId,
			zone: result.job.zone,
			skill: result.job.skill,
			appliance: result.job.appliance,
			model_serial: result.job.modelSerial ?? null,
			customer_name: result.job.customerName,
			phone,
			phone_assumed: phoneAssumed,
			scheduled_at: result.job.scheduledAt,
			arrival_window_label: result.label,
			arrival_window_local: formatWindowLocal(result.job.scheduledAt!, endIso),
			message: `You're booked with ${result.label}. Your job number is ${result.job.id}.`,
			speak_this: `You're all set. ${result.label}. Job number ${result.job.id}.`,
			latency_ms: ms,
		},
		200,
		{
			"X-Tool-Latency-Ms": String(ms),
			"Server-Timing": `app;dur=${ms}`,
		},
	);
}
