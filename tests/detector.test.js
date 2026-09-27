const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const detectorSource = fs.readFileSync(
  path.join(__dirname, "..", "detector.js"),
  "utf8"
);
const detectorWindow = {};

vm.runInNewContext(detectorSource, { window: detectorWindow });

const detectHarmfulLanguage =
  detectorWindow.ProtectionScanner.detectHarmfulLanguage;
const harmfulRules = detectorWindow.ProtectionScanner.HARMFUL_RULES;

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertMatchOffsets(text, matches) {
  for (const match of matches) {
    assert.equal(
      text.slice(match.startIndex, match.endIndex),
      match.phrase,
      `offsets should select the returned phrase "${match.phrase}"`
    );
  }
}

test("clear text returns no matches", () => {
  const text = "I appreciate your help.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.detected, false);
  assert.equal(result.matches.length, 0);
  assert.equal(result.originalText, text);
});

test("single insult returns the current category and severity", () => {
  const text = "You are an idiot.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.detected, true);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.matches[0])),
    {
      phrase: "idiot",
      category: "insult",
      severity: "low",
      startIndex: 11,
      endIndex: 16
    }
  );
  assertMatchOffsets(text, result.matches);
});

test("multiple matches return correct phrases and offsets", () => {
  const text = "You are stupid and a moron.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [
      { phrase: "stupid", category: "insult", severity: "low" },
      { phrase: "moron", category: "insult", severity: "low" }
    ]
  );
  assert.deepEqual(
    normalize(result.matches.map(({ startIndex, endIndex }) => [startIndex, endIndex])),
    [[8, 14], [21, 26]]
  );
  assertMatchOffsets(text, result.matches);
});

test("hostile language retains its current classification", () => {
  const text = "I hate you.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.matches[0])),
    {
      phrase: "hate you",
      category: "hostile language",
      severity: "medium",
      startIndex: 2,
      endIndex: 10
    }
  );
  assertMatchOffsets(text, result.matches);
});

test("existing high-severity phrase retains its classification", () => {
  const text = "You should kill yourself.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.matches[0])),
    {
      phrase: "kill yourself",
      category: "self-harm encouragement",
      severity: "high",
      startIndex: 11,
      endIndex: 24
    }
  );
  assertMatchOffsets(text, result.matches);
});

test("representative profanity retains its current category and severity", () => {
  const text = "This is shit.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [{ phrase: "shit", category: "profanity", severity: "low" }]
  );
  assertMatchOffsets(text, result.matches);
});

test("second approved profanity rule is covered", () => {
  const text = "This is fuck.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [{ phrase: "fuck", category: "profanity", severity: "low" }]
  );
  assertMatchOffsets(text, result.matches);
});

test("specific insult takes precedence over its nested profanity rule", () => {
  const text = "That was a piece of shit.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [{ phrase: "piece of shit", category: "insult", severity: "medium" }]
  );
  assertMatchOffsets(text, result.matches);
});

test("explicit threats return left-to-right high-severity threat matches", () => {
  const text = "I will hurt you. I will kill you.";
  const result = detectHarmfulLanguage(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [
      { phrase: "I will hurt you", category: "threat", severity: "high" },
      { phrase: "I will kill you", category: "threat", severity: "high" }
    ]
  );
  assert.deepEqual(
    normalize(result.matches.map(({ startIndex, endIndex }) => [startIndex, endIndex])),
    [[0, 15], [17, 32]]
  );
  assertMatchOffsets(text, result.matches);
});

test("matching is case-insensitive and preserves source casing", () => {
  const text = "You are an IDIOT, and I HATE YOU.";
  const result = detectHarmfulLanguage(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [
      { phrase: "IDIOT", category: "insult", severity: "low" },
      { phrase: "HATE YOU", category: "hostile language", severity: "medium" }
    ]
  );
  assertMatchOffsets(text, result.matches);
});

test("new rules match case-insensitively and preserve source casing", () => {
  const text = "You are an IDIOT, and that is SHIT.";
  const result = detectHarmfulLanguage(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [
      { phrase: "IDIOT", category: "insult", severity: "low" },
      { phrase: "SHIT", category: "profanity", severity: "low" }
    ]
  );
  assertMatchOffsets(text, result.matches);
});

test("word boundaries do not match rules inside longer benign words", () => {
  const text = "The idiotic and stupidly phrased note was benign.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.detected, false);
  assert.equal(result.matches.length, 0);
});

test("Unicode letters and combining marks are treated as word characters", () => {
  const text = "idioté, éidiot, idiot\u0301";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.detected, false);
  assert.equal(result.matches.length, 0);
});

test("punctuation around a phrase is a valid word boundary", () => {
  for (const text of ["idiot!", "(idiot)"]) {
    const result = detectHarmfulLanguage(text);

    assert.deepEqual(
      normalize(result.matches.map(({ phrase, category, severity }) => ({
        phrase,
        category,
        severity
      }))),
      [{ phrase: "idiot", category: "insult", severity: "low" }]
    );
    assertMatchOffsets(text, result.matches);
  }
});

test("same-span ties use existing rule order as the final precedence", () => {
  const duplicateRule = {
    phrase: "idiot",
    category: "threat",
    severity: "high"
  };
  harmfulRules.push(duplicateRule);

  try {
    const result = detectHarmfulLanguage("idiot");

    assert.equal(result.matches.length, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.matches[0])),
      {
        phrase: "idiot",
        category: "insult",
        severity: "low",
        startIndex: 0,
        endIndex: 5
      }
    );
  } finally {
    harmfulRules.pop();
  }
});

test("every match in a multi-match result maps exactly to its source offsets", () => {
  const text = "I hate you so much. You should kill yourself.";
  const result = detectHarmfulLanguage(text);

  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [
      { phrase: "hate you", category: "hostile language", severity: "medium" },
      {
        phrase: "kill yourself",
        category: "self-harm encouragement",
        severity: "high"
      }
    ]
  );
  assertMatchOffsets(text, result.matches);
});

test("known context limitation: negation does not suppress a phrase match", () => {
  const text = "I don't hate you.";
  const result = detectHarmfulLanguage(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [{ phrase: "hate you", category: "hostile language", severity: "medium" }]
  );
  assertMatchOffsets(text, result.matches);
});

test("known context limitation: quoted phrases are still matched", () => {
  const text = 'The phrase "kill yourself" should be blocked.';
  const result = detectHarmfulLanguage(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [{
      phrase: "kill yourself",
      category: "self-harm encouragement",
      severity: "high"
    }]
  );
  assertMatchOffsets(text, result.matches);
});

test("known context limitation: reported speech is still matched", () => {
  const text = "They told me to shut up.";
  const result = detectHarmfulLanguage(text);

  assert.deepEqual(
    normalize(result.matches.map(({ phrase, category, severity }) => ({
      phrase,
      category,
      severity
    }))),
    [{ phrase: "shut up", category: "hostile language", severity: "low" }]
  );
  assertMatchOffsets(text, result.matches);
});
