/**
 * popup.js
 * ---------
 * Requests the scan summary directly from the active tab's content script.
 *
 * The popup is READ-ONLY in V1: it just shows numbers, it doesn't trigger scans.
 */

// Elements in popup.html we will update.
const statusEl = document.getElementById("status");
const scannedEl = document.getElementById("scanned");
const harmfulEl = document.getElementById("harmful");

/**
 * Paint a clear unavailable state for tabs where content scripts cannot run.
 */
function showUnavailable(message) {
  statusEl.textContent = message;
  scannedEl.textContent = "—";
  harmfulEl.textContent = "—";
}

function loadSummary() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (!activeTab || typeof activeTab.id !== "number") {
      showUnavailable("Scanner unavailable");
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, { type: "bps:get-summary" }, (summary) => {
      if (chrome.runtime.lastError || !summary) {
        showUnavailable("Unavailable on this page");
        return;
      }

      statusEl.textContent = summary.active ? "Scanner active" : "Scanner idle";
      scannedEl.textContent = String(summary.scannedCount || 0);
      harmfulEl.textContent = String(summary.harmfulCount || 0);
    });
  });
}

// Paint as soon as the popup opens.
loadSummary();
