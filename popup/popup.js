const tabCalendar = document.getElementById('tabCalendar');
const tabCalculator = document.getElementById('tabCalculator');
const tabTextGrabber = document.getElementById('tabTextGrabber');

const calendarTab = document.getElementById('calendarTab');
const calculatorTab = document.getElementById('calculatorTab');
const textGrabberTab = document.getElementById('textGrabberTab');

const calendarSVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="4" width="18" height="18" rx="2" stroke="#4285F4" stroke-width="2"/>
  <path d="M3 9h18" stroke="#4285F4" stroke-width="2"/>
  <path d="M8 4V2M16 4V2" stroke="#4285F4" stroke-width="2" stroke-linecap="round"/>
  <rect x="7" y="13" width="3" height="3" rx="0.5" fill="#4285F4"/>
  <rect x="14" y="13" width="3" height="3" rx="0.5" fill="#EA4335"/>
  <rect x="7" y="17" width="3" height="3" rx="0.5" fill="#34A853"/>
  <rect x="14" y="17" width="3" height="3" rx="0.5" fill="#FBBC05"/>
</svg>`;

const calculatorSVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="2" stroke="#4285F4" stroke-width="2"/>
  <path d="M7 8h10M7 12h4M7 16h4M15 12h2M15 16h2" stroke="#4285F4" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const textGrabberSVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="2" stroke="#4285F4" stroke-width="2"/>
  <path d="M7 8h10M7 12h10M7 16h6" stroke="#4285F4" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function setLogoSVG(svg) {
  document.querySelector('.logo').insertAdjacentHTML('afterbegin', svg);
  document.querySelector('.logo svg:last-of-type').remove();
}

function switchToCalendar() {
  tabCalendar.classList.add('active');
  tabCalculator.classList.remove('active');
  tabTextGrabber.classList.remove('active');
  calendarTab.style.display = 'flex';
  calculatorTab.style.display = 'none';
  textGrabberTab.style.display = 'none';
  document.getElementById('refreshBtn').style.display = 'flex';
  document.getElementById('openFull').style.display = 'flex';
  document.getElementById('changeCalBtn').style.display = 'flex';
  document.querySelector('.title').textContent = 'Calendar';
  setLogoSVG(calendarSVG);
}

function switchToCalculator() {
  tabCalculator.classList.add('active');
  tabCalendar.classList.remove('active');
  tabTextGrabber.classList.remove('active');
  calculatorTab.style.display = 'flex';
  calendarTab.style.display = 'none';
  textGrabberTab.style.display = 'none';
  document.getElementById('refreshBtn').style.display = 'none';
  document.getElementById('openFull').style.display = 'none';
  document.getElementById('changeCalBtn').style.display = 'none';
  document.querySelector('.title').textContent = 'Calculator';
  setLogoSVG(calculatorSVG);
  if (window.focusCalculator) {
    setTimeout(window.focusCalculator, 15);
  }
}

function switchToTextGrabber() {
  tabTextGrabber.classList.add('active');
  tabCalendar.classList.remove('active');
  tabCalculator.classList.remove('active');
  textGrabberTab.style.display = 'flex';
  calendarTab.style.display = 'none';
  calculatorTab.style.display = 'none';
  document.getElementById('refreshBtn').style.display = 'none';
  document.getElementById('openFull').style.display = 'none';
  document.getElementById('changeCalBtn').style.display = 'none';
  document.querySelector('.title').textContent = 'Text Grabber';
  setLogoSVG(textGrabberSVG);
}

chrome.storage.local.get(['defaultTab', 'pendingOcrCapture'], (result) => {
  const def = result.defaultTab || 'calendar';
  const radio = document.querySelector(`input[name="defaultTab"][value="${def}"]`);
  if (radio) radio.checked = true;

  if (result.pendingOcrCapture) {
    switchToTextGrabber();
  } else if (def === 'calculator') {
    switchToCalculator();
  } else if (def === 'text_grabber') {
    switchToTextGrabber();
  } else {
    switchToCalendar();
  }
});

tabCalendar.addEventListener('click', switchToCalendar);
tabCalculator.addEventListener('click', switchToCalculator);
tabTextGrabber.addEventListener('click', switchToTextGrabber);

document.getElementById('settingsBtn').addEventListener('click', () => {
  const panel = document.getElementById('settingsPanel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
});

document.querySelectorAll('input[name="defaultTab"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    chrome.storage.local.set({ defaultTab: e.target.value });
  });
});

document.addEventListener('click', (e) => {
  const panel = document.getElementById('settingsPanel');
  const settingsBtn = document.getElementById('settingsBtn');
  if (!panel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
    panel.style.display = 'none';
  }
});

document.querySelectorAll('.feedback-link').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const url = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.FEEDBACK_FORM_URL : 'https://forms.gle/VXd1gVj6s9FiVdhh8';
    chrome.tabs.create({ url });
  });
});

function updateExtensionIcon() {
  const date = new Date().getDate();
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#4285F4';
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 128, 20);
  ctx.fill();

  ctx.fillStyle = '#1a73e8';
  ctx.fillRect(0, 8, 128, 30);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(date), 64, 82);

  const imageData = ctx.getImageData(0, 0, 128, 128);
  chrome.action.setIcon({ imageData });
}

updateExtensionIcon();