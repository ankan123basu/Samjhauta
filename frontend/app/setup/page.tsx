"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import MoltenMetal from "@/components/MoltenMetal";
import { SUPPORTED_LANGUAGES, processTransliteration } from "@/lib/transliterate";
import { SETUP_LOCALIZATIONS, type SetupI18n } from "@/lib/i18nSetup";
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
  language: string;
}

const defaultBriefA: BriefForm = {
  name: SETUP_LOCALIZATIONS["en"].briefA.name,
  initial_position: 30,
  floor: 25,
  ceiling: 50,
  tone: "assertive",
  strategy: "boulware",
  private_context: SETUP_LOCALIZATIONS["en"].briefA.context,
  dispute_topic: SETUP_LOCALIZATIONS["en"].briefA.topic,
  unit_label: "%",
  language: "English",
};

const defaultBriefB: BriefForm = {
  name: SETUP_LOCALIZATIONS["en"].briefB.name,
  initial_position: 70,
  floor: 45,
  ceiling: 75,
  tone: "cooperative",
  strategy: "conceder",
  private_context: SETUP_LOCALIZATIONS["en"].briefB.context,
  dispute_topic: SETUP_LOCALIZATIONS["en"].briefB.topic,
  unit_label: "%",
  language: "English",
};

// ── Pre-Built Scenario Templates ──────────────────────────────────────────────

interface ScenarioTemplate {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  pill: string;
  summaryText: string;
  briefA: BriefForm;
  briefB: BriefForm;
}

