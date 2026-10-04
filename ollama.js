/**
 * Local Ollama adapter for text explicitly submitted in the demo analyzer.
 * Automatic webpage scanning continues to use detector.js only.
 */

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_PRELOAD_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.2:1b";
const OLLAMA_KEEP_ALIVE = "30m";
const MAX_MODEL_MATCHES = 50;
const ALLOWED_CATEGORIES = new Set([
  "insult",
  "profanity",
  "hostile language",
  "threat",
  "self-harm encouragement",
  "negative self-talk",
  "other negative language"
]);
const ALLOWED_SEVERITIES = new Set(["low", "medium", "high"]);
const CATEGORY_PRECEDENCE = new Map([
  "self-harm encouragement",
  "threat",
  "insult",
  "profanity",
  "hostile language",
  "negative self-talk",
  "other negative language"
].map((category, index) => [category, index]));

const OLLAMA_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    negative: { type: "boolean" },
    matches: {
      type: "array",
      maxItems: MAX_MODEL_MATCHES,
      items: {
        type: "object",
        properties: {
          phrase: { type: "string", minLength: 1, maxLength: 80 },
          category: { type: "string", enum: Array.from(ALLOWED_CATEGORIES) },
          severity: { type: "string", enum: Array.from(ALLOWED_SEVERITIES) },
          replacement: { type: "string", maxLength: 60 },
          explanation: { type: "string", maxLength: 240 }
        },
        required: ["phrase", "category", "severity"]
      }
    }
  },
  required: ["negative", "matches"]
};

const FALLBACK_REPLACEMENTS = {
  insult: "a kinder description",
  profanity: "appropriate language",
  "hostile language": "a more respectful response",
  threat: "a non-threatening statement",
  "self-harm encouragement": "a supportive message",
  "negative self-talk": "still learning",
  "other negative language": "a more constructive phrase"
};
const SELF_TALK_REPLACEMENTS = {
  dumb: "still learning",
  stupid: "still learning",
  ugly: "unique"
};

class OllamaAnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OllamaAnalysisError";
    this.code = code;
  }
}

function getSelfTalkReplacement(phrase) {
  return SELF_TALK_REPLACEMENTS[phrase.toLocaleLowerCase()] || null;
}

function createAnalysisError(code) {
  const messages = {
    unreachable: "Ollama is not reachable.",
    "model-missing": "The configured Ollama model is not installed.",
    "invalid-response": "Ollama returned an invalid response.",
    "parse-failure": "Ollama's response could not be parsed.",
    "validation-failure": "Ollama's response did not pass validation.",
    "request-failure": "Ollama could not complete the request."
  };
  return new OllamaAnalysisError(code, messages[code] || messages["request-failure"]);
}

function getFallbackReplacement(category) {
  return FALLBACK_REPLACEMENTS[category] || FALLBACK_REPLACEMENTS["other negative language"];
}

function safeExplanation(value, category) {
  if (typeof value !== "string" || !value.trim()) {
    return "The local model identified a phrase categorized as " + category + ".";
  }
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 240);
}

function findPhrase(text, phrase, fromIndex) {
  const exactIndex = text.indexOf(phrase, fromIndex);
  if (exactIndex !== -1) {
    return { startIndex: exactIndex, endIndex: exactIndex + phrase.length };
  }

  const foldedPhrase = phrase.toLocaleLowerCase();
  for (let startIndex = fromIndex; startIndex <= text.length - phrase.length; startIndex++) {
    const sourcePhrase = text.slice(startIndex, startIndex + phrase.length);
    if (sourcePhrase.toLocaleLowerCase() === foldedPhrase) {
      return { startIndex, endIndex: startIndex + phrase.length };
    }
  }
  return null;
}

function isUnicodeWordCharacter(character) {
  return Boolean(character && /[\p{L}\p{N}\p{M}_]/u.test(character));
}

function getPreviousCodePoint(text, index) {
  if (index <= 0) return "";
  const previousCodeUnit = text.charCodeAt(index - 1);
  const startIndex = previousCodeUnit >= 0xDC00 && previousCodeUnit <= 0xDFFF
    ? index - 2
    : index - 1;
  return text.slice(startIndex, index);
}

