const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const detectorSource = fs.readFileSync(path.join(root, "detector.js"), "utf8");
const ollamaSource = fs.readFileSync(path.join(root, "ollama.js"), "utf8");

function createAnalyzer(modelResult, responseOptions = {}) {
  let request;
  const analyzerWindow = {};
  const context = vm.createContext({
    window: analyzerWindow,
    fetch: async (url, options) => {
      request = { url, options };
      if (responseOptions.fetchError) throw responseOptions.fetchError;
      return {
        ok: responseOptions.ok !== false,
        status: responseOptions.status || 200,
        json: async () => {
          if (responseOptions.jsonError) throw new Error("bad response body");
          if (responseOptions.body) return responseOptions.body;
          return {
            message: {
              content: responseOptions.content === undefined
                ? JSON.stringify(modelResult)
                : responseOptions.content
            }
          };
        }
      };
    }
  });

  vm.runInContext(detectorSource, context);
  vm.runInContext(ollamaSource, context);
  const scanner = analyzerWindow.ProtectionScanner;
  return {
    analyze: scanner.analyzeWithOllama,
    analyzeText: scanner.analyzeText,
    analyzeWithRules: scanner.analyzeWithRules,
    preload: scanner.preloadOllamaModel,
    getRequest: () => request
  };
}

function modelMatch(phrase, category = "insult", extra = {}) {
  return {
    phrase,
    category,
    severity: "medium",
    replacement: "a kinder alternative",
    explanation: "This phrase may be hurtful.",
    ...extra
  };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSourceOffsets(text, matches) {
  for (const match of matches) {
    assert.equal(text.slice(match.startIndex, match.endIndex), match.phrase);
  }
}

test("valid structured response maps phrases and creates an AI rewrite", async () => {
  const { analyze, getRequest } = createAnalyzer({
    negative: true,
    matches: [modelMatch("dumb", "negative self-talk", { replacement: "still learning" })]
  });
  const text = "I am dumb";
  const result = await analyze(text);

  assert.equal(result.source, "local-ai");
  assert.equal(result.detected, true);
  assert.equal(result.matches[0].category, "negative self-talk");
  assert.equal(result.matches[0].startIndex, 5);
  assert.equal(result.matches[0].endIndex, 9);
  assert.equal(result.suggestedRewrite, "I am still learning");
  assertSourceOffsets(text, result.matches);

  const requestBody = JSON.parse(getRequest().options.body);
  assert.equal(getRequest().url, "http://localhost:11434/api/chat");
  assert.equal(requestBody.model, "llama3.2:1b");
  assert.equal(requestBody.keep_alive, "30m");
  assert.equal(requestBody.messages[1].content, text);
  assert.match(requestBody.messages[0].content, /self-harm encouragement/);
  assert.match(requestBody.messages[0].content, /negative self-talk only when/);
});

test("uses validated matches when the model's summary boolean contradicts them", async () => {
  const { analyze } = createAnalyzer({
    negative: false,
    matches: [modelMatch("stupid", "insult")]
  });
  const result = await analyze("You are stupid.");
  assert.equal(result.detected, true);
  assert.equal(result.source, "local-ai");
  assert.equal(result.matches[0].category, "insult");
});

test("maps multiple matches and rewrites from right to left", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [
      modelMatch("stupid", "insult"),
      modelMatch("moron", "insult")
    ]
  });
  const text = "That was stupid and moron behavior.";
  const result = await analyze(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, startIndex, endIndex }) => ({
      phrase,
      startIndex,
      endIndex
    }))),
    [
      { phrase: "stupid", startIndex: 9, endIndex: 15 },
      { phrase: "moron", startIndex: 20, endIndex: 25 }
    ]
  );
  assertSourceOffsets(text, result.matches);
});

test("normalizes negative self-talk versus direct insults by speaker context", async (t) => {
  const cases = [
    ["I am stupid.", "stupid", "negative self-talk"],
    ["My work is terrible.", "terrible", "negative self-talk"],
    ["My work is terrible and I am useless.", "useless", "negative self-talk"],
    ["You are stupid.", "stupid", "insult"],
    ["Your post is stupid.", "stupid", "insult"]
  ];

  for (const [text, phrase, category] of cases) {
    await t.test(text, async () => {
      const { analyze } = createAnalyzer({
        negative: true,
        matches: [modelMatch(phrase, "negative self-talk")]
      });
      const result = await analyze(text);
      assert.equal(result.matches[0].category, category);
      assertSourceOffsets(text, result.matches);
    });
  }
});

