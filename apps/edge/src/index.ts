import { Hono } from "hono";
import type { Env } from "./env";
import { adminRoutes } from "./routes/admin";
import { benchmarkRoutes } from "./routes/benchmark";
import { mockWorkizRoutes } from "./routes/mock-workiz";
import { retellRoutes } from "./routes/retell";
import { slowRoutes } from "./routes/slow";
import { voiceRoutes } from "./routes/voice";
import { toolRoutes } from "./routes/tools";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "applianceops-edge",
    workiz_mode: c.env.WORKIZ_MODE ?? "mock",
  }),
);

app.route("/retell", retellRoutes);
app.route("/slow", slowRoutes);
app.route("/mock-workiz", mockWorkizRoutes);
app.route("/admin", adminRoutes);
app.route("/benchmark", benchmarkRoutes);
app.route("/api/voice", voiceRoutes);
app.route("/api/tools", toolRoutes);

app.get("/api/benchmark-meta", (c) =>
  c.json({
    stacks: {
      stack1: {
        path: "/slow/check-availability",
        note: "Uncached paginated WorkizClient (mock delay)",
      },
      stack2: {
        path: "/retell/check-availability",
        note: "D1 schedule cache + write-through WorkizClient",
      },
      stack3: {
        path: "apps/livekit-slice",
        note: "Thin LiveKit Agents slice calling same tool URLs",
      },
    },
  }),
);

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const isApi =
      url.pathname.startsWith("/retell") ||
      url.pathname.startsWith("/slow") ||
      url.pathname.startsWith("/mock-workiz") ||
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/health") ||
      url.pathname.startsWith("/benchmark") ||
      url.pathname.startsWith("/api/");

    if (isApi) {
      return app.fetch(request, env, ctx);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return app.fetch(request, env, ctx);
  },
};
