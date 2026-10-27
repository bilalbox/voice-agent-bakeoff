import type { Env } from "../env";

export function assertAdmin(c: {
	env: Env;
	req: { header: (n: string) => string | undefined };
}): boolean {
	const token = c.env.SEED_TOKEN;
	if (!token) return true; // local/dev without SEED_TOKEN
	const provided =
		c.req.header("x-seed-token") ??
		c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
	return provided === token;
}
