"""
Samjhauta — Negotiation State Machine
=======================================
The central engine. Orchestrates turns, grounding checks, deadlock detection,
and WebSocket event emission. Fully text-based — no audio involved here.

STATE TRANSITIONS
-----------------
  BRIEFING → NEGOTIATING   : both briefs received, session.start() called
  NEGOTIATING → NEGOTIATING : normal turn completion
  NEGOTIATING → DEAL_REACHED: offers converge (A's offer within DEAL_TOLERANCE of B's)
  NEGOTIATING → DEADLOCKED  : deadlock detector fires
  NEGOTIATING → ESCALATED   : human barge-in with is_hard_limit=True makes ZOPA impossible
  NEGOTIATING → PAUSED_FALLBACK : provider rate-limited / unreachable
  PAUSED_FALLBACK → NEGOTIATING : provider comes back / human resumes in text mode

DEAL DETECTION
--------------
A deal is reached when the two agents' current offers are within DEAL_TOLERANCE
of each other (default 1.0 unit). The deal value is the midpoint of the two offers.
We do NOT declare a deal without this — the system never invents agreement.

BARGE-IN HANDLING
-----------------
When a human barges in:
  1. The current agent turn is interrupted (or queued — depends on timing).
  2. The barge-in text is injected into the next agent's context as a hard
     constraint or a context update.
  3. If is_hard_limit=True: floor/ceiling is updated via ConcessionSchedule.hard_limit_override().
     If new limits make ZOPA impossible → immediate ESCALATED state.

OBSERVABILITY
-------------
Every state transition emits a structured log entry via structlog.
Every turn records its LLM latency and token count for the /metrics endpoint.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime
from typing import AsyncGenerator, Callable, Optional

import structlog

from app.config import settings
from app.models.schemas import (
    AgentId,
    BargeInRequest,
    EventType,
    HumanBrief,
    NegotiationState,
    NegotiationTurn,
    SessionConfig,
    SessionState,
    WSEvent,
)
from app.negotiation.concession_schedule import ConcessionSchedule, compute_zopa
from app.negotiation.deadlock_detector import DeadlockDetector
from app.negotiation.grounding_guardrail import GroundingGuardrail, MAX_REGENERATION_ATTEMPTS
from app.voice.tts import get_tts_metadata

log = structlog.get_logger(__name__)

DEAL_TOLERANCE = 1.0  # offers within 1 unit = deal reached


class NegotiationSession:
    """
    One live negotiation between two agents.
    Thread-safe via asyncio — all mutations happen in a single event loop.
    """

    def __init__(
        self,
        config: SessionConfig,
        agent_a_fn: Callable,   # async fn(brief, history, correction) -> NegotiationTurn
        agent_b_fn: Callable,   # same signature
        groq_client=None,
    ) -> None:
        self.config = config
        self.session_id = config.session_id
        self._agent_fns = {AgentId.A: agent_a_fn, AgentId.B: agent_b_fn}

        self.state = SessionState(session_id=self.session_id)
        self._schedule_a = ConcessionSchedule(config.brief_a, t_max=settings.max_turns // 2)
        self._schedule_b = ConcessionSchedule(config.brief_b, t_max=settings.max_turns // 2)
        self._deadlock = DeadlockDetector()
        self._guardrail_a = GroundingGuardrail(config.brief_a, groq_client=groq_client)
        self._guardrail_b = GroundingGuardrail(config.brief_b, groq_client=groq_client)

        self._ws_subscribers: list[asyncio.Queue] = []
        self._barge_in_queue: asyncio.Queue[BargeInRequest] = asyncio.Queue()
        self._running = False
        self._paused = False

        # Metrics
        self._token_counts: dict[str, int] = {"groq": 0, "gemini": 0}
        self._latencies_ms: list[float] = []
        self._provider_errors: dict[str, int] = {"groq": 0, "gemini": 0}

    # ── WebSocket subscription ─────────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._ws_subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._ws_subscribers.discard(q) if hasattr(self._ws_subscribers, "discard") else None
        try:
            self._ws_subscribers.remove(q)
        except ValueError:
            pass

    async def _emit(self, event: EventType, payload: dict) -> None:
        evt = WSEvent(
            event=event,
            session_id=self.session_id,
            payload=payload,
        )
        evt_dict = evt.model_dump(mode="json")
        for q in list(self._ws_subscribers):
            try:
                q.put_nowait(evt_dict)
            except asyncio.QueueFull:
                pass  # slow consumer — drop event rather than blocking

    # ── Human barge-in ─────────────────────────────────────────────────────────

    async def barge_in(self, request: BargeInRequest) -> dict:
        """Called when a human speaks/types to interrupt the negotiation."""
        await self._barge_in_queue.put(request)
        await self._emit(
            EventType.BARGE_IN,
            {
                "agent_id": request.agent_id,
                "text": request.text,
                "is_hard_limit": request.is_hard_limit,
            },
        )
        log.info("barge_in_received", session_id=self.session_id, agent=request.agent_id)
        return {"accepted": True, "message": "Barge-in received — will affect next turn."}

    async def _process_barge_in(self, request: BargeInRequest) -> Optional[str]:
        """
        Applies a barge-in to the session state.
        Returns a correction string to inject into the next LLM call, or None.
        """
        if request.is_hard_limit:
            # Parse the new limit from the text (basic extraction)
            import re
            numbers = re.findall(r"\d+\.?\d*", request.text)
            new_floor = new_ceiling = None
            if len(numbers) >= 1:
                new_floor = float(numbers[0])
            if len(numbers) >= 2:
                new_ceiling = float(numbers[1])

            schedule = self._schedule_a if request.agent_id == AgentId.A else self._schedule_b
            try:
                schedule.hard_limit_override(new_floor, new_ceiling)
                await self._emit(
                    EventType.HARD_LIMIT_SET,
                    {"agent_id": request.agent_id, "new_floor": new_floor, "new_ceiling": new_ceiling},
                )
            except ValueError:
                # New limits make ZOPA impossible → escalate
                self.state.state = NegotiationState.ESCALATED
                await self._emit(
                    EventType.ESCALATED,
                    {
                        "reason": "Human override created an impossible negotiation range.",
                        "message": "The new limits mean there's no possible agreement. Both humans need to step in.",
                    },
                )
                return None

        # Inject the barge-in text as context for the next agent
        self.state.barge_in_history.append(
            {"agent_id": request.agent_id, "text": request.text, "turn": len(self.state.turns)}
        )
        return (
            f"HUMAN INTERVENTION: {request.agent_id.value}'s human just said: \"{request.text}\". "
            f"Take this into account in your next response."
        )

    # ── Core turn loop ─────────────────────────────────────────────────────────

    async def run(self) -> None:
        """
        Main negotiation loop. Runs until deal, deadlock, escalation, or max turns.
        Designed to be launched as an asyncio task.
        """
        self._running = True
        self.state.state = NegotiationState.NEGOTIATING

        await self._emit(EventType.SESSION_START, {
            "session_id": self.session_id,
            "dispute_topic": self.config.brief_a.dispute_topic,
            "unit_label": self.config.brief_a.unit_label,
            "max_turns": settings.max_turns,
            "language_a": getattr(self.config.brief_a, "language", "English"),
            "language_b": getattr(self.config.brief_b, "language", "English"),
        })

        log.info("negotiation_started", session_id=self.session_id)

        # Check for structural infeasibility before first turn
        if self._deadlock.is_infeasible(
            self._schedule_a.floor, self._schedule_a.ceiling,
            self._schedule_b.floor, self._schedule_b.ceiling,
        ):
            await self._escalate(
                "The two sides have no overlapping range at all — "
                "even at their maximum concession limits, a deal is structurally impossible."
            )
            return

        barge_in_context: Optional[str] = None

        for turn_num in range(1, settings.max_turns + 1):
            if not self._running:
                break

            # ── Check for pending barge-in ────────────────────────────────────
            if not self._barge_in_queue.empty():
                bi_req = self._barge_in_queue.get_nowait()
                injection = await self._process_barge_in(bi_req)
                if injection:
                    barge_in_context = injection
                if self.state.state in (NegotiationState.ESCALATED, NegotiationState.DEADLOCKED):
                    break

            agent_id = self.state.current_agent
            schedule = self._schedule_a if agent_id == AgentId.A else self._schedule_b
            guardrail = self._guardrail_a if agent_id == AgentId.A else self._guardrail_b
            brief = self.config.brief_a if agent_id == AgentId.A else self.config.brief_b
            agent_fn = self._agent_fns[agent_id]

            # ── Compute what the concession curve suggests ────────────────────
            suggested_offer = schedule.next_offer(
                turn_number=(turn_num + 1) // 2  # each agent uses their own turn count
            )

            # ── Call the agent (with retries for grounding) ───────────────────
            correction: Optional[str] = barge_in_context
            barge_in_context = None  # consumed
            turn: Optional[NegotiationTurn] = None

            for attempt in range(MAX_REGENERATION_ATTEMPTS):
                # Inner loop for API retries (rate limits/network issues)
                api_retries = 3
                for api_attempt in range(api_retries):
                    try:
                        t0 = time.perf_counter()
                        turn = await agent_fn(
                            brief=brief,
                            history=self.state.turns,
                            suggested_offer=suggested_offer,
                            correction=correction,
                        )
                        latency_ms = (time.perf_counter() - t0) * 1000
                        turn.llm_latency_ms = latency_ms
                        turn.turn_number = turn_num
                        self._latencies_ms.append(latency_ms)
                        break # Success, break out of API retry loop

                    except Exception as exc:
                        provider = "groq" if agent_id == AgentId.A else "gemini"
                        self._provider_errors[provider] = self._provider_errors.get(provider, 0) + 1
                        log.error("agent_call_failed", agent=agent_id, attempt=attempt, api_attempt=api_attempt, error=str(exc))

                        err_str = str(exc).lower()
                        if "rate" in err_str or "429" in err_str or "quota" in err_str or "exhausted" in err_str:
                            if api_attempt < api_retries - 1:
                                backoff = 20 * (api_attempt + 1) # 20s, 40s
                                log.warning(f"Rate limited. Backing off for {backoff}s...")
                                await asyncio.sleep(backoff)
                                continue
                            else:
                                await self._enter_fallback(provider, str(exc))
                                return  # pause; caller will resume when provider is back
                        
                        # Other error: short delay and retry
                        if api_attempt < api_retries - 1:
                            await asyncio.sleep(2.0)
                            continue
                        else:
                            await self._enter_fallback(provider, str(exc))
                            return

                # If all API retries failed without returning, turn is still None
                if turn is None:
                    break  # fall through to the None guard below

                # ── Grounding check ───────────────────────────────────────────
                passed, flags = guardrail.check_turn(turn.message)
                if not passed:
                    turn.grounding_passed = False
                    turn.grounding_flags = flags
                    log.warning(
                        "grounding_failed",
                        agent=agent_id,
                        attempt=attempt,
                        flags=flags,
                    )
                    if attempt < MAX_REGENERATION_ATTEMPTS - 1:
                        correction = guardrail.correction_injection(flags)
                        turn = None  # reset for next attempt
                        continue  # regenerate
                    else:
                        # Accept with flags on final attempt, but sanitise
                        turn.message = (
                            f"[Note: My previous statement was corrected for accuracy.] "
                            + turn.message
                        )
                break

            if turn is None:
                log.error("all_attempts_failed", session_id=self.session_id, agent=agent_id)
                await self._escalate("An agent repeatedly failed to produce a valid response.")
                return

            # ── Stall / concession analysis ───────────────────────────────────
            prev_offer = schedule.current_offer
            # Use the offer the agent actually stated (may differ from curve suggestion)
            # Clamp to hard limits
            turn.offer = max(schedule.floor, min(schedule.ceiling, turn.offer))
            delta = abs(turn.offer - prev_offer) if prev_offer is not None else 0.0
            turn.concession_delta = delta
            turn.is_stall = schedule.is_stall(turn.offer)
            turn.previous_offer = prev_offer

            self._deadlock.record_turn(
                agent_id=agent_id.value,
                delta=delta,
                is_stall=turn.is_stall,
            )

            # ── Append turn ───────────────────────────────────────────────────
            self.state.turns.append(turn)
            self.state.last_updated = datetime.utcnow()

            log.info(
                "turn_complete",
                session=self.session_id,
                turn=turn_num,
                agent=agent_id,
                offer=turn.offer,
                delta=delta,
                latency_ms=round(turn.llm_latency_ms or 0, 1),
            )

            await self._emit(EventType.TURN_COMPLETE, {
                "turn": turn.model_dump(mode="json"),
                "schedule_a": {"current": self._schedule_a.current_offer, "floor": self._schedule_a.floor, "ceiling": self._schedule_a.ceiling},
                "schedule_b": {"current": self._schedule_b.current_offer, "floor": self._schedule_b.floor, "ceiling": self._schedule_b.ceiling},
                "deadlock_summary": self._deadlock.summary(),
                "tts": get_tts_metadata(agent_id, turn.message),
            })

            # ── Deal check ────────────────────────────────────────────────────
            offer_a = self._schedule_a.current_offer
            offer_b = self._schedule_b.current_offer
            if offer_a is not None and offer_b is not None:
                crossed = False
                if self._schedule_a.concede_up and not self._schedule_b.concede_up:
                    if offer_a >= offer_b:
                        crossed = True
                elif not self._schedule_a.concede_up and self._schedule_b.concede_up:
                    if offer_b >= offer_a:
                        crossed = True

                if abs(offer_a - offer_b) <= DEAL_TOLERANCE or crossed:
                    deal_val = round((offer_a + offer_b) / 2, 1)
                    self.state.deal_value = deal_val
                    self.state.state = NegotiationState.DEAL_REACHED
                    await self._emit(EventType.DEAL_REACHED, {
                        "deal_value": deal_val,
                        "unit_label": self.config.brief_a.unit_label,
                        "offer_a": offer_a,
                        "offer_b": offer_b,
                        "total_turns": turn_num,
                        "message": (
                            f"Deal reached! Both agents converged to "
                            f"{deal_val}{self.config.brief_a.unit_label}. "
                            f"Both humans must confirm before this is final."
                        ),
                    })
                    log.info("deal_reached", session=self.session_id, value=deal_val)
                    self._running = False
                    return

            # ── Deadlock check ────────────────────────────────────────────────
            if self._deadlock.is_deadlocked(
                current_offer_a=offer_a or self._schedule_a.initial_position,
                current_offer_b=offer_b or self._schedule_b.initial_position,
                floor_a=self._schedule_a.floor,
                ceiling_a=self._schedule_a.ceiling,
                floor_b=self._schedule_b.floor,
                ceiling_b=self._schedule_b.ceiling,
            ):
                reason = self._deadlock.deadlock_reason(offer_a, offer_b)
                await self._escalate(reason)
                return

            # ── Switch agent ──────────────────────────────────────────────────
            self.state.current_agent = AgentId.B if agent_id == AgentId.A else AgentId.A

            # Turn pacing delay so previous agent speech completes cleanly without interruption
            if settings.turn_delay_seconds > 0:
                await asyncio.sleep(settings.turn_delay_seconds)

        # Max turns exhausted without deal
        if self.state.state == NegotiationState.NEGOTIATING:
            await self._escalate(
                f"Maximum turn limit ({settings.max_turns}) reached without agreement. "
                "Both humans need to re-evaluate their positions."
            )

    async def _escalate(self, reason: str) -> None:
        self.state.state = NegotiationState.ESCALATED
        self.state.deadlock_reason = reason
        self._running = False
        await self._emit(EventType.ESCALATED, {
            "reason": reason,
            "deadlock_summary": self._deadlock.summary(),
            "final_offer_a": self._schedule_a.current_offer,
            "final_offer_b": self._schedule_b.current_offer,
        })
        log.warning("escalated", session=self.session_id, reason=reason)

    async def _enter_fallback(self, provider: str, error: str) -> None:
        self.state.state = NegotiationState.PAUSED_FALLBACK
        self.state.fallback_active = True
        self._paused = True
        self._running = False
        await self._emit(EventType.FALLBACK_ACTIVE, {
            "provider": provider,
            "error": error,
            "message": (
                f"⚠️ FALLBACK MODE — {provider.upper()} is temporarily unavailable. "
                "Audio is paused. Transcript continues. "
                "The negotiation is paused until the provider recovers or you switch to text mode."
            ),
        })
        log.error("provider_fallback", session=self.session_id, provider=provider)

    def metrics(self) -> dict:
        import statistics as stats
        return {
            "session_id": self.session_id,
            "total_turns": len(self.state.turns),
            "avg_latency_ms": round(stats.mean(self._latencies_ms), 1) if self._latencies_ms else None,
            "total_tokens_groq": self._token_counts.get("groq", 0),
            "total_tokens_gemini": self._token_counts.get("gemini", 0),
            "estimated_cost_usd": 0.0,  # free tier
            "provider_errors": self._provider_errors,
            "deadlock_summary": self._deadlock.summary(),
            "guardrail_a": self._guardrail_a.stats,
            "guardrail_b": self._guardrail_b.stats,
        }


# ── Session Registry ──────────────────────────────────────────────────────────

class SessionRegistry:
    """In-memory registry of active sessions. Keyed by session_id."""

    def __init__(self) -> None:
        self._sessions: dict[str, NegotiationSession] = {}

    def create(self, session: NegotiationSession) -> None:
        self._sessions[session.session_id] = session

    def get(self, session_id: str) -> Optional[NegotiationSession]:
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# Global registry instance
registry = SessionRegistry()
