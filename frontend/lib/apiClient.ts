/**
 * Samjhauta — API Client
 * All backend calls in one place.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Brief {
  agent_id: "A" | "B";
  name: string;
  initial_position: number;
  floor: number;
  ceiling: number;
  tone: string;
  strategy: string;
  private_context: string;
  dispute_topic: string;
  unit_label: string;
  language?: string;
}

export interface NegotiationTurn {
  turn_id: string;
  agent_id: "A" | "B";
  turn_number: number;
  timestamp: string;
  offer: number;
  previous_offer: number | null;
  message: string;
  grounding_passed: boolean;
  grounding_flags: string[];
  concession_delta: number;
  is_stall: boolean;
  llm_latency_ms: number | null;
  provider: string | null;
}

export interface WSEvent {
  event: string;
  session_id: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export async function startSession(briefA: Brief, briefB: Brief): Promise<{ session_id: string; ws_url: string }> {
  const res = await fetch(`${API_BASE}/api/negotiate/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief_a: briefA, brief_b: briefB }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to start session");
  }
  return res.json();
}

export async function bargeIn(
  sessionId: string,
  agentId: "A" | "B",
  text: string,
  isHardLimit = false
): Promise<void> {
  await fetch(`${API_BASE}/api/negotiate/barge-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, agent_id: agentId, text, is_hard_limit: isHardLimit }),
  });
}

export async function transcribeAudio(
  audioBlob: Blob,
  sessionId: string,
  language?: string
): Promise<string> {
  const form = new FormData();
  form.append("audio", audioBlob, "audio.webm");
  form.append("session_id", sessionId);
  if (language && language !== "auto") {
    form.append("language", language);
  }
  const res = await fetch(`${API_BASE}/api/voice/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Transcription failed");
  const data = await res.json();
  return data.text;
}

export async function translateText(
  text: string,
  targetLang: string,
  sourceLang?: string
): Promise<string> {
  if (!text.trim() || targetLang.toLowerCase() === "original") return text;
  const res = await fetch(`${API_BASE}/api/voice/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_lang: targetLang,
      source_lang: sourceLang,
    }),
  });
  if (!res.ok) return text;
  const data = await res.json();
  return data.translated || text;
}

export function createWebSocket(sessionId: string): WebSocket {
  const httpBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const wsBase = httpBase.replace(/^http/, "ws"); // http→ws, https→wss
  return new WebSocket(`${wsBase}/ws/negotiate/${sessionId}`);
}

export async function getHealth(): Promise<{ status: string; providers: Record<string, boolean> }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}
