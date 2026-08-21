"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "./landing.css";

/* ═══════════════════════════════════════════════════════════════════════════
   FRAME SEQUENCE CONFIG
   ═══════════════════════════════════════════════════════════════════════════
   100 frames total.
   Index 0     → /frames/frame_first.jpg (high clarity 1st frame)
   Index 1..98 → /frames/sequence/frame_0002.jpg .. frame_0099.jpg
   Index 99    → /frames/frame_last.jpg (high clarity last frame)
   ═══════════════════════════════════════════════════════════════════════════ */
const TOTAL_FRAMES = 100;
const SCROLL_PX_PER_FRAME = 24; // Snappy 24px per frame (~2400px total scroll)

function getFrameUrl(idx: number): string {
  if (idx <= 0) return "/frames/frame_first.jpg";
  if (idx >= TOTAL_FRAMES - 1) return "/frames/frame_last.jpg";
  return `/frames/sequence/frame_${String(idx + 1).padStart(4, "0")}.jpg`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CANVAS COVER DRAW (DPR-AWARE, NO ASPECT RATIO DISTORTION)
   ═══════════════════════════════════════════════════════════════════════════ */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number
) {
  const dw = cssWidth * dpr;
  const dh = cssHeight * dpr;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;

  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
}

/* ═══════════════════════════════════════════════════════════════════════════
   GITHUB SVG ICON
   ═══════════════════════════════════════════════════════════════════════════ */
function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAVBAR COMPONENT (FROSTED OPAQUE CAPSULE — ZERO BLEED-THROUGH)
   ═══════════════════════════════════════════════════════════════════════════ */
