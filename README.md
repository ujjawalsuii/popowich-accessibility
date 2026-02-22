# Team Poppowich — WebAble

Making the web readable, safe, and inclusive for everyone — one tab at a time.  

**Website:** https://ujjawalsuii.github.io/popowich-accessibility/

WebAble adds a multi-feature accessibility layer to any page, including:

1. ASL (Fingerspelling) recognition
2. Live Captions
3. Text-to-Speech (TTS) Chat Reader
4. Epilepsy-safe mode
5. Dyslexia-friendly reading mode
6. Voice personalization commands
7. Colorblind-friendly page mode

---

## Overview

WebAble currently has two major real-time recognition paths:

- **ASL path:** webcam/screen capture → MediaPipe Hands landmarks → local MLP inference in `asl-frame.js` → smoothed letter decisions in `contentScript.js` → word buffer → optional send to TTS Chat Reader.
- **Live Captions path:** microphone speech (Web Speech API) → `SpeechRecognition`/`webkitSpeechRecognition` in `contentScript.js` → subtitle overlay (`#screenshield-subtitles`) in page Shadow DOM.


---


### Exact build/run commands (from `package.json`)

```bash
npm run build:chrome
npm run build:firefox
npm run build
npm run demo
```

### Browser targets (from manifests + build script)

- **Chrome target:** MV3 + service worker background (`build:chrome`, `manifest.chrome.json`).
- **Firefox target:** MV3 + background scripts + `browser_specific_settings.gecko` (`build:firefox`, `manifest.firefox.json`).


---

## Features (code-backed mini-specs)

### 1) ASL (Fingerspelling) recognition — **main focus**

- UI entry point: popup toggle `#asl-toggle` (`aslMode`) injects an ASL panel (`screenshield-asl-host`) from `contentScript.js`.
- Capture sources:
  - default webcam via `getUserMedia({ video: { width:320, height:240, facingMode:'user' } })`
  - optional screen via ASL panel **Screen** button (`getDisplayMedia({ video:true, audio:false })`)
- Landmark extraction: MediaPipe Hands in `src/content/asl-frame.js` (`maxNumHands:1`, `modelComplexity:0`, detection/tracking thresholds 0.5/0.4).
- Preprocessing: first detected hand (21 points) is normalized by wrist translation + palm scale (`wrist→middle MCP`), flattened to **63 features**.
- Model type: local browser-loaded JSON MLP (`src/models/asl_mlp_weights.json`) with dense layers + softmax; current model labels include letters plus `SPACE` and `BKSP`.
- Inference messaging: iframe posts `screenshield-asl-landmarks` and `screenshield-asl-prediction` to parent content script via `postMessage`.
- Postprocessing in content script:
  - prediction smoothing window size = 10
  - confidence threshold = 0.85 (letters), 0.70 (`SPACE`/`BKSP`)
  - hold-to-confirm timing = 1200ms before appending/deleting
- Output routing:
  - letters shown in panel (“Detected” + confidence tooltip)
  - word buffer controls (`Aa` caps, space, backspace, clear)
  - **Send** forwards to TTS Chat Reader via `window.__screenshield_tts` (or local `addChatMessage` fallback)
- Fallback behavior: if model is missing/not ready, content script uses geometric `classifyASL()` heuristics from landmarks.

### 2) Live Captions (microphone STT overlay)

- UI entry point: popup `#subtitle-toggle` (`subtitleMode`) and FAB `fab-subtitles`; state persisted in `storage.sync`.
- Recognition API: `window.SpeechRecognition || window.webkitSpeechRecognition` in `enableSubtitles()`.
- Recognition settings in code:
  - `lang = 'en-US'`
  - `continuous = true`
  - `interimResults = true`
- Input source: browser speech recognition microphone input (no custom audio capture pipeline in extension code).
- Streaming/update behavior:
  - `onresult` processes only last 3 results (explicit anti-buildup comment)
  - merges final + interim transcript for current overlay text
  - marks interim-only lines with `.interim` style
- Rendering:
  - injected Shadow DOM host `#screenshield-subtitles`
  - centered bottom overlay (`.subtitle-text`, large text, translucent background)
  - auto-hide after 4 seconds of silence
- Error/permissions behavior:
  - if `not-allowed`, shows “Please allow microphone access…” then disables subtitles
  - on recognition end, auto-restarts when subtitle mode is still active

### 3) Text-to-Speech (TTS) Chat Reader

- UI entry point: popup toggle `#tts-toggle` (`ttsMode`) injects `screenshield-tts-host` panel.
- Engine: browser `speechSynthesis` + `SpeechSynthesisUtterance` queue.
- Inputs routed into TTS feed:
  - manual panel input (`Speak`)
  - ASL “Send” integration (`window.__screenshield_tts`)
  - context menu “Narrate selected text” from background → content script
  - optional page chat/caption observers (Meet/Teams/Zoom/generic selectors)
