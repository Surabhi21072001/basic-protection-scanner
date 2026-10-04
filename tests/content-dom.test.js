const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const detectorSource = fs.readFileSync(
  path.join(__dirname, "..", "detector.js"),
  "utf8"
);
const manifest = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "manifest.json"),
  "utf8"
));
const contentSource = fs.readFileSync(
  path.join(__dirname, "..", "content.js"),
  "utf8"
);

function createScannedPage(body) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, {
    runScripts: "outside-only",
    url: "http://localhost/"
  });
  const { window } = dom;
  const messageListeners = [];

  window.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        }
      }
    }
  };
  window.getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
    position: "static"
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentElement;
    }
  });

  window.eval(detectorSource);
  window.eval(contentSource);

  return {
    dom,
    window,
    document: window.document,
    scanAgain: () => window.eval("scanPage()"),
    getSummary() {
      let summary;
      messageListeners[0](
        { type: "bps:get-summary" },
        {},
        (response) => {
          summary = response;
        }
      );
      return summary;
    }
  };
}

test("DOM markers preserve detector offsets and source text", () => {
  const page = createScannedPage(
    '<p id="message">Before idiot and after.</p>'
  );
  const marker = page.document.querySelector("[data-bps-flag]");

  assert.ok(marker);
  assert.equal(marker.dataset.bpsPhrase, "idiot");
  assert.equal(marker.dataset.bpsOriginalText, "idiot");
  assert.equal(marker.dataset.bpsStartIndex, "7");
  assert.equal(marker.dataset.bpsEndIndex, "12");
  assert.equal(
    page.document.querySelector("[data-bps-original]").textContent,
    "idiot"
  );
});

test("multiple matches create separate markers in source order", () => {
  const page = createScannedPage(
    '<p id="message">stupid and moron</p>'
  );
  const markers = Array.from(
    page.document.querySelectorAll("[data-bps-flag]")
  );

  assert.equal(markers.length, 2);
  assert.deepEqual(
    markers.map((marker) => marker.dataset.bpsPhrase),
    ["stupid", "moron"]
  );
  assert.deepEqual(
    markers.map((marker) => [
      Number(marker.dataset.bpsStartIndex),
      Number(marker.dataset.bpsEndIndex)
    ]),
    [[0, 6], [11, 16]]
  );
});

test("flag controls move through protected, open, original, and safer states", () => {
  const page = createScannedPage('<p>That was stupid.</p>');
  const marker = page.document.querySelector("[data-bps-flag]");
  const trigger = marker.querySelector(".bps-flag-trigger");
  const panel = marker.querySelector(".bps-flag-panel");
  const original = marker.querySelector("[data-bps-original]");
  const safer = marker.querySelector("[data-bps-safer]");
  const originalButton = marker.querySelector("[data-bps-action='original']");
  const saferButton = marker.querySelector("[data-bps-action='safer']");

  assert.equal(marker.dataset.bpsOpen, "false");
  assert.equal(marker.dataset.bpsDisplay, "protected");
  assert.equal(panel.hidden, true);
  assert.equal(safer.hidden, true);

  trigger.click();
  assert.equal(marker.dataset.bpsOpen, "true");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);

  originalButton.click();
  assert.equal(marker.dataset.bpsDisplay, "original");
  assert.equal(original.hidden, false);
  assert.equal(originalButton.getAttribute("aria-pressed"), "true");

  saferButton.click();
  assert.equal(marker.dataset.bpsDisplay, "safer");
  assert.equal(original.hidden, true);
  assert.equal(safer.hidden, false);
  assert.equal(saferButton.getAttribute("aria-pressed"), "true");
});

test("Browser Protection explains its local rule and prototype controls", () => {
  const page = createScannedPage('<p>You are stupid.</p>');
  const marker = page.document.querySelector("[data-bps-flag]");
  const panel = marker.querySelector(".bps-flag-panel");

  assert.match(panel.textContent, /Category: Insult/);
  assert.match(panel.textContent, /Prototype severity: Low/);
  assert.match(panel.textContent, /Why was this phrase flagged\?/);
  assert.match(panel.textContent, /matches a local rule categorized as insult/);
  assert.match(panel.textContent, /Prototype safer alternative:/);
  assert.equal(panel.querySelector("[data-bps-action='original']").textContent, "Show original");
  assert.equal(
    panel.querySelector("[data-bps-action='safer']").textContent,
    "View safer alternative"
  );
});

test("high-risk Browser Protection alternatives align with current rule categories", () => {
  const page = createScannedPage("<p>I will hurt you.</p>");
  const marker = page.document.querySelector("[data-bps-flag]");
  const panel = marker.querySelector(".bps-flag-panel");
  panel.querySelector("[data-bps-action='safer']").click();

  assert.match(
    marker.querySelector("[data-bps-safer]").textContent,
    /non-threatening statement/
  );
});

test("rescanning does not duplicate markers or original phrase nodes", () => {
  const page = createScannedPage('<p id="message">You are an idiot.</p>');

  page.scanAgain();
  page.scanAgain();

  assert.equal(page.document.querySelectorAll("[data-bps-flag]").length, 1);
  assert.equal(page.document.querySelectorAll("[data-bps-original]").length, 1);
  assert.equal(
    page.document.querySelector("[data-bps-original]").textContent,
    "idiot"
  );
});

test("popup summary reports the initial DOM scan totals", () => {
  const page = createScannedPage(
    "<p>stupid and moron</p><p>This is constructive.</p>"
  );
  const summary = page.getSummary();

  assert.equal(summary.active, true);
  assert.equal(summary.scannedCount, 2);
  assert.equal(summary.harmfulCount, 2);
  assert.equal(typeof summary.updatedAt, "number");
});

test("automatic webpage scanning does not load the Ollama analyzer", () => {
  assert.deepEqual(
    manifest.content_scripts[0].js,
    ["detector.js", "content.js"]
  );
});
