/**
 * Samjhauta — Multilingual Sequential TTS Client
 * ===============================================
 * Features:
 *   1. Automatic script-based language detection (Devanagari, Bengali, Tamil, Telugu, Gujarati, etc.)
 *   2. Sequential Speech Queue: prevents overlapping speech and ensures each agent speaks cleanly to completion.
 *   3. Non-English (Hindi, Bengali, Tamil, etc.) → Always routes through server-side gTTS MP3 audio stream.
 *   4. English → Browser SpeechSynthesis API with server gTTS fallback.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface VoiceHint {
  name: string;
  lang: string;
  pitch: number;
  rate: number;
  fallback_lang: string;
}

interface QueuedUtterance {
  text: string;
  hint?: Partial<VoiceHint>;
  agentId: "A" | "B";
  targetLang: string;
  resolve: () => void;
}

let speechQueue: QueuedUtterance[] = [];
let isProcessingQueue = false;
let currentAudio: HTMLAudioElement | null = null;

// ── Language & Script Detection ───────────────────────────────────────────────

const LANG_TO_CODE: Record<string, string> = {
  "hindi": "hi",
  "hi": "hi",
  "bengali": "bn",
  "bn": "bn",
  "tamil": "ta",
  "ta": "ta",
  "telugu": "te",
  "te": "te",
  "marathi": "mr",
  "mr": "mr",
  "gujarati": "gu",
  "gu": "gu",
  "kannada": "kn",
  "kn": "kn",
  "malayalam": "ml",
  "ml": "ml",
  "punjabi": "pa",
  "pa": "pa",
  "urdu": "ur",
  "ur": "ur",
  "odia": "or",
  "or": "or",
  "english": "en",
  "en": "en",
};

/**
 * Auto-detect language code from Unicode script ranges if text contains Indic characters
 */
function detectScriptLanguage(text: string, fallbackLang: string): string {
  if (/[\u0900-\u097F]/.test(text)) return fallbackLang.toLowerCase().includes("mr") ? "mr" : "hi"; // Devanagari (Hindi / Marathi)
  if (/[\u0980-\u09FF]/.test(text)) return "bn"; // Bengali / Assamese
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta"; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return "te"; // Telugu
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu"; // Gujarati
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn"; // Kannada
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml"; // Malayalam
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa"; // Gurmukhi (Punjabi)
  if (/[\u0600-\u06FF]/.test(text)) return "ur"; // Arabic / Urdu

  const normalized = fallbackLang.toLowerCase().trim();
  return LANG_TO_CODE[normalized] || normalized.split("-")[0] || "en";
}

function isEnglish(langCode: string): boolean {
  return langCode === "en" || langCode === "en-us" || langCode === "en-gb";
}

// ── Server TTS Playback ───────────────────────────────────────────────────────

function b64toBlobUrl(b64Data: string, contentType = "audio/mp3"): string {
  const byteCharacters = atob(b64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: contentType });
  return URL.createObjectURL(blob);
}

async function playServerTTS(text: string, langCode: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: langCode }),
    });

    if (!res.ok) {
      console.warn(`[TTS] Server TTS returned ${res.status} for lang=${langCode}`);
      return;
    }

    const data = await res.json();
    if (data.audio) {
      return new Promise((resolve) => {
        if (currentAudio) {
          try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
        }

        const blobUrl = b64toBlobUrl(data.audio, "audio/mp3");
        const audio = new Audio(blobUrl);
        currentAudio = audio;

        const cleanup = () => {
          currentAudio = null;
          URL.revokeObjectURL(blobUrl);
          resolve();
        };

        audio.onended = cleanup;
        audio.onerror = cleanup;
        audio.play().catch(cleanup);
      });
    }
  } catch (err) {
    console.warn("[TTS] Server playback error:", err);
  }
}

// ── Browser English TTS ───────────────────────────────────────────────────────

function playBrowserTTS(
  text: string,
  agentId: "A" | "B",
  hint?: Partial<VoiceHint>
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.pitch = hint?.pitch ?? (agentId === "A" ? 0.9 : 1.15);
      utterance.rate = hint?.rate ?? 0.98;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const enVoices = voices.filter((v) => v.lang.startsWith("en"));
        if (enVoices.length > 0) {
          if (agentId === "A") {
            const male = enVoices.find(
              (v) =>
                v.name.toLowerCase().includes("male") ||
                v.name.toLowerCase().includes("david") ||
                v.name.toLowerCase().includes("mark")
            );
            utterance.voice = male || enVoices[0];
          } else {
            const female = enVoices.find(
              (v) =>
                v.name.toLowerCase().includes("female") ||
                v.name.toLowerCase().includes("zira") ||
                v.name.toLowerCase().includes("hazel")
            );
            utterance.voice = female || enVoices[enVoices.length > 1 ? 1 : 0];
          }
        }
      }

      let didFinish = false;
      utterance.onend = () => {
        didFinish = true;
        resolve();
      };
      utterance.onerror = () => {
        if (!didFinish) {
          didFinish = true;
          resolve();
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve();
    }
  });
}

// ── Speech Queue Worker ───────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (speechQueue.length > 0) {
    const item = speechQueue.shift();
    if (!item) break;

    const { text, hint, agentId, targetLang, resolve } = item;
    const resolvedLang = detectScriptLanguage(text, targetLang);

    if (!isEnglish(resolvedLang)) {
      console.log(`[TTS] Speaking in '${resolvedLang}' via Server gTTS (Agent ${agentId})`);
      await playServerTTS(text, resolvedLang);
    } else {
      console.log(`[TTS] Speaking in English (Agent ${agentId})`);
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          await playBrowserTTS(text, agentId, hint);
        } catch {
          await playServerTTS(text, "en");
        }
      } else {
        await playServerTTS(text, "en");
      }
    }

    resolve();
  }

  isProcessingQueue = false;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueues speech and executes sequentially to prevent agents interrupting each other.
 */
export function speak(
  text: string,
  hint?: Partial<VoiceHint>,
  agentId: "A" | "B" = "A",
  targetLang: string = "en"
): Promise<void> {
  return new Promise((resolve) => {
    if (!text || !text.trim()) {
      resolve();
      return;
    }

    speechQueue.push({
      text,
      hint,
      agentId,
      targetLang,
      resolve,
    });

    processQueue();
  });
}

export function cancelSpeech(): void {
  speechQueue = [];
  isProcessingQueue = false;

  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }

  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {}
    currentAudio = null;
  }
}

export function isTTSAvailable(): boolean {
  return true;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
  window.speechSynthesis.getVoices();
}
