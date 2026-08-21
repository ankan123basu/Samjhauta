"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import MoltenMetal from "@/components/MoltenMetal";
import styles from "./page.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BriefForm {
  name: string;
  initial_position: number;
  floor: number;
  ceiling: number;
  tone: "cooperative" | "assertive" | "firm";
  strategy: "boulware" | "conceder" | "linear";
  private_context: string;
  dispute_topic: string;
  unit_label: string;
}

const DEFAULT_TOPIC = "cost split for shared appliance repair";
const DEFAULT_UNIT = "%";

const defaultBriefA: BriefForm = {
  name: "Arjun",
  initial_position: 30,
  floor: 25,
  ceiling: 50,
  tone: "assertive",
  strategy: "boulware",
  private_context:
    "I didn't break it. We both used the washing machine equally and shared the risk. A 50/50 split feels unjust given I wasn't even home when it broke.",
  dispute_topic: DEFAULT_TOPIC,
  unit_label: DEFAULT_UNIT,
};

const defaultBriefB: BriefForm = {
  name: "Priya",
  initial_position: 70,
  floor: 45,
  ceiling: 75,
  tone: "cooperative",
  strategy: "conceder",
  private_context:
    "I know the timing looked bad but it wasn't entirely my fault. I want this resolved — living with this tension is worse than paying a bit more. I'm willing to be flexible.",
  dispute_topic: DEFAULT_TOPIC,
  unit_label: DEFAULT_UNIT,
};

const TONE_OPTIONS = [
  { value: "cooperative", label: "🤝 Cooperative — I want to find common ground" },
  { value: "assertive", label: "💪 Assertive — I'll push but stay fair" },
  { value: "firm", label: "🧱 Firm — I know what I want and I'll hold it" },
];

const STRATEGY_OPTIONS = [
  { value: "boulware", label: "🧊 Boulware — Hold position, concede late" },
  { value: "conceder", label: "🌊 Conceder — Move early, reach deal fast" },
  { value: "linear", label: "📏 Linear — Constant, steady concessions" },
];

// ── Custom Glass Dropdown Component ──────────────────────────────────────────

