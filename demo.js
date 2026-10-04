/**
 * demo.js
 * -------
 * Standalone analyzer and protection preview for test-page.html.
 * Submitted text uses the local Ollama adapter, with local rules as fallback.
 */

const analyzerForm = document.getElementById("analyzer-form");
const analyzerInput = document.getElementById("analyzer-input");
const analyzeButton = document.getElementById("analyze-button");
const clearButton = document.getElementById("clear-button");
const inputCount = document.getElementById("input-count");
const resultTitle = document.getElementById("result-title");
const resultBadge = document.getElementById("result-badge");
const resultSource = document.getElementById("result-source");
const exampleStatus = document.getElementById("example-status");
const resultPlaceholder = document.getElementById("result-placeholder");
const resultPreview = document.getElementById("result-preview");
const resultText = document.getElementById("result-text");
const resultDetail = document.getElementById("result-detail");
const protectionPreview = document.getElementById("protection-preview");
const previewWithout = document.getElementById("preview-without");
const previewWith = document.getElementById("preview-with");
const previewWithoutButton = document.getElementById("preview-without-button");
const previewWithButton = document.getElementById("preview-with-button");
const heroPreviewPhrase = document.getElementById("hero-preview-phrase");
const heroOriginalButton = document.getElementById("hero-original-button");
const heroAlternativeButton = document.getElementById("hero-alternative-button");
const guidedSteps = document.querySelectorAll("[data-guided-step]");
const childModeToggle = document.getElementById("child-mode-toggle");
let currentAnalysis = null;
let analysisRequestId = 0;

/**
 * Child Mode (demo-only, additive layer)
 * --------------------------------------
 * When enabled, Child Mode augments an existing detection result WITHOUT
 * changing detector.js or the AI adapter. It:
 *   - flags a small set of extra terms that are mild for adults but worth
 *     surfacing for younger users (additive; never removes existing matches),
 *   - raises the displayed severity of low-severity flags one level,
 *   - makes the Protected preview the default view.
 *
 * It never mutates the original detection result object. It derives a new,
 * child-aware result so turning the mode off restores identical behavior.
 */
const CHILD_MODE_STORAGE_KEY = "bps:child-mode";

// Mild supplemental terms, only consulted when Child Mode is on. Edit freely.
const CHILD_SUPPLEMENTAL_RULES = [
  { phrase: "hate", category: "hostile language", severity: "low" },
  { phrase: "ugly", category: "insult", severity: "low" },
  { phrase: "jerk", category: "insult", severity: "low" },
  { phrase: "dumb", category: "insult", severity: "low" },
  { phrase: "sucks", category: "hostile language", severity: "low" },
  { phrase: "crap", category: "profanity", severity: "low" }
];

function isChildModeEnabled() {
  return Boolean(childModeToggle && childModeToggle.checked);
}

