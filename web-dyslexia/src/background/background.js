/**
 * ScreenShield background script.
 *
 * Runs as a service worker in Chrome MV3 and as an event-driven background
 * script in Firefox MV3. No DOM access is used here.
 *
 * Responsibilities:
 *   - Seed default settings on first install via storage.sync
 *   - Content scripts react to storage changes directly via storage.onChanged,
 *     so no active tab-messaging relay is needed here.
 */

// Inline browser API shim — service workers cannot importScripts from a
// sibling directory reliably in all MV3 implementations.
// Firefox has native `browser`; Chrome MV3 service workers only have `chrome`.
if (typeof globalThis.browser === 'undefined') {
  // eslint-disable-next-line no-undef
  globalThis.browser = chrome;
}

const DEFAULT_SETTINGS = {
  dyslexiaMode: false,
  seizureSafeMode: false,
  ttsMode: false,
  sensitivity: 5,
  allowlist: []
};

browser.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await browser.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    const toSet = {};

    for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
      if (stored[key] === undefined) {
        toSet[key] = defaultVal;
      }
    }

    if (Object.keys(toSet).length > 0) {
      await browser.storage.sync.set(toSet);
    }
  } catch (err) {
    console.warn('[ScreenShield background] storage init failed:', err);
  }

  // Create right-click "Narrate" context menu item
  browser.contextMenus.create({
    id: 'screenshield-narrate',
    title: 'Narrate selected text',
    contexts: ['selection']
  });
});

// Handle context menu click — send selected text to content script for TTS
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'screenshield-narrate' && info.selectionText) {
    browser.tabs.sendMessage(tab.id, {
      action: 'narrate-selection',
      text: info.selectionText
    });
  }
});