function CustomGlassSelect({
  value,
  options,
  onChange,
  agentId,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  agentId: "A" | "B";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={containerRef} className={styles.customSelectWrapper}>
      <button
        type="button"
        className={`${styles.customSelectBtn} ${
          agentId === "A" ? styles.customSelectBtnA : styles.customSelectBtnB
        }`}
        data-open={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu}>
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`${styles.customOption} ${
                opt.value === value
                  ? agentId === "A"
                    ? styles.customOptionActiveA
                    : styles.customOptionActiveB
                  : ""
              }`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live Offer Range Gauge Bar Component ─────────────────────────────────────

function OfferRangeGauge({
  floor,
  ceiling,
  opening,
  unit,
  agentId,
}: {
  floor: number;
  ceiling: number;
  opening: number;
  unit: string;
  agentId: "A" | "B";
}) {
  const minVal = Math.min(floor, ceiling, opening, 0);
  const maxVal = Math.max(floor, ceiling, opening, 100);
  const totalSpan = maxVal - minVal || 1;

  const floorPct = Math.min(Math.max(((Math.min(floor, ceiling) - minVal) / totalSpan) * 100, 0), 100);
  const ceilPct = Math.min(Math.max(((Math.max(floor, ceiling) - minVal) / totalSpan) * 100, 0), 100);
  const openingPct = Math.min(Math.max(((opening - minVal) / totalSpan) * 100, 0), 100);

  const spanWidth = Math.max(ceilPct - floorPct, 2);

  return (
    <div className={styles.rangeGaugeContainer}>
      <div className={styles.rangeGaugeHeader}>
        <span>Floor: {floor}{unit}</span>
        <span style={{ color: agentId === "A" ? "#00FFFF" : "#FF00FF", fontWeight: 700 }}>
          Opening: {opening}{unit}
        </span>
        <span>Ceiling: {ceiling}{unit}</span>
      </div>

      <div className={styles.rangeTrack}>
        {/* Active Range Fill */}
        <div
          className={agentId === "A" ? styles.rangeSpanA : styles.rangeSpanB}
          style={{
            left: `${floorPct}%`,
            width: `${spanWidth}%`,
          }}
        />

        {/* Current Opening Offer Dot */}
        <div
          className={`${styles.rangeMarker} ${
            agentId === "A" ? styles.rangeMarkerA : styles.rangeMarkerB
          }`}
          style={{ left: `${openingPct}%` }}
          title={`Opening Offer: ${opening}${unit}`}
        />
      </div>
    </div>
  );
}

// ── Sub-component: Territorial Brief Form Panel ──────────────────────────────

function BriefPanel({
  agentId,
  brief,
  onChange,
}: {
  agentId: "A" | "B";
  brief: BriefForm;
  onChange: (b: BriefForm) => void;
}) {
  const upd = (field: keyof BriefForm, value: string | number) =>
    onChange({ ...brief, [field]: value });

  const modelBadge =
    agentId === "A" ? "GROQ LLAMA 3.3 70B" : "GEMINI 2.0 FLASH";

  // Dynamic character count color class
  const len = brief.private_context.length;
  let charClass = styles.charCountNormal;
  if (len > 450) charClass = styles.charCountCrit;
  else if (len > 350) charClass = styles.charCountWarn;

  return (
    <div className={styles.briefPanelWrapper}>
      {/* Ambient Edge Glow */}
      <div className={agentId === "A" ? styles.ambientEdgeA : styles.ambientEdgeB} />

      <div
        className={`${styles.briefPanel} ${
          agentId === "A" ? styles.briefPanelA : styles.briefPanelB
        }`}
      >
        <div>
          {/* Header */}
          <div className={styles.panelHeader}>
            <div>
              <div
                className={`${styles.agentBadge} ${
                  agentId === "A" ? styles.agentBadgeA : styles.agentBadgeB
                }`}
              >
                AGENT {agentId} · {modelBadge}
              </div>
              <h2 className={styles.panelTitle}>Your Private Brief</h2>
              <p className={styles.panelSubtitle}>
                Only your agent sees this. Be honest — it stays private.
              </p>
            </div>

            {/* Alive Orb Avatar */}
            <div
              className={`${styles.agentOrbAvatar} ${
                agentId === "A" ? styles.agentOrbA : styles.agentOrbB
              }`}
            >
              {agentId}
            </div>
          </div>

          {/* Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`name-${agentId}`}>
              Your Name
            </label>
            <input
              id={`name-${agentId}`}
              className={`${styles.inputGlass} ${
                agentId === "A" ? styles.inputA : styles.inputB
              }`}
              value={brief.name}
              onChange={(e) => upd("name", e.target.value)}
              placeholder="First name"
            />
          </div>

          {/* Topic */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`topic-${agentId}`}>
              What you're negotiating
            </label>
            <input
              id={`topic-${agentId}`}
              className={`${styles.inputGlass} ${
                agentId === "A" ? styles.inputA : styles.inputB
              }`}
              value={brief.dispute_topic}
              onChange={(e) => upd("dispute_topic", e.target.value)}
            />
          </div>

          {/* Unit label */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`unit-${agentId}`}>
              Unit (%, ₹, days…)
            </label>
            <input
              id={`unit-${agentId}`}
              className={`${styles.inputGlass} ${
                agentId === "A" ? styles.inputA : styles.inputB
              }`}
              style={{ maxWidth: 140 }}
              value={brief.unit_label}
              onChange={(e) => upd("unit_label", e.target.value)}
            />
          </div>

          {/* Positions */}
          <div className={styles.threeCol}>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`pos-${agentId}`}>
                Opening Offer
              </label>
              <input
                id={`pos-${agentId}`}
                className={`${styles.inputGlass} ${
                  agentId === "A" ? styles.inputA : styles.inputB
                }`}
                type="number"
                value={brief.initial_position}
                onChange={(e) => upd("initial_position", Number(e.target.value))}
              />
              <span className={styles.unitHint}>{brief.unit_label}</span>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`floor-${agentId}`}>
                Floor (walk-away)
              </label>
              <input
                id={`floor-${agentId}`}
                className={`${styles.inputGlass} ${
                  agentId === "A" ? styles.inputA : styles.inputB
                }`}
                type="number"
                value={brief.floor}
                onChange={(e) => upd("floor", Number(e.target.value))}
              />
              <span className={styles.unitHint}>{brief.unit_label}</span>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`ceil-${agentId}`}>
                Ceiling (best case)
              </label>
              <input
                id={`ceil-${agentId}`}
                className={`${styles.inputGlass} ${
                  agentId === "A" ? styles.inputA : styles.inputB
                }`}
                type="number"
                value={brief.ceiling}
                onChange={(e) => upd("ceiling", Number(e.target.value))}
              />
              <span className={styles.unitHint}>{brief.unit_label}</span>
            </div>
          </div>

          {/* Live Offer-Range Gauge */}
          <OfferRangeGauge
            floor={brief.floor}
            ceiling={brief.ceiling}
            opening={brief.initial_position}
            unit={brief.unit_label}
            agentId={agentId}
          />

          {/* Tone (Custom Glass Dropdown) */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Your Tone</label>
            <CustomGlassSelect
              value={brief.tone}
              options={TONE_OPTIONS}
              onChange={(val) => upd("tone", val as BriefForm["tone"])}
              agentId={agentId}
            />
          </div>

          {/* Strategy (Custom Glass Dropdown) */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Concession Strategy</label>
            <CustomGlassSelect
              value={brief.strategy}
              options={STRATEGY_OPTIONS}
              onChange={(val) => upd("strategy", val as BriefForm["strategy"])}
              agentId={agentId}
            />
          </div>

          {/* Private context */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`ctx-${agentId}`}>
              Private Context{" "}
              <span style={{ fontWeight: 400, opacity: 0.6 }}>
                (why you feel this way — only your agent sees this)
              </span>
            </label>
            <div className={styles.textareaContainer}>
              <textarea
                id={`ctx-${agentId}`}
                className={`${styles.inputGlass} ${
                  agentId === "A" ? styles.inputA : styles.inputB
                }`}
                style={{ minHeight: 90, resize: "vertical", fontFamily: "inherit", paddingBottom: "28px" }}
                value={brief.private_context}
                maxLength={500}
                onChange={(e) => upd("private_context", e.target.value)}
                placeholder="What matters to you and why? The more honest, the better your agent negotiates."
              />
              <div className={`${styles.charCountPill} ${charClass}`}>
                {brief.private_context.length}/500
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const [briefA, setBriefA] = useState<BriefForm>(defaultBriefA);
  const [briefB, setBriefB] = useState<BriefForm>(defaultBriefB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate live ZOPA (Zone of Possible Agreement)
  const minA = Math.min(briefA.floor, briefA.ceiling);
  const maxA = Math.max(briefA.floor, briefA.ceiling);
  const minB = Math.min(briefB.floor, briefB.ceiling);
  const maxB = Math.max(briefB.floor, briefB.ceiling);

  const overlapStart = Math.max(minA, minB);
  const overlapEnd = Math.min(maxA, maxB);
  const hasOverlap = overlapStart <= overlapEnd;

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:8000/api/negotiate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief_a: { ...briefA, agent_id: "A" },
          brief_b: { ...briefB, agent_id: "B" },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to start session.");
      }
      const data = await res.json();
      router.push(`/negotiate/${data.session_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  return (
    <div className={styles.root}>
      {/* ── Molten Metal WebGL Background ── */}
      <div className={styles.bgWrapper}>
        <MoltenMetal
          color1="#00FFFF"
          color2="#A855F7"
          color3="#FF00FF"
          speed={0.28}
          scale={3.6}
          detail={3}
          glow={2.2}
          coreSize={0.14}
          swirl={1.0}
          fold={-0.22}
          blackPoint={0.03}
          brightness={1.65}
          colorMode="molten"
          grain={true}
          grainIntensity={0.03}
          mouseInteraction={true}
          mouseStrength={0.3}
          opacity={0.92}
        />
      </div>
      <div className={styles.bgVignette} />

      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <a href="/" className={styles.backLink}>
              ← Back to Overview
            </a>
            <h1 className={styles.title}>
              Setup <span className={styles.titleGrad}>Negotiation Arena</span>
            </h1>
            <p className={styles.tagline}>
              Two independent foundation models. One dispute. Zero fake agreements.
            </p>
          </div>
        </div>

        {/* Scenario Glass Pill Callout */}
        <div className={styles.scenarioBox}>
          <span className={styles.scenarioEmoji}>🏠</span>
          <div>
            <strong>The Scenario:</strong> Two flatmates. A broken washing machine.
            One thinks it's 50/50. The other thinks whoever broke it pays more.
            Neither wants to be the first to bring it up.{" "}
            <em style={{ color: "#00FFFF" }}>Their AI agents are going to have the conversation for them.</em>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {/* ── Brief Forms Grid with Live ZOPA Indicator ── */}
        <div className={styles.briefsGrid}>
          <BriefPanel
            agentId="A"
            brief={briefA}
            onChange={setBriefA}
          />

          <div className={styles.vsColumn}>
            {/* Pulsing Gradient Border VS Medallion */}
            <div className={styles.vsMedallion}>
              <span className={styles.vsText}>VS</span>
            </div>

            {/* Live ZOPA Overlap Telemetry Pill */}
            <div className={styles.zopaPill}>
              <span
                className={`${styles.zopaStatus} ${
                  hasOverlap ? styles.zopaStatusOverlap : styles.zopaStatusDeadlock
                }`}
              >
                {hasOverlap ? "● ZOPA Detected" : "▲ No Overlap"}
              </span>
              <span className={styles.zopaRange}>
                {hasOverlap
                  ? `${overlapStart}% – ${overlapEnd}%`
                  : `Gap: ${overlapStart - overlapEnd}%`}
              </span>
            </div>
          </div>

          <BriefPanel
            agentId="B"
            brief={briefB}
            onChange={setBriefB}
          />
        </div>

        {/* ── Error ── */}
        {error && (
          <div className={styles.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* ── Primary Glowing Launch CTA ── */}
        <div className={styles.ctaSection}>
          <button
            id="start-negotiation-btn"
            className={styles.startBtn}
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? (
              <>⏳ Starting Negotiation…</>
            ) : (
              <>🤝 Let the Agents Negotiate →</>
            )}
          </button>
          <p className={styles.ctaNote}>
            Briefs are private. The other agent only sees negotiation turns.
          </p>
        </div>

        {/* ── Architecture Note Cards with Rich Iconography ── */}
        <div className={styles.archNote}>
          <h3 className={styles.archTitle}>Protocol Capabilities</h3>
          <div className={styles.archGrid}>
            <div className={styles.archCard}>
              <div className={styles.archCardHeader}>
                <span className={styles.archIcon}>⚡</span>
                <span className={styles.archBadge} style={{ color: "#00FFFF", background: "rgba(0,255,255,0.08)", border: "1px solid rgba(0,255,255,0.2)" }}>
                  AGENT A
                </span>
              </div>
              <p className={styles.archDesc}>Groq Llama 3.3 70B reasons from your brief and generates adversarial turns.</p>
            </div>

            <div className={styles.archCard}>
              <div className={styles.archCardHeader}>
                <span className={styles.archIcon}>✨</span>
                <span className={styles.archBadge} style={{ color: "#FF00FF", background: "rgba(255,0,255,0.08)", border: "1px solid rgba(255,0,255,0.2)" }}>
                  AGENT B
                </span>
              </div>
              <p className={styles.archDesc}>Google Gemini 2.0 Flash — a genuinely different foundation model — does the same for the other human.</p>
            </div>

            <div className={styles.archCard}>
              <div className={styles.archCardHeader}>
                <span className={styles.archIcon}>🛡️</span>
                <span className={styles.archBadge} style={{ color: "#FFE156", background: "rgba(255,225,86,0.08)", border: "1px solid rgba(255,225,86,0.2)" }}>
                  GUARDRAIL
                </span>
              </div>
              <p className={styles.archDesc}>Every turn is checked — an agent can never claim a constraint its human didn't state.</p>
            </div>

            <div className={styles.archCard}>
              <div className={styles.archCardHeader}>
                <span className={styles.archIcon}>⚖️</span>
                <span className={styles.archBadge} style={{ color: "#39FF14", background: "rgba(57,255,20,0.08)", border: "1px solid rgba(57,255,20,0.2)" }}>
                  DEADLOCK
                </span>
              </div>
              <p className={styles.archDesc}>If agents stop converging with no deal in sight, the system escalates — it never invents an agreement.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
