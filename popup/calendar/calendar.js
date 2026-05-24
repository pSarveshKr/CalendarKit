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
  chrome.tabs.create({ url: savedUrl || 'https://calendar.google.com' });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  if (!savedUrl) return;
  loadingState.style.display = 'flex';
  frame.src = savedUrl;
});

openGCal.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://calendar.google.com/calendar/r/settings' });
});

document.getElementById('changeCalBtn').addEventListener('click', () => {
  chrome.storage.local.remove('calEmbedUrl');
  savedUrl = null;
  frame.src = 'about:blank';
  calendarWrap.style.display = 'none';
  showSetup();
});