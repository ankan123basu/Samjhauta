"""Test JSON output from available models."""
import sys, json, groq, google.generativeai as genai
from pathlib import Path

# Allow running from backend directory
sys.path.insert(0, str(Path(__file__).parent.parent))
from app.config import settings

c = groq.Groq(api_key=settings.get_groq_api_key)

models_to_test = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'allam-2-7b']

for model in models_to_test:
    print(f"\n=== {model} ===")
    try:
        r = c.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a negotiation agent. Respond ONLY with valid JSON. No other text."},
                {"role": "user", "content": 'Your turn to negotiate. Suggest 45%. Reply: {"offer": 45, "message": "your negotiation text here"}'},
            ],
            max_tokens=100,
            temperature=0.7,
        )
        text = r.choices[0].message.content.strip()
        print(f"  Raw: {text[:200]}")
        if text:
            try:
                data = json.loads(text)
                print(f"  Parsed: offer={data.get('offer')}, msg={data.get('message','')[:60]}")
            except Exception:
                print("  NOT VALID JSON")
    except Exception as e:
        print(f"  ERROR: {str(e)[:100]}")

# Also test Gemini 3.6 flash
print("\n=== Gemini 3.6 Flash ===")
if settings.google_api_key:
    genai.configure(api_key=settings.google_api_key)
    model = genai.GenerativeModel(
        "gemini-3.6-flash",
        system_instruction="You are a negotiation agent. Respond ONLY with valid JSON."
    )
    r = model.generate_content('Suggest 55%. Reply: {"offer": 55, "message": "your text"}')
    text = r.text.strip()
    print(f"  Raw: {text[:200]}")
    try:
        import re
        if text.startswith("```"):
            text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
        data = json.loads(text)
        print(f"  Parsed: offer={data.get('offer')}, msg={data.get('message','')[:60]}")
    except Exception:
        print("  NOT VALID JSON")
else:
    print("  Google API key not configured.")

print("\n=== DONE ===")
