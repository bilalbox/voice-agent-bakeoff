# ApplianceOps Voice Engine & Latency Benchmark

Retell AI dispatch POC for appliance repair: **mock Workiz behind a swappable `WorkizClient` port**, D1 schedule cache for sub-100ms mid-call tools, and a Stack 1 vs Stack 2 vs Stack 3 bakeoff page.

## Quick start (local)

```bash
npm install
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
# edit .dev.vars — set RETELL_VERIFY=false for curl without signatures

npm run db:migrate:local -w apps/edge
npm run dev -w apps/edge
```

In another terminal, seed + sync the mock CRM (or use the admin route):

```bash
curl -X POST http://127.0.0.1:8787/admin/seed -H "x-seed-token: dev-seed-token"
```

Open the bakeoff page (served as Worker assets): [http://127.0.0.1:8787/](http://127.0.0.1:8787/)

### Demo phones

| Phone          | Caller | Scenario                                                |
| -------------- | ------ | ------------------------------------------------------- |
| `+15550104200` | Sarah  | Job **1042** — Sub-Zero parts in stock → reschedule     |
| `+15550108800` | Omar   | Job **1088** — Bosch visit in ~14h → **$85** cancel fee |

## Architecture

```
Retell custom functions → /retell/* → ScheduleService / PolicyService
                                      → D1 cache (mid-call reads)
                                      → WorkizClient (writes + sync)

WORKIZ_MODE=mock  → MockWorkizClient (D1 source tables)
WORKIZ_MODE=live  → RealWorkizClient (stub in v1 — fill against trial)
```

| Path                              | Role                                |
| --------------------------------- | ----------------------------------- |
| `POST /retell/call-inbound`       | Dynamic variables for known callers |
| `POST /retell/check-availability` | Cached slots + `X-Tool-Latency-Ms`  |
| `POST /retell/reschedule-parts`   | Parts status rules + write-through  |
| `POST /retell/cancel-job`         | Deterministic &lt;24h fee           |
| `POST /slow/check-availability`   | Stack 1: paginated uncached CRM     |
| `GET /mock-workiz/job/all`        | Workiz-shaped pagination façade     |
| `POST /admin/seed`                | Mock CRM seed (mock mode only)      |
| `POST /admin/sync`                | `syncFromWorkiz` → D1 cache         |

Retell configs live in [`apps/agent-retell/`](apps/agent-retell/) (`agent-prompt.md`, `custom-functions.json`, `agent.config.json`, `pronunciation-notes.md`, `tests/`).

### Export Conversation Flow import JSON (UI)

Preferred for Retell’s **Import** button. Builds a full Conversation Flow agent file from `apps/agent-retell/` primitives:

```bash
npm run retell:export
# → apps/agent-retell/ApplianceOps Conversation Flow.import.json
```

Wiring matches the Retell UI pattern that actually invokes tools:

- Custom tools in `conversationFlow.tools` (with `tool_id`)
- Intent nodes as `type: "function"` + `tool_id` + `wait_for_result: true` (not conversation nodes that “hope” the LLM calls a tool)
- Welcome conversation node edges into those function nodes

Then in Retell: **Agents → Import** that file. Still set the phone number’s **Inbound webhook** to `https://applianceops-edge.23p.workers.dev/retell/call-inbound` (not part of the agent JSON).

### Sync agent via API (Retell LLM agents)

Alternative path for single/multi-prompt (non–Conversation Flow) agents via API — IDs in `apps/agent-retell/.sync-state.json`:

```bash
cp .env.example .env   # set RETELL_API_KEY
# set voice_id in apps/agent-retell/agent.config.json
npm run retell:sync:dry
npm run retell:sync
```

### Simulation tests

Regression cases for Retell’s LLM simulation testing live in [`apps/agent-retell/tests/`](apps/agent-retell/tests/) — each JSON is an array of test cases in the dashboard’s Import/Export shape, with a simulated-caller prompt, graded metrics, dynamic variables, and tool mocks:

```bash
npm run retell:test:dry        # print payloads only
npm run retell:test            # create or update the cases
npm run retell:test -- --run   # upsert + run a batch, print pass/fail and explanations
```

Set `RETELL_CONVERSATION_FLOW_ID` (or pass `--flow-id=…`) for anything but `--dry-run`. See [`apps/agent-retell/tests/README.md`](apps/agent-retell/tests/README.md) for the transcript each case is derived from and why the mocks are catch-all.

## Go-live: swap mock → Workiz trial

1. Implement methods in [`apps/edge/src/workiz/real-client.ts`](apps/edge/src/workiz/real-client.ts) using mappers in `workiz/mappers/`.
2. Set secrets: `WORKIZ_API_TOKEN`, `WORKIZ_BASE_URL`, `WORKIZ_MODE=live`, `RETELL_API_KEY`, `SEED_TOKEN`.
3. `POST /admin/sync` to fill D1 from live pagination.
4. Retell tool URLs stay on `/retell/*` — no agent rewrite.
5. Keep `/slow/*` for the bakeoff contrast narrative.

Handlers must **not** import mock/real clients — only `WorkizClient` / `ScheduleService`.

## Env

| Var                                    | Purpose                                          |
| -------------------------------------- | ------------------------------------------------ |
| `RETELL_API_KEY`                       | `X-Retell-Signature` verify                      |
| `RETELL_VERIFY`                        | `false` skips verify when key unset / local curl |
| `WORKIZ_MODE`                          | `mock` (default) \| `live`                       |
| `WORKIZ_API_TOKEN` / `WORKIZ_BASE_URL` | Live only                                        |
| `SEED_TOKEN`                           | Protect `/admin/*`                               |
| `MOCK_PAGE_DELAY_MS`                   | Artificial pagination delay (Stack 1)            |

## Triple Architectures

1. **Architecture A (Retell AI Managed)**: Managed telephony + LLM flow in [`apps/agent-retell/`](apps/agent-retell/) (Retell Endpointer · Deepgram Nova-3 · OpenAI `gpt-6-luna` · ElevenLabs Flash v2.5 · ~510ms).
2. **Architecture B (LiveKit Agents)**: LiveKit Cloud Inference Python worker in [`apps/agent-livekit/`](apps/agent-livekit/) (Silero VAD v5 · Deepgram Nova-3 · OpenAI `gpt-6-luna` · Inworld TTS-2 Flash · ~475ms · ~$0.0610/min).
3. **Architecture C (Cloudflare Voice Agents)**: Edge-native Durable Objects voice agent in [`apps/agent-cloudflare/`](apps/agent-cloudflare/) (Deepgram Flux · DeepSeek V4.1 Flash 1017 · Aura-2 · Colocated D1 · ~390ms).

```bash
cd apps/agent-livekit
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# with edge running:
python agent.py tools
```

See [`apps/agent-livekit/README.md`](apps/agent-livekit/README.md).

## Cynthia email (Hour 1)

**Subject:** Arc Exclusive: AI Integration Engineer (Retell AI + Workiz CRM) — [Your Name]

> Hi Cynthia,
>
> I just applied for the AI Integration Engineer role and wanted to reach out directly.
>
> Having architected enterprise CRM integrations (Salesforce Data 360 / MuleSoft) and real-time voice/AI pipelines on Cloudflare's edge and WebRTC SFU infrastructure, I noticed a critical bottleneck in the Retell AI + Workiz setup described in the post:
>
> Because Workiz's REST API relies on paginated job/team queries without a native free/busy calculation endpoint, wiring Retell AI mid-call webhooks through standard middleware adds 2–4 seconds of dead air right when the caller asks to check technician availability or reschedule a parts install. That delay swamps any latency tuning elsewhere in the stack.
>
> I'm putting together a quick live demo and latency benchmark specifically for this Appliance Repair Retell + Workiz flow (handling 24-hour cancellation enforcement, parts-status validation, and sub-100ms schedule lookups). Happy to share the walkthrough link with you and the client today—let me know the best way to get this in front of your team.

## Loom script (≤120s)

1. **0:00–0:35** — Live Retell call: accent/fast cadence → reschedule parts (#1042) → cancel (#1088) → fee confirmation.
2. **0:35–1:15** — Show job cache update + inbound vars + `X-Tool-Latency-Ms` vs `/slow` path on the bakeoff page.
3. **1:15–2:00** — Bakeoff table: recommend Stack 2 for 4 weeks; Stack 3 as scale/cost path.

## Deploy

To deploy **all apps** (the edge backend + benchmark UI and all three voice agents) in one shot:

```bash
pnpm deploy
```

This runs:
1. `apps/edge` — Cloudflare Worker API & benchmark UI assets (`pnpm run edge:deploy`)
2. `apps/agent-cloudflare` — Cloudflare Edge Native DO Voice Agent (`pnpm run cloudflare:deploy`)
3. `apps/agent-livekit` — LiveKit Container Voice Agent (`pnpm run livekit:deploy`)
4. `apps/agent-retell` — Retell AI Voice Agent config & LLM sync (`pnpm run retell:deploy`)

### Individual deployments

You can also deploy any individual app:

```bash
pnpm run edge:deploy               # edge worker & benchmark page assets
pnpm run cloudflare:deploy         # Cloudflare DO voice agent
pnpm run livekit:deploy            # LiveKit worker container
pnpm run retell:deploy             # sync Retell LLM + agent configs
```

### First-time remote setup

```bash
# Create D1 once, paste database_id into apps/edge/wrangler.jsonc
npx wrangler d1 create applianceops
npm run db:migrate:remote -w apps/edge
npx wrangler secret put RETELL_API_KEY -c apps/edge/wrangler.jsonc
npx wrangler secret put SEED_TOKEN -c apps/edge/wrangler.jsonc
pnpm deploy
# then POST https://<host>/admin/seed with x-seed-token
```

**Live Worker:** [https://applianceops-edge.23p.workers.dev](https://applianceops-edge.23p.workers.dev)

Retell tool URLs are already set in [`retell/custom-functions.json`](retell/custom-functions.json).

## Learning notebooks

Course notebooks moved to [`learning/`](learning/) (LiveKit Lessons 4–5).
