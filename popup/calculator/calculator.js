const calcResult = document.getElementById('calcResult');
const calcExpression = document.getElementById('calcExpression');
const calcHistory = document.getElementById('calcHistory');
const historyToggle = document.getElementById('historyToggle');
const historySidebar = document.getElementById('historySidebar');
const historyClear = document.getElementById('historyClear');

let currentInput = '';
let calcHistoryList = [];
let historyOpen = false;

chrome.storage.local.get(['calcHistory'], (result) => {
  if (result.calcHistory) {
    calcHistoryList = result.calcHistory;
    renderHistory();
  }
});

function updateDisplay(value) {
  calcResult.textContent = value || '0';
}

function evaluate() {
  if (!currentInput.trim()) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  try {
    const expression = currentInput;
    const sanitized = expression
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-');
    const result = parseExpression(sanitized);
    if (result === null || !isFinite(result)) throw new Error('Invalid');
    const rounded = parseFloat(result.toFixed(10));
    addToHistory(expression, rounded);
    calcExpression.textContent = expression + ' =';
    updateDisplay(rounded);
    currentInput = String(rounded);
  } catch (err) {
    updateDisplay('Error');
    setTimeout(() => {
      currentInput = '';
      calcExpression.textContent = '';
      updateDisplay('0');
    }, 1000);
  }
}

// ── Math Parser (no eval/Function) ──
function parseExpression(expr) {
  expr = expr.replace(/\s/g, '');
  const tokens = tokenize(expr);
  const pos = { i: 0 };
  const result = parseAddSub(tokens, pos);
  if (pos.i !== tokens.length) throw new Error('Invalid');
  return result;
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (/\d|\./.test(expr[i])) {
      let num = '';
      while (i < expr.length && /\d|\./.test(expr[i])) num += expr[i++];
      tokens.push({ type: 'num', val: parseFloat(num) });
    } else if ('+-*/()'.includes(expr[i])) {
      tokens.push({ type: 'op', val: expr[i++] });
    } else {
      i++;
    }
  }
  return tokens;
}

function parseAddSub(tokens, pos) {
  let left = parseMulDiv(tokens, pos);
  while (pos.i < tokens.length && tokens[pos.i].type === 'op' &&
    (tokens[pos.i].val === '+' || tokens[pos.i].val === '-')) {
    const op = tokens[pos.i++].val;
    const right = parseMulDiv(tokens, pos);
    left = op === '+' ? left + right : left - right;
  }
  return left;
}

function parseMulDiv(tokens, pos) {
  let left = parseUnary(tokens, pos);
  while (pos.i < tokens.length && tokens[pos.i].type === 'op' &&
    (tokens[pos.i].val === '*' || tokens[pos.i].val === '/')) {
    const op = tokens[pos.i++].val;
    const right = parseUnary(tokens, pos);
    if (op === '/' && right === 0) throw new Error('Div by zero');
    left = op === '*' ? left * right : left / right;
  }
  return left;
}

function parseUnary(tokens, pos) {
  if (pos.i < tokens.length && tokens[pos.i].type === 'op' && tokens[pos.i].val === '-') {
    pos.i++;
    return -parsePrimary(tokens, pos);
  }
  if (pos.i < tokens.length && tokens[pos.i].type === 'op' && tokens[pos.i].val === '+') {
    pos.i++;
  }
  return parsePrimary(tokens, pos);
}

function parsePrimary(tokens, pos) {
  if (pos.i >= tokens.length) throw new Error('Invalid');
  if (tokens[pos.i].type === 'num') return tokens[pos.i++].val;
  if (tokens[pos.i].val === '(') {
    pos.i++;
    const val = parseAddSub(tokens, pos);
    if (pos.i >= tokens.length || tokens[pos.i].val !== ')') throw new Error('Invalid');
    pos.i++;
    return val;
  }
  throw new Error('Invalid');
}

function addToHistory(expression, result) {
  calcHistoryList.unshift({ expression, result });
  if (calcHistoryList.length > 30) calcHistoryList.pop();
  chrome.storage.local.set({ calcHistory: calcHistoryList });
  renderHistory();
}

function renderHistory() {
  calcHistory.innerHTML = '';
  calcHistoryList.forEach(({ expression, result }) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `<span class="h-expr">${expression}</span><span class="h-result">${result}</span>`;
    item.addEventListener('click', () => {
      currentInput += String(result);
      calcExpression.textContent = currentInput;
      updateDisplay(currentInput);
      closeHistory();
    });
    calcHistory.appendChild(item);
  });
}

function closeHistory() {
  historyOpen = false;
  historySidebar.classList.remove('open');
  updateToggleIcon();
}

function updateToggleIcon() {
  const svgMenu = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  const svgArrow = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const label = `<span class="history-label">History</span>`;
  historyToggle.innerHTML = (historyOpen ? svgArrow : svgMenu) + label;
}

// Button clicks
document.querySelectorAll('.calc-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    btn.blur();
    if (historyOpen) closeHistory();
    const value = btn.dataset.value;
    const action = btn.dataset.action;

    if (value !== undefined) {
      if (currentInput.length >= 20) return;
      currentInput += value;
      calcExpression.textContent = currentInput;
      updateDisplay(currentInput);
    } else if (action === 'clear') {
      currentInput = '';
      calcExpression.textContent = '';
      updateDisplay('0');
    } else if (action === 'backspace') {
      currentInput = currentInput.slice(0, -1);
      calcExpression.textContent = currentInput;
      updateDisplay(currentInput || '0');
    } else if (action === 'equals') {
      evaluate();
    }
  });
});

// Keyboard
document.addEventListener('keydown', (e) => {
  const calcTab = document.getElementById('calculatorTab');
  if (!calcTab || calcTab.style.display === 'none') return;
  if (e.target.tagName === 'BUTTON') return; // prevent double trigger

  if ('0123456789.'.includes(e.key)) {
    if (currentInput.length >= 20) return;
    e.preventDefault();
    currentInput += e.key;
  } else if (['+', '-', '*', '/','(', ')'].includes(e.key)) {
    e.preventDefault();
    currentInput += e.key;
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    currentInput = currentInput.slice(0, -1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    currentInput = '';
    calcExpression.textContent = '';
    updateDisplay('0');
    return;
  } else if (e.key === 'Enter' || e.key === '=') {
    e.preventDefault();
    evaluate();
    return;
  } else {
    return;
  }

  calcExpression.textContent = currentInput;
  updateDisplay(currentInput || '0');
});

// History toggle
historyToggle.addEventListener('click', () => {
  historyOpen = !historyOpen;
  historySidebar.classList.toggle('open', historyOpen);
  updateToggleIcon();
});

historyClear.addEventListener('click', () => {
  calcHistoryList = [];
  chrome.storage.local.remove('calcHistory');
  renderHistory();
});

// Init icon
updateToggleIcon();