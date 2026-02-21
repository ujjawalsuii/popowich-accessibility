// Minimal integration: call from popup/background when user triggers region select.
// Requires: scripting, activeTab (or tabs). No manifest change if using executeScript.

function triggerRegionSelector() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content/regionSelector.js'] },
      () => {
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            if (typeof window.__EXTENSION_REGION_SELECTOR__ === 'function') {
              window.__EXTENSION_REGION_SELECTOR__();
            }
          }
        });
      }
    );
  });
}

// To receive the result, add a listener in your content script:
// window.addEventListener('message', (e) => {
//   if (e.data?.type === 'REGION_SELECTED') console.log(e.data.region);
// });
