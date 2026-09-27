# Basic Protection Scanner (V1 Prototype)

A minimal Chrome extension (Manifest V3) that scans the visible text on a
webpage and checks it against a simple **local, keyword-based** harmful-language
list. Detected phrases are softly marked and provide local show-original and
safer-version controls. The extension uses **no AI, API, backend, or database**.

---

## Folder structure

```
basic-protection-scanner/
├── manifest.json     # Extension config (MV3): permissions, popup, content scripts
├── detector.js       # The harmful-language detector (keyword list) — the swappable piece
├── content.js        # Scans the page DOM, calls the detector, flags matches
├── flagging.css      # Subtle styling for detected harmful phrases
├── popup.html        # Small popup UI markup + styles
├── popup.js          # Fills the popup with the latest scan numbers
├── test-page.html    # A sample page for testing detection
├── tests/
│   └── detector.test.js # Dependency-free detector regression tests
└── README.md         # This file
```

## What each file does

- **manifest.json** — Declares the extension as Manifest V3. Registers the
  content scripts (`detector.js` then `content.js`, in that order so the
  detector is defined first), and the popup. The popup requests the current
  tab's summary directly from
  its content script, so summaries are not shared between tabs.
- **detector.js** — Holds the sample harmful-language rules (`idiot`, `stupid`,
  `piece of shit`, `fuck`, `shit`, `hate you`, `shut up`, direct threats, and
  `kill yourself`) and the `detectHarmfulLanguage(text)` function. Matching is
  **case-insensitive**, Unicode word-boundary-aware, and returns non-overlapping
  matches with phrase offsets, category, and severity. Overlaps prefer the
  leftmost match and then the longest match at that start. It exposes itself
  via `window.ProtectionScanner`, so a future classifier can replace this file
  without changing the DOM scanner.
- **content.js** — Runs on every page. It selects paragraph-like elements
  (`p, span, div, li, article, section, h1–h6`), skips `script/style/noscript/
  input/textarea` and hidden elements, avoids re-scanning elements (via a
  `data-bps-scanned` marker), reads each element's exact direct text, sends it
  to the detector, adds a `data-bps-flag` marker around safely mappable
  harmful phrases, adds local show-original and safer-version controls, and
  keeps an aggregate summary for the popup. Normal execution does not log
  page text or DOM elements. It does not replace large containers or use
  `innerHTML`.
- **flagging.css** — Provides a subtle highlight and small controls for marked
  phrases. The original text remains in the marker and can be shown again at
  any time; the local safer version is a separate display state.
- **popup.html / popup.js** — Show "Scanner active", the total text blocks
  scanned, and the number of harmful matches by requesting the active tab's
  content script. Restricted pages show an unavailable state.
- **test-page.html** — A ready-made page with a mix of clean and harmful lines
  (and one hidden line that should be ignored) to demonstrate detection.

## Pipeline

```
Webpage DOM
  → content.js scans visible text
  → detector.js checks text
  → result object { detected, originalText, matches, suggestedRewrite }
  → phrase marker with local controls
  → current-tab popup summary (aggregate counts only)
```

---

## How to load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `basic-protection-scanner` folder.
5. The extension should appear in the list and its icon in the toolbar.

## How to test it

Run the detector regression suite from the repository root with Node.js:

```sh
node --test tests/detector.test.js
```

The suite checks rule classifications, multiple-match offsets, case-insensitive
matching, Unicode word boundaries, and overlap precedence. It also documents
current rule-based limitations: negation, quoted phrases, and reported speech
do not change whether a phrase matches. These are expected prototype
behaviors, not contextual NLP tests.

1. Open the included `test-page.html` in Chrome. The easiest way:
   - Drag `test-page.html` into a Chrome tab, **or**
   - Right-click the file → Open With → Chrome.
   > Note: To let the extension run on local `file://` pages, open
   > `chrome://extensions`, click **Details** on the extension, and enable
   > **Allow access to file URLs**. Otherwise just test on any normal website.
2. Click the extension icon to open the **popup**. It shows:
   - "Scanner active"
   - Text blocks scanned
   - Harmful matches found
3. Normal execution does not print matched page text or DOM elements to the
   console. A warning is shown if the detector script is unavailable.

---

## What should be built next

- **Swap the detector**: replace the local keyword rules in `detector.js` with
  an AI/API classifier later (keep the same `detectHarmfulLanguage` contract
  so nothing else changes). The current extension makes no external requests.
- **Rescan dynamic content**: use a `MutationObserver` to catch text added after
  load (infinite scroll, single-page apps).
- **More complete inline scanning**: use a text-node mapping to detect phrases
  split across nested inline elements.
- **Options page**: let users edit the word list and severity levels.
- **Better matching**: word-boundary matching to reduce false positives (e.g.
  avoid matching inside unrelated words).
```
