"""
Samjhauta — Grounding Guardrail
================================
Prevents agents from hallucinating constraints that their human never stated.

WHY THIS MATTERS
----------------
In a real negotiation, an agent that fabricates "my flatmate already said they'd
pay 60%" has committed fraud. The grounding guardrail is the most safety-critical
component of the system — not for demo points, but because we're simulating a
real dispute where a hallucinated constraint could lead to a genuinely unfair
outcome.

ALGORITHM
---------
When an agent produces a turn, before it is accepted we:

  1. Extract all "constraint claims" from the turn — any statement about:
       - What the human said / agreed to / wants
       - What a limit or boundary is
       - What some objective fact about the dispute is (cost, time, etc.)
       This extraction uses a secondary LLM call (fast, small model, low cost).

  2. For each extracted claim, check whether it is:
       (a) Directly stated in the HumanBrief, OR
       (b) A reasonable inference from the HumanBrief (e.g. "I want to pay less"
           is a valid inference if floor < initial_position)
       This check uses a fast regex pre-filter to skip harmless claims, and an
       LLM grounding classifier for deep semantic validation when needed.

  3. If any claim fails the check → REJECT the turn and regenerate with a
     correction injected into the prompt.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from app.config import settings
from app.models.schemas import HumanBrief, NegotiationTurn


MAX_REGENERATION_ATTEMPTS = 3


# ── Claim extraction ──────────────────────────────────────────────────────────

EXTRACTION_SYSTEM_PROMPT = """You are a claim extractor for a negotiation guardrail system.

Given a negotiation message, extract all FACTUAL CLAIMS that require grounding verification.
ONLY extract statements that reference:
- Something the OTHER party supposedly said, agreed to, or promised.
- A specific objective fact or number attributed to conversation history or the real world (e.g. "a plumber quoted us $500", "you broke it yesterday").

CRITICAL EXCLUSIONS - DO NOT EXTRACT:
- A bare statement of the agent's own current offer or position (e.g. "I am offering 30%", "I can meet at 10am"). This is a negotiation move, not a claim about the world.
- The agent's own feelings or desires (e.g. "I want to resolve this fairly").
- The agent bluffing about its own limits (e.g. "My absolute limit is 45%").

Return a JSON object: {"claims": ["claim1", "claim2", ...]}
If there are no factual claims that meet the criteria, return {"claims": []}
Be precise — only extract claims that actually require verification against a brief."""


def _extract_claims_with_llm(message: str, groq_client) -> list[str]:
    """Use Groq's fast model to extract factual claims from an agent turn."""
    try:
        response = groq_client.chat.completions.create(
            model=settings.groq_guardrail_model,  # fast, cheap for extraction
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": f"Message to analyse:\n{message}"},
            ],
            response_format={"type": "json_object"},
            max_tokens=256,
            temperature=0,  # deterministic extraction
        )
        data = json.loads(response.choices[0].message.content)
        return data.get("claims", [])
    except Exception:
        # If extraction fails, fall back to regex
        return _extract_claims_regex(message)


def _extract_claims_regex(message: str) -> list[str]:
    """
    Fallback regex-based claim extraction when LLM is unavailable.
    Less accurate but catches the most obvious hallucinations.
    """
    patterns = [
        # Attribution: someone said/agreed/promised something
        r"(?:you|they|he|she|my flatmate|partner|roommate)\s+(?:already\s+)?(?:said|agreed|told me|confirmed|promised)\s+.{3,80}",
        # Already agreed pattern (common fabrication)
        r"already\s+agreed\s+to\s+.{3,60}",
        r"already\s+said\s+.{3,60}",
        # Cost/price claims: capture the sentence fragment around repair/cost + any number
        r"(?:the|a)\s+(?:cost|price|amount|total|repair)\s+(?:costs?|is|was|will be)\s+.{0,20}\d[\d,]+",
        r"(?:costs?|priced at|worth)\s+.{0,10}\d[\d,]+",
        # 'quoted by' pattern — always a fabricated specific cost
        r"(?:I was quoted|quoted at|quoting)\s+.{3,50}(?:by|from)",
        # Limit attributions
        r"(?:you|your)\s+(?:floor|ceiling|limit|maximum|minimum)\s+is\s+[\d.]+",
        # 'in our earlier conversation' patterns
        r".{5,60}\s+in our earlier conversation",
        r".{5,60}\s+before this negotiation",
    ]
    claims = []
    for pattern in patterns:
        matches = re.findall(pattern, message, re.IGNORECASE)
        claims.extend(matches)
    return claims


