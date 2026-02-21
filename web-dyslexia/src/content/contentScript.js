/**
 * ScreenShield content script.
 *
 * Key design notes:
 *
 * SHADOW DOM STYLING — We use adoptedStyleSheets (CSSStyleSheet API) instead
 * of innerHTML <style> tags for ALL Shadow DOM elements. Many sites (Tenor,
 * Giphy, social media) include a Content-Security-Policy with `style-src 'self'`
 * which blocks inline <style> tags injected by content scripts — even inside
 * Shadow DOM. The CSSStyleSheet API is a JavaScript call and is NOT subject to
 * `style-src` CSP. Helper: createShadowStyles(shadow, css).
 *
 * GIF PLACEHOLDER — We do NOT copy img.className to the host div. React/Vue
 * sites attach CSS classes to <img> elements like `opacity-0`, `lazy-load`,
 * or `hidden` which, if inherited by the host div, would hide or break the
 * placeholder. We store the original className in a data attribute and restore
 * it only to the <img> on reveal. Replacement uses host.replaceWith() which
 * is simpler and more reliable than parentNode.replaceChild on virtual-DOM sites.
 *
 * AUTO DARK MODE — On enable, we read the OS color scheme preference via
 * matchMedia. We also register a change listener so toggling OS dark mode
 * while the extension is active updates the page in real-time.
 */

// ── 1. State ─────────────────────────────────────────────────────────────────

const SS_DYSLEXIA_CSS_ID  = 'screenshield-dyslexia-css';
const SS_DYSLEXIA_FONT_ID = 'screenshield-dyslexia-font';
const SS_DYSLEXIA_HOST_ID = 'screenshield-dyslexia-host';
const SS_SEIZURE_CSS_ID   = 'screenshield-seizure-css';
const SS_CONTRAST_CSS_ID  = 'screenshield-contrast-css';

/** Subtitle font size: 1–5 map to px (for ASL-to-text / captions). */
const SUBTITLE_SIZE_PX = [14, 18, 22, 26, 32];

let settings = {
  dyslexiaMode:    false,
  contrastMode:    false,
  seizureSafeMode: false,
  sensitivity:     5,
  subtitleFontSize: 3,
  allowlist:       []
};

const monitoredVideos           = new WeakSet();
let   videoIntersectionObserver = null;
let   domMutationObserver       = null;

/** Mirror of the panel's current dark-mode state so the matchMedia listener
 *  can update both the theme and the panel button emoji together. */
let panelIsDark = false;

// ── 2. Init ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    const stored = await browser.storage.sync.get(Object.keys(settings));
    settings = { ...settings, ...stored };
  } catch {
    return;
  }
  applySubtitleFontSize();
  if (isAllowlisted()) return;
  if (settings.dyslexiaMode)    enableDyslexiaMode();
  if (settings.contrastMode)    enableContrastMode();
  if (settings.seizureSafeMode) enableSeizureSafeMode();
}

function isAllowlisted() {
  const host = window.location.hostname;
  return Array.isArray(settings.allowlist) && settings.allowlist.includes(host);
}

// ── 3. Storage listener ───────────────────────────────────────────────────────

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }

  if (changes.allowlist && isAllowlisted()) {
    disableDyslexiaMode();
    disableContrastMode();
    disableSeizureSafeMode();
    return;
  }
  if (changes.allowlist && !isAllowlisted()) {
    if (settings.dyslexiaMode)    enableDyslexiaMode();
    if (settings.contrastMode)    enableContrastMode();
    if (settings.seizureSafeMode) enableSeizureSafeMode();
    return;
  }
  if (isAllowlisted()) return;

  if (changes.dyslexiaMode) {
    settings.dyslexiaMode ? enableDyslexiaMode() : disableDyslexiaMode();
  }
  if (changes.contrastMode) {
    settings.contrastMode ? enableContrastMode() : disableContrastMode();
  }
  if (changes.seizureSafeMode) {
    settings.seizureSafeMode ? enableSeizureSafeMode() : disableSeizureSafeMode();
  }
  if (changes.subtitleFontSize !== undefined) {
    applySubtitleFontSize();
  }
});

// ── Shared Shadow DOM helper ──────────────────────────────────────────────────

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

// ── 4. Dyslexia mode ─────────────────────────────────────────────────────────

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
  const BG   = dark ? '#1a1a2e' : '#fdf9f0';
  const TEXT  = dark ? '#e8e8f0' : '#1a1a2e';
  const root = document.documentElement;
  root.style.setProperty('--ss-bg',   BG);
  root.style.setProperty('--ss-text', TEXT);
  document.body?.style.setProperty('background-color', BG,   'important');
  document.body?.style.setProperty('color',            TEXT, 'important');
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
 *   OpenDyslexic (bundled .otf)  →  Lexend (Google Fonts CDN)
 *   →  Comic Sans MS (system, well-rated for dyslexia)  →  Verdana
 *
 * NOTE: Place these files in src/assets/fonts/ then run `npm run build`:
 *   OpenDyslexic-Regular.otf
 *   OpenDyslexic-Bold.otf
 *
 * If the files are absent the browser silently falls back to Lexend/Comic Sans.
 * On pages with a strict font-src CSP, the CDN fallback is also blocked —
 * only Comic Sans MS / Verdana will be used on those pages.
 */
