"""Voice transcription, real-time translation, and multilingual TTS routes."""
from __future__ import annotations

import base64
from typing import Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
import httpx

from app.voice.stt import transcribe_audio
from app.config import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])


class TranslateRequest(BaseModel):
    text: str = Field(..., description="Text to translate")
    target_lang: str = Field(..., description="Target language name or code (e.g., 'Hindi', 'hi', 'bn', 'Tamil')")
    source_lang: Optional[str] = Field(default=None, description="Optional source language")


class TranslateResponse(BaseModel):
    translated: str
    target_lang: str
    source_lang: Optional[str] = None
    provider: str = "groq"


class TTSRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize")
    lang: str = Field(default="en", description="Language code e.g. 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'en'")


class TTSResponse(BaseModel):
    audio: str  # Base64 encoded MP3 audio
    lang: str
    provider: str = "google_tts"


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    language: Optional[str] = Form(None),
) -> dict:
    """
    Receive audio blob from the frontend, transcribe via Groq Whisper.
    Supports optional language code (e.g. 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'en').
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
        text = await transcribe_audio(
            audio_bytes,
            filename=audio.filename or "audio.webm",
            language=language,
        )
        return {
            "text": text,
            "session_id": session_id,
            "provider": "groq_whisper",
            "language": language or "auto",
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/translate", response_model=TranslateResponse)
async def translate(body: TranslateRequest) -> TranslateResponse:
    """
    Translate negotiation turns or messages into the target language using Groq.
    Preserves numbers, percentages, and entity names for negotiation precision.
    """
    text = body.text.strip()
    if not text:
        return TranslateResponse(translated="", target_lang=body.target_lang, source_lang=body.source_lang)

    target_lang = body.target_lang.strip()
    if target_lang.lower() in ("original", "source", "en", "english") and not body.source_lang:
        # If no specific translation needed
        pass

    if not settings.groq_configured:
        # Fallback return original text if no key
        return TranslateResponse(translated=text, target_lang=target_lang, provider="noop")

    try:
        import groq as groq_sdk

        client = groq_sdk.Groq(api_key=settings.get_groq_api_key)

        prompt = (
            f"You are a professional negotiation translator.\n"
            f"Translate the following dispute negotiation text into {target_lang}.\n"
            f"RULES:\n"
            f"1. Keep all numbers, percentages (e.g. 50%), currency amounts (e.g. ₹5,000, $500), and proper names accurately preserved.\n"
            f"2. Keep the negotiation tone intact (cooperative, assertive, firm).\n"
            f"3. Return ONLY the translated text with no conversational preamble, no quotes, and no extra notes.\n\n"
            f"Text to translate:\n{text}"
        )

        model_to_use = getattr(settings, "groq_guardrail_model", "allam-2-7b") or "allam-2-7b"

        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a precise, faithful language translator."},
                {"role": "user", "content": prompt},
            ],
            model=model_to_use,
            temperature=0.3,
            max_tokens=400,
        )

        translated = completion.choices[0].message.content.strip()
        # Remove accidental surrounding quotes
        if (translated.startswith('"') and translated.endswith('"')) or (translated.startswith("'") and translated.endswith("'")):
            translated = translated[1:-1].strip()

        return TranslateResponse(
            translated=translated,
            target_lang=target_lang,
            source_lang=body.source_lang,
            provider="groq",
        )

    except Exception as exc:
        # Return graceful degradation with original text rather than 500
        return TranslateResponse(
            translated=text,
            target_lang=target_lang,
            source_lang=body.source_lang,
            provider=f"fallback_error: {str(exc)}",
        )


LANG_CODE_ISO: dict[str, str] = {
    "hindi": "hi",
    "bengali": "bn",
    "tamil": "ta",
    "telugu": "te",
    "marathi": "mr",
    "gujarati": "gu",
    "kannada": "kn",
    "malayalam": "ml",
    "punjabi": "pa",
    "urdu": "ur",
    "odia": "or",
    "assamese": "as",
    "english": "en",
}


@router.post("/tts", response_model=TTSResponse)
async def synthesize_tts(body: TTSRequest) -> TTSResponse:
    """
    Synthesizes multilingual speech audio for Indic and world languages.
    Uses gTTS (Google Text-to-Speech) library for reliable Indic language support.
    Returns Base64 encoded MP3 audio.
    
    Supported languages: Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati,
    Kannada, Malayalam, Punjabi, Urdu, Odia, English, and 50+ more.
    """
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    raw_lang = body.lang.strip().lower()
    lang_code = LANG_CODE_ISO.get(raw_lang, raw_lang.split("-")[0])

    try:
        from gtts import gTTS
        import io

        # Use co.in TLD for ultra-fast, authentic native Indic pronunciation
        tld = "co.in" if lang_code in ["hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur", "or", "as"] else "com"
        tts = gTTS(text=text[:1000], lang=lang_code, tld=tld, slow=False)
        
        audio_buffer = io.BytesIO()
        tts.write_to_fp(audio_buffer)
        audio_buffer.seek(0)
        
        audio_b64 = base64.b64encode(audio_buffer.read()).decode("utf-8")
        return TTSResponse(audio=audio_b64, lang=lang_code, provider="gtts")

    except ImportError:
        # gTTS not installed — fall back to raw Google Translate TTS
        try:
            url = "https://translate.google.com/translate_tts"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            params = {
                "ie": "UTF-8",
                "client": "tw-ob",
                "tl": lang_code,
                "q": text[:500],
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code, detail="TTS service error")
                audio_b64 = base64.b64encode(resp.content).decode("utf-8")
                return TTSResponse(audio=audio_b64, lang=lang_code, provider="google_tts_raw")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"TTS synthesis failed: {str(exc)}")

    except ValueError as ve:
        # gTTS raises ValueError for unsupported languages
        raise HTTPException(status_code=400, detail=f"Language '{lang_code}' not supported for TTS: {str(ve)}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"TTS synthesis failed: {str(exc)}")

