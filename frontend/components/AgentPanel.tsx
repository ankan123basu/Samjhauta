"use client";

import type { NegotiationTurn } from "@/lib/apiClient";
import styles from "./AgentPanel.module.css";

interface AgentPanelProps {
  agentId: "A" | "B";
  agentName: string;
  modelName: string;
  currentOffer: number | null;
  previousOffer: number | null;
  lastMessage: string | null;
  unitLabel: string;
  floor: number;
  ceiling: number;
  isSpeaking: boolean;
  isCurrent: boolean;
  turns: NegotiationTurn[];
  groundingFlags?: string[];
}

export default function AgentPanel({
  agentId,
  agentName,
  modelName,
  currentOffer,
  previousOffer,
  lastMessage,
  unitLabel,
  floor,
  ceiling,
  isSpeaking,
  isCurrent,
  turns,
  groundingFlags = [],
}: AgentPanelProps) {
  const isA = agentId === "A";
  const delta = currentOffer != null && previousOffer != null
    ? (currentOffer - previousOffer).toFixed(1)
    : null;

  // Fill percentage for floor→ceiling bar
  const totalRange = Math.abs(ceiling - floor) || 1;
  const fillPct = currentOffer != null
    ? Math.max(0, Math.min(100, ((currentOffer - Math.min(floor, ceiling)) / totalRange) * 100))
    : 0;

  return (
    <div
      className={`${styles.panel} ${isA ? styles.panelA : styles.panelB} ${
        isCurrent ? styles.panelActive : ""
      }`}
      id={`agent-panel-${agentId}`}
    >
      {/* Ambient background glow */}
      <div className={isA ? styles.panelGlowA : styles.panelGlowB} />

      {/* ── Header ── */}
      <div className={styles.panelHeader}>
        <div className={`${styles.agentOrb} ${isA ? styles.agentOrbA : styles.agentOrbB}`}>
          {agentId}
        </div>
        <div className={styles.agentMeta}>
          <div className={styles.agentName}>{agentName}</div>
          <div className={`${styles.modelBadge} ${isA ? styles.badgeA : styles.badgeB}`}>
            {modelName}
          </div>
        </div>
        <div className={styles.indicators}>
          {isCurrent && (
            <div className={styles.thinkingPill}>
              <span className={styles.pulseDotAmber} /> THINKING
            </div>
          )}
          {isSpeaking && (
            <div className={styles.speakingPill}>
              <span className={styles.pulseDotGreen} /> 🔊 SPEAKING
            </div>
          )}
        </div>
      </div>

      {/* ── Current offer ── */}
      <div className={styles.offerBlock}>
        <div className={styles.offerLabel}>CURRENT OFFER</div>
        <div className={`${styles.offerValue} ${isA ? styles.offerValueA : styles.offerValueB}`}>
          {currentOffer != null ? (
            <>
              {currentOffer}
              <span className={styles.offerUnit}>{unitLabel}</span>
            </>
          ) : (
            <span className={styles.offerPlaceholder}>—</span>
          )}
        </div>
        {delta && (
          <div className={`${styles.deltaPill} ${Number(delta) !== 0 ? styles.deltaConcession : styles.deltaHold}`}>
            {Number(delta) < 0 ? "▼" : Number(delta) > 0 ? "▲" : "—"}{" "}
            {Math.abs(Number(delta))}{unitLabel} {Number(delta) !== 0 ? "concession" : "hold"}
          </div>
        )}
      </div>

      {/* ── Floor / Ceiling Range Bar ── */}
      <div className={styles.rangeBarContainer}>
        <div className={styles.rangeLabels}>
          <span>Floor {floor}{unitLabel}</span>
          <span>Ceiling {ceiling}{unitLabel}</span>
        </div>
        <div className={styles.rangeTrack}>
          <div
            className={`${styles.rangeFill} ${isA ? styles.rangeFillA : styles.rangeFillB}`}
            style={{ width: `${fillPct}%` }}
          />
          <div
            className={`${styles.rangeMarker} ${isA ? styles.markerA : styles.markerB}`}
            style={{ left: `${fillPct}%` }}
          />
        </div>
      </div>

      {/* ── Speech / Justification Message ── */}
      <div className={styles.messageBlock}>
        <div className={styles.messageLabel}>Latest Position Justification</div>
        {lastMessage ? (
          <p className={styles.messageText}>&ldquo;{lastMessage}&rdquo;</p>
        ) : (
          <p className={styles.messagePlaceholder}>Waiting to take negotiation turn…</p>
        )}
      </div>

      {/* ── Grounding warning ── */}
      {groundingFlags.length > 0 && (
        <div className={styles.groundingWarning}>
          🛡️ Grounding Correction: Brief constraint enforced
        </div>
      )}

      {/* ── Turn Telemetry ── */}
      <div className={styles.turnFooter}>
        <span className={styles.turnCount}>
          {turns.length} turn{turns.length !== 1 ? "s" : ""} ·{" "}
          {turns.filter((t) => !t.is_stall).length} active concessions
        </span>
      </div>
    </div>
  );
}