const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: "flatmate",
    emoji: "🏠",
    name: "Flatmate Bill Split",
    desc: "Washing machine broke. Who pays how much?",
    pill: "% of cost",
    summaryText: "Two flatmates. A broken washing machine. One thinks it's 50/50. The other thinks whoever was using it when it broke should pay more.",
    briefA: { ...defaultBriefA },
    briefB: { ...defaultBriefB },
  },
  {
    id: "salary",
    emoji: "💼",
    name: "Salary Negotiation",
    desc: "Senior developer annual salary review with the hiring manager.",
    pill: "K USD",
    summaryText: "Senior Software Engineer & Hiring Manager. Candidate has a competing 155K offer; Manager has a 170K maximum approved budget.",
    briefA: {
      name: "Sarah (Candidate)",
      initial_position: 160,
      floor: 140,
      ceiling: 200,
      tone: "assertive",
      strategy: "boulware",
      private_context: "I have a competing offer at 155K from another company. My current salary is 145K. I have 7 years of experience and led two critical product launches this year. I know the market rate for my role is 150-175K.",
      dispute_topic: "Annual salary negotiation for a Senior Software Engineer position",
      unit_label: "K USD",
      language: "English",
    },
    briefB: {
      name: "Mark (Hiring Manager)",
      initial_position: 145,
      floor: 130,
      ceiling: 170,
      tone: "cooperative",
      strategy: "conceder",
      private_context: "Budget approved up to 170K for this role but I'd prefer to stay under 155K. Sarah is a top performer we can't afford to lose. The team is already short-staffed and replacing her would cost us 3+ months of lost productivity.",
      dispute_topic: "Annual salary negotiation for a Senior Software Engineer position",
      unit_label: "K USD",
      language: "English",
    },
  },
  {
    id: "equity",
    emoji: "🚀",
    name: "Startup Equity Split",
    desc: "Two co-founders dividing equity before their seed round.",
    pill: "% equity",
    summaryText: "Technical & Business Co-Founders. Technical founder built full MVP solo; Business founder secured $500K Seed commitment.",
    briefA: {
      name: "Alex (Technical Co-founder)",
      initial_position: 55,
      floor: 45,
      ceiling: 65,
      tone: "firm",
      strategy: "boulware",
      private_context: "I built the entire MVP solo over 8 months, wrote all the code, and designed the architecture. The product would not exist without my technical work. I also brought in our first 3 paying customers through my network.",
      dispute_topic: "Co-founder equity split before seed funding round",
      unit_label: "%",
      language: "English",
    },
    briefB: {
      name: "Jordan (Business Co-founder)",
      initial_position: 50,
      floor: 40,
      ceiling: 55,
      tone: "cooperative",
      strategy: "conceder",
      private_context: "I secured the $500K seed round commitment, wrote the business plan, handled all investor meetings, and brought in the key enterprise partnership. I also quit my 200K/year job 6 months earlier than Alex to go full-time. Without the funding, the company dies.",
      dispute_topic: "Co-founder equity split before seed funding round",
      unit_label: "%",
      language: "English",
    },
  },
  {
    id: "rental",
    emoji: "🏢",
    name: "Rental Deposit Dispute",
    desc: "Tenant wants full security deposit back. Landlord disagrees.",
    pill: "₹ amount",
    summaryText: "Tenant & Landlord. Tenant wants full ₹50,000 security deposit back; Landlord cites ₹20,000 repair & repainting costs.",
    briefA: {
      name: "Ravi (Tenant)",
      initial_position: 45000,
      floor: 35000,
      ceiling: 50000,
      tone: "assertive",
      strategy: "boulware",
      private_context: "I paid 50,000 rupees as security deposit. The apartment had pre-existing marks when I moved in which were noted in the move-in checklist. I've lived here for 2 years and maintained the place well. The only damage is normal wear and tear.",
      dispute_topic: "Security deposit refund after end of 2-year rental lease",
      unit_label: "₹",
      language: "English",
    },
    briefB: {
      name: "Meena (Landlord)",
      initial_position: 20000,
      floor: 15000,
      ceiling: 40000,
      tone: "firm",
      strategy: "boulware",
      private_context: "The walls need repainting which costs 12,000 rupees. There's a stain on the carpet that needs professional cleaning for 5,000. The bathroom tap is leaking which wasn't reported. Total repair estimate is 18,000-22,000 rupees. I want to keep enough to cover repairs.",
      dispute_topic: "Security deposit refund after end of 2-year rental lease",
      unit_label: "₹",
      language: "English",
    },
  },
  {
    id: "vendor",
    emoji: "📦",
    name: "Vendor Contract",
    desc: "Renegotiating an annual SaaS vendor contract at renewal.",
    pill: "$/month",
    summaryText: "Procurement Lead & SaaS Account Executive. Client wants to cut 12K/mo contract to 8K/mo; Vendor offers volume discounts to retain account.",
    briefA: {
      name: "Priya (Procurement Lead)",
      initial_position: 8000,
      floor: 7000,
      ceiling: 12000,
      tone: "assertive",
      strategy: "boulware",
      private_context: "Our current contract is $12,000/month which is above market rate. Competitor tools offer similar features at $7,500-9,000/month. We have budget pressure to cut SaaS costs by 20% this quarter. However, switching costs are high — 3 months of migration work.",
      dispute_topic: "Annual SaaS vendor contract renewal price negotiation",
      unit_label: "$/mo",
      language: "English",
    },
    briefB: {
      name: "David (Account Executive)",
      initial_position: 11500,
      floor: 8500,
      ceiling: 12000,
      tone: "cooperative",
      strategy: "conceder",
      private_context: "This client is in our top 50 accounts. Losing them would hurt our Q3 numbers badly. My manager approved discounting up to 25% to retain. I know they're evaluating competitors but switching costs are in our favor. Our new AI features launching next month should justify the price.",
      dispute_topic: "Annual SaaS vendor contract renewal price negotiation",
      unit_label: "$/mo",
      language: "English",
    },
  },
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
        <span>{selected?.label || value}</span>
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
  floorLabel,
  openingLabel,
  ceilingLabel,
}: {
  floor: number;
  ceiling: number;
  opening: number;
  unit: string;
  agentId: "A" | "B";
  floorLabel: string;
  openingLabel: string;
  ceilingLabel: string;
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
        <span>{floorLabel}: {floor}{unit}</span>
        <span style={{ color: agentId === "A" ? "#00FFFF" : "#FF00FF", fontWeight: 700 }}>
          {openingLabel}: {opening}{unit}
        </span>
        <span>{ceilingLabel}: {ceiling}{unit}</span>
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
          title={`Offer: ${opening}${unit}`}
        />
      </div>
    </div>
  );
}