function injectDyslexiaFont() {
  if (document.getElementById(SS_DYSLEXIA_FONT_ID)) return;

  const regularUrl = browser.runtime.getURL('assets/fonts/OpenDyslexic-Regular.otf');
  const boldUrl    = browser.runtime.getURL('assets/fonts/OpenDyslexic-Bold.otf');

  const style = document.createElement('style');
  style.id = SS_DYSLEXIA_FONT_ID;
  // Embed the @import for Lexend inside the same style tag — keeps both font
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
 * Floating control panel — top-right corner.
 * @param {boolean} darkInitial  — whether to start in dark or light mode
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

  const label   = document.createElement('span');
  label.className = 'label';
  label.textContent = '\uD83D\uDCD6 Dyslexia Friendly'; // 📖

  const fontDec = makeBtn('font-dec', 'Smaller text',       'Decrease font size', 'A\u2212');
  const fontInc = makeBtn('font-inc', 'Larger text',        'Increase font size', 'A+');
  const bgBtn   = makeBtn('bg-cycle', 'Cycle colour theme', 'Cycle background',   '\uD83C\uDFA8'); // 🎨
  const darkBtn = makeBtn('dark-mode','Toggle dark mode',   'Toggle dark mode',   darkInitial ? '\u2600\uFE0F' : '\uD83C\uDF19'); // ☀️ or 🌙
  const closeBtn = makeBtn('close',  'Turn off Dyslexia Friendly', 'Close', '\u2715');
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

  // ── Panel logic ─────────────────────────────────────────────────────────────

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

  let isDark  = darkInitial;
  let bgIndex = 0;

  function applyOption(opt) {
    root.style.setProperty('--ss-bg',   opt.bg);
    root.style.setProperty('--ss-text', opt.text);
    document.body?.style.setProperty('background-color', opt.bg,   'important');
    document.body?.style.setProperty('color',            opt.text, 'important');
  }

  bgBtn.addEventListener('click', () => {
    const palette = isDark ? DARK_BGS : LIGHT_BGS;
    bgIndex = (bgIndex + 1) % palette.length;
    applyOption(palette[bgIndex]);
  });

  darkBtn.addEventListener('click', () => {
    isDark     = !isDark;
    bgIndex    = 0;
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

// ── 4b. Color contrast mode (low vision / color blindness) ─────────────────────

function enableContrastMode() {
  if (document.getElementById(SS_CONTRAST_CSS_ID)) return;

  const style = document.createElement('style');
  style.id = SS_CONTRAST_CSS_ID;
  style.textContent = `
    :root {
      --ss-contrast-bg:    #ffffff;
      --ss-contrast-text:  #000000;
      --ss-contrast-border: #000000;
      --ss-contrast-outline: 3px solid #000000;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ss-contrast-bg:    #000000;
        --ss-contrast-text:  #ffffff;
        --ss-contrast-border: #ffffff;
        --ss-contrast-outline: 3px solid #ffffff;
      }
    }
    body {
      background-color: var(--ss-contrast-bg) !important;
      color: var(--ss-contrast-text) !important;
      filter: contrast(1.12) !important;
    }
    a, button, [role="button"], input, select, textarea {
      outline: var(--ss-contrast-outline) !important;
      outline-offset: 2px !important;
    }
    a { border-bottom: 2px solid var(--ss-contrast-border) !important; }
    button, [role="button"], input, select, textarea {
      border: 2px solid var(--ss-contrast-border) !important;
    }
    *:focus {
      outline: var(--ss-contrast-outline) !important;
      outline-offset: 2px !important;
    }
    img, video {
      filter: contrast(1.08) !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function disableContrastMode() {
  document.getElementById(SS_CONTRAST_CSS_ID)?.remove();
}

// ── 4c. Subtitle font size (for ASL-to-text / captions) ───────────────────────

/**
 * Applies --ss-subtitle-font-size to :root so any caption/subtitle element
 * (e.g. future ASL-to-text) can use it: font-size: var(--ss-subtitle-font-size);
 */
function applySubtitleFontSize() {
  const level = Math.max(1, Math.min(5, settings.subtitleFontSize || 3));
  const px = SUBTITLE_SIZE_PX[level - 1];
  document.documentElement.style.setProperty('--ss-subtitle-font-size', px + 'px');
}

// ── 5. Seizure-safe mode ──────────────────────────────────────────────────────

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
    img.src       = placeholder.dataset.ssGifSrc;
    img.alt       = placeholder.dataset.ssGifAlt || '';
    // Restore original class list to the <img>, not whatever the div had
    if (placeholder.dataset.ssGifClass) img.className = placeholder.dataset.ssGifClass;
    if (placeholder.dataset.ssGifWidth)  img.width  = placeholder.dataset.ssGifWidth;
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

// ── 6. Video / GIF processing ─────────────────────────────────────────────────

function processVideos(videos) {
  if (!settings.seizureSafeMode) return;
  videos.forEach(video => {
    video.autoplay = false;
    video.loop     = false;
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
    // Skip GIFs the user explicitly revealed — the MutationObserver fires when
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
  host.dataset.ssGifSrc    = img.src;
  host.dataset.ssGifAlt    = img.alt   || '';
  host.dataset.ssGifClass  = img.className || '';   // saved but NOT applied to host
  host.dataset.ssGifWidth  = img.width  || '';
  host.dataset.ssGifHeight = img.height || '';

  const w = Math.max(img.width  || img.naturalWidth  || 0, 160);
  const h = Math.max(img.height || img.naturalHeight || 0, 96);

  // Only set size/display on the host — no class copying from img
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
  iconEl.textContent = '\uD83C\uDFAC'; // 🎬

  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = img.alt ? `"${img.alt}"` : 'Animated image (blocked)';

  const btn = document.createElement('button');
  btn.type        = 'button';
  btn.textContent = 'Show GIF';
  btn.className   = 'show-btn';

  card.appendChild(iconEl);
  card.appendChild(labelEl);
  card.appendChild(btn);
  shadow.appendChild(card);

  // Apply styles via adoptedStyleSheets — bypasses page CSP style-src
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
    restored.src       = host.dataset.ssGifSrc;
    restored.alt       = host.dataset.ssGifAlt;
    restored.className = host.dataset.ssGifClass;  // restore ORIGINAL img class
    if (host.dataset.ssGifWidth)  restored.width  = host.dataset.ssGifWidth;
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

// ── Observers ─────────────────────────────────────────────────────────────────

function setupMutationObserver() {
  if (domMutationObserver) return;
  domMutationObserver = new MutationObserver(mutations => {
    const newVideos = [];
    const newImgs   = [];
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
    if (newImgs.length)   processGIFs(newImgs);
  });
  domMutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree:   true
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

// ── 7. Flicker detection ──────────────────────────────────────────────────────

function getThresholds() {
  const s = Math.max(1, Math.min(10, settings.sensitivity));
  return {
    flickerThreshold:   Math.max(2, Math.round(6.5 - s * 0.5)),
    lumaDeltaThreshold: Math.max(10, 60 - s * 5),
    sampleIntervalMs:   100,
    windowSize:         10
  };
}

function sampleFrame(ctx) {
  const data  = ctx.getImageData(0, 0, 64, 36).data;
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
    Math.abs(b.r    - a.r)    * 0.75,
    Math.abs(b.g    - a.g)    * 0.60,
    Math.abs(b.b    - a.b)    * 0.65
  );
}

function startFlickerDetection(video) {
  if (video._ssIntervalId) return;

  const canvas = document.createElement('canvas');
  canvas.width  = 64;
  canvas.height = 36;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const frameHistory = [];
  let   triggered    = false;

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

// ── 8. Warning card UI ────────────────────────────────────────────────────────

function showFlickerWarning(video) {
  video._ssWarningHost?.remove();

  const host = document.createElement('div');
  host.setAttribute('data-ss-warning', 'true');

  const syncPosition = () => {
    const r = video.getBoundingClientRect();
    const w = Math.max(r.width,  240);
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
  iconEl.textContent = '\u26A0\uFE0F'; // ⚠️

  const titleEl = document.createElement('h3');
  titleEl.id = 'ss-warn-title';
  titleEl.textContent = 'Flashing content detected';

  const descEl = document.createElement('p');
  descEl.id = 'ss-warn-desc';
  descEl.textContent = 'ScreenShield paused this video because it contains rapid brightness or colour changes. Harm reduction only — not a medical guarantee.';

  const btns = document.createElement('div');
  btns.className = 'buttons';

  const allowOnce  = document.createElement('button');
  const allowSite  = document.createElement('button');
  const keepBlock  = document.createElement('button');
  allowOnce.type   = allowSite.type = keepBlock.type = 'button';
  allowOnce.className  = 'allow-once';
  allowSite.className  = 'allow-site';
  keepBlock.className  = 'keep-blocked';
  allowOnce.textContent  = 'Show once';
  allowSite.textContent  = 'Always allow this site';
  keepBlock.textContent  = 'Keep blocked';

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

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch(console.warn);
