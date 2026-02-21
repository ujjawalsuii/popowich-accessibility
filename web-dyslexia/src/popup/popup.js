/**
 * ScreenShield popup script.
 * Reads settings from storage.sync, hydrates the UI, and persists changes back.
 * The content script reacts via storage.onChanged — no direct tab messaging needed.
 */

const $ = id => document.getElementById(id);

const SUBTITLE_SIZE_LABELS = ['Small', 'Medium–small', 'Medium', 'Medium–large', 'Large'];

const els = {
  dyslexiaToggle:    $('dyslexia-toggle'),
  contrastToggle:    $('contrast-toggle'),
  seizureToggle:     $('seizure-toggle'),
  sensitivitySection:$('sensitivity-section'),
  sensitivitySlider: $('sensitivity-slider'),
  sensitivityValue:  $('sensitivity-value'),
  subtitleSizeSlider: $('subtitle-size-slider'),
  subtitleSizeValue:  $('subtitle-size-value'),
  allowlistToggle:   $('allowlist-toggle'),
  allowlistDomain:   $('allowlist-domain'),
  cardDyslexia:      $('card-dyslexia'),
  cardContrast:      $('card-contrast'),
  cardSeizure:       $('card-seizure'),
  cardAllowlist:     $('card-allowlist'),
};

let currentHostname = '';
let settings = {
  dyslexiaMode:    false,
  contrastMode:    false,
  seizureSafeMode: false,
  sensitivity:     5,
  subtitleFontSize: 3,
  allowlist:       []
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

  // Load persisted settings
  const stored = await browser.storage.sync.get(Object.keys(settings));
  settings = { ...settings, ...stored };

  hydrateUI();
}

// ── Render ───────────────────────────────────────────────────

function hydrateUI() {
  els.dyslexiaToggle.checked = settings.dyslexiaMode;
  els.contrastToggle.checked = settings.contrastMode;
  els.seizureToggle.checked  = settings.seizureSafeMode;
  els.sensitivitySlider.value = settings.sensitivity;
  els.sensitivityValue.textContent = settings.sensitivity;

  const subSize = Math.max(1, Math.min(5, settings.subtitleFontSize || 3));
  els.subtitleSizeSlider.value = subSize;
  els.subtitleSizeValue.textContent = SUBTITLE_SIZE_LABELS[subSize - 1];

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
  els.cardContrast.classList.toggle('active', settings.contrastMode);
  els.cardSeizure.classList.toggle('active', settings.seizureSafeMode);
}

// ── Event handlers ───────────────────────────────────────────

els.dyslexiaToggle.addEventListener('change', async () => {
  settings.dyslexiaMode = els.dyslexiaToggle.checked;
  els.cardDyslexia.classList.toggle('active', settings.dyslexiaMode);
  await browser.storage.sync.set({ dyslexiaMode: settings.dyslexiaMode });
});

els.contrastToggle.addEventListener('change', async () => {
  settings.contrastMode = els.contrastToggle.checked;
  els.cardContrast.classList.toggle('active', settings.contrastMode);
  await browser.storage.sync.set({ contrastMode: settings.contrastMode });
});

els.seizureToggle.addEventListener('change', async () => {
  settings.seizureSafeMode = els.seizureToggle.checked;
  els.sensitivitySection.hidden = !settings.seizureSafeMode;
  els.cardSeizure.classList.toggle('active', settings.seizureSafeMode);
  await browser.storage.sync.set({ seizureSafeMode: settings.seizureSafeMode });
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

els.subtitleSizeSlider.addEventListener('input', () => {
  const val = parseInt(els.subtitleSizeSlider.value, 10);
  els.subtitleSizeValue.textContent = SUBTITLE_SIZE_LABELS[val - 1];
  settings.subtitleFontSize = val;
});

let subtitleSizeTimer = null;
els.subtitleSizeSlider.addEventListener('change', async () => {
  clearTimeout(subtitleSizeTimer);
  subtitleSizeTimer = setTimeout(async () => {
    await browser.storage.sync.set({ subtitleFontSize: settings.subtitleFontSize });
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

// ── Boot ─────────────────────────────────────────────────────

init().catch(console.error);
