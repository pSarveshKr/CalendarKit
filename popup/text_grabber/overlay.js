/**
 * CalendarKit - Text Grabber Overlay Content Script
 * 
 * Creates a dimmed background overlay for screen area selection.
 * Sends selection bounds to background script and removes overlay.
 */

(function () {
  // Prevent duplicate overlays
  if (document.getElementById('calendar-kit-text-grabber-overlay')) {
    return;
  }

  // 1. Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'calendar-kit-text-grabber-overlay';
  overlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background: rgba(0, 0, 0, 0.45) !important;
    z-index: 2147483647 !important;
    cursor: crosshair !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    box-sizing: border-box !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
  `;

  // 2. Banner instructions
  const instructionBanner = document.createElement('div');
  instructionBanner.style.cssText = `
    position: fixed !important;
    top: 20px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: rgba(22, 25, 34, 0.92) !important;
    color: #ffffff !important;
    padding: 10px 20px !important;
    border-radius: 30px !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
  `;
  instructionBanner.innerHTML = `
    <span style="font-size:16px;">🔍</span>
    <span>Click & drag to select text or image area | Press <strong>ESC</strong> to cancel</span>
  `;
  overlay.appendChild(instructionBanner);

  // 3. Selection Box Element
  const selectionBox = document.createElement('div');
  selectionBox.style.cssText = `
    position: absolute !important;
    border: 2px solid #4285F4 !important;
    background: rgba(66, 133, 244, 0.15) !important;
    box-shadow: 0 0 12px rgba(66, 133, 244, 0.5) !important;
    display: none !important;
    pointer-events: none !important;
    border-radius: 4px !important;
  `;

  const sizeBadge = document.createElement('div');
  sizeBadge.style.cssText = `
    position: absolute !important;
    bottom: -28px !important;
    right: 0 !important;
    background: #4285F4 !important;
    color: #fff !important;
    font-size: 11px !important;
    padding: 2px 8px !important;
    border-radius: 4px !important;
    font-weight: 600 !important;
    white-space: nowrap !important;
  `;
  selectionBox.appendChild(sizeBadge);
  overlay.appendChild(selectionBox);

  // Temporarily disable pointer-events on embed/object/iframe so PDF viewer plugin on Windows doesn't intercept clicks
  const pluginElements = document.querySelectorAll('embed, object, iframe');
  pluginElements.forEach(el => {
    el.setAttribute('data-ck-prev-pe', el.style.pointerEvents || '');
    el.style.setProperty('pointer-events', 'none', 'important');
  });

  const parent = document.body || document.documentElement;
  parent.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let isSelecting = false;

  function onMouseDown(e) {
    if (e.button !== 0) return;
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox.style.left = `${startX}px`;
    selectionBox.style.top = `${startY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';

    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isSelecting) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;

    sizeBadge.textContent = `${width} × ${height} px`;

    e.preventDefault();
  }

  function cleanUpOverlay() {
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('keydown', onKeyDown, true);

    // Restore pointer-events on embeds/objects/iframes
    pluginElements.forEach(el => {
      const prev = el.getAttribute('data-ck-prev-pe');
      if (prev !== null) {
        el.style.pointerEvents = prev;
        el.removeAttribute('data-ck-prev-pe');
      }
    });

    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width < 10 || height < 10) {
      cleanUpOverlay();
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    const cropRect = {
      x: left,
      y: top,
      width: width,
      height: height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: dpr
    };

    cleanUpOverlay();

    // Send selection coordinates to background script
    chrome.runtime.sendMessage({
      action: 'PROCESS_SCREEN_SELECTION',
      cropRect: cropRect
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanUpOverlay();
    }
  }

  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('keydown', onKeyDown, true);
})();
