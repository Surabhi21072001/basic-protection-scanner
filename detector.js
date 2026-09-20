/**
 * detector.js
 * -----------
 * Local harmful-language detection kept separate from DOM scanning.
 *
 * The returned result is deliberately independent of the DOM. A future
 * classifier or API adapter can produce the same shape without requiring
 * changes to content.js.
 */

const HARMFUL_RULES = [
  { phrase: "hate you", category: "hostile language", severity: "medium" },
  { phrase: "shut up", category: "hostile language", severity: "low" },
  { phrase: "idiot", category: "insult", severity: "low" },
  { phrase: "stupid", category: "insult", severity: "low" },
  { phrase: "moron", category: "insult", severity: "low" },
  { phrase: "loser", category: "insult", severity: "low" }
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createRulePattern(phrase) {
  // Capture the leading boundary so offsets refer to the original phrase.
  return new RegExp(
    "(^|[^A-Za-z0-9_])" +
      escapeRegExp(phrase).replace(/\s+/g, "\\s+") +
      "(?=$|[^A-Za-z0-9_])",
    "gi"
  );
}

/**
 * @param {string} text
 * @returns {{
 *   detected: boolean,
 *   originalText: string,
 *   matches: Array<{
 *     phrase: string,
 *     category: string,
 *     severity: "low"|"medium"|"high",
 *     startIndex: number,
 *     endIndex: number
 *   }>,
 *   suggestedRewrite: string|null
 * }}
 */
function detectHarmfulLanguage(text) {
  const originalText = typeof text === "string" ? text : "";
  const matches = [];

  for (const rule of HARMFUL_RULES) {
    const pattern = createRulePattern(rule.phrase);
    let match;

    while ((match = pattern.exec(originalText)) !== null) {
      const phraseStart = match.index + match[1].length;
      const phrase = originalText.slice(
        phraseStart,
        phraseStart + match[0].length - match[1].length
      );

      matches.push({
        phrase,
        category: rule.category,
        severity: rule.severity,
        startIndex: phraseStart,
        endIndex: phraseStart + phrase.length
      });

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }

  matches.sort((left, right) => left.startIndex - right.startIndex);

  // Deduplicate identical source spans if rules are expanded later.
  const uniqueMatches = matches.filter((match, index) => {
    const previous = matches[index - 1];
    return !previous ||
      previous.startIndex !== match.startIndex ||
      previous.endIndex !== match.endIndex;
  });

  return {
    detected: uniqueMatches.length > 0,
    originalText,
    matches: uniqueMatches,
    // Rewriting is intentionally not part of the detector yet.
    suggestedRewrite: null
  };
}

window.ProtectionScanner = window.ProtectionScanner || {};
window.ProtectionScanner.detectHarmfulLanguage = detectHarmfulLanguage;
window.ProtectionScanner.HARMFUL_RULES = HARMFUL_RULES;
