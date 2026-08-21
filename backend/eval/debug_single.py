"""Run a single scenario with debug logging to diagnose the immediate failures."""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from app.config import settings
from eval.run_eval import load_scenarios
from app.negotiation.state_machine import NegotiationSession

# Set very verbose logging
logging.basicConfig(level=logging.DEBUG)

async def test_single():
    scenarios = load_scenarios()
    # Find feasible_02
    scenario = next(s for s in scenarios if s["id"] == "feasible_02")
    
    print(f"=== Running Scenario: {scenario['id']} ===")
    from eval.run_eval import build_brief
    brief_a = build_brief(scenario["brief_a"], "A")
    brief_b = build_brief(scenario["brief_b"], "B")
    from app.agents.provider_fallback import make_groq_agent, make_gemini_agent
    
    agent_a = make_groq_agent()
    agent_b = make_gemini_agent()
    
    from app.models.schemas import SessionConfig
    config = SessionConfig(brief_a=brief_a, brief_b=brief_b)
    
    session = NegotiationSession(
        config=config,
        agent_a_fn=agent_a,
        agent_b_fn=agent_b,
        groq_client=None
    )
    
    try:
        outcome = await session.run()
        print(f"=== Outcome: {outcome.status.name} ===")
        print(f"Turns: {len(session.history)}")
        if outcome.status.name == "PAUSED_FALLBACK":
            print(f"Fallback reason: {outcome.reason}")
    except Exception as e:
        print(f"EXCEPTION: {e}")

if __name__ == "__main__":
    # Force UTF-8 for Windows
    if sys.platform == 'win32':
        sys.stdout.reconfigure(encoding='utf-8')
    asyncio.run(test_single())
