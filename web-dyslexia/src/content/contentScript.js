/**
 * ScreenShield content script.
 *
 * Key design notes:
 *
 * SHADOW DOM STYLING ΓÇö We use adoptedStyleSheets (CSSStyleSheet API) instead
 * of innerHTML <style> tags for ALL Shadow DOM elements. Many sites (Tenor,
 * Giphy, social media) include a Content-Security-Policy with `style-src 'self'`
 * which blocks inline <style> tags injected by content scripts ΓÇö even inside
 * Shadow DOM. The CSSStyleSheet API is a JavaScript call and is NOT subject to
 * `style-src` CSP. Helper: createShadowStyles(shadow, css).
 *
 * GIF PLACEHOLDER ΓÇö We do NOT copy img.className to the host div. React/Vue
 * sites attach CSS classes to <img> elements like `opacity-0`, `lazy-load`,
 * or `hidden` which, if inherited by the host div, would hide or break the
 * placeholder. We store the original className in a data attribute and restore
 * it only to the <img> on reveal. Replacement uses host.replaceWith() which
 * is simpler and more reliable than parentNode.replaceChild on virtual-DOM sites.
 *
 * AUTO DARK MODE ΓÇö On enable, we read the OS color scheme preference via
 * matchMedia. We also register a change listener so toggling OS dark mode
 * while the extension is active updates the page in real-time.
 */

// ΓöÇΓöÇ 1. State ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const SS_DYSLEXIA_CSS_ID = 'screenshield-dyslexia-css';
const SS_DYSLEXIA_FONT_ID = 'screenshield-dyslexia-font';
const SS_DYSLEXIA_HOST_ID = 'screenshield-dyslexia-host';
const SS_SEIZURE_CSS_ID = 'screenshield-seizure-css';

/** CSS filter values applied to the whole page for color-blindness-friendly viewing. */
const PAGE_COLOR_MODE_FILTERS = {
  default: 'none',
  deuteranopia: 'hue-rotate(-20deg) saturate(1.25) contrast(1.05)',
  protanopia: 'hue-rotate(-15deg) saturate(1.2) contrast(1.05)',
  tritanopia: 'hue-rotate(15deg) saturate(1.2) contrast(1.05)',
};

let settings = {
  dyslexiaMode: false,
  seizureSafeMode: false,
  ttsMode: false,
  ttsLanguage: 'en',
  aslMode: false,
  subtitleMode: false,
  sensitivity: 5,
  colorMode: 'default',
  allowlist: []
};

const monitoredVideos = new WeakSet();
let videoIntersectionObserver = null;
let domMutationObserver = null;

/** Mirror of the panel's current dark-mode state so the matchMedia listener
 *  can update both the theme and the panel button emoji together. */
let panelIsDark = false;

// ΓöÇΓöÇ 2. Init ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

async function init() {
  try {
    const stored = await browser.storage.sync.get(Object.keys(settings));
    settings = { ...settings, ...stored };
  } catch {
    return;
  }
  applyPageColorMode();
  if (isAllowlisted()) return;
  if (settings.dyslexiaMode) enableDyslexiaMode();
  if (settings.seizureSafeMode) enableSeizureSafeMode();
  if (settings.ttsMode) enableTTS();
  if (settings.aslMode) enableASL();
  if (settings.subtitleMode) enableSubtitles();
}

function isAllowlisted() {
  const host = window.location.hostname;
  return Array.isArray(settings.allowlist) && settings.allowlist.includes(host);
}

// ΓöÇΓöÇ 3. Storage listener ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }

  if (changes.allowlist && isAllowlisted()) {
    disableDyslexiaMode();
    disableSeizureSafeMode();
    disablePageColorMode();
    return;
  }
  if (changes.allowlist && !isAllowlisted()) {
    if (settings.dyslexiaMode) enableDyslexiaMode();
    if (settings.seizureSafeMode) enableSeizureSafeMode();
    return;
  }
  if (isAllowlisted()) return;

  if (changes.dyslexiaMode) {
    settings.dyslexiaMode ? enableDyslexiaMode() : disableDyslexiaMode();
  }
  if (changes.seizureSafeMode) {
    settings.seizureSafeMode ? enableSeizureSafeMode() : disableSeizureSafeMode();
  }
  if (changes.ttsMode) {
    settings.ttsMode ? enableTTS() : disableTTS();
  }
  if (changes.ttsLanguage) {
    settings.ttsLanguage = changes.ttsLanguage.newValue || 'en';
  }
  if (changes.aslMode) {
    settings.aslMode ? enableASL() : disableASL();
  }
  if (changes.subtitleMode) {
    settings.subtitleMode ? enableSubtitles() : disableSubtitles();
  }
});

// ΓöÇΓöÇ Page-wide color mode (color-blindness-friendly) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Applies a CSS filter to the entire page. We set filter on document.documentElement
// (the <html> element) directly so it works even on sites with strict CSP that block
// injected <style> tags.

function applyPageColorMode() {
  if (isAllowlisted()) {
    disablePageColorMode();
    return;
  }
  const mode = settings.colorMode || 'default';
  const filter = PAGE_COLOR_MODE_FILTERS[mode] || PAGE_COLOR_MODE_FILTERS.default;

  if (filter === 'none' || filter == null) {
    document.documentElement.style.removeProperty('filter');
    return;
  }

  document.documentElement.style.setProperty('filter', filter, 'important');
}

function disablePageColorMode() {
  document.documentElement.style.removeProperty('filter');
}

// ΓöÇΓöÇ Context menu "Narrate" handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === 'narrate-selection' && msg.text) {
    let text = msg.text.trim();
    if (!text) return;
    // Translate if needed
    text = await translateText(text);
    if (settings.ttsMode && ttsFeedEl) {
      addChatMessage('Narrate', text);
    } else {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = ttsRate;
      utterance.lang = settings.ttsLanguage;
      if (ttsVoice) utterance.voice = ttsVoice;
      speechSynthesis.speak(utterance);
    }
  }
});

// ΓöÇΓöÇ Shared Shadow DOM helper ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Apply CSS to a Shadow Root using the CSSStyleSheet API.
 * This bypasses page CSP `style-src` directives which would block <style> tags.
 * Falls back to a <style> element on browsers where the API is unavailable.
 */
function createShadowStyles(shadow, css) {
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in shadow) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
      return;
    }
  } catch {
    // fall through
  }
  // Fallback: <style> element (may be blocked by strict page CSP)
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
}

// ΓöÇΓöÇ 4. Dyslexia mode ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function enableDyslexiaMode() {
  injectDyslexiaFont();
  injectDyslexiaCSS();
  // Auto-detect OS preference and apply the matching theme
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyReadingTheme(prefersDark);
  panelIsDark = prefersDark;
  injectDyslexiaPanel(prefersDark);
}

function disableDyslexiaMode() {
  document.getElementById(SS_DYSLEXIA_CSS_ID)?.remove();
  document.getElementById(SS_DYSLEXIA_HOST_ID)?.remove();
  document.documentElement.style.removeProperty('font-size');
  document.body?.style.removeProperty('background-color');
  document.body?.style.removeProperty('color');
}

/**
 * Apply a dark or light reading theme to the page's CSS variables and body.
 * Called on enable and whenever the OS color scheme changes.
 */
function applyReadingTheme(dark) {
  const BG = dark ? '#1a1a2e' : '#fdf9f0';
  const TEXT = dark ? '#e8e8f0' : '#1a1a2e';
  const root = document.documentElement;
  root.style.setProperty('--ss-bg', BG);
  root.style.setProperty('--ss-text', TEXT);
  document.body?.style.setProperty('background-color', BG, 'important');
  document.body?.style.setProperty('color', TEXT, 'important');
}

// Listen for OS dark/light mode changes while the extension is active
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if (!settings.dyslexiaMode || isAllowlisted()) return;
  panelIsDark = e.matches;
  applyReadingTheme(e.matches);
  // Sync the panel button emoji
  const panelHost = document.getElementById(SS_DYSLEXIA_HOST_ID);
  if (panelHost?.shadowRoot) {
    const btn = panelHost.shadowRoot.getElementById('dark-mode');
    if (btn) btn.textContent = e.matches ? '\u2600\uFE0F' : '\uD83C\uDF19';
  }
});

/**
 * Injects OpenDyslexic via the extension's own URL (declared in
 * web_accessible_resources so the extension URL is loadable by page CSS).
 *
 * Font fallback chain:
 *   OpenDyslexic (bundled .otf)  ΓåÆ  Lexend (Google Fonts CDN)
 *   ΓåÆ  Comic Sans MS (system, well-rated for dyslexia)  ΓåÆ  Verdana
 *
 * NOTE: Place these files in src/assets/fonts/ then run `npm run build`:
 *   OpenDyslexic-Regular.otf
 *   OpenDyslexic-Bold.otf
 *
 * If the files are absent the browser silently falls back to Lexend/Comic Sans.
 * On pages with a strict font-src CSP, the CDN fallback is also blocked ΓÇö
 * only Comic Sans MS / Verdana will be used on those pages.
 */
