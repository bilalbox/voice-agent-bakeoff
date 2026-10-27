import type {
	Job,
	NewJobInput,
	Page,
	PageArgs,
	Technician,
	WorkizClient,
} from "../types";
import { jobFromWorkizApi, techFromWorkizApi } from "./mappers/fromWorkizApi";
import { jobPatchToWorkizApi } from "./mappers/toWorkizApi";

export class RealWorkizClient implements WorkizClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiToken: string,
	) {}

	static fromEnv(env: {
		WORKIZ_BASE_URL?: string;
		WORKIZ_API_TOKEN?: string;
	}): RealWorkizClient {
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
		throw new Error(
			"RealWorkizClient.findJobsByPhone not implemented in sandbox",
		);
	}

	async getJob(_id: string): Promise<Job | null> {
		throw new Error("RealWorkizClient.getJob not implemented in sandbox");
	}

	async listJobs(_page: PageArgs): Promise<Page<Job>> {
		throw new Error("RealWorkizClient.listJobs not implemented in sandbox");
	}

	async listTeam(_page: PageArgs): Promise<Page<Technician>> {
		throw new Error("RealWorkizClient.listTeam not implemented in sandbox");
	}

	async updateJob(id: string, patch: Partial<Job>): Promise<Job> {
		const res = await fetch(`${this.baseUrl}/job/update/${id}/`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(jobPatchToWorkizApi(patch)),
		});
		if (!res.ok) {
			throw new Error(
				`Workiz updateJob HTTP ${res.status}: ${await res.text()}`,
			);
		}
		const data = (await res.json()) as Record<string, unknown>;
		return jobFromWorkizApi(data);
	}

	async createJob(input: NewJobInput): Promise<Job> {
		const res = await fetch(`${this.baseUrl}/job/create/`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(input),
		});
		if (!res.ok) {
			throw new Error(
				`Workiz createJob HTTP ${res.status}: ${await res.text()}`,
			);
		}
		const data = (await res.json()) as Record<string, unknown>;
		return jobFromWorkizApi(data);
	}
}
