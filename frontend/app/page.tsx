"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

// ── Sub-component: Brief Form Panel ──────────────────────────────────────────

function BriefPanel({
  agentId,
  brief,
  onChange,
  color,
}: {
  agentId: "A" | "B";
  brief: BriefForm;
  onChange: (b: BriefForm) => void;
  color: "pink" | "cyan";
}) {
  const upd = (field: keyof BriefForm, value: string | number) =>
    onChange({ ...brief, [field]: value });

  const modelBadge =
    agentId === "A" ? "GROQ LLAMA 3.3 70B" : "GEMINI 3.5 FLASH";
  const modelBadgeClass = agentId === "A" ? "neo-badge--pink" : "neo-badge--cyan";

  return (
    <div className={`${styles.briefPanel} neo-card neo-card-3d neo-card--${color}`}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <div>
          <div className={`neo-badge ${modelBadgeClass} mono uppercase`}>
            AGENT {agentId} · {modelBadge}
          </div>
          <h2 className={styles.panelTitle}>Your Private Brief</h2>
          <p className={styles.panelSubtitle}>
            Only your agent sees this. Be honest — it stays private.
          </p>
        </div>
        <div className={`${styles.agentAvatar} ${styles[`avatar${agentId}`]}`}>
          {agentId}
        </div>
      </div>

      <hr className="neo-divider" />

      {/* Name */}
      <div className={styles.fieldGroup}>
        <label className="neo-label" htmlFor={`name-${agentId}`}>
          Your Name
        </label>
        <input
          id={`name-${agentId}`}
          className="neo-input"
          value={brief.name}
          onChange={(e) => upd("name", e.target.value)}
          placeholder="First name"
        />
      </div>

      {/* Topic */}
      <div className={styles.fieldGroup}>
        <label className="neo-label" htmlFor={`topic-${agentId}`}>
          What you're negotiating
        </label>
        <input
          id={`topic-${agentId}`}
          className="neo-input"
          value={brief.dispute_topic}
          onChange={(e) => upd("dispute_topic", e.target.value)}
        />
      </div>

      {/* Unit label */}
      <div className={styles.fieldGroup}>
        <label className="neo-label" htmlFor={`unit-${agentId}`}>
          Unit (%, ₹, days…)
        </label>
        <input
          id={`unit-${agentId}`}
          className="neo-input"
          style={{ maxWidth: 120 }}
          value={brief.unit_label}
          onChange={(e) => upd("unit_label", e.target.value)}
        />
      </div>

      {/* Positions */}
      <div className={styles.threeCol}>
        <div className={styles.fieldGroup}>
          <label className="neo-label" htmlFor={`pos-${agentId}`}>
            Opening Offer
          </label>
          <input
            id={`pos-${agentId}`}
            className="neo-input"
            type="number"
            value={brief.initial_position}
            onChange={(e) => upd("initial_position", Number(e.target.value))}
          />
          <span className={styles.unitHint}>{brief.unit_label}</span>
        </div>
        <div className={styles.fieldGroup}>
          <label className="neo-label" htmlFor={`floor-${agentId}`}>
            Floor (walk-away)
          </label>
          <input
            id={`floor-${agentId}`}
            className="neo-input"
            type="number"
            value={brief.floor}
            onChange={(e) => upd("floor", Number(e.target.value))}
          />
          <span className={styles.unitHint}>{brief.unit_label}</span>
        </div>
        <div className={styles.fieldGroup}>
          <label className="neo-label" htmlFor={`ceil-${agentId}`}>
            Ceiling (best case)
          </label>
          <input
            id={`ceil-${agentId}`}
            className="neo-input"
            type="number"
            value={brief.ceiling}
            onChange={(e) => upd("ceiling", Number(e.target.value))}
          />
          <span className={styles.unitHint}>{brief.unit_label}</span>
        </div>
      </div>

      {/* Tone */}
      <div className={styles.fieldGroup}>
        <label className="neo-label" htmlFor={`tone-${agentId}`}>
          Your Tone
        </label>
        <select
          id={`tone-${agentId}`}
          className="neo-select"
          value={brief.tone}
          onChange={(e) => upd("tone", e.target.value)}
        >
          <option value="cooperative">🤝 Cooperative — I want to find common ground</option>
          <option value="assertive">💪 Assertive — I'll push but stay fair</option>
          <option value="firm">🧱 Firm — I know what I want and I'll hold it</option>
        </select>
      </div>

      {/* Strategy */}
      <div className={styles.fieldGroup}>
        <label className="neo-label" htmlFor={`strat-${agentId}`}>
          Concession Strategy
        </label>
        <select
          id={`strat-${agentId}`}
          className="neo-select"
          value={brief.strategy}
          onChange={(e) => upd("strategy", e.target.value)}
        >
          <option value="boulware">🧊 Boulware — Hold position, concede late</option>
          <option value="conceder">🌊 Conceder — Move early, reach deal fast</option>
          <option value="linear">📏 Linear — Constant, steady concessions</option>
        </select>
      </div>

      {/* Private context */}
      <div className={styles.fieldGroup}>
        <label className="neo-label" htmlFor={`ctx-${agentId}`}>
          Private Context{" "}
          <span style={{ fontWeight: 400, opacity: 0.6 }}>
            (why you feel this way — only your agent sees this)
          </span>
        </label>
        <textarea
          id={`ctx-${agentId}`}
          className="neo-input"
          style={{ minHeight: 100, resize: "vertical", fontFamily: "inherit" }}
          value={brief.private_context}
          maxLength={500}
          onChange={(e) => upd("private_context", e.target.value)}
          placeholder="What matters to you and why? The more honest, the better your agent negotiates."
        />
        <span className={styles.charCount}>
          {brief.private_context.length}/500
        </span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [briefA, setBriefA] = useState<BriefForm>(defaultBriefA);
  const [briefB, setBriefB] = useState<BriefForm>(defaultBriefB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <div className="neo-badge neo-badge--yellow mono uppercase animate-float">
              ⚡ Agents &amp; Automation · Hackathon 2026
            </div>
            <h1 className={styles.title}>
              Samjhauta<span className={styles.titleDot}>.</span>
            </h1>
            <p className={styles.tagline}>
              Two AI agents. One dispute. Zero fake agreements.
            </p>
          </div>
          <div className={styles.headerMeta}>
            <div className={`neo-badge neo-badge--black mono`}>
              <span className="status-dot status-dot--green" />
              FREE TIER · $0
            </div>
            <div className={`neo-badge neo-badge--pink mono`}>AGENT A: GROQ LLAMA 3.3 70B</div>
            <div className={`neo-badge neo-badge--cyan mono`}>AGENT B: GEMINI 3.5 FLASH</div>
          </div>
        </div>

        {/* Persona callout */}
        <div className={`${styles.personaBox} neo-card neo-card--yellow animate-slide-in`}>
          <span className={styles.personaEmoji}>🏠</span>
          <div>
            <strong>The Scenario:</strong> Two flatmates. A broken washing machine.
            One thinks it's 50/50. The other thinks whoever broke it pays more.
            Neither wants to be the first to bring it up.{" "}
            <em>Their AI agents are going to have the conversation for them.</em>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {/* ── Brief forms ── */}
        <div className={styles.briefsGrid}>
          <BriefPanel
            agentId="A"
            brief={briefA}
            onChange={setBriefA}
            color="pink"
          />

          <div className={styles.vsColumn}>
            <div className={styles.vsLabel}>VS</div>
            <div className={styles.vsArrow}>⟷</div>
          </div>

          <BriefPanel
            agentId="B"
            brief={briefB}
            onChange={setBriefB}
            color="cyan"
          />
        </div>

        {/* ── Error ── */}
        {error && (
          <div className={`${styles.errorBox} neo-card neo-card--red animate-shake`}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* ── CTA ── */}
        <div className={styles.ctaSection}>
          <button
            id="start-negotiation-btn"
            className="neo-btn neo-btn--black neo-btn--large"
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

        {/* ── Architecture note ── */}
        <div className={`${styles.archNote} neo-card`}>
          <h3>How this works</h3>
          <div className={styles.archGrid}>
            <div className={styles.archItem}>
              <span className="neo-badge neo-badge--pink">AGENT A</span>
              <p>Groq Llama 3.3 70B reasons from your brief and generates negotiation turns.</p>
            </div>
            <div className={styles.archItem}>
              <span className="neo-badge neo-badge--cyan">AGENT B</span>
              <p>Google Gemini 3.5 Flash — a genuinely different foundation model — does the same for the other human.</p>
            </div>
            <div className={styles.archItem}>
              <span className="neo-badge neo-badge--yellow">GUARDRAIL</span>
              <p>Every turn is checked — an agent can never claim a constraint its human didn't actually state.</p>
            </div>
            <div className={styles.archItem}>
              <span className="neo-badge neo-badge--green">DEADLOCK</span>
              <p>If agents stop converging with no deal in sight, the system escalates to you — it never invents an agreement.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
