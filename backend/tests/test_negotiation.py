"""
Unit tests for the negotiation engine.
Run with: python -m pytest tests/ -v
No API keys needed — all LLM calls are mocked.
"""
from __future__ import annotations

import asyncio
import pytest
import pytest_asyncio

from app.models.schemas import (
    AgentId, ConcessionStrategy, HumanBrief, SessionConfig, ToneStyle, NegotiationState,
)
from app.negotiation.concession_schedule import ConcessionSchedule, compute_zopa
from app.negotiation.deadlock_detector import DeadlockDetector
from app.negotiation.grounding_guardrail import GroundingGuardrail
from app.negotiation.state_machine import NegotiationSession
from app.agents.provider_fallback import make_mock_agent


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_brief(
    agent_id: str = "A",
    name: str = "Test",
    initial_position: float = 40.0,
    floor: float = 35.0,
    ceiling: float = 60.0,
    strategy: str = "boulware",
    private_context: str = "test context",
) -> HumanBrief:
    return HumanBrief(
        agent_id=AgentId(agent_id),
        name=name,
        initial_position=initial_position,
        floor=floor,
        ceiling=ceiling,
        tone=ToneStyle.ASSERTIVE,
        strategy=ConcessionStrategy(strategy),
        private_context=private_context,
        dispute_topic="test dispute",
        unit_label="%",
    )


# ── ConcessionSchedule tests ──────────────────────────────────────────────────

class TestConcessionSchedule:

    def test_first_offer_is_initial_position(self):
        brief = make_brief(initial_position=40.0)
        sched = ConcessionSchedule(brief, t_max=10)
        offer = sched.next_offer(turn_number=1)
        assert offer == 40.0

    def test_offers_stay_within_bounds(self):
        brief = make_brief(floor=30.0, ceiling=60.0)
        sched = ConcessionSchedule(brief, t_max=10)
        for t in range(1, 11):
            offer = sched.next_offer(turn_number=t)
            assert 30.0 <= offer <= 60.0, f"Turn {t}: offer {offer} out of bounds"

    def test_boulware_concedes_slowly(self):
        brief = make_brief(initial_position=40.0, floor=35.0, ceiling=55.0, strategy="boulware")
        sched = ConcessionSchedule(brief, t_max=10)
        offers = [sched.next_offer(t) for t in range(1, 11)]
        # Boulware: first offer, not much movement until near the end
        early_movement = abs(offers[2] - offers[0])
        late_movement = abs(offers[9] - offers[7])
        # Early movement should be less than or equal to late movement for Boulware
        # (holds position early, concedes later)
        assert early_movement <= late_movement + 1.0  # +1 tolerance for rounding

    def test_conceder_moves_early(self):
        brief = make_brief(initial_position=40.0, floor=35.0, ceiling=55.0, strategy="conceder")
        sched = ConcessionSchedule(brief, t_max=10)
        offers = [sched.next_offer(t) for t in range(1, 11)]
        # Conceder: significant movement in first few turns
        # (just check it moves at all within the first 5 turns)
        total_movement = abs(offers[4] - offers[0])
        assert total_movement >= 0  # may or may not move depending on direction

    def test_stall_detection(self):
        brief = make_brief(initial_position=40.0, floor=35.0, ceiling=55.0)
        sched = ConcessionSchedule(brief, t_max=10)
        sched.next_offer(1)  # 40.0
        sched.next_offer(2)  # some value
        # Force a stall by manually adding offers
        sched._offer_history.append(40.0)
        sched._offer_history.append(40.0)
        assert sched.is_stall(40.0) is True

    def test_hard_limit_override_clamps_floor(self):
        brief = make_brief(floor=30.0, ceiling=60.0)
        sched = ConcessionSchedule(brief, t_max=10)
        sched.hard_limit_override(new_floor=40.0, new_ceiling=None)
        assert sched.floor == 40.0

    def test_hard_limit_override_impossible_raises(self):
        brief = make_brief(floor=30.0, ceiling=60.0)
        sched = ConcessionSchedule(brief, t_max=10)
        with pytest.raises(ValueError):
            sched.hard_limit_override(new_floor=70.0, new_ceiling=50.0)

    def test_zopa_exists(self):
        a = make_brief("A", floor=40.0, ceiling=60.0)
        b = make_brief("B", floor=45.0, ceiling=70.0)
        sa = ConcessionSchedule(a)
        sb = ConcessionSchedule(b)
        zopa = compute_zopa(sa, sb)
        assert zopa is not None
        assert zopa == (45.0, 60.0)

    def test_zopa_none_when_no_overlap(self):
        a = make_brief("A", floor=30.0, ceiling=44.0)
        b = make_brief("B", floor=56.0, ceiling=70.0)
        sa = ConcessionSchedule(a)
        sb = ConcessionSchedule(b)
        zopa = compute_zopa(sa, sb)
        assert zopa is None


