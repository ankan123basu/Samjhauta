/**
 * Samjhauta — Indic Transliteration & Multilingual Configuration
 * Powered by Google Input Tools API for instant phonetic typing in Indic scripts
 * (e.g. typing "samjhauta " -> "समझौता ")
 */

export interface LanguageOption {
  code: string;       // Short code e.g. "hi", "bn"
  srCode: string;     // Speech recognition code e.g. "hi-IN"
  name: string;       // English name e.g. "Hindi"
  native: string;     // Native script label e.g. "हिन्दी"
  itc?: string;       // Google Input Tools ITC code
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", srCode: "en-US", name: "English", native: "English" },
  { code: "hi", srCode: "hi-IN", name: "Hindi", native: "हिन्दी", itc: "hi-t-i0-und" },
  { code: "bn", srCode: "bn-IN", name: "Bengali", native: "বাংলা", itc: "bn-t-i0-und" },
  { code: "ta", srCode: "ta-IN", name: "Tamil", native: "தமிழ்", itc: "ta-t-i0-und" },
  { code: "te", srCode: "te-IN", name: "Telugu", native: "తెలుగు", itc: "te-t-i0-und" },
  { code: "mr", srCode: "mr-IN", name: "Marathi", native: "मराठी", itc: "mr-t-i0-und" },
  { code: "gu", srCode: "gu-IN", name: "Gujarati", native: "ગુજરાતી", itc: "gu-t-i0-und" },
  { code: "kn", srCode: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ", itc: "kn-t-i0-und" },
  { code: "ml", srCode: "ml-IN", name: "Malayalam", native: "മലയാളം", itc: "ml-t-i0-und" },
  { code: "pa", srCode: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ", itc: "pa-t-i0-und" },
  { code: "or", srCode: "or-IN", name: "Odia", native: "ଓଡ଼ିଆ", itc: "or-t-i0-und" },
  { code: "ur", srCode: "ur-IN", name: "Urdu", native: "اردو", itc: "ur-t-i0-und" },
];

const ITC_MAP: Record<string, string> = {
  "hi": "hi-t-i0-und",
  "hi-IN": "hi-t-i0-und",
  "bn": "bn-t-i0-und",
  "bn-IN": "bn-t-i0-und",
  "ta": "ta-t-i0-und",
  "ta-IN": "ta-t-i0-und",
  "te": "te-t-i0-und",
  "te-IN": "te-t-i0-und",
  "mr": "mr-t-i0-und",
  "mr-IN": "mr-t-i0-und",
  "gu": "gu-t-i0-und",
  "gu-IN": "gu-t-i0-und",
  "kn": "kn-t-i0-und",
  "kn-IN": "kn-t-i0-und",
  "ml": "ml-t-i0-und",
  "ml-IN": "ml-t-i0-und",
  "pa": "pa-t-i0-und",
  "pa-IN": "pa-t-i0-und",
  "or": "or-t-i0-und",
  "or-IN": "or-t-i0-und",
  "ur": "ur-t-i0-und",
  "ur-IN": "ur-t-i0-und",
};

/**
 * Transliterates a single Romanized word into the target Indic script using Google Input Tools.
 */
export async function transliterateWord(word: string, langCode: string): Promise<string | null> {
  const itc = ITC_MAP[langCode] || ITC_MAP[langCode.split("-")[0]];
  if (!itc || !word.trim()) return null;

  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(word.trim())}&itc=${itc}&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
    const res = await fetch(url);
    const data = await res.json();
    if (data[0] === "SUCCESS" && data[1]?.[0]?.[1]?.[0]) {
      return data[1][0][1][0];
    }
  } catch (err) {
    console.warn("Transliteration request failed:", err);
  }
  return null;
}

/**
 * Helper to process text input change for automatic transliteration on trailing space.
 */
export async function processTransliteration(
  currentText: string,
  langCode: string,
  onResult: (newText: string) => void
): Promise<void> {
  if (langCode === "en" || langCode === "en-US" || langCode === "Original") {
    onResult(currentText);
    return;
  }

  // Trigger when a word ends with space
  if (currentText.endsWith(" ")) {
    const words = currentText.trimEnd().split(/\s+/);
    const lastWord = words[words.length - 1];

    if (lastWord && /^[a-zA-Z]+$/.test(lastWord)) {
      const transliterated = await transliterateWord(lastWord, langCode);
      if (transliterated) {
        const prefix = currentText.slice(0, currentText.lastIndexOf(lastWord));
        onResult(prefix + transliterated + " ");
        return;
      }
    }
  }

  onResult(currentText);
}