function hasWordBoundaries(text, startIndex, endIndex) {
  const firstCodePoint = String.fromCodePoint(text.codePointAt(startIndex));
  const endCodePoint = getPreviousCodePoint(text, endIndex);
  const previousCodePoint = getPreviousCodePoint(text, startIndex);
  const nextCodePoint = text.codePointAt(endIndex) === undefined
    ? ""
    : String.fromCodePoint(text.codePointAt(endIndex));

  return (!isUnicodeWordCharacter(firstCodePoint) ||
      !isUnicodeWordCharacter(previousCodePoint)) &&
    (!isUnicodeWordCharacter(endCodePoint) ||
      !isUnicodeWordCharacter(nextCodePoint));
}

function minimizeWholeMessagePhrase(text, phrase) {
  if (phrase.toLocaleLowerCase() !== text.trim().toLocaleLowerCase()) {
    return phrase;
  }

  const neutralOpening = /^(?:(?:i|you|he|she|we|they)\s+(?:am|are|is|feel|seem)|(?:i['’]m|you['’]re|he['’]s|she['’]s|we['’]re|they['’]re))\s+/i;
  return phrase.replace(neutralOpening, "").trim() || phrase;
}

function expandCompoundMatches(text, rawMatches) {
  const expanded = [];

  for (const rawMatch of rawMatches) {
    if (!rawMatch || typeof rawMatch.phrase !== "string") {
      expanded.push(rawMatch);
      continue;
    }

    const phrase = minimizeWholeMessagePhrase(text, rawMatch.phrase.trim());
    const phraseParts = phrase.split(/\s+and\s+/i);
    if (phraseParts.length < 2) {
      expanded.push({ ...rawMatch, phrase });
      continue;
    }

    const replacementParts = typeof rawMatch.replacement === "string"
      ? rawMatch.replacement.split(/\s+and\s+/i)
      : [];
    phraseParts.forEach((phrasePart, index) => {
      expanded.push({
        ...rawMatch,
        phrase: phrasePart.trim(),
        replacement: replacementParts.length === phraseParts.length
          ? replacementParts[index].trim()
          : ""
      });
    });
  }
  return expanded;
}

function getClauseContext(text, startIndex) {
  const prefix = text.slice(0, startIndex);
  const clauseStart = Math.max(
    prefix.lastIndexOf("."),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf("\n")
  );
  return prefix.slice(clauseStart + 1);
}

function getLastSubject(context) {
  const subjectPattern = /\b(i|my|you|your|he|she|they|we)\b/giu;
  let lastSubject = null;
  let match;
  while ((match = subjectPattern.exec(context)) !== null) {
    lastSubject = match[1].toLocaleLowerCase();
  }
  return lastSubject;
}

function isNegatedContext(text, startIndex) {
  return /\b(?:not|never|don't|do not|doesn't|does not|didn't|did not|cannot|can't|won't|wouldn't|isn't|aren't|wasn't|weren't)\b[^.!?;,\n]{0,48}$/iu
    .test(getClauseContext(text, startIndex));
}

function isQuotedContext(text, startIndex, endIndex) {
  const quotePairs = [
    ['"', '"'],
    ["“", "”"],
    ["‘", "’"],
    ["'", "'"]
  ];

  return quotePairs.some(([openingQuote, closingQuote]) => {
    const openingIndex = text.lastIndexOf(openingQuote, startIndex - 1);
    const closingIndex = text.indexOf(closingQuote, endIndex);
    if (openingIndex === -1 || closingIndex === -1) return false;

    if (openingQuote === "'") {
      const beforeOpening = getPreviousCodePoint(text, openingIndex);
      const afterClosing = String.fromCodePoint(text.codePointAt(closingIndex + 1) || 0);
      if (isUnicodeWordCharacter(beforeOpening) || isUnicodeWordCharacter(afterClosing)) {
        return false;
      }
    }
    return true;
  });
}

