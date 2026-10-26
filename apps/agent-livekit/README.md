# LiveKit Agent Worker (Architecture B)

LiveKit Agents worker implementing ApplianceOps voice dispatching powered by **LiveKit Cloud Inference**:
- **STT**: `deepgram/nova-3` (via LiveKit Inference)
- **TTS**: `inworld/inworld-tts-2-flash` (via LiveKit Inference)
- **LLM**: `openai/gpt-6-luna` (via LiveKit Inference or direct OpenAI key)
- **VAD**: Silero VAD v5 (Local on-device, $0 cost)
- **Mid-call Tools**: Sub-15ms D1 schedule cache queries against Cloudflare Edge

## Setup

```bash
cd apps/agent-livekit
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
# fill LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
python agent.py dev
```

Single API key setup: LiveKit Cloud Inference automatically uses `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` for STT, TTS, and LLM without requiring separate third-party vendor accounts.

## What it measures

Subscribes to LiveKit `LLMMetrics` / `STTMetrics` / `TTSMetrics` / `EOUMetrics` (same pattern as `learning/Lesson5.ipynb`) and POSTs tool calls to the canonical REST port:

- `{EDGE_BASE_URL}/api/tools/check_tech_availability`
- `{EDGE_BASE_URL}/api/tools/reschedule_parts_install`
- `{EDGE_BASE_URL}/api/tools/cancel_appointment`
- `{EDGE_BASE_URL}/api/tools/book_appointment`
- `{EDGE_BASE_URL}/api/tools/call-inbound`

Compare unbundled STT/TTS/LLM + tool latency against Retell Stack 2 for the bakeoff table (Stack 3 TTFB/cost rows are modeled unless you record a session).
