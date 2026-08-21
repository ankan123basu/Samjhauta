"""
Samjhauta — Observability: Structured Logger
Uses structlog for JSON output. Every negotiation event is logged with
session_id, agent, turn, latency, and token counts for the /metrics endpoint.
"""
import logging
import sys
import structlog
from app.config import settings


def setup_logging() -> None:
    """Configure structlog for JSON output."""
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer() if settings.environment == "production"
            else structlog.dev.ConsoleRenderer(colors=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )
