# Sensitive Content Detector

Sensitive Content Detector is a Chrome Extension prototype built with Manifest
V3. It has two demonstration surfaces:

- **Interactive Analyzer** — users test a message and review local rule-based
  phrase matches before sending it.
- **Browser Protection** — the extension scans eligible text on the current
  webpage, marks supported phrases, and lets users reveal the original or view
  a prototype alternative.

The project runs locally in the browser. It does not use AI, external APIs, a
backend, accounts, or a database. Its product principle is **Detect →
Understand → Choose**: show what a local rule flagged and let the user decide
what to view.

## Project structure

```text
basic-protection-scanner/
├── manifest.json          # Manifest V3 configuration and content-script setup
├── detector.js            # Local phrase rules, normalization, and matching
├── content.js             # One-time webpage scan and moderation controls
├── flagging.css           # Styling for extension-injected phrase controls
├── popup.html             # Per-tab scan summary markup
├── popup.js               # Reads and displays the active tab's summary
├── test-page.html         # Standalone analyzer and browser-protection demo
├── demo.js                # Analyzer and preview UI behavior
├── demo.css               # Demo page styles
├── tests/
│   └── detector.test.js   # Dependency-free detector regression suite
└── README.md
```

## Architecture and behavior

- **`manifest.json`** loads `detector.js` before `content.js` as Manifest V3
  content scripts and configures the extension popup.
- **`detector.js`** exposes `window.ProtectionScanner.detectHarmfulLanguage()`.
  It applies structured local rules for insults, profanity, hostile language,
  threats, and self-harm encouragement. Matching is case-insensitive,
  Unicode-aware at word boundaries, and deterministic: leftmost matches win,
  longer matches take precedence at the same start, and rule order breaks
  otherwise equal ties. Overlapping detections are removed.
- The detector maps only approved fullwidth ASCII forms to ASCII for matching
  and ignores U+200B, U+2060, and U+FEFF during matching. It does not apply
  general Unicode compatibility normalization or map arbitrary homoglyphs.
  Match phrases and offsets refer to the original JavaScript string
  (UTF-16 indexes), including any removed invisible characters within the
  matched source span.
- **`content.js`** performs one initial scan of eligible visible
  paragraph-like elements. It detects each element's direct text, then inserts
  user controls for matches that fit within a single text node. Matches that
  span nested or multiple text nodes are skipped. Dynamic page changes are not
  observed or rescanned automatically. Normal operation does not log raw page
  text or live DOM elements.
- **`flagging.css`** styles the injected controls. Users can show or hide the
  original phrase or view a local prototype alternative; content is not
  permanently removed.
- **`popup.html` / `popup.js`** show scan totals for the active tab by querying
  that tab's content script. The summary stays in that tab's content-script
  memory and contains counts, not page text. Chrome-restricted pages may not
  allow the content script to run.
- **`test-page.html`, `demo.js`, and `demo.css`** provide a standalone demo.
  The analyzer calls the same local detector, and its Protection Preview uses
  the analyzer's actual matches and offsets. The discussion thread is ordinary
  page markup intended to demonstrate the extension's injected controls when
  the extension is installed and enabled for that page.

The detector returns a DOM-independent result shaped like:

```js
{
  detected: true,
  originalText: "You are such an idiot.",
  matches: [
    {
      phrase: "idiot",
      category: "insult",
      severity: "low",
      startIndex: 16,
      endIndex: 21
    }
  ],
  suggestedRewrite: null
}
```

The current detector does not interpret negation, quotation, reported speech,
sarcasm, intent, or full conversational context. Categories and severity are
rule metadata, not a semantic judgment about the whole message. Safer
alternatives are prototype suggestions, not generated rewrites.

## Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository directory.
4. To test local files, open the extension's **Details** and enable **Allow
   access to file URLs**.
5. Open `test-page.html` in Chrome. The analyzer works as a standalone demo;
   the injected Browser Protection controls require the extension to be loaded
   and permitted to run on the page.

## Run the detector tests

From the repository root, run:

```sh
node --test tests/detector.test.js
```

The dependency-free regression suite covers classification, source casing and
offsets, multiple matches, boundaries, overlap precedence, approved
normalization, and documented contextual limitations.

## Known limitations and possible follow-up work

- Add dynamic-content rescanning if the product requires support for
  single-page applications and infinite-scroll pages.
- Support matches spanning nested inline elements while safely mapping text
  offsets back to DOM nodes.
- Evaluate contextual classification and user-configurable sensitivity only
  as separately scoped future work; neither exists in this prototype.
- The local detector may eventually be replaced behind its public result
  contract, but this repository currently makes no network requests and does
  not include an AI/API implementation.