- Voice settings present in UI/code:
  - voice dropdown from `speechSynthesis.getVoices()`
  - speed slider (`0.5` to `2.0`, step `0.25`)
  - mute toggle + **Alt+M** shortcut
- Translation behavior: if `ttsLanguage !== 'en'`, text is sent to `translate.googleapis.com` before speaking (best-effort fallback to original text on failure).

### 4) Epilepsy-safe mode

- UI entry point: popup toggle `#seizure-toggle` + sensitivity slider (`1..10`, stored as `sensitivity`).
- Immediate mitigation:
  - global CSS forcing minimal animation/transition durations
  - videos paused; autoplay/loop attributes removed
  - GIFs replaced by click-to-reveal placeholders
- Video detection path:
  - samples visible videos via 64x36 canvas every 100ms
  - computes frame deltas and compares against sensitivity-derived thresholds
- Warning response overlay includes actions:
  - **Show once**
  - **Always allow this site** (adds hostname to allowlist)
  - **Keep blocked**
- Scope is page-level content script behavior on visible DOM media; allowlist bypasses mode on selected hostnames.

### 5) Dyslexia-friendly reading mode

- UI entry point: popup toggle `#dyslexia-toggle` (`dyslexiaMode`).
- Styling changes:
  - OpenDyslexic font face via extension assets
  - fallback chain includes Lexend import and system fallbacks
  - increased line height/letter spacing/word spacing and readability-focused text rules
- Theme behavior:
  - auto-applies dark/light based on `prefers-color-scheme`
  - listens to OS scheme changes while mode is active
- Floating toolbar controls:
  - font size +/-
  - background cycle
  - dark/light toggle
  - close (disables mode)
- Implementation uses a mix of page styles and Shadow DOM control panel.

### 6) Voice personalization commands

- UI entry point: popup **Personalize (Voice)** button sends `start-voice-personalization` message to active tab.
- Recognition path: one Web Speech recognition session in content script (`lang='en-US'`, `interimResults=false`, `maxAlternatives=1`).
- Trigger model: **no wake word** and no continuous background listener; user click starts listening session.
- Intent parsing location: regex-based parsing inside `startVoicePersonalization()` in `contentScript.js`.
- Supported intent groups toggle modes in storage:
  - dyslexia keywords
  - seizure/epilepsy keywords
  - ASL/deaf/hard-of-hearing keywords
  - TTS/speech-impairment keywords
  - subtitles/captions/transcription keywords

### 7) Colorblind-friendly mode

- UI entry point: popup `#color-mode` dropdown (`default`, `deuteranopia`, `protanopia`, `tritanopia`).
- Page application method: sets CSS `filter` directly on `<html>` (`document.documentElement.style.filter`).
- Filter values are pre-defined hue/saturation/contrast transforms (`PAGE_COLOR_MODE_FILTERS`).
- Separate popup/UI palette helper exists in `src/lib/palettes.js` for card/theme CSS variables.
- Allowlist integration: color filter is removed when current hostname is in allowlist.

---

## Getting Started

### Prerequisites

- Node.js + npm
- Chrome and/or Firefox

### Install dependencies

```bash
npm install
```

### Build extension packages

```bash
# Chrome
npm run build:chrome

# Firefox
npm run build:firefox

# Both
npm run build
```

Build artifacts (from `build.js`):

- `dist/chrome/`, `dist/chrome.zip`
- `dist/firefox/`, `dist/firefox.zip`

### Load unpacked

#### Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `dist/chrome`

#### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist/firefox/manifest.json`

---

## Usage (actual UI flow)

### Start

1. Click the WebAble toolbar icon.
2. Toggle required modes in popup cards.
3. Optional: use top-right quick-access FAB on pages for fast toggles.

### ASL (Fingerspelling)

1. Enable **ASL Recognition**.
2. ASL panel appears (bottom-left).
3. Default source is webcam; click **Screen** to switch to display capture picker.
4. Watch detected letter + word buffer update.
5. Use `Aa`/space/backspace/clear controls as needed.
6. Click **Send** to route buffer into TTS Chat Reader.

### Live Captions

1. Enable **Live Subtitles**.
2. Allow microphone access when browser asks.
3. Speak; captions render near bottom-center overlay.
4. Leave enabled for continuous auto-restart behavior; disable toggle to stop.

### TTS Chat Reader

1. Enable **Text to Speech**.
2. Use manual input, ASL Send, or right-click selection narration.
3. Choose voice and speed in panel.
4. Use mute button or **Alt+M**.

### Epilepsy-safe

