/**
 * detector.js
 * -----------
 * Deterministic local harmful-language detection kept separate from DOM scanning.
 *
 * Matching uses structured phrase rules and narrowly scoped normalization.
 * Returned matches preserve offsets into the original JavaScript string, so
 * callers can annotate source text without depending on normalized spelling.
 * The returned result is independent of the DOM and does not make network calls.
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

const REMOVED_MATCHING_CHARACTERS = new Set([0x200B, 0x2060, 0xFEFF]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createRulePattern(phrase) {
  // Capture the leading boundary so match offsets exclude the boundary itself.
  return new RegExp(
    "(^|[^\\p{L}\\p{N}\\p{M}_])" +
      escapeRegExp(phrase).replace(/\s+/g, "\\s+") +
      "(?=$|[^\\p{L}\\p{N}\\p{M}_])",
    "giu"
  );
}

function normalizeForMatching(originalText) {
  let text = "";
  const sourceStartByIndex = [];
  const sourceEndByIndex = [];

  for (let sourceIndex = 0; sourceIndex < originalText.length;) {
    const codePoint = originalText.codePointAt(sourceIndex);
    const sourceLength = codePoint > 0xFFFF ? 2 : 1;

    if (REMOVED_MATCHING_CHARACTERS.has(codePoint)) {
      sourceIndex += sourceLength;
      continue;
    }

    const normalizedCharacter = codePoint >= 0xFF01 && codePoint <= 0xFF5E
      ? String.fromCharCode(codePoint - 0xFEE0)
      : originalText.slice(sourceIndex, sourceIndex + sourceLength);

    text += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index++) {
      if (codePoint >= 0xFF01 && codePoint <= 0xFF5E) {
        sourceStartByIndex.push(sourceIndex);
        sourceEndByIndex.push(sourceIndex + sourceLength);
      } else {
        sourceStartByIndex.push(sourceIndex + index);
        sourceEndByIndex.push(sourceIndex + index + 1);
      }
    }

    sourceIndex += sourceLength;
  }

  return { text, sourceStartByIndex, sourceEndByIndex };
}

function mapNormalizedSpanToOriginal(start, end, mapping) {
  if (start < 0 || end <= start || end > mapping.sourceStartByIndex.length) {
    return null;
  }

  return {
    startIndex: mapping.sourceStartByIndex[start],
    endIndex: mapping.sourceEndByIndex[end - 1]
  };
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
  const mapping = normalizeForMatching(originalText);
  const matches = [];

  HARMFUL_RULES.forEach((rule, ruleOrder) => {
    const pattern = createRulePattern(rule.phrase);
    let match;

    while ((match = pattern.exec(mapping.text)) !== null) {
      const normalizedStart = match.index + match[1].length;
      const normalizedEnd = normalizedStart + match[0].length - match[1].length;
      const sourceSpan = mapNormalizedSpanToOriginal(
        normalizedStart,
        normalizedEnd,
        mapping
      );
      const phrase = originalText.slice(sourceSpan.startIndex, sourceSpan.endIndex);

      matches.push({
        phrase,
        category: rule.category,
        severity: rule.severity,
        startIndex: sourceSpan.startIndex,
        endIndex: sourceSpan.endIndex,
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
