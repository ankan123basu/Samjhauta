"""Health check route."""
from fastapi import APIRouter
from app.config import settings
from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Quick liveness check. Also probes provider connectivity."""
    groq_ok = settings.groq_configured
    gemini_ok = settings.gemini_configured

    # Quick connectivity probe (non-blocking, best-effort)
    if groq_ok:
        try:
            import httpx, asyncio
            async with httpx.AsyncClient(timeout=2.0) as c:
                r = await c.get("https://api.groq.com/openai/v1/models",
                                headers={"Authorization": f"Bearer {settings.get_groq_api_key}"})
                groq_ok = r.status_code in (200, 401)  # 401 = key invalid but server up
        except Exception:
            groq_ok = False

    return HealthResponse(
        status="ok",
        providers={"groq": groq_ok, "gemini": gemini_ok},
        fallback_available=True,
        environment=settings.environment,
    )
