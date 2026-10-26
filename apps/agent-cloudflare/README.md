# ApplianceOps Cloudflare Voice Agent

Edge-native voice dispatch agent running on Cloudflare Workers, Durable Objects (`agents@0.29.0`), and Workers AI.

## Architecture

- **Transport**: WebSocket / Cloudflare Realtime SFU WebRTC.
- **Durable Object**: `ApplianceOpsVoiceAgent extends withVoice(Agent)`.
- **STT**: `WorkersAIFluxSTT` (Deepgram Flux with streaming End-of-Turn detector).
- **LLM**: DeepSeek V4.1 Flash (1017) via Workers AI / Vercel AI SDK (`streamText`).
- **TTS**: `WorkersAITTS` (`@cf/deepgram/aura-2`).
- **Tool Execution**: Colocated edge queries against Cloudflare D1 (`env.DB`) via `@applianceops/contracts` schemas.
- **Turnaround Latency**: ~390ms.
