import type { Env } from "../env";
import { jobFromWorkizApi, techFromWorkizApi } from "./mappers/fromWorkizApi";
import { jobPatchToWorkizApi } from "./mappers/toWorkizApi";
import type {
	Job,
	NewJobInput,
	Page,
	PageArgs,
	Technician,
	WorkizClient,
} from "./types";

/**
 * Live Workiz REST adapter (stub for v1).
 * Complete against developer.workiz.com trial, then set WORKIZ_MODE=live.
 */
export class RealWorkizClient implements WorkizClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiToken: string,
	) {}

	static fromEnv(env: Env): RealWorkizClient {
		const baseUrl = env.WORKIZ_BASE_URL;
		const apiToken = env.WORKIZ_API_TOKEN;
		if (!baseUrl || !apiToken) {
			throw new Error(
				"WORKIZ_MODE=live requires WORKIZ_BASE_URL and WORKIZ_API_TOKEN",
			);
		}
		return new RealWorkizClient(baseUrl.replace(/\/$/, ""), apiToken);
	}

	async findJobsByPhone(_phone: string): Promise<Job[]> {
		// Workiz often lacks a dedicated phone search — paginate + filter, or use Search API when available.
		throw notImplemented("findJobsByPhone");
	}

	async getJob(_id: string): Promise<Job | null> {
		throw notImplemented("getJob");
	}

	async listJobs(page: PageArgs): Promise<Page<Job>> {
		// Expected: GET /job/all/?offset=&limit= (confirm path on trial OpenAPI)
		void page;
		void jobFromWorkizApi;
		throw notImplemented("listJobs");
	}

	async listTeam(page: PageArgs): Promise<Page<Technician>> {
		void page;
		void techFromWorkizApi;
		throw notImplemented("listTeam");
	}

	async updateJob(id: string, patch: Partial<Job>): Promise<Job> {
		void id;
		void jobPatchToWorkizApi(patch);
		throw notImplemented("updateJob");
	}

	async createJob(_input: NewJobInput): Promise<Job> {
		throw notImplemented("createJob");
	}

	/** Example authenticated fetch helper for when methods are filled in. */
	protected async workizFetch(
		path: string,
		init?: RequestInit,
	): Promise<Response> {
		return fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
		});
	}
}

function notImplemented(method: string): Error {
	return new Error(
		`RealWorkizClient.${method} is not implemented yet. Complete the adapter against the Workiz trial OpenAPI, then flip WORKIZ_MODE=live.`,
	);
}
