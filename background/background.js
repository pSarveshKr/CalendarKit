function onInit() {
  chrome.storage.local.get(['calEmbedUrl'], (result) => {
    if (result.calEmbedUrl) {
      chrome.storage.local.set({ lastRefresh: Date.now() });
    }
  });
}

chrome.runtime.onStartup.addListener(onInit);
chrome.runtime.onInstalled.addListener(onInit);

// Handle messages from Text Grabber popup and overlay content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Trigger overlay injection into active tab
  if (message.action === 'INITIATE_SCREEN_SNIP') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (!activeTab) {
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }
      
      const url = activeTab.url || '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.includes('chrome.google.com/webstore') ||
        url.includes('chromewebstore.google.com')
      ) {
        sendResponse({ success: false, error: 'Cannot access internal Chrome or Webstore pages' });
        return;
      }

      // Inject overlay.js into active tab
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['popup/text_grabber/overlay.js']
      }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        console.error('Failed to inject overlay script:', err);
        sendResponse({ success: false, error: err.message });
      });
    });
    return true; // Keep response channel open for async response
  }

  // 2. Process selection coordinates & capture screenshot
  if (message.action === 'PROCESS_SCREEN_SELECTION') {
    const cropRect = message.cropRect;

    // Wait 120ms to ensure overlay element is removed from DOM compositor
    setTimeout(() => {
      // Capture visible tab without passing invalid null windowId
      chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          console.error('Capture visible tab error:', chrome.runtime.lastError);
          const errorMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Screen capture failed';
          chrome.storage.local.set({ ocrError: errorMsg });
          // Attempt to re-open popup to show error
          if (chrome.action && chrome.action.openPopup) {
            chrome.action.openPopup().catch(() => {});
          }
          return;
        }

        const pendingData = {
          dataUrl: dataUrl,
          cropRect: cropRect,
          timestamp: Date.now(),
          status: 'READY'
        };

        // Save capture data in chrome.storage.local & default to Text Grabber tab
        chrome.storage.local.set({ pendingOcrCapture: pendingData, ocrError: null }, () => {
          // Re-open extension popup automatically
          if (chrome.action && chrome.action.openPopup) {
            chrome.action.openPopup().catch((err) => {
              console.log('openPopup note:', err);
            });
          }
        });
      });
    }, 120);

    return true;
  }
});