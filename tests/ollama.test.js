const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ollamaSource = fs.readFileSync(
  path.join(__dirname, "..", "ollama.js"),
  "utf8"
);

function createAnalyzer(modelResult, responseOptions = {}) {
  let request;
  const analyzerWindow = {};
  const context = vm.createContext({
    window: analyzerWindow,
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: responseOptions.ok !== false,
        status: responseOptions.status || 200,
        json: async () => ({
          message: {
            content: responseOptions.content || JSON.stringify(modelResult)
          }
        })
      };
    }
  });

  vm.runInContext(ollamaSource, context);
  return {
    analyze: analyzerWindow.ProtectionScanner.analyzeWithOllama,
    preload: analyzerWindow.ProtectionScanner.preloadOllamaModel,
    getRequest: () => request
  };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test("maps an AI phrase to source offsets and creates a contextual rewrite", async () => {
  const { analyze, getRequest } = createAnalyzer({
    negative: true,
    matches: [{
      phrase: "dumb",
      category: "negative self-talk",
      severity: "low",
      replacement: "still learning",
      explanation: "This is negative self-talk."
    }]
  });

  const result = await analyze("I am dumb");

  assert.equal(result.detected, true);
  assert.equal(result.matches[0].startIndex, 5);
  assert.equal(result.matches[0].endIndex, 9);
  assert.equal(result.matches[0].replacement, "still learning");
  assert.equal(result.suggestedRewrite, "I am still learning");

  const requestBody = JSON.parse(getRequest().options.body);
  assert.equal(getRequest().url, "http://localhost:11434/api/chat");
  assert.equal(requestBody.model, "llama3.2:1b");
  assert.equal(requestBody.keep_alive, "30m");
  assert.equal(requestBody.options.num_predict, 256);
  assert.equal(requestBody.messages[1].content, "I am dumb");
  assert.match(requestBody.messages[0].content, /one match per negative term/);
});

test("rejects model phrases that do not occur in the submitted text", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [{
      phrase: "stupid",
      category: "insult",
      severity: "low",
      replacement: "mistaken",
      explanation: "Negative language."
    }]
  });

  const result = await analyze("I made a mistake");

  assert.equal(result.detected, false);
  assert.equal(result.matches.length, 0);
  assert.equal(result.suggestedRewrite, null);
});

test("replaces paragraph-style output with a short category fallback", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [{
      phrase: "I am dumb",
      category: "insult",
      severity: "medium",
      replacement: "I am learning. Everyone has strengths. We can improve together.",
      explanation: "This is negative self-talk."
    }]
  });

  const result = await analyze("I am dumb");

  assert.equal(result.detected, true);
  assert.equal(result.matches[0].phrase, "dumb");
  assert.equal(result.matches[0].replacement, "still learning");
  assert.equal(result.suggestedRewrite, "I am still learning");
});

test("maps multiple AI matches and rewrites them without shifting offsets", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [
      {
        phrase: "dumb",
        category: "negative self-talk",
        severity: "low",
        replacement: "still learning",
        explanation: "This is negative self-talk."
      },
      {
        phrase: "stupid",
        category: "insult",
        severity: "low",
        replacement: "mistaken",
        explanation: "This is an insult."
      }
    ]
  });

  const text = "I feel dumb and stupid";
  const result = await analyze(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, startIndex, endIndex }) => ({
      phrase,
      startIndex,
      endIndex
    }))),
    [
      { phrase: "dumb", startIndex: 7, endIndex: 11 },
      { phrase: "stupid", startIndex: 16, endIndex: 22 }
    ]
  );
  assert.equal(result.suggestedRewrite, "I feel still learning and still learning");
  result.matches.forEach((match) => {
    assert.equal(text.slice(match.startIndex, match.endIndex), match.phrase);
  });
});

test("maps repeated AI phrases to distinct occurrences", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [
      {
        phrase: "dumb",
        category: "insult",
        severity: "low",
        replacement: "mistaken",
        explanation: "This is an insult."
      },
      {
        phrase: "dumb",
        category: "insult",
        severity: "low",
        replacement: "mistaken",
        explanation: "This is an insult."
      }
    ]
  });

  const result = await analyze("dumb then dumb");

  assert.deepEqual(
    normalize(result.matches.map(({ startIndex, endIndex }) => [startIndex, endIndex])),
    [[0, 4], [10, 14]]
  );
  assert.equal(result.suggestedRewrite, "still learning then still learning");
});

test("splits a compound AI phrase into separate matches", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [{
      phrase: "I am stupid and ugly",
      category: "insult",
      severity: "medium",
      replacement: "still learning and unique",
      explanation: "These are negative descriptions."
    }]
  });

  const result = await analyze("I am stupid and ugly");

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, replacement }) => ({
      phrase,
      replacement
    }))),
    [
      { phrase: "stupid", replacement: "still learning" },
      { phrase: "ugly", replacement: "unique" }
    ]
  );
  assert.equal(result.suggestedRewrite, "I am still learning and unique");
});

test("replaces invented model specifics with general positive language", async () => {
  const { analyze } = createAnalyzer({
    negative: true,
    matches: [
      {
        phrase: "stupid",
        category: "negative self-talk",
        severity: "medium",
        replacement: "I am terrible at math",
        explanation: "Negative language."
      },
      {
        phrase: "ugly",
        category: "negative self-talk",
        severity: "medium",
        replacement: "have acne",
        explanation: "Negative language."
      }
    ]
  });

  const result = await analyze("I am stupid and ugly");

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, replacement }) => ({
      phrase,
      replacement
    }))),
    [
      { phrase: "stupid", replacement: "still learning" },
      { phrase: "ugly", replacement: "unique" }
    ]
  );
  assert.equal(result.suggestedRewrite, "I am still learning and unique");
});

test("uses reliable fallback matches when the small model misses common terms", async () => {
  const { analyze } = createAnalyzer({
    negative: false,
    matches: []
  });

  const result = await analyze("I am stupid and ugly");

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, replacement }) => ({
      phrase,
      replacement
    }))),
    [
      { phrase: "stupid", replacement: "still learning" },
      { phrase: "ugly", replacement: "unique" }
    ]
  );
  assert.equal(result.suggestedRewrite, "I am still learning and unique");
});

test("uses reliable fallbacks when model JSON is truncated", async () => {
  const { analyze } = createAnalyzer(
    { negative: false, matches: [] },
    { content: '{"negative":true,"matches":[' }
  );

  const result = await analyze("I am dumb");

  assert.equal(result.detected, true);
  assert.equal(result.matches[0].phrase, "dumb");
  assert.equal(result.matches[0].replacement, "still learning");
});

test("surfaces an Ollama HTTP error", async () => {
  const { analyze } = createAnalyzer(
    { negative: false, matches: [] },
    { ok: false, status: 404 }
  );

  await assert.rejects(analyze("Hello"), /Ollama returned HTTP 404/);
});

test("preloads the smaller model with the extended keep-alive", async () => {
  const { preload, getRequest } = createAnalyzer({
    negative: false,
    matches: []
  });

  await preload();

  const requestBody = JSON.parse(getRequest().options.body);
  assert.equal(getRequest().url, "http://localhost:11434/api/generate");
  assert.equal(requestBody.model, "llama3.2:1b");
  assert.equal(requestBody.prompt, "");
  assert.equal(requestBody.keep_alive, "30m");
});
