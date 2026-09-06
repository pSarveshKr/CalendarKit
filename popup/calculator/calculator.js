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
  const displayVal = (value !== undefined && value !== null && value !== '') ? String(value) : '0';
  if (calcResult) {
    calcResult.value = displayVal;
  }
}

function focusCalculator(selectEnd = true) {
  const calcTab = document.getElementById('calculatorTab');
  if (!calcTab || calcTab.style.display === 'none' || !calcResult) return;
  calcResult.focus();
  if (selectEnd) {
    const len = calcResult.value.length;
    calcResult.setSelectionRange(len, len);
  }
}

window.focusCalculator = focusCalculator;

let errorTimeout = null;

function clearErrorStatus() {
  if (errorTimeout) {
    clearTimeout(errorTimeout);
    errorTimeout = null;
  }
  if (calcExpression && (calcExpression.textContent === 'Syntax Error' || calcExpression.textContent === 'Cannot divide by zero')) {
    calcExpression.textContent = '';
    calcExpression.style.color = '';
  }
}

function insertAtCursor(str) {
  if (!calcResult) return;
  clearErrorStatus();
  let val = calcResult.value;
  let start = calcResult.selectionStart ?? val.length;
  let end = calcResult.selectionEnd ?? val.length;

  // If display is currently default '0'
  if (val === '0') {
    if (str === '.') {
      val = '0';
      start = 1;
      end = 1;
    } else if (!'+-*/()÷×−'.includes(str)) {
      val = '';
      start = 0;
      end = 0;
    }
  }

  const before = val.slice(0, start);
  const after = val.slice(end);
  const newVal = before + str + after;

  if (newVal.length > 30) return;

  currentInput = newVal;
  updateDisplay(newVal);

  const newPos = before.length + str.length;
  calcResult.focus();
  calcResult.setSelectionRange(newPos, newPos);
}

function backspaceAtCursor() {
  if (!calcResult) return;
  clearErrorStatus();
  let val = calcResult.value;
  let start = calcResult.selectionStart ?? val.length;
  let end = calcResult.selectionEnd ?? val.length;

  if (start !== end) {
    // Delete selection
    const before = val.slice(0, start);
    const after = val.slice(end);
    const newVal = before + after;
    currentInput = newVal;
    updateDisplay(newVal || '0');
    calcResult.focus();
    const pos = newVal ? start : 1;
    calcResult.setSelectionRange(pos, pos);
  } else if (start > 0) {
    // Delete character before cursor
    const before = val.slice(0, start - 1);
    const after = val.slice(start);
    const newVal = before + after;
    currentInput = newVal;
    updateDisplay(newVal || '0');
    calcResult.focus();
    const pos = newVal ? start - 1 : 1;
    calcResult.setSelectionRange(pos, pos);
  }
}

function clearCalculator() {
  clearErrorStatus();
  currentInput = '';
  calcExpression.textContent = '';
  calcExpression.style.color = '';
  updateDisplay('0');
  focusCalculator();
}

function evaluate() {
  const exprToEval = (calcResult ? calcResult.value : currentInput) || '';
  if (!exprToEval.trim() || exprToEval === '0') return;

  try {
    let expression = exprToEval.trim();

    // Auto-close unclosed parentheses if any
    const openCount = (expression.match(/\(/g) || []).length;
    const closeCount = (expression.match(/\)/g) || []).length;
    if (openCount > closeCount) {
      expression += ')'.repeat(openCount - closeCount);
    }

    const sanitized = expression
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-');
    const result = parseExpression(sanitized);
    if (result === null || !isFinite(result)) throw new Error('Invalid');
    const rounded = parseFloat(result.toFixed(10));
    addToHistory(expression, rounded);
    clearErrorStatus();
    calcExpression.textContent = expression + ' =';
    calcExpression.style.color = '';
    updateDisplay(rounded);
    currentInput = String(rounded);
    focusCalculator();
  } catch (err) {
    // Show error feedback WITHOUT wiping the user's expression
    const displayEl = document.querySelector('.calc-display');
    if (displayEl) {
      displayEl.classList.remove('error-shake');
      void displayEl.offsetWidth;
      displayEl.classList.add('error-shake');
      setTimeout(() => displayEl.classList.remove('error-shake'), 400);
    }

    const errorMsg = (err && err.message === 'Div by zero') ? 'Cannot divide by zero' : 'Syntax Error';
    if (calcExpression) {
      calcExpression.textContent = errorMsg;
      calcExpression.style.color = '#ef4444';
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        if (calcExpression.textContent === 'Syntax Error' || calcExpression.textContent === 'Cannot divide by zero') {
          calcExpression.textContent = '';
          calcExpression.style.color = '';
        }
      }, 3000);
    }

    // Keep expression completely preserved in input and focus at the end so user can edit/backspace
    currentInput = exprToEval;
    updateDisplay(exprToEval);
    focusCalculator(true);
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
      insertAtCursor(String(result));
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
    if (historyOpen) closeHistory();
    const value = btn.dataset.value;
    const action = btn.dataset.action;

    if (value !== undefined) {
      insertAtCursor(value);
    } else if (action === 'clear') {
      clearCalculator();
    } else if (action === 'backspace') {
      backspaceAtCursor();
    } else if (action === 'equals') {
      evaluate();
    }
  });
});

// Sync manual typing directly inside calcResult
if (calcResult) {
  calcResult.addEventListener('input', () => {
    clearErrorStatus();
    let val = calcResult.value;
    // If leading '0' before a digit (e.g. '05' from paste/IME), replace it with the digit
    if (/^0[0-9]/.test(val)) {
      val = val.replace(/^0+/, '');
      calcResult.value = val;
    }
    const raw = calcResult.value;
    const clean = raw.replace(/[^0-9+\-*/().×÷−]/g, '');
    if (clean !== raw) {
      const pos = calcResult.selectionStart;
      calcResult.value = clean;
      if (pos !== null) {
        calcResult.setSelectionRange(Math.max(0, pos - 1), Math.max(0, pos - 1));
      }
    }
    currentInput = calcResult.value;
  });
}

// Global Keyboard Handler
document.addEventListener('keydown', (e) => {
  const calcTab = document.getElementById('calculatorTab');
  if (!calcTab || calcTab.style.display === 'none') return;

  // Don't intercept if user is typing inside setup input or text grabber textarea
  if (e.target && (e.target.id === 'embedInput' || e.target.id === 'tgExtractedText')) return;

  // Allow browser/system shortcuts like Ctrl+C, Ctrl+A, Cmd+C, Cmd+A, Cmd+V
  if (e.ctrlKey || e.metaKey) return;

  if (e.key === 'Enter' || e.key === '=') {
    e.preventDefault();
    evaluate();
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    clearCalculator();
    return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    backspaceAtCursor();
    return;
  }

  // Route all mathematical typing through insertAtCursor so zero-replacement and validation are consistent
  if ('0123456789.()'.includes(e.key)) {
    e.preventDefault();
    insertAtCursor(e.key);
    return;
  }

  if (e.key === '+') {
    e.preventDefault();
    insertAtCursor('+');
    return;
  }

  if (e.key === '-') {
    e.preventDefault();
    insertAtCursor('−');
    return;
  }

  if (e.key === '*') {
    e.preventDefault();
    insertAtCursor('×');
    return;
  }

  if (e.key === '/') {
    e.preventDefault();
    insertAtCursor('÷');
    return;
  }
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