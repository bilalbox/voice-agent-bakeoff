import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";

export interface Env {
  LIVEKIT_WORKER: DurableObjectNamespace<LiveKitWorkerContainer>;
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  RETELL_API_KEY?: string;
  DEMO_VOICE_TOKEN?: string;
  EDGE_BASE_URL?: string;
  LIVEKIT_STT_MODEL?: string;
  LIVEKIT_TTS_MODEL?: string;
  LIVEKIT_LLM_MODEL?: string;
}

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2-hour daemon keepalive (Cloudflare max is 6h)

export class LiveKitWorkerContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/_restart")) {
      try {
        const container = this.ctx.container!;
        if (container?.running) {
          await container.destroy();
        }
        this.starting = undefined;
        await this.startAndWaitForPort();
        return new Response(
          JSON.stringify({ ok: true, message: "Container destroyed and restarted with latest image" }),
          { headers: { "Content-Type": "application/json" } },
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message, stack: err.stack }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "standard-1",
        enableInternet: true,
        env: {
          LIVEKIT_URL: this.env.LIVEKIT_URL || "wss://demo1-fhb0ecf7.livekit.cloud",
          LIVEKIT_API_KEY: this.env.LIVEKIT_API_KEY || "",
          LIVEKIT_API_SECRET: this.env.LIVEKIT_API_SECRET || "",
          RETELL_API_KEY: this.env.RETELL_API_KEY || "key_571d3a312abde5392e8d364a1738",
          DEMO_VOICE_TOKEN: this.env.DEMO_VOICE_TOKEN || "ada-ada-aja-token-123",
          EDGE_BASE_URL: this.env.EDGE_BASE_URL || "https://applianceops-edge.23p.workers.dev",
          LIVEKIT_STT_MODEL: this.env.LIVEKIT_STT_MODEL || "deepgram/nova-3",
          LIVEKIT_TTS_MODEL: this.env.LIVEKIT_TTS_MODEL || "inworld/inworld-tts-2-flash",
          LIVEKIT_LLM_MODEL: this.env.LIVEKIT_LLM_MODEL || "openai/gpt-6-luna",
          PORT: String(PORT),
        },
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await port.fetch("http://container/", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Wait for container process and LiveKit worker server to start
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("LiveKit container worker did not become ready on port 8080");
  }

  private observeExit(): void {
    if (this.monitoring) return;
    this.monitoring = this.ctx
      .container!.monitor()
      .then(() => console.log("LiveKit worker container exited successfully"))
      .catch((error: unknown) => console.error("LiveKit worker container failed:", error))
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

const app = new Hono<{ Bindings: Env }>();

const WORKER_DO_NAME = "livekit-worker-v2";

app.get("/", async (c) => {
  try {
    const container = c.env.LIVEKIT_WORKER.getByName(WORKER_DO_NAME);
    const resp = await container.fetch(new Request("http://container/"));
    const text = await resp.text();
    return c.json({
      status: "ok",
      container: "running",
      worker_health: text,
      workload: "ApplianceOps LiveKit Agent (Cloudflare Container)",
    });
  } catch (err: any) {
    return c.json({ status: "starting_or_error", error: err.message }, 500);
  }
});

app.get("/worker", async (c) => {
  const container = c.env.LIVEKIT_WORKER.getByName(WORKER_DO_NAME);
  return container.fetch(new Request("http://container/worker"));
});

app.post("/start", async (c) => {
  const container = c.env.LIVEKIT_WORKER.getByName(WORKER_DO_NAME);
  await container.fetch(new Request("http://container/"));
  return c.json({ ok: true, message: "Container started and registered with LiveKit Cloud" });
});

app.post("/restart", async (c) => {
  try {
    const container = c.env.LIVEKIT_WORKER.getByName(WORKER_DO_NAME);
    const resp = await container.fetch(new Request("http://container/_restart", { method: "POST" }));
    const text = await resp.text();
    try {
      return c.json(JSON.parse(text));
    } catch {
      return c.text(text, resp.status as any);
    }
  } catch (err: any) {
    return c.json({ error: err.message, stack: err.stack }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const container = env.LIVEKIT_WORKER.getByName(WORKER_DO_NAME);
    ctx.waitUntil(container.fetch(new Request("http://container/")));
  },
};
