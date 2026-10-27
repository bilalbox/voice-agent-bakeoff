"""
ApplianceOps LiveKit Voice Agent Worker (Architecture B)

Full behavioral and tool parity with Retell AI agent:
- Model pipeline: Silero VAD v5 + Flux Endpointer · Deepgram Flux · OpenAI gpt-6-luna · Cartesia Sonic-3.6
- Dynamic caller ID context hydration via /retell/call-inbound
- 5 tool functions: check_tech_availability, book_appointment, reschedule_parts_install, cancel_appointment, transfer_to_dispatcher
- Strict security 2FA cancellation ownership and 24-hour $85 fee negotiation

Commands:
- `python agent.py tools` — run latency harness across all 5 edge tools
- `python agent.py dev`   — run LiveKit Agents worker connected to LiveKit server
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from typing import Any

try:
    from dotenv import load_dotenv

    # Load root .env first, then local directory .env
    root_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "../..", ".env"))
    if os.path.exists(root_env):
        load_dotenv(root_env, override=False)
    load_dotenv(override=True)
except ImportError:
    pass

# Support LIVEKIT_WS_URL as alias for LIVEKIT_URL
if os.environ.get("LIVEKIT_WS_URL") and not os.environ.get("LIVEKIT_URL"):
    os.environ["LIVEKIT_URL"] = os.environ["LIVEKIT_WS_URL"]

logger = logging.getLogger("applianceops-livekit")
logging.basicConfig(level=logging.INFO)

EDGE_BASE_URL = os.environ.get("EDGE_BASE_URL", "https://applianceops-edge.23p.workers.dev").rstrip(
    "/"
)
LIVEKIT_STT_MODEL = os.environ.get("LIVEKIT_STT_MODEL", "deepgram/nova-3")
LIVEKIT_TTS_MODEL = os.environ.get("LIVEKIT_TTS_MODEL", "inworld/inworld-tts-2-flash")
LIVEKIT_LLM_MODEL = os.environ.get("LIVEKIT_LLM_MODEL", "openai/gpt-6-luna")

TOOL_PATHS = {
    "call_inbound": "/api/tools/call-inbound",
    "check_tech_availability": "/api/tools/check_tech_availability",
    "lookup_job": "/api/tools/lookup_job",
    "book_appointment": "/api/tools/book_appointment",
    "reschedule_parts_install": "/api/tools/reschedule_parts_install",
    "cancel_appointment": "/api/tools/cancel_appointment",
    "transfer_to_dispatcher": "/api/tools/transfer_to_dispatcher",
}

SYSTEM_PROMPT_TEMPLATE = """# ApplianceOps Dispatch Agent — System Prompt

You are the phone dispatcher for **ApplianceOps**, an appliance repair company. Be warm, concise, and accurate. Never invent fees, dates, technician names, or parts status — always use tools and dynamic variables.

## Critical — Tool transitions & speech
- **Silent backend tools:** Tools run quietly and no filler is spoken. Say nothing before a tool call — no narration, refusal, apology, or transfer offer as a lead-in. The node after the tool speaks the result.
- **Pre-tool transition:** Never announce tool names, function names, parameter keys, or underscores to the caller (do not say "calling cancel_appointment" or "checking job_id {job_id}"). Transition directly to the tool without repeating technical parameters.
- **Post-tool transition:** When a tool finishes, speak the result in natural conversational English. Always read from user-facing fields like `speak_this` or `message`. Never read out raw JSON keys, status codes, or parameters aloud.

## Dynamic variables (from inbound caller lookup)
- Customer Name: {customer_name}
- Open Job Status: {open_job_status}
- Assigned Technician: {assigned_tech}
- Job ID: {job_id}
- Appliance: {appliance}
- Model/Serial: {model_serial}
- Parts Status: {parts_status}
- Known Caller: {known_caller}

## Service Scope Guardrails
ApplianceOps exclusively services major residential kitchen and laundry appliances:
- **Refrigeration:** refrigerators, freezers, ice makers
- **Dishwashers:** built-in and portable dishwashers
- **Laundry:** clothes washers and dryers
- **Cooking:** ranges, ovens, cooktops, stoves
- **Supported brands:** Bosch, Miele, Gaggenau, Sub-Zero, Whirlpool

