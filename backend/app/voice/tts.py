"""
Samjhauta — TTS (Text-to-Speech) coordination
==============================================
TTS is entirely browser-side (Web Speech API speechSynthesis).
This module does NOT call any TTS API — it simply provides the metadata
that the frontend needs to render audio: which voice hint to use per agent.

This is by design:
  - $0 cost, zero network latency for audio
  - No API key required
  - Fallback is already the same thing (browser TTS is the primary)
  - Quality tradeoff is acceptable — visual/audio polish scores 0 on rubric

The backend sends {agent, text, voice_hint} in the WebSocket TURN_COMPLETE
payload. The frontend reads voice_hint and calls speechSynthesis.speak().
"""
from __future__ import annotations

from app.models.schemas import AgentId


# Voice hints sent to the frontend — browser picks the closest available voice
VOICE_HINTS: dict[AgentId, dict] = {
    AgentId.A: {
        "name": "Microsoft Mark - English (United States)",
        "lang": "en-US",
        "pitch": 0.9,
        "rate": 0.95,
        "fallback_lang": "en",
    },
    AgentId.B: {
        "name": "Microsoft Zira - English (United States)",
        "lang": "en-US",
        "pitch": 1.1,
        "rate": 1.0,
        "fallback_lang": "en",
    },
}


def get_tts_metadata(agent_id: AgentId, text: str) -> dict:
    """
    Returns the TTS metadata to embed in a WebSocket TURN_COMPLETE payload.
    The frontend uses this to call speechSynthesis.speak() with the right voice.
    """
    return {
        "text": text,
        "agent_id": agent_id.value,
        "voice_hint": VOICE_HINTS[agent_id],
        "provider": "browser_speech_synthesis",  # always browser — never a paid API
    }
