# Samjhauta — Five Questions

## 1. Who exactly uses this?

Two flatmates — Arjun and Priya — who share a flat in Bangalore. Their washing machine broke. Arjun thinks it's a shared risk, 50/50. Priya thinks whoever was using it when it broke should pay more. Neither wants to be the one to bring it up first. They've been avoiding the conversation for two weeks.

Samjhauta lets each of them brief their own AI agent privately — their position, their floor (minimum they'll accept), and why they feel the way they do — and then watches the agents negotiate out loud on their behalf. Either human can barge in, override, or set a hard limit at any time. If the agents can't reach a deal, the system says so honestly and hands it back to the humans.

---

## 2. What is the non-obvious hard part?

Not the voice. The **trust.**

Specifically: building a grounding guardrail that catches an agent fabricating a claim about its own human's constraints — a hallucination that in this context would actually cost someone money. The agent might say "my flatmate already agreed to pay 60%" when the human never said that. The guardrail must catch this every time, not most of the time.

The second hard part: building a deadlock detector that reliably tells "still converging slowly" (Boulware strategy, small per-turn deltas, but a real deal is coming) apart from "genuinely stuck" (both agents flat, no overlapping range). The solution — sliding window + ZOPA gap check — is documented in `backend/app/negotiation/deadlock_detector.py`.

---

## 3. What did you build vs what did the API give you?

The API gives us one fluent negotiating turn — a language model producing a coherent response.

We built:
- The **Boulware–Conceder concession schedule** — a logarithmic alpha function that determines how much to concede at each turn and whether a move constitutes a real concession or a stall
- The **deadlock detector** — sliding window + ZOPA gap check, with documented false-positive analysis
- The **grounding guardrail** — secondary LLM call that extracts factual claims and checks them against the human's verified brief
- The **human barge-in mechanism** — live voice (Groq Whisper) → text → injection into next agent context
- The **dual-provider architecture** — two different foundation models from two different providers, not the same model called twice
- The **graceful degradation layer** — visible FALLBACK MODE on provider failure, transcript always on

---

## 4. Why does it break without AI?

A rule engine cannot decide what a reasonable next concession looks like given two private, conflicting sets of priorities, or tell the difference between "still productively converging" and "genuinely stuck." Remove the model and you have two people who still haven't had the conversation.

Specifically: the concession *reasoning* — "given that they've just moved 5%, what should I offer back that signals willingness without revealing my floor?" — requires understanding context, tone, and strategic intent. That's not a decision tree.

---

## 5. What breaks at 10,000 users?

**Free-tier rate limits (verified Aug 2026):**

| Provider | Model | RPM | RPD | Limit hit at… |
|---|---|---|---|---|
| Groq | Llama 3.3 70B | 30 | 1,000 | ~2 concurrent sessions |
| Groq | Whisper Large v3 Turbo | 20 | 2,000 | ~20 barge-ins/day |
| Google AI Studio | Gemini 3.5 Flash | ~15–60 | ~1,500 | ~3–6 concurrent sessions |

At 10k users you'd need:
- **Groq Developer plan:** ~$0.59/1M tokens for Llama 3.3 70B
- **Google AI (billed):** ~$0.30/1M input tokens for Gemini 3.5 Flash
- **Full negotiation cost:** ~$0.02 per session (20 turns × ~500 tokens/turn × 2 providers)
- **At 10k sessions/day:** ~$200/day

Beyond that:
- Browser TTS quality would need to be replaced with a paid voice API (ElevenLabs, PlayHT) if audio quality becomes a selling point
- WebSocket connections need a connection broker (Redis Pub/Sub or similar) for horizontal scaling
- Session state needs to move from in-memory (current) to a persistent store (Redis or DB)
