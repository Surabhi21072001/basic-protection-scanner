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
    mark.className = "demo-flag";
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
  resultPlaceholder.hidden = false;
  resultPlaceholder.querySelector("p").textContent = "Choose an example or enter text to see what the scanner notices.";
  resultPreview.hidden = true;
}

function showCleanState() {
  resultTitle.textContent = "No potentially harmful language detected";
  resultBadge.textContent = "Looks constructive";
  resultBadge.className = "result-badge result-badge-safe";
  resultPlaceholder.hidden = false;
  resultPlaceholder.querySelector("p").textContent = "No flagged phrases were found in this message.";
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
    const detail = document.createElement("span");
    detail.className = "detail-chip detail-chip-amber";
    detail.textContent = match.phrase + " · " + match.category + " · " + match.severity;
    resultDetail.appendChild(detail);
  });

  const note = document.createElement("span");
  note.className = "detail-note";
  note.textContent = "Surrounding context remains readable.";
  resultDetail.appendChild(note);
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
    resultPlaceholder.hidden = false;
    resultPlaceholder.querySelector("p").textContent = "The local detector could not be loaded.";
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