function injectDyslexiaFont() {
  if (document.getElementById(SS_DYSLEXIA_FONT_ID)) return;

  const regularUrl = browser.runtime.getURL('assets/fonts/OpenDyslexic-Regular.otf');
  const boldUrl = browser.runtime.getURL('assets/fonts/OpenDyslexic-Bold.otf');

  const style = document.createElement('style');
  style.id = SS_DYSLEXIA_FONT_ID;
  // Embed the @import for Lexend inside the same style tag ΓÇö keeps both font
  // declarations in one injection and avoids a separate <link> element.
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap');

    @font-face {
      font-family: 'OpenDyslexic';
      src: url('${regularUrl}') format('opentype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'OpenDyslexic';
      src: url('${boldUrl}') format('opentype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function injectDyslexiaCSS() {
  if (document.getElementById(SS_DYSLEXIA_CSS_ID)) return;

  const style = document.createElement('style');
  style.id = SS_DYSLEXIA_CSS_ID;
  style.textContent = `
    :root {
      --ss-font: 'OpenDyslexic', 'Lexend', 'Comic Sans MS', 'Comic Sans', Verdana, sans-serif;
      --ss-lh:   1.9;
      --ss-ls:   0.06em;
      --ss-ws:   0.25em;
      --ss-bg:   #fdf9f0;
      --ss-text: #1a1a2e;
    }

    body,
    p, li, td, th, dt, dd, blockquote,
    div, article, section, main, aside, nav,
    span, a, label, button {
      font-family:    var(--ss-font) !important;
      line-height:    var(--ss-lh)   !important;
      letter-spacing: var(--ss-ls)   !important;
      word-spacing:   var(--ss-ws)   !important;
      text-align:     left           !important;
      font-style:     normal         !important;
    }

    body {
      background-color: var(--ss-bg)   !important;
      color:            var(--ss-text) !important;
      font-size:        1.08rem        !important;
    }

    p, li, blockquote, dt, dd { max-width: 68ch !important; }

    h1, h2, h3, h4, h5, h6 {
      font-family:    var(--ss-font) !important;
      letter-spacing: 0.02em         !important;
      word-spacing:   0.12em         !important;
      line-height:    1.4            !important;
      font-style:     normal         !important;
    }

    em, i, cite, dfn {
      font-style:  normal !important;
      font-weight: 700    !important;
    }

    *:focus {
      outline: 3px solid #4a90d9 !important;
      outline-offset: 2px        !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * Floating control panel ΓÇö top-right corner.
 * @param {boolean} darkInitial  ΓÇö whether to start in dark or light mode
 */
function injectDyslexiaPanel(darkInitial) {
  if (document.getElementById(SS_DYSLEXIA_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = SS_DYSLEXIA_HOST_ID;
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });

  // Build DOM programmatically (no innerHTML) so there is nothing for CSP to block
  const panel = document.createElement('div');
  panel.setAttribute('role', 'toolbar');
  panel.setAttribute('aria-label', 'Dyslexia Friendly controls');

  function makeBtn(id, title, ariaLabel, text) {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', ariaLabel);
    b.textContent = text;
    return b;
  }
  function makeSep() {
    const s = document.createElement('span');
    s.className = 'sep';
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '\uD83D\uDCD6 Dyslexia Friendly'; // ≡ƒôû

  const fontDec = makeBtn('font-dec', 'Smaller text', 'Decrease font size', 'A\u2212');
  const fontInc = makeBtn('font-inc', 'Larger text', 'Increase font size', 'A+');
  const bgBtn = makeBtn('bg-cycle', 'Cycle colour theme', 'Cycle background', '\uD83C\uDFA8'); // ≡ƒÄ¿
  const darkBtn = makeBtn('dark-mode', 'Toggle dark mode', 'Toggle dark mode', darkInitial ? '\u2600\uFE0F' : '\uD83C\uDF19'); // ΓÿÇ∩╕Å or ≡ƒîÖ
  const closeBtn = makeBtn('close', 'Turn off Dyslexia Friendly', 'Close', '\u2715');
  closeBtn.className = 'btn-close';

  panel.append(label, makeSep(), fontDec, fontInc, makeSep(), bgBtn, darkBtn, makeSep(), closeBtn);
  shadow.appendChild(panel);

  createShadowStyles(shadow, `
    :host { all: initial; }
    [role="toolbar"] {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 5px;
      background: #1a1a2e;
      color: #e8e8f0;
      padding: 7px 12px;
      border-radius: 0 0 0 14px;
      box-shadow: -2px 2px 14px rgba(0,0,0,0.55);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 13px;
      user-select: none;
    }
    .label {
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.05em;
      color: #4a90d9;
      margin-right: 4px;
      white-space: nowrap;
      text-transform: uppercase;
    }
    button {
      background: #2d2d4a;
      border: 1px solid #4a90d9;
      color: #e8e8f0;
      border-radius: 5px;
      padding: 4px 9px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.4;
      font-family: Arial, Helvetica, sans-serif;
      transition: background 0.15s;
      white-space: nowrap;
      display: inline-block;
    }
    button:hover         { background: #3d3d5c; }
    button:focus-visible { outline: 2px solid #4a90d9; outline-offset: 2px; }
    .btn-close { border-color: #555; margin-left: 3px; }
    .sep {
      display: inline-block;
      width: 1px;
      height: 16px;
      background: #3d3d5c;
      flex-shrink: 0;
    }
  `);

  // ΓöÇΓöÇ Panel logic ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  let fontScale = 1.0;
  const root = document.documentElement;

  const LIGHT_BGS = [
    { bg: '#fdf9f0', text: '#1a1a2e' }, // warm cream
    { bg: '#f0f7ff', text: '#1a1a2e' }, // cool blue-white
    { bg: '#fff8f0', text: '#1a1a2e' }, // peach
    { bg: '#fffde7', text: '#1a1a2e' }, // warm yellow
  ];
  const DARK_BGS = [
    { bg: '#1a1a2e', text: '#e8e8f0' }, // dark navy
    { bg: '#0d1117', text: '#cdd5e0' }, // very dark
    { bg: '#0f1a14', text: '#d4ede0' }, // dark teal
    { bg: '#1a1a1a', text: '#f5f5dc' }, // near-black + beige text
  ];

  let isDark = darkInitial;
  let bgIndex = 0;

  function applyOption(opt) {
    root.style.setProperty('--ss-bg', opt.bg);
    root.style.setProperty('--ss-text', opt.text);
    document.body?.style.setProperty('background-color', opt.bg, 'important');
    document.body?.style.setProperty('color', opt.text, 'important');
  }

  bgBtn.addEventListener('click', () => {
    const palette = isDark ? DARK_BGS : LIGHT_BGS;
    bgIndex = (bgIndex + 1) % palette.length;
    applyOption(palette[bgIndex]);
  });

  darkBtn.addEventListener('click', () => {
    isDark = !isDark;
    bgIndex = 0;
    panelIsDark = isDark;
    darkBtn.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    applyOption(isDark ? DARK_BGS[0] : LIGHT_BGS[0]);
  });

  fontInc.addEventListener('click', () => {
    fontScale = Math.min(2.0, parseFloat((fontScale + 0.1).toFixed(1)));
    root.style.fontSize = (fontScale * 16) + 'px';
  });
  fontDec.addEventListener('click', () => {
    fontScale = Math.max(0.7, parseFloat((fontScale - 0.1).toFixed(1)));
    root.style.fontSize = (fontScale * 16) + 'px';
  });
  closeBtn.addEventListener('click', () => {
    browser.storage.sync.set({ dyslexiaMode: false });
  });

  document.documentElement.appendChild(host);
}

// ΓöÇΓöÇ 5. Seizure-safe mode ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function enableSeizureSafeMode() {
  injectSeizureCSS();
  processVideos([...document.querySelectorAll('video')]);
  processGIFs([...document.querySelectorAll('img')]);
  setupMutationObserver();
  setupIntersectionObserver();
}

function disableSeizureSafeMode() {
  document.getElementById(SS_SEIZURE_CSS_ID)?.remove();
  document.querySelectorAll('[data-ss-warning]').forEach(el => el.remove());

  videoIntersectionObserver?.disconnect();
  videoIntersectionObserver = null;
  domMutationObserver?.disconnect();
  domMutationObserver = null;

  document.querySelectorAll('video[data-ss-monitoring]').forEach(v => stopFlickerDetection(v));

  // Restore GIF placeholders (host divs with data-ss-gif-src)
  document.querySelectorAll('[data-ss-gif-src]').forEach(placeholder => {
    const img = document.createElement('img');
    img.src = placeholder.dataset.ssGifSrc;
    img.alt = placeholder.dataset.ssGifAlt || '';
    // Restore original class list to the <img>, not whatever the div had
    if (placeholder.dataset.ssGifClass) img.className = placeholder.dataset.ssGifClass;
    if (placeholder.dataset.ssGifWidth) img.width = placeholder.dataset.ssGifWidth;
    if (placeholder.dataset.ssGifHeight) img.height = placeholder.dataset.ssGifHeight;
    try { placeholder.replaceWith(img); } catch { placeholder.parentNode?.replaceChild(img, placeholder); }
  });
}

function injectSeizureCSS() {
  if (document.getElementById(SS_SEIZURE_CSS_ID)) return;
  const style = document.createElement('style');
  style.id = SS_SEIZURE_CSS_ID;
  style.textContent = `
    *, *::before, *::after {
      animation-duration:        0.001ms !important;
      animation-iteration-count: 1       !important;
      transition-duration:       0.001ms !important;
      scroll-behavior:           auto    !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// ΓöÇΓöÇ 6. Video / GIF processing ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function processVideos(videos) {
  if (!settings.seizureSafeMode) return;
  videos.forEach(video => {
    video.autoplay = false;
    video.loop = false;
    video.removeAttribute('autoplay');
    video.removeAttribute('loop');
    if (!video.paused) {
      video.pause();
      video.dataset.ssPausedByUs = 'true';
    }
    videoIntersectionObserver?.observe(video);
  });
}

function processGIFs(imgs) {
  if (!settings.seizureSafeMode) return;
  imgs.forEach(img => {
    if (!img.src) return;
    if (!/\.gif(\?|#|$)/i.test(img.src)) return;
    // Skip elements we already replaced (the host div carries data-ss-gif-src)
    if (img.dataset.ssGifSrc) return;
    // Skip GIFs the user explicitly revealed ΓÇö the MutationObserver fires when
    // host.replaceWith(restored) inserts the img; without this guard it would
    // immediately be wrapped in a new placeholder, making the overlay reappear.
    if (img.dataset.ssGifAllowed) return;
    const placeholder = createGIFPlaceholder(img);
    try {
      img.replaceWith(placeholder);
    } catch {
      img.parentNode?.replaceChild(placeholder, img);
    }
  });
}

/**
 * GIF placeholder with Shadow DOM.
 *
 * Critical design choices:
 *
 * 1. We do NOT copy img.className to the host div. On React/Vue sites (Tenor,
 *    Giphy) the <img> often carries framework utility classes like `opacity-0`,
 *    `lazy-load`, or `hidden` that would hide the host div or block events.
 *    The original className is stored in data-ss-gif-class and only restored
 *    to the <img> on reveal.
 *
 * 2. Styles use adoptedStyleSheets to bypass page CSP. Many sites enforce
 *    `style-src 'self'` which blocks <style> tags injected by content scripts,
 *    making the button render as unstyled text in Chrome.
 *
 * 3. Replacement uses host.replaceWith() which is reliable on virtual-DOM
 *    sites. We add e.stopPropagation() to prevent the site's own click
 *    handlers (like React's root event delegation) from interfering.
 */
function createGIFPlaceholder(img) {
  const host = document.createElement('div');

  // Store original img attributes for restoration
  host.dataset.ssGifSrc = img.src;
  host.dataset.ssGifAlt = img.alt || '';
  host.dataset.ssGifClass = img.className || '';   // saved but NOT applied to host
  host.dataset.ssGifWidth = img.width || '';
  host.dataset.ssGifHeight = img.height || '';

  const w = Math.max(img.width || img.naturalWidth || 0, 160);
  const h = Math.max(img.height || img.naturalHeight || 0, 96);

  // Only set size/display on the host ΓÇö no class copying from img
  host.style.cssText = `
    display: inline-flex !important;
    min-width: ${w}px !important;
    min-height: ${h}px !important;
    vertical-align: middle !important;
    box-sizing: border-box !important;
  `;

  const shadow = host.attachShadow({ mode: 'open' });

  // Build DOM without innerHTML (no parser-created elements, no CSP issues)
  const card = document.createElement('div');
  card.className = 'card';

  const iconEl = document.createElement('span');
  iconEl.className = 'icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = '\uD83C\uDFAC'; // ≡ƒÄ¼

  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = img.alt ? `"${img.alt}"` : 'Animated image (blocked)';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Show GIF';
  btn.className = 'show-btn';

  card.appendChild(iconEl);
  card.appendChild(labelEl);
  card.appendChild(btn);
  shadow.appendChild(card);

  // Apply styles via adoptedStyleSheets ΓÇö bypasses page CSP style-src
  createShadowStyles(shadow, `
    :host {
      display: inline-flex !important;
    }
    .card {
      min-width: ${w}px;
      min-height: ${h}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #1a1a2e;
      border: 2px dashed #4a90d9;
      border-radius: 8px;
      padding: 16px 14px;
      box-sizing: border-box;
      font-family: Arial, Helvetica, sans-serif;
      text-align: center;
    }
    .icon  { font-size: 22px; line-height: 1; display: block; }
    .label {
      color: #8888aa;
      font-size: 11px;
      line-height: 1.35;
      max-width: 150px;
      display: block;
    }
    .show-btn {
      background: #4a90d9;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 8px 22px;
      font-size: 13px;
      font-weight: 700;
      font-family: Arial, Helvetica, sans-serif;
      cursor: pointer;
      margin-top: 4px;
      display: inline-block;
      line-height: 1.4;
    }
    .show-btn:hover        { background: #357abd; }
    .show-btn:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
  `);

  btn.addEventListener('click', e => {
    // Stop the event bubbling to the page so React/Vue root event handlers
    // cannot cancel or interfere with our DOM replacement.
    e.stopPropagation();
    e.preventDefault();

    const restored = document.createElement('img');
    restored.src = host.dataset.ssGifSrc;
    restored.alt = host.dataset.ssGifAlt;
    restored.className = host.dataset.ssGifClass;  // restore ORIGINAL img class
    if (host.dataset.ssGifWidth) restored.width = host.dataset.ssGifWidth;
    if (host.dataset.ssGifHeight) restored.height = host.dataset.ssGifHeight;

    // Flag BEFORE insertion so the MutationObserver callback (which fires
    // synchronously in some browsers) sees it and skips re-blocking this img.
    restored.dataset.ssGifAllowed = 'true';

    // host.replaceWith() is the most reliable method across virtual-DOM sites
    try {
      host.replaceWith(restored);
    } catch {
      try { host.parentNode.replaceChild(restored, host); } catch {
        // Last resort: insert after then self-remove
        host.insertAdjacentElement('afterend', restored);
        host.remove();
      }
    }
  });

  return host;
}

// ΓöÇΓöÇ Observers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function setupMutationObserver() {
  if (domMutationObserver) return;
  domMutationObserver = new MutationObserver(mutations => {
    const newVideos = [];
    const newImgs = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === 'VIDEO') newVideos.push(node);
        else if (node.tagName === 'IMG') newImgs.push(node);
        node.querySelectorAll?.('video').forEach(v => newVideos.push(v));
        node.querySelectorAll?.('img').forEach(i => newImgs.push(i));
      }
    }
    if (newVideos.length) processVideos(newVideos);
    if (newImgs.length) processGIFs(newImgs);
  });
  domMutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
}

function setupIntersectionObserver() {
  if (videoIntersectionObserver) return;
  videoIntersectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting) {
        if (!monitoredVideos.has(video)) {
          monitoredVideos.add(video);
          startFlickerDetection(video);
        }
      } else {
        stopFlickerDetection(video);
        monitoredVideos.delete(video);
      }
    }
  }, { threshold: 0.1 });
  document.querySelectorAll('video').forEach(v => videoIntersectionObserver.observe(v));
}

// ΓöÇΓöÇ 7. Flicker detection ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function getThresholds() {
  const s = Math.max(1, Math.min(10, settings.sensitivity));
  return {
    flickerThreshold: Math.max(2, Math.round(6.5 - s * 0.5)),
    lumaDeltaThreshold: Math.max(10, 60 - s * 5),
    sampleIntervalMs: 100,
    windowSize: 10
  };
}

