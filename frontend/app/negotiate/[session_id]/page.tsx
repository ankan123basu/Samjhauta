"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AgentPanel from "@/components/AgentPanel";
import OfferCurve from "@/components/OfferCurve";
import { bargeIn, createWebSocket, type NegotiationTurn } from "@/lib/apiClient";
import { speak, cancelSpeech, isTTSAvailable } from "@/lib/ttsClient";
import {
  startRecording,
  stopRecordingAndTranscribe,
  isRecording,
  startBrowserFallback,
} from "@/lib/sttClient";
import styles from "./page.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleInfo {
  floor: number;
  ceiling: number;
  current: number | null;
}

type SessionStatus =
  | "CONNECTING"
  | "NEGOTIATING"
  | "DEAL_REACHED"
  | "ESCALATED"
  | "DEADLOCKED"
  | "PAUSED_FALLBACK"
  | "ERROR";

const STATUS_LABELS: Record<SessionStatus, string> = {
  CONNECTING:      "⏳ Connecting…",
  NEGOTIATING:     "🤝 Negotiating",
  DEAL_REACHED:    "🎉 Deal Reached!",
  ESCALATED:       "🚨 Escalated to Humans",
  DEADLOCKED:      "🔒 Deadlocked",
  PAUSED_FALLBACK: "⚠️ Fallback Mode",
  ERROR:           "❌ Error",
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NegotiatePage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.session_id as string;

  // ── State ──
  const [status, setStatus] = useState<SessionStatus>("CONNECTING");
  const [turns, setTurns] = useState<NegotiationTurn[]>([]);
  const [currentAgent, setCurrentAgent] = useState<"A" | "B">("A");
  const [speakingAgent, setSpeakingAgent] = useState<"A" | "B" | null>(null);
  const [dealValue, setDealValue] = useState<number | null>(null);
  const [deadlockReason, setDeadlockReason] = useState<string | null>(null);
  const [fallbackMsg, setFallbackMsg] = useState<string | null>(null);
  const [scheduleA, setScheduleA] = useState<ScheduleInfo>({ floor: 0, ceiling: 100, current: null });
  const [scheduleB, setScheduleB] = useState<ScheduleInfo>({ floor: 0, ceiling: 100, current: null });
  const [unitLabel, setUnitLabel] = useState("%");
  const [maxTurns, setMaxTurns] = useState(20);
  const [bargeText, setBargeText] = useState("");
  const [isRecordingSTT, setIsRecordingSTT] = useState(false);
  const [bargeTarget, setBargeTarget] = useState<"A" | "B">("A");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);
  const [turnCount, setTurnCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const ttsAvail = isTTSAvailable();

  // ── WebSocket connection ──────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;

    const ws = createWebSocket(sessionId);
    wsRef.current = ws;

    ws.onopen = () => setStatus("CONNECTING");

    ws.onmessage = async (evt) => {
      const event = JSON.parse(evt.data);
      await handleWSEvent(event);
    };

    ws.onerror = () => setStatus("ERROR");
    ws.onclose = () => {
      if (status === "NEGOTIATING") setStatus("ERROR");
    };

    return () => {
      ws.close();
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns]);

  // ── Event handler ─────────────────────────────────────────────────────────

  const handleWSEvent = useCallback(async (event: Record<string, unknown>) => {
    const type = event.event as string;
    const payload = event.payload as Record<string, unknown>;

    switch (type) {
      case "session_start": {
        setStatus("NEGOTIATING");
        setUnitLabel((payload.unit_label as string) || "%");
        setMaxTurns((payload.max_turns as number) || 20);
        break;
      }

      case "turn_complete": {
        const turn = payload.turn as NegotiationTurn;
        setTurns((prev) => [...prev, turn]);
        setTurnCount((n) => n + 1);

        const sa = payload.schedule_a as ScheduleInfo;
        const sb = payload.schedule_b as ScheduleInfo;
        setScheduleA(sa);
        setScheduleB(sb);
        setCurrentAgent(turn.agent_id === "A" ? "B" : "A");
        setStatus("NEGOTIATING");

        // TTS
        if (ttsEnabledRef.current && ttsAvail && payload.tts) {
          const ttsData = payload.tts as { text: string; voice_hint: { pitch: number; rate: number; name: string; lang: string; fallback_lang: string } };
          setSpeakingAgent(turn.agent_id);
          await speak(ttsData.text, ttsData.voice_hint, turn.agent_id);
          setSpeakingAgent(null);
        }
        break;
      }

      case "deal_reached": {
        setStatus("DEAL_REACHED");
        setDealValue(payload.deal_value as number);
        break;
      }

      case "escalated":
      case "deadlock": {
        setStatus("ESCALATED");
        setDeadlockReason(payload.reason as string);
        break;
      }

      case "fallback_active": {
        setStatus("PAUSED_FALLBACK");
        setFallbackMsg(payload.message as string);
        cancelSpeech();
        break;
      }

      case "barge_in": {
        // Visual feedback
        break;
      }
    }
  }, [ttsEnabled, ttsAvail]);

  // ── Barge-in handlers ─────────────────────────────────────────────────────

  const submitBargeIn = async (text: string, isLimit = false) => {
    if (!text.trim()) return;
    cancelSpeech();
    await bargeIn(sessionId, bargeTarget, text, isLimit);
    setBargeText("");
  };

  const toggleRecording = async () => {
    if (isRecordingSTT) {
      setIsRecordingSTT(false);
      const text = await stopRecordingAndTranscribe(sessionId);
      if (text) {
        setBargeText(text);
      } else {
        // Browser fallback
        startBrowserFallback(
          (t) => setBargeText(t),
          (err) => console.error("STT error:", err)
        );
      }
    } else {
      setIsRecordingSTT(true);
      try {
        await startRecording();
      } catch {
        setIsRecordingSTT(false);
        startBrowserFallback(
          (t) => { setBargeText(t); setIsRecordingSTT(false); },
          () => setIsRecordingSTT(false)
        );
      }
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const turnsA = turns.filter((t) => t.agent_id === "A");
  const turnsB = turns.filter((t) => t.agent_id === "B");
  const lastA = turnsA[turnsA.length - 1];
  const lastB = turnsB[turnsB.length - 1];

  let statusClass = styles.statusGreen;
  if (status === "CONNECTING" || status === "PAUSED_FALLBACK") statusClass = styles.statusYellow;
  else if (status === "ESCALATED" || status === "DEADLOCKED" || status === "ERROR") statusClass = styles.statusRed;

  return (
    <div className={styles.root}>
      {/* ── Header bar ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            id="back-btn"
            className={styles.backBtn}
            onClick={() => router.push("/setup")}
          >
            ← Setup Arena
          </button>
        </div>

        <div className={styles.headerCenter}>
          <div className={`${styles.statusPill} ${statusClass}`}>
            {STATUS_LABELS[status]}
          </div>
          <div className={styles.turnCounter}>
            Turn <strong>{turnCount}</strong> / {maxTurns}
          </div>
        </div>

        <div className={styles.headerRight}>
          <button
            id="toggle-tts-btn"
            className={`${styles.audioBtn} ${ttsEnabled ? styles.audioBtnActive : ""}`}
            onClick={() => { setTtsEnabled((v) => !v); if (ttsEnabled) cancelSpeech(); }}
          >
            {ttsEnabled ? "🔊 Speech ON" : "🔇 Speech OFF"}
          </button>
        </div>
      </header>

      {/* ── Fallback banner ── */}
      {fallbackMsg && (
        <div className={styles.fallbackBanner}>
          ⚠️ {fallbackMsg}
        </div>
      )}

      {/* ── Deal banner ── */}
      {status === "DEAL_REACHED" && dealValue != null && (
        <div className={styles.dealBanner}>
          🎉 <strong>Consensus Reached at {dealValue}{unitLabel}!</strong> Both humans must confirm terms to finalize.
        </div>
      )}

      {/* ── Escalation banner ── */}
      {status === "ESCALATED" && deadlockReason && (
        <div className={styles.escalationBanner}>
          🚨 <strong>Escalated to Humans:</strong> {deadlockReason}
        </div>
      )}

      <main className={styles.main}>
        {/* ── Two-panel agent view ── */}
        <div className={styles.agentsRow}>
          <AgentPanel
            agentId="A"
            agentName="Agent A (Arjun)"
            modelName="GROQ LLAMA 3.3 70B"
            currentOffer={lastA?.offer ?? scheduleA.current}
            previousOffer={lastA?.previous_offer ?? null}
            lastMessage={lastA?.message ?? null}
            unitLabel={unitLabel}
            floor={scheduleA.floor}
            ceiling={scheduleA.ceiling}
            isSpeaking={speakingAgent === "A"}
            isCurrent={currentAgent === "A" && status === "NEGOTIATING"}
            turns={turnsA}
            groundingFlags={lastA?.grounding_flags ?? []}
          />

          <div className={styles.vsBar}>
            <span className={styles.vsPill}>⟷</span>
          </div>

          <AgentPanel
            agentId="B"
            agentName="Agent B (Priya)"
            modelName="GEMINI 2.0 FLASH"
            currentOffer={lastB?.offer ?? scheduleB.current}
            previousOffer={lastB?.previous_offer ?? null}
            lastMessage={lastB?.message ?? null}
            unitLabel={unitLabel}
            floor={scheduleB.floor}
            ceiling={scheduleB.ceiling}
            isSpeaking={speakingAgent === "B"}
            isCurrent={currentAgent === "B" && status === "NEGOTIATING"}
            turns={turnsB}
            groundingFlags={lastB?.grounding_flags ?? []}
          />
        </div>

        {/* ── Offer curve ── */}
        <div className={styles.curveSection}>
          <OfferCurve
            turns={turns}
            scheduleA={scheduleA}
            scheduleB={scheduleB}
            unitLabel={unitLabel}
            maxTurns={maxTurns}
          />
        </div>

        {/* ── Bottom: Transcript + Barge-in ── */}
        <div className={styles.bottomRow}>
          {/* Transcript — PRIMARY UI */}
          <div className={styles.transcriptSection}>
            <div className={styles.transcriptHeader}>
              <span className={styles.transcriptTitle}>
                📋 Live Transcript — Primary Protocol Stream
              </span>
              <span className={styles.alwaysOnBadge}>
                ● ALWAYS ON
              </span>
            </div>

            <div className={styles.transcriptBody} ref={transcriptRef}>
              {turns.length === 0 && status === "CONNECTING" && (
                <div className={styles.transcriptEmpty}>
                  ⏳ Connecting to dual-agent negotiation engine…
                </div>
              )}
              {turns.length === 0 && status === "NEGOTIATING" && (
                <div className={styles.transcriptEmpty}>
                  🧠 Agents are evaluating briefs and preparing opening bids…
                </div>
              )}
              {turns.map((turn) => (
                <div
                  key={turn.turn_id}
                  className={`${styles.transcriptTurn} ${
                    turn.agent_id === "A" ? styles.turnA : styles.turnB
                  }`}
                >
                  <div className={styles.turnMeta}>
                    <span className={turn.agent_id === "A" ? styles.agentBadgeA : styles.agentBadgeB}>
                      AGENT {turn.agent_id}
                    </span>
                    <span className={styles.turnOffer}>
                      Offer: {turn.offer}{unitLabel}
                    </span>
                    {turn.concession_delta > 0 && (
                      <span className={styles.concessionChip}>
                        △ {turn.concession_delta.toFixed(1)}{unitLabel} concession
                      </span>
                    )}
                    {turn.is_stall && (
                      <span className={styles.stallChip}>
                        STALL
                      </span>
                    )}
                    {!turn.grounding_passed && (
                      <span className={styles.groundingChip}>
                        GROUNDING FIX
                      </span>
                    )}
                    <span className={styles.turnTime}>
                      {turn.llm_latency_ms ? `${Math.round(turn.llm_latency_ms)}ms` : ""}
                    </span>
                  </div>
                  <p className={styles.turnMessage}>&ldquo;{turn.message}&rdquo;</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Barge-in panel ── */}
          <div className={styles.bargeSection}>
            <div className={styles.bargeHeader}>
              <span className={styles.bargeTitle}>
                🎤 Human Voice & Text Override
              </span>
            </div>

            <div className={styles.bargeBody}>
              <label className={styles.bargeLabel}>Intervening Party:</label>
              <div className={styles.agentToggle}>
                <button
                  id="barge-target-a"
                  className={`${styles.toggleBtn} ${bargeTarget === "A" ? styles.toggleBtnActiveA : ""}`}
                  onClick={() => setBargeTarget("A")}
                >
                  Agent A's Human
                </button>
                <button
                  id="barge-target-b"
                  className={`${styles.toggleBtn} ${bargeTarget === "B" ? styles.toggleBtnActiveB : ""}`}
                  onClick={() => setBargeTarget("B")}
                >
                  Agent B's Human
                </button>
              </div>

              <label className={styles.bargeLabel} style={{ marginTop: 6 }}>
                Speak or type your override:
              </label>
              <textarea
                id="barge-text-input"
                className={styles.bargeTextarea}
                value={bargeText}
                onChange={(e) => setBargeText(e.target.value)}
                placeholder="E.g. 'Don't go below 40%' or 'Accept if they offer 50%'"
                style={{ minHeight: 85, resize: "vertical", fontFamily: "inherit" }}
              />

              <div className={styles.bargeActions}>
                <button
                  id="record-barge-btn"
                  className={`${styles.micBtn} ${isRecordingSTT ? styles.micBtnRecording : ""}`}
                  onClick={toggleRecording}
                >
                  {isRecordingSTT ? "⏹ Stop Recording" : "🎤 Speak"}
                </button>

                <button
                  id="submit-barge-btn"
                  className={styles.injectBtn}
                  onClick={() => submitBargeIn(bargeText, false)}
                  disabled={!bargeText.trim()}
                >
                  Inject Context →
                </button>

                <button
                  id="hard-limit-btn"
                  className={styles.hardLimitBtn}
                  onClick={() => submitBargeIn(bargeText, true)}
                  disabled={!bargeText.trim()}
                >
                  🔒 Set Limit
                </button>
              </div>

              <p className={styles.bargeNote}>
                <strong>Inject Context:</strong> informs agent reasoning for next turn.<br />
                <strong>Set Limit:</strong> updates floor/ceiling constraints deterministically.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
