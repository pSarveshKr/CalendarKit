const frame = document.getElementById('calendarFrame');
const loadingState = document.getElementById('loadingState');
const setupScreen = document.getElementById('setupScreen');
const calendarWrap = document.getElementById('calendarWrap');
const embedInput = document.getElementById('embedInput');
const saveEmbed = document.getElementById('saveEmbed');
const setupErr = document.getElementById('setupErr');
const openGCal = document.getElementById('openGCal');

let savedUrl = null;

chrome.storage.local.get(['calEmbedUrl'], (result) => {
  if (result.calEmbedUrl) {
    savedUrl = result.calEmbedUrl;
    frame.style.display = 'none';
    setTimeout(() => {
      frame.src = savedUrl;
    }, 50);
  } else {
    calendarWrap.style.display = 'none';
    loadingState.style.display = 'none';
    showSetup();
  }
});

frame.addEventListener('load', () => {
  if (!frame.src || frame.src === 'about:blank') return;
  frame.style.display = 'block';
  loadingState.style.display = 'none';
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.classList.remove('spinning');
});

function showSetup() {
  setupScreen.style.display = 'flex';
  calendarWrap.style.display = 'none';
}

saveEmbed.addEventListener('click', () => {
  const url = embedInput.value.trim();
  if (!url.includes('calendar.google.com/calendar/embed')) {
    setupErr.textContent = 'Please paste a valid Google Calendar embed URL.';
    return;
  }
  chrome.storage.local.set({ calEmbedUrl: url });
  savedUrl = url;
  setupErr.textContent = '';
  setupScreen.style.display = 'none';
  calendarWrap.style.display = 'flex';
  loadingState.style.display = 'flex';
  frame.src = savedUrl;
});

document.getElementById('openFull').addEventListener('click', () => {
  const fallbackUrl = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GCAL_DEFAULT_URL : 'https://calendar.google.com';
  chrome.tabs.create({ url: savedUrl || fallbackUrl });
});

document.getElementById('refreshBtn').addEventListener('click', function() {
  if (!savedUrl) return;
  this.classList.add('spinning');
  loadingState.style.display = 'flex';
  frame.src = savedUrl;
  setTimeout(() => this.classList.remove('spinning'), 1500);
});

openGCal.addEventListener('click', (e) => {
  e.preventDefault();
  const url = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GCAL_SETTINGS_URL : 'https://calendar.google.com/calendar/r/settings';
  chrome.tabs.create({ url });
});

document.querySelectorAll('.kofi-link').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const url = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.KOFI_URL : 'https://ko-fi.com/psarveshkr';
    chrome.tabs.create({ url });
  });
});

document.getElementById('changeCalBtn').addEventListener('click', () => {
  chrome.storage.local.remove('calEmbedUrl');
  savedUrl = null;
  frame.src = 'about:blank';
  calendarWrap.style.display = 'none';
  showSetup();
});