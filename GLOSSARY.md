# Glossary

### ApplianceOps

The appliance repair dispatch service and voice agent domain. Services residential kitchen and laundry appliances (refrigerators, freezers, ice makers, dishwashers, washers, dryers, ranges, ovens, cooktops).

### Triple Architectures

The three voice agent orchestration runtimes benchmarked against the identical ApplianceOps edge-cached CRM backend:
1. **Retell AI**: Managed commercial voice platform running Conversation Flow / LLM with external HTTP tool webhooks.
2. **LiveKit Agents**: Python-based WebRTC pipeline agent running Silero VAD, Deepgram STT, OpenAI GPT-6-Luna, and Cartesia TTS.
3. **Cloudflare Voice Agents**: Edge-native WebRTC and realtime audio pipeline running on Cloudflare Workers AI / Cloudflare Calls / Agents SDK.

### D1 Schedule Cache

A local Cloudflare D1 database caching technician arrival windows, parts orders, and job records to ensure mid-call tool latency remains under 100ms instead of waiting for paginated CRM API calls.

### WorkizClient Port

The abstract TypeScript interface defining CRM reads, booking, parts rescheduling, and cancellations, implemented by `MockWorkizClient` (local D1) and `RealWorkizClient` (live Workiz REST API).

### Turn Latency Breakdown

The constituent latency segments of an end-to-end voice turn:
- **VAD / EOU (End-of-Utterance)**: Time to detect speech cessation.
- **STT Latency**: Time to transcribe user audio to text.
- **LLM TTFT**: Time to First Token from the LLM.
- **Tool RTT / Header Ms**: Time to execute backend tool actions.
- **TTS TTFB**: Time to First Byte of synthesized audio stream.

### ApplianceOps Policy Engine

The authoritative business rule engine governing field dispatching invariants: service scope eligibility (residential kitchen and laundry appliances only), two-factor authentication ownership checks for appointment cancellation, late cancellation fee assessment ($85 fee inside 24 hours), and parts installation rescheduling criteria based on shipment inventory status.