test("specific local high-risk rules override generic AI categories", async (t) => {
  const cases = [
    ["You should kill yourself.", "kill yourself", "self-harm encouragement"],
    ["I will hurt you.", "I will hurt you", "threat"]
  ];
  for (const [text, phrase, category] of cases) {
    await t.test(phrase, async () => {
      const { analyze } = createAnalyzer({
        negative: true,
        matches: [modelMatch(phrase, "hostile language")]
      });
      const result = await analyze(text);
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].phrase, phrase);
      assert.equal(result.matches[0].category, category);
      assert.equal(result.matches[0].severity, "high");
      assertSourceOffsets(text, result.matches);
    });
  }
});

test("context-aware clean results are not overridden by ordinary local rules", async () => {
  const { analyze } = createAnalyzer({ negative: false, matches: [] });
  const result = await analyze("I don't hate you.");
  assert.equal(result.source, "local-ai");
  assert.equal(result.detected, false);
  assert.deepEqual(normalize(result.matches), []);
});

test("post-validates an overbroad AI match to the local phrase category", async (t) => {
  const cases = [
    ["I am stupid.", "negative self-talk"],
    ["You are stupid.", "insult"],
    ["Your post is stupid.", "insult"]
  ];
  for (const [text, expectedCategory] of cases) {
    await t.test(text, async () => {
      const { analyze } = createAnalyzer({
        negative: true,
        matches: [modelMatch(text, "self-harm encouragement")]
      });
      const result = await analyze(text);
      assert.equal(result.matches[0].phrase, "stupid");
      assert.equal(result.matches[0].category, expectedCategory);
      assertSourceOffsets(text, result.matches);
    });
  }
});

test("suppresses an AI match when source context explicitly negates the phrase", async () => {
  const text = "I don't hate you.";
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [modelMatch(text, "self-harm encouragement")]
  });
  const result = await analyze(text);
  assert.equal(result.source, "local-ai");
  assert.equal(result.detected, false);
});

test("neutral reported mention may remain unflagged by contextual AI", async () => {
  const { analyze } = createAnalyzer({ negative: false, matches: [] });
  const result = await analyze('The phrase "kill yourself" should be blocked.');
  assert.equal(result.source, "local-ai");
  assert.equal(result.detected, false);
});

test("suppresses a high-risk phrase when it is quoted in a neutral discussion", async () => {
  const text = 'The phrase "kill yourself" should be blocked.';
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [modelMatch(text, "self-harm encouragement")]
  });
  const result = await analyze(text);
  assert.equal(result.source, "local-ai");
  assert.equal(result.detected, false);
});

test("rejects model phrases absent from the original text", async () => {
  const { analyzeText } = createAnalyzer({
    negative: true,
    matches: [modelMatch("stupid")]
  });
  const result = await analyzeText("I made a mistake");
  assert.equal(result.source, "rules");
  assert.equal(result.detected, false);
  assert.equal(result.fallbackReason, "validation-failure");
});

test("rejects phrases embedded inside a longer source word", async () => {
  const { analyzeText } = createAnalyzer({
    negative: true,
    matches: [modelMatch("stupid")]
  });
  const result = await analyzeText("That was stupidly phrased.");
  assert.equal(result.source, "rules");
  assert.equal(result.fallbackReason, "validation-failure");
  assert.equal(result.detected, false);
});

test("rejects invented category names and falls back to rules", async () => {
  const { analyzeText } = createAnalyzer({
    negative: true,
    matches: [modelMatch("stupid", "Negative Self-Talk")]
  });
  const result = await analyzeText("You are stupid.");
  assert.equal(result.source, "rules");
  assert.equal(result.fallbackReason, "validation-failure");
  assert.ok(result.matches.every((match) =>
    ["insult", "profanity", "hostile language", "threat",
      "self-harm encouragement", "negative self-talk", "other negative language"]
      .includes(match.category)
  ));
});

test("rejects invalid severity and malformed schema", async (t) => {
  const cases = [
    { negative: true, matches: [modelMatch("stupid", "insult", { severity: "extreme" })] },
    { negative: true, matches: "not an array" },
    { negative: "yes", matches: [] }
  ];
  for (const payload of cases) {
    await t.test(JSON.stringify(payload), async () => {
      const { analyzeText } = createAnalyzer(payload);
      const result = await analyzeText("You are stupid.");
      assert.equal(result.source, "rules");
      assert.equal(result.fallbackReason, "validation-failure");
    });
  }
});

