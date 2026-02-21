/**
 * ScreenShield popup script.
 * Reads settings from storage.sync, hydrates the UI, and persists changes back.
 * The content script reacts via storage.onChanged — no direct tab messaging needed.
 */

const $ = id => document.getElementById(id);

const els = {
  dyslexiaToggle: $('dyslexia-toggle'),
  seizureToggle: $('seizure-toggle'),
  ttsToggle: $('tts-toggle'),
  sensitivitySection: $('sensitivity-section'),
  sensitivitySlider: $('sensitivity-slider'),
  sensitivityValue: $('sensitivity-value'),
  colorMode: $('color-mode'),
  allowlistToggle: $('allowlist-toggle'),
  allowlistDomain: $('allowlist-domain'),
  cardDyslexia: $('card-dyslexia'),
  cardSeizure: $('card-seizure'),
  cardTts: $('card-tts'),
  ttsLangSection: $('tts-lang-section'),
  ttsLanguage: $('tts-language'),
  cardAllowlist: $('card-allowlist'),
  aslToggle: $('asl-toggle'),
  cardAsl: $('card-asl'),
};

let currentHostname = '';
let settings = {
  dyslexiaMode: false,
  seizureSafeMode: false,
  ttsMode: false,
  ttsLanguage: 'en',
  aslMode: false,
  sensitivity: 5,
  colorMode: 'default',
  allowlist: []
};

// ── Init ────────────────────────────────────────────────────

async function init() {
  // Resolve current hostname via activeTab
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      try {
        currentHostname = new URL(tab.url).hostname;
      } catch {
        currentHostname = '';
      }
    }
  } catch {
    // tabs permission may not be available on restricted pages
  }

  // Load persisted settings (chrome.storage.sync or browser.storage.sync via polyfill)
  const stored = await browser.storage.sync.get(Object.keys(settings));
  settings = { ...settings, ...stored };

  applyPaletteToPopup(settings.colorMode);
  hydrateUI();
}

// ── Render ───────────────────────────────────────────────────

function hydrateUI() {
  els.dyslexiaToggle.checked = settings.dyslexiaMode;
  els.seizureToggle.checked = settings.seizureSafeMode;
  els.ttsToggle.checked = settings.ttsMode;
  els.sensitivitySlider.value = settings.sensitivity;
  els.sensitivityValue.textContent = settings.sensitivity;

  // Show sensitivity section only when seizure-safe is on
  els.sensitivitySection.hidden = !settings.seizureSafeMode;

  // Allowlist
  const isAllowlisted = currentHostname && settings.allowlist.includes(currentHostname);
  els.allowlistToggle.checked = isAllowlisted;
  els.allowlistDomain.textContent = currentHostname || 'No active tab';
  if (currentHostname) {
    els.cardAllowlist.classList.toggle('allowlisted', isAllowlisted);
  }

  // Active card highlight
  els.cardDyslexia.classList.toggle('active', settings.dyslexiaMode);
  els.cardSeizure.classList.toggle('active', settings.seizureSafeMode);
  els.cardTts.classList.toggle('active', settings.ttsMode);

  // Language selector
  els.ttsLangSection.hidden = !settings.ttsMode;
  els.ttsLanguage.value = settings.ttsLanguage || 'en';

  // ASL
  els.aslToggle.checked = settings.aslMode;
  els.cardAsl.classList.toggle('active', settings.aslMode);

  // Color mode
  if (els.colorMode) els.colorMode.value = settings.colorMode || 'default';
}

// Apply selected color palette to popup (CSS variables on document root)
function applyPaletteToPopup(mode) {
  if (typeof applyPalette === 'function') {
    applyPalette(mode, document.documentElement);
  }
}

// ── Event handlers ───────────────────────────────────────────

els.dyslexiaToggle.addEventListener('change', async () => {
  settings.dyslexiaMode = els.dyslexiaToggle.checked;
  els.cardDyslexia.classList.toggle('active', settings.dyslexiaMode);
  await browser.storage.sync.set({ dyslexiaMode: settings.dyslexiaMode });
});

els.seizureToggle.addEventListener('change', async () => {
  settings.seizureSafeMode = els.seizureToggle.checked;
  els.sensitivitySection.hidden = !settings.seizureSafeMode;
  els.cardSeizure.classList.toggle('active', settings.seizureSafeMode);
  await browser.storage.sync.set({ seizureSafeMode: settings.seizureSafeMode });
});

els.ttsToggle.addEventListener('change', async () => {
  settings.ttsMode = els.ttsToggle.checked;
  els.cardTts.classList.toggle('active', settings.ttsMode);
  els.ttsLangSection.hidden = !settings.ttsMode;
  await browser.storage.sync.set({ ttsMode: settings.ttsMode });
});

els.ttsLanguage.addEventListener('change', async () => {
  settings.ttsLanguage = els.ttsLanguage.value;
  await browser.storage.sync.set({ ttsLanguage: settings.ttsLanguage });
});

els.aslToggle.addEventListener('change', async () => {
  settings.aslMode = els.aslToggle.checked;
  els.cardAsl.classList.toggle('active', settings.aslMode);
  await browser.storage.sync.set({ aslMode: settings.aslMode });
});

els.sensitivitySlider.addEventListener('input', () => {
  const val = parseInt(els.sensitivitySlider.value, 10);
  els.sensitivityValue.textContent = val;
  settings.sensitivity = val;
});

// Debounce storage write for slider to avoid hammering sync quota
let sensitivityTimer = null;
els.sensitivitySlider.addEventListener('change', async () => {
  clearTimeout(sensitivityTimer);
  sensitivityTimer = setTimeout(async () => {
    await browser.storage.sync.set({ sensitivity: settings.sensitivity });
  }, 300);
});

els.allowlistToggle.addEventListener('change', async () => {
  if (!currentHostname) return;

  let list = settings.allowlist.slice();
  if (els.allowlistToggle.checked) {
    if (!list.includes(currentHostname)) list.push(currentHostname);
  } else {
    list = list.filter(h => h !== currentHostname);
  }
  settings.allowlist = list;
  await browser.storage.sync.set({ allowlist: list });

  els.cardAllowlist.classList.toggle('allowlisted', els.allowlistToggle.checked);
});

if (els.colorMode) {
  els.colorMode.addEventListener('change', async () => {
    const mode = els.colorMode.value;
    settings.colorMode = mode;
    applyPaletteToPopup(mode);
    await browser.storage.sync.set({ colorMode: mode });
  });
}

// ── Boot ─────────────────────────────────────────────────────

init().catch(console.error);
