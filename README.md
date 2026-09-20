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
└── README.md         # This file
```

## What each file does

- **manifest.json** — Declares the extension as Manifest V3. Registers the
  content scripts (`detector.js` then `content.js`, in that order so the
  detector is defined first), the popup, and the `storage` + `activeTab`
  permissions.
- **detector.js** — Holds the sample harmful-language rules (`idiot`, `stupid`,
  `hate you`, `shut up`, ...) and the `detectHarmfulLanguage(text)` function.
  Matching is **case-insensitive**, word-boundary-aware, and returns all
  matches with phrase offsets, category, and severity. It exposes itself via
  `window.ProtectionScanner`, so a future AI/API classifier can replace this
  file without changing the DOM scanner.
- **content.js** — Runs on every page. It selects paragraph-like elements
  (`p, span, div, li, article, section, h1–h6`), skips `script/style/noscript/
  input/textarea` and hidden elements, avoids re-scanning elements (via a
  `data-bps-scanned` marker), reads each element's exact direct text, sends it
  to the detector, adds a `data-bps-flag` marker around safely mappable
  harmful phrases, logs matches to the console, and saves a summary for the
  popup. It does not replace large containers or use `innerHTML`.
- **flagging.css** — Provides a subtle highlight and small controls for marked
  phrases. The original text remains in the marker and can be shown again at
  any time; the local safer version is a separate display state.
- **popup.html / popup.js** — Show "Scanner active", the total text blocks
  scanned, and the number of harmful matches (read from `chrome.storage.local`).
- **test-page.html** — A ready-made page with a mix of clean and harmful lines
  (and one hidden line that should be ignored) to demonstrate detection.

## Pipeline

```
Webpage DOM
  → content.js scans visible text
  → detector.js checks text
  → result object { detected, originalText, matches, suggestedRewrite }
  → console log + popup summary
```

---

## How to load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `basic-protection-scanner` folder.
5. The extension should appear in the list and its icon in the toolbar.

## How to test it

1. Open the included `test-page.html` in Chrome. The easiest way:
   - Drag `test-page.html` into a Chrome tab, **or**
   - Right-click the file → Open With → Chrome.
   > Note: To let the extension run on local `file://` pages, open
   > `chrome://extensions`, click **Details** on the extension, and enable
   > **Allow access to file URLs**. Otherwise just test on any normal website.
2. Open DevTools (`Cmd+Option+I` on macOS / `F12`) and click the **Console** tab.
3. You should see output like:

   ```
   [Basic Protection Scanner]
   Harmful language detected:
     Element: <p>
     Matched phrase: “idiot”
     Text: “You are such an idiot.”
   ...
   [Basic Protection Scanner]
   Scanned elements: 7
   Harmful matches: 4
   ```

4. Click the extension icon to open the **popup**. It shows:
   - "Scanner active"
   - Text blocks scanned
   - Harmful matches found

---

## What should be built next

- **Swap the detector**: replace the keyword list in `detector.js` with an
  AI/API classifier (keep the same `detectHarmfulLanguage` contract so nothing
  else changes).
- **Rescan dynamic content**: use a `MutationObserver` to catch text added after
  load (infinite scroll, single-page apps).
- **Per-tab counts**: track summaries per tab instead of one global summary.
- **On-page action (V2)**: blur or replace harmful text, with a user toggle.
- **Options page**: let users edit the word list and severity levels.
- **Better matching**: word-boundary matching to reduce false positives (e.g.
  avoid matching inside unrelated words).
```
