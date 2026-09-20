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
 *     -> mark exact harmful phrases without replacing page containers
 *     -> log matches to the console + save a summary for the popup
 *
 * V1 RULE: We do not replace, blur, or rewrite page content. We only add
 * lightweight metadata and a subtle visual marker around exact matches.
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
const FLAG_ATTR = "data-bps-flag";

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
 * Get the element's direct text and the source nodes used to build it. Keeping
 * exact text (rather than trimming/collapsing whitespace) makes detector
 * offsets safe to map back to DOM text nodes.
 *
 * @param {Element} el
 * @returns {{ text: string, textNodes: Text[] }}
 */
function getDirectText(el) {
  let text = "";
  const textNodes = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
      textNodes.push(node);
    }
  }
  return { text, textNodes };
}

function getSaferVersion(match) {
  if (match.category === "insult") {
    return "unkind language";
  }

  if (match.category === "hostile language") {
    return "a more respectful response";
  }

  if (match.category === "profanity") {
    return "inappropriate language";
  }

  if (match.category === "harassment/threat") {
    return "a non-threatening statement";
  }

  return "a more constructive phrase";
}

function setFlagState(marker, state) {
  const original = marker.querySelector("[data-bps-original]");
  const safer = marker.querySelector("[data-bps-safer]");
  const showOriginalButton = marker.querySelector("[data-bps-action='original']");
  const saferButton = marker.querySelector("[data-bps-action='safer']");

  marker.dataset.bpsState = state;
  original.hidden = state === "safer";
  safer.hidden = state !== "safer";
  marker.classList.toggle("bps-is-revealed", state === "original");
  marker.classList.toggle("bps-is-safer", state === "safer");
  showOriginalButton.textContent = state === "original" ? "Hide original" : "Show original";
  showOriginalButton.setAttribute("aria-pressed", String(state === "original"));
  saferButton.setAttribute("aria-pressed", String(state === "safer"));
}

function addFlagControls(marker, match) {
  const original = document.createElement("span");
  original.className = "bps-flag-content";
  original.setAttribute("data-bps-original", "true");
  original.textContent = marker.dataset.bpsOriginalText;

  const safer = document.createElement("span");
  safer.className = "bps-flag-content";
  safer.setAttribute("data-bps-safer", "true");
  safer.textContent = getSaferVersion(match);

  const controls = document.createElement("span");
  controls.className = "bps-flag-controls";
  controls.setAttribute("data-bps-controls", "true");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Harmful phrase controls");

  const showOriginalButton = document.createElement("button");
  showOriginalButton.type = "button";
  showOriginalButton.className = "bps-flag-button";
  showOriginalButton.setAttribute("data-bps-action", "original");
  showOriginalButton.setAttribute("aria-pressed", "false");
  showOriginalButton.textContent = "Show original";
  showOriginalButton.addEventListener("click", () => {
    setFlagState(marker, marker.dataset.bpsState === "original" ? "hidden" : "original");
  });

  const saferButton = document.createElement("button");
  saferButton.type = "button";
  saferButton.className = "bps-flag-button";
  saferButton.setAttribute("data-bps-action", "safer");
  saferButton.setAttribute("aria-pressed", "false");
  saferButton.textContent = "Safer version";
  saferButton.addEventListener("click", () => {
    setFlagState(marker, marker.dataset.bpsState === "safer" ? "hidden" : "safer");
  });

  controls.append(showOriginalButton, saferButton);
  marker.replaceChildren(original, safer, controls);
  setFlagState(marker, "hidden");
}

/**
 * Add a marker around one match without replacing the containing element.
 * Matches spanning nested elements are deliberately skipped because wrapping
 * them could move or break unrelated markup and event-listener boundaries.
 */
function flagMatch(textNodes, match) {
  let offset = 0;

  for (const textNode of textNodes) {
    const nodeStart = offset;
    const nodeEnd = offset + textNode.nodeValue.length;
    offset = nodeEnd;

    if (match.startIndex < nodeStart || match.endIndex > nodeEnd) {
      continue;
    }

    const localStart = match.startIndex - nodeStart;
    const localLength = match.endIndex - match.startIndex;
    const matchNode = textNode.splitText(localStart);
    const trailingNode = matchNode.splitText(localLength);
    const marker = document.createElement("mark");

    marker.className = "bps-harmful-phrase";
    marker.setAttribute(FLAG_ATTR, "true");
    marker.dataset.bpsPhrase = match.phrase;
    marker.dataset.bpsOriginalText = matchNode.nodeValue;
    marker.dataset.bpsCategory = match.category;
    marker.dataset.bpsSeverity = match.severity;
    marker.dataset.bpsStartIndex = String(match.startIndex);
    marker.dataset.bpsEndIndex = String(match.endIndex);
    marker.setAttribute("role", "group");
    marker.setAttribute("aria-label", "Potentially harmful " + match.category);
    addFlagControls(marker, match);
    trailingNode.parentNode.insertBefore(marker, trailingNode);
    return true;
  }

  return false;
}

function flagMatches(textNodes, matches) {
  // Apply right-to-left so offsets remain valid after text nodes split.
  const sortedMatches = matches
    .slice()
    .sort((left, right) => right.startIndex - left.startIndex);

  let lastStart = Infinity;
  sortedMatches.forEach((match) => {
    // Overlapping matches cannot be represented by nested markers safely.
    if (match.endIndex > lastStart) return;
    if (flagMatch(textNodes, match)) {
      lastStart = match.startIndex;
    }
  });
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

    const directText = getDirectText(el);
    const text = directText.text;
    if (!text) return; // nothing readable here

    scannedCount++;

    const result = detect(text);
    if (result.detected) {
      flagMatches(directText.textNodes, result.matches);

      result.matches.forEach((match) => {
        matches.push({
          tag: el.tagName.toLowerCase(),
          ...match,
          snippet: result.originalText
        });

        // Log each match clearly in the browser console.
        console.log("[Basic Protection Scanner]");
        console.log("Harmful language detected:");
        console.log("  Element: <" + el.tagName.toLowerCase() + ">");
        console.log("  Matched phrase: \u201c" + match.phrase + "\u201d");
        console.log("  Category: " + match.category);
        console.log("  Severity: " + match.severity);
        console.log("  Text: \u201c" + result.originalText + "\u201d");
        // Also log the actual DOM element so it can be inspected/clicked.
        console.log("  DOM element:", el);
      });
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
