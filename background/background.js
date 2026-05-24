function onInit() {
  chrome.storage.local.get(['calEmbedUrl'], (result) => {
    if (result.calEmbedUrl) {
      chrome.storage.local.set({ lastRefresh: Date.now() });
    }
  });
}

chrome.runtime.onStartup.addListener(onInit);
chrome.runtime.onInstalled.addListener(onInit);