test("uses category-safe replacement if model omits a replacement", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [modelMatch("stupid", "insult", { replacement: undefined })]
  });
  const result = await analyze("You are stupid.");
  assert.equal(result.source, "local-ai");
  assert.equal(result.matches[0].replacement, "a kinder description");
  assert.ok(result.suggestedRewrite);
});

test("malformed JSON falls back to the deterministic detector", async () => {
  const { analyzeText } = createAnalyzer(null, {
    content: '{"negative":true,"matches":['
  });
  const text = "You are stupid.";
  const result = await analyzeText(text);
  assert.equal(result.source, "rules");
  assert.equal(result.fallbackReason, "parse-failure");
  assert.equal(result.matches[0].phrase, "stupid");
  assertSourceOffsets(text, result.matches);
});

test("Ollama unreachable automatically falls back without exposing error details", async () => {
  const { analyzeText } = createAnalyzer(null, {
    fetchError: new TypeError("private request detail")
  });
  const result = await analyzeText("You are stupid.");
  assert.equal(result.source, "rules");
  assert.equal(result.fallbackReason, "unreachable");
  assert.equal(result.matches[0].phrase, "stupid");
});

test("a missing Ollama model is distinguished and falls back", async () => {
  const { analyzeText } = createAnalyzer(null, {
    ok: false,
    status: 404,
    body: { error: "model 'llama3.2:1b' not found" }
  });
  const result = await analyzeText("You are stupid.");
  assert.equal(result.source, "rules");
  assert.equal(result.fallbackReason, "model-missing");
});

test("response envelope and JSON parse failures have distinct fallback reasons", async (t) => {
  const cases = [
    [{ jsonError: true }, "invalid-response"],
    [{ body: { message: {} } }, "invalid-response"]
  ];
  for (const [options, reason] of cases) {
    await t.test(reason, async () => {
      const { analyzeText } = createAnalyzer(null, options);
      const result = await analyzeText("You are stupid.");
      assert.equal(result.source, "rules");
      assert.equal(result.fallbackReason, reason);
    });
  }
});

test("deduplicates duplicate spans and deterministically selects longest overlaps", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [
      modelMatch("shit", "profanity"),
      modelMatch("piece of shit", "insult"),
      modelMatch("shit", "profanity")
    ]
  });
  const result = await analyze("piece of shit");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].phrase, "piece of shit");
  assert.equal(result.matches[0].category, "insult");
});

test("maps repeated phrases to distinct source occurrences", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [
      modelMatch("stupid", "insult"),
      modelMatch("stupid", "insult")
    ]
  });
  const text = "stupid then stupid";
  const result = await analyze(text);
  assert.deepEqual(
    normalize(result.matches.map(({ startIndex, endIndex }) => [startIndex, endIndex])),
    [[0, 6], [12, 18]]
  );
  assertSourceOffsets(text, result.matches);
});

test("rule-based fallback uses only the existing detector contract", async () => {
  const { analyzeText, analyzeWithRules } = createAnalyzer(null, {
    fetchError: new TypeError("not available")
  });
  const text = "You are stupid and ugly.";
  const result = await analyzeText(text);
  const direct = analyzeWithRules(text);
  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, startIndex, endIndex }) => ({
      phrase,
      category,
      startIndex,
      endIndex
    }))),
    normalize(direct.matches.map(({ phrase, category, startIndex, endIndex }) => ({
      phrase,
      category,
      startIndex,
      endIndex
    })))
  );
  assert.equal(result.matches.some((match) => match.phrase === "ugly"), false);
});

test("rule fallback applies self-talk context without changing detection spans", () => {
  const { analyzeWithRules } = createAnalyzer(null);
  const selfTalk = analyzeWithRules("I am stupid");
  const directedInsult = analyzeWithRules("Your post is stupid");

  assert.equal(selfTalk.matches[0].category, "negative self-talk");
  assert.equal(selfTalk.matches[0].phrase, "stupid");
  assert.equal(directedInsult.matches[0].category, "insult");
  assert.equal(directedInsult.matches[0].phrase, "stupid");
});

test("preloads the configured model without sending analyzer text", async () => {
  const { preload, getRequest } = createAnalyzer({ negative: false, matches: [] });
  await preload();
  const body = JSON.parse(getRequest().options.body);
  assert.equal(getRequest().url, "http://localhost:11434/api/generate");
  assert.equal(body.model, "llama3.2:1b");
  assert.equal(body.prompt, "");
  assert.equal(body.keep_alive, "30m");
});
