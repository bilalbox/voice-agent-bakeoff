# arc.dev portfolio — first project

Copy for the **Projects** form, in the order the fields appear. Everything here is backed by
the repo (or measured from it); nothing claims production traffic.

## Project title *

```
AI Voice Dispatch Agent for Field-Service CRM — Retell AI on Cloudflare Edge
```

Shorter alternative if the field feels cramped:

```
Retell Voice Dispatch for Field-Service CRM
```

## Year *

```
2026
```

## Project link

```
https://applianceops-edge.23p.workers.dev/
```

That URL is the live Worker: the latency bakeoff page plus the `/retell/*` tool endpoints the
agent calls. If the demo is ever taken down, swap in a Loom or a public repo — do not leave a
dead link, it is the first thing a reviewer clicks.

## Technical skills used *

Ordered by relevance; drop any you would not defend in a follow-up call.

```
Retell AI, Cloudflare Workers, Cloudflare D1, Hono, TypeScript,
REST APIs, Webhooks, HMAC signature verification, LLM simulation testing,
LiveKit / WebRTC, Salesforce, MuleSoft
```

## Media

Upload `applianceops-latency-bakeoff.png` (this folder). It is a capture of the live benchmark
page with measured values: **1,276 ms** uncached CRM pagination vs **11 ms** on the D1-cached
path, plus the cost and delivery-risk matrix that drives the recommendation.

Worth adding, in this order:

1. **90-second Loom** — the repo has a shot-by-shot script (`README.md` → "Loom script"):
   live call → reschedule job 1042 → cancel 1088 with the fee prompt → cache/latency screen.
2. **Retell batch test result** — crop the Batch Testing History row (pass rate + explanation).
   Proof you gate prompt changes with tests, which almost no portfolio has.
3. **A 20-second call recording** — voice quality is the thing reviewers cannot get from a
   screenshot. Use the demo numbers, not a real customer.

Skip architecture diagrams for now; the matrix reads faster.

## Project description

The form hints "briefly describe the project's goals, your solution, and impact". Lead with
the business problem, then the three-way architecture comparison, then measured results.

```
Field-service teams lose minutes per call to paginated CRM lookups and manual job entry —
exactly when the caller is waiting for an arrival window.

I architected and benchmarked a 3-way voice dispatch engine for an appliance repair CRM across
Retell AI (managed), LiveKit Agents (open-source WebRTC / Python), and Cloudflare Durable Objects
(edge-native), governed by shared TypeScript/Python contracts (@applianceops/contracts).

A Cloudflare D1 schedule cache in front of paginated CRM REST endpoints cut mid-call lookups from
1,276 ms to 11 ms. Edge Durable Objects achieved the fastest physical turnaround at 390 ms and
$0.024/min, compared to LiveKit (475 ms at $0.061/min) and Retell AI (510 ms at $0.095/min).
Pure server-side evaluators enforce non-negotiable policies (caller 2FA verification, parts readiness,
and 24-hour $85 cancellation fees). A universal policy fidelity test runner validates 5 canonical
regression scenarios in CI, while an embedded WebRTC voice console enables live manual testing.

Impact: a live 3-way benchmark console, defensible turn waterfall telemetry (VAD, STT, LLM, Tool, TTS),
and a proven ~75% cost reduction path at scale.
```

~170 words. If the field is tighter, this concise ~75-word cut works:

```
Built and benchmarked a 3-way voice dispatch engine for a field-service CRM across Retell AI,
LiveKit, and Cloudflare Durable Objects. A D1 schedule cache cut mid-call CRM lookups from
1,276 ms to 11 ms, powering a 390 ms turnaround at $0.024/min on edge DOs (vs 510 ms at
$0.095/min on Retell). Shared contracts enforce deterministic business rules (caller 2FA,
$85 cancel fee), while an automated fidelity suite gates CI, paired with an embedded WebRTC
console for live manual testing.
```

## Before you hit Save

- **Call it a POC / benchmark**, not production. The CRM is Workiz-shaped and currently mocked
  behind a live/mock client port. Reviewers respect a stated scope boundary; they punish an
  implied one.
- **Pin the numbers.** "1,276 ms → 11 ms, same call flow, local Worker, mock CRM paging" is
  defensible. "10x faster" is not.
- **Publish the code.** The repo is not a git repo yet; a public GitHub link with the existing
  README is the strongest second link. Strip `.env`, `.dev.vars`, `.wrangler/`, `.cache/`.
- **Keep the demo phone numbers out of the title.** They are fine inside the screenshot; they
  are noise in a headline.
- **Name your role in one clause** — "designed and built" — because arc reviewers scan for
  ownership, not technology lists.

## Suggested arc.dev ordering

This is a strong first project because it is *narrow and quantified*: one call flow, three
architectures, one measured number. Pair it with a broader enterprise-integration project next
so the portfolio reads "deep on voice, wide on integration" rather than "one demo".
