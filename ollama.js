/**
 * Local Ollama adapter for text explicitly submitted in the demo analyzer.
 * Page scanning continues to use the synchronous rule-based detector.
 */

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_PRELOAD_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.2:1b";
const OLLAMA_KEEP_ALIVE = "30m";

const GENERAL_POSITIVE_REPLACEMENTS = {
  dumb: {
    replacement: "still learning",
    category: "negative self-talk"
  },
  stupid: {
    replacement: "still learning",
    category: "negative self-talk"
  },
  idiot: {
    replacement: "person who made a mistake",
    category: "insult"
  },
  moron: {
    replacement: "person who made a mistake",
    category: "insult"
  },
  ugly: {
    replacement: "unique",
    category: "negative self-talk"
  },
  loser: {
    replacement: "capable person",
    category: "insult"
  }
};

const OLLAMA_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    negative: { type: "boolean" },
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          phrase: {
            type: "string",
            maxLength: 80,
            description: "The smallest exact negative substring, excluding neutral sentence words."
          },
          category: {
            type: "string",
            enum: [
              "insult",
              "profanity",
              "hostile language",
              "threat",
              "self-harm encouragement",
              "negative self-talk",
              "other negative language"
            ]
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          replacement: {
            type: "string",
            maxLength: 60,
            description: "A replacement fragment of no more than six words and no sentence punctuation."
          }
        },
        required: [
          "phrase",
          "category",
          "severity",
          "replacement"
        ]
      }
    }
  },
  required: ["negative", "matches"]
};

function findPhrase(text, phrase, fromIndex) {
  let index = text.indexOf(phrase, fromIndex);
  if (index !== -1) return index;

  index = text.toLocaleLowerCase().indexOf(
    phrase.toLocaleLowerCase(),
    fromIndex
  );
  return index;
}

function getFallbackReplacement(category) {
  const replacements = {
    insult: "mistaken",
    profanity: "inappropriate",
    "hostile language": "more respectful",
    threat: "non-threatening",
    "self-harm encouragement": "supportive",
    "negative self-talk": "still learning",
    "other negative language": "more constructive"
  };
  return replacements[category] || "more constructive";
}

function getGeneralPositiveReplacement(phrase) {
  const entry = GENERAL_POSITIVE_REPLACEMENTS[phrase.toLocaleLowerCase()];
  return entry ? entry.replacement : null;
}

function minimizeWholeMessagePhrase(text, phrase, category) {
  if (
    phrase.toLocaleLowerCase() !== text.trim().toLocaleLowerCase() ||
    !["insult", "negative self-talk"].includes(category)
  ) {
    return phrase;
  }

  const neutralOpening = /^(?:(?:i|you|he|she|we|they)\s+(?:am|are|is|feel|seem)|(?:i['’]m|you['’]re|he['’]s|she['’]s|we['’]re|they['’]re))\s+/i;
  const minimized = phrase.replace(neutralOpening, "").trim();
  return minimized || phrase;
}

