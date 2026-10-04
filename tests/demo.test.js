const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
const detectorSource = fs.readFileSync(path.join(root, "detector.js"), "utf8");
const ollamaSource = fs.readFileSync(path.join(root, "ollama.js"), "utf8");
const demoSource = fs.readFileSync(path.join(root, "demo.js"), "utf8");

function createDemo(fetchImplementation, includeOllama = true) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost:8000/test-page.html"
  });
  const { window } = dom;
  window.fetch = fetchImplementation;
  window.eval(detectorSource);
  if (includeOllama) window.eval(ollamaSource);
  window.eval(demoSource);
  return { dom, window, document: window.document };
}

function submitAnalyzer(demo, text) {
  const input = demo.document.getElementById("analyzer-input");
  input.value = text;
  input.dispatchEvent(new demo.window.Event("input", { bubbles: true }));
  demo.document.getElementById("analyzer-form").dispatchEvent(
    new demo.window.Event("submit", { bubbles: true, cancelable: true })
  );
}

function responseFor(result) {
  return {
    ok: true,
    json: async () => ({ message: { content: JSON.stringify(result) } })
  };
}

async function nextTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("AI success exits loading state and labels the result source", async () => {
  const demo = createDemo(async (url) => responseFor(
    url.endsWith("/api/chat")
      ? {
          negative: true,
          matches: [{
            phrase: "stupid",
            category: "insult",
            severity: "low",
            replacement: "a kinder description",
            explanation: "The model identified an insult."
          }]
        }
      : { done: true }
  ));
  submitAnalyzer(demo, "You are stupid.");
  assert.equal(demo.document.getElementById("analyzer-result").dataset.state, "LOADING");
  await nextTurn();

  const result = demo.document.getElementById("analyzer-result");
  assert.equal(result.dataset.state, "AI_RESULT");
  assert.equal(demo.document.getElementById("result-source").textContent, "Local AI analysis");
  assert.equal(
    demo.document.getElementById("result-placeholder").textContent.includes("first request"),
    false
  );
  assert.match(demo.document.getElementById("result-detail").textContent, /Prototype safer alternative/);

  demo.document.getElementById("preview-with-button").click();
  assert.match(demo.document.getElementById("preview-with").textContent, /Potentially harmful phrase/);
  assert.doesNotMatch(demo.document.getElementById("preview-with").textContent, /stupid/);
  demo.dom.window.close();
});

test("Ollama connection failure renders the rule fallback, not a technical error", async () => {
  const demo = createDemo(async (_url, options) => {
    if (options.body.includes('"prompt":""')) return responseFor({ done: true });
    throw new TypeError("private connection details");
  });
  submitAnalyzer(demo, "You are stupid.");
  await nextTurn();

  const result = demo.document.getElementById("analyzer-result");
  assert.equal(result.dataset.state, "RULE_RESULT");
  assert.match(demo.document.getElementById("result-source").textContent, /Rule-based fallback/);
  assert.match(demo.document.getElementById("result-source").textContent, /not reachable/);
  assert.doesNotMatch(demo.document.getElementById("result-placeholder").textContent, /private connection details/);
  assert.match(demo.document.getElementById("result-detail").textContent, /Prototype safer alternative/);
  demo.dom.window.close();
});

test("clearing during a pending request clears loading state and ignores stale output", async () => {
  let resolveChat;
  const demo = createDemo((url) => {
    if (url.endsWith("/api/generate")) return Promise.resolve(responseFor({ done: true }));
    return new Promise((resolve) => {
      resolveChat = resolve;
    });
  });
  submitAnalyzer(demo, "You are stupid.");
  assert.equal(demo.document.getElementById("analyzer-result").dataset.state, "LOADING");
  demo.document.getElementById("clear-button").click();
  assert.equal(demo.document.getElementById("analyzer-result").dataset.state, "CLEAR");
  assert.equal(demo.document.getElementById("analyze-button").disabled, false);
  assert.doesNotMatch(demo.document.getElementById("result-placeholder").textContent, /first request/);

  resolveChat(responseFor({
    negative: true,
    matches: [{
      phrase: "stupid",
      category: "insult",
      severity: "low",
      replacement: "a kinder description"
    }]
  }));
  await nextTurn();
  assert.equal(demo.document.getElementById("analyzer-result").dataset.state, "CLEAR");
  assert.equal(demo.document.getElementById("protection-preview").hidden, true);
  demo.dom.window.close();
});

test("missing analyzer scripts render a concise setup error", async () => {
  const demo = createDemo(async () => responseFor({ done: true }), false);
  submitAnalyzer(demo, "Hello there.");
  await nextTurn();
  assert.equal(demo.document.getElementById("analyzer-result").dataset.state, "ERROR");
  assert.match(
    demo.document.getElementById("result-placeholder").textContent,
    /Reload the demo page/
  );
  demo.dom.window.close();
});

test("untrusted model explanations render as text rather than HTML", async () => {
  const demo = createDemo(async (url) => responseFor(
    url.endsWith("/api/chat")
      ? {
          negative: true,
          matches: [{
            phrase: "stupid",
            category: "insult",
            severity: "low",
            replacement: "a kinder description",
            explanation: '<img src=x onerror="alert(1)">'
          }]
        }
      : { done: true }
  ));
  submitAnalyzer(demo, "You are stupid.");
  await nextTurn();

  const detail = demo.document.getElementById("result-detail");
  assert.equal(detail.querySelector("img"), null);
  assert.match(detail.textContent, /<img src=x onerror=/);
  demo.dom.window.close();
});
