"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AgentPanel from "@/components/AgentPanel";
import OfferCurve from "@/components/OfferCurve";
import { bargeIn, createWebSocket, translateText, type NegotiationTurn } from "@/lib/apiClient";
import { speak, cancelSpeech, isTTSAvailable } from "@/lib/ttsClient";
import {
  startRecording,
  stopRecordingAndTranscribe,
  startBrowserFallback,
} from "@/lib/sttClient";
import { SUPPORTED_LANGUAGES, processTransliteration } from "@/lib/transliterate";
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

  // ── Core Negotiation State ──
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
  const [turnCount, setTurnCount] = useState(0);

  // ── Multilingual & Translation State ──
  // sessionLang = the language agents are generating/speaking in (set from setup page choice)
  const [sessionLang, setSessionLang] = useState<string>("English");
  const [autoTranslate, setAutoTranslate] = useState<boolean>(true);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});

  // ── Barge-In & STT State ──
  const [bargeText, setBargeText] = useState("");
  const [isRecordingSTT, setIsRecordingSTT] = useState(false);
  const [bargeTarget, setBargeTarget] = useState<"A" | "B">("A");
  const [bargeLang, setBargeLang] = useState<string>("hi-IN");
  const [translitEnabled, setTranslitEnabled] = useState<boolean>(true);

  // ── TTS State ──
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  const sessionLangRef = useRef(sessionLang);
  useEffect(() => { sessionLangRef.current = sessionLang; }, [sessionLang]);

  const wsRef = useRef<WebSocket | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const ttsAvail = isTTSAvailable();

  // ── Translation Helper ──
  const performTranslation = useCallback(
    async (turnId: string, text: string, targetLang: string): Promise<string> => {
      if (targetLang === "Original" || !text.trim()) return text;
      const cacheKey = `${turnId}_${targetLang}`;
      if (translations[cacheKey]) return translations[cacheKey];

      setTranslatingIds((prev) => ({ ...prev, [turnId]: true }));
      try {
        const result = await translateText(text, targetLang);
        setTranslations((prev) => ({ ...prev, [cacheKey]: result }));
        return result;
      } catch (err) {
        console.error("Translation error:", err);
        return text;
      } finally {
        setTranslatingIds((prev) => ({ ...prev, [turnId]: false }));
      }
    },
    [translations]
  );

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
  }, [turns, translations]);

  // ── Event handler ─────────────────────────────────────────────────────────

  const handleWSEvent = useCallback(
    async (event: Record<string, unknown>) => {
      const type = event.event as string;
      const payload = event.payload as Record<string, unknown>;

      switch (type) {
        case "session_start": {
          setStatus("NEGOTIATING");
          setUnitLabel((payload.unit_label as string) || "%");
          setMaxTurns((payload.max_turns as number) || 20);

          // Read the language agents are speaking in (set from setup page)
          const langA = (payload.language_a as string) || "English";
          const langB = (payload.language_b as string) || "English";
          // Use Agent A's language as the session language (both should match)
          const activeLang = langA !== "English" ? langA : langB;
          setSessionLang(activeLang);
          sessionLangRef.current = activeLang;

          // Find the matching language code for the session language
          const matchedLang = SUPPORTED_LANGUAGES.find(
            (l) => l.name.toLowerCase() === activeLang.toLowerCase()
          );
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

          // The agents already generate text in the session language.
          // We speak whatever text the agent produced, using the session language for TTS.
          const textToSpeak = turn.message;
          const currentSessionLang = sessionLangRef.current;

          // Resolve the language code for TTS from the session language name
          const ttsLangMatch = SUPPORTED_LANGUAGES.find(
            (l) => l.name.toLowerCase() === currentSessionLang.toLowerCase()
          );
          const ttsLangCode = ttsLangMatch ? ttsLangMatch.code : "en";

          // Auto-translate to English in background (non-blocking) so speech starts immediately
          if (currentSessionLang !== "English") {
            translateText(turn.message, "English")
              .then((trans) => {
                setTranslations((prev) => ({
                  ...prev,
                  [`${turn.turn_id}_English`]: trans,
                }));
              })
              .catch((err) => {
                console.warn("Auto-translate error:", err);
              });
          }

          // TTS Speech aloud — speak IMMEDIATELY without waiting for translation
          if (ttsEnabledRef.current && ttsAvail) {
            setSpeakingAgent(turn.agent_id);
            await speak(
              textToSpeak,
              undefined,
              turn.agent_id,
              ttsLangCode
            );
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
          break;
        }
      }
    },
    [ttsAvail]
  );

  // ── Barge-in handlers ─────────────────────────────────────────────────────

  const submitBargeIn = async (text: string, isLimit = false) => {
    if (!text.trim()) return;
    cancelSpeech();
    await bargeIn(sessionId, bargeTarget, text, isLimit);
    setBargeText("");
  };

  const handleBargeTextChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (translitEnabled && bargeLang !== "en-US") {
      await processTransliteration(val, bargeLang, (newVal) => setBargeText(newVal));
    } else {
      setBargeText(val);
    }
  };

  const toggleRecording = async () => {
    if (isRecordingSTT) {
      setIsRecordingSTT(false);
      const text = await stopRecordingAndTranscribe(sessionId, bargeLang);
      if (text) {
        setBargeText(text);
      } else {
        // Browser fallback with chosen language
        startBrowserFallback(
          (t) => setBargeText(t),
          (err) => console.error("STT error:", err),
          bargeLang
        );
      }
    } else {
      setIsRecordingSTT(true);
      try {
        await startRecording();
      } catch {
        setIsRecordingSTT(false);
        startBrowserFallback(
          (t) => {
            setBargeText(t);
            setIsRecordingSTT(false);
          },
          () => setIsRecordingSTT(false),
          bargeLang
        );
      }
    }
  };

  const handleSpeakTurn = async (turnText: string, agentId: "A" | "B", lang?: string) => {
    cancelSpeech();
    // Default to the session language if no specific lang is provided
    const ttsLangMatch = SUPPORTED_LANGUAGES.find(
      (l) => l.name.toLowerCase() === sessionLang.toLowerCase()
    );
    const resolvedLang = lang || ttsLangMatch?.code || "en";
    setSpeakingAgent(agentId);
    await speak(turnText, undefined, agentId, resolvedLang);
    setSpeakingAgent(null);
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

        <div className={styles.headerRight} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* 🔊 Audio Toggle */}
          <button
            id="toggle-tts-btn"
            className={`${styles.audioBtn} ${ttsEnabled ? styles.audioBtnActive : ""}`}
            onClick={() => {
              setTtsEnabled((v) => !v);
              if (ttsEnabled) cancelSpeech();
            }}
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
            modelName="GROQ · LLAMA 3.3 70B"
            currentOffer={lastA?.offer ?? scheduleA.current}
            previousOffer={lastA?.previous_offer ?? null}
            lastMessage={
              sessionLang !== "English" && lastA?.turn_id && translations[`${lastA.turn_id}_English`]
                ? translations[`${lastA.turn_id}_English`]
                : lastA?.message ?? null
            }
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
            modelName="GEMINI · 2.5 FLASH"
            currentOffer={lastB?.offer ?? scheduleB.current}
            previousOffer={lastB?.previous_offer ?? null}
            lastMessage={
              sessionLang !== "English" && lastB?.turn_id && translations[`${lastB.turn_id}_English`]
                ? translations[`${lastB.turn_id}_English`]
                : lastB?.message ?? null
            }
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
            <div className={styles.transcriptHeader} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={styles.transcriptTitle}>
                📋 Live Transcript — Multilingual Protocol Stream
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {sessionLang !== "English" && (
                  <span className={styles.alwaysOnBadge} style={{ background: "rgba(0,255,255,0.15)", color: "#00FFFF", borderColor: "rgba(0,255,255,0.3)", textTransform: "none" }}>
                    🌐 {sessionLang} / EN
                  </span>
                )}
                <span className={styles.alwaysOnBadge}>
                  ● ALWAYS ON
                </span>
              </div>
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
              {turns.map((turn) => {
                const transKey = `${turn.turn_id}_English`;
                const translated = sessionLang !== "English" ? translations[transKey] : null;

                return (
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

                    {/* Original Turn Message */}
                    <p className={styles.turnMessage}>&ldquo;{turn.message}&rdquo;</p>

                    {/* Translated Box if available */}
                    {translated && (
                      <div className={styles.translatedBox}>
                        <div className={styles.translatedHeader}>
                          <span className={styles.translatedBadge}>
                            🌐 English Translation
                          </span>
                        </div>
                        <p className={styles.translatedText}>&ldquo;{translated}&rdquo;</p>
                      </div>
                    )}

                    {/* Turn Actions */}
                    <div className={styles.turnActions}>
                      <button
                        type="button"
                        className={styles.actionPillBtn}
                        onClick={() => handleSpeakTurn(turn.message, turn.agent_id)}
                        title={`Listen in ${sessionLang}`}
                      >
                        🔊 Listen ({sessionLang})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Barge-in panel ── */}
          <div className={styles.bargeSection}>
            <div className={styles.bargeHeader} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={styles.bargeTitle}>
                🎤 Multilingual Voice & Text Override
              </span>
            </div>

            <div className={styles.bargeBody}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className={styles.bargeLabel}>Intervening Party:</label>

                {/* Input Language Selector for Transliteration & STT */}
                <div className={styles.langSelectWrap} style={{ padding: "2px 8px" }}>
                  <span className={styles.langLabel} style={{ fontSize: "0.68rem" }}>🎙️ Lang:</span>
                  <select
                    className={styles.langSelect}
                    value={bargeLang}
                    onChange={(e) => setBargeLang(e.target.value)}
                    style={{ fontSize: "0.72rem" }}
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.srCode} value={l.srCode}>
                        {l.code.toUpperCase()} ({l.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <label className={styles.bargeLabel}>
                  Speak or type your override:
                </label>

                {bargeLang !== "en-US" && (
                  <button
                    type="button"
                    className={`${styles.translitPill} ${translitEnabled ? styles.translitPillActive : ""}`}
                    onClick={() => setTranslitEnabled(!translitEnabled)}
                    title="Type phonetically in Roman script and press space to convert into Indic script"
                  >
                    🔤 Transliteration: {translitEnabled ? "ON" : "OFF"}
                  </button>
                )}
              </div>

              <textarea
                id="barge-text-input"
                className={styles.bargeTextarea}
                value={bargeText}
                onChange={handleBargeTextChange}
                placeholder={
                  bargeLang !== "en-US" && translitEnabled
                    ? "Type phonetically (e.g. 'mai 40% se zyada nahi dunga')..."
                    : "E.g. 'Don't go below 40%' or 'Accept if they offer 50%'"
                }
                style={{ minHeight: 85, resize: "vertical", fontFamily: "inherit" }}
              />

              <div className={styles.bargeActions}>
                <button
                  id="record-barge-btn"
                  className={`${styles.micBtn} ${isRecordingSTT ? styles.micBtnRecording : ""}`}
                  onClick={toggleRecording}
                  title={`Record voice in ${bargeLang}`}
                >
                  {isRecordingSTT ? "⏹ Stop Recording" : `🎤 Speak (${bargeLang.split("-")[0].toUpperCase()})`}
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
