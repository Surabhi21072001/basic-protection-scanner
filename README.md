# Sensitive Content Detector

Sensitive Content Detector is a Chrome Extension prototype built with Manifest
V3. It has two demonstration surfaces:

- **Interactive Analyzer** — users submit a message to a local Ollama model,
  review negative phrases, and see short replacement suggestions.
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
├── package.json           # Test commands and development dependencies
├── tests/
│   ├── detector.test.js           # Rule detector regressions
│   ├── ollama.test.js             # Ollama adapter unit tests
│   ├── ollama.integration.test.js # Optional live-model test
│   ├── content-dom.test.js        # Browser protection DOM tests
│   └── demo.test.js               # Analyzer state and fallback UI tests
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
  `llama3.2:1b` model and validates its schema, category, severity, phrase,
  source offsets, and overlaps before rendering. A validation or connection
  failure falls back to the deterministic detector. Its Protection Preview
  uses whichever engine's validated result is active. The discussion thread is
  ordinary page markup intended to demonstrate the extension's injected
  controls when the extension is installed and enabled for that page.

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
context. Its categories and severity are rule metadata. The Interactive
Analyzer's Ollama results use the same category and severity vocabulary, with
specific local threat and self-harm rules taking precedence over generic AI
categories. The rule fallback applies a narrow first-person versus
second-person self-talk distinction but otherwise retains the detector's
context limitations. AI results may still be inaccurate; if Ollama is
unavailable or returns invalid output, analyzer submissions fall back to local
rules.

## First-time setup

### 1. Open the project folder

Open a terminal in the `basic-protection-scanner` folder. If needed, navigate
to it with:

```sh
cd /path/to/basic-protection-scanner
```

The folder should contain `manifest.json`, `test-page.html`, and `ollama.js`.

### 2. Install and start Ollama

On macOS with Homebrew:

```sh
brew install ollama
brew services start ollama
```

You can also install the app from [ollama.com/download](https://ollama.com/download).

Download the model once:

```sh
ollama pull llama3.2:1b
```

Confirm that it is installed:

```sh
ollama list
```

You should see `llama3.2:1b`. When Ollama is running as a Homebrew service, do
not also run `ollama serve`. An `address already in use` message usually means
Ollama is already running.

### 3. Start the website

From the project folder, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Keep this terminal open while using the website. Pressing `Ctrl+C` stops the
website server.

### 4. Open the correct browser address

Open this exact URL in Chrome:

[http://localhost:8000/test-page.html](http://localhost:8000/test-page.html)

Do not open `test-page.html` directly from Finder, use a `file://` URL, or use
the terminal's IPv6 address such as `http://[::]:8000`. Those addresses can
cause Ollama requests to fail with `Failed to fetch`.

The Interactive Analyzer works without installing the Chrome extension. Text
submitted to the analyzer is sent only to Ollama on this computer.

## Load Browser Protection in Chrome

The extension is needed for the flags that appear directly inside webpage
content.

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. In the file picker, select the entire `basic-protection-scanner` folder.
   Select the folder itself, not `manifest.json` or another individual file.
5. Confirm that **Sensitive Content Detector** appears on the extensions page.
6. Open or refresh
   [http://localhost:8000/test-page.html](http://localhost:8000/test-page.html).

If you later edit extension files, return to `chrome://extensions`, click the
extension's reload button, and refresh the webpage.

## Starting it again later

Ollama and `llama3.2:1b` do not need to be reinstalled or downloaded each time.
Normally, only restart the website server:

```sh
cd /path/to/basic-protection-scanner
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open
[http://localhost:8000/test-page.html](http://localhost:8000/test-page.html).

If the analyzer says `Failed to fetch`, check that the URL uses `localhost`
and verify Ollama with:

```sh
curl http://localhost:11434/api/tags
```

The page preloads the model in the background, keeps it loaded for 30 minutes
after each request, and limits generated output to reduce latency.

## Run the tests

Install the test dependency and run the automated suite:

```sh
npm install
npm test
```

The suite covers detector offsets, multiple and repeated matches, boundaries,
normalization, Ollama response validation, negative-self-talk distinctions,
high-risk category precedence, fallback/error states, DOM control states, scan
totals, and duplicate-marker prevention.

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
