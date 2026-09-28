const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const shouldRun = process.env.RUN_OLLAMA_TESTS === "1";
const ollamaSource = fs.readFileSync(
  path.join(__dirname, "..", "ollama.js"),
  "utf8"
);
const analyzerWindow = {};
const context = vm.createContext({
  window: analyzerWindow,
  fetch
});

vm.runInContext(ollamaSource, context);

test(
  "live Ollama identifies a minimal negative phrase and concise replacement",
  { skip: !shouldRun, timeout: 120_000 },
  async () => {
    const analyze = analyzerWindow.ProtectionScanner.analyzeWithOllama;
    const result = await analyze("I am dumb");

    assert.equal(result.detected, true);
    assert.equal(result.matches.length, 1);

    const match = result.matches[0];
    assert.equal(match.phrase.toLocaleLowerCase(), "dumb");
    assert.equal(
      result.originalText.slice(match.startIndex, match.endIndex),
      match.phrase
    );
    assert.ok(match.replacement.split(/\s+/).length <= 6);
    assert.doesNotMatch(match.replacement, /[.!?]/);
    assert.equal((result.suggestedRewrite.match(/[.!?]+/g) || []).length <= 1, true);
  }
);

test(
  "live Ollama finds every negative word in a multi-match message",
  { skip: !shouldRun, timeout: 120_000 },
  async () => {
    const analyze = analyzerWindow.ProtectionScanner.analyzeWithOllama;
    const text = "I am stupid and ugly";
    const result = await analyze(text);

    assert.deepEqual(
      Array.from(result.matches, (match) => match.phrase.toLocaleLowerCase()),
      ["stupid", "ugly"]
    );
    assert.deepEqual(
      Array.from(result.matches, (match) => match.replacement),
      ["still learning", "unique"]
    );
    assert.equal(result.suggestedRewrite, "I am still learning and unique");
    result.matches.forEach((match) => {
      assert.equal(text.slice(match.startIndex, match.endIndex), match.phrase);
      assert.ok(match.replacement.split(/\s+/).length <= 6);
    });
  }
);