function isReportedContext(text, startIndex) {
  return /\b(?:the phrase|the words|someone said|said|says|wrote|quoted|reported|mentioned)\b[^.!?;,\n]{0,64}$/iu
    .test(getClauseContext(text, startIndex));
}

function shouldSuppressContextualMatch(text, match) {
  return isNegatedContext(text, match.startIndex) ||
    isQuotedContext(text, match.startIndex, match.endIndex) ||
    isReportedContext(text, match.startIndex);
}

function isSelfDirected(text, startIndex) {
  const context = getClauseContext(text, startIndex);
  const lastSubject = getLastSubject(context);
  if (lastSubject !== "i" && lastSubject !== "my") return false;
  return /\b(?:am|feel|seem|was|were|is|are|look|sound|seems?|feels?)\b/iu.test(context);
}

function normalizeCategoryForContext(text, match) {
  const selfDirected = isSelfDirected(text, match.startIndex);

  if (selfDirected && match.category !== "threat") {
    return "negative self-talk";
  }

  if (match.category === "negative self-talk" && !selfDirected) {
    const lastSubject = getLastSubject(getClauseContext(text, match.startIndex));
    return lastSubject === "you" || lastSubject === "your"
      ? "insult"
      : "other negative language";
  }
  return match.category;
}

function validateModelPayload(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.negative !== "boolean" ||
    !Array.isArray(parsed.matches) ||
    parsed.matches.length > MAX_MODEL_MATCHES
  ) {
    throw createAnalysisError("validation-failure");
  }

  for (const match of parsed.matches) {
    if (
      !match ||
      typeof match !== "object" ||
      typeof match.phrase !== "string" ||
      !match.phrase.trim() ||
      match.phrase.length > 80 ||
      !ALLOWED_CATEGORIES.has(match.category) ||
      !ALLOWED_SEVERITIES.has(match.severity) ||
      (match.replacement !== undefined &&
        (typeof match.replacement !== "string" || match.replacement.length > 60)) ||
      (match.explanation !== undefined &&
        (typeof match.explanation !== "string" || match.explanation.length > 240))
    ) {
      throw createAnalysisError("validation-failure");
    }
  }

  // Treat the validated match list as authoritative if the model's summary
  // boolean contradicts it; the final result derives detected from matches.
}

function validateMatches(text, rawMatches, ruleMatches) {
  const matches = [];
  const nextSearchByPhrase = new Map();

  for (const rawMatch of expandCompoundMatches(text, rawMatches)) {
    const phrase = rawMatch.phrase.trim();
    const phraseKey = phrase.toLocaleLowerCase();
    const searchFrom = nextSearchByPhrase.get(phraseKey) || 0;
    let sourceSpan = findPhrase(text, phrase, searchFrom) ||
      findPhrase(text, phrase, 0);
    if (!sourceSpan) {
      throw createAnalysisError("validation-failure");
    }
    if (!hasWordBoundaries(text, sourceSpan.startIndex, sourceSpan.endIndex)) {
      throw createAnalysisError("validation-failure");
    }
    nextSearchByPhrase.set(phraseKey, sourceSpan.endIndex);

    const containedRules = ruleMatches.filter((ruleMatch) =>
      ruleMatch.startIndex >= sourceSpan.startIndex &&
      ruleMatch.endIndex <= sourceSpan.endIndex
    );
    const sourceRule = containedRules.length === 1 ? containedRules[0] : null;
    if (containedRules.length === 1) {
      if (shouldSuppressContextualMatch(text, sourceRule)) continue;
      sourceSpan = sourceRule;
    } else if (shouldSuppressContextualMatch(text, sourceSpan)) {
      continue;
    }

    let category = normalizeCategoryForContext(text, {
      ...rawMatch,
      ...sourceSpan,
      category: sourceRule ? sourceRule.category : rawMatch.category
    });
    const specificRule = ruleMatches.find((ruleMatch) =>
      ["threat", "self-harm encouragement"].includes(ruleMatch.category) &&
      sourceSpan.startIndex < ruleMatch.endIndex &&
      sourceSpan.endIndex > ruleMatch.startIndex
    );
    if (specificRule) category = specificRule.category;

    const replacement = category === "negative self-talk"
      ? getSelfTalkReplacement(text.slice(sourceSpan.startIndex, sourceSpan.endIndex)) ||
        sanitizeReplacement(rawMatch.replacement, category)
      : sanitizeReplacement(rawMatch.replacement, category);
    matches.push({
      phrase: text.slice(sourceSpan.startIndex, sourceSpan.endIndex),
      category,
      severity: specificRule ? "high" : (sourceRule ? sourceRule.severity : rawMatch.severity),
      explanation: specificRule
        ? "This phrase matches a specific local high-risk rule categorized as " + category + "."
        : safeExplanation(rawMatch.explanation, category),
      replacement,
      startIndex: sourceSpan.startIndex,
      endIndex: sourceSpan.endIndex
    });
  }

  return selectNonOverlappingMatches(matches);
}