# ── Grounding check ───────────────────────────────────────────────────────────

GROUNDING_SYSTEM_PROMPT = """You are a grounding classifier for a negotiation guardrail system.
You are given:
1. A candidate claim made by our agent (representing our human).
2. The private brief of our human containing facts, constraints (floor, ceiling, initial position), context, and rules.

You must decide whether the candidate claim is supported by (grounded in) our human's brief.
A claim is grounded if:
- It is a direct fact from the brief (e.g. "my floor is 40%").
- It is a reasonable strategic argument or position that doesn't contradict the brief limits (e.g. bidding 50% when floor is 40% and ceiling is 60%).
- It is an opinion or soft reasoning consistent with the private context.

A claim is NOT grounded (fabrication/hallucination) if:
- It fabricates a prior agreement, promise, or statement by either party that is NOT in the brief (e.g. "my flatmate already agreed to 80%" or "we promised last week to split 50/50" when the brief says nothing about such agreements).
- It fabricates objective facts about the dispute that aren't in the brief (e.g. inventing a repair quote from a plumber when none exists).
- It attributes constraints to the other party that we cannot verify from our brief.

NOTE: It IS completely acceptable and GROUNDED for an agent to:
1. State its own current offer or position (e.g. "I am offering 30%" or "I can meet at 10am"). This is a negotiation move, NOT a fabrication. Do NOT flag an offer as ungrounded just because it differs from the 'initial_position' in the brief.
2. Bluff about its *own* limits (e.g. saying "My absolute limit is 45%" even if the brief says the floor is 30%). This is normal negotiation posturing. 
Do NOT flag these as ungrounded.

Return a JSON object only:
{
  "grounded": true or false,
  "reason": "a brief explanation of why it is or is not grounded (especially if false)"
}
"""


def _needs_llm_grounding_check(claim: str) -> bool:
    """
    Fast pre-filter to decide if we need to call the LLM for grounding.
    Returns True if the claim contains numbers, currency symbols, or attribution keywords.
    """
    claim_lower = claim.lower()
    
    # 1. Contains a number
    if re.search(r'\d+', claim):
        return True
        
    # 2. Contains attribution or contract/agreement keywords
    keywords = [
        "agreed", "said", "promised", "confirmed", "told me",
        "conversation", "earlier", "previous", "last time", "limit",
        "floor", "ceiling", "budget", "cost", "price", "quote",
        "agreement", "promise"
    ]
    if any(k in claim_lower for k in keywords):
        return True
        
    return False


def _is_claim_grounded_rule(claim: str, brief: HumanBrief) -> tuple[bool, str]:
    """
    Rule-based fallback check when LLM is unavailable.
    """
    claim_lower = claim.lower()
    brief_text = (
        f"initial position: {brief.initial_position} {brief.unit_label}. "
        f"floor: {brief.floor} {brief.unit_label}. "
        f"ceiling: {brief.ceiling} {brief.unit_label}. "
        f"context: {brief.private_context.lower()}. "
        f"topic: {brief.dispute_topic.lower()}."
    )

    # Extract numbers from the claim
    claim_numbers = re.findall(r"\d+\.?\d*", claim)

    for num_str in claim_numbers:
        num = float(num_str)
        # Is this number close to any brief value?
        brief_values = [brief.floor, brief.ceiling, brief.initial_position]
        if not any(abs(num - v) < 1.0 for v in brief_values):
            # Number doesn't match any brief value
            # Also check if it appears in the private context
            if num_str not in brief.private_context and num_str not in brief.dispute_topic:
                return False, f"Claim contains number {num} not in brief (floor={brief.floor}, ceiling={brief.ceiling}, position={brief.initial_position})"

    # Check for claims about what "the other party said" — always suspicious
    other_party_phrases = [
        "you agreed", "you said", "you confirmed", "you promised",
        "they agreed", "they said", "my flatmate said", "partner said",
        "already agreed to", "already said", "already promised",
        "before this negotiation", "in our earlier conversation",
        "in a previous", "last time you said",
    ]
    for phrase in other_party_phrases:
        if phrase in claim_lower:
            return False, f"Claim attributes a statement to the other party: '{claim[:80]}' — never stated in brief"

    return True, "grounded"


