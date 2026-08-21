"""
Samjhauta — Provider Fallback
==============================
Creates mock agent callables for both agents that can be used when the
real providers are unavailable, or injected in tests.

The mock agents use the concession curve directly (deterministic, no LLM call)
and produce terse but realistic-sounding messages. They are visibly labeled
"[FALLBACK]" in their output so there's no confusion about their provenance.
"""
from __future__ import annotations

from typing import Optional

from app.models.schemas import AgentId, HumanBrief, NegotiationTurn


def make_mock_agent(agent_id: AgentId, strategy_name: str = "boulware"):
    """
    Returns an async callable that produces mock turns using only the
    concession curve — no LLM call, no network, no API key needed.
    Suitable for tests and the text-only fallback mode.
    """
    async def mock_agent(
        brief: HumanBrief,
        history: list[NegotiationTurn],
        suggested_offer: float,
        correction: Optional[str] = None,
    ) -> NegotiationTurn:
        # Generate a plausible message
        last_opposing_turn = next(
            (t for t in reversed(history) if t.agent_id != agent_id), None
        )
        if last_opposing_turn:
            gap = abs(suggested_offer - last_opposing_turn.offer)
            if gap < 2:
                msg = f"We're very close — I can offer {suggested_offer}{brief.unit_label}. Let's settle this."
            elif gap < 10:
                msg = f"I'm willing to move to {suggested_offer}{brief.unit_label}, but I need some movement from your side too."
            else:
                msg = f"My position remains {suggested_offer}{brief.unit_label}. That reflects what I think is fair given the circumstances."
        else:
            msg = f"Opening at {suggested_offer}{brief.unit_label} — that's where I stand."

        return NegotiationTurn(
            agent_id=agent_id,
            turn_number=0,
            offer=suggested_offer,
            message=f"[FALLBACK MODE] {msg}",
            provider="mock",
        )

    return mock_agent


def make_groq_agent(groq_client=None):
    """Returns the real Agent A callable (closes over a client instance)."""
    from app.agents.agent_a_groq import call_agent_a
    import functools
    return functools.partial(call_agent_a, groq_client=groq_client)


def make_groq_agent_b(groq_client=None):
    """Returns the real Agent B callable using a different Groq model."""
    from app.agents.agent_b_groq import call_agent_b_groq
    import functools
    return functools.partial(call_agent_b_groq, groq_client=groq_client)


def make_gemini_agent(gemini_client=None):
    """Returns the real Agent B callable (closes over a client instance)."""
    from app.agents.agent_b_gemini import call_agent_b
    import functools
    return functools.partial(call_agent_b, gemini_client=gemini_client)
