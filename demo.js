/**
 * demo.js
 * -------
 * Standalone analyzer and protection preview for test-page.html.
 * Detection remains in detector.js; this file only orchestrates the demo UI.
 */

const analyzerForm = document.getElementById("analyzer-form");
const analyzerInput = document.getElementById("analyzer-input");
const analyzeButton = document.getElementById("analyze-button");
const clearButton = document.getElementById("clear-button");
const inputCount = document.getElementById("input-count");
const resultTitle = document.getElementById("result-title");
const resultBadge = document.getElementById("result-badge");
const resultPlaceholder = document.getElementById("result-placeholder");
const resultPreview = document.getElementById("result-preview");
const resultText = document.getElementById("result-text");
const resultDetail = document.getElementById("result-detail");
const protectionPreview = document.getElementById("protection-preview");
const previewWithout = document.getElementById("preview-without");
const previewWith = document.getElementById("preview-with");
const previewWithoutButton = document.getElementById("preview-without-button");
const previewWithButton = document.getElementById("preview-with-button");
const guidedSteps = document.querySelectorAll("[data-guided-step]");
let currentAnalysis = null;

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
    label.textContent = "Potentially harmful phrase";
    protectedLabel.append(icon, label);
    fragment.appendChild(protectedLabel);
    cursor = match.endIndex;
  });

  fragment.appendChild(document.createTextNode(text.slice(cursor)));
  return fragment;
}

function setGuidedStep(activeStep) {
  guidedSteps.forEach((step) => {
    if (step.dataset.guidedStep === activeStep) {
      step.setAttribute("aria-current", "step");
    } else {
      step.removeAttribute("aria-current");
    }
  });
}

function showEmptyState() {
  resultTitle.textContent = "Enter text to analyze";
  resultBadge.textContent = "Waiting for input";
  resultBadge.className = "result-badge result-badge-neutral";
  resultPlaceholder.replaceChildren();
  const icon = document.createElement("div");
  icon.className = "result-placeholder-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "↗";
  const message = document.createElement("p");
  message.textContent = "Choose an example or enter text to see what the scanner notices.";
  resultPlaceholder.append(icon, message);
  resultPlaceholder.hidden = false;
  resultPreview.hidden = true;
  protectionPreview.hidden = true;
}

function showCleanState() {
  resultTitle.textContent = "No potentially harmful language detected";
  resultBadge.textContent = "No phrases flagged";
  resultBadge.className = "result-badge result-badge-safe";
  resultPlaceholder.hidden = false;
  resultPlaceholder.replaceChildren();
  const indicator = document.createElement("span");
  indicator.className = "result-positive-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = "✓";
  const message = document.createElement("p");
  message.textContent = "No potentially harmful language was detected in this message.";
  resultPlaceholder.append(indicator, message);
  resultPreview.hidden = true;
}

function showDetectedState(text, detectionResult) {
  resultTitle.textContent = "Potentially harmful phrase detected";
  resultBadge.textContent = detectionResult.matches.length + " match" +
    (detectionResult.matches.length === 1 ? "" : "es");
  resultBadge.className = "result-badge result-badge-warning";
  resultPlaceholder.hidden = true;
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

    const category = document.createElement("span");
    category.className = "result-match-metadata";
    category.textContent = "Category: " + getCategoryLabel(match.category);

    const severity = document.createElement("span");
    severity.className = "result-match-metadata";
    severity.textContent = "Prototype severity: " + getSeverityLabel(match.severity);

    const whyTitle = document.createElement("strong");
    whyTitle.className = "result-match-why-title";
    whyTitle.textContent = "Why was this phrase flagged?";

    const why = document.createElement("span");
    why.className = "result-match-metadata";
    why.textContent = getRuleExplanation(match.category);

    const alternative = document.createElement("span");
    alternative.className = "result-match-alternative";
    alternative.textContent = "Prototype safer alternative: " + getDemoAlternative(match);

    const actions = document.createElement("span");
    actions.className = "result-match-actions";
    actions.textContent = "In Browser Protection, you can show or hide the original, or view the prototype alternative.";

    detail.append(phrase, category, severity, whyTitle, why, alternative, actions);
    resultDetail.appendChild(detail);
  });

  const note = document.createElement("span");
  note.className = "detail-note";
  note.textContent = "Surrounding context remains readable.";
  resultDetail.appendChild(note);
}

function getDemoAlternative(match) {
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
    low: "Low — phrase-level flag",
    medium: "Medium — phrase-level flag",
    high: "High — phrase-level flag"
  };
  return labels[severity] || "Unrated prototype rule";
}

function getRuleExplanation(category) {
  return "This phrase matches a local rule categorized as " +
    getCategoryLabel(category).toLowerCase() + ".";
}

function renderProtectionPreview(mode) {
  if (!currentAnalysis) return;

  protectionPreview.dataset.mode = mode;
  previewWithout.hidden = mode !== "without";
  previewWith.hidden = mode !== "with";
  previewWithoutButton.setAttribute("aria-pressed", String(mode === "without"));
  previewWithButton.setAttribute("aria-pressed", String(mode === "with"));
  if (mode === "with") setGuidedStep("choose");
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
    note.textContent = "No phrases were flagged; the preview is unchanged.";
    previewWith.appendChild(note);
  }

  protectionPreview.hidden = false;
  renderProtectionPreview("without");
}

function analyzeText() {
  const text = analyzerInput.value;
  if (!text.trim()) {
    currentAnalysis = null;
    showEmptyState();
    setGuidedStep("enter");
    analyzerInput.focus();
    return;
  }

  const detect = window.ProtectionScanner &&
    window.ProtectionScanner.detectHarmfulLanguage;
  if (typeof detect !== "function") {
    resultTitle.textContent = "Analyzer unavailable";
    resultBadge.textContent = "Setup error";
    resultBadge.className = "result-badge result-badge-warning";
    resultPlaceholder.replaceChildren();
    const message = document.createElement("p");
    message.textContent = "The local detector could not be loaded.";
    resultPlaceholder.appendChild(message);
    resultPlaceholder.hidden = false;
    resultPreview.hidden = true;
    protectionPreview.hidden = true;
    return;
  }

  const detectionResult = detect(text);
  setGuidedStep("review");
  if (detectionResult.detected) {
    showDetectedState(text, detectionResult);
  } else {
    showCleanState();
  }
  showProtectionPreview(text, detectionResult);
}

function handleInputChange() {
  updateInputCount();
  currentAnalysis = null;
  showEmptyState();
  setGuidedStep(analyzerInput.value.trim() ? "analyze" : "enter");
}

analyzerInput.addEventListener("input", handleInputChange);

analyzerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeText();
});

clearButton.addEventListener("click", () => {
  analyzerInput.value = "";
  handleInputChange();
  analyzerInput.focus();
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    analyzerInput.value = button.dataset.example;
    handleInputChange();
    analyzerInput.focus();
  });
});

previewWithoutButton.addEventListener("click", () => renderProtectionPreview("without"));
previewWithButton.addEventListener("click", () => renderProtectionPreview("with"));

handleInputChange();
