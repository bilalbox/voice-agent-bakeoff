/**
 * Lightweight America/Los_Angeles timezone helpers for slot generation and human-friendly labels.
 */

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
	return {
		label: `${dateLabel}, ${timeLabel} PT`,
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

export function calendarPartsInZone(
	d: Date,
	timeZone = DEMO_TZ,
): { year: number; month: number; day: number } {
	const f = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "numeric",
		day: "numeric",
	});
	const parts = f.formatToParts(d);
	let year = 0;
	let month = 0;
	let day = 0;
	for (const p of parts) {
		if (p.type === "year") year = Number(p.value);
		if (p.type === "month") month = Number(p.value);
		if (p.type === "day") day = Number(p.value);
	}
	return { year, month, day };
}

export function addCalendarDays(
	d: Date,
	days: number,
	timeZone = DEMO_TZ,
): Date {
	const { year, month, day } = calendarPartsInZone(d, timeZone);
	return new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
}

export function wallTimeToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone = DEMO_TZ,
): Date {
	let guess = new Date(Date.UTC(year, month - 1, day, hour + 7, minute));
	for (let i = 0; i < 3; i++) {
		const f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			hourCycle: "h23",
		});
		const p = f.formatToParts(guess);
		let gy = 0,
			gm = 0,
			gd = 0,
			gh = 0,
			gmin = 0;
		for (const part of p) {
			if (part.type === "year") gy = Number(part.value);
			if (part.type === "month") gm = Number(part.value);
			if (part.type === "day") gd = Number(part.value);
			if (part.type === "hour") gh = Number(part.value);
			if (part.type === "minute") gmin = Number(part.value);
		}
		const diffMinutes =
			(year - gy) * 525600 +
			(month - gm) * 43200 +
			(day - gd) * 1440 +
			(hour - gh) * 60 +
			(minute - gmin);
		if (diffMinutes === 0) return guess;
		guess = new Date(guess.getTime() + diffMinutes * 60000);
	}
	return guess;
}
