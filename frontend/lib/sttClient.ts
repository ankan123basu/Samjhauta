/**
 * Samjhauta — STT Client (human barge-in)
 * Primary: Groq Whisper via backend /api/voice/transcribe
 * Fallback: browser SpeechRecognition API (works offline, no key)
 * Supports all major Indic and world languages (Hindi, Bengali, Tamil, etc.)
 */

import { transcribeAudio } from "./apiClient";

export type STTMode = "groq" | "browser" | "unavailable";

// ── Type declarations for browser SpeechRecognition ──────────────────────────

type SREvent = Event & {
  results: { [index: number]: { [index: number]: { transcript: string } } };
};

type SRErrorEvent = Event & { error: string };

interface SRInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

type SRConstructor = new () => SRInstance;

// ── Browser SpeechRecognition factory ─────────────────────────────────────────

let recognition: SRInstance | null = null;

function getBrowserSR(lang: string = "en-US"): SRInstance | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  const SR: SRConstructor | undefined = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = false;
  r.interimResults = false;
  r.lang = lang;
  return r;
}

export function detectSTTMode(): STTMode {
  if (typeof window === "undefined") return "unavailable";
  return "groq"; // Always try Groq first; backend handles the key check
}

// ── Groq Whisper via MediaRecorder ────────────────────────────────────────────

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];

export async function startRecording(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };
  mediaRecorder.start();
}

export async function stopRecordingAndTranscribe(
  sessionId: string,
  language?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error("No active recording"));
      return;
    }

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      try {
        const text = await transcribeAudio(audioBlob, sessionId, language);
        resolve(text);
      } catch {
        resolve(""); // Fallback: empty string, caller uses browser SR
      }
    };

    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
  });
}

export function isRecording(): boolean {
  return mediaRecorder !== null && mediaRecorder.state === "recording";
}

// ── Browser SpeechRecognition fallback ────────────────────────────────────────

export function startBrowserFallback(
  onResult: (text: string) => void,
  onError: (err: string) => void,
  language: string = "en-US"
): void {
  recognition = getBrowserSR(language);
  if (!recognition) {
    onError("Speech recognition not available in this browser.");
    return;
  }

  recognition.onresult = (e: SREvent) => {
    const text = e.results[0]?.[0]?.transcript || "";
    onResult(text);
  };

  recognition.onerror = (e: SRErrorEvent) => onError(e.error);
  recognition.start();
}

export function stopBrowserFallback(): void {
  recognition?.stop();
  recognition = null;
}

export function isSTTAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(win.SpeechRecognition ?? win.webkitSpeechRecognition ?? navigator.mediaDevices);
}
