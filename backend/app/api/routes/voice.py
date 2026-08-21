"""Voice transcription route — receives audio from the frontend for Groq Whisper STT."""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from app.voice.stt import transcribe_audio
from app.config import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
) -> dict:
    """
    Receive audio blob from the frontend, transcribe via Groq Whisper.
    On failure, the frontend falls back to browser SpeechRecognition.
    """
    if not settings.groq_configured:
        raise HTTPException(
            status_code=503,
            detail="Groq not configured — use browser SpeechRecognition fallback.",
        )

    audio_bytes = await audio.read()
    if len(audio_bytes) > 25 * 1024 * 1024:  # Groq 25MB limit
        raise HTTPException(status_code=413, detail="Audio file too large (max 25MB).")

    try:
        text = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
        return {"text": text, "session_id": session_id, "provider": "groq_whisper"}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
