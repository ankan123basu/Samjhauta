"use client";

import { useMemo } from "react";
import type { NegotiationTurn } from "@/lib/apiClient";
import styles from "./OfferCurve.module.css";

interface ScheduleInfo {
  floor: number;
  ceiling: number;
  current: number | null;
}

interface OfferCurveProps {
  turns: NegotiationTurn[];
  scheduleA: ScheduleInfo;
  scheduleB: ScheduleInfo;
  unitLabel: string;
  maxTurns: number;
}

const W = 680;
const H = 290;
const PAD = { top: 24, right: 28, bottom: 44, left: 56 };

export default function OfferCurve({
  turns,
  scheduleA,
  scheduleB,
  unitLabel,
  maxTurns,
}: OfferCurveProps) {
  const turnsA = turns.filter((t) => t.agent_id === "A");
  const turnsB = turns.filter((t) => t.agent_id === "B");

  // Compute Y range from all floor/ceilings + offers
  const allValues = [
    scheduleA.floor, scheduleA.ceiling,
    scheduleB.floor, scheduleB.ceiling,
    ...turns.map((t) => t.offer),
  ];
  const minVal = Math.min(...allValues) - 5;
  const maxVal = Math.max(...allValues) + 5;

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const xScale = (turnNum: number) =>
    PAD.left + (turnNum / maxTurns) * chartW;

  const yScale = (val: number) =>
    PAD.top + chartH - ((val - minVal) / (maxVal - minVal || 1)) * chartH;

  // Y tick values
  const yTicks = useMemo(() => {
    const range = maxVal - minVal;
    const step = range > 50 ? 10 : range > 20 ? 5 : 2;
    const ticks = [];
    for (let v = Math.ceil(minVal / step) * step; v <= maxVal; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [minVal, maxVal]);

  // Build SVG polyline points
  const pointsA = turnsA
    .map((t, i) => `${xScale((i + 1) * 2 - 1)},${yScale(t.offer)}`)
    .join(" ");
  const pointsB = turnsB
    .map((t, i) => `${xScale((i + 1) * 2)},${yScale(t.offer)}`)
    .join(" ");

  // ZOPA shading
  const zopaLo = Math.max(scheduleA.floor, scheduleB.floor);
  const zopaHi = Math.min(scheduleA.ceiling, scheduleB.ceiling);
  const hasZopa = zopaLo <= zopaHi;

  // Current offers for live gap display
  const lastOfferA = turnsA[turnsA.length - 1]?.offer;
  const lastOfferB = turnsB[turnsB.length - 1]?.offer;
  const gap = lastOfferA != null && lastOfferB != null
    ? Math.abs(lastOfferA - lastOfferB).toFixed(1)
    : null;

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.title}>
          <span>📈 Live Offer Curve & Convergence Telemetry</span>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendA}>
            <span style={{ width: 10, height: 3, background: "#00FFFF", borderRadius: 2, display: "inline-block" }} />
            Agent A (Groq)
          </span>
          <span className={styles.legendB}>
            <span style={{ width: 10, height: 3, background: "#FF00FF", borderRadius: 2, display: "inline-block" }} />
            Agent B (Gemini)
          </span>
          {hasZopa && <span className={styles.legendZopa}>▓ ZOPA Zone</span>}
          {gap && (
            <span className={styles.gap}>
              Live Spread: <strong>{gap}{unitLabel}</strong>
            </span>
          )}
        </div>
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className={styles.svg}
        aria-label="Offer curve chart showing both agents' positions over turns"
      >
        <defs>
          {/* Cyan Glow Filter */}
          <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00FFFF" floodOpacity="0.7" />
          </filter>
          {/* Magenta Glow Filter */}
          <filter id="glow-magenta" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FF00FF" floodOpacity="0.7" />
          </filter>
          {/* ZOPA Gradient */}
          <linearGradient id="zopaGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(57, 255, 20, 0.18)" />
            <stop offset="100%" stopColor="rgba(57, 255, 20, 0.28)" />
          </linearGradient>
        </defs>

        {/* ZOPA band */}
        {hasZopa && (
          <rect
            x={PAD.left}
            y={yScale(zopaHi)}
            width={chartW}
            height={Math.max(yScale(zopaLo) - yScale(zopaHi), 2)}
            fill="url(#zopaGrad)"
            stroke="#39FF14"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}

        {/* Floor / Ceiling dashed lines — Agent A */}
        <line
          x1={PAD.left} y1={yScale(scheduleA.floor)}
          x2={W - PAD.right} y2={yScale(scheduleA.floor)}
          stroke="#00FFFF" strokeWidth={1} strokeDasharray="4 4" opacity={0.4}
        />
        <line
          x1={PAD.left} y1={yScale(scheduleA.ceiling)}
          x2={W - PAD.right} y2={yScale(scheduleA.ceiling)}
          stroke="#00FFFF" strokeWidth={1} strokeDasharray="4 4" opacity={0.25}
        />

        {/* Floor / Ceiling dashed lines — Agent B */}
        <line
          x1={PAD.left} y1={yScale(scheduleB.floor)}
          x2={W - PAD.right} y2={yScale(scheduleB.floor)}
          stroke="#FF00FF" strokeWidth={1} strokeDasharray="4 4" opacity={0.4}
        />
        <line
          x1={PAD.left} y1={yScale(scheduleB.ceiling)}
          x2={W - PAD.right} y2={yScale(scheduleB.ceiling)}
          stroke="#FF00FF" strokeWidth={1} strokeDasharray="4 4" opacity={0.25}
        />

        {/* Y-axis gridlines & ticks */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left} y1={yScale(v)}
              x2={W - PAD.right} y2={yScale(v)}
              stroke="rgba(255, 255, 255, 0.08)" strokeWidth={1} strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 10} y={yScale(v) + 4}
              textAnchor="end"
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
              fill="rgba(255, 255, 255, 0.65)"
            >
              {v}{unitLabel}
            </text>
          </g>
        ))}

        {/* X-axis & Y-axis border lines */}
        <line
          x1={PAD.left} y1={H - PAD.bottom}
          x2={W - PAD.right} y2={H - PAD.bottom}
          stroke="rgba(255, 255, 255, 0.2)" strokeWidth={1.5}
        />
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={H - PAD.bottom}
          stroke="rgba(255, 255, 255, 0.2)" strokeWidth={1.5}
        />

        {/* X labels */}
        {[1, 5, 10, 15, maxTurns].map((t) => (
          <text
            key={t}
            x={xScale(t)}
            y={H - PAD.bottom + 20}
            textAnchor="middle"
            fontSize={10}
            fontFamily="JetBrains Mono, monospace"
            fontWeight="600"
            fill="rgba(255, 255, 255, 0.65)"
          >
            T{t}
          </text>
        ))}

        {/* Offer curves (Glow Polylines) */}
        {pointsA && (
          <polyline
            points={pointsA}
            fill="none"
            stroke="#00FFFF"
            strokeWidth={3.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#glow-cyan)"
          />
        )}
        {pointsB && (
          <polyline
            points={pointsB}
            fill="none"
            stroke="#FF00FF"
            strokeWidth={3.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#glow-magenta)"
          />
        )}

        {/* Dots on each turn (Luminous Glowing Circles) */}
        {turnsA.map((t, i) => (
          <g key={t.turn_id}>
            <circle
              cx={xScale((i + 1) * 2 - 1)}
              cy={yScale(t.offer)}
              r={6.5}
              fill="#00FFFF"
              stroke="#060608"
              strokeWidth={2}
              filter="url(#glow-cyan)"
            >
              <title>Agent A Turn {t.turn_number}: {t.offer}{unitLabel}</title>
            </circle>
            <circle
              cx={xScale((i + 1) * 2 - 1)}
              cy={yScale(t.offer)}
              r={2}
              fill="#ffffff"
            />
          </g>
        ))}

        {turnsB.map((t, i) => (
          <g key={t.turn_id}>
            <circle
              cx={xScale((i + 1) * 2)}
              cy={yScale(t.offer)}
              r={6.5}
              fill="#FF00FF"
              stroke="#060608"
              strokeWidth={2}
              filter="url(#glow-magenta)"
            >
              <title>Agent B Turn {t.turn_number}: {t.offer}{unitLabel}</title>
            </circle>
            <circle
              cx={xScale((i + 1) * 2)}
              cy={yScale(t.offer)}
              r={2}
              fill="#ffffff"
            />
          </g>
        ))}

        {/* ZOPA text watermark */}
        {hasZopa && (
          <text
            x={W - PAD.right - 8}
            y={yScale((zopaLo + zopaHi) / 2) + 4}
            textAnchor="end"
            fontSize={11}
            fontFamily="JetBrains Mono, monospace"
            fill="#39FF14"
            fontWeight="800"
          >
            ← ZOPA ({zopaLo}% – {zopaHi}%)
          </text>
        )}
      </svg>
    </div>
  );
}
