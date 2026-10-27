# Voice tuning — Accent-resilient serial capture

Machine-synced fields live in [`agent.config.json`](agent.config.json) and are applied by `npm run retell:sync` (`boosted_keywords`, `pronunciation_dictionary`, `responsiveness`, `interruption_sensitivity`).

## Voice output & lexicon

- Architecture A model stack: **Retell Endpointer · Deepgram Nova-3 · OpenAI `gpt-6-luna` · ElevenLabs Flash v2.5** (~510ms turnaround).
- The voice is selected in Retell (`voice_id` in agent.config.json, e.g. ElevenLabs Flash v2.5 voice); no third-party TTS SDK is wired directly.
- Retell's IPA `pronunciation_dictionary` covers brand names; `boosted_keywords` steers Deepgram Nova-3 STT for model/serial numbers.
- Model tokens: spell alphanumerics as letter-digit groups (e.g. `W R F 5 3 5 S W H Z 0 4`)

## Retell turn-taking

Defaults in `agent.config.json` (lower = less barge-in mid-serial):

| Setting                    | Default | Rationale                              |
| -------------------------- | ------- | -------------------------------------- |
| `responsiveness`           | `0.65`  | Wait for caller to finish model/serial |
| `interruption_sensitivity` | `0.55`  | Avoid cutting off European brand names |

Tune on a live call with `WRF535SWHZ04` spoken quickly with a non-US accent.

## STT keyterm boosting

Synced via `boosted_keywords` in agent.config.json (Miele, Gaggenau, Bosch, Sub-Zero, Whirlpool, WRF535SWHZ04, etc.).

## Demo phones (mock CRM)

| Phone          | Caller | Job                             |
| -------------- | ------ | ------------------------------- |
| `+15550104200` | Sarah  | #1042 Sub-Zero parts install    |
| `+15550108800` | Omar   | #1088 Bosch — cancels under 24h |
