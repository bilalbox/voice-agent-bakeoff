/**
 * Retell custom function body: { name, call, args } or args-only payload.
 */
export type RetellFunctionBody = {
	name?: string;
	call?: {
		call_id?: string;
		from_number?: string;
		to_number?: string;
		direction?: string;
		[key: string]: unknown;
	};
	args?: Record<string, unknown>;
};

export function extractArgs(
	body: RetellFunctionBody | Record<string, unknown>,
): Record<string, unknown> {
	if (
		body &&
		typeof body === "object" &&
		"args" in body &&
		body.args &&
		typeof body.args === "object"
	) {
		return body.args as Record<string, unknown>;
	}
	// Payload: args only
	const { name: _n, call: _c, ...rest } = body as RetellFunctionBody;
	return rest as Record<string, unknown>;
}

export function extractFromNumber(
	body: RetellFunctionBody,
	args: Record<string, unknown>,
): string | undefined {
	const fromArgs = args.from_number ?? args.phone ?? args.caller_phone;
	if (typeof fromArgs === "string" && fromArgs) return fromArgs;
	if (body.call?.from_number) return body.call.from_number;
	return undefined;
}