function sampleFrame(ctx) {
  const data = ctx.getImageData(0, 0, 64, 36).data;
  const count = 64 * 36;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  r /= count; g /= count; b /= count;
  return { r, g, b, luma: 0.299 * r + 0.587 * g + 0.114 * b };
}

function frameDelta(a, b) {
  return Math.max(
    Math.abs(b.luma - a.luma),
    Math.abs(b.r - a.r) * 0.75,
    Math.abs(b.g - a.g) * 0.60,
    Math.abs(b.b - a.b) * 0.65
  );
}

function startFlickerDetection(video) {
  if (video._ssIntervalId) return;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const frameHistory = [];
  let triggered = false;

  video.dataset.ssMonitoring = 'true';
  const { sampleIntervalMs } = getThresholds();

  video._ssIntervalId = setInterval(() => {
    if (triggered) return;
    if (video.paused || video.ended || video.readyState < 2) return;

    const { flickerThreshold, lumaDeltaThreshold, windowSize } = getThresholds();

    try {
      ctx.drawImage(video, 0, 0, 64, 36);
      const frame = sampleFrame(ctx);

      frameHistory.push(frame);
      if (frameHistory.length > windowSize) frameHistory.shift();

      let flickerCount = 0;
      for (let i = 1; i < frameHistory.length; i++) {
        if (frameDelta(frameHistory[i - 1], frameHistory[i]) > lumaDeltaThreshold) {
          flickerCount++;
        }
      }

      if (flickerCount >= flickerThreshold) {
        triggered = true;
        clearInterval(video._ssIntervalId);
        video._ssIntervalId = null;
        delete video.dataset.ssMonitoring;
        video.pause();
        showFlickerWarning(video);
      }
    } catch {
      stopFlickerDetection(video);
    }
  }, sampleIntervalMs);
}

function stopFlickerDetection(video) {
  if (video._ssIntervalId) {
    clearInterval(video._ssIntervalId);
    video._ssIntervalId = null;
  }
  delete video.dataset.ssMonitoring;
}

// ΓöÇΓöÇ 8. Warning card UI ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function showFlickerWarning(video) {
  video._ssWarningHost?.remove();

  const host = document.createElement('div');
  host.setAttribute('data-ss-warning', 'true');

  const syncPosition = () => {
    const r = video.getBoundingClientRect();
    const w = Math.max(r.width, 240);
    const h = Math.max(r.height, 140);
    host.style.cssText = `
      position: fixed;
      top:    ${r.top}px;
      left:   ${r.left}px;
      width:  ${w}px;
      height: ${h}px;
      z-index: 2147483647;
      pointer-events: none;
    `;
  };
  syncPosition();
  const onScroll = () => syncPosition();
  const onResize = () => syncPosition();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  const shadow = host.attachShadow({ mode: 'open' });

  // Build DOM elements
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-labelledby', 'ss-warn-title');
  overlay.setAttribute('aria-describedby', 'ss-warn-desc');

  const iconEl = document.createElement('div');
  iconEl.className = 'icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = '\u26A0\uFE0F'; // ΓÜá∩╕Å

  const titleEl = document.createElement('h3');
  titleEl.id = 'ss-warn-title';
  titleEl.textContent = 'Flashing content detected';

  const descEl = document.createElement('p');
  descEl.id = 'ss-warn-desc';
  descEl.textContent = 'ScreenShield paused this video because it contains rapid brightness or colour changes. Harm reduction only ΓÇö not a medical guarantee.';

  const btns = document.createElement('div');
  btns.className = 'buttons';

  const allowOnce = document.createElement('button');
  const allowSite = document.createElement('button');
  const keepBlock = document.createElement('button');
  allowOnce.type = allowSite.type = keepBlock.type = 'button';
  allowOnce.className = 'allow-once';
  allowSite.className = 'allow-site';
  keepBlock.className = 'keep-blocked';
  allowOnce.textContent = 'Show once';
  allowSite.textContent = 'Always allow this site';
  keepBlock.textContent = 'Keep blocked';

  btns.append(allowOnce, allowSite, keepBlock);
  overlay.append(iconEl, titleEl, descEl, btns);
  shadow.appendChild(overlay);

  createShadowStyles(shadow, `
    :host { all: initial; display: block; }
    .overlay {
      pointer-events: auto;
      width: 100%; height: 100%;
      background: rgba(8, 8, 22, 0.96);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      border-radius: 4px;
      animation: fadeIn 0.4s ease forwards;
      font-family: Arial, Helvetica, sans-serif;
      text-align: center;
      color: #e8e8f0;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .icon  { font-size: 1.8rem; margin-bottom: 8px; line-height: 1; }
    h3     { margin: 0 0 6px; font-size: 0.95rem; font-weight: 700; color: #fff; }
    p      { margin: 0 0 16px; font-size: 0.78rem; color: #9090b8; max-width: 280px; line-height: 1.5; }
    .buttons { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
    button {
      border: none; border-radius: 6px;
      padding: 8px 14px; font-size: 0.82rem; font-weight: 600;
      cursor: pointer; font-family: Arial, Helvetica, sans-serif;
      transition: filter 0.15s; display: inline-block;
    }
    button:hover         { filter: brightness(1.18); }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .allow-once   { background: #4a90d9; color: #fff; }
    .allow-site   { background: #2e7d32; color: #fff; }
    .keep-blocked { background: #2d2d4a; color: #c0c0d8; border: 1px solid #44445a; }
  `);

  const cleanup = () => {
    host.remove();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    video._ssWarningHost = null;
  };

  allowOnce.addEventListener('click', () => { cleanup(); video.play(); });

  allowSite.addEventListener('click', async () => {
    const hostname = window.location.hostname;
    try {
      const { allowlist = [] } = await browser.storage.sync.get('allowlist');
      if (!allowlist.includes(hostname)) {
        await browser.storage.sync.set({ allowlist: [...allowlist, hostname] });
      }
    } catch { /* best-effort */ }
    cleanup();
    video.play();
  });

  keepBlock.addEventListener('click', () => { cleanup(); });

  document.body.appendChild(host);
  video._ssWarningHost = host;
}

// ΓöÇΓöÇ 9. TTS + Chat Reader ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const SS_TTS_HOST_ID = 'screenshield-tts-host';

let ttsQueue = [];
let ttsSpeaking = false;
let ttsMuted = false;
let ttsRate = 1.0;
let ttsVoice = null;   // SpeechSynthesisVoice or null (default)
let chatMessages = [];
let chatObservers = [];
let ttsMsgCount = 0;

/** References into the Shadow DOM for dynamic updates */
let ttsShadow = null;
let ttsFeedEl = null;
let ttsStatusEl = null;
let ttsBadgeEl = null;
let ttsMuteBtnRef = null;

// ΓöÇΓöÇ Enable / Disable ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function enableTTS() {
  if (document.getElementById(SS_TTS_HOST_ID)) return;
  injectChatReaderPanel();
  startChatWatchers();
  startCaptionWatchers();
  document.addEventListener('keydown', ttsKeyHandler);
  // Expose integration API for ASL team
  window.__screenshield_tts = (sender, text) => {
    if (settings.ttsMode) addChatMessage(sender || 'ASL', text);
  };
}

function disableTTS() {
  document.getElementById(SS_TTS_HOST_ID)?.remove();
  stopChatWatchers();
  stopCaptionWatchers();
  speechSynthesis.cancel();
  document.removeEventListener('keydown', ttsKeyHandler);
  delete window.__screenshield_tts;
  ttsQueue = [];
  ttsSpeaking = false;
  chatMessages = [];
  ttsMsgCount = 0;
  ttsShadow = null;
  ttsFeedEl = null;
  ttsStatusEl = null;
  ttsBadgeEl = null;
  ttsMuteBtnRef = null;
}

// ΓöÇΓöÇ Alt+M keyboard shortcut ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function ttsKeyHandler(e) {
  if (e.altKey && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    toggleMute();
  }
}

