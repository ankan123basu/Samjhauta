"""Metrics route — per-session token/latency/cost tracking."""
from fastapi import APIRouter, HTTPException
from app.models.schemas import MetricsResponse
from app.negotiation.state_machine import registry

router = APIRouter(prefix="/api", tags=["metrics"])


@router.get("/metrics/{session_id}", response_model=MetricsResponse)
async def get_metrics(session_id: str) -> MetricsResponse:
    """Per-session metrics: latency, tokens, cost estimate, provider errors."""
    session = registry.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    m = session.metrics()
    return MetricsResponse(**{k: v for k, v in m.items() if k in MetricsResponse.model_fields})
