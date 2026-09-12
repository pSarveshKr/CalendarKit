/**
 * CalendarKit — Multi Finder Tab Controller
 * Handles launch trigger, custom shortcut configuration, browser-conflict detection, and removal alerts.
 */

(function () {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const DEFAULT_SHORTCUT = {
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    key: 'F'
  };

  // Known Chrome browser shortcuts that conflict with web page key listeners
  const CHROME_CONFLICTS = {
    'D': 'Bookmark all open tabs',
    'T': 'Reopen last closed tab',
    'N': 'Open new incognito window',
    'B': 'Toggle bookmarks bar',
    'W': 'Close current window',
    'J': 'Open Chrome Downloads / DevTools Console',
    'C': 'Inspect element / DevTools',
    'M': 'Switch Chrome user profile'
  };

  let currentShortcut = { ...DEFAULT_SHORTCUT };
  let isRecording = false;

  // DOM elements
  const launchBtn = document.getElementById('mfLaunchBtn');
  const shortcutDisplay = document.getElementById('mfShortcutDisplay');
  const shortcutConflict = document.getElementById('mfShortcutConflict');
  const recorderBox = document.getElementById('mfRecorderBox');
  const resetBtn = document.getElementById('mfResetBtn');
  const removeBtn = document.getElementById('mfRemoveBtn');
  const modalOverlay = document.getElementById('mfModalOverlay');
  const modalOkBtn = document.getElementById('mfModalOkBtn');
  const chromeShortcutsLink = document.getElementById('mfChromeShortcutsLink');

  // Format shortcut for display
  function formatShortcut(sc) {
    if (!sc || !sc.key) {
      return '<span style="color:#f28b82; font-size:12px; font-weight:600;">Disabled (Manual Open Only)</span>';
    }
    const parts = [];
    if (sc.ctrlKey || sc.metaKey) {
      parts.push(isMac ? 'Ctrl / Cmd ⌘' : 'Ctrl');
    }
    if (sc.altKey) parts.push(isMac ? 'Option ⌥' : 'Alt');
    if (sc.shiftKey) parts.push('Shift ⇧');
    parts.push(sc.key.toUpperCase());
    return parts.map(p => `<span class="mf-kbd">${p}</span>`).join(' + ');
  }

  // Check if shortcut conflicts with native Chrome shortcuts
  function getConflictMessage(sc) {
    if (!sc || !sc.key) return null;
    const keyUpper = sc.key.toUpperCase();
    const isChromeModifier = isMac ? !!sc.metaKey : !!sc.ctrlKey;

    if (isChromeModifier && sc.shiftKey && !sc.altKey && CHROME_CONFLICTS[keyUpper]) {
      const modifierName = isMac ? 'Cmd+Shift' : 'Ctrl+Shift';
      return `⚠️ <strong>${modifierName}+${keyUpper}</strong> is a native Chrome shortcut (<em>${CHROME_CONFLICTS[keyUpper]}</em>). Chrome intercepts this shortcut on many pages. If it does not trigger, please use <strong>${modifierName}+U</strong>, <strong>${modifierName}+K</strong>, or <strong>${modifierName}+E</strong> instead.`;
    }
    return null;
  }

  // Render current shortcut and update button states
  function updateShortcutUI() {
    const isDisabled = !currentShortcut || !currentShortcut.key;

    if (shortcutDisplay) {
      shortcutDisplay.innerHTML = formatShortcut(currentShortcut);
    }

    // Display conflict notice if user chose a browser-reserved combination
    if (shortcutConflict) {
      const conflictMsg = getConflictMessage(currentShortcut);
      if (conflictMsg) {
        shortcutConflict.innerHTML = conflictMsg;
        shortcutConflict.style.display = 'block';
      } else {
        shortcutConflict.innerHTML = '';
        shortcutConflict.style.display = 'none';
      }
    }

    if (removeBtn) {
      removeBtn.disabled = isDisabled;
      removeBtn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
      removeBtn.style.opacity = isDisabled ? '0.4' : '1';
      removeBtn.textContent = 'Remove Shortcut';
    }

    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.style.cursor = 'pointer';
      resetBtn.style.opacity = '1';
      resetBtn.textContent = 'Reset Default (Ctrl+Shift+F)';
    }
  }

  // Load saved shortcut (from both local and sync storage)
  function loadShortcut() {
    const applyLoaded = (val) => {
      if (val !== undefined) {
        currentShortcut = (val && val.key) ? val : null;
      }
      updateShortcutUI();
    };

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['multiFinderShortcut'], (resLocal) => {
        if (Object.prototype.hasOwnProperty.call(resLocal, 'multiFinderShortcut')) {
          applyLoaded(resLocal.multiFinderShortcut);
        } else if (chrome.storage.sync) {
          chrome.storage.sync.get(['multiFinderShortcut'], (resSync) => {
            if (Object.prototype.hasOwnProperty.call(resSync, 'multiFinderShortcut')) {
              applyLoaded(resSync.multiFinderShortcut);
            } else {
              updateShortcutUI();
            }
          });
        } else {
          updateShortcutUI();
        }
      });
    } else {
      updateShortcutUI();
    }
  }

  // Save shortcut across both storage areas and broadcast to background and open tabs
  function saveShortcut(sc) {
    currentShortcut = sc;
    updateShortcutUI();

    // 1. Save in local & sync storage
    try {
      if (chrome.storage) {
        if (chrome.storage.local) chrome.storage.local.set({ multiFinderShortcut: sc });
        if (chrome.storage.sync) chrome.storage.sync.set({ multiFinderShortcut: sc });
      }
    } catch (e) {
      console.warn('Storage save note:', e);
    }

    // 2. Broadcast update directly to all open tabs
    try {
      if (chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({}, (tabs) => {
          if (chrome.runtime.lastError || !tabs) return;
          tabs.forEach(tab => {
            if (tab && tab.id) {
              try {
                chrome.tabs.sendMessage(tab.id, {
                  action: 'UPDATE_CUSTOM_SHORTCUT',
                  shortcut: sc
                }, () => {
                  if (chrome.runtime.lastError) {
                    // Ignore note quietly
                  }
                });
              } catch (_) { }
            }
          });
        });
      }
    } catch (e) {
      console.warn('Tabs broadcast note:', e);
    }
  }

  // 1. Launch button handler
  if (launchBtn) {
    launchBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'TRIGGER_MULTI_FINDER' }, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          console.warn('Multi Finder launch note:', lastErr.message);
          alert('Could not open Multi Finder. Please make sure you are on a regular website (like google.com or wikipedia.org), not an internal chrome:// page.');
          return;
        }
        if (response && !response.success) {
          alert(response.error || 'Cannot open Multi Finder on this page.');
          return;
        }
        window.close(); // Close popup so user immediately sees and uses in-page overlay
      });
    });
  }

  // 2. Shortcut Recorder
  if (recorderBox) {
    recorderBox.setAttribute('tabindex', '0');
    recorderBox.addEventListener('click', () => {
      isRecording = true;
      recorderBox.classList.add('recording');
      recorderBox.textContent = 'Press keys on keyboard (e.g. Ctrl + Shift + D)...';
      try { recorderBox.focus(); } catch (_) { }
    });

    window.addEventListener('keydown', (e) => {
      if (!isRecording) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        isRecording = false;
        recorderBox.classList.remove('recording');
        recorderBox.textContent = 'Click here to record a new shortcut';
        return;
      }

      // Don't record solitary modifier
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      const hasModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
      if (!hasModifier) {
        recorderBox.textContent = 'Please include a modifier key (Ctrl, Cmd, Alt, or Shift)!';
        return;
      }

      // Extract clean key character even if Option/Alt is held (dead keys on Mac)
      let keyChar = '';
      if (e.code && e.code.startsWith('Key')) {
        keyChar = e.code.slice(3).toUpperCase();
      } else if (e.code && e.code.startsWith('Digit')) {
        keyChar = e.code.slice(5);
      } else if (e.key && e.key.length === 1) {
        keyChar = e.key.toUpperCase();
      } else {
        keyChar = (e.key || '').toUpperCase();
      }

      if (!keyChar) return;

      const newShortcut = {
        ctrlKey: !!e.ctrlKey,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        metaKey: !!e.metaKey,
        key: keyChar
      };

      saveShortcut(newShortcut);
      isRecording = false;
      recorderBox.classList.remove('recording');
      recorderBox.textContent = `✓ Saved! Click to change again`;
      setTimeout(() => {
        recorderBox.textContent = 'Click here to record a new shortcut';
      }, 2000);
    });
  }

  // 3. Reset to default
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      saveShortcut({ ...DEFAULT_SHORTCUT });
      resetBtn.textContent = '✓ Reset to Default!';
      resetBtn.style.background = '#1e3a5f';
      resetBtn.style.borderColor = '#4285F4';
      setTimeout(() => {
        resetBtn.textContent = 'Reset Default (Ctrl+Shift+F)';
        resetBtn.style.background = '';
        resetBtn.style.borderColor = '';
      }, 1200);
    });
  }

  // 4. Remove shortcut (Trigger alert modal as requested)
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      saveShortcut(null);
      if (modalOverlay) {
        modalOverlay.style.display = 'flex';
      }
    });
  }

  if (modalOkBtn) {
    modalOkBtn.addEventListener('click', () => {
      if (modalOverlay) {
        modalOverlay.style.display = 'none';
      }
    });
  }

  // 5. Open Chrome extensions shortcuts page
  if (chromeShortcutsLink) {
    chromeShortcutsLink.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  // Initial load
  loadShortcut();
})();