function toggleMute() {
  ttsMuted = !ttsMuted;
  if (ttsMuteBtnRef) {
    ttsMuteBtnRef.textContent = ttsMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    ttsMuteBtnRef.classList.toggle('muted', ttsMuted);
  }
  if (ttsMuted) speechSynthesis.cancel();
  updateStatus(ttsMuted ? 'Muted' : 'Listening');
}

function updateStatus(text) {
  if (ttsStatusEl) ttsStatusEl.textContent = text;
}

function updateBadge() {
  if (ttsBadgeEl) {
    ttsMsgCount++;
    ttsBadgeEl.textContent = ttsMsgCount;
    ttsBadgeEl.style.display = 'inline-flex';
  }
}

// ΓöÇΓöÇ Chat Reader panel ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function injectChatReaderPanel() {
  const host = document.createElement('div');
  host.id = SS_TTS_HOST_ID;
  host.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });
  ttsShadow = shadow;

  // ΓöÇΓöÇ Panel ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const panel = document.createElement('div');
  panel.className = 'tts-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Chat Reader ΓÇö Text to Speech');

  // ΓöÇΓöÇ Header (draggable) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const header = document.createElement('div');
  header.className = 'tts-header';
  header.style.cursor = 'grab';

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row';

  const titleIcon = document.createElement('span');
  titleIcon.className = 'tts-icon';
  titleIcon.textContent = '\uD83D\uDD0A'; // ≡ƒöè

  const titleText = document.createElement('span');
  titleText.className = 'tts-title';
  titleText.textContent = 'Chat Reader';

  // Status indicator
  const statusEl = document.createElement('span');
  statusEl.className = 'tts-status';
  statusEl.textContent = 'Listening';
  ttsStatusEl = statusEl;

  // Message count badge
  const badge = document.createElement('span');
  badge.className = 'tts-badge';
  badge.textContent = '0';
  badge.style.display = 'none';
  ttsBadgeEl = badge;

  const minimizeBtn = document.createElement('button');
  minimizeBtn.type = 'button';
  minimizeBtn.className = 'tts-btn tts-minimize';
  minimizeBtn.title = 'Minimize';
  minimizeBtn.textContent = '\u2015'; // ΓÇò

  titleRow.append(titleIcon, titleText, statusEl, badge, minimizeBtn);
  header.appendChild(titleRow);

  // ΓöÇΓöÇ Message feed ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const feed = document.createElement('div');
  feed.className = 'tts-feed';
  feed.setAttribute('role', 'log');
  feed.setAttribute('aria-live', 'polite');
  ttsFeedEl = feed;

  const emptyMsg = document.createElement('div');
  emptyMsg.className = 'tts-empty';
  emptyMsg.textContent = 'No messages yet. Type below or chat will appear here.';
  feed.appendChild(emptyMsg);

  // ΓöÇΓöÇ Manual input ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const inputRow = document.createElement('div');
  inputRow.className = 'tts-input-row';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'tts-input';
  textInput.placeholder = 'Type a message to speak...';
  textInput.setAttribute('aria-label', 'Message to speak');

  const speakBtn = document.createElement('button');
  speakBtn.type = 'button';
  speakBtn.className = 'tts-btn tts-speak-btn';
  speakBtn.textContent = 'Speak';

  inputRow.append(textInput, speakBtn);

  // ΓöÇΓöÇ Controls row ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const controls = document.createElement('div');
  controls.className = 'tts-controls';

  // Voice selector
  const voiceSelect = document.createElement('select');
  voiceSelect.className = 'tts-voice-select';
  voiceSelect.setAttribute('aria-label', 'Voice');

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default voice';
  voiceSelect.appendChild(defaultOpt);

  // Populate voices (may load async)
  function populateVoices() {
    const voices = speechSynthesis.getVoices();
    // Clear existing (except default)
    while (voiceSelect.options.length > 1) voiceSelect.remove(1);
    voices.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = v.name.replace(/Microsoft |Google /g, '') +
        (v.lang ? ` (${v.lang})` : '');
      voiceSelect.appendChild(opt);
    });
  }
  populateVoices();
  speechSynthesis.addEventListener('voiceschanged', populateVoices);

  controls.appendChild(voiceSelect);

  // Rate control
  const rateLabel = document.createElement('label');
  rateLabel.className = 'tts-rate-label';
  rateLabel.textContent = 'Speed';

  const rateSlider = document.createElement('input');
  rateSlider.type = 'range';
  rateSlider.className = 'tts-rate-slider';
  rateSlider.min = '0.5';
  rateSlider.max = '2';
  rateSlider.step = '0.25';
  rateSlider.value = String(ttsRate);
  rateSlider.setAttribute('aria-label', 'Speech rate');

  const rateVal = document.createElement('span');
  rateVal.className = 'tts-rate-val';
  rateVal.textContent = '1x';

  // Mute button
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'tts-btn tts-mute-btn';
  muteBtn.title = 'Mute / Unmute (Alt+M)';
  muteBtn.textContent = '\uD83D\uDD0A'; // ≡ƒöè
  ttsMuteBtnRef = muteBtn;

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'tts-btn tts-clear-btn';
  clearBtn.title = 'Clear feed';
  clearBtn.textContent = 'Clear';

  controls.append(rateLabel, rateSlider, rateVal, muteBtn, clearBtn);

  // ΓöÇΓöÇ Assemble ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  panel.append(header, feed, inputRow, controls);
  shadow.appendChild(panel);

  // ΓöÇΓöÇ Styles ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  createShadowStyles(shadow, `
    :host { all: initial; display: block; }
    .tts-panel {
      pointer-events: auto;
      width: 340px;
      max-height: 440px;
      background: #13131f;
      border: 1px solid #a855f7;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(168,85,247,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      color: #e8e8f0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideUp 0.3s ease forwards;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .tts-panel.minimized .tts-feed,
    .tts-panel.minimized .tts-input-row,
    .tts-panel.minimized .tts-controls { display: none; }
    .tts-panel.minimized { max-height: none; }

    /* Header */
    .tts-header {
      padding: 10px 14px;
      border-bottom: 1px solid #2d2d4a;
      flex-shrink: 0;
      user-select: none;
    }
    .tts-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tts-icon { font-size: 15px; }
    .tts-title {
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #a855f7;
    }
    .tts-status {
      flex: 1;
      font-size: 10px;
      color: #5a5a7e;
      text-align: right;
      padding-right: 4px;
      font-weight: 500;
    }
    .tts-status.speaking {
      color: #22c55e;
      animation: pulse 1.5s ease infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.5; }
    }
    .tts-badge {
      background: #a855f7;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
      flex-shrink: 0;
    }

    /* Feed */
    .tts-feed {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      min-height: 80px;
      max-height: 200px;
    }
    .tts-feed::-webkit-scrollbar { width: 4px; }
    .tts-feed::-webkit-scrollbar-track { background: transparent; }
    .tts-feed::-webkit-scrollbar-thumb { background: #3d3d5c; border-radius: 2px; }
    .tts-empty {
      color: #5a5a7e;
      font-size: 11px;
      text-align: center;
      padding: 18px 8px;
      line-height: 1.5;
    }
    .tts-msg {
      padding: 6px 0;
      border-bottom: 1px solid #1e1e35;
      animation: fadeMsg 0.4s ease;
      line-height: 1.45;
    }
    .tts-msg:last-child { border-bottom: none; }
    @keyframes fadeMsg {
      from { opacity: 0; transform: translateX(-6px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .tts-msg-sender {
      font-weight: 600;
      color: #a855f7;
      font-size: 11px;
      margin-right: 4px;
    }
    .tts-msg-sender.asl  { color: #22c55e; }
    .tts-msg-sender.caption { color: #f59e0b; }
    .tts-msg-text {
      color: #d0d0e8;
      font-size: 12px;
    }
    .tts-msg-time {
      display: block;
      font-size: 9px;
      color: #5a5a7e;
      margin-top: 2px;
    }
    .tts-msg.highlight {
      background: rgba(168,85,247,0.08);
      border-radius: 6px;
      padding: 6px 8px;
      margin: 2px -8px;
    }

    /* Input */
    .tts-input-row {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid #2d2d4a;
      flex-shrink: 0;
    }
    .tts-input {
      flex: 1;
      background: #1e1e35;
      border: 1px solid #3d3d5c;
      border-radius: 8px;
      padding: 7px 10px;
      color: #e8e8f0;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .tts-input:focus { border-color: #a855f7; }
    .tts-input::placeholder { color: #5a5a7e; }

    /* Buttons */
    .tts-btn {
      background: #2d2d4a;
      border: 1px solid #3d3d5c;
      color: #e8e8f0;
      border-radius: 6px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      transition: background 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .tts-btn:hover { background: #3d3d5c; }
    .tts-btn:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }
    .tts-speak-btn {
      background: #a855f7;
      border-color: #a855f7;
      color: #fff;
    }
    .tts-speak-btn:hover { background: #9333ea; }
    .tts-minimize { font-size: 14px; padding: 2px 8px; line-height: 1; }
    .tts-mute-btn { font-size: 14px; padding: 4px 8px; }
    .tts-mute-btn.muted {
      background: #7f1d1d;
      border-color: #991b1b;
      color: #fca5a5;
    }

    /* Voice select */
    .tts-voice-select {
      background: #1e1e35;
      border: 1px solid #3d3d5c;
      border-radius: 6px;
      color: #d0d0e8;
      font-size: 10px;
      font-family: inherit;
      padding: 4px 6px;
      max-width: 110px;
      outline: none;
      cursor: pointer;
    }
    .tts-voice-select:focus { border-color: #a855f7; }
    .tts-voice-select option { background: #1e1e35; color: #d0d0e8; }

    /* Controls */
    .tts-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid #2d2d4a;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .tts-rate-label {
      font-size: 10px;
      color: #8888aa;
      font-weight: 500;
      white-space: nowrap;
    }
    .tts-rate-slider {
      flex: 1;
      min-width: 50px;
      appearance: none;
      -webkit-appearance: none;
      height: 3px;
      border-radius: 2px;
      background: #3d3d5c;
      outline: none;
      cursor: pointer;
    }
    .tts-rate-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #a855f7;
      cursor: pointer;
    }
    .tts-rate-slider::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border: none;
      border-radius: 50%;
      background: #a855f7;
      cursor: pointer;
    }
    .tts-rate-val {
      font-size: 11px;
      font-weight: 700;
      color: #a855f7;
      min-width: 28px;
      text-align: center;
    }
  `);

  // ΓöÇΓöÇ Drag to reposition ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;

  header.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return; // let button clicks through
    isDragging = true;
    header.style.cursor = 'grabbing';
    const rect = host.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;
    host.style.left = Math.max(0, Math.min(window.innerWidth - 80, x)) + 'px';
    host.style.top = Math.max(0, Math.min(window.innerHeight - 40, y)) + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'grab';
    }
  });

  // ΓöÇΓöÇ Event handlers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  // Minimize / expand
  minimizeBtn.addEventListener('click', () => {
    const isMin = panel.classList.toggle('minimized');
    minimizeBtn.textContent = isMin ? '+' : '\u2015';
  });

  // Speak manual input
  const handleSpeak = () => {
    const text = textInput.value.trim();
    if (!text) return;
    addChatMessage('You', text);
    textInput.value = '';
    textInput.focus();
  };
  speakBtn.addEventListener('click', handleSpeak);
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleSpeak(); }
  });

  // Voice selector
  voiceSelect.addEventListener('change', () => {
    const voices = speechSynthesis.getVoices();
    const idx = parseInt(voiceSelect.value, 10);
    ttsVoice = isNaN(idx) ? null : voices[idx] || null;
  });

  // Rate slider
  rateSlider.addEventListener('input', () => {
    ttsRate = parseFloat(rateSlider.value);
    rateVal.textContent = ttsRate + 'x';
  });

  // Mute toggle
  muteBtn.addEventListener('click', () => toggleMute());

  // Clear feed
  clearBtn.addEventListener('click', () => {
    chatMessages = [];
    ttsMsgCount = 0;
    feed.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'tts-empty';
    empty.textContent = 'Feed cleared.';
    feed.appendChild(empty);
    if (ttsBadgeEl) { ttsBadgeEl.textContent = '0'; ttsBadgeEl.style.display = 'none'; }
    speechSynthesis.cancel();
    ttsQueue = [];
    updateStatus('Listening');
  });

  document.documentElement.appendChild(host);
}

// ΓöÇΓöÇ Message management ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function addChatMessage(sender, text) {
  if (!ttsFeedEl) return;

  // Remove empty state
  const empty = ttsFeedEl.querySelector('.tts-empty');
  if (empty) empty.remove();

  // Dedup: exact match OR substring match within 3s (handles nested DOM nodes)
  const now = Date.now();
  const recentWindow = 3000;
  for (let i = chatMessages.length - 1; i >= Math.max(0, chatMessages.length - 5); i--) {
    const prev = chatMessages[i];
    if ((now - prev.time) > recentWindow) break;
    // Skip if exact match, substring, or superset of a recent message
    if (prev.text === text) return;
    if (prev.text.includes(text) || text.includes(prev.text)) return;
  }

  const entry = { sender, text, time: now };
  chatMessages.push(entry);
  if (chatMessages.length > 100) chatMessages.shift();

  // Render
  const msgEl = document.createElement('div');
  msgEl.className = 'tts-msg highlight';

  const senderEl = document.createElement('span');
  senderEl.className = 'tts-msg-sender';
  // Color-code by source
  if (sender === 'ASL') senderEl.classList.add('asl');
  if (sender === 'Captions') senderEl.classList.add('caption');
  senderEl.textContent = sender + ':';

  const textEl = document.createElement('span');
  textEl.className = 'tts-msg-text';
  textEl.textContent = ' ' + text;

  const timeEl = document.createElement('span');
  timeEl.className = 'tts-msg-time';
  timeEl.textContent = new Date(now).toLocaleTimeString();

  msgEl.append(senderEl, textEl, timeEl);
  ttsFeedEl.appendChild(msgEl);
  ttsFeedEl.scrollTop = ttsFeedEl.scrollHeight;

  updateBadge();
  setTimeout(() => msgEl.classList.remove('highlight'), 3000);

  if (!ttsMuted) {
    enqueueTTS(`${sender}: ${text}`);
  }
}

// ΓöÇΓöÇ TTS queue ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function enqueueTTS(text) {
  ttsQueue.push(text);
  if (!ttsSpeaking) processNextTTS();
}

async function processNextTTS() {
  if (ttsQueue.length === 0) {
    ttsSpeaking = false;
    updateStatus(ttsMuted ? 'Muted' : 'Listening');
    if (ttsStatusEl) ttsStatusEl.classList.remove('speaking');
    return;
  }
  ttsSpeaking = true;
  updateStatus('Speaking...');
  if (ttsStatusEl) ttsStatusEl.classList.add('speaking');

  let text = ttsQueue.shift();
  // Auto-translate if language isn't English
  text = await translateText(text);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = ttsRate;
  utterance.lang = settings.ttsLanguage;
  if (ttsVoice) utterance.voice = ttsVoice;
  utterance.onend = () => processNextTTS();
  utterance.onerror = () => processNextTTS();
  speechSynthesis.speak(utterance);
}

// ΓöÇΓöÇ Translation helper ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Translates text to the user's chosen language via Google Translate.
 * Returns the original text if language is English or translation fails.
 */
async function translateText(text) {
  const lang = settings.ttsLanguage;
  if (!lang || lang === 'en') return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    // Response format: [[['translated text', 'original', ...]]]                
    const translated = data?.[0]?.map(s => s[0]).join('') || text;
    return translated;
  } catch {
    return text; // Fallback to original on failure
  }
}

// ΓöÇΓöÇ Garbage text filter ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Rejects text that looks like Meet/Teams/Zoom UI elements rather than
 * actual human chat messages or spoken captions.
 */
const GARBAGE_PATTERNS = [
  /Press Down Arrow/i,
  /Turn (on|off) (microphone|camera|captions)/i,
  /ctrl \+/i,
  /keyboard_arrow/i,
  /More options/i,
  /Join now/i,
  /Ready to join/i,
  /Leave call/i,
  /Share screen/i,
  /Raise hand/i,
  /Companion mode/i,
  /Cast this meeting/i,
  /Meeting details/i,
  /Meeting timer/i,
  /Gemini/i,
  /action items/i,
  /Switch account/i,
  /System default/i,
  /Realtek/i,
  /Integrated Camera/i,
  /Test speakers/i,
  /test recording/i,
  /Getting ready/i,
  /Looking for others/i,
  /No one else is here/i,
  /expand_more|expand_less/i,
  /arrow_drop_down/i,
  /front_hand|back_hand/i,
  /visual_effects/i,
  /more_vert/i,
  /mic_none|videocam|call_end|present_to_all/i,
  /domain_disabled/i,
  /frame_person|closed_caption/i,
  /Send a reaction/i,
  /Backgrounds and effects/i,
  /hover tray/i,
  /Hand raises/i,
  /Chat with everyone/i,
  /Meeting tools/i,
  /Call ends soon/i,
  /open to anyone/i,
  /Developing an extension/i,
  /add-ons/i,
  /developers\.google/i,
  /@gmail\.com/i,
  /@[\w.-]+\.[a-z]{2,}/i,  // any email
  /pfd-/i,                  // Meet internal IDs
  /arrow_back/i,
  /In-call messages/i,
  /Send message/i,
  /No chat messages/i,
  /Continuous chat/i,
  /Let participants/i,
  /pin a message/i,
  /won't be saved/i,
  /^\d{1,2}:\d{2}\s*(AM|PM)?$/i,  // standalone timestamps like "7:37 PM"
];

function isGarbageText(text) {
  if (!text) return true;
  if (text.length < 3 || text.length > 500) return true;
  for (const pat of GARBAGE_PATTERNS) {
    if (pat.test(text)) return true;
  }
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 2 && text.length > 20) return true;
  return false;
}

// ΓöÇΓöÇ DOM Chat Watchers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function startChatWatchers() {
  stopChatWatchers();
  const hostname = window.location.hostname;

  // Google Meet ΓÇö watch the whole body, garbage filter handles noise
  if (hostname.includes('meet.google.com')) {
    watchMeetBody();
    return;
  }

  if (hostname.includes('teams.microsoft.com') || hostname.includes('teams.live.com')) {
    watchChat([
      '[role="log"]',
      '[data-tid="message-pane-list-item"]'
    ], parseTeamsMessage);
    return;
  }

  if (hostname.includes('zoom.us') || hostname.includes('zoom.com')) {
    watchChat([
      '[role="log"]',
      '.chat-container'
    ], parseGenericMessage);
    return;
  }

  // Generic ΓÇö only role="log"
  watchChat(['[role="log"]'], parseGenericMessage);
}

/**
 * Meet-specific: observe the entire document body.
 * This is intentionally broad ΓÇö the garbage filter + size checks
 * ensure only real chat text gets through.
 */
function watchMeetBody() {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Skip our own panel
        if (node.closest && node.closest('#' + SS_TTS_HOST_ID)) continue;
        if (node.id === SS_TTS_HOST_ID) continue;

        const text = node.textContent?.trim();
        if (!text || text.length < 3 || text.length > 300) continue;
        if (isGarbageText(text)) continue;

        // Try to extract sender + message from the node
        const parts = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const sender = parts[0];
          const msg = parts[parts.length - 1];
          if (!isGarbageText(sender) && !isGarbageText(msg) && msg.length >= 2) {
            addChatMessage(sender, msg);
            continue;
          }
        }
        // Single-line message
        if (!isGarbageText(text) && text.length >= 3) {
          addChatMessage('Chat', text);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  chatObservers.push(observer);
}

function watchChat(selectors, parseMessageFn) {
  let retries = 0;
  const maxRetries = 10;
  const retryDelay = 3000;

  const tryAttach = () => {
    for (const sel of selectors) {
      const containers = document.querySelectorAll(sel);
      for (const container of containers) {
        if (container.closest('#' + SS_TTS_HOST_ID)) continue;
        if (container.id === SS_TTS_HOST_ID) continue;

        const observer = new MutationObserver(mutations => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              const parsed = parseMessageFn(node);
              if (parsed && !isGarbageText(parsed.text)) {
                addChatMessage(parsed.sender, parsed.text);
              }
            }
          }
        });

        observer.observe(container, { childList: true, subtree: true });
        chatObservers.push(observer);
      }
    }

    if (chatObservers.length === 0 && retries < maxRetries) {
      retries++;
      setTimeout(tryAttach, retryDelay);
    }
  };
  tryAttach();
}

function stopChatWatchers() {
  chatObservers.forEach(obs => obs.disconnect());
  chatObservers = [];
}

// ΓöÇΓöÇ Caption Watchers (Meet captions + YouTube subtitles) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

let captionObservers = [];
let lastCaptionText = '';

function startCaptionWatchers() {
  stopCaptionWatchers();
  const hostname = window.location.hostname;

  // Google Meet live captions ΓÇö only the actual caption output container
  if (hostname.includes('meet.google.com')) {
    watchCaptions(['.a4cQT'], 'Meet');  // Meet's actual caption container class
  }

  // YouTube subtitles ΓÇö only the real caption segment spans
  if (hostname.includes('youtube.com')) {
    watchCaptions(['.ytp-caption-segment'], 'YouTube');
  }
}

function watchCaptions(selectors, platform) {
  let retries = 0;
  const maxRetries = 15;
  const retryDelay = 2000;

  const tryAttach = () => {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.closest('#' + SS_TTS_HOST_ID)) continue;

        const observer = new MutationObserver(() => {
          const text = el.textContent?.trim();
          if (text && text.length > 2 && text !== lastCaptionText && !isGarbageText(text)) {
            lastCaptionText = text;
            addChatMessage('Captions', text);
          }
        });

        observer.observe(el, {
          childList: true,
          subtree: true,
          characterData: true
        });
        captionObservers.push(observer);
      }
    }

    if (captionObservers.length === 0 && retries < maxRetries) {
      retries++;
      setTimeout(tryAttach, retryDelay);
    }
  };
  tryAttach();
}

function stopCaptionWatchers() {
  captionObservers.forEach(obs => obs.disconnect());
  captionObservers = [];
  lastCaptionText = '';
}

// ΓöÇΓöÇ Message parsers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function parseMeetMessage(node) {
  const text = node.textContent?.trim();
  if (!text || text.length < 2) return null;
  if (isGarbageText(text)) return null;
  const parts = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const sender = parts[0];
    const msg = parts[parts.length - 1];
    if (isGarbageText(sender) || isGarbageText(msg)) return null;
    return { sender, text: msg };
  }
  return { sender: 'Chat', text };
}

function parseTeamsMessage(node) {
  const text = node.textContent?.trim();
  if (!text || text.length < 2 || isGarbageText(text)) return null;
  const authorEl = node.querySelector('[data-tid="message-author-name"]') ||
    node.querySelector('[class*="author"]');
  const sender = authorEl?.textContent?.trim() || 'Teams';
  const bodyEl = node.querySelector('[data-tid="message-body"]') ||
    node.querySelector('[class*="body"]');
  const body = bodyEl?.textContent?.trim() || text;
  if (isGarbageText(body)) return null;
  return { sender, text: body };
}

function parseGenericMessage(node) {
  const text = node.textContent?.trim();
  if (!text || text.length < 2 || isGarbageText(text)) return null;
  return { sender: 'Chat', text };
}

// ΓöÇΓöÇ 10. ASL Recognition ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const SS_ASL_HOST_ID = 'screenshield-asl-host';
const ASL_PREDICTION_CONFIDENCE_THRESHOLD = 0.85;
const ASL_PREDICTION_WINDOW_SIZE = 10;
const ASL_IFRAME_ORIGIN = new URL(browser.runtime.getURL('content/asl-frame.html')).origin;
let aslStream = null;
let aslHands = null;
let aslCamera = null;
let aslShadow = null;
let aslIframeEl = null;
let aslFrameWindow = null;
let aslMessageHandler = null;
let aslLetterEl = null;
let aslWordEl = null;
let aslCapsEl = null;
let aslCurrentLetter = '';
let aslLetterStart = 0;
let aslWordBuffer = '';
let aslCapsMode = false; // false = lowercase, true = UPPERCASE
let aslPredictionHistory = [];
let aslModelReady = false;
const ASL_HOLD_MS = 1200; // hold a sign this long to confirm

function enableASL() {
  if (document.getElementById(SS_ASL_HOST_ID)) return;
  const iframe = injectASLPanel();
  startASLCamera(iframe);
}

function disableASL() {
  if (aslCamera) { aslCamera.stop(); aslCamera = null; }
  if (aslStream) { aslStream.getTracks().forEach(t => t.stop()); aslStream = null; }
  if (aslMessageHandler) {
    window.removeEventListener('message', aslMessageHandler);
    aslMessageHandler = null;
  }
  document.getElementById(SS_ASL_HOST_ID)?.remove();
  aslHands = null;
  aslShadow = null;
  aslIframeEl = null;
  aslFrameWindow = null;
  aslLetterEl = null;
  aslWordEl = null;
  aslWordBuffer = '';
  aslCurrentLetter = '';
  aslPredictionHistory = [];
  aslModelReady = false;
}

function injectASLPanel() {
  const host = document.createElement('div');
  host.id = SS_ASL_HOST_ID;
  host.style.cssText =
    'position:fixed;bottom:16px;left:16px;z-index:2147483647;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });
  aslShadow = shadow;

  const panel = document.createElement('div');
  panel.className = 'asl-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'asl-header';
  header.textContent = 'ASL Recognition';

  // Webcam + MediaPipe iframe (runs in extension context, bypasses page CSP)
  const iframe = document.createElement('iframe');
  iframe.className = 'asl-iframe';
  iframe.src = browser.runtime.getURL('content/asl-frame.html');
  iframe.setAttribute('allow', 'camera; display-capture');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('tabindex', '0');
  aslIframeEl = iframe;

  // Letter display
  const letterBox = document.createElement('div');
  letterBox.className = 'asl-letter-box';

  const letterLabel = document.createElement('span');
  letterLabel.className = 'asl-label';
  letterLabel.textContent = 'Detected:';

  const letterVal = document.createElement('span');
  letterVal.className = 'asl-letter';
  letterVal.textContent = '...';
  aslLetterEl = letterVal;

  letterBox.append(letterLabel, letterVal);

  // Word buffer display
  const wordBox = document.createElement('div');
  wordBox.className = 'asl-word-box';

  const wordVal = document.createElement('span');
  wordVal.className = 'asl-word';
  wordVal.textContent = '';
  aslWordEl = wordVal;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'asl-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', () => {
    if (aslWordBuffer.trim()) {
      if (typeof window.__screenshield_tts === 'function') {
        window.__screenshield_tts('ASL', aslWordBuffer.trim());
      } else {
        addChatMessage('ASL', aslWordBuffer.trim());
      }
      aslWordBuffer = '';
      if (aslWordEl) aslWordEl.textContent = '';
    }
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'asl-clear-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    aslWordBuffer = '';
    if (aslWordEl) aslWordEl.textContent = '';
  });

  const screenBtn = document.createElement('button');
  screenBtn.className = 'asl-screen-btn';
  screenBtn.textContent = 'Screen';
  screenBtn.title = 'Watch Meet/Screen instead of Webcam';
  screenBtn.addEventListener('click', () => {
    // Tell the iframe to switch modes
    const win = aslIframeEl?.contentWindow;
    if (win) {
      win.postMessage({ type: 'screenshield-asl-toggle-source' }, '*');
    }
  });

  wordBox.append(wordVal, sendBtn, clearBtn, screenBtn);

  // Toolbar: Caps toggle + Backspace
  const toolbar = document.createElement('div');
  toolbar.className = 'asl-toolbar';

  const capsBtn = document.createElement('button');
  capsBtn.className = 'asl-caps-btn';
  capsBtn.textContent = 'Aa';
  capsBtn.title = 'Toggle CAPS';
  aslCapsEl = capsBtn;
  capsBtn.addEventListener('click', () => {
    aslCapsMode = !aslCapsMode;
    capsBtn.textContent = aslCapsMode ? 'AA' : 'Aa';
    capsBtn.classList.toggle('active', aslCapsMode);
  });

  const bkspBtn = document.createElement('button');
  bkspBtn.className = 'asl-bksp-btn';
  bkspBtn.textContent = '\u232B';
  bkspBtn.title = 'Backspace';
  bkspBtn.addEventListener('click', () => {
    aslWordBuffer = aslWordBuffer.slice(0, -1);
    if (aslWordEl) aslWordEl.textContent = aslWordBuffer;
  });

  const spaceBtn = document.createElement('button');
  spaceBtn.className = 'asl-space-btn';
  spaceBtn.textContent = 'ΓÉú';
  spaceBtn.title = 'Space';
  spaceBtn.addEventListener('click', () => {
    aslWordBuffer += ' ';
    if (aslWordEl) aslWordEl.textContent = aslWordBuffer;
  });

  toolbar.append(capsBtn, spaceBtn, bkspBtn);

  panel.append(header, iframe, letterBox, toolbar, wordBox);
  shadow.appendChild(panel);

  createShadowStyles(shadow, `
    :host { all: initial; display: block; }
    .asl-panel {
      pointer-events: auto;
      width: 320px;
      background: #13131f;
      border: 1px solid #22c55e;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      color: #e8e8f0;
      overflow: hidden;
      animation: slideUp 0.3s ease forwards;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .asl-header {
      padding: 8px 12px;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #22c55e;
      border-bottom: 1px solid #2d2d4a;
    }
    .asl-iframe {
      width: 100%;
      height: 240px;
      border: none;
      background: #000;
      display: block;
    }
    .asl-letter-box {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid #2d2d4a;
    }
    .asl-label {
      font-size: 10px;
      color: #8888aa;
    }
    .asl-letter {
      font-size: 28px;
      font-weight: 800;
      color: #22c55e;
      flex: 1;
      text-align: center;
    }
    .asl-word-box {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 10px;
      flex-wrap: wrap;
    }
    .asl-word {
      flex: 1;
      font-size: 14px;
      font-weight: 600;
      color: #d0d0e8;
      min-height: 20px;
      word-break: break-all;
    }
    .asl-send-btn, .asl-clear-btn {
      background: #2d2d4a;
      border: 1px solid #3d3d5c;
      color: #e8e8f0;
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      font-family: inherit;
    }
    .asl-send-btn {
      background: #22c55e;
      border-color: #22c55e;
      color: #fff;
    }
    .asl-screen-btn {
      background: #3b82f6;
      border: 1px solid #2563eb;
      color: #fff;
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      font-family: inherit;
    }
    .asl-send-btn:hover { background: #16a34a; }
    .asl-clear-btn:hover { background: #3d3d5c; }
    .asl-screen-btn:hover { background: #2563eb; }
    .asl-toolbar {
      display: flex;
      gap: 4px;
      padding: 6px 10px;
      border-bottom: 1px solid #2d2d4a;
    }
    .asl-caps-btn, .asl-space-btn, .asl-bksp-btn {
      flex: 1;
      background: #2d2d4a;
      border: 1px solid #3d3d5c;
      color: #e8e8f0;
      border-radius: 6px;
      padding: 4px 6px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      text-align: center;
    }
    .asl-caps-btn:hover, .asl-space-btn:hover, .asl-bksp-btn:hover {
      background: #3d3d5c;
    }
    .asl-caps-btn.active {
      background: #22c55e;
      border-color: #22c55e;
      color: #fff;
    }
  `);

  document.documentElement.appendChild(host);
  setTimeout(() => {
    try { iframe.focus({ preventScroll: true }); } catch { /* best-effort */ }
  }, 200);
  return iframe;
}

function startASLCamera(iframeEl) {
  // The iframe handles webcam + MediaPipe. We only consumee structured messages.
  if (aslMessageHandler) {
    window.removeEventListener('message', aslMessageHandler);
    aslMessageHandler = null;
  }
  aslFrameWindow = iframeEl?.contentWindow || null;

  aslMessageHandler = (e) => {
    if (aslFrameWindow && e.source !== aslFrameWindow) return;
    if (e.origin !== ASL_IFRAME_ORIGIN) return;

    const payload = e.data;
    if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return;

    if (payload.type === 'screenshield-asl-prediction') {
      if (!isValidASLPredictionPayload(payload)) return;

      if (typeof payload.modelReady === 'boolean') {
        aslModelReady = payload.modelReady;
      }

      if (!aslModelReady) {
        aslPredictionHistory = [];
        return;
      }

      const normalizedLetter =
        (typeof payload.letter === 'string' && payload.letter.trim())
          ? payload.letter.trim().toUpperCase()
          : null;

      const smoothed = updateASLPredictionSmoothing(normalizedLetter, payload.confidence);
      if (!smoothed.accepted) {
        if (window.lastASLLandmarks) {
          onASLResults({ multiHandLandmarks: window.lastASLLandmarks });
        } else {
          applyASLLetter(null, 0);
        }
        return;
      }

      applyASLLetter(smoothed.letter, smoothed.confidence);
      return;
    }

    if (payload.type === 'screenshield-asl-landmarks') {
      if (!isValidASLLandmarksPayload(payload)) return;

      window.lastASLLandmarks = payload.landmarks;
      if (!aslModelReady) {
        onASLResults({ multiHandLandmarks: payload.landmarks });
      }
    }
  };

  window.addEventListener('message', aslMessageHandler);
}

function isValidASLPredictionPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const hasLetter = payload.letter == null || typeof payload.letter === 'string';
  const confidence = Number(payload.confidence);
  return hasLetter && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

function isValidLandmarkPoint(point) {
  return !!point
    && typeof point === 'object'
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y))
    && Number.isFinite(Number(point.z));
}

function isValidASLLandmarksPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.landmarks)) return false;
  return payload.landmarks.every((hand) => Array.isArray(hand) && hand.length === 21 && hand.every(isValidLandmarkPoint));
}

function updateASLPredictionSmoothing(letter, confidence) {
  if (!letter) {
    aslPredictionHistory = [];
    return { accepted: false, letter: null, confidence: 0 };
  }

  const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
  aslPredictionHistory.push({ letter, confidence: conf });
  if (aslPredictionHistory.length > ASL_PREDICTION_WINDOW_SIZE) {
    aslPredictionHistory.shift();
  }

  const counts = new Map();
  const sums = new Map();
  for (const item of aslPredictionHistory) {
    counts.set(item.letter, (counts.get(item.letter) || 0) + 1);
    sums.set(item.letter, (sums.get(item.letter) || 0) + item.confidence);
  }

  let bestLetter = null;
  let bestCount = -1;
  let bestSum = -1;
  for (const [candidate, count] of counts.entries()) {
    const sum = sums.get(candidate) || 0;
    if (count > bestCount || (count === bestCount && sum > bestSum)) {
      bestLetter = candidate;
      bestCount = count;
      bestSum = sum;
    }
  }

  if (!bestLetter) {
    return { accepted: false, letter: null, confidence: 0 };
  }

  const avgConfidence = bestCount > 0 ? (bestSum / bestCount) : 0;
  const isSpecial = bestLetter === 'SPACE' || bestLetter === 'BKSP';
  const threshold = isSpecial ? 0.70 : ASL_PREDICTION_CONFIDENCE_THRESHOLD;
  const accepted = avgConfidence >= threshold;

  return {
    accepted,
    letter: accepted ? bestLetter : null,
    confidence: avgConfidence,
  };
}

// ΓöÇΓöÇ MediaPipe results handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function applyASLLetter(letter, confidence = 0) {
  if (!letter) {
    if (aslLetterEl) {
      aslLetterEl.textContent = '...';
      aslLetterEl.removeAttribute('title');
    }
    aslCurrentLetter = '';
    return;
  }

  if (aslLetterEl) {
    aslLetterEl.textContent = letter;
    aslLetterEl.title = `Confidence: ${(confidence * 100).toFixed(1)}%`;
  }

  // Word builder: hold a letter for ASL_HOLD_MS to confirm
  if (letter !== 'SPACE' && letter !== 'BKSP') {
    if (letter === aslCurrentLetter) {
      if (Date.now() - aslLetterStart >= ASL_HOLD_MS) {
        // Apply caps mode
        const ch = aslCapsMode ? letter : letter.toLowerCase();
        aslWordBuffer += ch;
        if (aslWordEl) aslWordEl.textContent = aslWordBuffer;
        aslCurrentLetter = ''; // reset so not re-added
        aslLetterStart = Date.now();
      }
    } else {
      aslCurrentLetter = letter;
      aslLetterStart = Date.now();
    }
  } else if (letter === 'SPACE') {
    if (aslCurrentLetter !== 'SPACE') {
      aslWordBuffer += ' ';
      if (aslWordEl) aslWordEl.textContent = aslWordBuffer;
      aslCurrentLetter = 'SPACE';
      aslLetterStart = Date.now();
    }
  } else if (letter === 'BKSP') {
    if (letter === aslCurrentLetter) {
      if (Date.now() - aslLetterStart >= ASL_HOLD_MS) {
        aslWordBuffer = aslWordBuffer.slice(0, -1);
        if (aslWordEl) aslWordEl.textContent = aslWordBuffer;
        aslCurrentLetter = '';
        aslLetterStart = Date.now();
      }
    } else {
      aslCurrentLetter = 'BKSP';
      aslLetterStart = Date.now();
    }
  }
}

function onASLResults(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    applyASLLetter(null, 0);
    return;
  }

  const lm = results.multiHandLandmarks[0]; // 21 landmarks
  const letter = classifyASL(lm);
  applyASLLetter(letter, 1);
}

// ΓöÇΓöÇ Geometric ASL classifier ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Classifies a hand pose from 21 MediaPipe landmarks into an ASL letter.
 * Rule ordering: more specific shapes checked before less specific ones.
 *
 * Landmark indices:
 *  0=wrist, 1-4=thumb, 5-8=index, 9-12=middle, 13-16=ring, 17-20=pinky
 */
function classifyASL(lm) {
  // ΓöÇΓöÇ helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const ext = (tip, pip) => lm[tip].y < lm[pip].y;
  const curl = (tip, mcp) => lm[tip].y > lm[mcp].y;
  const dist = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);

  // ΓöÇΓöÇ thumb ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const thumbIndexKnuckleDist = dist(4, 5);
  const thumbOut = thumbIndexKnuckleDist > 0.10;
  const thumbUp = lm[4].y < lm[3].y && lm[4].y < lm[2].y && (lm[5].y - lm[4].y) > 0.10;
  const thumbAcross = lm[4].y > lm[6].y && !thumbOut;

  // ΓöÇΓöÇ fingers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const indexExt = ext(8, 6), middleExt = ext(12, 10), ringExt = ext(16, 14), pinkyExt = ext(20, 18);
  const indexCurl = curl(8, 5), middleCurl = curl(12, 9), ringCurl = curl(16, 13), pinkyCurl = curl(20, 17);
  const allExtended = indexExt && middleExt && ringExt && pinkyExt;
  const allCurled = indexCurl && middleCurl && ringCurl && pinkyCurl;
  const indexPartial = !indexExt && !indexCurl;
  const middlePartial = !middleExt && !middleCurl;
  const ringPartial = !ringExt && !ringCurl;

  // ΓöÇΓöÇ distances ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const thumbIndexDist = dist(4, 8);
  const thumbMiddleDist = dist(4, 12);
  const thumbRingDist = dist(4, 16);
  const thumbPinkyDist = dist(4, 20);
  const indexMiddleDist = dist(8, 12);

  // Crossed = fingertips horizontally offset (one over the other) AND close together
  // Use ABSOLUTE value so it works for either hand and any webcam mirror mode
  const fingersCrossed = Math.abs(lm[8].x - lm[12].x) > 0.03 && indexMiddleDist < 0.06;

  // Horizontal = finger is pointing more sideways than up/down
  // Compare horizontal span vs vertical span of index finger
  const indexHSpan = Math.abs(lm[8].x - lm[5].x);
  const indexVSpan = Math.abs(lm[8].y - lm[5].y);
  const handHorizontal = indexHSpan > indexVSpan;

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ GESTURES ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

  const middleRingDist = dist(12, 16);
  const isVulcan = allExtended && middleRingDist > 0.06;

  if (isVulcan) return 'BKSP';
  if (allExtended && thumbOut && !isVulcan) return 'SPACE';

  if (thumbUp && allCurled && lm[4].y < lm[9].y) return '\uD83D\uDC4D';
  if (thumbOut && indexExt && !middleExt && !ringExt && pinkyExt) return 'ILY';

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ FOUR / THREE FINGER ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

  if (thumbOut && !indexExt && !middleExt && !ringExt && pinkyExt) return 'Y';
  if (allExtended && !thumbOut) return 'B';
  if (indexExt && middleExt && ringExt && !pinkyExt) return 'W';

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ TWO FINGER (index + middle) ΓÇö grouped block ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

  if (indexExt && middleExt && !ringExt && !pinkyExt) {
    if (handHorizontal && Math.abs(lm[8].y - lm[12].y) < 0.06) return 'H';
    // K: thumb is BETWEEN index and middle (check x-position is between the two fingertips)
    const thumbBetween = (lm[4].x > Math.min(lm[8].x, lm[12].x) - 0.02) &&
      (lm[4].x < Math.max(lm[8].x, lm[12].x) + 0.02) &&
      thumbMiddleDist < 0.10;
    if (thumbBetween) return 'K';
    // R: fingers crossed AND thumb near ring finger area (blocking it)
    if (fingersCrossed && thumbRingDist < 0.12) return 'R';
    // R fallback: just fingers clearly crossed
    if (fingersCrossed) return 'R';
    if (indexMiddleDist < 0.06 && !fingersCrossed) return 'U';
    return 'V';
  }

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ SINGLE FINGER (index only) ΓÇö grouped block ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    if (handHorizontal) return 'G';
    if (thumbOut) return 'L';
    return 'D';
  }

  // I: only pinky
  if (!indexExt && !middleExt && !ringExt && pinkyExt && !thumbOut) return 'I';

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ TOUCH / CIRCLE ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

  if (thumbIndexDist < 0.06 && middleExt && ringExt && pinkyExt) return 'F';
  if (thumbIndexDist < 0.07 && thumbMiddleDist < 0.07 && thumbRingDist < 0.07 && thumbPinkyDist < 0.09) return 'O';
  if (indexPartial && middlePartial && ringPartial && !allCurled && !thumbAcross) return 'C';

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ FIST-BASED ΓÇö grouped block ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
  // T before X: both involve "index not fully extended" but T has allCurled

  if (allCurled && lm[4].y > lm[6].y && thumbIndexDist < 0.07 && thumbMiddleDist > 0.03) return 'T';
  if (indexPartial && middleCurl && ringCurl && pinkyCurl && !thumbOut) return 'X';
  // E: thumb horizontal UNDER the curled fingers (thumb tip below index PIP, and thumb is more horizontal than vertical)
  const thumbHSpan = Math.abs(lm[4].x - lm[2].x);
  const thumbVSpan = Math.abs(lm[4].y - lm[2].y);
  if (allCurled && thumbMiddleDist < 0.05 && thumbRingDist > 0.04 && lm[4].y > lm[10].y && thumbIndexDist > 0.04 && !thumbAcross) return 'N';
  if (allCurled && thumbRingDist < 0.05 && lm[4].y > lm[14].y && thumbMiddleDist > 0.04) return 'M';
  if (allCurled && thumbOut) return 'A';
  if (allCurled && thumbAcross) return 'S';

  return null;
}

// ΓöÇΓöÇ 11. Voice Personalization (AI Intent) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function startVoicePersonalization() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    browser.runtime.sendMessage({ action: 'voice-status-update', state: 'error', status: 'Speech Recognition not supported in this browser.' });
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    browser.runtime.sendMessage({ action: 'voice-status-update', state: 'listening', status: 'Listening... Speak your needs.' });
  };

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript.toLowerCase();
    browser.runtime.sendMessage({ action: 'voice-status-update', state: 'processing', status: `Heard: "${transcript}"` });

    let changed = false;
    const toUpdate = {};

    // Dyslexia intent
    if (/\b(dyslexia|dyslexic|reading disorder)\b/i.test(transcript)) {
      toUpdate.dyslexiaMode = true;
      changed = true;
    }

    // Seizure/Epilepsy intent
    if (/\b(seizure|seizures|epilepsy|epileptic|flashing lights|photosensitive|ugwim|ugwim epilepsy)\b/i.test(transcript)) {
      toUpdate.seizureSafeMode = true;
      changed = true;
    }

    // ASL Recognition / Deaf intent
    if (/\b(asl|sign language|deaf|hard of hearing)\b/i.test(transcript)) {
      toUpdate.aslMode = true;
      changed = true;
    }

    // TTS / Mute / Non-verbal intent
    if (/\b(tts|text to speech|mute|non-verbal|non verbal|can'?t speak|speech impairment)\b/i.test(transcript)) {
      toUpdate.ttsMode = true;
      changed = true;
    }

    // Live Subtitles intent
    if (/\b(subtitles|subtitle|captions|live captions|transcribe|transcription)\b/i.test(transcript)) {
      toUpdate.subtitleMode = true;
      changed = true;
    }

    if (changed) {
      // Use chrome.storage fallback for cross-browser compat
      const storageApi = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : browser.storage;
      storageApi.sync.set(toUpdate, () => {
        browser.runtime.sendMessage({ action: 'voice-status-update', state: 'stopped', status: 'Modes updated successfully!' });
      });
    } else {
      browser.runtime.sendMessage({ action: 'voice-status-update', state: 'stopped', status: 'No specific needs detected.' });
    }
  };

  recognition.onspeechend = () => {
    recognition.stop();
  };

  recognition.onerror = (event) => {
    // If permission denied, the page context will prompt the user
    let errorMsg = "Error: " + event.error;
    if (event.error === 'not-allowed') {
      errorMsg = "Microphone access denied by the browser.";
    }
    browser.runtime.sendMessage({ action: 'voice-status-update', state: 'error', status: errorMsg });
  };

  recognition.onend = () => {
    browser.runtime.sendMessage({ action: 'voice-status-update', state: 'stopped' });
  };

  recognition.start();
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start-voice-personalization') {
    startVoicePersonalization();
  }
});

// ΓöÇΓöÇ 12. Live Subtitles (Deaf / Hard of Hearing) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

let subtitleOverlay = null;
let subtitleOverlayText = null;
let subtitleRecognition = null;
let subtitleClearTimeout = null;

function injectSubtitlesOverlay() {
  if (subtitleOverlay) return;

  subtitleOverlay = document.createElement('div');
  subtitleOverlay.id = 'screenshield-subtitles';

  // Attach shadow DOM
  const shadow = subtitleOverlay.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    #subtitles-container {
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      width: 80%;
      max-width: 900px;
      text-align: center;
      z-index: 2147483647;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .subtitle-text {
      background: rgba(0, 0, 0, 0.75);
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 28px;
      font-weight: 600;
      line-height: 1.4;
      text-shadow: 1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black;
      backdrop-filter: blur(4px);
      transition: opacity 0.3s ease;
      opacity: 0;
    }
    .subtitle-text.visible {
      opacity: 1;
    }
    .subtitle-text.interim {
      color: #cbd5e1;
    }
  `;

  const container = document.createElement('div');
  container.id = 'subtitles-container';

  subtitleOverlayText = document.createElement('div');
  subtitleOverlayText.className = 'subtitle-text';

  container.appendChild(subtitleOverlayText);
  shadow.append(style, container);
  document.documentElement.appendChild(subtitleOverlay);
}

function enableSubtitles() {
  isSubtitleModeActive = true;
  injectSubtitlesOverlay();

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  if (subtitleRecognition) {
    // Already running
    return;
  }

  subtitleRecognition = new SpeechRecognition();
  subtitleRecognition.lang = 'en-US';
  subtitleRecognition.continuous = true;
  subtitleRecognition.interimResults = true; // Show words as they are spoken

  subtitleRecognition.onresult = (event) => {
    let finalTranscript = '';
    let interimTranscript = '';

    // Only process the last 3 results to prevent infinite text buildup and lagging (the "sloppy" fix)
    const startIdx = Math.max(0, event.results.length - 3);

    for (let i = startIdx; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript + ' ';
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const textToShow = (finalTranscript + interimTranscript).trim();

    if (textToShow.trim()) {
      clearTimeout(subtitleClearTimeout);
      if (subtitleOverlayText) {
        subtitleOverlayText.textContent = textToShow;
        subtitleOverlayText.classList.add('visible');
        subtitleOverlayText.classList.toggle('interim', !finalTranscript);
      }

      // Auto-hide after 4 seconds of silence
      subtitleClearTimeout = setTimeout(() => {
        if (subtitleOverlayText) {
          subtitleOverlayText.classList.remove('visible');
          setTimeout(() => { if (subtitleOverlayText) subtitleOverlayText.textContent = ''; }, 300);
        }
      }, 4000);
    }
  };

  subtitleRecognition.onerror = (event) => {
    console.warn('[ScreenShield] Live Subtitles error:', event.error);
    if (event.error === 'not-allowed' && subtitleOverlayText) {
      subtitleOverlayText.textContent = "Please allow microphone access to use Live Subtitles.";
      subtitleOverlayText.classList.add('visible');
      setTimeout(() => subtitleOverlayText.classList.remove('visible'), 4000);
      disableSubtitles();
    }
  };

  subtitleRecognition.onend = () => {
    // If mode is still active, restart it immediately (continuous looping)
    if (isSubtitleModeActive && subtitleRecognition) {
      try {
        subtitleRecognition.start();
      } catch (e) {
        // Can fail if already started
      }
    }
  };

  try {
    subtitleRecognition.start();
  } catch (e) {
    // Ignore already started errors
  }
}

function disableSubtitles() {
  isSubtitleModeActive = false;
  if (subtitleRecognition) {
    subtitleRecognition.stop();
    subtitleRecognition = null;
  }
  if (subtitleOverlayText) {
    subtitleOverlayText.classList.remove('visible');
  }
}

// ── Quick Access FAB ──────────────────────────────────────────────────────────────

const SS_FAB_HOST_ID = 'screenshield-fab-host';
let fabShadow = null;
let fabMenu = null;

function injectQuickAccessFAB() {
  if (document.getElementById(SS_FAB_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = SS_FAB_HOST_ID;
  host.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;pointer-events:none;';

  fabShadow = host.attachShadow({ mode: 'open' });

  const fabBtn = document.createElement('button');
  fabBtn.className = 'ss-pill';
  fabBtn.setAttribute('aria-label', 'ScreenShield Quick Access');
  fabBtn.innerHTML = '<svg viewBox="0 0 32 32" width="14" height="14" fill="none"><path d="M16 2L4 7v9c0 6.6 5.1 12.7 12 14 6.9-1.3 12-7.4 12-14V7L16 2z" fill="currentColor" opacity="0.6"/><path d="M11 16l3.5 3.5L21 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  fabMenu = document.createElement('div');
  fabMenu.className = 'ss-strip hidden';
  fabMenu.innerHTML =
    '<label class="ss-chip" title="ASL Recognition"><input type="checkbox" id="fab-asl"' + (settings.aslMode ? ' checked' : '') + '/><span>ASL</span></label>' +
    '<label class="ss-chip" title="Dyslexia Friendly"><input type="checkbox" id="fab-dyslexia"' + (settings.dyslexiaMode ? ' checked' : '') + '/><span>Dyslexia</span></label>' +
    '<label class="ss-chip" title="Speech to Text"><input type="checkbox" id="fab-tts"' + (settings.ttsMode ? ' checked' : '') + '/><span>TTS</span></label>' +
    '<label class="ss-chip" title="Epilepsy Safe"><input type="checkbox" id="fab-seizure"' + (settings.seizureSafeMode ? ' checked' : '') + '/><span>Epilepsy</span></label>' +
    '<label class="ss-chip" title="Live Captions"><input type="checkbox" id="fab-subtitles"' + (settings.subtitleMode ? ' checked' : '') + '/><span>Captions</span></label>';

  fabBtn.addEventListener('click', () => {
    const isHidden = fabMenu.classList.toggle('hidden');
    fabBtn.classList.toggle('open', !isHidden);
  });

  const toggleMap = {
    'fab-asl': 'aslMode',
    'fab-dyslexia': 'dyslexiaMode',
    'fab-tts': 'ttsMode',
    'fab-seizure': 'seizureSafeMode',
    'fab-subtitles': 'subtitleMode'
  };

  Object.entries(toggleMap).forEach(([id, key]) => {
    const el = fabMenu.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      browser.storage.sync.set({ [key]: e.target.checked });
    });
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'ss-fab-wrap';
  wrapper.append(fabMenu, fabBtn);
  fabShadow.appendChild(wrapper);

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    ':host{all:initial}' +
    '.ss-fab-wrap{display:flex;align-items:center;gap:6px;pointer-events:auto;justify-content:flex-end}' +
    '.ss-pill{all:unset;width:28px;height:28px;border-radius:14px;background:rgba(74,144,217,0.85);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,0.25);transition:background 0.2s,transform 0.15s,border-radius 0.2s;flex-shrink:0}' +
    '.ss-pill:hover{background:rgba(58,123,194,0.95);transform:scale(1.08)}' +
    '.ss-pill.open{background:rgba(74,144,217,1);border-radius:8px}' +
    '.ss-strip{display:flex;align-items:center;gap:4px;background:rgba(20,20,35,0.92);border:1px solid rgba(61,61,92,0.6);border-radius:16px;padding:3px 8px;backdrop-filter:blur(10px);transition:opacity 0.15s,transform 0.15s;transform-origin:right center}' +
    '.ss-strip.hidden{opacity:0;transform:scaleX(0.3);pointer-events:none;width:0;padding:0;border:none;overflow:hidden}' +
    '.ss-chip{all:unset;display:flex;align-items:center;gap:3px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;color:#c8c8e0;padding:2px 4px;border-radius:6px;transition:background 0.15s;white-space:nowrap}' +
    '.ss-chip:hover{background:rgba(74,144,217,0.15)}' +
    '.ss-chip input{width:13px;height:13px;cursor:pointer;accent-color:#4a90d9;margin:0}'
  );
  fabShadow.adoptedStyleSheets = [sheet];

  document.documentElement.appendChild(host);
}

function updateFABUI(changes) {
  if (!fabShadow) return;
  const toggleMap = {
    aslMode: 'fab-asl',
    dyslexiaMode: 'fab-dyslexia',
    ttsMode: 'fab-tts',
    seizureSafeMode: 'fab-seizure',
    subtitleMode: 'fab-subtitles'
  };
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (toggleMap[key]) {
      const el = fabShadow.querySelector('#' + toggleMap[key]);
      if (el) el.checked = !!newValue;
    }
  }
}
// ── Boot ────────────────────────────────────────────────────────────

const originalStorageListener = browser.storage.onChanged.hasListeners() ? browser.storage.onChanged : null;
// The listener at the top of the file handles side effects.
// We just add a small hook here to visually update the FAB checkboxes
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') updateFABUI(changes);
});

// We need to inject the FAB during init
const originalInit = init;
init = async function () {
  await originalInit();
  injectQuickAccessFAB();
};

init().catch(console.warn);
