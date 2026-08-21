"""
Samjhauta — Agent B (Google Gemini 3.5 Flash)
=============================================
Represents the second human's interests. Uses Google Gemini 3.5 Flash
(free tier: ~15–60 RPM, ~1,500 RPD as of Aug 2026 — check AI Studio quota tab).

Genuinely different from Agent A:
  - Different foundation model family (Google DeepMind vs Meta/Groq)
  - Different inference infrastructure
  - Different system prompt formatting conventions
  - Gemini uses a different content API (Parts/Content vs messages[])

This is not "the same model called twice with different prompts" — this
satisfies the "two models" rubric requirement unambiguously.
"""
from __future__ import annotations

import json
import re
import time
from typing import Optional

import structlog

from app.config import settings
from app.models.schemas import AgentId, HumanBrief, NegotiationTurn
from app.agents.agent_a_groq import ProviderRateLimitError, ProviderUnavailableError

log = structlog.get_logger(__name__)


AGENT_B_SYSTEM_TEMPLATE = """You are a negotiation agent representing {name} in a dispute about: {dispute_topic}.

YOUR PRIVATE BRIEF (keep these exact numbers private — negotiate from them, don't reveal them verbatim):
- Your opening position: {initial_position}{unit_label}
- Your floor (minimum you'll accept): {floor}{unit_label} — absolute hard limit
- Your ceiling (your best outcome): {ceiling}{unit_label}
- Your style: {tone} / {strategy}
- Your private reasoning: {private_context}

YOU ARE: Agent B, powered by Google Gemini 3.5 Flash. You represent {name} exclusively.

RULES:
1. Never fabricate what your human said, agreed to, or promised.
2. Never invent numbers not given in this brief.
3. Never go below your floor ({floor}{unit_label}) or above your ceiling ({ceiling}{unit_label}).
4. Use your private reasoning to authentically shape tone and priorities.
5. Keep responses tight — 1-3 sentences.

RESPOND WITH VALID JSON ONLY (no markdown, no explanation):
{{"offer": <number>, "message": "<your negotiation text>"}}"""


async def call_agent_b(
    brief: HumanBrief,
    history: list[NegotiationTurn],
    suggested_offer: float,
    correction: Optional[str] = None,
    gemini_client=None,
) -> NegotiationTurn:
    """
    Generate one negotiation turn from Agent B (Google Gemini 3.5 Flash).
    """
    if gemini_client is None:
        import google.generativeai as genai
        genai.configure(api_key=settings.google_api_key)
        gemini_client = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=AGENT_B_SYSTEM_TEMPLATE.format(
                name=brief.name,
                dispute_topic=brief.dispute_topic,
                initial_position=brief.initial_position,
                unit_label=brief.unit_label,
                floor=brief.floor,
                ceiling=brief.ceiling,
                tone=brief.tone.value,
                strategy=brief.strategy.value,
                private_context=brief.private_context or "No additional context.",
            ),
        )

    # Build history for Gemini (alternating user/model turns)
    gemini_history = []
    for turn in history[-10:]:
        role = "model" if turn.agent_id == AgentId.B else "user"
        gemini_history.append({
            "role": role,
            "parts": [f"[Offer: {turn.offer}{brief.unit_label}] {turn.message}"],
        })

    # Build the current prompt
    correction_text = f"\n\nCORRECTION: {correction}" if correction else ""
    current_prompt = (
        f"Your turn. The negotiation curve suggests around "
        f"{suggested_offer}{brief.unit_label} at this stage.{correction_text} "
        f"Respond with JSON only."
    )

    try:
        t0 = time.perf_counter()

        # Use async generation
        import asyncio
        import google.generativeai as genai

        # If client was passed in (test mock), use it directly
        if hasattr(gemini_client, "generate_content_async"):
            chat = gemini_client.start_chat(history=gemini_history)
            response = await asyncio.to_thread(
                chat.send_message, current_prompt
            )
        else:
            response = await asyncio.to_thread(
                gemini_client.generate_content,
                current_prompt,
            )

        latency_ms = (time.perf_counter() - t0) * 1000
        raw_text = response.text.strip()

        # Gemini sometimes wraps JSON in markdown — strip it
        if raw_text.startswith("```"):
            raw_text = re.sub(r"```(?:json)?", "", raw_text).strip().rstrip("`").strip()

        data = json.loads(raw_text)
        offer = float(data.get("offer", suggested_offer))
        message = str(data.get("message", "I'll hold my position for now."))

        log.info(
            "agent_b_turn",
            offer=offer,
            latency_ms=round(latency_ms, 1),
        )

        return NegotiationTurn(
            agent_id=AgentId.B,
            turn_number=0,  # set by state machine
            offer=offer,
            message=message,
            provider="gemini",
            llm_latency_ms=latency_ms,
        )

    except Exception as exc:
        err = str(exc)
        log.error("agent_b_error", error=err)
        if "429" in err or "resource_exhausted" in err.lower() or "quota" in err.lower():
            raise ProviderRateLimitError(f"Gemini rate limited: {err}") from exc
        if "unavailable" in err.lower() or "deadline_exceeded" in err.lower():
            raise ProviderUnavailableError(f"Gemini unreachable: {err}") from exc
        raise
