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
  const color = agentId === "A" ? "pink" : "cyan";
  const delta = currentOffer != null && previousOffer != null
    ? (currentOffer - previousOffer).toFixed(1)
    : null;

  // Fill percentage for floor→ceiling bar
  const fillPct = currentOffer != null
    ? Math.max(0, Math.min(100, ((currentOffer - floor) / (ceiling - floor)) * 100))
    : 0;

  return (
    <div
      className={`${styles.panel} ${styles[`panel--${color}`]} neo-card neo-card-3d ${
        isCurrent ? styles["panel--active"] : ""
      }`}
      id={`agent-panel-${agentId}`}
    >
      {/* ── Header ── */}
      <div className={styles.panelHeader}>
        <div className={styles.agentId}>{agentId}</div>
        <div className={styles.agentMeta}>
          <div className={styles.agentName}>{agentName}</div>
          <div className={`neo-badge ${agentId === "A" ? "neo-badge--pink" : "neo-badge--cyan"} mono`}>
            {modelName}
          </div>
        </div>
        <div className={styles.indicators}>
          {isCurrent && (
            <div className={`neo-badge neo-badge--yellow animate-pulse-border`}>
              ● THINKING
            </div>
          )}
          {isSpeaking && (
            <div className={`neo-badge neo-badge--green`}>
              🔊 SPEAKING
            </div>
          )}
        </div>
      </div>

      {/* ── Current offer ── */}
      <div className={styles.offerBlock}>
        <div className={styles.offerLabel}>CURRENT OFFER</div>
        <div className={styles.offerValue}>
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
          <div className={`${styles.delta} ${Number(delta) > 0 ? styles.deltaUp : styles.deltaDown}`}>
            {Number(delta) > 0 ? "▲" : "▼"} {Math.abs(Number(delta))}{unitLabel} concession
          </div>
        )}
      </div>

      {/* ── Range bar ── */}
      <div className={styles.rangeBar}>
        <span className={styles.rangeLabel}>Floor {floor}{unitLabel}</span>
        <div className={styles.rangeTrack}>
          <div
            className={`${styles.rangeFill} ${styles[`rangeFill--${color}`]}`}
            style={{ width: `${fillPct}%` }}
          />
          <div
            className={styles.rangeMarker}
            style={{ left: `${fillPct}%` }}
          />
        </div>
        <span className={styles.rangeLabel}>Ceiling {ceiling}{unitLabel}</span>
      </div>

      {/* ── Last message ── */}
      <div className={styles.messageBlock}>
        {lastMessage ? (
          <p className={styles.message}>&ldquo;{lastMessage}&rdquo;</p>
        ) : (
          <p className={styles.messagePlaceholder}>Waiting to speak…</p>
        )}
      </div>

      {/* ── Grounding warning ── */}
      {groundingFlags.length > 0 && (
        <div className={styles.groundingWarning}>
          ⚠️ Grounding correction applied
        </div>
      )}

      {/* ── Turn count ── */}
      <div className={styles.turnCount}>
        <span className="mono" style={{ fontSize: "0.72rem", opacity: 0.6 }}>
          {turns.length} turn{turns.length !== 1 ? "s" : ""} ·{" "}
          {turns.filter((t) => !t.is_stall).length} real concessions
        </span>
      </div>
    </div>
  );
}
