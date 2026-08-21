# Samjhauta — Prior Art

## 3 Closest Existing Products

### 1. Modria / Tyler Technologies (AI Mediation Platform)
Single AI mediating between two parties, primarily for legal/insurance disputes. One model sees both sides. No concept of agent loyalty, no hard walk-away limits, no grounding guardrail. The AI is a neutral mediator, not a loyal agent for each party.

**How Samjhauta differs:** Two independently-loyal agents, one per human, running on genuinely different foundation models. Each agent is *committed* to their human — they cannot make deals their human explicitly rejected. The AI doesn't mediate; it *negotiates*.

---

### 2. Multi-Agent "Debate" Frameworks (e.g. ChatDev, AutoGen multi-agent)
Multi-agent systems where models argue against each other. Optimised for consensus or truth-seeking. No private briefs, no floor/ceiling limits, no deadlock escalation, no grounding guardrail. "Winning" means the best argument, not the best deal within constraints.

**How Samjhauta differs:** Agents optimise for their human's constraints, not for "winning" a debate. Walk-away limits are hard — agents cannot fabricate constraint relaxations. The system knows when to stop (deadlock) rather than arguing forever.

---

### 3. Demo-tier "AI Negotiates Price" Projects (various hackathons)
Single-model demos where one LLM plays both buyer and seller with role-switching prompts. No dual-provider architecture, no private briefs, no deadlock handling, frequently hallucinates agreed prices. The "two agents" is cosmetic — it's one model context.

**How Samjhauta differs:** Genuinely two different foundation models from two different providers (Groq Llama 3.3 70B and Google Gemini 3.5 Flash). Different inference stacks, different API surfaces, different training data. A grounding guardrail prevents hallucinated agreements from propagating.

---

## Why None of These Could Have Existed in 2023

Cheap, fast STT (Groq-hosted Whisper) and cheap, fast LLM inference (Groq, Gemini free tiers) make running two independently-reasoning negotiation agents with real-time human barge-in economically and technically feasible for a hackathon team for the first time. Two years ago this required either expensive low-latency voice infrastructure or model calls too slow and costly to feel live.
