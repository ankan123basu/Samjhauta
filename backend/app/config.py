"""
Samjhauta — Application Configuration
Reads from .env via pydantic-settings. All values have sensible defaults so
the app starts even without a .env (useful in tests with mocked providers).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Provider keys ─────────────────────────────────────────────────────────
    groq_api_key: str = Field(default="", description="Groq API key — free tier")
    google_api_key: str = Field(default="", description="Google AI Studio API key — free tier")

    # ── Model identifiers ─────────────────────────────────────────────────────
    groq_model: str = "llama-3.3-70b-versatile"
    groq_whisper_model: str = "whisper-large-v3-turbo"
    gemini_model: str = "gemini-2.5-flash"

    # ── Server ────────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    environment: str = "development"

    # ── Negotiation engine tuning ─────────────────────────────────────────────
    max_turns: int = 20
    deadlock_window: int = 5          # sliding window size for deadlock detector
    convergence_threshold: float = 0.5  # minimum per-turn delta to count as "moving"
    min_concession_delta: float = 0.5   # stall detection threshold

    # ── Rate limit awareness (informational — not enforced, just logged) ───────
    groq_rpm_limit: int = 30
    groq_rpd_limit: int = 1000
    gemini_rpm_limit: int = 15

    @property
    def groq_configured(self) -> bool:
        return bool(self.groq_api_key and self.groq_api_key != "your_groq_api_key_here")

    @property
    def gemini_configured(self) -> bool:
        return bool(self.google_api_key and self.google_api_key != "your_google_api_key_here")


settings = Settings()
