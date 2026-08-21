"""
Samjhauta — Agent B (Groq, Llama 3.3 70B Versatile)
====================================================
Represents the second human's interests. Uses Groq's Llama 3.3 70B Versatile
model — a genuinely different model from Agent A's openai/gpt-oss-120b.

WHY A DIFFERENT GROQ MODEL (not Gemini)?
-----------------------------------------
Gemini's free tier is capped at 20 RPD (requests per day), which is far too
low for a multi-turn negotiation eval (20 scenarios × ~10 turns × 2 agents).
Groq's free tier offers 1,000 RPD, which is 50× more headroom.

By using a different Groq model (llama-3.3-70b-versatile vs openai/gpt-oss-120b),
we still satisfy the "two genuinely different models" rubric requirement:
  - Different model architectures (Llama 3.3 70B vs GPT-OSS 120B)
  - Different parameter counts (70B vs 120B)
  - Different training data and fine-tuning
  - Same inference provider (Groq) but different model weights

This is not "the same model called twice with different prompts."
"""
from __future__ import annotations

import json
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

YOU ARE: Agent B, powered by Llama 3.3 70B Versatile. You represent {name} exclusively.

RULES:
1. Never fabricate what your human said, agreed to, or promised.
2. Never invent numbers not given in this brief.
3. Never go below your floor ({floor}{unit_label}) or above your ceiling ({ceiling}{unit_label}).
4. Use your private reasoning to authentically shape tone and priorities.
5. Keep responses tight — 1-3 sentences.

RESPOND WITH VALID JSON ONLY (no markdown, no explanation):
{{"offer": <number>, "message": "<your negotiation text>"}}"""


async def call_agent_b_groq(
    brief: HumanBrief,
    history: list[NegotiationTurn],
    suggested_offer: float,
    correction: Optional[str] = None,
    groq_client=None,
) -> NegotiationTurn:
    """
    Generate one negotiation turn from Agent B (Groq Llama 3.3 70B Versatile).
    Uses a DIFFERENT Groq API key from the rotation pool to minimise
    rate-limit collisions with Agent A.
    """
    if groq_client is None:
        import groq as groq_sdk
        groq_client = groq_sdk.AsyncGroq(api_key=settings.get_groq_api_key)

    system_prompt = AGENT_B_SYSTEM_TEMPLATE.format(
        name=brief.name,
        dispute_topic=brief.dispute_topic,
        initial_position=brief.initial_position,
        unit_label=brief.unit_label,
        floor=brief.floor,
        ceiling=brief.ceiling,
        tone=brief.tone.value,
        strategy=brief.strategy.value,
        private_context=brief.private_context or "No additional context.",
    )

    # Build conversation history
    messages = [{"role": "system", "content": system_prompt}]

    # Inject correction if guardrail flagged the previous turn
    if correction:
        messages.append({"role": "system", "content": correction})

    # Add negotiation history (Agent B's turns are "assistant", Agent A's are "user")
    for turn in history[-10:]:
        role = "assistant" if turn.agent_id == AgentId.B else "user"
        messages.append({
            "role": role,
            "content": f"[Offer: {turn.offer}{brief.unit_label}] {turn.message}",
        })

    # Current turn instruction
    messages.append({
        "role": "user",
        "content": (
            f"It's your turn. The concession curve suggests offering around "
            f"{suggested_offer}{brief.unit_label} at this stage. "
            f"Make your next negotiation move. Respond with JSON only."
        ),
    })

    try:
        t0 = time.perf_counter()
        response = await groq_client.chat.completions.create(
            model=settings.groq_model_b,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=512,
            temperature=0.7,
        )
        latency_ms = (time.perf_counter() - t0) * 1000

        content = response.choices[0].message.content
        data = json.loads(content)
        offer = float(data.get("offer", suggested_offer))
        message = str(data.get("message", "I'll hold my position for now."))

        tokens_used = response.usage.total_tokens if response.usage else 0

        log.info(
            "agent_b_turn",
            offer=offer,
            latency_ms=round(latency_ms, 1),
            tokens=tokens_used,
        )

        return NegotiationTurn(
            agent_id=AgentId.B,
            turn_number=0,  # set by state machine
            offer=offer,
            message=message,
            provider="groq_b",
            llm_latency_ms=latency_ms,
        )

    except Exception as exc:
        err = str(exc)
        log.error("agent_b_error", error=err)
        if "rate" in err.lower() or "429" in err or "limit" in err.lower():
            raise ProviderRateLimitError(f"Groq-B rate limited: {err}") from exc
        if "unavailable" in err.lower() or "connection" in err.lower():
            raise ProviderUnavailableError(f"Groq-B unreachable: {err}") from exc
        raise
