/** Lightweight America/Los_Angeles helpers for demo slot generation / labels. */

const DEMO_TZ = "America/Los_Angeles";

export function formatInTimeZone(
	iso: string,
	timeZone = DEMO_TZ,
): { label: string; dateLabel: string; timeLabel: string } {
	const d = new Date(iso);
	const dateLabel = d.toLocaleString("en-US", {
		timeZone,
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	const timeLabel = d.toLocaleString("en-US", {
		timeZone,
		hour: "numeric",
		minute: "2-digit",
	});
	const endHint = ""; // caller formats ranges
	return {
		label: `${dateLabel}, ${timeLabel} PT${endHint}`,
		dateLabel,
		timeLabel,
	};
}

export function formatWindowLocal(
	startIso: string,
	endIso: string,
	timeZone = DEMO_TZ,
): string {
	const start = new Date(startIso);
	const end = new Date(endIso);
	const day = start.toLocaleString("en-US", {
		timeZone,
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	const t0 = start.toLocaleString("en-US", {
		timeZone,
		hour: "numeric",
		minute: "2-digit",
	});
	const t1 = end.toLocaleString("en-US", {
		timeZone,
		hour: "numeric",
		minute: "2-digit",
	});
	return `${day}, ${t0} – ${t1} PT`;
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function wallTimeToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone = DEMO_TZ,
): Date {
	// Guess treating wall clock as UTC, then correct using zone offset twice.
	let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
	for (let i = 0; i < 3; i++) {
		const offset = offsetMsAt(new Date(utcMs), timeZone);
		utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
	}
	return new Date(utcMs);
}

/** Calendar Y/M/D in a time zone for an instant. */
export function calendarPartsInZone(
	date: Date,
	timeZone = DEMO_TZ,
): { year: number; month: number; day: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
	};
}

export function addCalendarDays(
	parts: { year: number; month: number; day: number },
	days: number,
): { year: number; month: number; day: number } {
	const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
	return {
		year: utc.getUTCFullYear(),
		month: utc.getUTCMonth() + 1,
		day: utc.getUTCDate(),
	};
}

function offsetMsAt(date: Date, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const parts = Object.fromEntries(
		dtf.formatToParts(date).map((p) => [p.type, p.value]),
	);
	let hour = Number(parts.hour);
	if (hour === 24) hour = 0;
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		hour,
		Number(parts.minute),
		Number(parts.second),
	);
	return asUtc - date.getTime();
}
