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
    google_api_key: str = Field(default="", description="Google AI Studio API key — free tier")
    groq_api_keys: list[str] = Field(default_factory=list)
    groq_api_key: str = "" # Fallback
    
    @property
    def get_groq_api_key(self) -> str:
        """Return a random Groq API key from the available pool."""
        import random
        import os
        from pathlib import Path
        from dotenv import dotenv_values
        
        # Use absolute path to backend/.env (config.py lives in backend/app/)
        env_path = Path(__file__).resolve().parent.parent / ".env"
        env_dict = dotenv_values(str(env_path)) if env_path.exists() else {}
        
        keys = set()
        # 1. Pull from .env file directly
        for k, v in env_dict.items():
            if k.startswith("GROQ_API_KEY") and v and k != "GROQ_API_KEY":
                keys.add(v)
        # 2. Also pull from os.environ (in case keys are set there)
        for k, v in os.environ.items():
            if k.startswith("GROQ_API_KEY") and v and k != "GROQ_API_KEY":
                keys.add(v)
        
        # If no numbered keys found at all, fall back to the base GROQ_API_KEY
        if not keys:
            base = env_dict.get("GROQ_API_KEY", "") or os.environ.get("GROQ_API_KEY", "")
            if base:
                keys.add(base)
        
        return random.choice(list(keys)) if keys else ""

    # ── Model identifiers ─────────────────────────────────────────────────────
    groq_model: str = "openai/gpt-oss-120b"
    groq_model_b: str = "openai/gpt-oss-20b"
    groq_guardrail_model: str = "allam-2-7b"
    groq_whisper_model: str = "whisper-large-v3-turbo"
    gemini_model: str = "gemini-3.6-flash"

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
    turn_delay_seconds: float = 4.0     # natural pacing between turns for audio/reading (gTTS playback)

    # ── Rate limit awareness (informational — not enforced, just logged) ───────
    groq_rpm_limit: int = 30
    groq_rpd_limit: int = 1000
    gemini_rpm_limit: int = 15

    @property
    def groq_configured(self) -> bool:
        return bool(self.get_groq_api_key)

    @property
    def gemini_configured(self) -> bool:
        return bool(self.google_api_key and self.google_api_key != "your_google_api_key_here")


settings = Settings()
