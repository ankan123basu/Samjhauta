"""
Samjhauta — STT (Speech-to-Text) for human barge-in
=====================================================
Primary:  Groq Whisper (whisper-large-v3-turbo) via /api/voice/transcribe
Fallback: Browser SpeechRecognition API (handled client-side, text POSTed directly)

This module is strictly isolated from negotiation logic — it only converts
audio bytes → text. The negotiation engine receives the text string, never audio.
"""
from __future__ import annotations

import io
from typing import Optional
import structlog

from app.config import settings

log = structlog.get_logger(__name__)


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "audio.webm",
    language: Optional[str] = None,
) -> str:
    """
    Transcribe audio bytes using Groq Whisper.
    Returns the transcribed text string.
    Raises ProviderRateLimitError on 429, RuntimeError on other failures.
    """
    if not settings.groq_configured:
        raise RuntimeError("Groq API key not configured — use browser SpeechRecognition fallback.")

    try:
        import groq as groq_sdk
        client = groq_sdk.Groq(api_key=settings.get_groq_api_key)

        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = filename

        kwargs = {
            "file": (filename, audio_bytes),
            "model": settings.groq_whisper_model,
            "response_format": "text",
        }
        # If specific ISO language provided (e.g. 'hi', 'bn', 'ta', 'te'), pass it
        if language and language != "auto":
            # Extract 2-letter ISO code if format is like 'hi-IN'
            iso_lang = language.split("-")[0].lower()
            kwargs["language"] = iso_lang

        transcription = client.audio.transcriptions.create(**kwargs)

        text = transcription if isinstance(transcription, str) else transcription.text
        log.info("transcription_complete", chars=len(text), language=language)
        return text.strip()

    except Exception as exc:
        err = str(exc)
        log.error("stt_error", error=err)
        if "429" in err or "rate_limit" in err.lower():
            from app.agents.agent_a_groq import ProviderRateLimitError
            raise ProviderRateLimitError(f"Whisper rate limited: {err}") from exc
        raise RuntimeError(f"STT failed: {err}") from exc
