import type { Env } from "../env";
import { MockWorkizClient } from "./mock-client";
import { RealWorkizClient } from "./real-client";
import type { WorkizClient } from "./types";

export type CreateClientOptions = {
  /** Override mock pagination delay (ms). Use 0 for sync/admin. */
  pageDelayMs?: number;
};

export function createWorkizClient(
  env: Env,
  opts?: CreateClientOptions,
): WorkizClient {
  const mode = (env.WORKIZ_MODE ?? "mock").toLowerCase();
  if (mode === "live") {
    return RealWorkizClient.fromEnv(env);
  }
  const delay =
    opts?.pageDelayMs ??
    Number(env.MOCK_PAGE_DELAY_MS ?? "400");
  return new MockWorkizClient(env.DB, Number.isFinite(delay) ? delay : 400);
}
