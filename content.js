/**
 * content.js
 * -----------
 * The content script. Chrome injects this into every normal webpage
 * (see "matches": ["<all_urls>"] in manifest.json).
 *
 * WHAT IT DOES (the pipeline):
 *   Webpage DOM
 *     -> read visible text from paragraph-like elements
 *     -> hand each text block to detector.js
 *     -> collect a result object
 *     -> log matches to the console + save a summary for the popup
 *
 * V1 RULE: We DO NOT modify, blur, or rewrite the page. We only READ and LOG.
 */

// The kinds of elements we treat as "readable content".
const READABLE_SELECTORS = [
  "p",
  "span",
  "div",
  "li",
  "article",
  "section",
  "h1", "h2", "h3", "h4", "h5", "h6"
];

// We tag scanned elements with this attribute so we never scan them twice.
const SCANNED_ATTR = "data-bps-scanned";

/**
 * Decide whether an element is worth scanning.
 * We skip:
 *   - script / style / noscript / input / textarea (not readable content)
 *   - hidden elements (display:none, visibility:hidden, or zero size)
 *   - already-scanned elements
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isScannableElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

  // Skip elements we've already looked at.
  if (el.hasAttribute(SCANNED_ATTR)) return false;

  // Skip tags that never contain readable prose.
  const tag = el.tagName.toLowerCase();
  const SKIP_TAGS = ["script", "style", "noscript", "input", "textarea"];
  if (SKIP_TAGS.includes(tag)) return false;

  // Skip hidden elements where practical.
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }

  // Skip elements with no rendered box (a rough "is it hidden?" check).
  if (el.offsetParent === null && style.position !== "fixed") {
    return false;
  }

  return true;
}

/**
 * Get the DIRECT visible text of an element (not counting nested children's
 * text), so a big <div> wrapping many <p> tags does not double-report text.
 * We read only the element's own direct text nodes.
 *
 * @param {Element} el
 * @returns {string}
 */
function getDirectText(el) {
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Scan the whole document once.
 * Returns a summary object: { scannedCount, matches: [...] }
 */
function scanPage() {
  const elements = document.querySelectorAll(READABLE_SELECTORS.join(","));

  let scannedCount = 0;
  const matches = [];

  const detect = window.ProtectionScanner && window.ProtectionScanner.detectHarmfulLanguage;
  if (typeof detect !== "function") {
    console.warn("[Basic Protection Scanner] detector.js not loaded — skipping scan.");
    return { scannedCount: 0, matches: [] };
  }

  elements.forEach((el) => {
    if (!isScannableElement(el)) return;

    // Mark as scanned so re-runs (e.g. dynamic content) skip it.
    el.setAttribute(SCANNED_ATTR, "true");

    const text = getDirectText(el);
    if (!text) return; // nothing readable here

    scannedCount++;

    const result = detect(text);
    if (result.detected) {
      matches.push({
        tag: el.tagName.toLowerCase(),
        matchedPhrase: result.matchedPhrase,
        snippet: result.snippet
      });

      // Log each match clearly in the browser console.
      console.log("[Basic Protection Scanner]");
      console.log("Harmful language detected:");
      console.log("  Element: <" + el.tagName.toLowerCase() + ">");
      console.log("  Matched phrase: \u201c" + result.matchedPhrase + "\u201d");
      console.log("  Text: \u201c" + result.snippet + "\u201d");
      // Also log the actual DOM element so it can be inspected/clicked.
      console.log("  DOM element:", el);
    }
  });

  return { scannedCount, matches };
}

/**
 * Save the latest summary so the popup can read it.
 * We use chrome.storage.local keyed by tab-independent totals for simplicity.
 */
function saveSummary(summary) {
  const payload = {
    active: true,
    scannedCount: summary.scannedCount,
    harmfulCount: summary.matches.length,
    updatedAt: Date.now()
  };

  try {
    chrome.storage.local.set({ bpsSummary: payload });
  } catch (e) {
    // Storage can fail on some restricted pages; that's OK for V1.
    console.warn("[Basic Protection Scanner] Could not save summary:", e);
  }
}

/**
 * Run one full scan and report totals.
 */
function runScan() {
  const summary = scanPage();

  console.log("[Basic Protection Scanner]");
  console.log("Scanned elements: " + summary.scannedCount);
  console.log("Harmful matches: " + summary.matches.length);

  saveSummary(summary);
}

// Run the first scan once the page has settled.
runScan();
