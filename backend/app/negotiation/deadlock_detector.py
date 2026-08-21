"""
Samjhauta — Deadlock Detector
==============================
Determines whether a negotiation is genuinely stuck (deadlock) vs.
still converging slowly (Boulware patience).

ALGORITHM
---------
We maintain a sliding window of size N (default 5) over the per-agent
concession deltas. Deadlock fires only when ALL of:

  1. mean(|deltas_A|[-N:]) < CONVERGENCE_THRESHOLD  → Agent A has gone flat
  2. mean(|deltas_B|[-N:]) < CONVERGENCE_THRESHOLD  → Agent B has gone flat
  3. The current ZOPA is still empty (no deal possible at current positions)

Why condition 3 is essential:
  Without it, two Boulware agents approaching a deal slowly would false-trigger
  the detector because their per-turn deltas ARE small — that's the Boulware
  style. The ZOPA check is what distinguishes "approaching from both sides" from
  "both stuck far apart."

THRESHOLDS
----------
CONVERGENCE_THRESHOLD = settings.convergence_threshold (default 0.5)
  Same as MIN_CONCESSION_DELTA — a turn where an agent moves less than 0.5
  units counts as a flat/stall turn in the window.

WINDOW SIZE
-----------
N = settings.deadlock_window (default 5)
  Chosen to give agents enough runway to demonstrate intent. With T_max=20
  turns total, a window of 5 catches genuine deadlocks (flat for 25%+ of the
  negotiation) without triggering on early low-delta turns.

FALSE-POSITIVE ANALYSIS
-----------------------
Scenario: both agents are Boulware (beta=3), but ZOPA exists.
  → Their deltas are small by design. BUT condition 3 fails (ZOPA open).
  → Detector does NOT fire. ✓

Scenario: one agent is stuck, the other is still moving.
  → Condition 1 or 2 fails. Detector does NOT fire. ✓

Scenario: both agents flat, ZOPA empty.
  → All 3 conditions met. Detector fires. ✓
"""
from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass, field

from app.config import settings


@dataclass
class AgentDeltaWindow:
    """Tracks the last N concession deltas for one agent."""
    window_size: int = 5
    _deltas: deque[float] = field(default_factory=deque)

    def push(self, delta: float) -> None:
        """Record a new concession delta (absolute value stored)."""
        self._deltas.append(abs(delta))
        if len(self._deltas) > self.window_size:
            self._deltas.popleft()

    @property
    def mean_delta(self) -> float:
        if not self._deltas:
            return float("inf")  # no data → definitely not flat
        return statistics.mean(self._deltas)

    @property
    def is_flat(self) -> bool:
        """True when the agent has been making negligible concessions."""
        if len(self._deltas) < self.window_size:
            return False  # not enough data yet — benefit of the doubt
        return self.mean_delta < settings.convergence_threshold

    @property
    def window_full(self) -> bool:
        return len(self._deltas) >= self.window_size

    def to_dict(self) -> dict:
        return {
            "deltas": list(self._deltas),
            "mean_delta": round(self.mean_delta, 3),
            "is_flat": self.is_flat,
            "window_full": self.window_full,
        }


class DeadlockDetector:
    """
    Tracks both agents' concession windows and detects genuine deadlock.

    Usage
    -----
        detector = DeadlockDetector()
        detector.record_turn(agent_id="A", delta=2.5, current_offer_a=70, current_offer_b=55)
        if detector.is_deadlocked(floor_a=60, ceiling_a=80, floor_b=40, ceiling_b=65):
            raise DeadlockError(detector.deadlock_reason())
    """

    def __init__(
        self,
        window_size: int | None = None,
        threshold: float | None = None,
    ) -> None:
        self._window_size = window_size or settings.deadlock_window
        self._threshold = threshold or settings.convergence_threshold
        self._window_a = AgentDeltaWindow(window_size=self._window_size)
        self._window_b = AgentDeltaWindow(window_size=self._window_size)
        self._total_turns = 0
        self._stall_count_a = 0
        self._stall_count_b = 0

    def record_turn(
        self,
        agent_id: str,
        delta: float,
        is_stall: bool = False,
    ) -> None:
        """Call this after every agent turn, before checking deadlock."""
        self._total_turns += 1
        if agent_id == "A":
            self._window_a.push(delta)
            if is_stall:
                self._stall_count_a += 1
        else:
            self._window_b.push(delta)
            if is_stall:
                self._stall_count_b += 1

    def is_deadlocked(
        self,
        current_offer_a: float,
        current_offer_b: float,
        floor_a: float,
        ceiling_a: float,
        floor_b: float,
        ceiling_b: float,
    ) -> bool:
        """
        Returns True only when all three deadlock conditions are met.
        See module docstring for full analysis.
        """
        # Condition 1 & 2: both windows full and flat
        if not (self._window_a.is_flat and self._window_b.is_flat):
            return False

        # Condition 3: ZOPA is still empty
        # Compute overlap of [floor_a, ceiling_a] ∩ [floor_b, ceiling_b]
        zopa_lo = max(floor_a, floor_b)
        zopa_hi = min(ceiling_a, ceiling_b)
        if zopa_lo <= zopa_hi:
            return False  # ZOPA exists — not deadlocked, just slow

        return True

    def is_infeasible(
        self,
        floor_a: float,
        ceiling_a: float,
        floor_b: float,
        ceiling_b: float,
    ) -> bool:
        """
        Structural infeasibility: the ZOPA is empty at the hard limits themselves.
        This is detectable at the very first turn — no sliding window needed.
        If true, the negotiation should escalate immediately.
        """
        zopa_lo = max(floor_a, floor_b)
        zopa_hi = min(ceiling_a, ceiling_b)
        return zopa_lo > zopa_hi

    def deadlock_reason(
        self,
        current_offer_a: float | None = None,
        current_offer_b: float | None = None,
    ) -> str:
        """Human-readable explanation of why deadlock was detected."""
        parts = [
            f"Both agents have stopped making meaningful concessions "
            f"(window={self._window_size} turns, threshold={self._threshold} units).",
        ]
        if current_offer_a is not None and current_offer_b is not None:
            parts.append(
                f"Agent A's last offer: {current_offer_a}. "
                f"Agent B's last offer: {current_offer_b}. "
                f"The gap ({abs(current_offer_a - current_offer_b):.1f} units) remains open."
            )
        parts.append(
            "The system is handing this back to both humans — "
            "you'll need to adjust your limits or step in directly."
        )
        return " ".join(parts)

    def summary(self) -> dict:
        return {
            "total_turns": self._total_turns,
            "window_size": self._window_size,
            "threshold": self._threshold,
            "agent_a": self._window_a.to_dict(),
            "agent_b": self._window_b.to_dict(),
            "stalls_a": self._stall_count_a,
            "stalls_b": self._stall_count_b,
        }