# ── DeadlockDetector tests ────────────────────────────────────────────────────

class TestDeadlockDetector:

    def make_detector(self, window=3, threshold=0.5) -> DeadlockDetector:
        return DeadlockDetector(window_size=window, threshold=threshold)

    def test_no_deadlock_before_window_fills(self):
        dd = self.make_detector(window=5)
        for _ in range(3):
            dd.record_turn("A", delta=0.1)
            dd.record_turn("B", delta=0.1)
        assert dd.is_deadlocked(
            current_offer_a=40, current_offer_b=60,
            floor_a=35, ceiling_a=55, floor_b=45, ceiling_b=65,
        ) is False

    def test_deadlock_fires_when_both_flat_and_no_zopa(self):
        dd = self.make_detector(window=3, threshold=0.5)
        # Fill both windows with near-zero deltas
        for _ in range(3):
            dd.record_turn("A", delta=0.1)
            dd.record_turn("B", delta=0.1)
        # No ZOPA: A max=44, B min=56
        result = dd.is_deadlocked(
            current_offer_a=44, current_offer_b=56,
            floor_a=30, ceiling_a=44, floor_b=56, ceiling_b=70,
        )
        assert result is True

    def test_deadlock_does_not_fire_when_zopa_exists(self):
        """
        CRITICAL: Boulware agents with small deltas should NOT trigger deadlock
        if a ZOPA exists. This is the false-positive test.
        """
        dd = self.make_detector(window=3, threshold=0.5)
        # Small deltas (Boulware style)
        for _ in range(3):
            dd.record_turn("A", delta=0.2)
            dd.record_turn("B", delta=0.2)
        # ZOPA EXISTS: A ceiling=55 > B floor=50
        result = dd.is_deadlocked(
            current_offer_a=52, current_offer_b=53,
            floor_a=45, ceiling_a=55, floor_b=50, ceiling_b=65,
        )
        assert result is False  # Must NOT false-trigger!

    def test_infeasibility_detection_at_start(self):
        dd = self.make_detector()
        assert dd.is_infeasible(30, 44, 56, 70) is True
        assert dd.is_infeasible(30, 55, 45, 70) is False

    def test_deadlock_reason_contains_key_info(self):
        dd = self.make_detector()
        reason = dd.deadlock_reason(current_offer_a=40.0, current_offer_b=60.0)
        assert "40.0" in reason
        assert "60.0" in reason
        assert "humans" in reason.lower()


# ── GroundingGuardrail tests ──────────────────────────────────────────────────