def _is_claim_grounded_with_llm(claim: str, brief: HumanBrief, groq_client) -> tuple[bool, str]:
    """
    Deep grounding check using a fast LLM call.
    Uses a fast pre-filter to bypass harmless claims.
    """
    if not _needs_llm_grounding_check(claim):
        return True, "grounded (pre-filter passed)"

    brief_data = {
        "name": brief.name,
        "initial_position": brief.initial_position,
        "floor": brief.floor,
        "ceiling": brief.ceiling,
        "unit": brief.unit_label,
        "private_context": brief.private_context,
        "dispute_topic": brief.dispute_topic
    }
    
    user_prompt = f"Candidate Claim: \"{claim}\"\n\nHuman Brief:\n{json.dumps(brief_data, indent=2)}"
    
    try:
        response = groq_client.chat.completions.create(
            model=settings.groq_guardrail_model,  # fast, low latency
            messages=[
                {"role": "system", "content": GROUNDING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            max_tokens=150,
            temperature=0,
        )
        result = json.loads(response.choices[0].message.content)
        return bool(result.get("grounded", True)), result.get("reason", "No reason provided")
    except Exception as e:
        # Fallback to rules on error
        return _is_claim_grounded_rule(claim, brief)


# ── Main guardrail ────────────────────────────────────────────────────────────

class GroundingGuardrail:
    """
    Validates agent turns against the human's brief.
    
    Instantiate once per agent per session. Call `check_turn()` before
    accepting any turn. If it fails, call `correction_injection()` to get
    the correction text to prepend to the next LLM prompt.
    """

    def __init__(self, brief: HumanBrief, groq_client=None) -> None:
        self.brief = brief
        self._groq_client = groq_client
        self._total_checks = 0
        self._total_failures = 0
        self._failure_log: list[dict] = []

    def check_turn(self, turn_text: str) -> tuple[bool, list[str]]:
        """
        Returns (passed, list_of_flags).
        Flags are human-readable descriptions of each grounding failure.
        """
        self._total_checks += 1

        # Step 1: Extract claims
        if self._groq_client is not None:
            claims = _extract_claims_with_llm(turn_text, self._groq_client)
        else:
            claims = _extract_claims_regex(turn_text)

        # Step 2: Check each claim
        flags = []
        for claim in claims:
            if self._groq_client is not None:
                grounded, reason = _is_claim_grounded_with_llm(claim, self.brief, self._groq_client)
            else:
                grounded, reason = _is_claim_grounded_rule(claim, self.brief)
            if not grounded:
                flags.append(reason)

        if flags:
            self._total_failures += 1
            self._failure_log.append({"turn_text": turn_text[:200], "flags": flags})
            return False, flags

        return True, []

    def correction_injection(self, flags: list[str]) -> str:
        """
        Returns a correction string to prepend to the next LLM prompt,
        steering the agent back to only use grounded claims.
        """
        brief = self.brief
        corrections = "\n".join(f"- {f}" for f in flags)
        return (
            f"CORRECTION REQUIRED — Your previous message contained claims "
            f"not supported by your briefing. Do NOT repeat these:\n{corrections}\n\n"
            f"Your verified briefing limits:\n"
            f"  Position: {brief.initial_position}{brief.unit_label}\n"
            f"  Floor (minimum you will accept): {brief.floor}{brief.unit_label}\n"
            f"  Ceiling (best case): {brief.ceiling}{brief.unit_label}\n"
            f"  Private context: {brief.private_context}\n\n"
            f"Restate your position using ONLY information from the above. "
            f"Do not invent facts about costs, agreements, or what the other party said."
        )

    def force_fabrication_test(self, fabricated_claim: str) -> bool:
        """
        TEST HOOK used by the eval harness.
        Injects a known-fabricated claim and returns True if the guardrail
        correctly catches it.
        """
        passed, flags = self.check_turn(fabricated_claim)
        return not passed  # True = guardrail correctly caught the fabrication

    @property
    def stats(self) -> dict:
        return {
            "total_checks": self._total_checks,
            "total_failures": self._total_failures,
            "failure_rate": (
                self._total_failures / self._total_checks
                if self._total_checks > 0 else 0.0
            ),
            "failure_log": self._failure_log,
        }
