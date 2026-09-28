# Sensitive Content Detector

Sensitive Content Detector is a Chrome Extension prototype built with Manifest
V3. It has two demonstration surfaces:

- **Interactive Analyzer** — users test a message and review local rule-based
  phrase matches before sending it.
- **Browser Protection** — the extension scans eligible text on the current
  webpage, marks supported phrases, and lets users reveal the original or view
  a prototype alternative.

The project uses a local Ollama model for text explicitly submitted through the
Interactive Analyzer. Automatic webpage scanning remains rule-based and does
not send page text to Ollama. It does not use a cloud API, backend, accounts,
or database. Its product principle is **Detect → Understand → Choose**.

## Project structure

```text
basic-protection-scanner/
├── manifest.json          # Manifest V3 configuration and content-script setup
├── detector.js            # Local phrase rules, normalization, and matching
├── ollama.js              # Local AI adapter for explicitly submitted text
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
- **`test-page.html`, `ollama.js`, `demo.js`, and `demo.css`** provide a
  standalone demo. The analyzer sends explicitly submitted text to a local
  `llama3.2:1b` model and validates that returned phrases exist in the original
  message before highlighting them. Its Protection Preview uses the model's
  matches and offsets. The discussion thread is ordinary
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

The rule-based detector used for automatic webpage scanning does not interpret
negation, quotation, reported speech, sarcasm, intent, or full conversational
context. Its categories and severity are rule metadata. The analyzer's Ollama
results are contextual AI suggestions and may still be inaccurate.

## Run the AI analyzer

1. Install [Ollama](https://ollama.com/download).
2. Download the local model:

```sh
ollama pull llama3.2:1b
```

3. Start Ollama if it is not already running:

```sh
ollama serve
```

4. From this repository, serve the demo over localhost:

```sh
python3 -m http.server 8000
```

5. Open [http://localhost:8000/test-page.html](http://localhost:8000/test-page.html).

The browser calls only `http://localhost:11434`; submitted analyzer text stays
on the computer. Opening `test-page.html` directly as a `file://` URL can be
blocked by browser cross-origin rules, so use the local web server above.
The page preloads the model in the background, keeps it loaded for 30 minutes
after each request, and limits generated output to reduce latency.

## Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository directory.
4. To test local files, open the extension's **Details** and enable **Allow
   access to file URLs**.
5. Open `test-page.html` in Chrome. The analyzer works as a standalone demo;
   the injected Browser Protection controls require the extension to be loaded
   and permitted to run on the page.

## Run the tests

Install the test dependency and run the automated suite:

```sh
npm install
npm test
```

The suite covers detector offsets, multiple and repeated matches, boundaries,
normalization, Ollama response validation, DOM control states, scan totals, and
duplicate-marker prevention.

To also test the live local model, make sure Ollama is running and execute:

```sh
npm run test:llm
```

The live capability test is opt-in because it loads the model and takes longer
than the deterministic regression suite.

## Known limitations and possible follow-up work

- Add dynamic-content rescanning if the product requires support for
  single-page applications and infinite-scroll pages.
- Support matches spanning nested inline elements while safely mapping text
  offsets back to DOM nodes.
- The local model can misunderstand context and its classifications and
  replacements should be treated as suggestions.
- Automatic Browser Protection remains rule-based. Only text explicitly
  submitted through the analyzer is sent to the local Ollama service.
