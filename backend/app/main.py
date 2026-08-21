"""
Samjhauta — FastAPI Application Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.observability.logger import setup_logging
from app.api.routes import negotiate, health, metrics, voice
from app.config import settings

setup_logging()

app = FastAPI(
    title="Samjhauta — AI Negotiation Engine",
    description="Two AI agents negotiate on behalf of two humans. Dual-provider: Groq Llama 3.3 70B Versatile × Google Gemini 2.5 Flash.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for hackathon demo; lock down in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(negotiate.router)
app.include_router(health.router)
app.include_router(metrics.router)
app.include_router(voice.router)

# WebSocket route is defined inline in negotiate.py using the full path
# (FastAPI APIRouter doesn't support WebSocket prefix cleanly, so we register
#  the WS route at the app level here)
from app.api.routes.negotiate import ws_negotiate  # noqa: E402
app.add_api_websocket_route("/ws/negotiate/{session_id}", ws_negotiate)


@app.get("/")
async def root():
    return {
        "name": "Samjhauta",
        "tagline": "Two AI agents. One dispute. Zero fake agreements.",
        "providers": {
            "agent_a": "Groq Llama 3.3 70B Versatile",
            "agent_b": "Google Gemini 2.5 Flash",
        },
        "groq_configured": settings.groq_configured,
        "gemini_configured": settings.gemini_configured,
        "docs": "/docs",
    }