function expandCompoundMatches(text, rawMatches) {
  const expanded = [];

  for (const rawMatch of Array.isArray(rawMatches) ? rawMatches : []) {
    if (!rawMatch || typeof rawMatch.phrase !== "string") {
      expanded.push(rawMatch);
      continue;
    }

    const phrase = minimizeWholeMessagePhrase(
      text,
      rawMatch.phrase.trim(),
      rawMatch.category
    );
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

function validateMatches(text, rawMatches) {
  const matches = [];
  const nextSearchByPhrase = new Map();

  for (const rawMatch of expandCompoundMatches(text, rawMatches)) {
    if (
      !rawMatch ||
      typeof rawMatch.phrase !== "string" ||
      !rawMatch.phrase ||
      typeof rawMatch.replacement !== "string" ||
      !rawMatch.replacement
    ) {
      continue;
    }

    const phrase = minimizeWholeMessagePhrase(
      text,
      rawMatch.phrase.trim(),
      rawMatch.category
    );
    let replacement = rawMatch.replacement.trim();
    const generalReplacement = getGeneralPositiveReplacement(phrase);
    const replacementWordCount = replacement.split(/\s+/).length;

    if (!phrase) continue;

    if (generalReplacement) {
      replacement = generalReplacement;
    } else if (
      !replacement ||
      replacementWordCount > 6 ||
      /[.!?]/.test(replacement) ||
      /^(?:i|you|he|she|we|they|have|has|had)\b/i.test(replacement)
    ) {
      // Reject paragraphs, complete sentences, and invented personal details.
      replacement = getFallbackReplacement(rawMatch.category);
    }

    const phraseKey = phrase.toLocaleLowerCase();
    const searchFrom = nextSearchByPhrase.get(phraseKey) || 0;
    const startIndex = findPhrase(text, phrase, searchFrom);
    if (startIndex === -1) continue;

    const endIndex = startIndex + phrase.length;
    nextSearchByPhrase.set(phraseKey, endIndex);
    matches.push({
      phrase: text.slice(startIndex, endIndex),
      category: rawMatch.category || "other negative language",
      severity: rawMatch.severity || "medium",
      replacement,
      explanation: rawMatch.explanation || "The local model identified negative language.",
      startIndex,
      endIndex
    });
  }

  matches.sort((left, right) =>
    left.startIndex - right.startIndex ||
    right.endIndex - left.endIndex
  );

  return matches.reduce((accepted, match) => {
    const previous = accepted[accepted.length - 1];
    if (!previous || match.startIndex >= previous.endIndex) {
      accepted.push(match);
    }
    return accepted;
  }, []);
}

function addReliableFallbackMatches(text, modelMatches) {
  const matches = modelMatches.slice();

  Object.entries(GENERAL_POSITIVE_REPLACEMENTS).forEach(([phrase, metadata]) => {
    const pattern = new RegExp(
      "(^|[^\\p{L}\\p{N}\\p{M}_])" +
        phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "(?=$|[^\\p{L}\\p{N}\\p{M}_])",
      "giu"
    );
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const startIndex = match.index + match[1].length;
      const endIndex = startIndex + phrase.length;
      const overlapsExisting = matches.some((existing) =>
        startIndex < existing.endIndex && endIndex > existing.startIndex
      );

      if (!overlapsExisting) {
        matches.push({
          phrase: text.slice(startIndex, endIndex),
          category: metadata.category,
          severity: "medium",
          replacement: metadata.replacement,
          explanation: "This is a negative description that can be expressed more constructively.",
          startIndex,
          endIndex
        });
      }

      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  });

  matches.sort((left, right) => left.startIndex - right.startIndex);
  return matches;
}

function createSuggestedRewrite(text, matches) {
  let rewritten = text;

  matches
    .slice()
    .sort((left, right) => right.startIndex - left.startIndex)
    .forEach((match) => {
      rewritten =
        rewritten.slice(0, match.startIndex) +
        match.replacement +
        rewritten.slice(match.endIndex);
    });

  return rewritten;
}

async function analyzeWithOllama(text) {
  const originalText = typeof text === "string" ? text : "";
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      format: OLLAMA_RESPONSE_SCHEMA,
      options: {
        temperature: 0,
        num_predict: 256
      },
      messages: [
        {
          role: "system",
          content:
            "Find every negative or harmful word or shortest phrase in the message. " +
            "Scan left to right and return one match per negative term; never stop after " +
            "the first. Copy each phrase exactly, excluding neutral words such as pronouns " +
            "and linking verbs. Suggest a replacement fragment of at most six words with no " +
            "sentence punctuation. Use a general positive description and never invent facts, " +
            "conditions, body details, personal traits, or specific topics that are not in the " +
            "message. Return only a fragment, without adding a subject such as 'I am'. For " +
            "'I am stupid and ugly', return separate matches with 'stupid' replaced by " +
            "'still learning' and 'ugly' replaced by 'unique'. Do not flag neutral or " +
            "supportive language. Return only JSON."
        },
        { role: "user", content: originalText }
      ]
    })
  });

  if (!response.ok) {
    throw new Error("Ollama returned HTTP " + response.status + ".");
  }

  const payload = await response.json();
  let parsed;
  try {
    parsed = JSON.parse(payload.message.content);
  } catch {
    // The small model can occasionally truncate structured output. Continue
    // with reliable local fallbacks instead of showing an unusable paragraph.
    parsed = { matches: [] };
  }
  const matches = addReliableFallbackMatches(
    originalText,
    validateMatches(originalText, parsed.matches)
  );

  return {
    detected: matches.length > 0,
    originalText,
    matches,
    suggestedRewrite: matches.length
      ? createSuggestedRewrite(originalText, matches)
      : null,
    source: "ollama",
    model: OLLAMA_MODEL
  };
}

async function preloadOllamaModel() {
  const response = await fetch(OLLAMA_PRELOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: "",
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE
    })
  });

  if (!response.ok) {
    throw new Error("Ollama preload returned HTTP " + response.status + ".");
  }
}

window.ProtectionScanner = window.ProtectionScanner || {};
window.ProtectionScanner.analyzeWithOllama = analyzeWithOllama;
window.ProtectionScanner.preloadOllamaModel = preloadOllamaModel;
window.ProtectionScanner.OLLAMA_MODEL = OLLAMA_MODEL;
