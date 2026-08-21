"""
Samjhauta — Evaluation Harness
================================
Runs all 20 scripted scenarios against the negotiation engine and outputs
real metrics to eval_report.md.

Usage:
  python eval/run_eval.py           # mocked LLM (fast, no API key needed)
  python eval/run_eval.py --live    # real API calls (~10 requests per provider)

Metrics reported:
  - Convergence rate on feasible scenarios
  - Correct-infeasibility-detection rate on infeasible scenarios
  - Deadlock-detector precision (no false-triggers on slow-converging)
  - Hallucinated-constraint catch rate (adversarial fabrication scenarios)
  - Latency per turn, cost per full negotiation
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Force UTF-8 output on Windows (avoids cp1252 crash on emoji/unicode in report).
# Must happen before any print() calls.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Allow running from the backend directory
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings
from app.models.schemas import (
    AgentId, HumanBrief, NegotiationState, SessionConfig,
    ToneStyle, ConcessionStrategy,
)
from app.negotiation.state_machine import NegotiationSession
from app.negotiation.grounding_guardrail import GroundingGuardrail
from app.agents.provider_fallback import make_mock_agent, make_groq_agent, make_gemini_agent


SCENARIOS_PATH = Path(__file__).parent / "scenarios.jsonl"
REPORT_PATH = Path(__file__).parent / "eval_report.md"


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class ScenarioResult:
    scenario_id: str
    category: str
    description: str
    outcome: str                    # "deal" | "escalated" | "deadlocked" | "error"
    expected_outcome: str
    correct: bool
    deal_value: Optional[float] = None
    total_turns: int = 0
    avg_latency_ms: float = 0.0
    guardrail_caught: Optional[bool] = None  # adversarial scenarios only
    notes: str = ""


# ── Scenario loader ────────────────────────────────────────────────────────────

def load_scenarios() -> list[dict]:
    scenarios = []
    with open(SCENARIOS_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                scenarios.append(json.loads(line))
    return scenarios


def build_brief(raw: dict, agent_id: str) -> HumanBrief:
    return HumanBrief(
        agent_id=AgentId(agent_id),
        name=raw["name"],
        initial_position=raw["initial_position"],
        floor=raw["floor"],
        ceiling=raw["ceiling"],
        tone=ToneStyle(raw.get("tone", "assertive")),
        strategy=ConcessionStrategy(raw.get("strategy", "boulware")),
        private_context=raw.get("private_context", ""),
        dispute_topic=raw.get("dispute_topic", "cost split"),
        unit_label=raw.get("unit_label", "%"),
    )


# ── Run one scenario ──────────────────────────────────────────────────────────

async def run_scenario(scenario: dict, use_live: bool = False) -> ScenarioResult:
    sid = scenario["id"]
    category = scenario["category"]

    # Build briefs
    try:
        brief_a = build_brief(scenario["brief_a"], "A")
        brief_b = build_brief(scenario["brief_b"], "B")
    except Exception as exc:
        return ScenarioResult(
            scenario_id=sid, category=category,
            description=scenario.get("description", ""),
            outcome="error", expected_outcome=scenario.get("expected_outcome", "?"),
            correct=False, notes=f"Brief build error: {exc}",
        )

    # Handle adversarial fabrication scenarios — test guardrail directly
    if category == "adversarial_fabrication":
        fabricated_claim = scenario.get("fabricated_claim", "")
        guardrail = GroundingGuardrail(brief_a)  # test against agent A's brief
        caught = guardrail.force_fabrication_test(fabricated_claim)
        expected_catch = scenario.get("expected_guardrail_catch", True)
        return ScenarioResult(
            scenario_id=sid, category=category,
            description=scenario.get("description", ""),
            outcome="guardrail_test",
            expected_outcome="guardrail_catches_fabrication",
            correct=(caught == expected_catch),
            guardrail_caught=caught,
            notes=f"Claim: '{fabricated_claim[:60]}...' | Caught: {caught}",
        )

    # Build session with appropriate agents
    config = SessionConfig(brief_a=brief_a, brief_b=brief_b)

    if use_live and settings.groq_configured:
        agent_a = make_groq_agent()
    else:
        agent_a = make_mock_agent(AgentId.A)

    if use_live and settings.gemini_configured:
        agent_b = make_gemini_agent()
    else:
        agent_b = make_mock_agent(AgentId.B)

    session = NegotiationSession(
        config=config,
        agent_a_fn=agent_a,
        agent_b_fn=agent_b,
    )

    t0 = time.perf_counter()
    try:
        await asyncio.wait_for(session.run(), timeout=120.0)
    except asyncio.TimeoutError:
        return ScenarioResult(
            scenario_id=sid, category=category,
            description=scenario.get("description", ""),
            outcome="timeout", expected_outcome=scenario.get("expected_outcome", "?"),
            correct=False, notes="Scenario timed out after 120s",
        )
    elapsed = time.perf_counter() - t0

    # Map session state to outcome string
    state = session.state.state
    if state == NegotiationState.DEAL_REACHED:
        outcome = "deal"
    elif state in (NegotiationState.ESCALATED, NegotiationState.DEADLOCKED):
        outcome = "escalated"
    else:
        outcome = state.value.lower()

    expected = scenario.get("expected_outcome", "deal")
    correct = (outcome == expected)

    # Mock-mode note: feasible scenarios need real LLM for convergence.
    # In mocked mode, a 'feasible' scenario that escalated at the turn limit
    # means the schedule ran correctly (no crash), NOT that it failed to converge.
    # We mark it as correct_structural=True but correct=False so the report is honest.
    mock_structural_pass = (
        not use_live
        and category == "feasible"
        and outcome == "escalated"
        and expected == "deal"
    )

    # For slow_converging scenarios, also check deadlock was NOT false-triggered
    notes = ""
    if mock_structural_pass:
        notes = "[MOCK] Engine ran cleanly; convergence requires real LLM — run with --live to validate."
    if category == "slow_converging":
        dd_summary = session._deadlock.summary()
        false_trigger = (outcome == "escalated" and expected == "deal")
        notes = f"Deadlock false-trigger: {false_trigger} | DD summary: {dd_summary}"

    # Check deal is in expected range
    if outcome == "deal" and scenario.get("expected_deal_range"):
        lo, hi = scenario["expected_deal_range"]
        dv = session.state.deal_value
        in_range = lo <= (dv or 0) <= hi
        if not in_range:
            notes += f" | Deal {dv} outside expected range [{lo},{hi}]"

    metrics = session.metrics()
    latencies = session._latencies_ms
    avg_lat = sum(latencies) / len(latencies) if latencies else 0.0

    return ScenarioResult(
        scenario_id=sid, category=category,
        description=scenario.get("description", ""),
        outcome=outcome,
        expected_outcome=expected,
        correct=correct,
        deal_value=session.state.deal_value,
        total_turns=len(session.state.turns),
        avg_latency_ms=round(avg_lat, 1),
        notes=notes,
    )


# ── Report generator ──────────────────────────────────────────────────────────

def generate_report(results: list[ScenarioResult], use_live: bool, elapsed_total: float) -> str:
    feasible = [r for r in results if r.category == "feasible"]
    infeasible = [r for r in results if r.category == "infeasible"]
    slow = [r for r in results if r.category == "slow_converging"]
    adversarial = [r for r in results if r.category == "adversarial_fabrication"]

    convergence_rate = sum(1 for r in feasible if r.correct) / max(len(feasible), 1)
    infeasible_rate = sum(1 for r in infeasible if r.correct) / max(len(infeasible), 1)
    slow_precision = sum(1 for r in slow if r.correct) / max(len(slow), 1)
    guardrail_rate = sum(1 for r in adversarial if r.correct) / max(len(adversarial), 1)

    all_latencies = [r.avg_latency_ms for r in results if r.avg_latency_ms > 0]
    avg_latency = sum(all_latencies) / max(len(all_latencies), 1)

    mode = "LIVE (real API calls)" if use_live else "MOCKED (deterministic, no API)"

    lines = [
        "# Samjhauta — Eval Report",
        "",
        f"> **Mode:** {mode}  ",
        f"> **Run time:** {elapsed_total:.1f}s total  ",
        f"> **Scenarios:** {len(results)} total  ",
        "",
        "## Summary Metrics",
        "",
        "| Metric | Value | Target |",
        "|---|---|---|",
        f"| Convergence rate (feasible scenarios) | **{convergence_rate:.0%}** | ≥ 80% |",
        f"| Correct infeasibility detection | **{infeasible_rate:.0%}** | 100% |",
        f"| Deadlock false-trigger precision | **{slow_precision:.0%}** | 100% (no false triggers) |",
        f"| Guardrail catch rate (adversarial) | **{guardrail_rate:.0%}** | 100% |",
        f"| Avg turn latency | **{avg_latency:.1f} ms** | < 3000 ms |",
        f"| Estimated cost per session | **$0.00** | $0 (free tier) |",
        "",
        "## Detailed Results",
        "",
        "### Feasible Scenarios (should converge to deal)",
        "",
        "| ID | Description | Outcome | Expected | Deal Value | Turns | ✓ |",
        "|---|---|---|---|---|---|---|",
    ]

    for r in feasible:
        check = "✅" if r.correct else "❌"
        lines.append(
            f"| {r.scenario_id} | {r.description[:40]} | {r.outcome} | {r.expected_outcome} "
            f"| {r.deal_value or '—'} | {r.total_turns} | {check} |"
        )

    lines += [
        "",
        "### Infeasible Scenarios (should escalate, never fake-deal)",
        "",
        "| ID | Description | Outcome | Expected | ✓ |",
        "|---|---|---|---|---|",
    ]
    for r in infeasible:
        check = "✅" if r.correct else "❌"
        lines.append(f"| {r.scenario_id} | {r.description[:40]} | {r.outcome} | {r.expected_outcome} | {check} |")

    lines += [
        "",
        "### Slow-Converging Scenarios (deadlock detector MUST NOT false-trigger)",
        "",
        "| ID | Description | Outcome | False-Trigger? | ✓ |",
        "|---|---|---|---|---|",
    ]
    for r in slow:
        false_trigger = "❌ YES" if (r.outcome == "escalated" and r.expected_outcome == "deal") else "✅ NO"
        check = "✅" if r.correct else "❌"
        lines.append(f"| {r.scenario_id} | {r.description[:40]} | {r.outcome} | {false_trigger} | {check} |")

    lines += [
        "",
        "### Adversarial Fabrication Tests (guardrail must catch every time)",
        "",
        "| ID | Fabricated Claim | Caught? | ✓ |",
        "|---|---|---|---|",
    ]
    for r in adversarial:
        caught_str = "✅ CAUGHT" if r.guardrail_caught else "❌ MISSED"
        check = "✅" if r.correct else "❌"
        lines.append(f"| {r.scenario_id} | {r.notes[:60]} | {caught_str} | {check} |")

    lines += [
        "",
        "## Free Tier Cost Analysis",
        "",
        "| Provider | Model | RPM | TPM | RPD | Cost |",
        "|---|---|---|---|---|---|",
        "| Groq | Llama 3.3 70B | 30 | 12,000 | 1,000 | $0 (free tier) |",
        "| Groq | Whisper Large v3 Turbo | 20 | — | 2,000 req | $0 (free tier) |",
        "| Google AI Studio | Gemini 3.5 Flash | ~15–60 | varies | ~1,500 | $0 (free tier) |",
        "| Browser | speechSynthesis (TTS) | unlimited | — | — | $0 (native) |",
        "| Browser | SpeechRecognition (fallback STT) | unlimited | — | — | $0 (native) |",
        "",
        "**Concurrent sessions before hitting free tier:**",
        "With ~4 LLM calls per turn and 30s inter-turn pacing, 1 session comfortably",
        "stays within 30 RPM. At 10k users you'd need paid tiers.",
        "",
        "**Paid tier cost estimate (if needed):**",
        "- Groq Developer: ~$0.59/1M tokens (Llama 3.3 70B)",
        "- Google AI: ~$0.30/1M input tokens (Gemini 3.5 Flash)",
        "- Full negotiation (20 turns, ~500 tokens/turn): < $0.02 per session",
        "",
        "---",
        "_Generated by `backend/eval/run_eval.py`_",
    ]

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

async def main(use_live: bool = False) -> None:
    print(f"\n{'='*60}")
    print(f"  SAMJHAUTA EVAL HARNESS — {'LIVE' if use_live else 'MOCKED'} MODE")
    print(f"{'='*60}\n")

    scenarios = load_scenarios()
    print(f"Loaded {len(scenarios)} scenarios.\n")

    results: list[ScenarioResult] = []
    t_start = time.perf_counter()

    for i, scenario in enumerate(scenarios, 1):
        print(f"[{i:02d}/{len(scenarios)}] {scenario['id']:25s} {scenario['description'][:45]}...", end=" ")
        sys.stdout.flush()
        result = await run_scenario(scenario, use_live=use_live)
        results.append(result)
        status = "OK" if result.correct else "FAIL"
        print(f"{status:6s}  ({result.outcome})")

    elapsed = time.perf_counter() - t_start

    # Print summary
    print(f"\n{'='*60}")
    total = len(results)
    correct = sum(1 for r in results if r.correct)
    print(f"  {correct}/{total} scenarios passed in {elapsed:.1f}s")
    print(f"{'='*60}\n")

    # Write report
    report = generate_report(results, use_live, elapsed)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Report written to: {REPORT_PATH}\n")

    # Exit with error code if any failures
    if correct < total:
        sys.exit(1)


if __name__ == "__main__":
    live = "--live" in sys.argv
    asyncio.run(main(use_live=live))