// ── Sub-component: Territorial Brief Form Panel ──────────────────────────────

function BriefPanel({
  agentId,
  brief,
  selectedLangCode,
  onChange,
  onLanguageChange,
}: {
  agentId: "A" | "B";
  brief: BriefForm;
  selectedLangCode: string;
  onChange: (b: BriefForm) => void;
  onLanguageChange: (code: string) => void;
}) {
  const [translitOn, setTranslitOn] = useState<boolean>(true);

  // Derive localized strings for this panel
  const i18n = SETUP_LOCALIZATIONS[selectedLangCode] || SETUP_LOCALIZATIONS["en"];

  const upd = (field: keyof BriefForm, value: string | number) =>
    onChange({ ...brief, [field]: value });

  const handleLangSelect = (code: string) => {
    onLanguageChange(code);
  };

  const handleTranslitText = async (field: keyof BriefForm, val: string) => {
    if (translitOn && selectedLangCode !== "en") {
      await processTransliteration(val, selectedLangCode, (newVal) => upd(field, newVal));
    } else {
      upd(field, val);
    }
  };

  const modelBadge =
    agentId === "A" ? "GROQ · LLAMA 3.3 70B" : "GEMINI · 2.5 FLASH";

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
              <h2 className={styles.panelTitle}>{i18n.panelTitle}</h2>
              <p className={styles.panelSubtitle}>{i18n.panelSubtitle}</p>
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

          {/* Multilingual Typing & Auto-Refill Toolbar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, background: "rgba(255,255,255,0.04)", padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)" }}>
            <span style={{ fontSize: "0.74rem", color: "#00FFFF", fontFamily: "JetBrains Mono, monospace", fontWeight: 800 }}>
              🌐 Language & Script:
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={selectedLangCode}
                onChange={(e) => handleLangSelect(e.target.value)}
                style={{
                  background: "rgba(0,0,0,0.7)",
                  color: agentId === "A" ? "#00FFFF" : "#FF00FF",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 6,
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  padding: "4px 10px",
                  outline: "none",
                  cursor: "pointer",
                }}
                title="Select language to auto-fill fields and have agent speak in this language"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} style={{ background: "#121218", color: "#fff" }}>
                    {l.name} ({l.native})
                  </option>
                ))}
              </select>

              {selectedLangCode !== "en" && (
                <button
                  type="button"
                  onClick={() => setTranslitOn(!translitOn)}
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: translitOn ? "rgba(255,225,86,0.15)" : "rgba(255,255,255,0.05)",
                    color: translitOn ? "#FFE156" : "#9e9ea8",
                    border: translitOn ? "1px solid rgba(255,225,86,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    cursor: "pointer",
                  }}
                  title="Phonetic transliteration on space (e.g. 'samjhauta ' -> 'समझौता ')"
                >
                  🔤 Transliteration: {translitOn ? "ON" : "OFF"}
                </button>
              )}
            </div>
          </div>

          {/* Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`name-${agentId}`}>
              {i18n.nameLabel}
            </label>
            <input
              id={`name-${agentId}`}
              className={`${styles.inputGlass} ${
                agentId === "A" ? styles.inputA : styles.inputB
              }`}
              value={brief.name}
              onChange={(e) => handleTranslitText("name", e.target.value)}
              placeholder="First name"
            />
          </div>

          {/* Topic */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`topic-${agentId}`}>
              {i18n.topicLabel}
            </label>
            <input
              id={`topic-${agentId}`}
              className={`${styles.inputGlass} ${
                agentId === "A" ? styles.inputA : styles.inputB
              }`}
              value={brief.dispute_topic}
              onChange={(e) => handleTranslitText("dispute_topic", e.target.value)}
            />
          </div>

          {/* Unit label */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`unit-${agentId}`}>
              {i18n.unitLabel}
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
                {i18n.openingLabel}
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
                {i18n.floorLabel}
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
                {i18n.ceilingLabel}
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
            floorLabel={i18n.floorLabel}
            openingLabel={i18n.openingLabel}
            ceilingLabel={i18n.ceilingLabel}
          />

          {/* Tone (Custom Glass Dropdown) */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>{i18n.toneLabel}</label>
            <CustomGlassSelect
              value={brief.tone}
              options={i18n.tones}
              onChange={(val) => upd("tone", val as BriefForm["tone"])}
              agentId={agentId}
            />
          </div>

          {/* Strategy (Custom Glass Dropdown) */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>{i18n.strategyLabel}</label>
            <CustomGlassSelect
              value={brief.strategy}
              options={i18n.strategies}
              onChange={(val) => upd("strategy", val as BriefForm["strategy"])}
              agentId={agentId}
            />
          </div>

          {/* Private context */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`ctx-${agentId}`}>
              {i18n.contextLabel}{" "}
              <span style={{ fontWeight: 400, opacity: 0.6 }}>
                {i18n.contextHint}
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
                onChange={(e) => handleTranslitText("private_context", e.target.value)}
                placeholder={i18n.contextPlaceholder}
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
  const [globalLang, setGlobalLang] = useState<string>("en");
  const [briefA, setBriefA] = useState<BriefForm>(defaultBriefA);
  const [briefB, setBriefB] = useState<BriefForm>(defaultBriefB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<string>("flatmate");

  const globalI18n = SETUP_LOCALIZATIONS[globalLang] || SETUP_LOCALIZATIONS["en"];
  const currentScenario = SCENARIO_TEMPLATES.find((t) => t.id === activeTemplate) || SCENARIO_TEMPLATES[0];

  // Handle template selection
  const handleSelectTemplate = (template: ScenarioTemplate) => {
    setActiveTemplate(template.id);
    setBriefA({ ...template.briefA });
    setBriefB({ ...template.briefB });
  };

  // Calculate live ZOPA (Zone of Possible Agreement)
  const minA = Math.min(briefA.floor, briefA.ceiling);
  const maxA = Math.max(briefA.floor, briefA.ceiling);
  const minB = Math.min(briefB.floor, briefB.ceiling);
  const maxB = Math.max(briefB.floor, briefB.ceiling);

  const overlapStart = Math.max(minA, minB);
  const overlapEnd = Math.min(maxA, maxB);
  const hasOverlap = overlapStart <= overlapEnd;

  const handleGlobalLanguageChange = (code: string) => {
    setGlobalLang(code);
    const langObj = SUPPORTED_LANGUAGES.find((l) => l.code === code) || SUPPORTED_LANGUAGES[0];
    const loc = SETUP_LOCALIZATIONS[code] || SETUP_LOCALIZATIONS["en"];

    setBriefA((prev) => ({
      ...prev,
      language: langObj.name,
      name: loc.briefA.name,
      dispute_topic: loc.briefA.topic,
      private_context: loc.briefA.context,
      unit_label: loc.briefA.unit || "%",
    }));

    setBriefB((prev) => ({
      ...prev,
      language: langObj.name,
      name: loc.briefB.name,
      dispute_topic: loc.briefB.topic,
      private_context: loc.briefB.context,
      unit_label: loc.briefB.unit || "%",
    }));
  };

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/negotiate/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief_a: { ...briefA, agent_id: "A", language: briefA.language || "English" },
          brief_b: { ...briefB, agent_id: "B", language: briefB.language || "English" },
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
              {globalI18n.backLink}
            </a>
            <h1 className={styles.title}>
              {globalI18n.title} <span className={styles.titleGrad}>{globalI18n.titleHighlight}</span>
            </h1>
            <p className={styles.tagline}>{globalI18n.tagline}</p>
          </div>
        </div>

        {/* Scenario Glass Pill Callout */}
        <div className={styles.scenarioBox}>
          <span className={styles.scenarioEmoji}>{currentScenario.emoji}</span>
          <div>
            <strong>Active Scenario ({currentScenario.name}):</strong> {currentScenario.summaryText}
          </div>
        </div>

        {/* 🌐 Global Language Switcher Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, margin: "16px auto 0", maxWidth: 600, background: "rgba(0, 255, 255, 0.06)", border: "1px solid rgba(0, 255, 255, 0.25)", borderRadius: 12, padding: "10px 18px" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "#00FFFF", display: "flex", alignItems: "center", gap: 6 }}>
            🌐 Negotiation Language:
          </span>
          <select
            id="global-language-select"
            value={globalLang}
            onChange={(e) => handleGlobalLanguageChange(e.target.value)}
            style={{
              background: "#0d0d14",
              color: "#00FFFF",
              border: "1px solid rgba(0, 255, 255, 0.4)",
              borderRadius: 8,
              fontSize: "0.86rem",
              fontWeight: 800,
              padding: "6px 14px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} style={{ background: "#121218", color: "#fff" }}>
                {l.name} ({l.native})
              </option>
            ))}
          </select>
          <span style={{ fontSize: "0.74rem", color: "rgba(255,255,255,0.6)" }}>
            ⚡ Auto-refills all brief fields in native script
          </span>
        </div>
      </header>

      <main className={styles.main}>
        {/* ── Scenario Template Picker ── */}
        <div className={styles.templateSection}>
          <div className={styles.templateSectionTitle}>
            QUICK-START SCENARIOS — SAME ENGINE, DIFFERENT DOMAINS
          </div>
          <div className={styles.templateRow}>
            {SCENARIO_TEMPLATES.map((t) => (
              <div
                key={t.id}
                className={`${styles.templateCard} ${activeTemplate === t.id ? styles.templateCardActive : ""}`}
                onClick={() => handleSelectTemplate(t)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleSelectTemplate(t)}
              >
                <span className={styles.templateEmoji}>{t.emoji}</span>
                <span className={styles.templateName}>{t.name}</span>
                <span className={styles.templateDesc}>{t.desc}</span>
                <span className={styles.templatePill}>{t.pill}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Brief Forms Grid with Live ZOPA Indicator ── */}
        <div className={styles.briefsGrid}>
          <BriefPanel
            agentId="A"
            brief={briefA}
            selectedLangCode={globalLang}
            onChange={setBriefA}
            onLanguageChange={handleGlobalLanguageChange}
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
                {hasOverlap ? globalI18n.zopaDetected : globalI18n.noOverlap}
              </span>
              <span className={styles.zopaRange}>
                {hasOverlap
                  ? `${overlapStart}% – ${overlapEnd}%`
                  : `${globalI18n.gapText}: ${overlapStart - overlapEnd}%`}
              </span>
            </div>
          </div>

          <BriefPanel
            agentId="B"
            brief={briefB}
            selectedLangCode={globalLang}
            onChange={setBriefB}
            onLanguageChange={handleGlobalLanguageChange}
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
              <p className={styles.archDesc}>Groq Llama 3.3 70B Versatile reasons from your brief and generates adversarial turns in your chosen language.</p>
            </div>

            <div className={styles.archCard}>
              <div className={styles.archCardHeader}>
                <span className={styles.archIcon}>✨</span>
                <span className={styles.archBadge} style={{ color: "#FF00FF", background: "rgba(255,0,255,0.08)", border: "1px solid rgba(255,0,255,0.2)" }}>
                  AGENT B
                </span>
              </div>
              <p className={styles.archDesc}>Google Gemini 2.5 Flash — a genuinely different provider and architecture — does the same for the other human.</p>
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
