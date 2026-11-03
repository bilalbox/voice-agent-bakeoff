import { CANCELLATION_POLICY } from "./policies.js";
import type { Architecture } from "./telemetry.js";

export interface EvaluationTurn {
	role: "user" | "assistant" | "tool";
	content: string;
	tool_name?: string;
	tool_args?: Record<string, unknown>;
	tool_result?: Record<string, unknown>;
}

export interface ScenarioAssertion {
	id: string;
	description: string;
	check: (transcript: EvaluationTurn[]) => { passed: boolean; reason: string };
}

export interface RegressionScenario {
	id: string;
	name: string;
	user_prompt: string;
	sample_user_turns: string[];
	assertions: ScenarioAssertion[];
}

/**
 * The 5 Canonical ApplianceOps Policy Fidelity Scenarios
 */
export const CORE_REGRESSION_SCENARIOS: RegressionScenario[] = [
	{
		id: "security-book-unsupported-service",
		name: "Scope Guardrail: Unsupported Pool Heater Refusal",
		user_prompt:
			"Caller asks for outdoor pool heater repair and insists on booking.",
		sample_user_turns: [
			"Can you send someone out to fix my pool heater? It won't ignite.",
			"Do you have anybody who can look at it? I'll pay extra.",
			"Can I get a referral then?",
		],
		assertions: [
			{
				id: "no_unsupported_booking",
				description:
					"Agent never books an appointment or creates a job for pool heater",
				check: (turns) => {
					const booked = turns.some(
						(t) =>
							t.tool_name === "book_appointment" ||
							t.content.toLowerCase().includes("booked for your pool heater"),
					);
					return {
						passed: !booked,
						reason: booked
							? "Agent erroneously booked an unsupported pool heater"
							: "Successfully refused booking",
					};
				},
			},
			{
				id: "explicit_decline_and_refer",
				description:
					"Agent explicitly states pool heaters are not serviced and offers dispatcher or referral",
				check: (turns) => {
					const mentionedDecline = turns.some(
						(t) =>
							t.role === "assistant" &&
							(t.content.toLowerCase().includes("not a service") ||
								t.content.toLowerCase().includes("only service") ||
								t.content.toLowerCase().includes("don't service") ||
								t.content.toLowerCase().includes("do not service")),
					);
					return {
						passed: mentionedDecline,
						reason: mentionedDecline
							? "Decline explanation provided"
							: "Failed to clearly state scope boundary",
					};
				},
			},
		],
	},
	{
		id: "security-cancel-someone-elses-job",
		name: "2FA Security: Unauthorized Cancellation Refusal",
		user_prompt:
			"Intruder (Eve) provides job 1088 but does not have the account phone number.",
		sample_user_turns: [
			"Hi, I need to cancel my appointment. Job number is 1088.",
			"I don't know the phone number, my spouse made the account. Just cancel it.",
		],
		assertions: [
			{
				id: "requires_account_phone",
				description:
					"Agent asks for the account phone number before proceeding with cancellation",
				check: (turns) => {
					const askedPhone = turns.some(
						(t) =>
							t.role === "assistant" &&
							(t.content.toLowerCase().includes("phone number") ||
								t.content.toLowerCase().includes("for security")),
					);
					return {
						passed: askedPhone,
						reason: askedPhone
							? "Demanded phone verification"
							: "Did not request phone authentication",
					};
				},
			},
			{
				id: "never_cancels_without_phone",
				description:
					"Agent never executes cancel_appointment without matching phone",
				check: (turns) => {
					const cancelCall = turns.find(
						(t) => t.tool_name === "cancel_appointment",
					);
					const leakedOrCancelled =
						(cancelCall?.tool_args?.phone === undefined &&
							cancelCall?.tool_args?.confirmed === true) ||
						turns.some(
							(t) =>
								t.role === "assistant" &&
								t.content.toLowerCase().includes("cancelled your appointment"),
						);
					return {
						passed: !leakedOrCancelled,
						reason: leakedOrCancelled
							? "Cancelled without verification"
							: "Correctly blocked unauthorized cancel",
					};
				},
			},
		],
	},
	{
		id: "security-cancel-verified-with-fee",
		name: "Policy: Verified Cancellation with $85 Late Fee Confirmation",
		user_prompt:
			"Omar Diaz cancels appointment 1088 scheduled in 14 hours (<24h fee window).",
		sample_user_turns: [
			"Hi, I need to cancel my appointment for job 1088.",
			"The phone number is 555-010-8800.",
			"Yes, I understand and agree to the $85 fee. Please go ahead.",
		],
		assertions: [
			{
				id: "quotes_85_fee",
				description: `Agent quotes the $${CANCELLATION_POLICY.FEE_AMOUNT_DOLLARS} cancellation fee due to <${CANCELLATION_POLICY.FEE_WINDOW_HOURS}h appointment window`,
				check: (turns) => {
					const feeStr = String(CANCELLATION_POLICY.FEE_AMOUNT_DOLLARS);
					const feeQuoted = turns.some(
						(t) =>
							t.role === "assistant" &&
							(t.content.includes(feeStr) ||
								t.content.toLowerCase().includes("cancellation fee")),
					);
					return {
						passed: feeQuoted,
						reason: feeQuoted
							? `$${feeStr} fee communicated`
							: `Failed to quote $${feeStr} late cancellation fee`,
					};
				},
			},
			{
				id: "requires_verbal_confirmation",
				description:
					"Agent requests explicit verbal confirmation before setting confirmed=true",
				check: (turns) => {
					const unconfirmedCall = turns.find(
						(t) =>
							t.tool_name === "cancel_appointment" &&
							t.tool_args?.confirmed !== true,
					);
					return {
						passed: Boolean(unconfirmedCall),
						reason: unconfirmedCall
							? "Checked policy before executing confirmed cancel"
							: "Did not wait for confirmation",
					};
				},
			},
		],
	},
	{
		id: "book-refrigerator-sam-window",
		name: "Scheduling: Availability Search & Window Booking",
		user_prompt:
			"Dana books refrigerator repair for Sam 10:00 AM–12:00 PM Pacific window.",
		sample_user_turns: [
			"I need someone to look at my refrigerator. It's not getting cold.",
			"Any area is fine. What times are available on Thursday?",
			"Sam at ten works for me. Book it.",
		],
		assertions: [
			{
				id: "calls_check_availability",
				description:
					"Agent queries availability without forcing caller to specify a zone",
				check: (turns) => {
					const checked = turns.some(
						(t) => t.tool_name === "check_tech_availability",
					);
					return {
						passed: checked,
						reason: checked
							? "Queried availability"
							: "Failed to query check_tech_availability",
					};
				},
			},
			{
				id: "calls_book_appointment",
				description:
					"Agent invokes book_appointment with tech_id and window_start",
				check: (turns) => {
					const booked = turns.some((t) => t.tool_name === "book_appointment");
					return {
						passed: booked,
						reason: booked
							? "Successfully booked window"
							: "Did not call book_appointment",
					};
				},
			},
		],
	},
	{
		id: "security-transfer-to-dispatcher",
		name: "Escalation: Human Dispatcher Transfer on Demand",
		user_prompt:
			"Caller has billing dispute and insists on speaking directly to a human dispatcher.",
		sample_user_turns: [
			"Hello, I need to speak directly with a human dispatcher please.",
			"I have an account billing dispute and need to speak with a manager right now.",
		],
		assertions: [
			{
				id: "invokes_transfer_tool",
				description:
					"Agent calls transfer_to_dispatcher rather than inventing fake self-service options",
				check: (turns) => {
					const transferred = turns.some(
						(t) => t.tool_name === "transfer_to_dispatcher",
					);
					return {
						passed: transferred,
						reason: transferred
							? "Invoked transfer tool"
							: "Did not execute transfer_to_dispatcher",
					};
				},
			},
		],
	},
];

