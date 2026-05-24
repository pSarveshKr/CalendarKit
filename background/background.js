chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['calEmbedUrl'], (result) => {
    if (result.calEmbedUrl) {
      chrome.storage.local.set({ lastRefresh: Date.now() });
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['calEmbedUrl'], (result) => {
    if (result.calEmbedUrl) {
      chrome.storage.local.set({ lastRefresh: Date.now() });
    }
  });
});