function sanitizeReplacement(value, category) {
  const replacement = typeof value === "string" ? value.trim() : "";
  const wordCount = replacement ? replacement.split(/\s+/).length : 0;
  if (
    !replacement ||
    wordCount > 6 ||
    /[.!?<>]/.test(replacement) ||
    /^(?:i|you|he|she|we|they|have|has|had)\b/i.test(replacement)
  ) {
    return getFallbackReplacement(category);
  }
  return replacement;
}

function selectNonOverlappingMatches(matches) {
  const ordered = matches.slice().sort((left, right) =>
    left.startIndex - right.startIndex ||
    right.endIndex - left.endIndex ||
    (CATEGORY_PRECEDENCE.get(left.category) ?? Infinity) -
      (CATEGORY_PRECEDENCE.get(right.category) ?? Infinity)
  );
  const selected = [];
  for (const match of ordered) {
    const previous = selected[selected.length - 1];
    if (previous && match.startIndex < previous.endIndex) continue;
    selected.push(match);
  }
  return selected;
}

function mergeSpecificRuleMatches(modelMatches, specificRules) {
  const replacedModelMatches = new Set();
  const authoritativeRules = [];
  specificRules.forEach((ruleMatch) => {
    const overlapping = modelMatches.filter((modelMatch) =>
      ruleMatch.startIndex < modelMatch.endIndex &&
      ruleMatch.endIndex > modelMatch.startIndex
    );
    if (!overlapping.length) return;

    overlapping.forEach((match) => replacedModelMatches.add(match));
    authoritativeRules.push({
      ...ruleMatch,
      replacement: getFallbackReplacement(ruleMatch.category),
      explanation: "This phrase matches a specific local high-risk rule categorized as " +
        ruleMatch.category + "."
    });
  });
  return selectNonOverlappingMatches([
    ...modelMatches.filter((match) => !replacedModelMatches.has(match)),
    ...authoritativeRules
  ]);
}

function analyzeWithRules(text, fallbackReason = null) {
  const originalText = typeof text === "string" ? text : "";
  const detector = window.ProtectionScanner &&
    window.ProtectionScanner.detectHarmfulLanguage;
  if (typeof detector !== "function") {
    throw createAnalysisError("request-failure");
  }

  const detection = detector(originalText);
  const matches = detection.matches.map((match) => {
    const category = normalizeCategoryForContext(originalText, match);
    return {
      ...match,
      category,
      explanation: "This phrase matches a local rule categorized as " + category + ".",
      replacement: getFallbackReplacement(category)
    };
  });
  const result = {
    ...detection,
    matches,
    source: "rules",
    suggestedRewrite: matches.length
      ? createSuggestedRewrite(originalText, matches)
      : null
  };
  if (fallbackReason) result.fallbackReason = fallbackReason;
  return result;
}

function createSuggestedRewrite(text, matches) {
  let rewritten = text;
  matches
    .slice()
    .sort((left, right) => right.startIndex - left.startIndex)
    .forEach((match) => {
      rewritten = rewritten.slice(0, match.startIndex) +
        match.replacement +
        rewritten.slice(match.endIndex);
    });
  return rewritten;
}

