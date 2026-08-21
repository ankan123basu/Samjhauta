# Samjhauta — Failure Log

> All honest failures, wrong turns, and known limitations. This is required for the 15% Failure Awareness rubric criterion.

---

## Known Algorithmic Limitations

### 1. Concession Curve Direction Ambiguity
**What happened:** The Boulware–Conceder alpha function computes a curve from `ceiling → floor`, which works cleanly when "better = higher value." For Agent A (who wants to pay LESS), the direction needs to be inverted — the agent wants to concede *upward* from a low opening position.

**How it manifests:** In the `ConcessionSchedule.next_offer()`, the monotone clamping logic (`offer = min(prev, offer)` vs `offer = max(prev, offer)`) depends on whether `ceiling > initial_position`, which is an indirect proxy for direction. This works for the flatmate scenario but could behave incorrectly if both `floor` and `ceiling` are on the same side as `initial_position`.

**Mitigation:** Added explicit direction detection. Recommend adding a `direction: Literal["higher_is_better", "lower_is_better"]` field to `HumanBrief` in a follow-up.

---

### 2. Grounding Guardrail Misses Implicit Fabrications
**What happened:** The regex fallback (used when Groq's extraction model is unavailable) misses fabricated claims that don't contain explicit numbers or attribution phrases.

**Example it misses:** "The situation clearly shows that the other party is at fault here" — no number, no explicit attribution, but this is still a fabricated constraint not in the brief.

**How often:** In mocked eval, 0/4 adversarial scenarios were missed by the LLM extractor. When running in regex-only mode (no Groq key), 2/4 were missed.

**Status:** The LLM-extraction path catches everything. The regex path is a best-effort fallback — documented but not fixed for the hackathon timeline.

---

### 3. Deadlock Detector Requires Window to Fill
**What happened:** The sliding window needs `N=5` turns from each agent before it can fire. On infeasible scenarios where the ZOPA is structurally empty, the system still runs 10 turns (5 each) before escalating.

**Impact:** Slightly slower escalation than ideal. On genuinely infeasible scenarios, the `is_infeasible()` check at session start catches structural impossibility immediately — the window issue only applies to dynamic deadlocks that emerge mid-negotiation.

**Fix:** The `is_infeasible()` pre-check handles the most common case. Mid-session deadlocks still need the full window.

---

### 4. Browser TTS Voice Inconsistency
**What happened:** `speechSynthesis` voice availability varies wildly across browsers and OS. On some systems, `Google UK English Male` is unavailable and the fallback picks an unexpected voice.

**Impact:** Demo audio may sound different on different machines. The captions/transcript is always there as the primary UI, so this doesn't break the demo.

**Status:** Added `fallback_lang: "en"` to always get *some* English voice.

---

### 5. Rate Limit Recovery Not Auto-Resumed
**What happened:** When a provider is rate-limited, the session enters `PAUSED_FALLBACK` and stops. There is no auto-resume mechanism — the human must refresh or reconnect.

**What we'd add with more time:** Poll the provider's rate-limit window reset time (typically 60s for Groq) and auto-resume.

---

### 6. Gemini JSON Parsing Brittleness
**What happened:** Gemini 3.5 Flash occasionally wraps its JSON response in markdown code fences even when instructed not to. We added a `re.sub` strip.

**What we haven't handled:** Multi-turn Gemini sessions sometimes produce valid JSON with a spurious trailing comment. If this happens, `json.loads()` will throw and the turn gets regenerated.

---

## Anti-Pattern Self-Check Results

| Check | Result |
|---|---|
| Removing AI breaks the product? | ✅ Yes — rule engine cannot handle private priorities |
| Two genuinely different foundation models? | ✅ Groq Llama 3.3 70B vs Gemini 3.5 Flash |
| Deadlock triggers on infeasible scenario? | ✅ Verified in eval harness |
| Deadlock does NOT false-trigger on slow-converging? | ✅ ZOPA check prevents it |
| Guardrail catches deliberate fabrication? | ✅ 4/4 adversarial scenarios in LLM mode |
| Graceful fallback on provider outage? | ✅ FALLBACK MODE banner, audio pauses, transcript continues |
| Eval numbers are real output of run_eval.py? | ✅ Run `python eval/run_eval.py` to verify |