1. Enable **Epilepsy Safe**.
2. Adjust sensitivity slider.
3. GIF placeholders and flicker warnings appear automatically when triggered.
4. Choose warning action (show once / allow site / keep blocked).

### Dyslexia-friendly

1. Enable **Dyslexia Friendly**.
2. Use floating toolbar for font size, themes, and close.

### Voice personalization

1. Click **Personalize (Voice)**.
2. Speak needs (for example dyslexia, captions, ASL, seizure-safe, TTS intents).
3. Matching modes are turned on automatically.

### Color mode

1. Choose **Color mode** in popup.
2. Page filter applies immediately.

---

## Architecture

```text
┌──────────────────────┐
│ Popup (popup.html/js)│
│ - toggles + settings │
└───────────┬──────────┘
            │ storage.sync
            ▼
┌────────────────────────────┐
│ Content Script             │
│ src/content/contentScript.js
│ - applies modes on pages   │
│ - watches storage changes  │
└───────┬───────────┬────────┘
        │           │
        │           ├──────────────► Live Captions path
        │           │               mic speech (Web Speech API)
        │           │               -> onresult transcript merge
        │           │               -> #screenshield-subtitles overlay
        │
        ▼
┌──────────────────────────────────────┐
│ ASL iframe (asl-frame.html/js)       │
│ - camera/screen capture              │
│ - MediaPipe Hands landmarks          │
│ - normalize 63 features              │
│ - local MLP inference (weights JSON) │
│ - postMessage predictions/landmarks  │
└───────────────┬──────────────────────┘
                │
                ▼
        ASL smoothing + hold-to-confirm
        word buffer -> Send -> TTS feed

┌────────────────────────────┐
│ Background (background.js) │
│ - default settings on install
│ - context menu: narrate selection
└───────────┬────────────────┘
            │ runtime message
            ▼
     Content script narrates via TTS
```

---

## Privacy & Permissions

### Permissions in manifests

- `storage` — save mode settings and allowlist.
- `activeTab`, `tabs` — detect current tab/hostname and route messages.
- `scripting` — extension integration on pages.
- `contextMenus` — “Narrate selected text” action (present in base/chrome manifests; see Firefox note below).

Firefox note (manifest files):

- Committed `manifest.firefox.json` currently lists fewer permissions than `manifest.base.json`; `build.js` merge behavior suggests final generated manifest may differ. Verify packaged `dist/firefox/manifest.json` when shipping.

### What is processed and where

- ASL landmark extraction + MLP inference run locally in extension page/iframe scripts.
- Live Captions recognition runs through the browser Web Speech API implementation (engine behavior is browser-dependent).
- Epilepsy-safe analysis (frame sampling), dyslexia styles, color filters, and overlays run locally in content script.
- Stored data in `storage.sync` is settings/flags (for example `subtitleMode`, `ttsMode`, `allowlist`, sensitivity, language).

### Network calls present in code

- `translate.googleapis.com` for non-English TTS translation path.
- `fonts.googleapis.com` import used in dyslexia font fallback (`Lexend`).

### Media permissions behavior

- ASL webcam mode triggers browser camera permission prompt.
- ASL screen mode triggers browser display-capture picker.
- Live Captions and voice personalization require microphone access through browser speech recognition permission flow.

---

## Known Limitations

- Live Captions requires `SpeechRecognition`/`webkitSpeechRecognition`; if unavailable, subtitle mode cannot run.
- Live Captions language is hard-coded to `en-US` with no language selector in popup.
- Live Captions currently exposes no caption position/size/style settings in UI.
- Live Captions input source is microphone STT only (no OCR, no region extraction pipeline).
- Strict-CSP sites can affect styling paths that rely on injected `<style>` tags (for example Live Subtitles overlay, dyslexia CSS/font injection, seizure CSS, and fallback paths when adoptedStyleSheets is unavailable).
- Flicker detection can fail on videos where frame reads are blocked (caught in `drawImage/getImageData` try/catch).
- ASL is single-hand (`maxNumHands: 1`) and uses hold-to-confirm (`1200ms`), which adds intentional latency.
- ASL training scripts are not fully aligned:
  - `train_asl.py` defaults to excluding `J/Z` unless `--include-jz`
  - `train_asl.py` currently filters to single-letter labels (so `SPACE/BKSP` are skipped there)
  - `train_asl_node.js` supports `SPACE/BKSP` export
- `asl-frame.html` help text says “Space: capture”, but `asl-frame.js` uses **Enter** to capture and Space to set label `SPACE`.

---

## Demo Page

```bash
npm run demo
```

This serves `demo/index.html` on port `8080`.

---

## Team Poppowich

**Team name:** Team Poppowich

**Members:** Abubakar, Rayhan, Omar, Lijo, Ujjawal

---

## License

MIT - License