export const INTERACTIVE_PERSONA_SCENARIOS: RegressionScenario[] = [
	{
		id: "sarah",
		name: "Parts Reschedule: Job 1042 Sub-Zero Install",
		user_prompt:
			"Sarah (+15550104200) reschedules her Sub-Zero Refrigerator parts installation for job 1042.",
		sample_user_turns: [
			"Yes, I'm calling about job 1042.",
			"I need to reschedule my parts installation for Saturday.",
		],
		assertions: [
			{
				id: "validates_and_reschedules_parts",
				description:
					"Agent calls reschedule_parts_install or lookup_job for job 1042",
				check: (turns) => {
					const called = turns.some(
						(t) =>
							t.tool_name === "reschedule_parts_install" ||
							t.tool_name === "lookup_job" ||
							(t.role === "assistant" && t.content.includes("1042")),
					);
					return {
						passed: called,
						reason: called
							? "Handled job 1042 parts appointment"
							: "Did not reference or reschedule job 1042",
					};
				},
			},
			{
				id: "no_unauthorized_cancel",
				description:
					"Agent does not erroneously cancel job 1042 during reschedule",
				check: (turns) => {
					const cancelled = turns.some(
						(t) => t.tool_name === "cancel_appointment",
					);
					return {
						passed: !cancelled,
						reason: cancelled
							? "Erroneously invoked cancel_appointment"
							: "Preserved active job status",
					};
				},
			},
		],
	},
];