function readStoredChildMode() {
  try {
    return window.localStorage.getItem(CHILD_MODE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeStoredChildMode(enabled) {
  try {
    window.localStorage.setItem(CHILD_MODE_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage may be unavailable (private mode / file://). The toggle still
    // works for the current session; persistence is best-effort only.
  }
}

function escapeChildRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive, Unicode-aware matching, mirroring detector.js
// so supplemental terms behave consistently with the core rules.
function findChildSupplementalMatches(text) {
  const source = typeof text === "string" ? text : "";
  const matches = [];

  CHILD_SUPPLEMENTAL_RULES.forEach((rule) => {
    const pattern = new RegExp(
      "(^|[^\\p{L}\\p{N}\\p{M}_])" +
        escapeChildRegExp(rule.phrase) +
        "(?=$|[^\\p{L}\\p{N}\\p{M}_])",
      "giu"
    );
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const startIndex = match.index + match[1].length;
      const endIndex = startIndex + rule.phrase.length;
      matches.push({
        phrase: source.slice(startIndex, endIndex),
        category: rule.category,
        severity: rule.severity,
        startIndex,
        endIndex,
        replacement: getDemoAlternative({ category: rule.category }),
        childAdded: true
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  });

  return matches;
}

function bumpSeverityForChild(severity) {
  if (severity === "low") return "medium";
  if (severity === "medium") return "high";
  return severity;
}

/**
 * Produce a child-aware copy of a detection result. The input result is never
 * mutated, so disabling Child Mode restores the exact original behavior.
 */
function applyChildMode(detectionResult) {
  if (!isChildModeEnabled() || !detectionResult) return detectionResult;

  const baseMatches = Array.isArray(detectionResult.matches)
    ? detectionResult.matches
    : [];

  // Raise the displayed severity of existing flags for a child-facing view.
  const bumped = baseMatches.map((match) => ({
    ...match,
    severity: bumpSeverityForChild(match.severity),
    childBumped: match.severity === "low" || match.severity === "medium"
  }));

  // Add supplemental matches that do not overlap an existing flag.
  const text = detectionResult.originalText || "";
  const supplemental = findChildSupplementalMatches(text).filter((candidate) =>
    !bumped.some((existing) =>
      candidate.startIndex < existing.endIndex &&
      candidate.endIndex > existing.startIndex
    )
  );

  const matches = bumped
    .concat(supplemental)
    .sort((left, right) => left.startIndex - right.startIndex);

  return {
    ...detectionResult,
    matches,
    detected: matches.length > 0,
    childMode: true
  };
}
const ANALYZER_STATES = new Set([
  "IDLE",
  "LOADING",
  "AI_RESULT",
  "RULE_RESULT",
  "CLEAR",
  "ERROR"
]);
let analyzerState = "IDLE";

function setAnalyzerState(state) {
  if (!ANALYZER_STATES.has(state)) {
    throw new Error("Invalid analyzer state.");
  }
  analyzerState = state;
  const resultCard = document.getElementById("analyzer-result");
  resultCard.dataset.state = analyzerState;
  resultCard.setAttribute("aria-busy", String(state === "LOADING"));
}

function setResultSource(detectionResult) {
  if (!detectionResult || !detectionResult.source) {
    resultSource.textContent = "";
    resultSource.hidden = true;
    return;
  }

  if (detectionResult.source === "rules") {
    resultSource.textContent = detectionResult.fallbackReason
      ? "Rule-based fallback · " + getFallbackReasonLabel(detectionResult.fallbackReason)
      : "Rule-based analysis";
  } else {
    resultSource.textContent = "Local AI analysis";
  }
  resultSource.hidden = true;
}

function getFallbackReasonLabel(reason) {
  const reasons = {
    unreachable: "Ollama is not reachable",
    "model-missing": "the configured model is not installed",
    "invalid-response": "Ollama returned an invalid response",
    "parse-failure": "Ollama's response could not be parsed",
    "validation-failure": "Ollama's response did not pass validation",
    "request-failure": "Ollama could not complete the request"
  };
  return reasons[reason] || reasons["request-failure"];
}

function updateInputCount() {
  inputCount.textContent = analyzerInput.value.length + " / 500";
}

function createHighlightedText(text, matches) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  matches.forEach((match) => {
    if (match.startIndex < cursor) return;

    if (match.startIndex > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.startIndex)));
    }

    const mark = document.createElement("mark");
    mark.className = "demo-flag demo-flag-" + match.severity;
    mark.textContent = text.slice(match.startIndex, match.endIndex);
    mark.title = match.category + " · " + match.severity + " severity";
    fragment.appendChild(mark);
    cursor = match.endIndex;
  });

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

function createProtectedPreview(text, matches) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  matches.forEach((match) => {
    if (match.startIndex < cursor) return;

    fragment.appendChild(document.createTextNode(text.slice(cursor, match.startIndex)));
    const protectedLabel = document.createElement("span");
    protectedLabel.className = "demo-protected-label";
    protectedLabel.setAttribute("aria-label", "Potentially harmful phrase");
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";
    const label = document.createElement("span");
    label.textContent = "Flagged";
    protectedLabel.append(icon, label);
    fragment.appendChild(protectedLabel);
    cursor = match.endIndex;
  });

  fragment.appendChild(document.createTextNode(text.slice(cursor)));
  return fragment;
}

function setGuidedStep(activeStep) {
  const orderedSteps = Array.from(guidedSteps);
  const activeIndex = orderedSteps.findIndex((step) => step.dataset.guidedStep === activeStep);
  orderedSteps.forEach((step, index) => {
    if (step.dataset.guidedStep === activeStep) {
      step.setAttribute("aria-current", "step");
    } else {
      step.removeAttribute("aria-current");
    }
    step.classList.toggle("is-complete", index < activeIndex);
  });
}

function showEmptyState(state = "IDLE") {
  setAnalyzerState(state);
  setResultSource(null);
  resultTitle.textContent = state === "CLEAR" ? "Cleared" : "Analysis";
  resultBadge.textContent = state === "CLEAR" ? "Cleared" : "Ready";
  resultBadge.className = "result-badge result-badge-neutral";
  resultPlaceholder.replaceChildren();
  const icon = document.createElement("div");
  icon.className = "result-placeholder-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✦";
  const message = document.createElement("p");
  message.textContent = state === "CLEAR"
    ? "Message and results cleared."
    : "Choose a scenario or write your own message to begin.";
  resultPlaceholder.append(icon, message);
  resultPlaceholder.hidden = false;
  resultPreview.hidden = true;
  protectionPreview.hidden = true;
  setGuidedStep("review");
}

function showCleanState(detectionResult) {
  setAnalyzerState(detectionResult.source === "rules" ? "RULE_RESULT" : "AI_RESULT");
  setResultSource(detectionResult);
  resultTitle.textContent = "No potentially harmful language detected";
  resultBadge.textContent = "Clean";
  resultBadge.className = "result-badge result-badge-safe";
  resultPlaceholder.hidden = false;
  resultPlaceholder.replaceChildren();
  const indicator = document.createElement("span");
  indicator.className = "result-positive-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = "✓";
  const message = document.createElement("p");
  message.textContent = "No phrases were flagged in this message.";
  resultPlaceholder.append(indicator, message);
  resultPreview.hidden = true;
}

function showLoadingState() {
  setAnalyzerState("LOADING");
  resultSource.textContent = "";
  resultSource.hidden = true;
  resultTitle.textContent = "Reviewing your message…";
  resultBadge.textContent = "Working";
  resultBadge.className = "result-badge result-badge-neutral";
  resultPlaceholder.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "This may take a moment.";
  resultPlaceholder.appendChild(message);
  resultPlaceholder.hidden = false;
  resultPreview.hidden = true;
  protectionPreview.hidden = true;
  analyzeButton.disabled = true;
  analyzeButton.textContent = "Analyzing…";
}

function showAnalysisError() {
  setAnalyzerState("ERROR");
  setResultSource(null);
  resultTitle.textContent = "Unavailable";
  resultBadge.textContent = "Error";
  resultBadge.className = "result-badge result-badge-warning";
  resultPlaceholder.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "Reload the page and try again.";
  resultPlaceholder.appendChild(message);
  resultPlaceholder.hidden = false;
  resultPreview.hidden = true;
  protectionPreview.hidden = true;
}

function showDetectedState(text, detectionResult) {
  setAnalyzerState(detectionResult.source === "rules" ? "RULE_RESULT" : "AI_RESULT");
  setResultSource(detectionResult);
  resultTitle.textContent = "Potentially harmful language detected";
  resultBadge.textContent = detectionResult.matches.length + " flag" +
    (detectionResult.matches.length === 1 ? "" : "s");
  resultBadge.className = "result-badge result-badge-warning";
  resultPlaceholder.hidden = true;
  resultPlaceholder.replaceChildren();
  resultPreview.hidden = false;
  resultText.replaceChildren(createHighlightedText(text, detectionResult.matches));
  resultDetail.replaceChildren();

  detectionResult.matches.forEach((match) => {
    const detail = document.createElement("article");
    detail.className = "result-match-card";
    detail.dataset.severity = match.severity;

    const phrase = document.createElement("strong");
    phrase.className = "result-match-phrase";
    phrase.textContent = match.phrase;

    const phraseLabel = document.createElement("span");
    phraseLabel.className = "result-match-label";
    phraseLabel.textContent = "Flagged phrase";

    const category = document.createElement("span");
    category.className = "result-match-metadata";
    category.textContent = "Category: " + getCategoryLabel(match.category);

    const severity = document.createElement("span");
    severity.className = "result-match-metadata";
    severity.textContent = "Severity: " + getSeverityLabel(match.severity);

    const whyTitle = document.createElement("strong");
    whyTitle.className = "result-match-why-title";
    whyTitle.textContent = "Why this may be harmful";

    const why = document.createElement("span");
    why.className = "result-match-metadata";
    why.textContent = getPresentationExplanation(match.category);

    const alternative = document.createElement("span");
    alternative.className = "result-match-alternative";
    alternative.textContent = "Suggested alternative: " + getDemoAlternative(match);

    detail.append(phraseLabel, phrase, category, severity, whyTitle, why, alternative);
    resultDetail.appendChild(detail);
  });
}

function getDemoAlternative(match) {
  if (match.replacement) return match.replacement;

  const alternatives = {
    insult: "unkind person",
    profanity: "inappropriate language",
    "hostile language": "a more respectful response",
    threat: "a non-threatening statement",
    "self-harm encouragement": "a supportive message"
  };
  return alternatives[match.category] || "a more constructive phrase";
}

function getCategoryLabel(category) {
  return category.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getSeverityLabel(severity) {
  const labels = {
    low: "Low",
    medium: "Medium",
    high: "High"
  };
  return labels[severity] || "Unrated prototype rule";
}

function getPresentationExplanation(category) {
  const explanations = {
    insult: "This wording may come across as a personal attack.",
    profanity: "This word may be hurtful or upsetting to some readers.",
    "hostile language": "This wording may sound dismissive or confrontational.",
    threat: "This wording may be read as a threat.",
    "self-harm encouragement": "This wording may encourage someone to harm themselves.",
    "negative self-talk": "This wording expresses a negative judgment about yourself.",
    "other negative language": "This wording may be interpreted as negative."
  };
  return explanations[category] || "This wording may be interpreted as harmful.";
}

function renderProtectionPreview(mode, userSelected = false) {
  if (!currentAnalysis) return;

  protectionPreview.dataset.mode = mode;
  previewWithout.hidden = mode !== "without";
  previewWith.hidden = mode !== "with";
  previewWithoutButton.setAttribute("aria-pressed", String(mode === "without"));
  previewWithButton.setAttribute("aria-pressed", String(mode === "with"));
  if (userSelected) setGuidedStep("choose");
}

function showProtectionPreview(text, detectionResult) {
  currentAnalysis = { text, detectionResult };
  previewWithout.replaceChildren(document.createTextNode(text));
  previewWith.replaceChildren();

  if (detectionResult.matches.length) {
    previewWith.appendChild(createProtectedPreview(text, detectionResult.matches));
  } else {
    previewWith.appendChild(document.createTextNode(text));
    const note = document.createElement("span");
    note.className = "preview-no-matches";
    note.textContent = "No changes.";
    previewWith.appendChild(note);
  }

  protectionPreview.hidden = false;
  // Child Mode defaults to the protected view so harmful phrases start hidden.
  renderProtectionPreview(
    isChildModeEnabled() && detectionResult.matches.length ? "with" : "without"
  );
}

async function analyzeText() {
  const text = analyzerInput.value;
  if (!text.trim()) {
    currentAnalysis = null;
    showEmptyState("IDLE");
    setGuidedStep("enter");
    analyzerInput.focus();
    return;
  }

  const requestId = ++analysisRequestId;
  exampleStatus.hidden = true;
  showLoadingState();
  setGuidedStep("analyze");

  try {
    const scanner = window.ProtectionScanner;
    if (!scanner || (
      typeof scanner.analyzeText !== "function" &&
      typeof scanner.analyzeWithRules !== "function"
    )) {
      throw new Error("Analyzer unavailable.");
    }
    const rawResult = typeof scanner.analyzeText === "function"
      ? await scanner.analyzeText(text, "local-ai")
      : scanner.analyzeWithRules(text);
    if (requestId !== analysisRequestId) return;

    const detectionResult = applyChildMode(rawResult);

    setGuidedStep("review");
    if (detectionResult.detected) {
      showDetectedState(text, detectionResult);
    } else {
      showCleanState(detectionResult);
    }
    showProtectionPreview(text, detectionResult);
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    currentAnalysis = null;
    showAnalysisError();
  } finally {
    if (requestId === analysisRequestId) {
      analyzeButton.disabled = false;
      analyzeButton.textContent = "Analyze";
    }
  }
}

function handleInputChange(state = "IDLE", selectedExample = null) {
  analysisRequestId++;
  updateInputCount();
  currentAnalysis = null;
  showEmptyState(state);
  analyzeButton.disabled = false;
  analyzeButton.textContent = "Analyze";
  setGuidedStep(analyzerInput.value.trim() ? "analyze" : "enter");

  document.querySelectorAll("[data-example]").forEach((button) => {
    const selected = button === selectedExample;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (selectedExample) {
    exampleStatus.textContent = "Scenario loaded. Ready to analyze.";
    exampleStatus.hidden = false;
  } else {
    exampleStatus.textContent = "";
    exampleStatus.hidden = true;
  }
}

analyzerInput.addEventListener("input", () => handleInputChange());

analyzerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeText();
});

clearButton.addEventListener("click", () => {
  analyzerInput.value = "";
  handleInputChange("CLEAR");
  analyzerInput.focus();
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    analyzerInput.value = button.dataset.example;
    handleInputChange("IDLE", button);
    analyzeButton.focus();
  });
});

previewWithoutButton.addEventListener("click", () => renderProtectionPreview("without", true));
previewWithButton.addEventListener("click", () => renderProtectionPreview("with", true));

function setHeroPreviewMode(mode) {
  const showOriginal = mode === "original";
  heroPreviewPhrase.textContent = showOriginal ? "idiot" : "unkind person";
  heroPreviewPhrase.classList.toggle("preview-mark", showOriginal);
  heroPreviewPhrase.classList.toggle("preview-alternative-text", !showOriginal);
  heroOriginalButton.setAttribute("aria-pressed", String(showOriginal));
  heroAlternativeButton.setAttribute("aria-pressed", String(!showOriginal));
}

heroOriginalButton.addEventListener("click", () => setHeroPreviewMode("original"));
heroAlternativeButton.addEventListener("click", () => setHeroPreviewMode("alternative"));

function reflectChildModeState() {
  const enabled = isChildModeEnabled();
  document.body.dataset.childMode = String(enabled);
  if (childModeToggle) childModeToggle.setAttribute("aria-checked", String(enabled));
}

if (childModeToggle) {
  // Restore the saved preference, defaulting to OFF so behavior is unchanged
  // unless the user opted in previously.
  childModeToggle.checked = readStoredChildMode();
  reflectChildModeState();

  childModeToggle.addEventListener("change", () => {
    writeStoredChildMode(childModeToggle.checked);
    reflectChildModeState();
    // Re-run analysis live if there is text, so the view reflects the new mode.
    if (analyzerInput.value.trim()) {
      analyzeText();
    }
  });
}

handleInputChange();

const preloadModel = window.ProtectionScanner &&
  window.ProtectionScanner.preloadOllamaModel;
if (typeof preloadModel === "function") {
  // Warm the model in the background so the first submitted analysis is faster.
  preloadModel().catch(() => {
    // Submission displays an actionable error if Ollama is unavailable.
  });
}
