import type { WorkizClient } from "../types";
import { MockWorkizClient } from "./mock-client";
import { RealWorkizClient } from "./real-client";

export type CreateClientOptions = {
	pageDelayMs?: number;
};

export function createWorkizClient(
	env?: {
		DB?: D1Database;
		WORKIZ_MODE?: string;
		MOCK_PAGE_DELAY_MS?: string;
		WORKIZ_BASE_URL?: string;
		WORKIZ_API_TOKEN?: string;
	},
	opts?: CreateClientOptions,
): WorkizClient {
	const mode = (env?.WORKIZ_MODE ?? "mock").toLowerCase();
	if (mode === "live") {
		return RealWorkizClient.fromEnv(env ?? {});
	}
	const delay = opts?.pageDelayMs ?? Number(env?.MOCK_PAGE_DELAY_MS ?? "0");
	return new MockWorkizClient(env?.DB, Number.isFinite(delay) ? delay : 0);
}
