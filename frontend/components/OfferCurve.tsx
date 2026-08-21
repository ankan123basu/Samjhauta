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

const W = 640;
const H = 280;
const PAD = { top: 20, right: 24, bottom: 40, left: 52 };

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
    PAD.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;

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
          <span className="mono uppercase" style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.1em" }}>
            📈 Live Offer Curve
          </span>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendA}>── Agent A</span>
          <span className={styles.legendB}>── Agent B</span>
          {hasZopa && <span className={styles.legendZopa}>▓ ZOPA</span>}
          {gap && (
            <span className={styles.gap}>
              Gap: <strong>{gap}{unitLabel}</strong>
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
        {/* ZOPA band */}
        {hasZopa && (
          <rect
            x={PAD.left}
            y={yScale(zopaHi)}
            width={chartW}
            height={yScale(zopaLo) - yScale(zopaHi)}
            fill="rgba(57, 255, 20, 0.18)"
            stroke="rgba(57, 255, 20, 0.6)"
            strokeWidth={1}
            strokeDasharray="6 3"
          />
        )}

        {/* Floor / Ceiling dashed lines — Agent A */}
        <line
          x1={PAD.left} y1={yScale(scheduleA.floor)}
          x2={W - PAD.right} y2={yScale(scheduleA.floor)}
          stroke="var(--neo-pink)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.5}
        />
        <line
          x1={PAD.left} y1={yScale(scheduleA.ceiling)}
          x2={W - PAD.right} y2={yScale(scheduleA.ceiling)}
          stroke="var(--neo-pink)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.25}
        />

        {/* Floor / Ceiling dashed lines — Agent B */}
        <line
          x1={PAD.left} y1={yScale(scheduleB.floor)}
          x2={W - PAD.right} y2={yScale(scheduleB.floor)}
          stroke="var(--neo-cyan)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.5}
        />
        <line
          x1={PAD.left} y1={yScale(scheduleB.ceiling)}
          x2={W - PAD.right} y2={yScale(scheduleB.ceiling)}
          stroke="var(--neo-cyan)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.25}
        />

        {/* Y-axis ticks */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left - 6} y1={yScale(v)}
              x2={W - PAD.right} y2={yScale(v)}
              stroke="rgba(0,0,0,0.08)" strokeWidth={1}
            />
            <text
              x={PAD.left - 10} y={yScale(v) + 4}
              textAnchor="end"
              fontSize={10}
              fontFamily="Space Mono, monospace"
              fill="rgba(0,0,0,0.5)"
            >
              {v}{unitLabel}
            </text>
          </g>
        ))}

        {/* X-axis */}
        <line
          x1={PAD.left} y1={H - PAD.bottom}
          x2={W - PAD.right} y2={H - PAD.bottom}
          stroke="var(--neo-black)" strokeWidth={2}
        />
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={H - PAD.bottom}
          stroke="var(--neo-black)" strokeWidth={2}
        />

        {/* X labels */}
        {[1, 5, 10, 15, maxTurns].map((t) => (
          <text
            key={t}
            x={xScale(t)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            fontSize={10}
            fontFamily="Space Mono, monospace"
            fill="rgba(0,0,0,0.5)"
          >
            T{t}
          </text>
        ))}

        {/* Offer lines */}
        {pointsA && (
          <polyline
            points={pointsA}
            fill="none"
            stroke="var(--neo-pink)"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {pointsB && (
          <polyline
            points={pointsB}
            fill="none"
            stroke="var(--neo-cyan)"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Dots on each turn */}
        {turnsA.map((t, i) => (
          <circle
            key={t.turn_id}
            cx={xScale((i + 1) * 2 - 1)}
            cy={yScale(t.offer)}
            r={5}
            fill="var(--neo-pink)"
            stroke="var(--neo-black)"
            strokeWidth={2}
          >
            <title>Agent A Turn {t.turn_number}: {t.offer}{unitLabel}</title>
          </circle>
        ))}
        {turnsB.map((t, i) => (
          <circle
            key={t.turn_id}
            cx={xScale((i + 1) * 2)}
            cy={yScale(t.offer)}
            r={5}
            fill="var(--neo-cyan)"
            stroke="var(--neo-black)"
            strokeWidth={2}
          >
            <title>Agent B Turn {t.turn_number}: {t.offer}{unitLabel}</title>
          </circle>
        ))}

        {/* ZOPA label */}
        {hasZopa && (
          <text
            x={W - PAD.right - 8}
            y={yScale((zopaLo + zopaHi) / 2) + 4}
            textAnchor="end"
            fontSize={10}
            fontFamily="Space Mono, monospace"
            fill="rgba(20,120,20,0.8)"
            fontWeight="bold"
          >
            ← ZOPA
          </text>
        )}
      </svg>
    </div>
  );
}
