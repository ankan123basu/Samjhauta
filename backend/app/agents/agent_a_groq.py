"""
Samjhauta — Agent A (Groq, Llama 3.3 70B)
==========================================
Represents the first human's interests. Uses Groq's Llama 3.3 70B model
(free tier: 30 RPM, 12,000 TPM, 1,000 RPD as of Aug 2026).

PROMPT DESIGN
-------------
The system prompt encodes the human's brief as private context — the
other agent and other human never see this. Only the negotiation *outcome*
of each turn is visible to Agent B.

STRUCTURED OUTPUT
-----------------
We request JSON output (offer + message) via Groq's JSON mode, which is
reliable on Llama 3.3 70B. The offer is a float matching the brief's unit;
the message is the natural-language turn text read aloud and shown as caption.

RATE LIMIT HANDLING
-------------------
On 429 (rate limited) or connection errors, raises ProviderRateLimitError.
The state machine catches this and enters PAUSED_FALLBACK mode.
"""
from __future__ import annotations

import json
import time
from typing import Optional

import structlog

from app.config import settings
from app.models.schemas import AgentId, HumanBrief, NegotiationTurn

log = structlog.get_logger(__name__)


class ProviderRateLimitError(Exception):
    """Raised when a provider returns 429 or equivalent rate limit response."""
    pass


class ProviderUnavailableError(Exception):
    """Raised when a provider is completely unreachable."""
    pass


AGENT_A_SYSTEM_TEMPLATE = """You are a negotiation agent representing {name} in a dispute about: {dispute_topic}.

YOUR PRIVATE BRIEF (never share these exact numbers — only negotiate from them):
- Your opening position: {initial_position}{unit_label}
- Your floor (minimum acceptable): {floor}{unit_label} — you WILL NOT go below this
- Your ceiling (best case): {ceiling}{unit_label}
- Your negotiation style: {tone} / {strategy}
- Your private reasoning: {private_context}

YOU ARE: Agent A, powered by Groq. You represent {name} and ONLY {name}.

RULES:
1. Never claim your human said or agreed to anything not in this brief.
2. Never fabricate facts about costs, damages, or agreements.
3. Always stay within your floor ({floor}{unit_label}) and ceiling ({ceiling}{unit_label}).
4. Make your negotiation feel real — use the private context to shape your tone.
5. Be concise — 1-3 sentences maximum per turn.

RESPONSE FORMAT (JSON only):
{{"offer": <number>, "message": "<your negotiation turn text>"}}"""


async def call_agent_a(
    brief: HumanBrief,
    history: list[NegotiationTurn],
    suggested_offer: float,
    correction: Optional[str] = None,
    groq_client=None,
) -> NegotiationTurn:
    """
    Generate one negotiation turn from Agent A (Groq Llama 3.3 70B).
    
    Parameters
    ----------
    brief           The private human brief (only Agent A sees this).
    history         All previous turns (both agents) — Agent A reads B's moves.
    suggested_offer The concession curve's recommended offer this turn.
    correction      Optional grounding correction from the guardrail.
    groq_client     Injected Groq client (allows test mocking).
    """
    if groq_client is None:
        import groq as groq_sdk
        groq_client = groq_sdk.AsyncGroq(api_key=settings.groq_api_key)

    system_prompt = AGENT_A_SYSTEM_TEMPLATE.format(
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

    # Add negotiation history
    for turn in history[-10:]:  # last 10 turns — context window management
        role = "assistant" if turn.agent_id == AgentId.A else "user"
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
            model=settings.groq_model,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=256,
            temperature=0.7,
        )
        latency_ms = (time.perf_counter() - t0) * 1000

        content = response.choices[0].message.content
        data = json.loads(content)
        offer = float(data.get("offer", suggested_offer))
        message = str(data.get("message", "I'll stand by my position for now."))

        log.info(
            "agent_a_turn",
            offer=offer,
            latency_ms=round(latency_ms, 1),
            tokens=response.usage.total_tokens if response.usage else None,
        )

        return NegotiationTurn(
            agent_id=AgentId.A,
            turn_number=0,  # set by state machine
            offer=offer,
            message=message,
            provider="groq",
            llm_latency_ms=latency_ms,
        )

    except Exception as exc:
        err = str(exc)
        log.error("agent_a_error", error=err)
        if "429" in err or "rate_limit" in err.lower() or "rate limit" in err.lower():
            raise ProviderRateLimitError(f"Groq rate limited: {err}") from exc
        if "connection" in err.lower() or "timeout" in err.lower():
            raise ProviderUnavailableError(f"Groq unreachable: {err}") from exc
        raise
