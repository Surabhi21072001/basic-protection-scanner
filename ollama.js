/**
 * Local Ollama adapter for text explicitly submitted in the demo analyzer.
 * Page scanning continues to use the synchronous rule-based detector.
 */

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_PRELOAD_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.2:1b";
const OLLAMA_KEEP_ALIVE = "30m";

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
          },
          explanation: {
            type: "string",
            maxLength: 160,
            description: "One brief sentence explaining why the phrase is negative."
          }
        },
        required: [
          "phrase",
          "category",
          "severity",
          "replacement",
          "explanation"
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

function validateMatches(text, rawMatches) {
  const matches = [];
  const nextSearchByPhrase = new Map();

  for (const rawMatch of Array.isArray(rawMatches) ? rawMatches : []) {
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
    const replacementWordCount = replacement.split(/\s+/).length;

    if (!phrase) continue;

    // Replace paragraph-style model output with a short category fallback.
    // The replacement must fit directly into the original phrase's position.
    if (!replacement || replacementWordCount > 6 || /[.!?]/.test(replacement)) {
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
            "Analyze the user's message for negative or harmful language, including " +
            "insults, hostility, threats, profanity, self-harm encouragement, and " +
            "negative self-talk. Identify only the negative word or shortest negative " +
            "phrase—not the whole sentence. Exclude subjects, pronouns, articles, and " +
            "linking verbs when they are not themselves negative. Copy that minimal phrase " +
            "exactly from the message. The replacement must fit in the same location, use " +
            "at most six words, contain no sentence-ending punctuation, and never be a " +
            "paragraph or complete rewritten message. Keep the explanation under 15 words. " +
            "Example: for 'I am dumb', return phrase 'dumb' and replacement 'still learning'. " +
            "Example: for 'You are an idiot', return phrase 'idiot' and replacement " +
            "'person who made a mistake'. " +
            "Do not flag neutral disagreement, quoted language used for discussion, or " +
            "supportive statements. Return only the requested JSON."
        },
        { role: "user", content: originalText }
      ]
    })
  });

  if (!response.ok) {
    throw new Error("Ollama returned HTTP " + response.status + ".");
  }

  const payload = await response.json();
  const parsed = JSON.parse(payload.message.content);
  const matches = validateMatches(originalText, parsed.matches);

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
