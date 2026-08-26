/**
 * CalendarKit - Text Grabber Logic
 * 
 * Handles user interactions for screen snipping, OCR text extraction,
 * clipboard copying, and state persistence inside the extension popup.
 */

document.addEventListener('DOMContentLoaded', () => {
  const selectAreaBtn = document.getElementById('tgSelectAreaBtn');
  const copyTextBtn = document.getElementById('tgCopyTextBtn');
  const clearTextBtn = document.getElementById('tgClearTextBtn');
  const textarea = document.getElementById('tgExtractedText');
  const statusText = document.getElementById('tgStatusText');
  const statusDot = document.getElementById('tgStatusDot');
  const statsText = document.getElementById('tgStatsText');

  if (!selectAreaBtn || !textarea) return;

  // 1. Update Word & Character Count
  function updateStats() {
    const text = textarea.value.trim();
    const charCount = textarea.value.length;
    const wordCount = text ? text.split(/\s+/).length : 0;
    statsText.textContent = `${wordCount} words • ${charCount} chars`;
  }

  // 2. Set Status Indicator
  function setStatus(message, isScanning = false) {
    statusText.textContent = message;
    if (isScanning) {
      statusDot.classList.add('scanning');
    } else {
      statusDot.classList.remove('scanning');
    }
  }

  // 3. Load Saved Text or Process Pending Capture on Popup Open
  chrome.storage.local.get(['lastGrabbedText', 'pendingOcrCapture', 'ocrError'], (result) => {
    if (result.ocrError) {
      setStatus('Error: ' + result.ocrError);
      chrome.storage.local.remove('ocrError');
      return;
    }

    if (result.lastGrabbedText) {
      textarea.value = result.lastGrabbedText;
      updateStats();
    }

    // Check if there is a pending screen capture to process with OCR
    if (result.pendingOcrCapture && result.pendingOcrCapture.status === 'READY') {
      processCapture(result.pendingOcrCapture);
    }
  });

  // 4. Listen for runtime messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'OCR_CAPTURE_READY' && message.pendingData) {
      processCapture(message.pendingData);
    }
  });

  // 5. Handle "Select Screen Area" button click
  selectAreaBtn.addEventListener('click', async () => {
    setStatus('Opening overlay on active tab...', true);

    try {
      // Query current active tab in last focused window
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeTab = tabs && tabs[0] ? tabs[0] : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

      if (!activeTab) {
        setStatus('Error: No active webpage tab found.');
        return;
      }

      // Check if active tab is a restricted Chrome system / webstore URL
      const url = activeTab.url || '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.includes('chrome.google.com/webstore') ||
        url.includes('chromewebstore.google.com')
      ) {
        setStatus('Cannot capture Chrome system/webstore pages. Open a regular website (e.g. google.com)!');
        return;
      }

      // Inject overlay.js into active tab
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['popup/text_grabber/overlay.js']
      });

      // Close popup window so user can drag select on webpage
      window.close();
    } catch (err) {
      console.error('Failed to inject overlay:', err);
      if (err.message && err.message.includes('Cannot access')) {
        setStatus('Cannot access this page. Try a regular website!');
      } else {
        setStatus('Error: Could not inject overlay on this page.');
      }
    }
  });

  // 6. Handle "Copy Text" button click
  copyTextBtn.addEventListener('click', async () => {
    const text = textarea.value;
    if (!text) {
      setStatus('Nothing to copy!');
      setTimeout(() => setStatus('Ready'), 1500);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      copyTextBtn.classList.add('copied');
      copyTextBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Copied!</span>
      `;
      setStatus('Copied to clipboard!');

      setTimeout(() => {
        copyTextBtn.classList.remove('copied');
        copyTextBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy Text</span>
        `;
        setStatus('Ready');
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
      setStatus('Copy failed.');
    }
  });

  // 7. Handle "Clear Text" button click
  clearTextBtn.addEventListener('click', () => {
    textarea.value = '';
    updateStats();
    chrome.storage.local.remove('lastGrabbedText');
    setStatus('Text cleared');
    setTimeout(() => setStatus('Ready'), 1500);
  });

  // Listen to manual typing changes
  textarea.addEventListener('input', () => {
    updateStats();
    chrome.storage.local.set({ lastGrabbedText: textarea.value });
  });

  // 8. Image Crop & OCR Engine Processing
  async function processCapture(captureData) {
    setStatus('Extracting text from selection...', true);
    
    // Clear pending capture state from storage
    chrome.storage.local.remove('pendingOcrCapture');

    const { dataUrl, cropRect } = captureData;

    try {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = cropRect.width;
        canvas.height = cropRect.height;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(
          img,
          cropRect.x, cropRect.y, cropRect.width, cropRect.height,
          0, 0, cropRect.width, cropRect.height
        );

        // Canvas image pre-processing (Grayscale & Contrast)
        preprocessCanvas(canvas);

        setStatus('Reading text via OCR...', true);

        // Run OCR Engine
        const extractedText = await performOCR(canvas);

        if (extractedText && extractedText.trim().length > 0) {
          textarea.value = extractedText.trim();
          updateStats();
          chrome.storage.local.set({ lastGrabbedText: textarea.value });
          setStatus('Text extracted successfully!');
        } else {
          setStatus('No text found in selected region.');
        }
      };

      img.onerror = (e) => {
        console.error('Captured image load error:', e);
        setStatus('Failed to process captured image.');
      };

      img.src = dataUrl;

    } catch (error) {
      console.error('OCR processing error:', error);
      setStatus('OCR Processing failed.');
    }
  }

  // 9. Pre-process Canvas Image
  function preprocessCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const factor = 1.2;
      let val = factor * (gray - 128) + 128;
      val = Math.max(0, Math.min(255, val));

      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // 10. OCR Engine
  async function performOCR(canvas) {
    if (typeof Tesseract !== 'undefined' && Tesseract.recognize) {
      try {
        const localWorkerPath = chrome.runtime.getURL('popup/text_grabber/worker.min.js');
        const localCorePath = chrome.runtime.getURL('popup/text_grabber/tesseract-core.wasm.js');
        const localLangPath = chrome.runtime.getURL('popup/text_grabber');

        const result = await Tesseract.recognize(canvas, 'eng', {
          workerPath: localWorkerPath,
          corePath: localCorePath,
          langPath: localLangPath,
          workerBlobURL: false,
          gzip: true,
          logger: (m) => {
            if (m.status === 'recognizing text') {
              const pct = Math.round((m.progress || 0) * 100);
              setStatus(`Reading text... ${pct}%`, true);
            }
          }
        });
        return result.data ? result.data.text : '';
      } catch (err) {
        console.warn('Tesseract OCR error:', err);
      }
    }

    return fallbackOCR(canvas);
  }

  // 11. Fallback OCR
  function fallbackOCR(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 128) darkPixels++;
    }
    return "";
  }
});
