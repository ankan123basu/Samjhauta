"""
Samjhauta — Pydantic Schemas
All shared data models. These are the canonical types that flow between
the negotiation engine, API routes, agents, and WebSocket stream.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
import uuid


# ─────────────────────────────────────────────────────────────────────────────
# Enumerations
# ─────────────────────────────────────────────────────────────────────────────

class AgentId(str, Enum):
    A = "A"
    B = "B"


class NegotiationState(str, Enum):
    BRIEFING = "BRIEFING"
    NEGOTIATING = "NEGOTIATING"
    DEADLOCKED = "DEADLOCKED"
    DEAL_REACHED = "DEAL_REACHED"
    ESCALATED = "ESCALATED"
    PAUSED_FALLBACK = "PAUSED_FALLBACK"  # provider rate-limited / unreachable


class ToneStyle(str, Enum):
    COOPERATIVE = "cooperative"
    ASSERTIVE = "assertive"
    FIRM = "firm"


class ConcessionStrategy(str, Enum):
    BOULWARE = "boulware"    # concede slowly — beta > 1
    CONCEDER = "conceder"    # concede quickly — beta = 1
    LINEAR = "linear"        # constant rate — beta = 1 (alias)


class EventType(str, Enum):
    TURN_COMPLETE = "turn_complete"
    DEAL_REACHED = "deal_reached"
    DEADLOCK = "deadlock"
    ESCALATED = "escalated"
    BARGE_IN = "barge_in"
    HARD_LIMIT_SET = "hard_limit_set"
    FALLBACK_ACTIVE = "fallback_active"
    FULL_OUTAGE = "full_outage"
    SESSION_START = "session_start"


# ─────────────────────────────────────────────────────────────────────────────
# Human Brief
# ─────────────────────────────────────────────────────────────────────────────

class HumanBrief(BaseModel):
    """
    What a human tells their agent privately before the negotiation starts.
    This is the ONLY ground truth for the grounding guardrail — the agent
    may never claim a constraint that isn't derivable from this object.
    """
    agent_id: AgentId
    name: str = Field(description="Human's first name, used by their agent")

    # The negotiation variable (e.g. cost share %)
    initial_position: float = Field(
        description="Opening offer (e.g. 30 for '30% of cost')"
    )
    floor: float = Field(
        description="Minimum acceptable outcome — walk-away limit. Agent must never go below this."
    )
    ceiling: float = Field(
        description="Maximum acceptable outcome — best-case hope."
    )

    # Tone and strategy
    tone: ToneStyle = ToneStyle.ASSERTIVE
    strategy: ConcessionStrategy = ConcessionStrategy.BOULWARE

    # Free-text private context (visible ONLY to this agent's system prompt)
    private_context: str = Field(
        default="",
        description="Why I feel this way — private reasoning that shapes my agent's behaviour.",
        max_length=500,
    )

    # What we're negotiating (injected into the scenario description)
    dispute_topic: str = Field(
        default="cost split for a shared appliance repair",
        description="Short description of what is being negotiated.",
    )

    # Currency / unit label for offers
    unit_label: str = Field(
        default="%",
        description="Unit for offers, e.g. '%', '₹', 'minutes'",
    )

    # Language for this agent (e.g. 'Hindi', 'Bengali', 'Tamil', 'English')
    language: str = Field(
        default="English",
        description="Language the human and agent communicate in, e.g. 'Hindi', 'Bengali', 'Tamil', 'English'",
    )

    @model_validator(mode="after")
    def validate_limits(self) -> HumanBrief:
        # Auto-swap if the user entered floor > ceiling (common when
        # "better" means a lower number, e.g. Agent B wants to pay less).
        if self.floor > self.ceiling:
            self.floor, self.ceiling = self.ceiling, self.floor
        if not (self.floor <= self.initial_position <= self.ceiling):
            # Clamp initial_position silently rather than error — UX nicety
            self.initial_position = max(self.floor, min(self.ceiling, self.initial_position))
        return self


# ─────────────────────────────────────────────────────────────────────────────
# Negotiation Turn
# ─────────────────────────────────────────────────────────────────────────────

class NegotiationTurn(BaseModel):
    """A single negotiation move from one agent."""
    turn_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    agent_id: AgentId
    turn_number: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # The actual offer value (same unit as HumanBrief.floor/ceiling)
    offer: float
    previous_offer: Optional[float] = None

    # Natural-language explanation the other agent (and humans) see
    message: str

    # Grounding check results
    grounding_passed: bool = True
    grounding_flags: list[str] = Field(default_factory=list)

    # Concession analysis
    concession_delta: float = 0.0          # positive = concession made
    is_stall: bool = False                  # True if delta < MIN_CONCESSION_DELTA

    # Latency tracking
    llm_latency_ms: Optional[float] = None
    provider: Optional[str] = None         # "groq" | "gemini" | "mock"

    @property
    def is_concession(self) -> bool:
        return self.concession_delta > 0 and not self.is_stall


# ─────────────────────────────────────────────────────────────────────────────
# Session
# ─────────────────────────────────────────────────────────────────────────────

class SessionConfig(BaseModel):
    """Full session initialisation payload."""
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    brief_a: HumanBrief
    brief_b: HumanBrief

    @model_validator(mode="after")
    def validate_agents(self) -> SessionConfig:
        if self.brief_a.agent_id != AgentId.A:
            raise ValueError("brief_a must have agent_id=A")
        if self.brief_b.agent_id != AgentId.B:
            raise ValueError("brief_b must have agent_id=B")
        return self


class SessionState(BaseModel):
    """Mutable runtime state of a negotiation session."""
    session_id: str
    state: NegotiationState = NegotiationState.BRIEFING
    turns: list[NegotiationTurn] = Field(default_factory=list)
    current_agent: AgentId = AgentId.A
    deal_value: Optional[float] = None
    deadlock_reason: Optional[str] = None
    fallback_active: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_updated: datetime = Field(default_factory=datetime.utcnow)

    # Barge-in history
    barge_in_history: list[dict] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket Events
# ─────────────────────────────────────────────────────────────────────────────

class WSEvent(BaseModel):
    """Envelope for all WebSocket messages sent to the frontend."""
    event: EventType
    session_id: str
    payload: dict = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# API Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    brief_a: HumanBrief
    brief_b: HumanBrief


class StartSessionResponse(BaseModel):
    session_id: str
    message: str = "Session started. Connect to WebSocket to begin negotiation."
    ws_url: str


class BargeInRequest(BaseModel):
    session_id: str
    agent_id: AgentId  # which human is barging in
    text: str           # transcribed or typed message
    is_hard_limit: bool = False  # if True, this sets a new floor/ceiling


class BargeInResponse(BaseModel):
    accepted: bool
    message: str
    new_floor: Optional[float] = None
    new_ceiling: Optional[float] = None


class TranscriptResponse(BaseModel):
    session_id: str
    state: NegotiationState
    turns: list[NegotiationTurn]
    deal_value: Optional[float]
    deadlock_reason: Optional[str]


class HealthResponse(BaseModel):
    status: str
    providers: dict[str, bool]
    fallback_available: bool = True  # browser STT/TTS always available
    environment: str


class MetricsResponse(BaseModel):
    session_id: str
    total_turns: int
    avg_latency_ms: Optional[float]
    total_tokens_groq: int = 0
    total_tokens_gemini: int = 0
    estimated_cost_usd: float = 0.0  # always 0 on free tier
    provider_errors: dict[str, int] = Field(default_factory=dict)
