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
  { phrase: "idiot", category: "insult", severity: "low" },
  { phrase: "stupid", category: "insult", severity: "low" },
  { phrase: "moron", category: "insult", severity: "low" },
  { phrase: "loser", category: "insult", severity: "low" },
  { phrase: "piece of shit", category: "insult", severity: "medium" },
  { phrase: "fuck", category: "profanity", severity: "low" },
  { phrase: "shit", category: "profanity", severity: "low" },
  { phrase: "hate you", category: "hostile language", severity: "medium" },
  { phrase: "shut up", category: "hostile language", severity: "low" },
  { phrase: "I will hurt you", category: "threat", severity: "high" },
  { phrase: "I will kill you", category: "threat", severity: "high" },
  { phrase: "kill yourself", category: "self-harm encouragement", severity: "high" }
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createRulePattern(phrase) {
  // Capture the leading boundary so offsets refer to the original phrase.
  return new RegExp(
    "(^|[^\\p{L}\\p{N}\\p{M}_])" +
      escapeRegExp(phrase).replace(/\s+/g, "\\s+") +
      "(?=$|[^\\p{L}\\p{N}\\p{M}_])",
    "giu"
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

  HARMFUL_RULES.forEach((rule, ruleOrder) => {
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
        endIndex: phraseStart + phrase.length,
        ruleOrder
      });

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  });

  // Prefer the leftmost match, then the longest rule, then existing rule order.
  matches.sort((left, right) =>
    left.startIndex - right.startIndex ||
    right.endIndex - left.endIndex ||
    left.ruleOrder - right.ruleOrder
  );

  const uniqueMatches = [];
  for (const match of matches) {
    const previous = uniqueMatches[uniqueMatches.length - 1];
    if (previous && match.startIndex < previous.endIndex) continue;
    const { ruleOrder, ...publicMatch } = match;
    uniqueMatches.push(publicMatch);
  }

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