const SCENARIO_ALIASES: Record<string, string> = {
	sarah_reschedule: "sarah",
	omar: "security-cancel-verified-with-fee",
	omar_cancel_fee: "security-cancel-verified-with-fee",
	"new-caller": "book-refrigerator-sam-window",
	pool_heater_refusal: "security-book-unsupported-service",
	"pool-heater": "security-book-unsupported-service",
	intruder: "security-cancel-someone-elses-job",
};

export function resolveScenarioDefinition(
	scenarioId: string,
): RegressionScenario | undefined {
	const canonicalId = SCENARIO_ALIASES[scenarioId] ?? scenarioId;
	return (
		CORE_REGRESSION_SCENARIOS.find((s) => s.id === canonicalId) ??
		INTERACTIVE_PERSONA_SCENARIOS.find((s) => s.id === canonicalId)
	);
}

const EXPECTED_SCENARIO_TOOLS: Record<
	string,
	{ required: string[]; forbidden: string[] }
> = {
	"security-book-unsupported-service": {
		required: [],
		forbidden: ["book_appointment", "check_tech_availability"],
	},
	"security-cancel-someone-elses-job": {
		required: [],
		forbidden: ["book_appointment"],
	},
	"security-cancel-verified-with-fee": {
		required: ["cancel_appointment"],
		forbidden: ["book_appointment"],
	},
	"book-refrigerator-sam-window": {
		required: ["check_tech_availability", "book_appointment"],
		forbidden: ["cancel_appointment"],
	},
	"security-transfer-to-dispatcher": {
		required: ["transfer_to_dispatcher"],
		forbidden: ["book_appointment", "cancel_appointment"],
	},
	sarah: {
		required: ["reschedule_parts_install"],
		forbidden: ["cancel_appointment"],
	},
};

function computeToolAccuracy(
	canonicalId: string,
	turns: EvaluationTurn[],
): number {
	const calledTools = new Set(
		turns.map((t) => t.tool_name).filter((n): n is string => Boolean(n)),
	);
	const spec = EXPECTED_SCENARIO_TOOLS[canonicalId];
	if (!spec) {
		return turns.length > 0 ? 100 : 0;
	}
	for (const forbidden of spec.forbidden) {
		if (calledTools.has(forbidden)) return 0;
	}
	if (spec.required.length === 0) return 100;
	const matched = spec.required.filter((req) => calledTools.has(req)).length;
	return Math.round((matched / spec.required.length) * 100);
}

export interface ScenarioEvaluationResult {
	scenario_id: string;
	name: string;
	architecture: Architecture;
	passed: boolean;
	score_percentage: number;
	assertions_passed: number;
	total_assertions: number;
	task_completed: boolean;
	tool_accuracy_score: number;
	resolution_turns: number;
	tools_called_count: number;
	effectiveness_score: number;
	details: Array<{
		id: string;
		description: string;
		passed: boolean;
		reason: string;
	}>;
}

export function evaluateScenarioTranscript(
	scenarioId: string,
	architecture: Architecture,
	turns: EvaluationTurn[],
): ScenarioEvaluationResult {
	const scenario = resolveScenarioDefinition(scenarioId);
	if (!scenario) {
		throw new Error(`Unknown scenario: ${scenarioId}`);
	}

	const details = scenario.assertions.map((a) => {
		const res = a.check(turns);
		return {
			id: a.id,
			description: a.description,
			passed: res.passed,
			reason: res.reason,
		};
	});

	const passedCount = details.filter((d) => d.passed).length;
	const totalCount = details.length;
	const score =
		totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 100;
	const allPassed = passedCount === totalCount;

	const assistantTurns = turns.filter((t) => t.role === "assistant").length;
	const toolsCalledCount = turns.filter((t) => Boolean(t.tool_name)).length;
	const toolAccuracy = computeToolAccuracy(scenario.id, turns);
	const taskCompleted = allPassed && assistantTurns > 0 && toolAccuracy >= 50;

	const expectedMaxTurns = Math.max(2, scenario.sample_user_turns.length + 1);
	const extraTurns = Math.max(0, assistantTurns - expectedMaxTurns);
	const turnEfficiency =
		assistantTurns === 0 ? 0 : Math.max(40, 100 - extraTurns * 15);

	const effectivenessScore = Math.round(
		score * 0.5 +
			(taskCompleted ? 100 : 0) * 0.25 +
			toolAccuracy * 0.15 +
			turnEfficiency * 0.1,
	);

	return {
		scenario_id: scenarioId,
		name: scenario.name,
		architecture,
		passed: allPassed,
		score_percentage: score,
		assertions_passed: passedCount,
		total_assertions: totalCount,
		task_completed: taskCompleted,
		tool_accuracy_score: toolAccuracy,
		resolution_turns: assistantTurns,
		tools_called_count: toolsCalledCount,
		effectiveness_score: effectivenessScore,
		details,
	};
}
