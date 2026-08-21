"""
Samjhauta — Negotiate API Routes
WebSocket + REST endpoints for the negotiation engine.
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.agents.provider_fallback import make_groq_agent, make_groq_agent_b, make_gemini_agent, make_mock_agent
from app.config import settings
from app.models.schemas import (
    AgentId,
    BargeInRequest,
    BargeInResponse,
    SessionConfig,
    StartSessionRequest,
    StartSessionResponse,
    TranscriptResponse,
)
from app.negotiation.state_machine import NegotiationSession, registry

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/negotiate", tags=["negotiate"])


def _build_session(config: SessionConfig) -> NegotiationSession:
    """Factory: creates a session with real or mock agents based on API key config."""
    if settings.groq_configured:
        agent_a = make_groq_agent()
    else:
        log.warning("groq_not_configured_using_mock")
        agent_a = make_mock_agent(AgentId.A)

    if settings.groq_configured:
        agent_b = make_groq_agent_b()
    else:
        log.warning("groq_b_not_configured_using_mock")
        agent_b = make_mock_agent(AgentId.B)

    # Shared Groq client for grounding guardrail extraction (optional)
    groq_client = None
    if settings.groq_configured:
        try:
            import groq as groq_sdk
            groq_client = groq_sdk.Groq(api_key=settings.get_groq_api_key)
        except Exception:
            pass

    return NegotiationSession(
        config=config,
        agent_a_fn=agent_a,
        agent_b_fn=agent_b,
        groq_client=groq_client,
    )


# ── REST: Start session ────────────────────────────────────────────────────────

@router.post("/start", response_model=StartSessionResponse)
async def start_session(
    body: StartSessionRequest,
    background_tasks: BackgroundTasks,
) -> StartSessionResponse:
    """Submit both human briefs and start a negotiation session."""
    config = SessionConfig(brief_a=body.brief_a, brief_b=body.brief_b)
    session = _build_session(config)
    registry.create(session)

    # Launch the negotiation loop as a background task
    background_tasks.add_task(session.run)

    log.info("session_created", session_id=config.session_id)

    return StartSessionResponse(
        session_id=config.session_id,
        ws_url=f"ws://localhost:{settings.port}/ws/negotiate/{config.session_id}",
    )


# ── REST: Barge-in ─────────────────────────────────────────────────────────────

@router.post("/barge-in", response_model=BargeInResponse)
async def barge_in(body: BargeInRequest) -> BargeInResponse:
    """Human override mid-negotiation (typed text or already-transcribed speech)."""
    session = registry.get(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    result = await session.barge_in(body)
    return BargeInResponse(**result)


# ── REST: Set hard limit ───────────────────────────────────────────────────────

@router.post("/set-limit")
async def set_hard_limit(body: BargeInRequest) -> dict:
    """Set a new floor/ceiling mid-negotiation (hard limit override)."""
    body.is_hard_limit = True
    session = registry.get(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    result = await session.barge_in(body)
    return result


# ── REST: Get transcript ──────────────────────────────────────────────────────

@router.get("/{session_id}/transcript", response_model=TranscriptResponse)
async def get_transcript(session_id: str) -> TranscriptResponse:
    """Full transcript of all turns for a session."""
    session = registry.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    return TranscriptResponse(
        session_id=session_id,
        state=session.state.state,
        turns=session.state.turns,
        deal_value=session.state.deal_value,
        deadlock_reason=session.state.deadlock_reason,
    )


# ── WebSocket: Live negotiation feed ──────────────────────────────────────────

@router.websocket("/ws/negotiate/{session_id}")
async def ws_negotiate(websocket: WebSocket, session_id: str) -> None:
    """
    WebSocket endpoint. Streams all negotiation events to the frontend in real time.
    The frontend listens for TURN_COMPLETE, DEAL_REACHED, DEADLOCK, ESCALATED,
    FALLBACK_ACTIVE, and BARGE_IN events.
    """
    await websocket.accept()
    log.info("ws_connected", session_id=session_id)

    session = registry.get(session_id)
    if not session:
        await websocket.send_json({"error": "Session not found", "session_id": session_id})
        await websocket.close()
        return

    queue = session.subscribe()

    try:
        while True:
            # Wait for events from the negotiation engine
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(event)

                # Also handle incoming messages from the frontend (e.g., ping/pong)
                try:
                    msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.01)
                    data = json.loads(msg)
                    if data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except (asyncio.TimeoutError, Exception):
                    pass

            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        log.info("ws_disconnected", session_id=session_id)
    finally:
        session.unsubscribe(queue)