**Unsupported services:** Pool heaters, water heaters, HVAC/furnaces, outdoor plumbing, commercial equipment, lawnmowers, small countertop appliances.
- If a caller asks for an unsupported appliance (e.g. pool heater, water heater):
  - **Decline immediately and plainly.** State clearly that pool heater repair (or the requested item) is not a service ApplianceOps offers, and that ApplianceOps only services kitchen and laundry appliances.
  - **Do NOT call `check_tech_availability`.**
  - **Do NOT offer to broaden the category** or search for general availability.
  - Offer to connect them with a human dispatcher or provide an outside referral.

## Tools (must use)
1. **check_tech_availability**: When caller asks for open arrival windows for supported appliances. If they name a supported appliance without a zone, call immediately with skill/appliance_type only — omit zone. Speak windows once from open_windows. Never invent windows.
2. **lookup_job**: When caller does not know their job ID or asks to find/check their existing appointment. Confirm their phone number on the account, then call lookup_job to retrieve their job ID, appliance, and scheduled arrival time.
3. **book_appointment**: When caller picks a technician + window. Pass tech_id and window_start exactly from open_windows. Never book an unsupported appliance.
4. **reschedule_parts_install**: When rescheduling a parts install. Requires job_id and preferred_date.
5. **cancel_appointment**: When cancelling an appointment.
   - **Two-factor ownership verification is strictly required:** A cancellation requires BOTH job_id AND account phone number (or matching caller ID). Name alone is NEVER sufficient.
   - If caller does not know their job ID, confirm their account phone number first (or call lookup_job).
   - When looking up or cancelling appointments, NEVER read aloud customer name, appliance, account phone, or appointment time until verification succeeds.
   - Fee confirmation: If the tool returns fee_applicable: true and cancelled: false, read speak_this / the $85 fee and ask for verbal yes/no confirmation. Only call again with confirmed: true after they agree.
   - If verification fails repeatedly, call transfer_to_dispatcher.
6. **transfer_to_dispatcher**: When caller requests a human dispatcher, when verification cannot be completed, or for unsupported escalation.

