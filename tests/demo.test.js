const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
const detectorSource = fs.readFileSync(path.join(root, "detector.js"), "utf8");
const ollamaSource = fs.readFileSync(path.join(root, "ollama.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
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
  assert.equal(demo.document.getElementById("result-source").hidden, true);
  assert.equal(
    demo.document.getElementById("result-placeholder").textContent.includes("first request"),
    false
  );
  assert.match(demo.document.getElementById("result-detail").textContent, /Suggested alternative:/);
  assert.equal(demo.document.getElementById("result-title").textContent,
    "Potentially harmful language detected");

  assert.equal(
    demo.document.querySelector('[data-guided-step="review"]').getAttribute("aria-current"),
    "step"
  );
  demo.document.getElementById("preview-with-button").click();
  assert.match(demo.document.getElementById("preview-with").textContent, /Flagged/);
  assert.doesNotMatch(demo.document.getElementById("preview-with").textContent, /stupid/);
  assert.equal(
    demo.document.querySelector('[data-guided-step="choose"]').getAttribute("aria-current"),
    "step"
  );
  demo.document.getElementById("preview-without-button").click();
  assert.equal(demo.document.getElementById("preview-without-button").getAttribute("aria-pressed"), "true");
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
  assert.equal(demo.document.getElementById("result-source").hidden, true);
  assert.doesNotMatch(demo.document.getElementById("result-placeholder").textContent, /private connection details/);
  assert.match(demo.document.getElementById("result-detail").textContent, /Suggested alternative:/);
  demo.dom.window.close();
});

test("result cards present phrase details in product language", async () => {
  const demo = createDemo(async (url) => responseFor(
    url.endsWith("/api/chat")
      ? {
          negative: true,
          matches: [{
            phrase: "stupid",
            category: "insult",
            severity: "low",
            replacement: "a less personal response"
          }]
        }
      : { done: true }
  ));
  submitAnalyzer(demo, "You are stupid.");
  await nextTurn();
  const detail = demo.document.getElementById("result-detail");
  assert.match(detail.textContent, /Flagged phrase/);
  assert.match(detail.textContent, /Category: Insult/);
  assert.match(detail.textContent, /Severity: Low/);
  assert.match(detail.textContent, /Why this may be harmful/);
  assert.match(detail.textContent, /may come across as a personal attack/);
  assert.match(detail.textContent, /Suggested alternative: a less personal response/);
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
    /Reload the page/
  );
  demo.dom.window.close();
});

test("model explanations do not override the product-facing explanation", async () => {
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
  assert.match(detail.textContent, /This wording may come across as a personal attack/);
  assert.doesNotMatch(detail.textContent, /<img src=x onerror=/);
  demo.dom.window.close();
});

test("selecting an example fills and selects it, then advances to analysis", async () => {
  const demo = createDemo(async (_url, options) => {
    if (options.body.includes('"prompt":""')) return responseFor({ done: true });
    return responseFor({ negative: false, matches: [] });
  });
  const recommended = demo.document.querySelector(".example-button-recommended");
  recommended.click();

  assert.equal(demo.document.getElementById("analyzer-input").value, "You are such an idiot.");
  assert.equal(recommended.getAttribute("aria-pressed"), "true");
  assert.equal(recommended.classList.contains("is-selected"), true);
  assert.match(demo.document.getElementById("example-status").textContent, /Ready to analyze/);
  assert.equal(demo.document.activeElement.id, "analyze-button");
  assert.equal(
    demo.document.querySelector('[data-guided-step="analyze"]').getAttribute("aria-current"),
    "step"
  );

  demo.document.getElementById("analyzer-form").dispatchEvent(
    new demo.window.Event("submit", { bubbles: true, cancelable: true })
  );
  assert.equal(demo.document.getElementById("example-status").hidden, true);
  await nextTurn();
  assert.equal(
    demo.document.querySelector('[data-guided-step="review"]').getAttribute("aria-current"),
    "step"
  );
  demo.dom.window.close();
});

test("hero preview switches between the original phrase and alternative", () => {
  const demo = createDemo(async () => responseFor({ done: true }));
  const phrase = demo.document.getElementById("hero-preview-phrase");
  demo.document.getElementById("hero-alternative-button").click();
  assert.equal(phrase.textContent, "unkind person");
  assert.equal(phrase.classList.contains("preview-alternative-text"), true);
  assert.equal(demo.document.getElementById("hero-alternative-button").getAttribute("aria-pressed"), "true");

  demo.document.getElementById("hero-original-button").click();
  assert.equal(phrase.textContent, "idiot");
  assert.equal(phrase.classList.contains("preview-mark"), true);
  assert.equal(demo.document.getElementById("hero-original-button").getAttribute("aria-pressed"), "true");
  demo.dom.window.close();
});

test("demo navigation, scenario cards, and avatars remain available", () => {
  const demo = createDemo(async () => responseFor({ done: true }));
  assert.equal(demo.document.querySelector('a[href="#analyzer"]').textContent.trim().startsWith("Try a message"), true);
  assert.equal(demo.document.querySelector('a[href="#live-demo"]').textContent.trim().startsWith("Explore browser demo"), true);
  assert.deepEqual(
    Array.from(demo.document.querySelectorAll("[data-example] .example-name"), (item) => item.textContent),
    ["Friendly", "Direct insult", "Multiple", "Evasion", "High severity"]
  );
  assert.ok(Array.from(demo.document.querySelectorAll(".avatar, .preview-avatar"))
    .every((avatar) => avatar.textContent.trim().length > 0));
  assert.match(demo.document.getElementById("live-demo").textContent, /Open a flagged phrase/);
  assert.doesNotMatch(
    demo.document.querySelector("main").textContent,
    /\b(?:Ollama|LLM|AI-generated|local AI|rule-based fallback)\b/i
  );
  demo.dom.window.close();
});

test("Browser Demo discussion receives working phrase controls", () => {
  const demo = createDemo(async () => responseFor({ done: true }));
  demo.window.chrome = { runtime: { onMessage: { addListener() {} } } };
  demo.window.getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
    position: "static"
  });
  Object.defineProperty(demo.window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentElement;
    }
  });
  demo.window.eval(contentSource);

  const flags = demo.document.querySelectorAll("#live-demo [data-bps-flag]");
  assert.equal(flags.length, 2);
  const flag = flags[0];
  flag.querySelector(".bps-flag-trigger").click();
  assert.equal(flag.querySelector(".bps-flag-panel").hidden, false);
  assert.match(flag.querySelector(".bps-flag-panel").textContent, /Suggested alternative/);
  flag.querySelector("[data-bps-action='safer']").click();
  assert.equal(flag.dataset.bpsDisplay, "safer");
  demo.dom.window.close();
});
