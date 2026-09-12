/**
 * CalendarKit — Multi Finder Content Script
 * In-page draggable floating multi-term search overlay with Shadow DOM isolation.
 */

(function () {
  // Strictly only execute in the top-level window (never inside iframes or subframes)
  if (window !== window.top) {
    return;
  }

  // Singleton guard: Always clean up any prior instance or residue
  if (typeof window.__CALENDARKIT_MULTI_FINDER_CLEANUP__ === 'function') {
    try {
      window.__CALENDARKIT_MULTI_FINDER_CLEANUP__();
    } catch (_) { }
  }

  // Generate unique session ID for this instance — any previous zombie instance is instantly silenced
  const SESSION_ID = Date.now() + '_' + Math.random().toString(36).substring(2);
  window.__CALENDARKIT_MULTI_FINDER_SESSION_ID__ = SESSION_ID;

  function isSessionActive() {
    return window.__CALENDARKIT_MULTI_FINDER_SESSION_ID__ === SESSION_ID;
  }

  // Helper to completely purge any search terms or search history from all storages
  function purgeAllStorageHistory() {
    const PRESERVE_KEYS = new Set([
      'multiFinderShortcut',
      'multiFinderColors',
      'multiFinderCase',
      'multiFinderWord'
    ]);

    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.local) {
          chrome.storage.local.get(null, (all) => {
            if (all) {
              const keys = Object.keys(all).filter(k =>
                !PRESERVE_KEYS.has(k) && (
                  k.toLowerCase().includes('finder') ||
                  k.toLowerCase().includes('search') ||
                  k.startsWith('mf')
                )
              );
              if (keys.length > 0) chrome.storage.local.remove(keys);
            }
          });
        }
        if (chrome.storage.sync) {
          chrome.storage.sync.remove([
            'multiFinderHistory',
            'multiFinderTerms',
            'multiFinderRecent',
            'multiFinderSearchTerms',
            'multiFinderState',
            'multiFinderLastSearch',
            'multiFinderQuery',
            'searchTerms'
          ]);
        }
      }
    } catch (_) { }

    try {
      if (typeof localStorage !== 'undefined') {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.toLowerCase().includes('finder') || k.toLowerCase().includes('search'))) {
            toRemove.push(k);
          }
        }
        toRemove.forEach(k => localStorage.removeItem(k));
      }
    } catch (_) { }

    try {
      if (typeof sessionStorage !== 'undefined') {
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && (k.toLowerCase().includes('finder') || k.toLowerCase().includes('search'))) {
            toRemove.push(k);
          }
        }
        toRemove.forEach(k => sessionStorage.removeItem(k));
      }
    } catch (_) { }
  }

  // Purge any stale storage history on startup
  purgeAllStorageHistory();

  // Remove any stale host left in DOM from previous extension sessions
  const staleHosts = document.querySelectorAll('#calendarkit-multi-finder-host');
  staleHosts.forEach(el => el.remove());

  // Clean up any lingering highlight marks left from previous extension sessions
  try {
    const staleMarks = Array.from(document.querySelectorAll('mark.ck-finder-hl, mark[data-term-index], mark[class*="ck-term-"]'));
    for (let i = staleMarks.length - 1; i >= 0; i--) {
      const mark = staleMarks[i];
      try {
        const parent = mark.parentNode;
        if (parent) {
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          parent.removeChild(mark);
        }
      } catch (_) { }
    }
    try { document.body.normalize(); } catch (_) { }
  } catch (_) { }

  const staleStyles = document.querySelectorAll('#calendarkit-highlight-styles');
  staleStyles.forEach(el => el.remove());

  // Default color palette for 5 search terms
  const DEFAULT_COLORS = [
    '#FFE066', // 1: Sun Yellow
    '#38D9A9', // 2: Mint Teal
    '#4DABF7', // 3: Sky Blue
    '#FF922B', // 4: Warm Orange
    '#F06595'  // 5: Rose Pink
  ];

  const MAX_SEARCH_LENGTH = 150;

  // Active saved color palette (persisted in chrome.storage)
  let savedColors = [...DEFAULT_COLORS];

  function getTermColor(idx) {
    return (savedColors && savedColors[idx]) || DEFAULT_COLORS[idx] || DEFAULT_COLORS[0];
  }

  let saveColorsDebounceTimer = null;
  function debouncedSaveCustomColors() {
    clearTimeout(saveColorsDebounceTimer);
    saveColorsDebounceTimer = setTimeout(() => {
      saveCustomColors();
    }, 300);
  }

  function saveCustomColors() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.local) {
          chrome.storage.local.set({ multiFinderColors: savedColors });
        }
        if (chrome.storage.sync) {
          chrome.storage.sync.set({ multiFinderColors: savedColors });
        }
      }
    } catch (_) { }
  }

  // State
  let isOpen = false;
  let isMinimized = false;
  let customShortcut = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'F' };
  let searchTerms = [
    { text: '', color: getTermColor(0), matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false }
  ];
  let searchDebounceTimer = null;

  // DOM references
  let hostEl = null;
  let shadowRoot = null;
  let overlayEl = null;
  let pillEl = null;

  // Dragging state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let overlayStartLeft = 0;
  let overlayStartTop = 0;

  // Load saved shortcut and preferences
  function loadSettings() {
    const applyColors = (cols) => {
      if (Array.isArray(cols) && cols.length > 0) {
        for (let i = 0; i < cols.length && i < 5; i++) {
          if (typeof cols[i] === 'string' && cols[i].startsWith('#')) {
            savedColors[i] = cols[i];
          }
        }
        searchTerms.forEach((t, i) => {
          if (savedColors[i]) {
            t.color = savedColors[i];
          }
        });
        // In-place DOM update without destroying rows (preserves active color picker)
        if (overlayEl && overlayEl.style.display !== 'none' && shadowRoot) {
          const container = shadowRoot.querySelector('#ckRowsContainer') || shadowRoot.querySelector('.ck-body');
          if (container) {
            const rows = container.querySelectorAll('.ck-row');
            rows.forEach((r, i) => {
              if (savedColors[i]) {
                const wrapper = r.querySelector('.ck-color-wrapper');
                if (wrapper) wrapper.style.backgroundColor = savedColors[i];
                const cInput = r.querySelector('.ck-color-input');
                if (cInput && cInput !== shadowRoot.activeElement && cInput.value.toLowerCase() !== savedColors[i].toLowerCase()) {
                  cInput.value = savedColors[i];
                }
              }
            });
          }
          applyHighlights();
        }
      }
    };

    if (chrome.storage) {
      if (chrome.storage.local) {
        chrome.storage.local.get(['multiFinderShortcut', 'multiFinderColors', 'multiFinderCase', 'multiFinderWord'], (resLocal) => {
          if (resLocal) {
            if (Object.prototype.hasOwnProperty.call(resLocal, 'multiFinderShortcut')) {
              customShortcut = (resLocal.multiFinderShortcut && resLocal.multiFinderShortcut.key) ? resLocal.multiFinderShortcut : null;
            }
            if (resLocal.multiFinderColors) applyColors(resLocal.multiFinderColors);
            if (typeof resLocal.multiFinderCase === 'boolean') caseSensitive = resLocal.multiFinderCase;
            if (typeof resLocal.multiFinderWord === 'boolean') wholeWord = resLocal.multiFinderWord;
          }
          if (chrome.storage.sync) {
            chrome.storage.sync.get(['multiFinderShortcut', 'multiFinderColors', 'multiFinderCase', 'multiFinderWord'], (resSync) => {
              if (resSync) {
                if (Object.prototype.hasOwnProperty.call(resSync, 'multiFinderShortcut') && (!resLocal || !Object.prototype.hasOwnProperty.call(resLocal, 'multiFinderShortcut'))) {
                  customShortcut = (resSync.multiFinderShortcut && resSync.multiFinderShortcut.key) ? resSync.multiFinderShortcut : null;
                }
                if (resSync.multiFinderColors && (!resLocal || !resLocal.multiFinderColors)) applyColors(resSync.multiFinderColors);
                if (typeof resSync.multiFinderCase === 'boolean' && (!resLocal || typeof resLocal.multiFinderCase !== 'boolean')) caseSensitive = resSync.multiFinderCase;
                if (typeof resSync.multiFinderWord === 'boolean' && (!resLocal || typeof resLocal.multiFinderWord !== 'boolean')) wholeWord = resSync.multiFinderWord;
              }
              updateSettingsUI();
            });
          } else {
            updateSettingsUI();
          }
        });
      } else if (chrome.storage.sync) {
        chrome.storage.sync.get(['multiFinderShortcut', 'multiFinderColors', 'multiFinderCase', 'multiFinderWord'], (resSync) => {
          if (resSync) {
            if (Object.prototype.hasOwnProperty.call(resSync, 'multiFinderShortcut')) {
              customShortcut = (resSync.multiFinderShortcut && resSync.multiFinderShortcut.key) ? resSync.multiFinderShortcut : null;
            }
            if (resSync.multiFinderColors) applyColors(resSync.multiFinderColors);
            if (typeof resSync.multiFinderCase === 'boolean') caseSensitive = resSync.multiFinderCase;
            if (typeof resSync.multiFinderWord === 'boolean') wholeWord = resSync.multiFinderWord;
            updateSettingsUI();
          }
        });
      }

      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes) => {
          if (changes.multiFinderShortcut) {
            const sc = changes.multiFinderShortcut.newValue;
            customShortcut = (sc && sc.key) ? sc : null;
          }
          if (changes.multiFinderColors && changes.multiFinderColors.newValue) {
            applyColors(changes.multiFinderColors.newValue);
          }
        });
      }
    }
  }

  // Helper: check if key event matches shortcut
  function matchesShortcut(e, shortcut) {
    if (!shortcut || !shortcut.key) return false;
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const reqCtrlOrCmd = !!(shortcut.ctrlKey || shortcut.metaKey);
    const actualCtrlOrCmd = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
    const matchCtrl = reqCtrlOrCmd ? actualCtrlOrCmd : (!e.metaKey && !e.ctrlKey);
    const matchShift = !!shortcut.shiftKey === !!e.shiftKey;
    const matchAlt = !!shortcut.altKey === !!e.altKey;
    const matchKey = (e.key || '').toUpperCase() === (shortcut.key || '').toUpperCase();
    return matchCtrl && matchShift && matchAlt && matchKey;
  }

  // Continual selection tracker so shortcut never misses selected text
  let lastCapturedSelection = { text: '', time: 0 };

  function capturePageSelection() {
    if (!isSessionActive()) return;
    try {
      // 1. Check if user selected text in a normal webpage INPUT or TEXTAREA
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        // If activeEl is inside our host/shadowRoot, don't capture typing as selection
        if (hostEl && (hostEl === activeEl || hostEl.contains(activeEl))) return;
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && start !== end) {
          const val = activeEl.value.substring(start, end).replace(/\s+/g, ' ').trim();
          if (val.length > 0 && val.length <= 100) {
            lastCapturedSelection = { text: val, time: Date.now() };
            return;
          }
        }
      }

      // 2. Check standard window selection on the webpage
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const str = sel.toString().replace(/\s+/g, ' ').trim();
        if (str.length > 0 && str.length <= 100) {
          lastCapturedSelection = { text: str, time: Date.now() };
          return;
        }
        try {
          const range = sel.getRangeAt(0);
          const rangeStr = range ? range.cloneContents().textContent.replace(/\s+/g, ' ').trim() : '';
          if (rangeStr.length > 0 && rangeStr.length <= 100) {
            lastCapturedSelection = { text: rangeStr, time: Date.now() };
            return;
          }
        } catch (_) { }
      }
    } catch (_) { }
  }

  // Get current text selection (live or recently captured within 5.0s)
  function getSelectedText() {
    if (!isSessionActive()) return '';
    capturePageSelection();

    // Check live selection directly first
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const s = sel.toString().replace(/\s+/g, ' ').trim();
        if (s.length > 0 && s.length <= 100) {
          lastCapturedSelection = { text: s, time: Date.now() };
          return s;
        }
      }
    } catch (_) { }

    // Fall back to selection recorded within last 5000ms
    if (lastCapturedSelection.text && (Date.now() - lastCapturedSelection.time < 5000)) {
      return lastCapturedSelection.text.slice(0, 100);
    }
    return '';
  }

  // Setup AbortController for clean listener removal if re-injected
  const abortController = new AbortController();
  const { signal } = abortController;

  // Continuously record selection across all user interaction events
  document.addEventListener('selectionchange', capturePageSelection, { signal });
  document.addEventListener('mouseup', capturePageSelection, { signal });
  document.addEventListener('pointerup', capturePageSelection, { signal });
  document.addEventListener('touchend', capturePageSelection, { signal });
  document.addEventListener('keyup', capturePageSelection, { signal });

  // Initialize Host and Shadow DOM
  function initHost() {
    if (hostEl && document.documentElement.contains(hostEl)) return;

    // Ensure no duplicate host exists anywhere in the DOM
    const allExisting = document.querySelectorAll('#calendarkit-multi-finder-host');
    allExisting.forEach(el => el.remove());

    hostEl = document.createElement('div');
    hostEl.id = 'calendarkit-multi-finder-host';
    hostEl.style.position = 'fixed';
    hostEl.style.zIndex = '2147483647';
    hostEl.style.top = '0';
    hostEl.style.left = '0';
    hostEl.style.pointerEvents = 'none';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    // Styles inside Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        user-select: none;
      }

      .ck-overlay {
        position: fixed;
        width: 360px;
        background: rgba(22, 25, 34, 0.95);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.2);
        border-radius: 12px;
        color: #e8eaf0;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        transition: opacity 0.15s ease, transform 0.15s ease;
        overflow: hidden;
      }

      .ck-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: grab;
      }
      .ck-header:active {
        cursor: grabbing;
      }

      .ck-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #f1f3f9;
        letter-spacing: 0.3px;
      }

      .ck-icon-badge {
        display: flex;
        align-items: center;
        gap: 3px;
      }
      .ck-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .ck-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .ck-row-toggle {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.07);
        color: #5f6368;
        border-radius: 3px;
        padding: 1px 5px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
        line-height: 14px;
        letter-spacing: 0.2px;
        user-select: none;
      }
      .ck-row-toggle:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ccc;
        border-color: rgba(255, 255, 255, 0.15);
      }
      .ck-row-toggle.active {
        background: rgba(66, 133, 244, 0.25);
        border-color: rgba(66, 133, 244, 0.5);
        color: #8ab4f8;
      }

      .ck-btn-icon {
        background: transparent;
        border: none;
        color: #9aa0a6;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }
      .ck-btn-icon:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }

      .ck-body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: none;
        overflow-x: hidden;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .ck-body::-webkit-scrollbar {
        display: none;
      }

      .ck-row {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.025);
        padding: 4px 6px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        transition: border-color 0.15s ease;
      }
      .ck-row:focus-within {
        border-color: rgba(66, 133, 244, 0.6);
        background: rgba(255, 255, 255, 0.04);
      }

      .ck-color-wrapper {
        position: relative;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        cursor: pointer;
        flex-shrink: 0;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
      }
      .ck-color-input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        cursor: pointer;
        top: 0;
        left: 0;
      }

      .ck-search-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #f1f3f9;
        font-size: 13px;
        user-select: text;
      }
      .ck-search-input::placeholder {
        color: #5f6368;
      }

      .ck-count-badge {
        font-size: 10px;
        color: #9aa0a6;
        background: rgba(255, 255, 255, 0.06);
        padding: 2px 6px;
        border-radius: 10px;
        min-width: 32px;
        text-align: center;
        flex-shrink: 0;
      }
      .ck-count-badge.has-matches {
        color: #8ab4f8;
        font-weight: 600;
        background: rgba(66, 133, 244, 0.15);
      }

      .ck-nav-btn {
        background: transparent;
        border: none;
        color: #9aa0a6;
        cursor: pointer;
        padding: 2px;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ck-nav-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .ck-nav-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .ck-remove-row {
        background: transparent;
        border: none;
        color: #5f6368;
        cursor: pointer;
        padding: 2px;
        font-size: 12px;
        line-height: 1;
        border-radius: 3px;
      }
      .ck-remove-row:hover {
        color: #ff6b6b;
      }

      .ck-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.18);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }

      .ck-footer-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .ck-btn-secondary {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #9aa0a6;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .ck-btn-secondary:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
      }
      .ck-btn-secondary:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .ck-btn-primary {
        background: #4285F4;
        border: none;
        color: #fff;
        padding: 4px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: all 0.15s ease;
      }
      .ck-btn-primary:hover {
        background: #3367D6;
      }

      /* Floating Pill (Minimized state) */
      .ck-pill {
        position: fixed;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: rgba(22, 25, 34, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 24px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        color: #e8eaf0;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        pointer-events: auto;
        transition: transform 0.15s ease;
      }
      .ck-pill:hover {
        transform: scale(1.03);
        border-color: #4285F4;
      }
    `;
    shadowRoot.appendChild(style);

    // Build Overlay Container
    overlayEl = document.createElement('div');
    overlayEl.className = 'ck-overlay';
    overlayEl.style.top = '24px';
    overlayEl.style.right = '28px';

    // Header HTML
    overlayEl.innerHTML = `
      <div class="ck-header">
        <div class="ck-header-left">
          <div class="ck-icon-badge">
            <span class="ck-dot" style="background:#FFE066"></span>
            <span class="ck-dot" style="background:#38D9A9"></span>
            <span class="ck-dot" style="background:#4DABF7"></span>
          </div>
          <span>Multi Finder</span>
        </div>
        <div class="ck-header-actions">
          <button class="ck-btn-icon" id="ckBtnMinimize" title="Minimize to Pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button class="ck-btn-icon" id="ckBtnClose" title="Close Multi Finder (Esc)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div class="ck-body" id="ckRowsContainer"></div>
      <div class="ck-footer">
        <div class="ck-footer-left">
          <button class="ck-btn-secondary" id="ckBtnAddTerm">+ Add Term</button>
          <button class="ck-btn-secondary" id="ckBtnClearAll">Clear All</button>
        </div>
        <button class="ck-btn-primary" id="ckBtnSearch">
          <span>Search</span>
          <span style="opacity:0.6; font-size:10px;">↵</span>
        </button>
      </div>
    `;

    // Build Pill Container (for minimized state)
    pillEl = document.createElement('div');
    pillEl.className = 'ck-pill';
    pillEl.style.display = 'none';
    pillEl.style.top = '24px';
    pillEl.style.right = '28px';
    pillEl.innerHTML = `
      <span style="font-size:14px;">🔍</span>
      <span id="ckPillSummary">Multi Finder</span>
    `;

    shadowRoot.appendChild(overlayEl);
    shadowRoot.appendChild(pillEl);
    document.documentElement.appendChild(hostEl);

    // Setup Header Dragging
    setupDragEvents();

    // Setup Header & Footer Action Listeners
    const btnClose = shadowRoot.querySelector('#ckBtnClose');
    const btnMinimize = shadowRoot.querySelector('#ckBtnMinimize');
    const btnAddTerm = shadowRoot.querySelector('#ckBtnAddTerm');
    const btnClearAll = shadowRoot.querySelector('#ckBtnClearAll');
    const btnSearch = shadowRoot.querySelector('#ckBtnSearch');

    btnClose.addEventListener('click', () => closeOverlay(true));
    btnMinimize.addEventListener('click', toggleMinimize);
    pillEl.addEventListener('click', toggleMinimize);

    btnAddTerm.addEventListener('click', () => {
      if (searchTerms.length < 5) {
        const nextColor = getTermColor(searchTerms.length);
        searchTerms.push({ text: '', color: nextColor, matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false });
        renderRows();
        const inputs = shadowRoot.querySelectorAll('.ck-search-input');
        if (inputs.length > 0) {
          inputs[inputs.length - 1].focus();
        }
      }
    });

    btnClearAll.addEventListener('click', () => {
      // 1. Purge all storages (chrome.storage.local, sync, localStorage, sessionStorage)
      purgeAllStorageHistory();

      // 2. Remove all highlight marks from DOM
      clearAllHighlights();

      // 3. Reset selection memory
      lastCapturedSelection = { text: '', time: 0 };
      try {
        window.getSelection().removeAllRanges();
      } catch (_) { }

      // 4. Reset searchTerms to exactly 1 pristine empty term
      searchTerms = [
        { text: '', color: getTermColor(0), matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false }
      ];

      // 5. Re-render UI to 1 empty row and update badges
      renderRows();
      updateBadges();

      // 6. Focus the single input
      focusRowInput(0);
    });

    btnSearch.addEventListener('click', () => {
      performSearch();
    });

    // Render initial rows
    renderRows();
  }

  // Update Case & Word buttons in UI (now per-row)
  function updateSettingsUI() {
  }

  // Render Rows dynamically (up to 5)
  function renderRows() {
    if (!shadowRoot) return;
    const container = shadowRoot.querySelector('#ckRowsContainer') || shadowRoot.querySelector('.ck-body');
    const btnAddTerm = shadowRoot.querySelector('#ckBtnAddTerm');
    if (!container) return;

    if (btnAddTerm) {
      btnAddTerm.disabled = searchTerms.length >= 5;
    }

    container.innerHTML = '';

    searchTerms.forEach((term, idx) => {
      const row = document.createElement('div');
      row.className = 'ck-row';
      row.dataset.index = idx;

      const totalMatches = term.matches.length;
      const currentNum = term.activeIndex >= 0 ? term.activeIndex + 1 : 0;
      const countLabel = totalMatches > 0 ? `${currentNum}/${totalMatches}` : (term.text.trim() ? '0' : '');

      row.innerHTML = `
        <div class="ck-color-wrapper" style="background-color: ${term.color};" title="Change highlight color">
          <input type="color" class="ck-color-input" value="${term.color}" data-index="${idx}" />
        </div>
        <input 
          type="text" 
          class="ck-search-input" 
          placeholder="Find term ${idx + 1}..." 
          value="${escapeHtml(term.text)}" 
          data-index="${idx}" 
          maxlength="${MAX_SEARCH_LENGTH}"
        />
        <button class="ck-row-toggle ck-row-case ${term.caseSensitive ? 'active' : ''}" title="Match Case for this term" data-index="${idx}">Aa</button>
        <button class="ck-row-toggle ck-row-word ${term.wholeWord ? 'active' : ''}" title="Match Whole Word for this term" data-index="${idx}">W</button>
        <span class="ck-count-badge ${totalMatches > 0 ? 'has-matches' : ''}">${countLabel}</span>
        <button class="ck-nav-btn ck-prev-btn" title="Previous match (Shift+Enter)" data-index="${idx}" ${totalMatches === 0 ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button class="ck-nav-btn ck-next-btn" title="Next match (Enter)" data-index="${idx}" ${totalMatches === 0 ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        ${searchTerms.length > 1 ? `
          <button class="ck-remove-row" title="Remove term" data-index="${idx}">✕</button>
        ` : ''}
      `;

      // Input change event (debounced search) and navigation
      const input = row.querySelector('.ck-search-input');
      if (input) {
        input.value = term.text;
        input.setAttribute('value', term.text);
        input.addEventListener('input', (e) => {
          if (e.target.value.length > MAX_SEARCH_LENGTH) {
            e.target.value = e.target.value.slice(0, MAX_SEARCH_LENGTH);
          }
          term.text = e.target.value;
          debouncedSearch();
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
              navigateMatch(idx, -1);
            } else {
              navigateMatch(idx, 1);
            }
          }
        });
      }

      // Per-row Case toggle
      const caseToggleBtn = row.querySelector('.ck-row-case');
      if (caseToggleBtn) {
        caseToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          term.caseSensitive = !term.caseSensitive;
          caseToggleBtn.classList.toggle('active', term.caseSensitive);
          performSearch();
        });
      }

      // Per-row Whole Word toggle
      const wordToggleBtn = row.querySelector('.ck-row-word');
      if (wordToggleBtn) {
        wordToggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          term.wholeWord = !term.wholeWord;
          wordToggleBtn.classList.toggle('active', term.wholeWord);
          performSearch();
        });
      }

      // Color picker change
      const colorInput = row.querySelector('.ck-color-input');
      if (colorInput) {
        const updateColor = (newVal, isFinal) => {
          if (!newVal) return;
          term.color = newVal;
          savedColors[idx] = newVal;
          const wrapper = row.querySelector('.ck-color-wrapper');
          if (wrapper) wrapper.style.backgroundColor = term.color;
          applyHighlights();
          if (isFinal) {
            clearTimeout(saveColorsDebounceTimer);
            saveCustomColors();
          } else {
            debouncedSaveCustomColors();
          }
        };

        colorInput.addEventListener('input', (e) => updateColor(e.target.value, false));
        colorInput.addEventListener('change', (e) => updateColor(e.target.value, true));
      }

      // Next / Prev button clicks
      const prevBtn = row.querySelector('.ck-prev-btn');
      const nextBtn = row.querySelector('.ck-next-btn');
      if (prevBtn) prevBtn.addEventListener('click', () => navigateMatch(idx, -1));
      if (nextBtn) nextBtn.addEventListener('click', () => navigateMatch(idx, 1));

      // Remove row button click
      const removeBtn = row.querySelector('.ck-remove-row');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          searchTerms.splice(idx, 1);
          if (searchTerms.length === 0) {
            searchTerms.push({ text: '', color: getTermColor(0), matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false });
          }
          performSearch();
          renderRows();
        });
      }

      container.appendChild(row);
    });

    updatePillSummary();
  }

  // Helper escape
  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Update summary in pill
  function updatePillSummary() {
    if (!shadowRoot) return;
    const pillSummary = shadowRoot.querySelector('#ckPillSummary');
    if (!pillSummary) return;
    const total = searchTerms.reduce((sum, t) => sum + t.matches.length, 0);
    pillSummary.textContent = `${total} match${total === 1 ? '' : 'es'} found`;
  }

  // Update count badges and nav buttons in-place without destroying DOM or losing cursor focus
  function updateBadges() {
    if (!shadowRoot) return;
    const container = shadowRoot.querySelector('#ckRowsContainer') || shadowRoot.querySelector('.ck-body');
    if (!container) return;

    searchTerms.forEach((term, idx) => {
      const row = container.querySelector(`.ck-row[data-index="${idx}"]`);
      if (!row) return;

      const totalMatches = term.matches.length;
      const currentNum = term.activeIndex >= 0 ? term.activeIndex + 1 : 0;
      const countLabel = totalMatches > 0 ? `${currentNum}/${totalMatches}` : (term.text.trim() ? '0' : '');

      const badge = row.querySelector('.ck-count-badge');
      if (badge) {
        badge.textContent = countLabel;
        badge.classList.toggle('has-matches', totalMatches > 0);
      }

      const prevBtn = row.querySelector('.ck-prev-btn');
      const nextBtn = row.querySelector('.ck-next-btn');
      if (prevBtn) prevBtn.disabled = totalMatches === 0;
      if (nextBtn) nextBtn.disabled = totalMatches === 0;
    });

    updatePillSummary();
  }

  // Setup Dragging
  function setupDragEvents() {
    const header = shadowRoot.querySelector('.ck-header');
    if (!header) return;

    header.addEventListener('pointerdown', (e) => {
      // Don't drag if clicking buttons inside header
      if (e.target.closest('button')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = overlayEl.getBoundingClientRect();
      overlayStartLeft = rect.left;
      overlayStartTop = rect.top;

      // Clear 'right' property to allow left/top dragging
      overlayEl.style.right = 'auto';
      overlayEl.style.left = `${overlayStartLeft}px`;
      overlayEl.style.top = `${overlayStartTop}px`;

      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;

      let newLeft = overlayStartLeft + deltaX;
      let newTop = overlayStartTop + deltaY;

      // Viewport bounds clamping
      const maxLeft = window.innerWidth - overlayEl.offsetWidth - 10;
      const maxTop = window.innerHeight - overlayEl.offsetHeight - 10;

      newLeft = Math.max(10, Math.min(maxLeft, newLeft));
      newTop = Math.max(10, Math.min(maxTop, newTop));

      overlayEl.style.left = `${newLeft}px`;
      overlayEl.style.top = `${newTop}px`;
    });

    const stopDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try {
          header.releasePointerCapture(e.pointerId);
        } catch (_) { }
      }
    };

    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);

    // Double-click header resets to default top-right
    header.addEventListener('dblclick', () => {
      overlayEl.style.left = 'auto';
      overlayEl.style.top = '24px';
      overlayEl.style.right = '28px';
    });
  }

  // Toggle Minimize to Pill
  function toggleMinimize() {
    isMinimized = !isMinimized;
    if (isMinimized) {
      pillEl.style.left = overlayEl.style.left;
      pillEl.style.right = overlayEl.style.right;
      pillEl.style.top = overlayEl.style.top;

      overlayEl.style.display = 'none';
      pillEl.style.display = 'flex';
      updatePillSummary();
    } else {
      pillEl.style.display = 'none';
      overlayEl.style.display = 'flex';
    }
  }

  // Debounced search
  function debouncedSearch() {
    if (!isSessionActive()) return;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (!isSessionActive()) return;
      performSearch();
    }, 150);
  }

  // Highlight Styles in Page Document
  function ensurePageHighlightStyles() {
    if (document.getElementById('calendarkit-highlight-styles')) return;
    const style = document.createElement('style');
    style.id = 'calendarkit-highlight-styles';
    style.textContent = `
      mark.ck-finder-hl {
        color: inherit !important;
        border-radius: 2px !important;
        padding: 1px 0 !important;
        transition: box-shadow 0.15s ease !important;
        cursor: pointer !important;
      }
      mark.ck-finder-hl.ck-active-match {
        outline: 2px solid #ffffff !important;
        box-shadow: 0 0 12px 3px rgba(0,0,0,0.8), 0 0 6px 2px currentColor !important;
        z-index: 2147483640 !important;
        position: relative !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Clear all page highlights
  function clearAllHighlights() {
    try {
      const marks = Array.from(document.querySelectorAll('mark.ck-finder-hl, .ck-finder-hl, mark[data-term-index], mark[class*="ck-term-"]'));
      for (let i = marks.length - 1; i >= 0; i--) {
        const mark = marks[i];
        try {
          const parent = mark.parentNode;
          if (parent) {
            while (mark.firstChild) {
              parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
          }
        } catch (_) { }
      }
      try {
        document.body.normalize();
      } catch (_) { }
    } catch (_) { }

    searchTerms.forEach(t => {
      t.matches = [];
      t.activeIndex = -1;
    });
  }

  // Perform search across the page
  function performSearch() {
    if (!isSessionActive()) return;
    clearAllHighlights();
    ensurePageHighlightStyles();

    const activeTerms = searchTerms
      .map((t, idx) => ({ ...t, originalIndex: idx }))
      .filter(t => t.text.trim().length > 0);

    if (activeTerms.length === 0) {
      updateBadges();
      return;
    }

    // Build regex for each active term
    const regexes = activeTerms.map(t => {
      const escaped = t.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = t.wholeWord ? `\\b${escaped}\\b` : escaped;
      return {
        regex: new RegExp(pattern, t.caseSensitive ? 'g' : 'gi'),
        termIndex: t.originalIndex,
        color: t.color
      };
    });

    // Safe TreeWalker traversal
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (
            tag === 'SCRIPT' ||
            tag === 'STYLE' ||
            tag === 'NOSCRIPT' ||
            tag === 'TEXTAREA' ||
            tag === 'INPUT' ||
            tag === 'SELECT' ||
            parent.id === 'calendarkit-multi-finder-host' ||
            parent.closest('#calendarkit-multi-finder-host')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodesToProcess = [];
    while (walker.nextNode()) {
      nodesToProcess.push(walker.currentNode);
    }

    // Find all matches in text nodes
    nodesToProcess.forEach(textNode => {
      const text = textNode.nodeValue;
      const allMatchesInNode = [];

      regexes.forEach(({ regex, termIndex, color }) => {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match[0].length === 0) break;
          allMatchesInNode.push({
            start: match.index,
            end: match.index + match[0].length,
            termIndex: termIndex,
            color: color
          });
        }
      });

      if (allMatchesInNode.length === 0) return;

      // Sort matches by start position, then resolve overlap
      allMatchesInNode.sort((a, b) => a.start - b.start);
      const nonOverlapping = [];
      let lastEnd = 0;
      allMatchesInNode.forEach(m => {
        if (m.start >= lastEnd) {
          nonOverlapping.push(m);
          lastEnd = m.end;
        }
      });

      if (nonOverlapping.length === 0) return;

      // Split text node and wrap with mark tags
      const fragment = document.createDocumentFragment();
      let currentIndex = 0;

      nonOverlapping.forEach(m => {
        // Text before match
        if (m.start > currentIndex) {
          fragment.appendChild(document.createTextNode(text.substring(currentIndex, m.start)));
        }

        // The match itself
        const mark = document.createElement('mark');
        mark.className = `ck-finder-hl ck-term-${m.termIndex}`;
        mark.dataset.termIndex = m.termIndex;
        mark.style.backgroundColor = `${m.color}88`;
        mark.style.color = 'inherit';
        mark.textContent = text.substring(m.start, m.end);

        fragment.appendChild(mark);
        currentIndex = m.end;

        // Register match into searchTerms
        searchTerms[m.termIndex].matches.push(mark);
      });

      // Remaining text after last match
      if (currentIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(currentIndex)));
      }

      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });

    // Reset active index if matches exist
    searchTerms.forEach(t => {
      if (t.matches.length > 0 && t.activeIndex === -1) {
        t.activeIndex = 0;
      }
    });

    applyActiveMatchVisual();
    updateBadges();
  }

  // Apply highlight styles or color updates
  function applyHighlights() {
    searchTerms.forEach((t, idx) => {
      t.matches.forEach(mark => {
        mark.style.backgroundColor = `${t.color}88`;
      });
    });
    applyActiveMatchVisual();
  }

  // Navigate next or prev match for a specific term
  function navigateMatch(termIndex, direction) {
    const term = searchTerms[termIndex];
    if (!term || term.matches.length === 0) return;

    if (term.activeIndex < 0) {
      term.activeIndex = 0;
    } else {
      term.activeIndex = (term.activeIndex + direction + term.matches.length) % term.matches.length;
    }

    applyActiveMatchVisual();
    updateBadges();

    const currentMark = term.matches[term.activeIndex];
    if (currentMark) {
      currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Highlight active match visually
  function applyActiveMatchVisual() {
    // Remove previous active classes
    document.querySelectorAll('mark.ck-finder-hl.ck-active-match').forEach(m => {
      m.classList.remove('ck-active-match');
    });

    searchTerms.forEach(t => {
      if (t.matches.length > 0 && t.activeIndex >= 0 && t.activeIndex < t.matches.length) {
        const mark = t.matches[t.activeIndex];
        if (mark) {
          mark.classList.add('ck-active-match');
        }
      }
    });
  }

  // Focus specific row input with cursor at end
  function focusRowInput(idx) {
    setTimeout(() => {
      if (!isSessionActive() || !shadowRoot) return;
      const input = shadowRoot.querySelector(`.ck-search-input[data-index="${idx}"]`);
      if (input) {
        if (searchTerms[idx] && typeof searchTerms[idx].text === 'string') {
          input.value = searchTerms[idx].text;
          input.setAttribute('value', searchTerms[idx].text);
        }
        input.focus();
        input.selectionStart = input.selectionEnd = input.value.length;
      }
    }, 20);
  }

  // Open the Multi Finder Overlay fresh
  function openOverlay(selectedText) {
    if (!isSessionActive()) return;

    const textToSearch = (selectedText && typeof selectedText === 'string') ? selectedText.trim().slice(0, 100) : '';

    // ALWAYS start with a fresh, clean 1-term search state when opening
    clearAllHighlights();
    searchTerms = [
      { text: textToSearch, color: getTermColor(0), matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false }
    ];

    initHost();
    isOpen = true;
    isMinimized = false;
    if (pillEl) pillEl.style.display = 'none';
    if (overlayEl) overlayEl.style.display = 'flex';

    renderRows();

    if (textToSearch) {
      performSearch();
    }

    focusRowInput(0);
  }

  // Close the Multi Finder Overlay and completely clear all search history/terms
  function closeOverlay() {
    if (!isSessionActive()) return;

    isOpen = false;
    isMinimized = false;
    lastCapturedSelection = { text: '', time: 0 };
    if (overlayEl) overlayEl.style.display = 'none';
    if (pillEl) pillEl.style.display = 'none';

    // 1. Purge any storage history
    purgeAllStorageHistory();

    // 2. Remove all page highlights
    clearAllHighlights();

    // 3. Completely wipe all search terms and history
    searchTerms = [
      { text: '', color: getTermColor(0), matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false }
    ];

    // 4. Reset UI rows to pristine clean state
    renderRows();

    // 5. Blur any shadow root element so focus returns to the page cleanly
    try {
      if (shadowRoot && shadowRoot.activeElement) {
        shadowRoot.activeElement.blur();
      }
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      if (window.focus) window.focus();
    } catch (_) { }
  }

  let lastToggleTime = 0;
  let lastShortcutHandledInPage = 0;

  // Unified shortcut trigger and sequential term management handler
  function handleShortcutTrigger(passedText) {
    if (!isSessionActive()) return;

    const now = Date.now();
    if (now - lastToggleTime < 300) {
      return; // Ignore duplicate calls within 300ms
    }
    lastToggleTime = now;

    // Get the selected text (passed text or freshly captured from page)
    const text = (typeof passedText === 'string' && passedText.trim().length > 0)
      ? passedText.trim().slice(0, 100)
      : getSelectedText();

    // SCENARIO 1: NO text selected on the webpage
    if (!text) {
      if (isOpen) {
        // Overlay is open and nothing is selected -> close it
        closeOverlay();
      } else {
        // Overlay is closed and nothing is selected -> open clean overlay
        openOverlay('');
      }
      return;
    }

    // SCENARIO 2: User HAS selected a text on the webpage!
    if (!isOpen) {
      // If closed, open fresh with this word as Term 1 (Field 1)
      openOverlay(text);
      return;
    }

    // Overlay is ALREADY OPEN:
    if (isMinimized) {
      isMinimized = false;
      if (pillEl) pillEl.style.display = 'none';
      if (overlayEl) overlayEl.style.display = 'flex';
    }
    // Rule A: If Field 1 is empty, put it in Field 1
    if (searchTerms.length >= 1 && !searchTerms[0].text.trim()) {
      searchTerms[0].text = text;
      renderRows();
      performSearch();
      focusRowInput(0);
      return;
    }

    // Rule B: Check if this exact text is already in any row (case-insensitive)
    const existingIdx = searchTerms.findIndex(t => t.text.trim().toLowerCase() === text.toLowerCase());
    if (existingIdx !== -1) {
      focusRowInput(existingIdx);
      return;
    }

    // Rule C: If any existing field is empty, fill that empty field first
    const emptyIdx = searchTerms.findIndex(t => !t.text.trim());
    if (emptyIdx !== -1) {
      searchTerms[emptyIdx].text = text;
      renderRows();
      performSearch();
      focusRowInput(emptyIdx);
      return;
    }

    // Rule D: If less than 5 terms, add as NEXT term (Term 2, 3, 4, or 5)
    if (searchTerms.length < 5) {
      const nextColor = getTermColor(searchTerms.length);
      searchTerms.push({ text: text, color: nextColor, matches: [], activeIndex: -1, caseSensitive: false, wholeWord: false });
      const newIdx = searchTerms.length - 1;
      renderRows();
      performSearch();
      focusRowInput(newIdx);
      return;
    }

    // Rule E: All 5 fields are full -> update the 5th field (Field 5, index 4) with this new text
    searchTerms[4].text = text;
    renderRows();
    performSearch();
    focusRowInput(4);
  }

  // Global Keyboard Listener
  function onKeyDown(e) {
    if (!isSessionActive()) return;

    // 1. Escape key closes overlay
    if (e.key === 'Escape' && isOpen) {
      closeOverlay();
      return;
    }

    // 2. If shortcut is disabled (null), intercept and block default Ctrl+Shift+F
    if (!customShortcut || !customShortcut.key) {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlOrCmd = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
      if (ctrlOrCmd && e.shiftKey && (e.key || '').toUpperCase() === 'F') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // 3. Handle shortcut directly in-page for instant 0ms response!
    if (matchesShortcut(e, customShortcut)) {
      e.preventDefault();
      e.stopPropagation();
      lastShortcutHandledInPage = Date.now();
      const currentSel = getSelectedText();
      handleShortcutTrigger(currentSel);
    }
  }

  window.addEventListener('keydown', onKeyDown, { capture: true, signal });

  // Listen for messages from background script or popup
  function onRuntimeMessage(msg, sender, sendResponse) {
    if (!isSessionActive()) return;

    if (msg.action === 'TOGGLE_MULTI_FINDER') {
      // If the keyboard shortcut was handled directly in-page within the last 400ms, drop duplicate IPC
      if (Date.now() - lastShortcutHandledInPage < 400) {
        sendResponse({ success: true, isOpen: isOpen });
        return true;
      }
      const textFromBg = (msg.selectedText && typeof msg.selectedText === 'string')
        ? msg.selectedText.trim().slice(0, 100)
        : '';

      handleShortcutTrigger(textFromBg);
      sendResponse({ success: true, isOpen: isOpen });
      return true;
    } else if (msg.action === 'UPDATE_CUSTOM_SHORTCUT') {
      if (Object.prototype.hasOwnProperty.call(msg, 'shortcut')) {
        customShortcut = (msg.shortcut && msg.shortcut.key) ? msg.shortcut : null;
      }
      sendResponse({ success: true });
      return true;
    }
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  window.__CALENDARKIT_MULTI_FINDER_CONTROLLER__ = {
    isAlive: () => {
      try {
        return !!chrome.runtime.id && isSessionActive();
      } catch (_) {
        return false;
      }
    },
    toggle: (text) => handleShortcutTrigger(text),
    close: () => closeOverlay()
  };

  window.__CALENDARKIT_MULTI_FINDER_CLEANUP__ = function () {
    try {
      abortController.abort();
    } catch (_) { }
    try {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    } catch (_) { }
    const hosts = document.querySelectorAll('#calendarkit-multi-finder-host');
    hosts.forEach(el => el.remove());
    clearAllHighlights();
    const staleStyles = document.querySelectorAll('#calendarkit-highlight-styles');
    staleStyles.forEach(el => el.remove());
    delete window.__CALENDARKIT_MULTI_FINDER_CONTROLLER__;
  };

  // Initial settings load
  loadSettings();
})();
