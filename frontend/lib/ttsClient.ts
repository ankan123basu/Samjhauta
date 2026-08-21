/**
 * Samjhauta — TTS Client (browser speechSynthesis)
 * Completely $0 — no API key, no network call.
 * Provides distinct voices for Agent A and Agent B.
 */

export interface VoiceHint {
  name: string;
  lang: string;
  pitch: number;
  rate: number;
  fallback_lang: string;
}

let synthVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): void {
  synthVoices = window.speechSynthesis.getVoices();
}

function pickVoice(hint: VoiceHint): SpeechSynthesisVoice | null {
  if (!synthVoices.length) loadVoices();
  // Try exact name first
  const exact = synthVoices.find((v) => v.name === hint.name);
  if (exact) return exact;
  // Try by lang
  const byLang = synthVoices.find((v) => v.lang.startsWith(hint.lang));
  if (byLang) return byLang;
  // Fallback: any English voice
  return synthVoices.find((v) => v.lang.startsWith(hint.fallback_lang)) || null;
}

export function speak(text: string, hint: VoiceHint, agentId: "A" | "B"): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel(); // cancel any ongoing speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = hint.pitch;
    utterance.rate = hint.rate;
    utterance.volume = 0.9;

    const voice = pickVoice(hint);
    if (voice) utterance.voice = voice;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // resolve on error too — don't block UI

    window.speechSynthesis.speak(utterance);
  });
}

export function cancelSpeech(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export function isTTSAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Preload voices (browsers load them async on first call)
if (typeof window !== "undefined") {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}
