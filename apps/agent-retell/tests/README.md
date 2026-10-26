# Retell simulation tests — ApplianceOps

The JSON files here are **arrays** of test cases in the dashboard's Export/Import shape
(`name`, `user_prompt`, `metrics`, `dynamic_variables`, `tool_mocks`, `llm_model`) — the
response engine is implied by the agent you import into. Import them under
**Simulation → Test Cases → Import**, or push them with `npm run retell:test`, which resolves
the response engine from `RETELL_CONVERSATION_FLOW_ID` (or `--flow-id=…`).

| File | Scenario |
| --- | --- |
| `book-refrigerator-sam-window.test-case.json` | New caller misses the greeting, asks for a repeat, books Sam's 10–12 PT window for a refrigerator without naming a zone, then asks which phone number the booking is under. |

## Transcript → test case

From the 22 Oct inbound call. Metrics are graded together: one unmet criterion fails the run.

| Transcript | Encoded as |
| --- | --- |
| "Hi, thanks for calling ApplianceOps…" then "Could you repeat that…" then the greeting again | Persona behavior 1 + metric 1 (agent repeats the greeting, still names ApplianceOps) |
| "I'd like to schedule an appointment to get my refrigerator fixed." | Persona behavior 2 |
| "What area are you in?" → caller never answers → agent offers windows anyway | Persona behavior 3 ("Anywhere's fine…") + metric 5 (no zone required to book) |
| "Mike… 8 to 10 AM, or Sam from 10 AM to noon, Pacific time" | `check_tech_availability` mock + metric 2 |
| "Sam at ten…" → "Sam T. on Thursday, October 22, from 10 AM to noon… job number book-mviyuj8i" | `book_appointment` mock + metric 3 |
| "What phone number is associated with that appointment?" → "ending in 0000" | `book_appointment.phone` = `+15550000000` in the mock + metric 4 |
| "That'll be all. Thanks." → "Have a great day." | Persona behavior 8 + metric 6 (`end_call`) |

## Mocks

Both are catch-all (`input_match_rule: { "type": "any" }`), so no call can reach the
production Worker mid-test. That matters: an unmocked or partially matched tool call falls
through to the real endpoint, and `book_appointment` writes a job.

| Tool | Mocked result |
| --- | --- |
| `check_tech_availability` | Mike R. (north) 8–10 AM and Sam T. (central) 10 AM–12 PM on 22 Oct 2026, `count: 2`, `scope: "all_zones"` |
| `book_appointment` | `booked: true`, `job_id: book-mviyuj8i`, `phone: +15550000000`, `phone_assumed: true` |

Mock payload shapes copy the real handlers in `apps/edge/src/handlers/` so the agent sees
`open_windows[]`, `speak_this`, and `message` exactly as it would on a live call.

## Deliberate deviations from the literal transcript

- **"Could you repeat that, Abitis?"** — "Abitis" is STT noise, not something a text-simulated
  caller can produce. The persona asks for a repeat in clean text instead; the behavior under
  test (agent re-greets instead of derailing) is unchanged.
- **"What area / are / you in?"** — the transcript splits one sentence across several agent
  turns, which is a streaming/transcription artifact. The test treats it as one question.
- **The caller never gives a zone.** That is kept, not fixed: it is the behavior that guards the
  prompt rule "do not ask for zone when the appliance is known".
- **Wording.** The agent said "Thursday, October 22, from 8 to 10 AM"; the tool label is
  `Thu, Oct 22, 8:00 AM – 10:00 AM PT`. Metrics check the date and window, not the phrasing.
- **"ending in 0000"** is grounded in the mock (`+15550000000`, the handler's demo fallback
  phone) rather than left to the agent to invent.

## Regressions this case has caught

- **22 Oct, first run — failed criterion 3.** The agent said "I'm sorry, I can't complete the
  booking from here. Would you like me to connect you with a dispatcher?" and then called
  `book_appointment`, which booked correctly. Cause: the function nodes' talk-while-waiting was
  running in prompt mode, so the node LLM wrote the line before the tool and invented a refusal.
  Fixed by turning talk-while-waiting off for the function nodes (they are D1-fast, and the next
  conversation node speaks the result).
- **Same run — placeholder greeting.** An unknown caller heard "Hi there, are you calling about
  the `{{appliance}}` — job `{{job_id}}`?" because the Welcome node's conditional was prose.
  Fixed by pinning the unknown-caller greeting and forbidding empty placeholders; criterion 1 now
  checks for it.

## Run

```bash
npm run retell:test:dry     # print payloads, no API calls
npm run retell:test         # create or update the cases
npm run retell:test -- --run   # upsert, run a batch, print each run's grade
```

`RETELL_CONVERSATION_FLOW_ID` (or `--flow-id=<id>`) is required for anything but `--dry-run`.
Find it on the agent's Simulation tab URL, or `GET /get-agent?agent_id=…` → `response_engine.conversation_flow_id`.

A single run is one LLM judging another, so check the pass rate across a few runs before
treating a failure as a regression.
