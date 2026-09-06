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
  const noticeArea = document.getElementById('tgNoticeArea');

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

  // File URL permission helper
  function showFileUrlPermissionNotice() {
    if (!noticeArea) return;
    noticeArea.innerHTML = `
      <div class="tg-permission-notice">
        <div class="tg-notice-text">
          <strong>📁 Local PDF / File Capture:</strong><br>
          Please enable <em>"Allow access to file URLs"</em> in CalendarKit details.
        </div>
        <button class="tg-notice-btn" id="tgOpenExtensionsBtn">Open Settings</button>
      </div>
    `;
    noticeArea.style.display = 'block';

    const btn = document.getElementById('tgOpenExtensionsBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
      });
    }
    setStatus('Permission needed for local files/PDFs');
  }

  function hideNotice() {
    if (noticeArea) {
      noticeArea.style.display = 'none';
      noticeArea.innerHTML = '';
    }
  }

  // 3. Load Saved Text or Process Pending Capture on Popup Open
  chrome.storage.local.get(['lastGrabbedText', 'pendingOcrCapture', 'ocrError'], (result) => {
    if (result.ocrError) {
      const err = result.ocrError;
      if (err.includes('file URLs') || err.includes('file://')) {
        showFileUrlPermissionNotice();
      } else {
        setStatus('Error: ' + err);
      }
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
    hideNotice();
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
        setStatus('Cannot capture Chrome system/webstore pages. Open a regular website or paste screenshot (Ctrl+V)!');
        return;
      }

      // Check if active tab is a local file:// URL
      if (url.startsWith('file://')) {
        const isAllowed = await new Promise((resolve) => {
          if (chrome.extension && chrome.extension.isAllowedFileSchemeAccess) {
            chrome.extension.isAllowedFileSchemeAccess(resolve);
          } else {
            resolve(true);
          }
        });

        if (!isAllowed) {
          showFileUrlPermissionNotice();
          return;
        }
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
      const msg = (err && err.message) ? err.message : '';
      if (msg.includes('file URLs') || (activeTab && activeTab.url && activeTab.url.startsWith('file://'))) {
        showFileUrlPermissionNotice();
      } else if (msg.includes('Cannot access')) {
        setStatus('Cannot access this page. Open a regular webpage or paste screenshot (Ctrl+V)!');
      } else {
        setStatus('Could not start screen snip. You can paste an image (Ctrl+V).');
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
        // Accurately compute scale based on the actual captured image dimensions vs viewport
        const scaleX = (cropRect.viewportWidth && img.naturalWidth)
          ? (img.naturalWidth / cropRect.viewportWidth)
          : (cropRect.dpr || 1);
        const scaleY = (cropRect.viewportHeight && img.naturalHeight)
          ? (img.naturalHeight / cropRect.viewportHeight)
          : (cropRect.dpr || 1);

        const sx = Math.round(cropRect.x * scaleX);
        const sy = Math.round(cropRect.y * scaleY);
        const sw = Math.round(cropRect.width * scaleX);
        const sh = Math.round(cropRect.height * scaleY);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(sw, 1);
        canvas.height = Math.max(sh, 1);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(
          img,
          sx, sy, sw, sh,
          0, 0, canvas.width, canvas.height
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

  // 9. Direct Image Processing (Clipboard Paste or Drag & Drop)
  async function processDirectImage(dataUrl) {
    hideNotice();
    setStatus('Reading image...', true);

    try {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        preprocessCanvas(canvas);
        setStatus('Reading text via OCR...', true);

        const extractedText = await performOCR(canvas);
        if (extractedText && extractedText.trim().length > 0) {
          textarea.value = extractedText.trim();
          updateStats();
          chrome.storage.local.set({ lastGrabbedText: textarea.value });
          setStatus('Text extracted successfully!');
        } else {
          setStatus('No text found in image.');
        }
      };

      img.onerror = () => {
        setStatus('Failed to load image.');
      };

      img.src = dataUrl;
    } catch (err) {
      console.error('Direct image OCR error:', err);
      setStatus('OCR Processing failed.');
    }
  }

  // 10. Support Clipboard Paste (Ctrl+V / Cmd+V)
  window.addEventListener('paste', (e) => {
    // If user is pasting plain text into textarea, allow default behavior
    if (e.clipboardData && e.clipboardData.types.includes('text/plain') && document.activeElement === textarea) {
      setTimeout(updateStats, 50);
      return;
    }

    const items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData))?.items;
    if (!items) return;

    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            processDirectImage(event.target.result);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }
  });

  // 11. Support Drag & Drop of Images
  const dropZone = document.querySelector('.tg-textarea-wrap');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt ? dt.files : null;
      if (files && files[0] && files[0].type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          processDirectImage(event.target.result);
        };
        reader.readAsDataURL(files[0]);
      }
    });
  }

  // 12. Pre-process Canvas Image
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

  // 13. OCR Engine
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

  // 14. Fallback OCR
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
