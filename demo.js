/**
 * demo.js
 * -------
 * Page-only analyzer behavior for the Sprint Review prototype.
 * Detection remains in detector.js; this file only orchestrates the UI.
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
  resultTitle.textContent = "Potentially harmful language detected";
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

    const metadata = document.createElement("span");
    metadata.className = "result-match-metadata";
    metadata.textContent = match.category + " · " + match.severity + " severity";

    const alternative = document.createElement("span");
    alternative.className = "result-match-alternative";
    alternative.textContent = "Prototype safer alternative: " + getDemoAlternative(match);

    detail.append(phrase, metadata, alternative);
    resultDetail.appendChild(detail);
  });

  const note = document.createElement("span");
  note.className = "detail-note";
  note.textContent = "Surrounding context remains readable.";
  resultDetail.appendChild(note);
}

function getDemoAlternative(match) {
  if (match.category === "insult") return "a more constructive phrase";
  if (match.category === "hostile language") return "a more respectful response";
  return "a calmer way to express this";
}

function analyzeText() {
  const text = analyzerInput.value;
  if (!text.trim()) {
    showEmptyState();
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
    return;
  }

  const detectionResult = detect(text);
  if (detectionResult.detected) {
    showDetectedState(text, detectionResult);
  } else {
    showCleanState();
  }
}

analyzerInput.addEventListener("input", updateInputCount);

analyzerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeText();
});

clearButton.addEventListener("click", () => {
  analyzerInput.value = "";
  updateInputCount();
  showEmptyState();
  analyzerInput.focus();
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    analyzerInput.value = button.dataset.example;
    updateInputCount();
    analyzerInput.focus();
  });
});

updateInputCount();