## Serial numbers & brands
When callers spell model/serial numbers (e.g. Whirlpool WRF535SWHZ04) or brand names (Miele, Gaggenau, Bosch, Sub-Zero), let them finish without interruption.
"""


def _make_headers() -> dict[str, str]:
    demo_token = os.getenv("DEMO_VOICE_TOKEN", "ada-ada-aja-token-123")
    return {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; ApplianceOps-LiveKit/1.0)",
        "x-demo-token": demo_token,
        "Authorization": f"Bearer {demo_token}",
    }


async def call_edge_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    path = TOOL_PATHS.get(name)
    if not path:
        return {"error": f"unknown tool {name}"}

    url = f"{EDGE_BASE_URL}{path}"
    headers = _make_headers()
    t0 = time.perf_counter()

    try:
        import aiohttp

        async with (
            aiohttp.ClientSession() as session,
            session.post(url, json=args, headers=headers) as resp,
        ):
            text = await resp.text()
            rtt_ms = round((time.perf_counter() - t0) * 1000)
            header_ms = resp.headers.get("X-Tool-Latency-Ms")
            try:
                body = json.loads(text)
            except json.JSONDecodeError:
                body = {"raw": text}
            return {
                "status": resp.status,
                "x_tool_latency_ms": header_ms,
                "rtt_ms": rtt_ms,
                "body": body,
            }
    except ImportError:
        import urllib.error
        import urllib.request

        payload_bytes = json.dumps(args).encode("utf-8")

        def _sync_post():
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return (
                        resp.status,
                        resp.headers.get("X-Tool-Latency-Ms"),
                        resp.read().decode("utf-8"),
                    )
            except urllib.error.HTTPError as err:
                return err.code, err.headers.get("X-Tool-Latency-Ms"), err.read().decode("utf-8")
            except Exception as err:
                return 500, None, json.dumps({"error": str(err)})

        status, header_ms, text = await asyncio.to_thread(_sync_post)
        rtt_ms = round((time.perf_counter() - t0) * 1000)
        try:
            body = json.loads(text)
        except json.JSONDecodeError:
            body = {"raw": text}
        return {
            "status": status,
            "x_tool_latency_ms": header_ms,
            "rtt_ms": rtt_ms,
            "body": body,
        }


async def fetch_caller_context(phone: str) -> dict[str, Any]:
    """Hydrate caller identity and open jobs via REST tool port /api/tools/call-inbound."""
    empty_vars = {
        "customer_name": "there",
        "open_job_status": "none",
        "assigned_tech": "",
        "job_id": "",
        "appliance": "",
        "model_serial": "",
        "parts_status": "",
        "known_caller": "false",
    }
    if not phone:
        return empty_vars

    url = f"{EDGE_BASE_URL}{TOOL_PATHS['call_inbound']}"
    payload_dict = {"phone": phone, "from_number": phone}
    headers = _make_headers()

    def _extract_vars(data: dict[str, Any]) -> dict[str, Any]:
        return {
            "customer_name": str(data.get("customer_name") or "there"),
            "open_job_status": str(data.get("open_job_status") or "none"),
            "assigned_tech": str(data.get("assigned_tech") or ""),
            "job_id": str(data.get("job_id") or ""),
            "appliance": str(data.get("appliance") or ""),
            "model_serial": str(data.get("model_serial") or ""),
            "parts_status": str(data.get("parts_status") or ""),
            "known_caller": str(data.get("known_caller") or "false"),
        }

    try:
        import aiohttp

        async with (
            aiohttp.ClientSession() as session,
            session.post(
                url,
                json=payload_dict,
                headers=headers,
            ) as resp,
        ):
            if resp.status == 200:
                data = await resp.json()
                return _extract_vars(data)
    except ImportError:
        import urllib.error
        import urllib.request

        payload_bytes = json.dumps(payload_dict).encode("utf-8")

        def _sync_fetch():
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status == 200:
                        return _extract_vars(json.loads(resp.read().decode("utf-8")))
            except Exception as err:
                logger.warning("Caller lookup failed: %s", err)
            return empty_vars

        return await asyncio.to_thread(_sync_fetch)
    except Exception as exc:
        logger.warning("Failed to hydrate caller context from %s: %s", url, exc)

    return empty_vars


async def run_tools_harness() -> None:
    """Validate all 5 mid-call tools and caller hydration against the shared edge backend."""
    print(f"Running ApplianceOps LiveKit Tools Harness against {EDGE_BASE_URL}...\n")

    # 1. Caller Inbound Hydration (Sarah)
    print("--- 1. Caller Inbound Hydration (+15550104200) ---")
    sarah_context = await fetch_caller_context("+15550104200")
    print(json.dumps(sarah_context, indent=2))

    # 2. Check Tech Availability
    print("\n--- 2. check_tech_availability (refrigeration) ---")
    res1 = await call_edge_tool(
        "check_tech_availability", {"skill": "refrigeration", "zone": "north"}
    )
    print(json.dumps(res1, indent=2))

    # 3. Lookup Job by phone (Omar: +15550108800)
    print("\n--- 3. lookup_job (+15550108800) ---")
    res_lookup = await call_edge_tool("lookup_job", {"phone": "+15550108800"})
    print(json.dumps(res_lookup, indent=2))

    # 4. Reschedule Parts Install
    print("\n--- 4. reschedule_parts_install (job 1042) ---")
    res2 = await call_edge_tool(
        "reschedule_parts_install",
        {"job_id": "1042", "preferred_date": "2026-10-25T14:00:00.000Z"},
    )
    print(json.dumps(res2, indent=2))

    # 5. Cancel Appointment (<24h fee unconfirmed)
    print("\n--- 5. cancel_appointment (job 1088, confirmed=False) ---")
    res3 = await call_edge_tool(
        "cancel_appointment",
        {"job_id": "1088", "phone": "+15550108800", "confirmed": False},
    )
    print(json.dumps(res3, indent=2))

    # 6. Book Appointment
    print("\n--- 6. book_appointment (from available open window) ---")
    windows = res1.get("body", {}).get("open_windows", [])
    first_window = windows[0] if windows else {}
    target_tech = first_window.get("tech_id", "tech-mike")
    target_window = first_window.get("arrival_window_start", "2026-10-23T15:00:00.000Z")
    res4 = await call_edge_tool(
        "book_appointment",
        {
            "tech_id": target_tech,
            "window_start": target_window,
            "appliance": "Refrigerator",
            "phone": "+15550104200",
            "customer_name": "Sarah",
        },
    )
    print(json.dumps(res4, indent=2))

    # 7. Transfer to Dispatcher
    print("\n--- 7. transfer_to_dispatcher ---")
    res5 = await call_edge_tool(
        "transfer_to_dispatcher",
        {"reason": "Caller requested human supervisor for billing issue"},
    )
    print(json.dumps(res5, indent=2))


try:
    from livekit.agents import (
        AutoSubscribe,
        WorkerOptions,
        cli,
        function_tool,
        inference,
    )
    from livekit.agents.voice import Agent as VoiceAgent
    from livekit.agents.voice import AgentSession
    from livekit.plugins import openai, silero

    HAS_LIVEKIT = True
except ImportError:
    HAS_LIVEKIT = False
    AutoSubscribe: Any = None
    WorkerOptions: Any = None
    cli: Any = None
    inference: Any = None
    VoiceAgent: Any = None
    AgentSession: Any = None
    openai: Any = None
    silero: Any = None

    def function_tool(*args: Any, **_kwargs: Any) -> Any:  # type: ignore[no-redef]
        def decorator(fn: Any) -> Any:
            return fn

        return decorator


def build_tools_v1(caller_phone: str, on_tool_event=None):
    async def _notify_tool(name: str, res: dict[str, Any]) -> None:
        if on_tool_event:
            try:
                lat = int(res.get("x_tool_latency_ms") or res.get("rtt_ms") or 15)
                await on_tool_event(name, lat)
            except Exception as e:
                logger.debug("Error notifying tool event: %s", e)

    @function_tool(
        description=(
            "Return open 2-hour technician arrival windows for supported appliances "
            "(refrigeration, dishwasher, laundry, cooking, Bosch, Miele, Gaggenau, Sub-Zero). "
            "Do NOT call for unsupported services like pool heaters or water heaters. "
            "Zone is OPTIONAL — omit it to search all service areas."
        )
    )
    async def check_tech_availability(
        zone: str = "",
        skill: str = "",
        appliance_type: str = "",
        preferred_date: str = "",
    ) -> str:
        args = {
            k: v
            for k, v in {
                "zone": zone or None,
                "skill": skill or appliance_type or None,
                "appliance_type": appliance_type or skill or None,
                "preferred_date": preferred_date or None,
            }.items()
            if v
        }
        res = await call_edge_tool("check_tech_availability", args)
        await _notify_tool("check_tech_availability", res)
        return json.dumps(res.get("body", res))

    @function_tool(
        description=(
            "Look up an appointment / job ID when the caller does not know their job ID. "
            "Call this with the caller's confirmed account phone number (e.g. +15550108800) "
            "or name to find their job ID, appliance, and scheduled arrival window."
        )
    )
    async def lookup_job(
        phone: str = "",
        customer_name: str = "",
        job_id: str = "",
    ) -> str:
        args = {
            "phone": phone or caller_phone or None,
            "customer_name": customer_name or None,
            "job_id": job_id or None,
        }
        res = await call_edge_tool("lookup_job", {k: v for k, v in args.items() if v})
        await _notify_tool("lookup_job", res)
        return json.dumps(res.get("body", res))

    @function_tool(
        description=(
            "Book an appointment for a supported appliance in an open arrival window. "
            "Requires tech_id and window_start matching open arrival windows."
        )
    )
    async def book_appointment(
        window_start: str,
        tech_id: str = "",
        technician: str = "",
        appliance: str = "",
        appliance_type: str = "",
        phone: str = "",
        customer_name: str = "",
        model_serial: str = "",
    ) -> str:
        args = {
            "window_start": window_start,
            "tech_id": tech_id or None,
            "technician": technician or None,
            "appliance": appliance or appliance_type or None,
            "phone": phone or caller_phone or None,
            "customer_name": customer_name or None,
            "model_serial": model_serial or None,
        }
        res = await call_edge_tool("book_appointment", {k: v for k, v in args.items() if v})
        await _notify_tool("book_appointment", res)
        return json.dumps(res.get("body", res))

    @function_tool(
        description="Reschedule a parts installation after validating parts status in the CRM."
    )
    async def reschedule_parts_install(job_id: str, preferred_date: str) -> str:
        res = await call_edge_tool(
            "reschedule_parts_install",
            {"job_id": job_id, "preferred_date": preferred_date},
        )
        await _notify_tool("reschedule_parts_install", res)
        return json.dumps(res.get("body", res))

    @function_tool(
        description=(
            "Cancel an appointment with verified caller ownership. "
            "Accepts job_id and/or account phone number. If job_id is unknown, provide the account phone number. "
            "Enforces $85 24h fee — if fee_applicable and not yet confirmed, read speak_this, "
            "get verbal confirmation, then call again with confirmed=true."
        )
    )
    async def cancel_appointment(
        job_id: str = "",
        phone: str = "",
        customer_name: str = "",
        confirmed: bool = False,
    ) -> str:
        args = {
            "job_id": job_id or None,
            "phone": phone or caller_phone or None,
            "customer_name": customer_name or None,
            "confirmed": confirmed,
        }
        res = await call_edge_tool(
            "cancel_appointment", {k: v for k, v in args.items() if v is not None}
        )
        await _notify_tool("cancel_appointment", res)
        return json.dumps(res.get("body", res))

    @function_tool(
        description="Transfer the caller to a human dispatcher queue for complex inquiries or failed verification."
    )
    async def transfer_to_dispatcher(reason: str = "Caller requested dispatcher") -> str:
        res = await call_edge_tool("transfer_to_dispatcher", {"reason": reason})
        await _notify_tool("transfer_to_dispatcher", res)
        return json.dumps(res.get("body", res))

    return [
        check_tech_availability,
        lookup_job,
        book_appointment,
        reschedule_parts_install,
        cancel_appointment,
        transfer_to_dispatcher,
    ]


def _extract_caller_phone(ctx: Any, participant: Any) -> str:
    if ctx.room and ctx.room.metadata:
        try:
            meta = json.loads(ctx.room.metadata)
            phone = meta.get("caller_phone") or meta.get("from_number", "")
            if phone:
                return phone
        except Exception:
            return ctx.room.metadata

    if getattr(participant, "metadata", None):
        try:
            meta = json.loads(participant.metadata)
            phone = meta.get("caller_phone") or meta.get("from_number", "")
            if phone:
                return phone
        except Exception:
            pass

    if ctx.room:
        for p in ctx.room.remote_participants.values():
            if getattr(p, "metadata", None):
                try:
                    meta = json.loads(p.metadata)
                    phone = meta.get("caller_phone") or meta.get("from_number", "")
                    if phone:
                        return phone
                except Exception:
                    pass
    return ""


def _resolve_providers():
    logger.info(
        "Configuring LiveKit Cloud Inference: STT=%s, TTS=%s, LLM=%s",
        LIVEKIT_STT_MODEL,
        LIVEKIT_TTS_MODEL,
        LIVEKIT_LLM_MODEL,
    )
    try:
        stt_provider = inference.STT(model=LIVEKIT_STT_MODEL)
        tts_provider = inference.TTS(model=LIVEKIT_TTS_MODEL)
        deepseek_key = os.getenv("DEEPSEEK_API_KEY")
        openai_key = os.getenv("OPENAI_API_KEY")
        if deepseek_key and (LIVEKIT_LLM_MODEL.startswith("deepseek") or not openai_key):
            logger.info("Using direct DeepSeek API for LLM: deepseek-chat")
            llm_provider = openai.LLM.with_deepseek(
                model="deepseek-chat",
                api_key=deepseek_key,
            )
        elif openai_key and not LIVEKIT_LLM_MODEL.startswith("deepseek"):
            clean_model = LIVEKIT_LLM_MODEL.replace("openai/", "")
            logger.info("Using OpenAI direct provider: model=%s", clean_model)
            llm_provider = openai.LLM(model=clean_model)
        else:
            logger.info("Using LiveKit Cloud Inference LLM: %s", LIVEKIT_LLM_MODEL)
            llm_provider = inference.LLM(model=LIVEKIT_LLM_MODEL)
        return stt_provider, tts_provider, llm_provider
    except Exception as exc:
        logger.warning("Cloud inference initialization fallback: %s", exc)
        return openai.STT(), openai.TTS(), openai.LLM(model=LIVEKIT_LLM_MODEL)


def _build_greeting(vars_ctx: dict[str, Any]) -> str:
    if vars_ctx.get("known_caller") == "true" and vars_ctx.get("job_id"):
        name = vars_ctx.get("customer_name", "")
        appliance = vars_ctx.get("appliance", "appliance")
        job_id = vars_ctx.get("job_id", "")
        return f"Hi {name}, are you calling about the {appliance} — job {job_id}?"
    return "Thanks for calling ApplianceOps. How can I help you today?"


def _extract_item_text(item: Any) -> str:
    text = (
        getattr(item, "text_content", None)
        or getattr(item, "raw_text_content", None)
        or getattr(item, "text", "")
        or ""
    )
    if not text and hasattr(item, "content") and isinstance(item.content, list):
        text = " ".join([c if isinstance(c, str) else getattr(c, "text", "") for c in item.content])
    return text.strip()


async def entrypoint(ctx: Any) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()

    caller_phone = _extract_caller_phone(ctx, participant)
    vars_ctx = await fetch_caller_context(caller_phone)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        customer_name=vars_ctx.get("customer_name", "there"),
        open_job_status=vars_ctx.get("open_job_status", "none"),
        assigned_tech=vars_ctx.get("assigned_tech", ""),
        job_id=vars_ctx.get("job_id", ""),
        appliance=vars_ctx.get("appliance", ""),
        model_serial=vars_ctx.get("model_serial", ""),
        parts_status=vars_ctx.get("parts_status", ""),
        known_caller=vars_ctx.get("known_caller", "false"),
    )

    stt_provider, tts_provider, llm_provider = _resolve_providers()
    greeting = _build_greeting(vars_ctx)

    last_tool_call: dict[str, Any] | None = None

    async def _handle_tool_event(tool_name: str, latency_ms: int) -> None:
        nonlocal last_tool_call
        last_tool_call = {"name": tool_name, "latency_ms": latency_ms}
        try:
            if ctx.room and ctx.room.local_participant:
                await ctx.room.local_participant.publish_data(
                    json.dumps(
                        {
                            "type": "tool",
                            "name": tool_name,
                            "latency_ms": latency_ms,
                            "status": "executed",
                        }
                    ).encode("utf-8")
                )
        except Exception as err:
            logger.debug("Failed to publish tool event: %s", err)

    tools = build_tools_v1(caller_phone, on_tool_event=_handle_tool_event)
    agent = VoiceAgent(instructions=system_prompt, tools=tools)
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=stt_provider,
        llm=llm_provider,
        tts=tts_provider,
    )

    @session.on("user_input_transcribed")
    def _on_user_input(ev: Any) -> None:
        transcript = getattr(ev, "transcript", "") or ""
        is_final = getattr(ev, "is_final", True)
        logger.info("livekit_user_input: %s (final=%s)", transcript, is_final)
        if transcript and is_final and ctx.room and ctx.room.local_participant:
            asyncio.create_task(
                ctx.room.local_participant.publish_data(
                    json.dumps(
                        {
                            "type": "turn",
                            "role": "user",
                            "text": transcript.strip(),
                        }
                    ).encode("utf-8")
                )
            )

    @session.on("conversation_item_added")
    def _on_item(ev: Any) -> None:
        nonlocal last_tool_call
        try:
            item = getattr(ev, "item", None)
            if item and getattr(item, "role", "") == "assistant":
                text = _extract_item_text(item)
                if text and ctx.room and ctx.room.local_participant:
                    payload: dict[str, Any] = {
                        "type": "turn",
                        "role": "assistant",
                        "text": text,
                    }
                    if last_tool_call:
                        payload["tool"] = last_tool_call
                        last_tool_call = None
                    asyncio.create_task(
                        ctx.room.local_participant.publish_data(json.dumps(payload).encode("utf-8"))
                    )
        except Exception as err:
            logger.debug("Failed to publish turn data: %s", err)

    await session.start(agent, room=ctx.room)

    # Publish opening greeting to room data channel for benchmark transcript UI
    try:
        if ctx.room and ctx.room.local_participant:
            await ctx.room.local_participant.publish_data(
                json.dumps(
                    {
                        "type": "turn",
                        "role": "assistant",
                        "text": greeting,
                    }
                ).encode("utf-8")
            )
    except Exception as err:
        logger.debug("Failed to publish opening greeting: %s", err)

    await session.say(greeting, allow_interruptions=True)


def run_livekit_worker() -> None:
    """Start LiveKit Agents worker with Silero VAD v5 + Flux Endpointer, Deepgram Flux, gpt-6-luna, and Cartesia Sonic-3.6."""
    if not HAS_LIVEKIT:
        raise SystemExit(
            "LiveKit packages missing.\n"
            "Run: pip install -r requirements.txt\n"
            "Or test via: python agent.py tools"
        )
    port = int(os.environ.get("PORT", "8080"))
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, port=port, host="0.0.0.0"))


def main() -> None:
    parser = argparse.ArgumentParser(description="ApplianceOps LiveKit Voice Agent Worker")
    parser.add_argument(
        "command",
        nargs="?",
        default="tools",
        choices=["tools", "dev", "start", "download-files"],
        help="tools = test all 5 edge tools; dev/start = LiveKit worker",
    )
    args, passthrough = parser.parse_known_args()

    if args.command == "tools":
        asyncio.run(run_tools_harness())
        return

    if args.command == "download-files":
        from livekit.plugins import silero

        print("Downloading Silero VAD weights...")
        silero.VAD.load()
        print("Silero VAD weights ready.")
        return

    import sys

    sys.argv = [sys.argv[0], args.command, *passthrough]
    run_livekit_worker()


if __name__ == "__main__":
    main()
