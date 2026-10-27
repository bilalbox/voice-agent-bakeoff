import { type ApplianceOpsEnv, ApplianceOpsVoiceAgent } from "./agent.js";

export { ApplianceOpsVoiceAgent };

export default {
	async fetch(
		request: Request,
		env: ApplianceOpsEnv,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Route voice agent requests and simulate-turn requests directly to Durable Object
		if (
			url.pathname.startsWith("/agents/voice/") ||
			url.pathname.endsWith("/simulate-turn") ||
			url.pathname === "/simulate-turn"
		) {
			if (!env.ApplianceOpsVoiceAgent) {
				return new Response(
					"ApplianceOpsVoiceAgent DO binding not configured",
					{ status: 500 },
				);
			}
			const id = env.ApplianceOpsVoiceAgent.idFromName("default");
			const stub = env.ApplianceOpsVoiceAgent.get(id);
			return stub.fetch(request);
		}

		return new Response("ApplianceOps Cloudflare Voice Agent Gateway", {
			status: 200,
			headers: { "Content-Type": "text/plain" },
		});
	},
};
