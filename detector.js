/**
 * detector.js
 * ------------
 * A very simple, LOCAL harmful-language detector.
 *
 * WHY THIS FILE EXISTS:
 *   We keep detection logic separate from the scanning logic (content.js).
 *   That way, when we later swap this keyword list for an AI/API classifier,
 *   we only change THIS file. content.js does not need to know HOW detection
 *   works, only that it can call `detectHarmfulLanguage(text)` and get a result.
 *
 * HOW IT'S SHARED:
 *   Chrome content scripts declared in the same manifest entry share the same
 *   "isolated world" (a private JS scope for the page). Because detector.js is
 *   listed BEFORE content.js in manifest.json, anything we attach to `window`
 *   here is available to content.js afterward.
 */

// A small list of sample harmful words / phrases.
// These are mild placeholders just to prove the concept.
// Later this can be replaced by a model or an API call.
const HARMFUL_TERMS = [
  "idiot",
  "stupid",
  "hate you",
  "shut up",
  "moron",
  "loser"
];

/**
 * Check a piece of text against the harmful terms list.
 *
 * @param {string} text - The readable text to check.
 * @returns {{
 *   detected: boolean,        // was any harmful term found?
 *   matchedPhrase: string|null, // the harmful term that matched (or null)
 *   snippet: string           // the text we checked (trimmed)
 * }}
 *
 * NOTE: Matching is CASE-INSENSITIVE. We lowercase both the text and the
 * terms before comparing. We return on the FIRST match to keep V1 simple.
 */
function detectHarmfulLanguage(text) {
  const result = {
    detected: false,
    matchedPhrase: null,
    snippet: (text || "").trim()
  };

  if (!text) {
    return result;
  }

  const lowerText = text.toLowerCase();

  for (const term of HARMFUL_TERMS) {
    if (lowerText.includes(term.toLowerCase())) {
      result.detected = true;
      result.matchedPhrase = term;
      break; // first match is enough for V1
    }
  }

  return result;
}

// Expose the detector to content.js via the shared `window` object.
// This is the single "seam" we will replace when moving to an AI classifier.
window.ProtectionScanner = window.ProtectionScanner || {};
window.ProtectionScanner.detectHarmfulLanguage = detectHarmfulLanguage;
window.ProtectionScanner.HARMFUL_TERMS = HARMFUL_TERMS;