async function requestOllama(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw createAnalysisError("unreachable");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw createAnalysisError("invalid-response");
  }

  if (!response.ok) {
    const errorText = payload && typeof payload.error === "string"
      ? payload.error
      : "";
    if (response.status === 404 || /model.+not found/i.test(errorText)) {
      throw createAnalysisError("model-missing");
    }
    throw createAnalysisError("request-failure");
  }
  return payload;
}

async function analyzeWithOllama(text) {
  const originalText = typeof text === "string" ? text : "";
  let payload;
  try {
    payload = await requestOllama(OLLAMA_URL, {
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      format: OLLAMA_RESPONSE_SCHEMA,
      options: { temperature: 0, num_predict: 384 },
      messages: [
        {
          role: "system",
          content:
            "Analyze the user's message for negative or harmful language and return only JSON " +
            "matching the supplied schema. Use only the allowed categories and severities. " +
            "Choose the shortest exact source phrase for each issue, preserve the source " +
            "spelling, and return every distinct issue without overlapping phrases. A direct " +
            "threat must be category threat. Direct encouragement of self-harm must be " +
            "self-harm encouragement, never generic hostile language. Use negative self-talk " +
            "only when the speaker directs the negative statement at themself; language " +
            "directed at another person or their work is not self-talk. Do not flag neutral " +
            "negation, quotation, or reported speech as if it were a direct attack. Do not " +
            "invent categories, facts, or intent. Provide a brief phrase-level explanation " +
            "and a concise replacement fragment that preserves the user's intended meaning " +
            "without adding personal details. Return negative=false and an empty match list " +
            "when no phrase should be flagged."
        },
        { role: "user", content: originalText }
      ]
    });
  } catch (error) {
    if (error instanceof OllamaAnalysisError) throw error;
    throw createAnalysisError("unreachable");
  }

  if (!payload || !payload.message || typeof payload.message.content !== "string") {
    throw createAnalysisError("invalid-response");
  }

  let parsed;
  try {
    parsed = JSON.parse(payload.message.content);
  } catch {
    throw createAnalysisError("parse-failure");
  }
  validateModelPayload(parsed);

  const detector = window.ProtectionScanner &&
    window.ProtectionScanner.detectHarmfulLanguage;
  if (typeof detector !== "function") {
    throw createAnalysisError("request-failure");
  }
  const ruleMatches = detector(originalText).matches;
  const specificRules = ruleMatches.filter((match) =>
    match.category === "threat" || match.category === "self-harm encouragement"
  );
  const validatedMatches = validateMatches(originalText, parsed.matches, ruleMatches);
  const matches = mergeSpecificRuleMatches(validatedMatches, specificRules);
  return {
    detected: matches.length > 0,
    originalText,
    matches,
    suggestedRewrite: matches.length
      ? createSuggestedRewrite(originalText, matches)
      : null,
    source: "local-ai",
    model: OLLAMA_MODEL
  };
}

async function analyzeText(text, mode = "local-ai") {
  if (mode === "rules") return analyzeWithRules(text);
  try {
    return await analyzeWithOllama(text);
  } catch (error) {
    const fallbackReason = error instanceof OllamaAnalysisError
      ? error.code
      : "request-failure";
    return analyzeWithRules(text, fallbackReason);
  }
}

async function preloadOllamaModel() {
  await requestOllama(OLLAMA_PRELOAD_URL, {
    model: OLLAMA_MODEL,
    prompt: "",
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE
  });
}

window.ProtectionScanner = window.ProtectionScanner || {};
window.ProtectionScanner.analyzeWithOllama = analyzeWithOllama;
window.ProtectionScanner.analyzeWithRules = analyzeWithRules;
window.ProtectionScanner.analyzeText = analyzeText;
window.ProtectionScanner.preloadOllamaModel = preloadOllamaModel;
window.ProtectionScanner.OLLAMA_MODEL = OLLAMA_MODEL;
