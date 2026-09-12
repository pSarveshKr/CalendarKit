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
            chrome.action.openPopup().catch(() => { });
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
            chrome.action.openPopup().catch((err) => { });
          }
        });
      });
    }, 120);

    return true;
  }

  // 3. Toggle Multi Finder from popup or other sources
  if (message.action === 'TRIGGER_MULTI_FINDER') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (!activeTab || !activeTab.id) {
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
        sendResponse({
          success: false,
          error: 'Multi Finder cannot run on internal browser pages (chrome://). Please switch to a normal webpage (like google.com or wikipedia.org) and try again!'
        });
        return;
      }

      toggleMultiFinderInTab(activeTab.id, sendResponse);
    });
    return true;
  }
});

// Helper to inject/send toggle message to active tab
function toggleMultiFinderInTab(tabId, callback) {
  // Directly message active tab for instantaneous 0ms response
  chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_MULTI_FINDER' }).then((res) => {
    if (callback) callback(res || { success: true });
  }).catch(() => {
    // If content script is not yet injected on this tab, inject dynamically into frame 0 only
    chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: false },
      files: ['popup/multi_finder/multi_finder_content.js']
    }).then(() => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_MULTI_FINDER' })
          .then((res2) => {
            if (callback) callback(res2 || { success: true });
          })
          .catch((sendErr) => {
            if (callback) callback({ success: false, error: sendErr ? sendErr.message : 'Could not message page' });
          });
      }, 50);
    }).catch((err) => {
      console.warn('Could not inject Multi Finder:', err);
      if (callback) callback({ success: false, error: err.message });
    });
  });
}

function isDefaultShortcut(sc) {
  if (!sc || !sc.key) return false;
  return (sc.ctrlKey || sc.metaKey) && sc.shiftKey && !sc.altKey && sc.key.toUpperCase() === 'F';
}

// 4. Handle Keyboard Shortcut commands (Ctrl+Shift+F / Command+Shift+F)
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-multi-finder') {
    chrome.storage.local.get(['multiFinderShortcut'], (res) => {
      if (res && Object.prototype.hasOwnProperty.call(res, 'multiFinderShortcut')) {
        const sc = res.multiFinderShortcut;
        if (sc === null || sc === false || (sc && !isDefaultShortcut(sc))) {
          return;
        }
      }

      const handleTab = (activeTab) => {
        if (!activeTab || !activeTab.id) return;
        const url = activeTab.url || '';
        if (
          url.startsWith('chrome://') ||
          url.startsWith('chrome-extension://') ||
          url.startsWith('edge://') ||
          url.startsWith('about:') ||
          url.includes('chrome.google.com/webstore') ||
          url.includes('chromewebstore.google.com')
        ) {
          return;
        }
        toggleMultiFinderInTab(activeTab.id);
      };

      if (tab && tab.id) {
        handleTab(tab);
      } else {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          handleTab(tabs && tabs[0] ? tabs[0] : null);
        });
      }
    });
  }
});