"""
Samjhauta — Concession Schedule
================================
Implements the Boulware–Conceder family of concession curves.

ALGORITHM OVERVIEW
------------------
Each agent starts at `initial_position` and is willing to move toward the
other side over at most `T_max` turns. The rate of concession is controlled
by a single parameter `beta`:

    alpha(t) = 1 - (t / T_max) ^ (1 / beta)

    target_offer(t) = floor + (ceiling - floor) * alpha(t)

  where:
    t       = current turn number (1-indexed)
    T_max   = max turns allowed
    beta    = 1.0  → "Conceder"  (concedes quickly early, slows later)
    beta    > 1.0  → "Boulware"  (holds position, concedes only near the end)
    beta    = 1.0  → "Linear"    (constant rate — same as Conceder alias)

INTERPRETATION
--------------
- At t=0,     alpha = 1.0  → offer = ceiling (best possible outcome)
- At t=T_max, alpha = 0.0  → offer = floor   (walk-away limit)
- The `initial_position` overrides the curve at t=0 — it's the *actual*
  opening offer, which may be less aggressive than the ceiling.

TRADEOFFS
---------
vs Zeuthen (game-theoretic, probability-of-conflict model):
  Pro: Simpler, deterministic, requires no probability estimates.
  Con: Not Pareto-optimal; both Boulware agents may deadlock even with overlap.
  Mitigated by: the deadlock detector escalating before fake deals emerge.

vs Random walk concession:
  Pro: Predictable, demoable, testable with fixed seeds.
  Con: Opponents can learn the curve — acceptable for a demo context.

STALL DETECTION
---------------
A concession is declared a "stall" if the absolute delta from the previous
offer is less than MIN_CONCESSION_DELTA. Stalls count toward the deadlock
window but do not by themselves trigger escalation.
"""
from __future__ import annotations
import math
from app.models.schemas import ConcessionStrategy, HumanBrief
from app.config import settings


# ── Beta values per strategy ──────────────────────────────────────────────────
BETA_MAP: dict[ConcessionStrategy, float] = {
    ConcessionStrategy.CONCEDER: 1.0,
    ConcessionStrategy.LINEAR: 1.0,
    ConcessionStrategy.BOULWARE: 3.0,   # strongly Boulware — holds position
}


class ConcessionSchedule:
    """
    Stateful concession curve for one agent over one negotiation session.

    Parameters
    ----------
    brief       Human brief that defines floor, ceiling, strategy.
    t_max       Maximum number of turns for this agent (half of session max).
    """

    def __init__(self, brief: HumanBrief, t_max: int | None = None) -> None:
        self.brief = brief
        self.floor = brief.floor
        self.ceiling = brief.ceiling
        self.initial_position = brief.initial_position
        self.strategy = brief.strategy
        self.beta = BETA_MAP[self.strategy]
        self.t_max = t_max or (settings.max_turns // 2)

        # Normalise: from Agent A's perspective, "better" = lower % (pays less)
        # We determine the direction of concession by checking if the initial
        # position is closer to the floor or the ceiling.
        self.concede_up = self.initial_position < (self.floor + self.ceiling) / 2.0

        self._turn_count = 0
        self._offer_history: list[float] = []

    # ── Core alpha function ───────────────────────────────────────────────────

    def alpha(self, t: int) -> float:
        """Concession rate at turn t. 1.0 at start → 0.0 at t_max."""
        if self.t_max == 0:
            return 0.0
        ratio = min(t / self.t_max, 1.0)
        return 1.0 - math.pow(ratio, 1.0 / self.beta)

    def target_offer_at(self, t: int) -> float:
        """
        The ideal offer at turn t according to the curve.
        """
        if self.concede_up:
            best_limit = min(self.initial_position, self.floor)
            walkaway = self.ceiling
            return walkaway - (walkaway - best_limit) * self.alpha(t)
        else:
            best_limit = max(self.initial_position, self.ceiling)
            walkaway = self.floor
            return walkaway + (best_limit - walkaway) * self.alpha(t)

    # ── Public API ────────────────────────────────────────────────────────────

    def next_offer(self, turn_number: int) -> float:
        """
        Compute the next offer for this agent.
        The first offer uses `initial_position`; subsequent offers follow
        the concession curve, ensuring offers never cross the floor/ceiling.
        """
        if turn_number == 1:
            offer = self.initial_position
        else:
            # Curve-derived target
            curve_target = self.target_offer_at(turn_number)
            # Never go below floor or above ceiling
            offer = max(self.floor, min(self.ceiling, curve_target))
            # Never go *worse* than previous offer (agents don't walk backward)
            if self._offer_history:
                prev = self._offer_history[-1]
                if self.concede_up:
                    offer = max(prev, offer)
                    offer = min(self.ceiling, offer)
                else:
                    offer = min(prev, offer)
                    offer = max(self.floor, offer)

        # Record and round to 1 decimal place
        offer = round(offer, 1)
        self._offer_history.append(offer)
        return offer

    def concession_delta(self, new_offer: float) -> float:
        """
        How much did the agent concede?
        Positive = moved toward the other party. Negative = retreated (bug).
        """
        if len(self._offer_history) < 2:
            return 0.0
        prev = self._offer_history[-2]
        # Direction-aware delta: concession means moving away from initial pos.
        if self.concede_up:
            return round(new_offer - prev, 2)
        else:
            return round(prev - new_offer, 2)

    def is_stall(self, new_offer: float) -> bool:
        """True if the delta is too small to count as a real concession."""
        if len(self._offer_history) < 2:
            return False
        delta = abs(new_offer - self._offer_history[-2])
        return delta < settings.min_concession_delta

    @property
    def current_offer(self) -> float | None:
        return self._offer_history[-1] if self._offer_history else None

    @property
    def turn_count(self) -> int:
        return len(self._offer_history)

    def hard_limit_override(self, new_floor: float | None, new_ceiling: float | None) -> None:
        """
        Called when a human sets a new hard limit mid-negotiation.
        Clamps existing floor/ceiling and re-anchors the curve.
        """
        if new_floor is not None:
            self.floor = max(new_floor, self.floor)  # can only tighten, not loosen
        if new_ceiling is not None:
            self.ceiling = min(new_ceiling, self.ceiling)
        if self.floor > self.ceiling:
            raise ValueError(
                f"New limits make negotiation impossible: floor={self.floor} > ceiling={self.ceiling}"
            )


def compute_zopa(schedule_a: ConcessionSchedule, schedule_b: ConcessionSchedule) -> tuple[float, float] | None:
    """
    Zone Of Possible Agreement: the overlapping range between the two schedules.
    Returns (low, high) if ZOPA exists, None if no overlap.

    Convention: Agent A wants to PAY LESS (low %), Agent B also wants to PAY LESS.
    Overlap exists when A's ceiling >= B's floor (in % terms where A pays the
    queried amount and B pays the remainder, or similar relative setup).

    This function is intentionally generic — caller maps their domain semantics.
    Returns overlap of [a.floor, a.ceiling] ∩ [b.floor, b.ceiling].
    """
    lo = max(schedule_a.floor, schedule_b.floor)
    hi = min(schedule_a.ceiling, schedule_b.ceiling)
    if lo <= hi:
        return (lo, hi)
    return None