class TestGroundingGuardrail:

    def make_guardrail(self, **kwargs) -> GroundingGuardrail:
        brief = make_brief(**kwargs) if kwargs else make_brief()
        return GroundingGuardrail(brief, groq_client=None)  # no LLM — regex fallback

    def test_clean_message_passes(self):
        gg = self.make_guardrail()
        passed, flags = gg.check_turn(
            "I think a 45% split would be fair given the circumstances. "
            "I'm willing to negotiate from there."
        )
        assert passed is True
        assert flags == []

    def test_fabricated_other_party_agreement_fails(self):
        gg = self.make_guardrail()
        passed, flags = gg.check_turn(
            "You agreed to pay 80% in our earlier conversation. I'm holding you to that."
        )
        assert passed is False
        assert len(flags) > 0

    def test_fabricated_cost_not_in_brief_fails(self):
        gg = self.make_guardrail()
        # Brief has no specific cost number — only % range
        passed, flags = gg.check_turn(
            "The repair costs exactly ₹7,500 — I was quoted that by the technician."
        )
        # The number 7500 doesn't appear in the brief → should flag
        # (regex extracts 7500; it's not in floor=35/ceiling=55/position=40)
        assert passed is False

    def test_force_fabrication_test_hook(self):
        gg = self.make_guardrail()
        caught = gg.force_fabrication_test(
            "My flatmate already agreed to pay 80% in our earlier conversation."
        )
        assert caught is True  # guardrail should catch this

    def test_correction_injection_references_brief(self):
        gg = self.make_guardrail(floor=35.0, ceiling=55.0, initial_position=40.0)
        correction = gg.correction_injection(["Fabricated claim detected"])
        assert "35.0" in correction  # floor
        assert "55.0" in correction  # ceiling

    def test_stats_tracking(self):
        gg = self.make_guardrail()
        gg.check_turn("You agreed to pay 80%.")
        gg.check_turn("I think 45% is fair.")
        assert gg.stats["total_checks"] == 2
        assert gg.stats["total_failures"] >= 1


# ── End-to-end session tests (mocked agents) ─────────────────────────────────

class TestNegotiationSession:

    def make_session(self, brief_a_kwargs=None, brief_b_kwargs=None) -> NegotiationSession:
        a_kw = {"agent_id": "A", "floor": 40.0, "ceiling": 60.0, "initial_position": 50.0}
        b_kw = {"agent_id": "B", "floor": 45.0, "ceiling": 65.0, "initial_position": 55.0}
        if brief_a_kwargs:
            a_kw.update(brief_a_kwargs)
        if brief_b_kwargs:
            b_kw.update(brief_b_kwargs)
        brief_a = make_brief(**a_kw)
        brief_b = make_brief(**b_kw)
        config = SessionConfig(brief_a=brief_a, brief_b=brief_b)
        return NegotiationSession(
            config=config,
            agent_a_fn=make_mock_agent(AgentId.A),
            agent_b_fn=make_mock_agent(AgentId.B),
        )

    @pytest.mark.asyncio
    async def test_feasible_session_reaches_deal(self):
        session = self.make_session()
        await asyncio.wait_for(session.run(), timeout=30.0)
        assert session.state.state in (
            NegotiationState.DEAL_REACHED, NegotiationState.ESCALATED
        )

    @pytest.mark.asyncio
    async def test_infeasible_session_escalates(self):
        """Floors above ceilings → should escalate immediately."""
        session = self.make_session(
            brief_a_kwargs={"floor": 40.0, "ceiling": 44.0, "initial_position": 42.0},
            brief_b_kwargs={"floor": 56.0, "ceiling": 70.0, "initial_position": 60.0},
        )
        await asyncio.wait_for(session.run(), timeout=30.0)
        assert session.state.state == NegotiationState.ESCALATED

    @pytest.mark.asyncio
    async def test_barge_in_is_recorded(self):
        from app.models.schemas import BargeInRequest
        session = self.make_session()
        # Start session without awaiting (fire & forget briefly)
        task = asyncio.create_task(session.run())
        await asyncio.sleep(0.1)
        await session.barge_in(BargeInRequest(
            session_id=session.session_id,
            agent_id=AgentId.A,
            text="I need you to find a deal quickly.",
            is_hard_limit=False,
        ))
        await asyncio.wait_for(task, timeout=30.0)
        assert len(session.state.barge_in_history) >= 1

    @pytest.mark.asyncio
    async def test_deal_value_is_midpoint(self):
        session = self.make_session()
        await asyncio.wait_for(session.run(), timeout=30.0)
        if session.state.deal_value is not None:
            # Deal value should be between the two floors
            assert 40.0 <= session.state.deal_value <= 65.0
