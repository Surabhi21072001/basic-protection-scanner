/**
 * popup.js
 * ---------
 * Reads the latest scan summary that content.js saved into chrome.storage.local
 * and displays it in the popup.
 *
 * The popup is READ-ONLY in V1: it just shows numbers, it doesn't trigger scans.
 */

// Elements in popup.html we will update.
const statusEl = document.getElementById("status");
const scannedEl = document.getElementById("scanned");
const harmfulEl = document.getElementById("harmful");

/**
 * Load the summary object from storage and paint it into the popup.
 */
function loadSummary() {
  chrome.storage.local.get("bpsSummary", (data) => {
    const summary = data && data.bpsSummary;

    if (!summary) {
      // No scan has run yet (e.g. a page where content scripts can't inject).
      statusEl.textContent = "Scanner active (no data yet)";
      scannedEl.textContent = "0";
      harmfulEl.textContent = "0";
      return;
    }

    statusEl.textContent = summary.active ? "Scanner active" : "Scanner idle";
    scannedEl.textContent = String(summary.scannedCount || 0);
    harmfulEl.textContent = String(summary.harmfulCount || 0);
  });
}

// Paint as soon as the popup opens.
loadSummary();