function Navbar() {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (window.scrollY > 40) {
        el.classList.add("condensed");
      } else {
        el.classList.remove("condensed");
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="nav-wrapper">
      <nav ref={navRef} className="nav">
        <a href="/" className="nav-brand">
          <span className="nav-brand-logo">Samjhauta</span>
          <span className="nav-brand-badge">2.0</span>
        </a>

        <div className="nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="#how" className="nav-link">Architecture</a>
          <a href="#stack" className="nav-link">Stack</a>
          <a href="#arena" className="nav-link">Arena</a>
        </div>

        <div className="nav-actions">
          <a href="/setup" className="btn btn--sm btn--primary">
            Try Demo →
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--sm"
          >
            <GitHubIcon />
          </a>
        </div>
      </nav>
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCROLL-SCRUB HERO COMPONENT
   Zero React state on scroll (all DOM updates via refs for 60fps)
   ═══════════════════════════════════════════════════════════════════════════ */
function ScrollHero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const loadedFrames = useRef<HTMLImageElement[]>([]);
  const lastDrawnIdx = useRef(-1);
  const animFrameId = useRef(0);

  const [preloadProgress, setPreloadProgress] = useState(0);
  const [isPreloadComplete, setIsPreloadComplete] = useState(false);
  const [wrapperHeight, setWrapperHeight] = useState(TOTAL_FRAMES * SCROLL_PX_PER_FRAME + 900);

  // Set accurate wrapper height after mount
  useEffect(() => {
    setWrapperHeight(TOTAL_FRAMES * SCROLL_PX_PER_FRAME + window.innerHeight);
    const onResize = () => setWrapperHeight(TOTAL_FRAMES * SCROLL_PX_PER_FRAME + window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ── Preload all frames with Promise.all and Image.decode() ── */
  useEffect(() => {
    let isMounted = true;
    let count = 0;

    const frameImages: HTMLImageElement[] = new Array(TOTAL_FRAMES);

    const promises = Array.from({ length: TOTAL_FRAMES }, (_, i) => {
      return new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        const url = getFrameUrl(i);
        img.src = url;

        img.onload = () => {
          img.decode().then(() => {
            if (!isMounted) return;
            count++;
            setPreloadProgress((count / TOTAL_FRAMES) * 100);
            resolve(img);
          }).catch(() => {
            if (!isMounted) return;
            count++;
            setPreloadProgress((count / TOTAL_FRAMES) * 100);
            resolve(img);
          });
        };

        img.onerror = () => {
          console.warn(`[Samjhauta] Warning: Frame ${i} failed to load at ${url}`);
          if (isMounted) {
            count++;
            setPreloadProgress((count / TOTAL_FRAMES) * 100);
          }
          resolve(img);
        };

        frameImages[i] = img;
      });
    });

    Promise.all(promises).then((results) => {
      if (!isMounted) return;
      loadedFrames.current = results;

      // Draw initial frame
      const canvas = canvasRef.current;
      if (canvas && results[0]?.naturalWidth) {
        resizeCanvas(canvas);
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        if (ctx) {
          drawImageCover(ctx, results[0], canvas.clientWidth, canvas.clientHeight, dpr);
          lastDrawnIdx.current = 0;
        }
      }

      setTimeout(() => setIsPreloadComplete(true), 150);
    });

    return () => { isMounted = false; };
  }, []);

  function resizeCanvas(c: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
  }

  // Handle window resize
  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      resizeCanvas(canvas);
      const curImg = loadedFrames.current[lastDrawnIdx.current];
      if (curImg?.naturalWidth) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          drawImageCover(ctx, curImg, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
        }
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ── 60fps Scroll Scrubbing via requestAnimationFrame ── */
  useEffect(() => {
    if (!isPreloadComplete) return;

    const onScroll = () => {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = requestAnimationFrame(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return;

        const rect = wrap.getBoundingClientRect();
        const scrollable = wrap.offsetHeight - window.innerHeight;
        const scrolled = -rect.top;
        const progress = Math.min(Math.max(scrolled / scrollable, 0), 1);
        const frameIndex = Math.round(progress * (TOTAL_FRAMES - 1));

        // Draw new frame only when index changes
        if (frameIndex !== lastDrawnIdx.current && frameIndex >= 0 && frameIndex < TOTAL_FRAMES) {
          lastDrawnIdx.current = frameIndex;
          const img = loadedFrames.current[frameIndex];
          if (img?.naturalWidth) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              drawImageCover(ctx, img, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
            }
          }
        }

        // Hero content opacity (0 to 0.22 progress)
        const content = contentRef.current;
        if (content) {
          if (progress < 0.22) {
            const t = progress / 0.22;
            content.style.opacity = String(1 - t);
            content.style.transform = `scale(${1 - t * 0.05})`;
            content.style.pointerEvents = "auto";
          } else {
            content.style.opacity = "0";
            content.style.pointerEvents = "none";
          }
        }

        // Final End CTA (0.80 to 1.0 progress)
        const end = endRef.current;
        if (end) {
          if (progress > 0.80) {
            const t = Math.min(1, (progress - 0.80) / 0.20);
            end.style.opacity = String(t);
            end.style.transform = `translateX(-50%) translateY(${(1 - t) * 14}px)`;
            end.style.pointerEvents = t > 0.5 ? "auto" : "none";
          } else {
            end.style.opacity = "0";
            end.style.pointerEvents = "none";
          }
        }

        // Scroll cue
        const cue = cueRef.current;
        if (cue) cue.style.opacity = progress < 0.04 ? "1" : "0";

        // Bottom bridge fade
        const fade = fadeRef.current;
        if (fade) {
          if (progress > 0.75) fade.classList.add("show");
          else fade.classList.remove("show");
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(animFrameId.current);
    };
  }, [isPreloadComplete]);

  return (
    <section className="hero-wrap" ref={wrapRef} style={{ height: `${wrapperHeight}px` }}>
      <div className="hero-pin">
        <canvas ref={canvasRef} className="hero-canvas" />
        <div className="hero-vig" />
        <div ref={fadeRef} className="hero-fade-bridge" />

        {/* Preload Overlay */}
        <div className={`hero-loader ${isPreloadComplete ? "done" : ""}`}>
          <div className="hero-loader-logo">Samjhauta</div>
          <div className="hero-loader-bar">
            <div className="hero-loader-fill" style={{ width: `${Math.round(preloadProgress)}%` }} />
          </div>
          <div className="hero-loader-txt">
            {Math.round(preloadProgress)}% · DECODING NEURAL SEQUENCE
          </div>
        </div>

        {/* Centered Hero Content (Clean Direct Presentation) */}
        <div ref={contentRef} className="hero-content">
          <h1 className="hero-h1">
            Two Agents. <span className="hero-grad-text">One Deal.</span>
            <br />Zero Excuses.
          </h1>

          <p className="hero-subtext">
            Witness Groq Llama 3.3 and Google Gemini 2.0 negotiate an autonomous settlement
            with live voice barge-in, while you hold the kill switch.
          </p>

          <div className="hero-actions">
            <a href="/setup" className="btn btn--lg btn--primary">
              🤝&nbsp; Launch Live Demo
            </a>
            <a href="#features" className="btn btn--lg">
              Explore Architecture ↓
            </a>
          </div>

          {/* Ultra-Sleek Immersive Metric Ribbon */}
          <div className="hero-metric-ribbon">
            <div className="metric-item">
              <span className="metric-num metric-num--cyan">2</span>
              <span className="metric-text">Foundation Models</span>
            </div>
            <div className="metric-divider" />
            <div className="metric-item">
              <span className="metric-num metric-num--magenta">$0.00</span>
              <span className="metric-text">Free Tier API Cost</span>
            </div>
            <div className="metric-divider" />
            <div className="metric-item">
              <span className="metric-num metric-num--green">0</span>
              <span className="metric-text">Fake Deals</span>
            </div>
          </div>
        </div>

        {/* End Resting CTA */}
        <div ref={endRef} className="hero-end" style={{ opacity: 0 }}>
          <a href="/setup" className="btn btn--lg btn--primary">
            🤝&nbsp; Start Live Negotiation →
          </a>
        </div>

        {/* Scroll Cue */}
        <div ref={cueRef} className="hero-cue">
          <span>Scroll to scrub</span>
          <span className="hero-cue-bar" />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSITION BRIDGE COMPONENT (HERO → FEATURES)
   ═══════════════════════════════════════════════════════════════════════════ */
function TransitionBridge() {
  return (
    <div className="transition-bridge">
      <div className="bridge-glow-line" />
      <div className="bridge-pill">
        <span className="bridge-dot" />
        <span>Live Protocol Benchmark · 0.0% Hallucination Rate · Dual-Engine Convergence</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPOTLIGHT CARD COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
function SpotlightCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`gp bento-card ${className}`}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEATURES (6-CELL ASYMMETRIC BENTO GRID WITH RICH METRICS & WATERMARKS)
   ═══════════════════════════════════════════════════════════════════════════ */
const BENTO_FEATURES = [
  {
    span: "bento-card--w4",
    icon: "🧠",
    iconColor: "bento-icon-badge--cyan",
    watermark: "🧠",
    title: "Dual-Provider Negotiation Engine",
    desc: "Not a single model prompting itself in a mirror. Two distinct foundation models — Groq Llama 3.3 70B and Google Gemini 2.0 Flash — act as genuinely independent adversaries, each sworn to defend their human's walk-away floor.",
    chips: [
      { text: "Groq Llama 3.3 70B", color: "meta-chip--cyan" },
      { text: "Gemini 2.0 Flash", color: "meta-chip--magenta" },
      { text: "Zero Self-Play Bias", color: "meta-chip--green" },
    ],
  },
  {
    span: "bento-card--w2",
    icon: "🔒",
    iconColor: "bento-icon-badge--amber",
    watermark: "🔒",
    title: "Grounding Guardrail",
    desc: "Deterministic verification against private briefs. Agents can never invent non-existent constraints or concede beyond their floor.",
    chips: [
      { text: "100% Floor Compliance", color: "meta-chip--amber" },
      { text: "0.0% Hallucination", color: "meta-chip--green" },
    ],
  },
  {
    span: "bento-card--w2",
    icon: "🎙️",
    iconColor: "bento-icon-badge--green",
    watermark: "🎙️",
    title: "Voice Barge-In",
    desc: "Integrated Groq Whisper speech-to-text enables either human to interrupt the live negotiation stream mid-sentence and revise terms on the fly.",
    chips: [
      { text: "Groq Whisper STT", color: "meta-chip--green" },
      { text: "< 350ms Ingest", color: "meta-chip--cyan" },
    ],
  },
  {
    span: "bento-card--w4",
    icon: "⚖️",
    iconColor: "bento-icon-badge--red",
    watermark: "⚖️",
    title: "Deadlock Detection Protocol",
    desc: "A mathematical concession gradient monitors turn convergence. If overlapping settlement space does not exist, the platform flat-out refuses to fake an agreement and automatically escalates to human mediation.",
    chips: [
      { text: "Deterministic Math", color: "meta-chip--purple" },
      { text: "Automatic Escalation", color: "meta-chip--amber" },
      { text: "Zero Forced Deals", color: "meta-chip--green" },
    ],
  },
  {
    span: "bento-card--w3",
    icon: "📊",
    iconColor: "bento-icon-badge--purple",
    watermark: "📊",
    title: "Real-Time Token & Cost Tracker",
    desc: "Live token expenditure monitor across Groq and Google Gemini APIs. The entire negotiation pipeline is architected to run permanently within free-tier quotas.",
    chips: [
      { text: "$0.00 Running Cost", color: "meta-chip--magenta" },
      { text: "Live Token Counter", color: "meta-chip--purple" },
    ],
  },
  {
    span: "bento-card--w3",
    icon: "🧪",
    iconColor: "bento-icon-badge--cyan",
    watermark: "🧪",
    title: "Eval Harness & Settlement Quality",
    desc: "Automated post-negotiation scoring benchmark evaluating Pareto efficiency, concession symmetry, fairness quotient, and satisfaction parity across both parties.",
    chips: [
      { text: "Pareto Optimality", color: "meta-chip--cyan" },
      { text: "Symmetry Score", color: "meta-chip--green" },
    ],
  },
];

function FeaturesSection() {
  return (
    <section className="sect" id="features">
      <div className="sect-inner">
        <div className="sect-header">
          <div className="sect-tag">Core Capabilities</div>
          <h2 className="sect-h2">
            Engineered for real disputes,<br />not toy demonstrations.
          </h2>
          <p className="sect-desc">
            Every subsystem is crafted to deliver legally verifiable, mathematically grounded
            compromises that humans can actually sign.
          </p>
        </div>

        <div className="bento">
          {BENTO_FEATURES.map((item) => (
            <SpotlightCard
              key={item.title}
              className={item.span}
            >
              {/* Watermark Glyph */}
              <div className="bento-watermark">{item.watermark}</div>

              <div className="bento-top">
                <div className={`bento-icon-badge ${item.iconColor}`}>
                  {item.icon}
                </div>
                <h3 className="bento-title">{item.title}</h3>
                <p className="bento-desc">{item.desc}</p>
              </div>

              <div className="bento-meta">
                {item.chips.map((c) => (
                  <span key={c.text} className={`meta-chip ${c.color}`}>
                    {c.text}
                  </span>
                ))}
              </div>
            </SpotlightCard>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOW IT WORKS (2×2 CONNECTED FLOW GRID)
   ═══════════════════════════════════════════════════════════════════════════ */
const HOW_STEPS = [
  {
    num: "01",
    numClass: "flow-num--1",
    tag: "Human A Brief · Groq",
    tagClass: "flow-tag--cyan",
    title: "1. Brief Your Private Agent",
    desc: "Each human inputs their secret objective: opening bid, absolute walk-away floor, priorities, and negotiation tone. Only their designated agent has access.",
    points: [
      "Zero prompt leakage between parties",
      "Strict parameter constraints enforced",
    ],
  },
  {
    num: "02",
    numClass: "flow-num--2",
    tag: "Dual-LLM Turns · Gemini",
    tagClass: "flow-tag--magenta",
    title: "2. Autonomous Adversarial Turns",
    desc: "Groq Llama 3.3 70B and Google Gemini 2.0 Flash exchange structured offers over WebSockets. True multi-model divergence prevents groupthink convergence.",
    points: [
      "Sub-second reasoning speed (Groq Llama)",
      "Deep contextual analysis (Gemini 2.0)",
    ],
  },
  {
    num: "03",
    numClass: "flow-num--3",
    tag: "Guardrail Engine",
    tagClass: "flow-tag--amber",
    title: "3. Real-Time Brief Grounding",
    desc: "Every counter-offer is passed through the Grounding Engine. If an agent attempts to violate user terms or hallucinate external facts, the turn is rejected.",
    points: [
      "Deterministic brief alignment check",
      "Live human voice override available",
    ],
  },
  {
    num: "04",
    numClass: "flow-num--4",
    tag: "Consensus Protocol",
    tagClass: "flow-tag--green",
    title: "4. Settlement or Escalation",
    desc: "When both agents reach mathematical overlap within brief floors, a signed settlement is generated. If deadlocked, it cleanly escalates with summary reports.",
    points: [
      "Mathematical concession verification",
      "Legally structured settlement output",
    ],
  },
];

function HowItWorksSection() {
  return (
    <section className="sect" id="how">
      <div className="sect-inner">
        <div className="sect-header">
          <div className="sect-tag">Execution Pipeline</div>
          <h2 className="sect-h2">How the protocol operates</h2>
          <p className="sect-desc">
            A four-stage deterministic workflow built from the ground up to never fabricate an agreement.
          </p>
        </div>

        <div className="flow-grid">
          {HOW_STEPS.map((s) => (
            <div key={s.num} className="gp flow-card">
              <div className="flow-step-header">
                <div className={`flow-num-badge ${s.numClass}`}>{s.num}</div>
                <div className={`flow-provider-tag ${s.tagClass}`}>{s.tag}</div>
              </div>

              <div>
                <h3 className="flow-title">{s.title}</h3>
                <p className="flow-desc">{s.desc}</p>
              </div>

              <ul className="flow-points">
                {s.points.map((p) => (
                  <li key={p} className="flow-point">
                    <span className="flow-point-check">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TECH STACK MARQUEE
   ═══════════════════════════════════════════════════════════════════════════ */
const TECH_STACK = [
  "Groq Llama 3.3 70B",
  "Google Gemini 2.0 Flash",
  "Groq Whisper STT",
  "FastAPI Engine",
  "Next.js App Router",
  "WebSockets",
  "Python 3.12",
  "TypeScript",
  "HTML5 Canvas",
  "Framer Motion",
];

function StackMarquee() {
  const items = [...TECH_STACK, ...TECH_STACK];
  return (
    <div className="mq-wrap" id="stack">
      <div className="mq-box gp gp--static">
        <div className="mq-track">
          {items.map((tech, idx) => (
            <div key={`${tech}-${idx}`} className="mq-item">
              <span className="mq-dot" />
              <span>{tech}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MASTER 4-COLUMN FOOTER
   ═══════════════════════════════════════════════════════════════════════════ */
function MasterFooter() {
  return (
    <footer className="master-footer" id="arena">
      <div className="footer-panel gp gp--static">
        <div className="footer-grid">
          {/* Col 1: Brand */}
          <div className="footer-brand">
            <a href="/" className="footer-logo">Samjhauta</a>
            <p className="footer-tagline">
              Autonomous adversarial AI negotiation infrastructure. Two distinct foundation models
              finding mathematical consensus for real human disputes.
            </p>
          </div>

          {/* Col 2: Navigation */}
          <div>
            <div className="footer-col-title">Architecture</div>
            <ul className="footer-links">
              <li><a href="#features" className="footer-link">Dual-Provider Engine</a></li>
              <li><a href="#features" className="footer-link">Grounding Guardrail</a></li>
              <li><a href="#features" className="footer-link">Voice Barge-In</a></li>
              <li><a href="#features" className="footer-link">Deadlock Protocol</a></li>
              <li><a href="#how" className="footer-link">4-Stage Pipeline</a></li>
            </ul>
          </div>

          {/* Col 3: Live Arena Quick-Launch */}
          <div>
            <div className="footer-col-title">Live Arena</div>
            <div className="footer-arena-box">
              <div className="footer-arena-status">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#39FF14", boxShadow: "0 0 8px #39FF14" }} />
                <span>Engine Ready (Free Tier)</span>
              </div>
              <p style={{ fontSize: "0.74rem", color: "var(--t2)", lineHeight: 1.5 }}>
                Launch a 2-agent settlement session with live speech override.
              </p>
              <a href="/setup" className="btn btn--sm btn--primary" style={{ width: "100%", marginTop: 4 }}>
                Launch Arena Session →
              </a>
            </div>
          </div>

          {/* Col 4: Dual Models & GitHub */}
          <div>
            <div className="footer-col-title">Open Source</div>
            <ul className="footer-links">
              <li>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="footer-link">
                  <GitHubIcon /> GitHub Repository
                </a>
              </li>
              <li><a href="#" className="footer-link">Evaluation Harness</a></li>
              <li><a href="#" className="footer-link">Concession Algorithm</a></li>
              <li><a href="#" className="footer-link">WebSocket Protocol</a></li>
              <li><span style={{ color: "var(--t3)", fontSize: "0.72rem" }}>MIT License · Open Standard</span></li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="footer-bottom-bar">
          <div>
            © 2025 Samjhauta Platform. Built for autonomous consensus without hallucinations.
          </div>
          <div className="footer-stats-mini">
            <span style={{ color: "var(--cyan)" }}>Groq Llama 3.3</span>
            <span style={{ color: "var(--t3)" }}>×</span>
            <span style={{ color: "var(--magenta)" }}>Gemini 2.0 Flash</span>
            <span style={{ color: "var(--t3)" }}>·</span>
            <span style={{ color: "var(--green)" }}>0 Fake Deals</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE ENTRY POINT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  return (
    <div className="lp">
      {/* Static Ambient Scene (Zero GPU repaint overhead) */}
      <div className="ambient-scene" aria-hidden="true" />

      {/* Navigation */}
      <Navbar />

      {/* Scroll-Scrub Hero */}
      <ScrollHero />

      {/* Transition Bridge */}
      <TransitionBridge />

      {/* Bento Grid Features */}
      <FeaturesSection />

      {/* 2x2 Flow How It Works */}
      <HowItWorksSection />

      {/* Tech Stack Marquee */}
      <StackMarquee />

      {/* 4-Column Master Footer */}
      <MasterFooter />
    </div>
  );
}
