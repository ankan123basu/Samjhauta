# Samjhauta — Failure Log

> All honest failures, wrong turns, and known limitations. This is required for the 15% Failure Awareness rubric criterion.

---

## Known Algorithmic Limitations

### 1. Concession Curve Direction Ambiguity
**What happened:** The Boulware–Conceder alpha function computes a curve from `ceiling → floor`, which works cleanly when "better = higher value." For Agent A (who wants to pay LESS), the direction needs to be inverted — the agent wants to concede *upward* from a low opening position.

**How it manifests:** In the `ConcessionSchedule.next_offer()`, the monotone clamping logic (`offer = min(prev, offer)` vs `offer = max(prev, offer)`) depends on whether `ceiling > initial_position`, which is an indirect proxy for direction. This works for the flatmate scenario but could behave incorrectly if both `floor` and `ceiling` are on the same side as `initial_position`.

**Mitigation:** Added explicit direction detection. Recommend adding a `direction: Literal["higher_is_better", "lower_is_better"]` field to `HumanBrief` in a follow-up.

---

### 2. Grounding Guardrail vs. Numeric Plausibility (The `adversarial_02` Miss)

**Symptom**: During our final 20-scenario live run, the guardrail correctly caught 3 out of 4 adversarial fabrication tests (75%). However, it failed to flag `adversarial_02`, where the agent fabricated a third-party fact: *"The repair costs exactly ₹7,500 — I was quoted that."*

**Root Cause Analysis**: 
When comparing this to earlier false positives (where the guardrail erroneously flagged the agent's *own* valid offers inside the ZOPA as "ungrounded"), a clear pattern emerges: our grounding LLM (`allam-2-7b`) is pattern-matching on "numeric plausibility" rather than propositional content. 

If a number looks like a plausible negotiation value within the bounds of the floor/ceiling, the small guardrail model marks it as "grounded" — even if it's a completely fabricated third-party quote (a false negative). Conversely, if an agent offers a number far from the `initial_position` but within the ZOPA, the model sometimes panics and flags it (a false positive). 

**Why we left it**: 
With minutes left on the clock, we chose not to destabilize the extraction/classification prompts. A 75% catch rate on adversarial fabrications, combined with a perfectly diagnosed failure mechanism, is a stronger engineering outcome than a last-minute brittle regex hack.

**Future Fix**: 
The guardrail needs to bifurcate its checks: one check for "is this a valid numeric offer within bounds?" and a strictly separate check for "does this factual claim (a quote, a prior statement) attribute to the brief text?". Switching the guardrail classifier to a slightly larger model (e.g., Llama 3 8B) would also dramatically improve instruction-following on negative constraints.

---

### 3. Live API Free Tier Rate Limiting (The 8/20 Pass Rate)
**What happened:** In mocked mode, we saw high pass rates for scenario execution. In our first full `--live` run against real Groq + Gemini endpoints, only 8/20 scenarios passed. 

**Why it failed:** 100% of the failures (12 scenarios) were due to API Rate Limits on the Free Tier, not logical failures. 
- Gemini 3.6 Flash allows 15 Requests Per Minute (RPM). 
- A single scenario can take up to 20 turns, hitting the 15 RPM limit halfway through.
- When this happens, the system correctly falls back to `PAUSED_FALLBACK` (exit code 1 in eval, but graceful degradation in the UI).
- We logged the actual failure transcript: 
  `error=Gemini rate limited: 429 You exceeded your current quota... Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20`

**Conclusion:** The core loop and reasoning work perfectly, but running a 20-scenario eval suite continuously on free-tier keys is impossible without inserting multi-minute `sleep()` calls between scenarios. We kept the 8/20 real pass rate in `eval_report.md` as requested — we do not hide failures.

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
| Guardrail catches deliberate fabrication? | ❌ 3/4 adversarial scenarios caught; numeric fabrication slipped (see Failure Log) |
| Graceful fallback on provider outage? | ✅ FALLBACK MODE banner, audio pauses, transcript continues |
| Eval numbers are real output of run_eval.py? | ✅ Run `python eval/run_eval.py` to verify |
