const API_BASE = 'https://energyroll-api.onrender.com/api'; 

const state = {
  userLogin: null, ws: null, keyword: '',
  collectedUsers: new Set(), orderedParticipants: [], excludedUsers: new Set(),
  users: new Map(), messages: new Map(), 
  currentWinner: null, 
  winnersHistory: [], currentStreamWinners: [], winnersTab: 'stream',      
  miniGame: 'instant', topModeEnabled: false, theme: 'red-light',
  winnerSelectedAt: null, winnerHasResponded: false, timerInterval: null, isSpinning: false,
  selectedSite: null, editWinnersMode: false, sortMode: 'time',
  rigTarget: null,
  bombActive: false, bombCode: null, bombRevealed: null, bombParticipants: null, bombResolve: null, bombWinLogin: null
};

const SITES = [
  { id: 'magicdrop', name: 'Magic Drop' }, { id: 'ninjacase', name: 'Ninja Case' },
  { id: 'zavod', name: 'Zavod Drop' }, { id: 'downgrader', name: 'Downgrader' }, { id: 'cshappy', name: 'CS Happy' }
];

const SITE_ICONS = {
  magicdrop: 'magic.jpg', ninjacase: 'ninja.jpg', zavod: 'zavod.jpg',
  downgrader: 'downgrader.jpg', cshappy: 'cshappy.jpg'
};

let spinCancel = false, cardsCancelFn = null, bombCancelFn = null, spotlightCancelFn = null, clockCancelFn = null, topChattersScheduled = false;
let reconnectAttempts = 0, chatSaveTimeout = null;

const topElements = new Map(), avatarCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const els = {
  channelInput: document.getElementById('channel-input'), connectBtn: document.getElementById('connect-btn'),
  disconnectBtn: document.getElementById('disconnect-btn'), clearChatBtn: document.getElementById('clear-chat-btn'),
  settingsBtn: document.getElementById('settings-btn'), keywordInput: document.getElementById('keyword-input'),
  chatMessages: document.getElementById('chat-messages'), statusText: document.getElementById('status-text'),
  participantCount: document.getElementById('participant-count'), participantsList: document.getElementById('participants-list'),
  addParticipantInput: document.getElementById('add-participant-input'), addParticipantBtn: document.getElementById('add-participant-btn'),
  participantsSearch: document.getElementById('participants-search'),
  clearCollect: document.getElementById('clear-collect'), pickWinner: document.getElementById('pick-winner'),
  winnersHistory: document.getElementById('winners-history'), totalPayoutEl: document.getElementById('total-payout'),
  totalDepEl: document.getElementById('total-dep'), tabStream: document.getElementById('tab-stream'),
  tabAll: document.getElementById('tab-all'), clearStreamWinnersBtn: document.getElementById('clear-stream-winners-btn'),
  editWinnersBtn: document.getElementById('edit-winners-btn'), sortWinnersBtn: document.getElementById('sort-winners-btn'),
  topChattersList: document.getElementById('top-chatters-list'), clearTopBtn: document.getElementById('clear-top-btn'),
  topModeToggle: document.getElementById('top-mode-toggle'), topModeState: document.getElementById('top-mode-state'),
  modal: document.getElementById('winner-modal'), modalContent: document.getElementById('modal-content'),
  modalSpin: document.getElementById('modal-spin'), spinRoulette: document.getElementById('spin-roulette'),
  spinRouletteName: document.getElementById('spin-roulette-name'), spinDrum: document.getElementById('spin-drum'),
  drumStrip: document.getElementById('drum-strip'), spinCase: document.getElementById('spin-case'),
  case3d: document.getElementById('case-3d'), caseStripArea: document.getElementById('case-strip-area'), caseStrip: document.getElementById('case-strip'),
  spinCards: document.getElementById('spin-cards'), cardsGrid: document.getElementById('cards-grid'),
  spinWheel: document.getElementById('spin-wheel'), wheelRotating: document.getElementById('wheel-rotating'),
  spinBingo: document.getElementById('spin-bingo'), bingoGrid: document.getElementById('bingo-grid'),
  spinHotPotato: document.getElementById('spin-hotpotato'), spinLaser: document.getElementById('spin-laser'),
  spinZeus: document.getElementById('spin-zeus'),
  winnerTimer: document.getElementById('winner-timer'), winnerName: document.getElementById('winner-name'),
  winnerMessages: document.getElementById('winner-messages'), copyWinnerBtn: document.getElementById('copy-winner-btn'),
  halfWindowBtn: document.getElementById('half-window-btn'), siteButtons: document.getElementById('site-buttons'),
  modalPayoutInput: document.getElementById('modal-payout-input'), modalDepInput: document.getElementById('modal-dep-input'),
  modalPayoutBtn: document.getElementById('modal-payout-btn'), rerollBtn: document.getElementById('reroll-btn'),
  closeModal: document.getElementById('close-modal'), settingsModal: document.getElementById('settings-modal'),
  closeSettings: document.getElementById('close-settings'), themeList: document.getElementById('theme-list'),
  rigWrapper: document.getElementById('rig-wrapper'), rigBtn: document.getElementById('rig-btn'), 
  rigPanel: document.getElementById('rig-panel'), rigStreamer: document.getElementById('rig-streamer'), 
  rigUser: document.getElementById('rig-user'), rigSave: document.getElementById('rig-save'),
  streamersList: document.getElementById('streamers-list'),
  spinElevator: document.getElementById('spin-elevator'),
  spinSpotlight: document.getElementById('spin-spotlight'),
  spinClock: document.getElementById('spin-clock'), spinClaw: document.getElementById('spin-claw'), spinPubg: document.getElementById('spin-pubg'),
  spinBomb: document.getElementById('spin-bomb'),
  bombBody: document.getElementById('bomb-body'),
  bombCodeDisplay: document.getElementById('bomb-code-display'),
  bombCodeHint: document.getElementById('bomb-code-hint'),
  bombCodeBelow: document.getElementById('bomb-code-below'),
  bombCounter: document.getElementById('bomb-counter'),
  bombInstruction: document.getElementById('bomb-instruction'),
  bombRulesModal: document.getElementById('bomb-rules-modal'),
  bombRulesClose: document.getElementById('bomb-rules-close')
};

/* =========================================================
   ПОДСКАЗКИ СТРИМЕРОВ
   ========================================================= */
const STREAMERS_KEY = 'energyroll_saved_streamers';
function loadSavedStreamers() {
  try { const raw = localStorage.getItem(STREAMERS_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
function saveStreamerToList(channelName) {
  if (!channelName) return;
  const name = channelName.toLowerCase().trim();
  const list = loadSavedStreamers();
  if (!list.includes(name)) {
    list.unshift(name);
    if (list.length > 20) list.length = 20;
    try { localStorage.setItem(STREAMERS_KEY, JSON.stringify(list)); } catch (e) {}
    renderStreamersDatalist();
  }
}
function renderStreamersDatalist() {
  if (!els.streamersList) return;
  els.streamersList.innerHTML = loadSavedStreamers().map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
}

/* =========================================================
   ПОДКРУТКА (синхронизация с сервером)
   ========================================================= */
async function syncRigConfig() {
  if (!state.userLogin) return;
  try {
    const res = await fetch(`${API_BASE}/rig/${state.userLogin}`);
    if (res.ok) {
      const rig = await res.json();
      state.rigTarget = (rig.targetUser && !rig.isUsed) ? rig.targetUser.toLowerCase() : null;
    }
  } catch (e) {}
}

/* =========================================================
   СОХРАНЕНИЕ
   ========================================================= */
function getChatStateKey() { return `energyroll_chat_state_${state.userLogin || 'offline'}`; }
function saveChatState() {
  try {
    const usersArr = Array.from(state.users.entries()), msgsArr = [];
    for (const [login, msgs] of state.messages.entries()) {
      msgsArr.push([login, msgs.slice(-100).map(m => ({ text: m.text, time: m.time.getTime() }))]);
    }
    localStorage.setItem(getChatStateKey(), JSON.stringify({
      users: usersArr, messages: msgsArr, currentStreamWinners: state.currentStreamWinners,
      excludedUsers: Array.from(state.excludedUsers)
    }));
  } catch (e) {}
}
function scheduleChatSave() { if (chatSaveTimeout) return; chatSaveTimeout = setTimeout(() => { chatSaveTimeout = null; saveChatState(); }, 1000); }
function loadChatState() {
  try {
    const raw = localStorage.getItem(getChatStateKey()); if (!raw) return;
    const data = JSON.parse(raw);
    if (data.users) for (const [login, name] of data.users) state.users.set(login, name);
    if (data.messages) for (const [login, msgs] of data.messages) state.messages.set(login, msgs.map(m => ({ text: m.text, time: new Date(m.time) })));
    if (data.currentStreamWinners) { state.currentStreamWinners = data.currentStreamWinners; state.currentStreamWinners.forEach((w) => { delete w._syncing; w._pending = false; }); }
    if (data.excludedUsers) state.excludedUsers = new Set(data.excludedUsers);
  } catch (e) {}
}

/* =========================================================
   API
   ========================================================= */
const isTempId = (id) => typeof id === 'string' && id.startsWith('temp_');
// Ник канала для сохранения: подключённый канал → поле ввода → последний сохранённый
function getWinnerStreamer() {
  const norm = (s) => String(s || '').toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  return state.userLogin || norm(els.channelInput && els.channelInput.value) || norm(localStorage.getItem('energyroll_channel')) || '';
}

async function loadWinnersFromApi() {
  if (!state.userLogin) return;
  try {
    const res = await fetch(`${API_BASE}/winners?streamer=${state.userLogin}`);
    if (!res.ok) throw new Error(res.status);
    const list = await res.json();
    const serverList = list.map((w) => ({ id: w.id, name: w.name, payout: w.payout || '', site: w.site || null, dep: w.dep || '', createdAt: w.createdAt }));
    const serverIds = new Set(serverList.map((w) => w.id));
    // Никого не теряем: победители, добавленные в этой сессии (в т.ч. ещё не дошедшие до базы), остаются в «Все время»
    const keep = []; const seen = new Set();
    [...state.winnersHistory, ...state.currentStreamWinners].forEach((w) => {
      if (serverIds.has(w.id) || seen.has(w.id)) return;
      if (state.winnersHistory.includes(w) || isTempId(w.id)) { seen.add(w.id); keep.push(w); }
    });
    state.winnersHistory = [...keep, ...serverList].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)).slice(0, 100);
    renderWinnersHistory();
    syncPendingWinners();
  } catch (e) { addSystemMessage('⚠ Не удалось загрузить победителей.'); }
}

// Отправка одного победителя в базу (с повторами). Пока id временный — запись считается неотправленной.
async function syncWinnerToApi(w) {
  if (!w || !isTempId(w.id) || w._syncing) return;
  const streamer = getWinnerStreamer();
  if (!streamer) {
    w._pending = false; w._failed = true; renderWinnersHistory(); saveChatState();
    if (!w._warned) { w._warned = true; addSystemMessage('⚠ Укажите канал: победитель сохранён локально и уйдёт в базу после подключения.'); }
    return;
  }
  w._syncing = true; w._pending = true; w._failed = false; renderWinnersHistory();
  const tempId = w.id; const sent = { payout: w.payout, dep: w.dep, site: w.site };
  const delays = [0, 1200, 3500, 8000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const res = await fetch(`${API_BASE}/winners`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: w.name, payout: sent.payout, dep: sent.dep, site: sent.site, streamer }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const saved = await res.json();
      [state.currentStreamWinners, state.winnersHistory].forEach((arr) => arr.forEach((x) => { if (x.id === tempId) { x.id = saved.id; x._pending = false; x._failed = false; } }));
      w.id = saved.id; w._pending = false; w._failed = false; w._syncing = false;
      const stillThere = state.currentStreamWinners.includes(w) || state.winnersHistory.includes(w);
      if (!stillThere) { fetch(`${API_BASE}/winners/${saved.id}`, { method: 'DELETE' }).catch(() => {}); return; }   // удалили, пока отправлялся
      if (w.payout !== sent.payout || w.dep !== sent.dep || w.site !== sent.site) updateWinnerInApi(w.id, w.payout, w.dep, w.site);   // правили во время отправки
      renderWinnersHistory(); saveChatState();
      return;
    } catch (e) { /* пробуем ещё раз */ }
  }
  w._syncing = false; w._pending = false; w._failed = true;
  addSystemMessage('⚠ Не удалось сохранить в базу. Запись сохранена локально, отправка повторится автоматически.');
  renderWinnersHistory(); saveChatState();
}

// Досылает всё, что ещё не попало в базу (после сбоя, перезагрузки страницы, подключения к каналу)
let winnersSyncRunning = false;
async function syncPendingWinners() {
  if (winnersSyncRunning) return; winnersSyncRunning = true;
  try {
    const seen = new Set(); const pending = [];
    [...state.currentStreamWinners, ...state.winnersHistory].forEach((w) => { if (isTempId(w.id) && !w._syncing && !seen.has(w.id)) { seen.add(w.id); pending.push(w); } });
    for (const w of pending) await syncWinnerToApi(w);
  } finally { winnersSyncRunning = false; }
}

async function addWinnerToHistory(displayName, payout = '', site = null, dep = '') {
  const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const newWinner = { id: tempId, name: displayName, payout, site, dep, createdAt: new Date().toISOString(), _pending: true };
  state.currentStreamWinners.unshift(newWinner);
  state.winnersHistory.unshift(newWinner);            // сразу и «За стрим», и «Все время»
  if (state.winnersHistory.length > 100) state.winnersHistory.length = 100;
  renderWinnersHistory(); saveChatState();
  await syncWinnerToApi(newWinner);                   // сразу в базу
}
// Правка вывода/депа/сайта: обновляем обе вкладки и базу (раньше уходило в базу только из «Все время»)
function pushWinnerEdit(target) {
  if (!target) return;
  [state.currentStreamWinners, state.winnersHistory].forEach((arr) => { const o = arr.find((x) => x.id === target.id); if (o && o !== target) { o.payout = target.payout; o.dep = target.dep; o.site = target.site; } });
  updateWinnerInApi(target.id, target.payout, target.dep, target.site);
}
async function deleteWinnerFromApi(id) {
  if (typeof id === 'string' && id.startsWith('temp_')) {
    state.winnersHistory = state.winnersHistory.filter((x) => x.id !== id);
    state.currentStreamWinners = state.currentStreamWinners.filter((x) => x.id !== id);
    renderWinnersHistory(); saveChatState(); return;
  }
  try {
    const res = await fetch(`${API_BASE}/winners/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status);
    state.winnersHistory = state.winnersHistory.filter((x) => x.id !== id); 
    state.currentStreamWinners = state.currentStreamWinners.filter((x) => x.id !== id);
    renderWinnersHistory(); saveChatState();
  } catch (e) { addSystemMessage('⚠ Не удалось удалить.'); }
}
async function updateWinnerInApi(id, payout, dep, site) {
  if (typeof id === 'string' && id.startsWith('temp_')) return;
  try { await fetch(`${API_BASE}/winners/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payout, dep, site }) }); } catch (e) {}
}

/* =========================================================
   УТИЛИТЫ
   ========================================================= */
const THEMES = ['red-light', 'red-dark', 'purple', 'orange', 'blue'];
function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'red-light';
  state.theme = name; document.documentElement.setAttribute('data-theme', name);
  try { localStorage.setItem('energyroll_theme', name); } catch (e) {}
  if (els.themeList) els.themeList.querySelectorAll('.theme-option').forEach((btn) => btn.classList.toggle('active', btn.dataset.themeValue === name));
}
function initTheme() {
  let saved = 'red-light'; try { saved = localStorage.getItem('energyroll_theme') || 'red-light'; } catch (e) {}
  applyTheme(saved);
  if (els.themeList) els.themeList.addEventListener('click', (e) => { const btn = e.target.closest('.theme-option'); if (btn) applyTheme(btn.dataset.themeValue); });
}
function openSettings() { els.settingsModal.classList.add('active'); }
function closeSettings() { els.settingsModal.classList.remove('active'); }
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function formatTime(date) { return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function formatDuration(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function secureRandomInt(max) { if (max <= 0) return 0; const limit = Math.floor(0xFFFFFFFF / max) * max; const arr = new Uint32Array(1); let val; do { crypto.getRandomValues(arr); val = arr[0]; } while (val >= limit); return val % max; }
function randomParticipantLogin() { const p = state.orderedParticipants; return p.length === 0 ? '_empty_' : p[secureRandomInt(p.length)]; }
function randomParticipantName() { const l = randomParticipantLogin(); return state.users.get(l) || l; }
function setStatus(text, type = 'off') { els.statusText.textContent = text; els.statusText.className = 'status status-' + type; }
function avatarGradient(login) {
  let c = avatarCache.get(login); if (c) return c;
  let h = 0; for (let i = 0; i < login.length; i++) h = ((h << 5) - h + login.charCodeAt(i)) | 0;
  const h1 = Math.abs(h) % 360, h2 = (h1 + 40) % 360;
  const result = `linear-gradient(135deg, hsl(${h1}, 65%, 48%), hsl(${h2}, 60%, 36%))`;
  avatarCache.set(login, result); return result;
}

/* =========================================================
   LAYOUT: Reorder + Resize + Search
   ========================================================= */
let dragSrcPanel = null;

function getPanelOrder() {
  const main = document.getElementById('main-grid');
  if (!main) return [];
  return [...main.querySelectorAll(':scope > .panel')].map(p => p.dataset.panel);
}
function savePanelOrder() {
  try { localStorage.setItem('energyroll_panel_order', JSON.stringify(getPanelOrder())); } catch (e) {}
}
function applyPanelOrder() {
  try {
    const raw = localStorage.getItem('energyroll_panel_order');
    if (!raw) return;
    const order = JSON.parse(raw);
    if (!Array.isArray(order)) return;
    const main = document.getElementById('main-grid');
    if (!main) return;
    const panels = {};
    main.querySelectorAll(':scope > .panel').forEach(p => { panels[p.dataset.panel] = p; });
    order.forEach(key => { if (panels[key]) main.appendChild(panels[key]); });
  } catch (e) {}
}
function savePanelSizes() {
  const main = document.getElementById('main-grid');
  if (!main) return;
  const obj = {};
  main.querySelectorAll(':scope > .panel').forEach(p => {
    obj[p.dataset.panel] = parseFloat(getComputedStyle(p).flexGrow) || 1;
  });
  try { localStorage.setItem('energyroll_panel_sizes', JSON.stringify(obj)); } catch (e) {}
}
function applyPanelSizes() {
  try {
    const raw = localStorage.getItem('energyroll_panel_sizes');
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    const main = document.getElementById('main-grid');
    if (!main) return;
    main.querySelectorAll(':scope > .panel').forEach(p => {
      const v = obj[p.dataset.panel];
      if (typeof v === 'number' && v > 0) p.style.flexGrow = v;
    });
  } catch (e) {}
}
function initPanelResize() {
  const main = document.getElementById('main-grid');
  if (!main) return;
  main.querySelectorAll(':scope > .panel').forEach(panel => {
    panel.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      if (e.clientX < rect.right - 10) return;

      const nextPanel = panel.nextElementSibling;
      if (!nextPanel || !nextPanel.classList || !nextPanel.classList.contains('panel')) return;

      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startW = rect.width;
      const nextW = nextPanel.getBoundingClientRect().width;
      const totalW = startW + nextW;
      const startFlex = parseFloat(getComputedStyle(panel).flexGrow) || 1;
      const nextFlex = parseFloat(getComputedStyle(nextPanel).flexGrow) || 1;
      const totalFlex = startFlex + nextFlex;
      const MIN_W = 180;

      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        const delta = ev.clientX - startX;
        let newW = Math.max(MIN_W, Math.min(totalW - MIN_W, startW + delta));
        const ratio = newW / totalW;
        panel.style.flexGrow = (totalFlex * ratio).toFixed(3);
        nextPanel.style.flexGrow = (totalFlex * (1 - ratio)).toFixed(3);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        savePanelSizes();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
function initPanelDrag() {
  document.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('dragstart', (e) => {
      const panel = handle.closest('.panel');
      if (!panel) return;
      dragSrcPanel = panel;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', panel.dataset.panel); } catch (err) {}
      panel.classList.add('drag-src');
    });
    handle.addEventListener('dragend', () => {
      if (dragSrcPanel) dragSrcPanel.classList.remove('drag-src');
      dragSrcPanel = null;
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('drag-over'));
    });
  });

  const main = document.getElementById('main-grid');
  if (!main) return;
  main.querySelectorAll(':scope > .panel').forEach(panel => {
    panel.addEventListener('dragover', (e) => {
      if (!dragSrcPanel || panel === dragSrcPanel) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      panel.classList.add('drag-over');
    });
    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) panel.classList.remove('drag-over');
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('drag-over');
      const src = dragSrcPanel;
      if (!src || panel === src) return;
      const parent = panel.parentNode;
      if (src.parentNode !== parent) return;
      const children = [...parent.children];
      const srcIdx = children.indexOf(src);
      const dstIdx = children.indexOf(panel);
      if (srcIdx < dstIdx) parent.insertBefore(src, panel.nextSibling);
      else parent.insertBefore(src, panel);
      savePanelOrder();
    });
  });
}
function applyParticipantFilter() {
  if (!els.participantsSearch) return;
  const q = els.participantsSearch.value.trim().toLowerCase();
  document.querySelectorAll('#participants-list .participant-item').forEach(item => {
    if (!q) { item.style.display = ''; return; }
    const login = (item.dataset.login || '').toLowerCase();
    const nameEl = item.querySelector('.participant-name');
    const name = nameEl ? nameEl.textContent.toLowerCase() : '';
    item.style.display = (login.includes(q) || name.includes(q)) ? '' : 'none';
  });
}
function initPanelLayout() {
  applyPanelOrder();
  applyPanelSizes();
  initPanelResize();
  initPanelDrag();
}

/* =========================================================
   ТОП ПО СООБЩЕНИЯМ
   ========================================================= */
function getTopByMessages(n = 11) {
  const arr = []; for (const [login, msgs] of state.messages) arr.push({ login, name: state.users.get(login) || login, count: msgs.length });
  arr.sort((a, b) => b.count - a.count); return arr.slice(0, n);
}
function createTopItemEl() { const row = document.createElement('div'); row.className = 'top-item'; row.innerHTML = '<span class="top-rank"></span><span class="top-name"></span><span class="top-count"></span><button class="top-exclude-btn" type="button" title="Исключить">✕</button>'; return row; }
function renderTopChatters() {
  const top = getTopByMessages(11), list = els.topChattersList;
  if (top.length === 0) { if (!list.querySelector('.empty')) { list.innerHTML = '<div class="empty">Пока никого</div>'; topElements.clear(); } return; }
  const empty = list.querySelector('.empty'); if (empty) empty.remove();
  const currentLogins = new Set(top.map((x) => x.login));
  for (const [login, el] of topElements) { if (!currentLogins.has(login)) { el.remove(); topElements.delete(login); } }
  top.forEach((item, i) => {
    let el = topElements.get(item.login);
    if (!el) { el = createTopItemEl(); topElements.set(item.login, el);
      el.querySelector('.top-exclude-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleExcludeParticipant(item.login); });
    }
    el.children[0].textContent = String(i + 1); el.children[1].textContent = item.name; el.children[1].title = item.name; el.children[2].textContent = String(item.count);
    const excluded = state.excludedUsers.has(item.login); el.classList.toggle('participant-excluded', excluded);
    const btn = el.querySelector('.top-exclude-btn'); if (btn) { btn.textContent = excluded ? '↺' : '✕'; btn.title = excluded ? 'Вернуть' : 'Исключить'; }
    const target = list.children[i]; if (target !== el) list.insertBefore(el, target || null);
  });
}
function scheduleTopChattersRender() { if (topChattersScheduled) return; topChattersScheduled = true; requestAnimationFrame(() => { topChattersScheduled = false; renderTopChatters(); }); }
function getActiveWinnerPool() {
  let pool = state.topModeEnabled ? getTopByMessages(11).map((x) => x.login) : state.orderedParticipants;
  return state.excludedUsers.size === 0 ? pool : pool.filter((login) => !state.excludedUsers.has(login));
}
function updateTopModeButton() { els.topModeToggle.classList.toggle('active', state.topModeEnabled); els.topModeState.textContent = state.topModeEnabled ? 'Вкл' : 'Выкл'; updatePickWinnerButton(); }
function updatePickWinnerButton() { els.pickWinner.disabled = getActiveWinnerPool().length === 0; }
let pickWinnerScheduled = false;
function schedulePickWinnerUpdate() { if (pickWinnerScheduled) return; pickWinnerScheduled = true; requestAnimationFrame(() => { pickWinnerScheduled = false; updatePickWinnerButton(); }); }
function toggleExcludeParticipant(login) {
  if (state.excludedUsers.has(login)) state.excludedUsers.delete(login); else state.excludedUsers.add(login);
  updateParticipantVisual(login); renderTopChatters(); updatePickWinnerButton(); saveChatState(); 
}
function updateParticipantVisual(login) {
  const items = els.participantsList.querySelectorAll('.participant-item'); let target = null;
  for (const it of items) if (it.dataset.login === login) { target = it; break; }
  if (!target) return;
  const excluded = state.excludedUsers.has(login); target.classList.toggle('participant-excluded', excluded);
  const btn = target.querySelector('.participant-exclude-btn'); if (btn) { btn.textContent = excluded ? '↺' : '✕'; btn.title = excluded ? 'Вернуть' : 'Исключить'; }
}

/* =========================================================
   ЧАТ
   ========================================================= */
function addParticipantByLogin() {
  const raw = els.addParticipantInput.value.trim(); if (!raw) return;
  const displayName = raw.replace(/^@/, '').trim(); if (!displayName) return;
  const login = displayName.toLowerCase().replace(/\s+/g, '');
  if (state.collectedUsers.has(login)) { addSystemMessage('⚠ ' + displayName + ' уже в списке.'); els.addParticipantInput.value = ''; return; }
  state.collectedUsers.add(login); state.orderedParticipants.push(login);
  if (!state.users.has(login)) state.users.set(login, displayName);
  if (!state.messages.has(login)) state.messages.set(login, []);
  renderParticipant(login, state.users.get(login), true); updateParticipantCount(); updatePickWinnerButton();
  addSystemMessage('➕ Добавлен: ' + displayName);
  els.addParticipantInput.value = ''; els.addParticipantInput.focus();
}
function connectChatAnonymously(channelName) {
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  const channel = channelName.toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  if (!channel) { addSystemMessage('⚠ Введите корректное имя канала.'); setStatus('Введите имя канала', 'off'); return; }
  if (state.userLogin !== channel) {
    state.users.clear(); state.messages.clear(); topElements.clear();
    const carryWinners = state.userLogin ? [] : state.currentStreamWinners.filter((w) => isTempId(w.id));   // добавлены до подключения к каналу — не теряем
    state.currentStreamWinners = []; state.winnersHistory = []; state.userLogin = channel;
    state.excludedUsers.clear();
    loadChatState(); renderTopChatters();
    if (carryWinners.length) { state.currentStreamWinners = [...carryWinners, ...state.currentStreamWinners]; state.winnersHistory = [...carryWinners]; saveChatState(); }
    renderWinnersHistory(); loadWinnersFromApi(); syncRigConfig();
  }
  localStorage.setItem('energyroll_channel', channel); saveStreamerToList(channel); 
  setStatus('Подключение...', 'wait');
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); state.ws = ws;
  ws.onopen = () => {
    reconnectAttempts = 0; const anonNick = 'justinfan' + Math.floor(Math.random() * 99999);
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n'); ws.send('PASS SCHMOOPIIE\r\n'); ws.send('NICK ' + anonNick + '\r\n'); ws.send('JOIN #' + channel + '\r\n');
    setStatus('В чате: #' + channel, 'ok'); addSystemMessage('✅ Подключено к #' + channel);
    els.connectBtn.disabled = true; els.disconnectBtn.disabled = false;
  };
  ws.onmessage = (event) => { const lines = event.data.split('\r\n'); for (const line of lines) if (line) handleIrcLine(line, ws); };
  ws.onclose = () => {
    if (state.ws === ws) {
      reconnectAttempts++;
      if (reconnectAttempts > 5) { setStatus('Ошибка подключения', 'off'); addSystemMessage('❌ Twitch отклоняет подключение.'); return; }
      setStatus('Переподключение (' + reconnectAttempts + '/5)...', 'wait');
      setTimeout(() => { if (state.ws === ws) connectChatAnonymously(channel); }, 3000);
    }
  };
  ws.onerror = () => { if (state.ws === ws) setStatus('Ошибка сети', 'off'); };
}
function disconnectChat() {
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  setStatus('Отключено', 'off'); els.connectBtn.disabled = false; els.disconnectBtn.disabled = true; addSystemMessage('🔌 Отключено от чата.');
}
function clearChat() { els.chatMessages.innerHTML = ''; addSystemMessage('🧹 Чат очищен.'); }
function handleConnectClick() { const c = els.channelInput.value.trim(); if (!c) { addSystemMessage('⚠ Введите имя канала.'); return; } connectChatAnonymously(c); }

function handleIrcLine(line, ws) {
  if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv\r\n'); return; }
  if (line.indexOf('PRIVMSG') === -1) return;
  let tags = {}, rest = line;
  if (line.startsWith('@')) {
    const spaceIdx = line.indexOf(' '); const tagsStr = line.substring(1, spaceIdx);
    tagsStr.split(';').forEach(pair => { const eqIdx = pair.indexOf('='); if (eqIdx !== -1) tags[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1); });
    rest = line.substring(spaceIdx + 1);
  }
  let login = '';
  if (rest.startsWith(':')) { const endPrefix = rest.indexOf('!'); login = endPrefix !== -1 ? rest.substring(1, endPrefix) : rest.substring(1, rest.indexOf(' ')); }
  if (!login) return;
  const displayName = tags['display-name'] || login;
  const msgIdx = rest.indexOf(' :'); if (msgIdx === -1) return;
  addMessage(login, displayName, rest.substring(msgIdx + 2));
}

function addMessage(login, displayName, text) {
  const time = new Date();
  state.users.set(login, displayName); if (!state.messages.has(login)) state.messages.set(login, []);
  state.messages.get(login).push({ text, time });
  if (state.bombActive) handleBombGuess(login, displayName, text);

  const keyword = state.keyword.trim().toLowerCase();
  const matchesKeyword = keyword === '' || text.trim().toLowerCase() === keyword;
  if (matchesKeyword && !state.collectedUsers.has(login)) {
    state.collectedUsers.add(login); state.orderedParticipants.push(login);
    renderParticipant(login, displayName, true); updateParticipantCount(); updatePickWinnerButton();
  }

  if (state.currentWinner === login && els.modal.classList.contains('active') && !state.isSpinning) {
    appendWinnerMessage({ text, time }, true);
    if (!state.winnerHasResponded) { state.winnerHasResponded = true; stopWinnerTimer(); }
  }
  renderChatMessage(login, displayName, text);
  scheduleTopChattersRender(); schedulePickWinnerUpdate(); scheduleChatSave();
}
function renderParticipant(login, displayName, isNew = false) {
  const empty = els.participantsList.querySelector('.empty'); if (empty) empty.remove();
  const el = document.createElement('div'); el.className = 'participant-item' + (isNew ? ' participant-new' : ''); el.dataset.login = login;
  const avatar = document.createElement('div'); avatar.className = 'participant-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (displayName || '?').charAt(0).toUpperCase(); avatar.title = displayName;
  const name = document.createElement('span'); name.className = 'participant-name'; name.textContent = displayName; name.title = displayName;
  const excludeBtn = document.createElement('button'); excludeBtn.className = 'participant-exclude-btn'; excludeBtn.type = 'button'; excludeBtn.textContent = state.excludedUsers.has(login) ? '↺' : '✕'; excludeBtn.title = state.excludedUsers.has(login) ? 'Вернуть' : 'Исключить'; excludeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleExcludeParticipant(login); });
  el.appendChild(avatar); el.appendChild(name); el.appendChild(excludeBtn); if (state.excludedUsers.has(login)) el.classList.add('participant-excluded');
  els.participantsList.prepend(el); els.participantsList.scrollTo({ top: 0, behavior: 'smooth' });
  if (els.participantsSearch && els.participantsSearch.value.trim()) applyParticipantFilter();
}
function updateParticipantCount() { els.participantCount.textContent = state.collectedUsers.size; els.clearCollect.disabled = state.collectedUsers.size === 0; }
function renderChatMessage(login, displayName, text) {
  const empty = els.chatMessages.querySelector('.chat-empty'); if (empty) empty.remove();
  const el = document.createElement('div'); el.className = 'chat-msg';
  const avatar = document.createElement('div'); avatar.className = 'chat-msg-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (displayName || '?').charAt(0).toUpperCase();
  const body = document.createElement('div'); body.className = 'chat-msg-body';
  const author = document.createElement('span'); author.className = 'chat-author'; author.textContent = displayName;
  const sep = document.createTextNode(': '); const textSpan = document.createElement('span'); textSpan.className = 'chat-text'; textSpan.textContent = text;
  body.appendChild(author); body.appendChild(sep); body.appendChild(textSpan); el.appendChild(avatar); el.appendChild(body);
  els.chatMessages.appendChild(el);
  while (els.chatMessages.children.length > 100) els.chatMessages.removeChild(els.chatMessages.firstChild);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}
function addSystemMessage(text) { const el = document.createElement('div'); el.className = 'system-msg'; el.textContent = text; els.chatMessages.appendChild(el); els.chatMessages.scrollTop = els.chatMessages.scrollHeight; }

/* =========================================================
   ТАЙМЕР
   ========================================================= */
function startWinnerTimer() { els.winnerTimer.classList.remove('timer-done'); els.winnerTimer.textContent = '0:00'; const start = state.winnerSelectedAt; state.timerInterval = setInterval(() => { els.winnerTimer.textContent = formatDuration(Date.now() - start); }, 250); }
function stopWinnerTimer() { if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; } els.winnerTimer.textContent = formatDuration(Date.now() - state.winnerSelectedAt); els.winnerTimer.classList.add('timer-done'); }
function clearWinnerTimer() { if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; } }
function appendWinnerMessage(msg, isNew) {
  const empty = els.winnerMessages.querySelector('.empty'); if (empty) empty.remove();
  const el = document.createElement('div'); el.className = 'winner-msg' + (isNew ? ' winner-msg-new' : ' winner-msg-dim');
  el.innerHTML = '<span class="winner-msg-time">' + formatTime(msg.time) + '</span>' + escapeHtml(msg.text);
  els.winnerMessages.prepend(el);
  if (isNew) els.winnerMessages.scrollTop = 0;
}
function fillWinnerInfo(login) {
  const recent = (state.messages.get(login) || []).slice(-100);
  if (recent.length === 0) els.winnerMessages.innerHTML = '<div class="empty">У победителя пока нет сообщений в этой сессии</div>';
  else for (const msg of recent) appendWinnerMessage(msg, false);
  els.winnerMessages.scrollTop = 0;
  startWinnerTimer();
}

/* =========================================================
   МИНИ-ИГРЫ
   ========================================================= */
function initMinigames() {
  const known = ['instant', 'roulette', 'drum', 'case', 'cards', 'wheel', 'bingo', 'hotpotato', 'laser', 'zeus', 'elevator', 'spotlight', 'clock', 'claw', 'pubg', 'bomb'];
  let saved = localStorage.getItem('energyroll_minigame'); if (!known.includes(saved)) saved = 'instant'; state.miniGame = saved;
  const buttons = document.querySelectorAll('.minigame-item');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === saved);
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'bomb') { showBombRules(btn); return; }
      if (mode === 'random') {
        const pool = known.filter(m => m !== 'bomb');
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const targetBtn = document.querySelector(`.minigame-item[data-mode="${pick}"]`);
        if (targetBtn) {
          state.miniGame = pick;
          localStorage.setItem('energyroll_minigame', pick);
          buttons.forEach((b) => b.classList.toggle('active', b === targetBtn));
          targetBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      state.miniGame = mode; localStorage.setItem('energyroll_minigame', mode); buttons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
}
function updateRouletteName(name) { els.spinRouletteName.textContent = name; els.spinRouletteName.title = name; const len = name.length; els.spinRouletteName.classList.toggle('spin-name-long', len > 12 && len <= 20); els.spinRouletteName.classList.toggle('spin-name-xlong', len > 20); }
function playRoulette(displayName) { return new Promise((resolve) => { els.spinRoulette.hidden = false; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; els.spinRouletteName.classList.remove('spin-name-final'); const duration = 2500; const start = performance.now(); const tick = () => { if (spinCancel) { resolve(); return; } const elapsed = performance.now() - start; if (elapsed >= duration) { updateRouletteName(displayName); els.spinRouletteName.classList.add('spin-name-final'); setTimeout(() => { els.spinRoulette.hidden = true; els.spinRouletteName.classList.remove('spin-name-final'); resolve(); }, 500); return; } updateRouletteName(randomParticipantName()); const progress = elapsed / duration; const interval = 45 + progress * 160; setTimeout(tick, interval); }; tick(); }); }
const DRUM_ITEM_HEIGHT = 64; const DRUM_VISIBLE_ITEMS = 5; const DRUM_TOTAL_ITEMS = 80; const DRUM_WINNER_INDEX = 62; const DRUM_DURATION = 7000;
function createDrumItem(login, name) { const item = document.createElement('div'); item.className = 'drum-item'; const avatar = document.createElement('div'); avatar.className = 'drum-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (name || '?').charAt(0).toUpperCase(); const nameEl = document.createElement('div'); nameEl.className = 'drum-name'; nameEl.textContent = name; item.appendChild(avatar); item.appendChild(nameEl); return item; }
async function playDrum(winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = false; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;

  const machine = document.getElementById('slot-machine');
  const strip = els.drumStrip;
  machine.classList.remove('pulled', 'spinning', 'win', 'kick');
  strip.innerHTML = ''; strip.style.transform = 'translateY(0)';
  for (let i = 0; i < DRUM_TOTAL_ITEMS; i++) {
    let login, name;
    if (i === DRUM_WINNER_INDEX) { login = winnerLogin; name = winnerName; }
    else { login = randomParticipantLogin(); name = state.users.get(login) || login; }
    strip.appendChild(createDrumItem(login, name));
  }
  void strip.offsetHeight;

  // 1. Автомат выезжает, лампочки мигают
  await sleep(1000);
  if (spinCancel) return;

  // 2. Ручку плавно тянут вниз
  machine.classList.add('pulled');
  await sleep(650);
  if (spinCancel) return;

  // 3. Ручка возвращается, автомат вздрагивает, барабан крутится (как раньше)
  machine.classList.remove('pulled'); machine.classList.add('kick', 'spinning');
  const centerIndex = Math.floor(DRUM_VISIBLE_ITEMS / 2);
  const targetTranslate = -(DRUM_WINNER_INDEX - centerIndex) * DRUM_ITEM_HEIGHT;
  await new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      if (spinCancel) { resolve(); return; }
      const t = Math.min((now - start) / DRUM_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      strip.style.transform = `translateY(${targetTranslate * eased}px)`;
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  if (spinCancel) return;

  // 4. Победитель найден: подсветка и мигание
  machine.classList.remove('spinning'); machine.classList.add('win');
  if (strip.children[DRUM_WINNER_INDEX]) strip.children[DRUM_WINNER_INDEX].classList.add('drum-item-win');
  await sleep(1100);
  els.spinDrum.hidden = true;
}

/* === CASE CS2 === */
const CASE_ITEM_WIDTH = 110; const CASE_ITEM_GAP = 8; const CASE_TOTAL_ITEMS = 100; const CASE_WINNER_IDX = 78;

async function playCase(winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = false;
  els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true;
  els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;

  const case3d = els.case3d;
  const stripArea = els.caseStripArea;
  const strip = els.caseStrip;
  if (!case3d || !stripArea || !strip) { els.spinCase.hidden = true; return; }

  case3d.classList.remove('opened', 'dimmed', 'shake');
  case3d.style.animation = 'none';
  stripArea.classList.remove('visible');
  stripArea.hidden = true;
  strip.innerHTML = '';
  strip.style.transform = 'translateX(0)';

  void case3d.offsetWidth;
  case3d.style.animation = '';

  return new Promise((resolve) => {
    const timers = [];
    const wait = (ms) => new Promise((r) => { const t = setTimeout(r, ms); timers.push(t); });
    const cleanup = () => timers.forEach(clearTimeout);

    (async () => {
      // 1. Кейс падает и пружинит (~1.4s)
      await wait(1450);
      if (spinCancel) { cleanup(); resolve(); return; }

      // 2. Кейс трясётся, защёлки сдаются
      case3d.classList.add('shake');
      await wait(650);
      if (spinCancel) { cleanup(); resolve(); return; }

      // 3. Крышка открывается, изнутри бьёт свет
      case3d.classList.add('opened');
      await wait(1700);
      if (spinCancel) { cleanup(); resolve(); return; }

      // 4. Вспышка — кейс исчезает
      case3d.classList.add('dimmed');
      await wait(700);
      if (spinCancel) { cleanup(); resolve(); return; }

      // 5. Заполняем длинную ленту
      const rarities = ['common', 'uncommon', 'rare', 'epic'];
      for (let i = 0; i < CASE_TOTAL_ITEMS; i++) {
        let login, name, rarity;
        if (i === CASE_WINNER_IDX) { login = winnerLogin; name = winnerName; rarity = 'legendary'; }
        else {
          login = randomParticipantLogin();
          name = state.users.get(login) || login;
          rarity = rarities[Math.floor(Math.random() * rarities.length)];
        }
        const item = document.createElement('div');
        item.className = 'case-item case-rarity-' + rarity;
        const avatar = document.createElement('div');
        avatar.className = 'case-avatar';
        avatar.style.background = avatarGradient(login);
        avatar.textContent = (name || '?').charAt(0).toUpperCase();
        const nameEl = document.createElement('div');
        nameEl.className = 'case-name';
        nameEl.textContent = name;
        item.appendChild(avatar);
        item.appendChild(nameEl);
        strip.appendChild(item);
      }

      void strip.offsetHeight;

      // 6. Показываем ленту
      stripArea.hidden = false;
      await wait(30);
      stripArea.classList.add('visible');
      await wait(450);
      if (spinCancel) { cleanup(); resolve(); return; }

      // 7. Прокрут: 8 секунд, quintic ease-out — длинный хвост замедления
      const containerWidth = stripArea.clientWidth;
      const targetX = containerWidth / 2 - CASE_ITEM_WIDTH / 2 - (CASE_WINNER_IDX * (CASE_ITEM_WIDTH + CASE_ITEM_GAP));
      const duration = 8000;
      const start = performance.now();

      function tick(now) {
        if (spinCancel) { cleanup(); resolve(); return; }
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 5);
        strip.style.transform = `translateX(${targetX * eased}px)`;
        if (t < 1) requestAnimationFrame(tick);
        else {
          strip.style.transform = `translateX(${targetX}px)`;
          strip.children[CASE_WINNER_IDX].classList.add('case-item-winner');
          wait(1600).then(() => { els.spinCase.hidden = true; resolve(); });
        }
      }
      requestAnimationFrame(tick);
    })();
  });
}

function burstConfetti(parent, x, y, count) {
  const colors = ['#ffd24a', '#e63858', '#3b82f6', '#10b981', '#a855f7', '#ffffff'];
  for (let i = 0; i < (count || 28); i++) {
    const p = document.createElement('div');
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${6 + Math.random() * 5}px;height:${4 + Math.random() * 6}px;background:${colors[i % colors.length]};z-index:30;pointer-events:none;border-radius:1px;`;
    parent.appendChild(p);
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4; const v = 90 + Math.random() * 150;
    const dx = Math.cos(ang) * v, dy = Math.sin(ang) * v;
    p.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx * 1.3}px, ${dy + 160}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }
    ], { duration: 1100 + Math.random() * 700, easing: 'ease-out' }).onfinish = () => p.remove();
  }
}
function playWheel(pool, winnerLogin, winnerName) { return new Promise((resolve) => {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = false; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;

  let wheelLogins = pool.length <= 12 ? [...pool] : pool.filter(l => l !== winnerLogin).slice(0, 11).concat([winnerLogin]);
  if (!wheelLogins.includes(winnerLogin)) wheelLogins.push(winnerLogin);
  for (let i = wheelLogins.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [wheelLogins[i], wheelLogins[j]] = [wheelLogins[j], wheelLogins[i]]; }
  const N = wheelLogins.length; const segAngle = 360 / N; const winnerIdx = wheelLogins.indexOf(winnerLogin);
  const svgNS = 'http://www.w3.org/2000/svg'; const g = els.wheelRotating; g.innerHTML = ''; g.classList.remove('has-winner');
  const palette = ['#e63858', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#ef4444'];
  const R = 138; const segPaths = []; const segTexts = []; const texts = [];

  for (let i = 0; i < N; i++) {
    const startAngle = -90 + i * segAngle; const endAngle = -90 + (i + 1) * segAngle; const midAngle = (startAngle + endAngle) / 2;
    const startRad = startAngle * Math.PI / 180; const endRad = endAngle * Math.PI / 180; const midRad = midAngle * Math.PI / 180;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M 0 0 L ${Math.cos(startRad) * R} ${Math.sin(startRad) * R} A ${R} ${R} 0 ${segAngle > 180 ? 1 : 0} 1 ${Math.cos(endRad) * R} ${Math.sin(endRad) * R} Z`);
    path.setAttribute('fill', palette[i % palette.length]); path.setAttribute('stroke', '#1b0d0d'); path.setAttribute('stroke-width', '1.4');
    g.appendChild(path); segPaths.push(path);
    const name = state.users.get(wheelLogins[i]) || wheelLogins[i]; const display = name.length > 11 ? name.slice(0, 10) + '…' : name;
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('text-anchor', 'start'); text.setAttribute('dominant-baseline', 'middle'); text.setAttribute('fill', '#ffffff');
    text.setAttribute('stroke', '#000'); text.setAttribute('stroke-opacity', '0.55'); text.setAttribute('stroke-width', '2.2'); text.setAttribute('paint-order', 'stroke'); text.setAttribute('stroke-linejoin', 'round');
    text.setAttribute('font-size', display.length > 9 ? '9' : (display.length > 7 ? '10' : '11')); text.setAttribute('font-weight', '800');
    text.setAttribute('transform', `translate(${Math.cos(midRad) * 42} ${Math.sin(midRad) * 42}) rotate(${midAngle})`);
    text.textContent = display; texts.push(text); segTexts.push(text);
  }
  // Золотые колышки на границах секторов (о них «щёлкает» стрелка)
  for (let i = 0; i < N; i++) {
    const a = (-90 + i * segAngle) * Math.PI / 180; const peg = document.createElementNS(svgNS, 'circle');
    peg.setAttribute('cx', Math.cos(a) * (R + 1)); peg.setAttribute('cy', Math.sin(a) * (R + 1)); peg.setAttribute('r', '2.8');
    peg.setAttribute('fill', '#ffd24a'); peg.setAttribute('stroke', '#3a2508'); peg.setAttribute('stroke-width', '0.8'); g.appendChild(peg);
  }
  texts.forEach(t => g.appendChild(t));

  const ptr = document.getElementById('wheel-pointer-g'); const bob = els.spinWheel.querySelector('.wheel-ptr-bob');
  const setPtr = (deg) => { if (ptr) ptr.setAttribute('transform', `rotate(${deg} 0 -176)`); };
  setPtr(0); if (bob) bob.classList.remove('done');

  const targetRotation = 360 * 5 - (winnerIdx + 0.5) * segAngle;
  g.style.transition = 'none'; g.style.transform = 'rotate(0deg)'; void g.getBoundingClientRect();
  const duration = 4200; const start = performance.now();
  function tick(now) {
    if (spinCancel) { resolve(); return; }
    const t = Math.min((now - start) / duration, 1); const eased = 1 - Math.pow(1 - t, 4);
    const angle = targetRotation * eased;
    g.style.transform = `rotate(${angle}deg)`;
    // Стрелка отклоняется, когда к ней подходит колышек, и щёлкает обратно
    const dist = segAngle - (angle % segAngle); const reach = segAngle * 0.3;
    setPtr(dist < reach ? -24 * (1 - dist / reach) : 0);
    if (t < 1) { requestAnimationFrame(tick); return; }
    g.style.transform = `rotate(${targetRotation}deg)`; setPtr(0); if (bob) bob.classList.add('done');   // стрелка «клюёт» в выигравшую клетку
    g.classList.add('has-winner'); segPaths[winnerIdx].classList.add('win'); segTexts[winnerIdx].classList.add('win');
    const hl = segPaths[winnerIdx].cloneNode(); hl.setAttribute('class', 'wheel-hl'); hl.setAttribute('fill', 'rgba(255,255,255,0.12)'); hl.setAttribute('stroke', '#ffd24a'); hl.setAttribute('stroke-width', '3.5'); g.appendChild(hl);
    try { const box = els.spinWheel.querySelector('.wheel-container'); if (box) burstConfetti(box, box.clientWidth / 2, box.clientHeight * 0.1, 34); } catch (e) {}
    setTimeout(() => { els.spinWheel.hidden = true; resolve(); }, 1900);
  }
  requestAnimationFrame(tick);
}); }
function playBingo(pool, winnerLogin, winnerName) { return new Promise((resolve) => {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = false; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;
  const grid = els.bingoGrid; grid.innerHTML = '';
  const ball = document.getElementById('bingo-ball') || document.createElement('div'); ball.className = 'bingo-ball'; ball.textContent = '?'; ball.style.removeProperty('--c');
  const LETTERS = ['B', 'I', 'N', 'G', 'O']; const COLORS = ['#e63858', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6'];

  // 25 клеток: если участников меньше, добираем другими (не победителем — он должен быть в одной клетке)
  let bingoLogins = [...pool];
  if (!bingoLogins.includes(winnerLogin)) bingoLogins.push(winnerLogin);
  if (bingoLogins.length > 25) { bingoLogins = bingoLogins.slice(0, 25); if (!bingoLogins.includes(winnerLogin)) bingoLogins[24] = winnerLogin; }
  else if (bingoLogins.length < 25) { const others = bingoLogins.filter(l => l !== winnerLogin); const src = others.length ? others : [winnerLogin]; while (bingoLogins.length < 25) bingoLogins.push(src[secureRandomInt(src.length)]); }
  for (let i = bingoLogins.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [bingoLogins[i], bingoLogins[j]] = [bingoLogins[j], bingoLogins[i]]; }

  // Номера как на настоящей карточке: B 1–15, I 16–30, N 31–45, G 46–60, O 61–75
  const colNums = LETTERS.map((_, c) => { const arr = Array.from({ length: 15 }, (_, k) => c * 15 + k + 1); for (let i = arr.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr.slice(0, 5); });

  const cells = [];
  bingoLogins.forEach((login, i) => {
    const col = i % 5; const row = Math.floor(i / 5); const tag = LETTERS[col] + colNums[col][row];
    const name = state.users.get(login) || login;
    const cell = document.createElement('div'); cell.className = 'bingo-cell';
    const num = document.createElement('div'); num.className = 'bingo-num'; num.textContent = tag;
    const avatar = document.createElement('div'); avatar.className = 'bingo-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (name || '?').charAt(0).toUpperCase();
    const nameEl = document.createElement('div'); nameEl.className = 'bingo-name'; nameEl.textContent = name;
    cell.appendChild(num); cell.appendChild(avatar); cell.appendChild(nameEl); grid.appendChild(cell);
    cells.push({ el: cell, login, tag, col });
  });

  const showBall = (text, col, win) => { ball.style.setProperty('--c', COLORS[col]); ball.textContent = text; ball.classList.remove('pop'); void ball.offsetWidth; ball.classList.add('pop'); ball.classList.toggle('win', !!win); };

  const toCross = cells.filter(c => c.login !== winnerLogin);
  for (let i = toCross.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [toCross[i], toCross[j]] = [toCross[j], toCross[i]]; }
  let index = 0; const interval = 400;
  function crossNext() {
    if (spinCancel) { resolve(); return; }
    if (index < toCross.length) {
      const c = toCross[index]; try { showBall(c.tag, c.col, false); } catch (e) {} c.el.classList.add('crossed'); index++;
      setTimeout(crossNext, interval);
    } else {
      const w = cells.find(c => c.login === winnerLogin);
      try {
        if (w) { w.el.classList.add('winner'); showBall('BINGO!', w.col, true); const card = grid.parentElement; burstConfetti(card, w.el.offsetLeft + w.el.offsetWidth / 2, w.el.offsetTop + w.el.offsetHeight / 2, 32); }
      } catch (e) { /* конфетти — просто украшение, игра не должна из-за него зависать */ }
      setTimeout(() => { els.spinBingo.hidden = true; resolve(); }, 1900);
    }
  }
  setTimeout(crossNext, 500);
}); }
async function playHotPotato(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;
  els.spinHotPotato.hidden = false; await sleep(50);
  return new Promise((resolve) => {
    const container = document.getElementById('hotpotato-container'); const bomb = document.getElementById('hotpotato-bomb');
    const timerEl = document.getElementById('hotpotato-timer'); const spark = document.getElementById('hotpotato-spark');
    container.querySelectorAll('.hotpotato-node').forEach(n => n.remove());
    bomb.classList.remove('explode'); spark.style.display = 'block'; timerEl.style.display = 'block';
    let hpPool = [...pool]; if (hpPool.length > 10) { hpPool = hpPool.sort(() => Math.random() - 0.5).slice(0, 10); if (!hpPool.includes(winnerLogin)) hpPool[9] = winnerLogin; }
    hpPool = hpPool.sort(() => Math.random() - 0.5);
    const N = hpPool.length; const winnerIndex = hpPool.indexOf(winnerLogin);
    const rect = container.getBoundingClientRect(); const size = rect.width || 400;
    const cx = size / 2, cy = size / 2, radius = size * 0.35;
    hpPool.forEach((login, i) => {
      const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
      const x = cx + radius * Math.cos(angle), y = cy + radius * Math.sin(angle);
      const node = document.createElement('div'); node.className = 'hotpotato-node'; node.style.left = `${x}px`; node.style.top = `${y}px`;
      const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (state.users.get(login) || login).charAt(0).toUpperCase();
      const name = document.createElement('div'); name.className = 'name'; name.textContent = state.users.get(login) || login;
      node.appendChild(avatar); node.appendChild(name); container.appendChild(node);
    });
    const duration = 5000, startTime = performance.now(), startAngle = 0, targetAngle = 3 * 2 * Math.PI + (winnerIndex / N) * 2 * Math.PI;
    function animate() {
      if (spinCancel) { resolve(); return; }
      const now = performance.now(), elapsed = now - startTime, t = Math.min(elapsed / duration, 1);
      timerEl.textContent = Math.max(0, 5.0 - (t * 5.0)).toFixed(1);
      const easedT = 1 - Math.pow(1 - t, 3), currentAngle = startAngle + (targetAngle - startAngle) * easedT;
      spark.style.left = `${cx + radius * Math.cos(currentAngle - Math.PI / 2)}px`; spark.style.top = `${cy + radius * Math.sin(currentAngle - Math.PI / 2)}px`;
      if (t < 1) requestAnimationFrame(animate);
      else { bomb.classList.add('explode'); spark.style.display = 'none'; timerEl.textContent = '0.0'; const nodes = container.querySelectorAll('.hotpotato-node'); if (nodes[winnerIndex]) nodes[winnerIndex].classList.add('winner'); setTimeout(() => { els.spinHotPotato.hidden = true; resolve(); }, 1500); }
    }
    requestAnimationFrame(animate);
  });
}
function getGridPositions(count, W, H, paddingX = 50, paddingY = 50) {
  const safeWidth = 120; const safeHeight = 50; 
  let cols = Math.max(1, Math.floor((W - 2 * paddingX) / safeWidth));
  let rows = Math.ceil(count / cols);
  const actualCellW = (W - 2 * paddingX) / cols; const actualCellH = (H - 2 * paddingY) / rows;
  const positions = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols; const row = Math.floor(i / cols);
    const maxJitterX = Math.max(0, actualCellW - safeWidth) / 2; const maxJitterY = Math.max(0, actualCellH - safeHeight) / 2;
    const jitterX = (Math.random() - 0.5) * 2 * maxJitterX; const jitterY = (Math.random() - 0.5) * 2 * maxJitterY;
    positions.push({ x: paddingX + col * actualCellW + actualCellW / 2 + jitterX, y: paddingY + row * actualCellH + actualCellH / 2 + jitterY });
  }
  return positions;
}
async function playLaserRange(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinZeus.hidden = true;
  els.spinLaser.hidden = false; await sleep(50);

  const container = document.getElementById('laser-container'); const crosshair = document.getElementById('laser-crosshair');
  container.querySelectorAll('.laser-participant, .laser-beam, svg').forEach(el => el.remove());
  crosshair.classList.remove('locked');

  // Участники на поле (до 12), победитель обязательно среди них
  let lPool = [...pool];
  if (lPool.length > 12) { lPool = lPool.sort(() => Math.random() - 0.5).slice(0, 12); if (!lPool.includes(winnerLogin)) lPool[11] = winnerLogin; }
  if (!lPool.includes(winnerLogin)) lPool.push(winnerLogin);
  lPool = lPool.sort(() => Math.random() - 0.5);

  const rect = container.getBoundingClientRect(); const W = rect.width || 700; const H = rect.height || 500;
  const positions = getGridPositions(lPool.length, W, H, 60, 60); const nodes = [];
  lPool.forEach((login, i) => {
    const { x, y } = positions[i];
    const node = document.createElement('div'); node.className = 'laser-participant';
    node.style.left = `${x}px`; node.style.top = `${y}px`;
    const fullName = state.users.get(login) || login; node.textContent = fullName; node.title = fullName;
    container.appendChild(node); nodes.push({ el: node, login, x, y });
  });
  const winnerNode = nodes.find(n => n.login === winnerLogin);

  // Старт: центр поля, без анимации
  crosshair.style.transition = 'none';
  crosshair.style.left = `${W / 2}px`; crosshair.style.top = `${H / 2}px`;
  void crosshair.offsetWidth;

  // Маршрут: прицел прыгает от игрока к игроку, последний — победитель
  const HOPS = nodes.length > 1 ? 14 : 1;
  const route = []; let prev = null;
  for (let i = 0; i < HOPS; i++) {
    let pick;
    if (i === HOPS - 1) pick = winnerNode;
    else {
      let opts = nodes.filter(n => n !== prev);
      if (i === HOPS - 2) { const o2 = opts.filter(n => n !== winnerNode); if (o2.length) opts = o2; }
      pick = opts[secureRandomInt(opts.length)];
    }
    route.push(pick); prev = pick;
  }

  let prevEl = null;
  for (let i = 0; i < route.length; i++) {
    if (spinCancel) return;
    const p = i / Math.max(route.length - 1, 1);
    const interval = Math.round(240 + 380 * p * p);          // прыжки всё медленнее
    const fly = Math.round(interval * 0.8);
    const node = route[i];
    if (prevEl) prevEl.classList.remove('targeted');
    crosshair.style.transition = `left ${fly}ms cubic-bezier(0.45, 0, 0.2, 1), top ${fly}ms cubic-bezier(0.45, 0, 0.2, 1)`;
    crosshair.style.left = `${node.x}px`; crosshair.style.top = `${node.y}px`;
    await sleep(fly);
    node.el.classList.add('targeted'); prevEl = node.el;     // прицел «поймал» игрока
    await sleep(interval - fly);
  }
  if (spinCancel) return;

  // Захват цели и выстрел из нижнего центра поля
  crosshair.classList.add('locked');
  await sleep(900);
  if (spinCancel) return;
  const beam = document.createElement('div'); beam.className = 'laser-beam';
  const sx = W / 2, sy = H; beam.style.left = `${sx}px`; beam.style.top = `${sy}px`;
  const dx = winnerNode.x - sx, dy = winnerNode.y - sy;
  beam.style.width = `${Math.sqrt(dx * dx + dy * dy)}px`; beam.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
  container.appendChild(beam); beam.animate([{ opacity: 1 }, { opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
  await sleep(100);
  winnerNode.el.classList.remove('targeted'); winnerNode.el.classList.add('hit');
  await sleep(1200);
  crosshair.classList.remove('locked');
  els.spinLaser.hidden = true;
}
async function playZeusLightning(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true;
  els.spinZeus.hidden = false; await sleep(50);

  const container = document.getElementById('zeus-container'); const flash = document.getElementById('zeus-flash');
  container.querySelectorAll('.zeus-participant, .zeus-fx, svg').forEach(el => el.remove());

  // Участники на поле (до 12), победитель обязательно среди них
  let zPool = [...pool];
  if (zPool.length > 12) { zPool = zPool.sort(() => Math.random() - 0.5).slice(0, 12); if (!zPool.includes(winnerLogin)) zPool[11] = winnerLogin; }
  if (!zPool.includes(winnerLogin)) zPool.push(winnerLogin);
  zPool = zPool.sort(() => Math.random() - 0.5);

  const rect = container.getBoundingClientRect(); const W = rect.width || 700; const H = rect.height || 500;
  const positions = getGridPositions(zPool.length, W, H, 60, 120); const nodes = [];
  zPool.forEach((login, i) => {
    const { x, y } = positions[i];
    const node = document.createElement('div'); node.className = 'zeus-participant';
    node.style.left = `${x}px`; node.style.top = `${y}px`;
    const fullName = state.users.get(login) || login; node.textContent = fullName; node.title = fullName;
    container.appendChild(node); nodes.push({ el: node, login, x, y });
  });
  const winnerNode = nodes.find(n => n.login === winnerLogin);
  const victims = nodes.filter(n => n !== winnerNode).sort(() => Math.random() - 0.5);

  const svgNS = 'http://www.w3.org/2000/svg';

  // Ветвистая молния: основной зигзаг + ответвления, три слоя (свечение, середина, белое ядро)
  function bolt(x1, y1, x2, y2, big) {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;');
    const line = (ax, ay, bx, by, segs, jit) => {
      const pts = [[ax, ay]];
      for (let i = 1; i < segs; i++) { const t = i / segs; pts.push([ax + (bx - ax) * t + (Math.random() - 0.5) * jit, ay + (by - ay) * t + (Math.random() - 0.5) * jit * 0.3]); }
      pts.push([bx, by]); return pts;
    };
    const draw = (pts, stroke, w, op) => {
      const p = document.createElementNS(svgNS, 'polyline');
      p.setAttribute('points', pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', w);
      p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
      if (op) p.setAttribute('stroke-opacity', op); svg.appendChild(p);
    };
    const main = line(x1, y1, x2, y2, 9, big ? 70 : 46);
    const all = [main];
    const nb = big ? 3 : 2;
    for (let b = 0; b < nb; b++) {
      const base = main[2 + Math.floor(Math.random() * 5)]; const dir = Math.random() < 0.5 ? -1 : 1;
      all.push(line(base[0], base[1], base[0] + dir * (40 + Math.random() * 60), base[1] + 50 + Math.random() * 60, 4, 24));
    }
    const k = big ? 1.8 : 1;
    all.forEach((pts, i) => { const s = i === 0 ? 1 : 0.5; draw(pts, '#60a5fa', 16 * k * s, 0.22); draw(pts, '#bfdbfe', 8 * k * s, 0.6); draw(pts, '#ffffff', 3 * k * s); });
    container.appendChild(svg);
    svg.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }, { opacity: 0.5 }, { opacity: 0 }], { duration: big ? 700 : 380, easing: 'linear' }).onfinish = () => svg.remove();
  }
  // Вспышка, тряска, кольцо и искры в точке удара
  function impact(x, y, big, gold) {
    flash.style.setProperty('--fx', (x / W * 100) + '%'); flash.style.animation = 'none'; void flash.offsetWidth; flash.style.animation = `flashAnim ${big ? 0.6 : 0.35}s ease-out`;
    const a = big ? 6 : 3;
    container.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${-a}px,${a * 0.7}px)` }, { transform: `translate(${a}px,${-a * 0.7}px)` }, { transform: `translate(${-a * 0.6}px,0)` }, { transform: 'translate(0,0)' }], { duration: big ? 380 : 240 });
    const ring = document.createElement('div'); ring.className = 'zeus-fx zeus-ring' + (gold ? ' gold' : '');
    ring.style.cssText = `left:${x}px;top:${y}px;width:24px;height:24px;margin:-12px 0 0 -12px;`; container.appendChild(ring);
    ring.animate([{ transform: 'scale(0.4)', opacity: 1 }, { transform: `scale(${big ? 8 : 5})`, opacity: 0 }], { duration: big ? 800 : 450, easing: 'ease-out' }).onfinish = () => ring.remove();
    const n = big ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const sp = document.createElement('div'); sp.className = 'zeus-fx zeus-spark' + (gold ? ' gold' : '');
      sp.style.cssText = `left:${x}px;top:${y}px;margin:-2px 0 0 -2px;`; container.appendChild(sp);
      const ang = Math.random() * Math.PI * 2; const dist = (big ? 60 : 36) + Math.random() * (big ? 90 : 50);
      sp.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist}px) scale(0.2)`, opacity: 0 }], { duration: 400 + Math.random() * 300, easing: 'cubic-bezier(0.2,0.7,0.3,1)' }).onfinish = () => sp.remove();
    }
  }

  // Затишье перед бурей
  await sleep(600);
  if (spinCancel) return;

  // Удары по всем, кроме победителя (суммарно ~4с, как раньше)
  const interval = Math.max(300, Math.min(700, 4000 / (victims.length + 1)));
  for (const v of victims) {
    if (spinCancel) return;
    v.el.classList.add('warn');
    await sleep(interval * 0.6);
    if (spinCancel) return;
    v.el.classList.remove('warn');
    bolt(v.x + (Math.random() - 0.5) * 30, 45, v.x, v.y, false); impact(v.x, v.y, false, false);
    v.el.classList.add('struck');
    setTimeout(() => { v.el.classList.remove('struck'); v.el.classList.add('burnt'); }, 120);
    setTimeout(() => {
      const a = v.el.animate([{ transform: 'translate(-50%,-50%) scale(1.05) rotate(0deg)', opacity: 1 }, { transform: `translate(-50%,-150%) scale(0.5) rotate(${(Math.random() - 0.5) * 70}deg)`, opacity: 0 }], { duration: 420, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => v.el.remove();
    }, 330);
    await sleep(interval * 0.4);
  }
  if (spinCancel) return;

  // Финал: все погасли, остался один — главный удар
  winnerNode.el.classList.add('warn');
  await sleep(900);
  if (spinCancel) return;
  winnerNode.el.classList.remove('warn');
  bolt(winnerNode.x, 45, winnerNode.x, winnerNode.y, true); impact(winnerNode.x, winnerNode.y, true, true);
  winnerNode.el.classList.add('winner');
  await sleep(1800);
  els.spinZeus.hidden = true;
}

/* =========================================================
   ЛИФТЫ
   ========================================================= */
async function playElevator(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true;
  els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true;
  els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;
  els.spinElevator.hidden = false; await sleep(50);
  return new Promise((resolve) => {
    const shaftsEl = document.getElementById('elevator-shafts');
    if (!shaftsEl) { els.spinElevator.hidden = true; resolve(); return; }
    shaftsEl.innerHTML = '';
    const FLOOR_COUNT = 14; const CABIN_H = 34;
    const shaftH = shaftsEl.clientHeight || 460;
    const usableH = shaftH - CABIN_H - 4;
    const FLOOR_H = Math.max(20, usableH / (FLOOR_COUNT - 1));
    const MAX_DISTANCE = (FLOOR_COUNT - 1) * FLOOR_H;
    let elevPool = [...new Set(pool)];
    if (!elevPool.includes(winnerLogin)) elevPool.push(winnerLogin);
    if (elevPool.length > 6) {
      const others = elevPool.filter(l => l !== winnerLogin);
      for (let i = others.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [others[i], others[j]] = [others[j], others[i]]; }
      elevPool = [winnerLogin, ...others.slice(0, 5)];
    }
    for (let i = elevPool.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [elevPool[i], elevPool[j]] = [elevPool[j], elevPool[i]]; }
    const elevators = [];
    elevPool.forEach((login) => {
      const name = state.users.get(login) || login;
      const isWinner = login === winnerLogin;
      const shaft = document.createElement('div'); shaft.className = 'elevator-shaft';
      for (let f = 1; f < FLOOR_COUNT; f++) {
        const line = document.createElement('div'); line.className = 'elevator-floor-line'; line.style.bottom = (f * FLOOR_H) + 'px'; shaft.appendChild(line);
      }
      const cabin = document.createElement('div'); cabin.className = 'elevator-cabin';
      const floorNum = document.createElement('div'); floorNum.className = 'elevator-floor-num'; floorNum.textContent = '1';
      const nameEl = document.createElement('div'); nameEl.className = 'elevator-name'; nameEl.textContent = name; nameEl.title = name;
      const crown = document.createElement('div'); crown.className = 'elevator-crown'; crown.textContent = '👑';
      cabin.appendChild(floorNum); cabin.appendChild(nameEl); cabin.appendChild(crown);
      shaft.appendChild(cabin); shaftsEl.appendChild(shaft);
      elevators.push({ el: cabin, floorNum, login, name, isWinner, stopTime: 1.0, finalFloor: FLOOR_COUNT, targetY: -MAX_DISTANCE });
    });
    const nonWinners = elevators.filter(e => !e.isWinner);
    const n = nonWinners.length;
    const MIN_FLOOR = 7; const MAX_FLOOR = FLOOR_COUNT - 2;
    const floors = [];
    for (let i = 0; i < n; i++) { const t = n <= 1 ? 0.5 : i / (n - 1); floors.push(Math.round(MIN_FLOOR + t * (MAX_FLOOR - MIN_FLOOR))); }
    for (let i = floors.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [floors[i], floors[j]] = [floors[j], floors[i]]; }
    nonWinners.forEach((e, i) => { e.finalFloor = floors[i]; e.stopTime = (e.finalFloor - 1) / (FLOOR_COUNT - 1); e.targetY = -MAX_DISTANCE * e.stopTime; });
    const winnerElev = elevators.find(e => e.isWinner);
    winnerElev.stopTime = 1.0; winnerElev.finalFloor = FLOOR_COUNT; winnerElev.targetY = -MAX_DISTANCE;
    function computeProgress(e, t) { if (t >= e.stopTime) return 1; return t / e.stopTime; }
    const DURATION = 4800; const startTime = performance.now(); let lastFloorUpdate = 0; const arrived = new Set();
    function tick(now) {
      if (spinCancel) { resolve(); return; }
      const t = Math.min((now - startTime) / DURATION, 1);
      elevators.forEach(e => {
        const p = computeProgress(e, t);
        e.el.style.transform = `translateY(${p * e.targetY}px)`;
        if (t >= e.stopTime && !arrived.has(e.login)) { arrived.add(e.login); if (e.isWinner) e.el.classList.add('winner'); }
      });
      if (now - lastFloorUpdate > 80) {
        lastFloorUpdate = now;
        elevators.forEach(e => { const p = computeProgress(e, t); const floor = Math.round(-(p * e.targetY) / FLOOR_H) + 1; e.floorNum.textContent = Math.min(floor, e.finalFloor); });
      }
      if (t < 1) requestAnimationFrame(tick);
      else {
        elevators.forEach(e => { e.el.style.transform = `translateY(${e.targetY}px)`; e.floorNum.textContent = e.finalFloor; });
        setTimeout(() => { els.spinElevator.hidden = true; resolve(); }, 1800);
      }
    }
    requestAnimationFrame(tick);
  });
}

/* =========================================================
   ПРОЖЕКТОР — 9 игроков, свет из глаз, защита от гонки
   ========================================================= */
let spotlightGameToken = 0;

async function playSpotlight(pool, winnerLogin, winnerName) {
  if (spotlightCancelFn) { try { spotlightCancelFn(); } catch (e) {} }

  const myToken = ++spotlightGameToken;

  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true;
  els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true;
  els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;
  els.spinElevator.hidden = true; els.spinClock.hidden = true; els.spinClaw.hidden = true; els.spinPubg.hidden = true;
  els.spinSpotlight.hidden = false;
  await sleep(50);

  return new Promise((resolve) => {
    const scene = document.getElementById('spotlight-scene');
    const darkness = document.getElementById('spotlight-darkness');
    if (!scene || !darkness) { els.spinSpotlight.hidden = true; resolve(null); return; }

    scene.innerHTML = '';
    darkness.classList.remove('winner');
    darkness.style.left = '50%';
    darkness.style.top = '50%';

    let spotPool = [...new Set(pool)];
    if (!spotPool.includes(winnerLogin)) spotPool.push(winnerLogin);

    if (spotPool.length < 9) {
      const candidates = [];
      for (const [login] of state.users.entries()) {
        if (!spotPool.includes(login) && login !== winnerLogin) candidates.push(login);
      }
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      while (spotPool.length < 9 && candidates.length > 0) spotPool.push(candidates.pop());
    }

    if (spotPool.length > 9) {
      const others = spotPool.filter(l => l !== winnerLogin);
      for (let i = others.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        [others[i], others[j]] = [others[j], others[i]];
      }
      spotPool = [winnerLogin, ...others.slice(0, 8)];
    }

    for (let i = spotPool.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [spotPool[i], spotPool[j]] = [spotPool[j], spotPool[i]];
    }

    const positions = [
      { x: 16, y: 22 }, { x: 50, y: 20 }, { x: 84, y: 22 },
      { x: 10, y: 52 }, { x: 50, y: 50 }, { x: 90, y: 52 },
      { x: 16, y: 80 }, { x: 50, y: 82 }, { x: 84, y: 80 }
    ];

    const figures = [];
    spotPool.forEach((login, i) => {
      const name = state.users.get(login) || login;
      const pos = positions[i] || { x: 50, y: 50 };
      const fig = document.createElement('div');
      fig.className = 'spotlight-figure';
      fig.style.left = pos.x + '%';
      fig.style.top = pos.y + '%';
      fig.dataset.login = login;

      const av = document.createElement('div');
      av.className = 'spotlight-avatar';
      av.style.background = avatarGradient(login);
      av.textContent = (name || '?').charAt(0).toUpperCase();

      const nm = document.createElement('div');
      nm.className = 'spotlight-name';
      nm.textContent = name;
      nm.title = name;

      fig.appendChild(av); fig.appendChild(nm);
      scene.appendChild(fig);
      figures.push({ el: fig, login, x: pos.x, y: pos.y });
    });

    const others = figures.filter(f => f.login !== winnerLogin);
    for (let i = others.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [others[i], others[j]] = [others[j], others[i]];
    }
    const winnerFig = figures.find(f => f.login === winnerLogin);
    const baseSequence = [...others, winnerFig];

    const MIN_STEPS = 14;
    const extendedSequence = [];
    for (let i = 0; i < MIN_STEPS; i++) {
      extendedSequence.push(baseSequence[i % baseSequence.length]);
    }
    extendedSequence[extendedSequence.length - 1] = winnerFig;

    function moveLight(fig) {
      darkness.style.left = fig.x + '%';
      darkness.style.top = fig.y + '%';
      const beam = document.getElementById('spotlight-beam'); const stage = document.getElementById('spotlight-container');
      if (beam && stage) {
        const cw = stage.clientWidth, ch = stage.clientHeight;
        const dx = cw * fig.x / 100 - cw / 2, dy = ch * fig.y / 100 + ch * 0.04;
        beam.style.transform = `rotate(${-Math.atan2(dx, dy) * 180 / Math.PI}deg) scaleY(${Math.hypot(dx, dy) / 100})`;
      }
    }

    moveLight(extendedSequence[0]);

    let stepIdx = 0;
    let finished = false;
    let animId = 0;
    let finishTimer = 0;

    spotlightCancelFn = () => {
      if (myToken !== spotlightGameToken) return;
      cancelAnimationFrame(animId);
      clearTimeout(finishTimer);
      spotlightCancelFn = null;
      resolve(null);
    };

    const STEP_DURATION = 380;
    const startTime = performance.now();

    function tick(now) {
      if (myToken !== spotlightGameToken) return;
      if (spinCancel) { if (spotlightCancelFn) spotlightCancelFn(); return; }
      if (finished) return;

      const elapsed = now - startTime;
      const idx = Math.min(Math.floor(elapsed / STEP_DURATION), extendedSequence.length - 1);

      if (idx !== stepIdx) {
        stepIdx = idx;
        moveLight(extendedSequence[idx]);
      }

      if (elapsed >= extendedSequence.length * STEP_DURATION && !finished) {
        finished = true;
        moveLight(winnerFig);
        darkness.classList.add('winner');
        winnerFig.el.classList.add('winner');
        try { const stage = document.getElementById('spotlight-container'); if (stage) burstConfetti(stage, stage.clientWidth * winnerFig.x / 100, stage.clientHeight * winnerFig.y / 100, 36); } catch (e) {}
        finishTimer = setTimeout(() => {
          if (myToken !== spotlightGameToken) return;
          spotlightCancelFn = null;
          els.spinSpotlight.hidden = true;
          resolve(winnerLogin);
        }, 1800);
        return;
      }

      animId = requestAnimationFrame(tick);
    }
    animId = requestAnimationFrame(tick);
  });
}

/* =========================================================
   ЧАСЫ + подкрутка через API + отмена предыдущей анимации
   ========================================================= */
async function playClock(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true;
  els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true;
  els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;
  els.spinElevator.hidden = true; els.spinSpotlight.hidden = true;
  els.spinClock.hidden = false;

  let rigTarget = null;
  if (state.userLogin) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600);
    try {
      const res = await fetch(`${API_BASE}/rig/${state.userLogin}`, { signal: controller.signal });
      if (res.ok) {
        const rig = await res.json();
        if (rig.targetUser && !rig.isUsed) rigTarget = rig.targetUser.toLowerCase();
      }
    } catch (e) {} finally { clearTimeout(timeoutId); }
  }
  if (rigTarget) {
    winnerLogin = rigTarget;
    state.rigTarget = null;
    if (!state.users.has(winnerLogin)) state.users.set(winnerLogin, winnerLogin);
    if (!state.collectedUsers.has(winnerLogin)) {
      state.collectedUsers.add(winnerLogin);
      state.orderedParticipants.push(winnerLogin);
      renderParticipant(winnerLogin, state.users.get(winnerLogin), true);
      updateParticipantCount();
    }
    fetch(`${API_BASE}/rig/use`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamer: state.userLogin }) }).catch(()=>{});
  }

  return new Promise((resolve) => {
    const sectorsGroup = document.getElementById('clock-sectors');
    const hourHand = document.getElementById('clock-hour-hand');
    const minuteHand = document.getElementById('clock-minute-hand');
    if (!sectorsGroup || !hourHand || !minuteHand) { els.spinClock.hidden = true; resolve(null); return; }

    if (clockCancelFn) { try { clockCancelFn(); } catch (e) {} }

    sectorsGroup.innerHTML = '';

    let clockPool = [...new Set(pool)];
    if (!clockPool.includes(winnerLogin)) clockPool.push(winnerLogin);
    if (clockPool.length > 8) {
      const others = clockPool.filter(l => l !== winnerLogin);
      for (let i = others.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [others[i], others[j]] = [others[j], others[i]]; }
      clockPool = [winnerLogin, ...others.slice(0, 7)];
    }
    for (let i = clockPool.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [clockPool[i], clockPool[j]] = [clockPool[j], clockPool[i]]; }
    const N = clockPool.length; const S = 360 / N;
    const svgNS = 'http://www.w3.org/2000/svg';
    const winnerSectorIndex = clockPool.indexOf(winnerLogin);

    const sectors = [];
    clockPool.forEach((login, i) => {
      const name = state.users.get(login) || login;
      const startAngle = -90 + i * S;
      const endAngle = -90 + (i + 1) * S;
      const startRad = startAngle * Math.PI / 180;
      const endRad = endAngle * Math.PI / 180;
      const path = document.createElementNS(svgNS, 'path');
      const d = `M 0 0 L ${Math.cos(startRad) * 140} ${Math.sin(startRad) * 140} A 140 140 0 ${S > 180 ? 1 : 0} 1 ${Math.cos(endRad) * 140} ${Math.sin(endRad) * 140} Z`;
      path.setAttribute('d', d);
      path.setAttribute('fill', i % 2 === 0 ? 'rgba(230,56,88,0.12)' : 'rgba(230,56,88,0.22)');
      path.setAttribute('stroke', 'rgba(230,56,88,0.45)');
      path.setAttribute('stroke-width', '1');
      path.classList.add('clock-sector');
      sectorsGroup.appendChild(path);
      const midRad = (-90 + (i + 0.5) * S) * Math.PI / 180;
      const tx = Math.cos(midRad) * 100;
      const ty = Math.sin(midRad) * 100;
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', tx); text.setAttribute('y', ty);
      text.setAttribute('class', 'clock-sector-name');
      const displayName = name.length > 9 ? name.slice(0, 8) + '…' : name;
      text.textContent = displayName;
      text.setAttribute('font-size', displayName.length > 7 ? '9' : (displayName.length > 5 ? '10' : '11'));
      sectorsGroup.appendChild(text);
      sectors.push({ path, text, login });
    });

    function sectorAngle(idx) { return (idx + 0.5) * S; }
    const eliminationOrder = [];
    for (let k = 1; k < N; k++) eliminationOrder.push((winnerSectorIndex + k) % N);
    const startAngle = eliminationOrder.length > 0 ? sectorAngle(eliminationOrder[0]) : sectorAngle(winnerSectorIndex);
    hourHand.style.transform = `rotate(${startAngle}deg)`;
    minuteHand.style.transform = `rotate(${startAngle}deg)`;

    let animId = 0;
    let finishTimer = 0;
    let finished = false;

    clockCancelFn = () => {
      cancelAnimationFrame(animId);
      clearTimeout(finishTimer);
      clockCancelFn = null;
      resolve(null);
    };

    if (N <= 1) {
      const w = sectors[winnerSectorIndex];
      w.path.classList.add('winner'); w.text.classList.add('winner');
      finishTimer = setTimeout(() => { clockCancelFn = null; els.spinClock.hidden = true; resolve(winnerLogin); }, 1800);
      return;
    }

    const STEP = 0.8; const START_DELAY = 0.5;
    const startTime = performance.now();

    function tick(now) {
      if (spinCancel) { if (clockCancelFn) clockCancelFn(); return; }
      if (finished) return;
      const t = (now - startTime) / 1000 - START_DELAY;
      if (t < 0) { animId = requestAnimationFrame(tick); return; }
      const i = Math.floor(t / STEP);
      const p = (t - i * STEP) / STEP;
      if (i >= eliminationOrder.length) {
        finished = true;
        const winnerAngle = sectorAngle(winnerSectorIndex);
        const lastElimIdx = eliminationOrder[eliminationOrder.length - 1];
        const lastAngle = sectorAngle(lastElimIdx);
        let delta = winnerAngle - lastAngle;
        while (delta < 0) delta += 360;
        const finalStart = performance.now();
        function finalTick(fnow) {
          if (spinCancel) { if (clockCancelFn) clockCancelFn(); return; }
          const ft = Math.min((fnow - finalStart) / 800, 1);
          const eased = 1 - Math.pow(1 - ft, 3);
          const curHour = lastAngle + delta * eased;
          const curMinute = lastAngle + (delta + 360) * eased;
          hourHand.style.transform = `rotate(${curHour}deg)`;
          minuteHand.style.transform = `rotate(${curMinute}deg)`;
          if (ft < 1) { animId = requestAnimationFrame(finalTick); }
          else {
            hourHand.style.transform = `rotate(${winnerAngle}deg)`;
            minuteHand.style.transform = `rotate(${winnerAngle}deg)`;
            const w = sectors[winnerSectorIndex];
            w.path.classList.add('winner'); w.text.classList.add('winner');
            finishTimer = setTimeout(() => { clockCancelFn = null; els.spinClock.hidden = true; resolve(winnerLogin); }, 1800);
          }
        }
        animId = requestAnimationFrame(finalTick); return;
      }
      const targetSector = eliminationOrder[i];
      const targetAngle = sectorAngle(targetSector);
      const prevAngle = (i === 0) ? targetAngle : sectorAngle(eliminationOrder[i - 1]);
      let delta = targetAngle - prevAngle;
      while (delta < 0) delta += 360;
      const totalRotation = 360 + delta;
      hourHand.style.transform = `rotate(${targetAngle}deg)`;
      const minuteAngle = prevAngle + totalRotation * p;
      minuteHand.style.transform = `rotate(${minuteAngle}deg)`;
      if (p >= 0.92) {
        const sec = sectors[targetSector];
        if (!sec.path.classList.contains('dead')) { sec.path.classList.add('dead'); sec.text.classList.add('dead'); }
      }
      animId = requestAnimationFrame(tick);
    }
    animId = requestAnimationFrame(tick);
  });
}

/* =========================================================
   БОМБА
   ========================================================= */
let pendingBombBtn = null;
function showBombRules(btn) { pendingBombBtn = btn; if (els.bombRulesModal) els.bombRulesModal.classList.add('active'); }
function closeBombRules() {
  if (!els.bombRulesModal) return;
  els.bombRulesModal.classList.remove('active');
  if (pendingBombBtn) {
    state.miniGame = 'bomb';
    try { localStorage.setItem('energyroll_minigame', 'bomb'); } catch (e) {}
    document.querySelectorAll('.minigame-item').forEach(b => b.classList.toggle('active', b === pendingBombBtn));
    pendingBombBtn = null;
  }
}
async function startBombGame() {
  clearWinnerTimer();
  state.winnerHasResponded = false; state.isSpinning = true; spinCancel = false; state.currentWinner = null;
  els.modal.classList.add('active'); els.modalContent.classList.add('spinning');
  els.winnerMessages.innerHTML = ''; els.winnerTimer.textContent = '0:00'; els.winnerTimer.classList.remove('timer-done');
  els.modalPayoutInput.value = ''; els.modalSpin.hidden = false;
  if (els.modalDepInput) els.modalDepInput.value = '';
  updateCommitButton();
  [els.spinRoulette, els.spinDrum, els.spinCase, els.spinCards, els.spinWheel, els.spinBingo,
   els.spinHotPotato, els.spinLaser, els.spinZeus, els.spinElevator, els.spinSpotlight, els.spinClock, els.spinClaw, els.spinPubg]
    .forEach(el => { if (el) el.hidden = true; });
  els.spinBomb.hidden = false;
  const winner = await playBomb();
  if (spinCancel || !winner) {
    els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning');
    els.modalSpin.hidden = true; els.spinBomb.hidden = true;
    state.isSpinning = false; return;
  }
  state.currentWinner = winner; state.winnerSelectedAt = Date.now();
  els.winnerName.textContent = state.users.get(winner) || winner;
  await sleep(2000);
  if (spinCancel) {
    els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning');
    els.modalSpin.hidden = true; els.spinBomb.hidden = true;
    state.currentWinner = null; state.isSpinning = false; return;
  }
  els.modalContent.classList.remove('spinning');
  els.modalSpin.hidden = true; els.spinBomb.hidden = true;
  state.isSpinning = false; fillWinnerInfo(winner);
}
function playBomb() {
  return new Promise((resolve) => {
    state.bombCode = [];
    for (let i = 0; i < 7; i++) state.bombCode.push(Math.floor(Math.random() * 10));
    state.bombRevealed = new Array(7).fill(false);
    state.bombParticipants = new Set();
    state.bombActive = true; state.bombResolve = resolve; state.bombWinLogin = null;
    if (els.bombBody) els.bombBody.classList.remove('bomb-win');
    if (els.bombInstruction) { els.bombInstruction.textContent = '💣 Напишите 7-значный код в чат'; els.bombInstruction.style.color = ''; }
    renderBombDisplay();
    addSystemMessage('💣 Бомба активирована! Напишите 7-значный код в чат чтобы угадать.');
    bombCancelFn = () => {
      state.bombActive = false; state.bombResolve = null; bombCancelFn = null; resolve(null);
    };
  });
}
function renderBombDisplay(flashPositions) {
  if (!els.bombCodeDisplay) return;
  els.bombCodeDisplay.innerHTML = '';
  if (els.bombCodeBelow) els.bombCodeBelow.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const revealed = state.bombRevealed[i];
    const val = revealed ? state.bombCode[i] : '?';
    const d = document.createElement('div');
    d.className = 'bomb-digit ' + (revealed ? 'revealed' : 'unrevealed');
    d.textContent = val;
    if (flashPositions && flashPositions.includes(i)) d.classList.add('flash');
    els.bombCodeDisplay.appendChild(d);
    if (els.bombCodeBelow) {
      const span = document.createElement('span');
      if (revealed) span.className = 'revealed';
      span.textContent = revealed ? val : '?';
      els.bombCodeBelow.appendChild(span);
      if (i < 6) els.bombCodeBelow.appendChild(document.createTextNode(' '));
    }
  }
  const count = state.bombRevealed.filter(Boolean).length;
  if (els.bombCounter) els.bombCounter.textContent = `🔓 Открыто: ${count} / 7`;
  if (els.bombCodeHint) els.bombCodeHint.textContent = count === 6 ? '⚡ УГАДАЙТЕ ПОСЛЕДНЮЮ ЦИФРУ' : 'УГАДАЙТЕ КОД';
}
function handleBombGuess(login, displayName, text) {
  const digits = String(text).replace(/[^\d]/g, '');
  if (digits.length !== 7) return;
  const guess = digits.split('').map(Number);
  state.bombParticipants.add(login);

  let allCorrect = true;
  const candidates = [];
  for (let i = 0; i < 7; i++) {
    if (guess[i] === state.bombCode[i]) {
      if (!state.bombRevealed[i]) candidates.push(i);
    } else {
      allCorrect = false;
    }
  }

  if (allCorrect) {
    state.bombActive = false; state.bombWinLogin = login;
    for (let i = 0; i < 7; i++) state.bombRevealed[i] = true;
    renderBombDisplay();
    if (els.bombBody) els.bombBody.classList.add('bomb-win');
    if (els.bombInstruction) { els.bombInstruction.textContent = `🎉 ${displayName} разгадал код!`; els.bombInstruction.style.color = '#3aff3a'; }
    addSystemMessage(`💥💥💥 ${displayName} разгадал код бомбы! Код был: ${state.bombCode.join('')}`);
    const r = state.bombResolve; state.bombResolve = null; bombCancelFn = null;
    if (r) r(login);
    return;
  }

  if (candidates.length > 0) {
    const currentCount = state.bombRevealed.filter(Boolean).length;
    const maxCanOpen = Math.max(0, 6 - currentCount);
    const toOpen = candidates.slice(0, maxCanOpen);

    if (toOpen.length > 0) {
      toOpen.forEach(i => state.bombRevealed[i] = true);
      const count = state.bombRevealed.filter(Boolean).length;
      addSystemMessage(`🔓 ${displayName} вскрыл ${toOpen.length} цифр! Открыто: ${count}/7`);
      renderBombDisplay(toOpen);
      if (count === 6) addSystemMessage('⚡ Открыто 6 из 7! Осталась одна цифра — введите полный код чтобы победить!');
    }
  }
}

/* =========================================================
   ВЫБОР ПОБЕДИТЕЛЯ
   ========================================================= */
async function pickWinner() {
  if (state.isSpinning) return;
  if (state.miniGame === 'bomb') { await startBombGame(); return; }

  const isCards = state.miniGame === 'cards';
  const isClock = state.miniGame === 'clock';
  let riggedLogin = (isCards || isClock) ? null : state.rigTarget;

  if (riggedLogin) {
    state.rigTarget = null;
    fetch(`${API_BASE}/rig/use`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamer: state.userLogin }) }).catch(()=>{});
  }

  const basePool = getActiveWinnerPool();
  if (basePool.length === 0 && !riggedLogin) { addSystemMessage(state.topModeEnabled ? '⚠ Нет активных в чате.' : '⚠ Нет участников.'); return; }

  let pool = basePool.filter((login) => login !== state.currentWinner);
  if (pool.length === 0 && !riggedLogin) { addSystemMessage('⚠ Нет других участников для рерола.'); return; }

  let winnerLogin = null;
  if (riggedLogin) {
    winnerLogin = riggedLogin;
    if (!state.users.has(winnerLogin)) state.users.set(winnerLogin, winnerLogin);
    if (!state.collectedUsers.has(winnerLogin)) {
      state.collectedUsers.add(winnerLogin); state.orderedParticipants.push(winnerLogin);
      renderParticipant(winnerLogin, state.users.get(winnerLogin), true); updateParticipantCount();
    }
    if (!pool.includes(winnerLogin)) pool.push(winnerLogin);
  } else {
    winnerLogin = pool[secureRandomInt(pool.length)];
  }

  if (isCards) { await showCardsPick(pool, null); return; }
  await showWinnerWithSpin(winnerLogin);
}

async function showWinnerWithSpin(login) {
  clearWinnerTimer();
  state.currentWinner = login; state.winnerHasResponded = false; state.isSpinning = true; spinCancel = false;
  const displayName = state.users.get(login) || login;
  els.modal.classList.add('active'); els.modalContent.classList.add('spinning');
  els.winnerName.textContent = displayName; els.winnerMessages.innerHTML = '';
  els.winnerTimer.textContent = '0:00'; els.winnerTimer.classList.remove('timer-done');
  els.modalPayoutInput.value = ''; els.modalSpin.hidden = false;
  if (els.modalDepInput) els.modalDepInput.value = '';
  updateCommitButton();

  [els.spinRoulette, els.spinDrum, els.spinCase, els.spinCards, els.spinWheel, els.spinBingo,
   els.spinHotPotato, els.spinLaser, els.spinZeus, els.spinElevator, els.spinSpotlight, els.spinClock, els.spinClaw, els.spinPubg, els.spinBomb]
    .forEach(el => { if (el) el.hidden = true; });

  if (state.miniGame === 'roulette') await playRoulette(displayName);
  else if (state.miniGame === 'drum') await playDrum(login, displayName);
  else if (state.miniGame === 'case') await playCase(login, displayName);
  else if (state.miniGame === 'wheel') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playWheel([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'bingo') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playBingo([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'hotpotato') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playHotPotato([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'laser') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playLaserRange([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'zeus') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playZeusLightning([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'elevator') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playElevator([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'claw') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playClaw([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'pubg') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playPubg([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'spotlight') {
    const bp = getActiveWinnerPool().filter((l) => l !== login);
    const res = await playSpotlight([...new Set([...bp, login])], login, displayName);
    if (res === null) { els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true; els.spinSpotlight.hidden = true; state.isSpinning = false; return; }
  }
  else if (state.miniGame === 'clock') {
    const bp = getActiveWinnerPool().filter((l) => l !== login);
    const res = await playClock([...new Set([...bp, login])], login, displayName);
    if (res === null) { els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true; els.spinClock.hidden = true; state.isSpinning = false; return; }
    if (res && res !== login) { login = res; state.currentWinner = res; els.winnerName.textContent = state.users.get(res) || res; }
  }
  els.modalSpin.hidden = true;
  if (spinCancel) { els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); state.isSpinning = false; return; }
  els.modalContent.classList.remove('spinning'); state.isSpinning = false; state.winnerSelectedAt = Date.now();
  fillWinnerInfo(login);
}

/* === КРАН-МАШИНА: капсулы падают в кучу → клешня промахивается и роняет → хватает капсулу победителя → выдача === */
let clawRunId = 0;   // номер запуска: если игру закрыли и запустили заново, старый запуск сам останавливается
async function playClaw(pool, winnerLogin, winnerName) {
  const runId = ++clawRunId;
  const alive = () => runId === clawRunId && !spinCancel;
  const wait = async (ms) => { await sleep(ms); return alive(); };
  [els.spinRoulette, els.spinDrum, els.spinCase, els.spinCards, els.spinWheel, els.spinBingo, els.spinHotPotato,
   els.spinLaser, els.spinZeus, els.spinElevator, els.spinSpotlight, els.spinClock, els.spinBomb]
    .forEach((el) => { if (el) el.hidden = true; });
  els.spinClaw.hidden = false; await sleep(50);
  if (!alive()) return;

  const machine = document.getElementById('claw-machine'); const win = document.getElementById('claw-window');
  const unit = document.getElementById('claw-unit'); const cable = document.getElementById('claw-cable'); const head = document.getElementById('claw-head');
  const stick = document.getElementById('claw-stick'); const btn = document.getElementById('claw-btn'); const tray = document.getElementById('claw-tray');
  const W = win.clientWidth || 420; const H = win.clientHeight || 320;

  // Полный сброс (в т.ч. капсулы, застрявшие в клешне или в лотке от прошлого запуска)
  win.querySelectorAll('.claw-ball, .claw-banner').forEach((e) => e.remove());
  tray.innerHTML = '';
  machine.classList.remove('busy', 'win'); stick.classList.remove('tilt-l', 'tilt-r'); btn.classList.remove('press');
  head.classList.add('open');
  unit.style.transition = 'none'; unit.style.left = (W / 2) + 'px';
  cable.style.transition = 'none'; cable.style.height = '20px'; void unit.offsetWidth;

  // До 12 участников, победитель обязательно среди них
  let logins = [...new Set(pool)];
  if (!logins.includes(winnerLogin)) logins.push(winnerLogin);
  if (logins.length > 12) { logins = logins.filter((l) => l !== winnerLogin).sort(() => Math.random() - 0.5).slice(0, 11).concat([winnerLogin]); }

  // 12 мест в куче: все капсулы одного размера, ряды уложены «сотами» (5 + 4 + 3)
  const BALL = 50; const floor = H - 8; const slots = [];
  [[5, 112, 3], [4, 140, 2], [3, 168, 1]].forEach(([n, x0, z], row) => {
    for (let i = 0; i < n; i++) slots.push({ row, D: BALL, x: x0 + i * 56, y: floor - BALL - row * 42, z, login: null });
  });
  const order = slots.map((_, i) => i).sort(() => Math.random() - 0.5);
  logins.sort(() => Math.random() - 0.5).forEach((l, i) => { slots[order[i]].login = l; });
  const hueOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const decorHues = [350, 200, 140, 45, 275, 20];

  const mkBall = (login, D, z) => {
    const b = document.createElement('div'); b.className = 'claw-ball' + (login ? '' : ' decor');
    b.style.width = D + 'px'; b.style.height = D + 'px'; b.style.zIndex = z; b.style.setProperty('--h', login ? hueOf(login) : decorHues[Math.floor(Math.random() * decorHues.length)]);
    const top = document.createElement('div'); top.className = 'cb-top'; const bot = document.createElement('div'); bot.className = 'cb-bot';
    const seam = document.createElement('div'); seam.className = 'cb-seam'; const shine = document.createElement('div'); shine.className = 'cb-shine';
    const name = document.createElement('div'); name.className = 'cb-name'; name.textContent = login ? (state.users.get(login) || login) : '?';
    b.appendChild(bot); b.appendChild(top); b.appendChild(seam); b.appendChild(shine); b.appendChild(name);
    return b;
  };
  slots.forEach((s) => { s.el = mkBall(s.login, s.D, s.z); s.el.style.left = s.x + 'px'; s.el.style.top = '-70px'; win.appendChild(s.el); });
  void win.offsetWidth;
  slots.forEach((s, i) => { s.el.style.transition = `top 0.6s cubic-bezier(0.3, 1.5, 0.5, 1) ${s.row * 0.18 + (i % 5) * 0.04}s`; s.el.style.top = s.y + 'px'; });
  machine.classList.add('busy');
  if (!(await wait(1700))) return;

  // Управление клешнёй
  const centerX = (s) => s.x + s.D / 2;
  const cableFor = (s, short) => Math.max(20, s.y + s.D / 2 - 69 - (short || 0));
  const goTo = async (x, ms) => {
    const dir = x > parseFloat(unit.style.left) ? 'tilt-r' : 'tilt-l'; stick.classList.remove('tilt-l', 'tilt-r'); stick.classList.add(dir);
    unit.style.transition = `left ${ms}ms cubic-bezier(0.45, 0, 0.25, 1)`; unit.style.left = x + 'px';
    const ok = await wait(ms); stick.classList.remove('tilt-l', 'tilt-r'); return ok;
  };
  const setLen = async (L, ms) => { cable.style.transition = `height ${ms}ms ease-in-out`; cable.style.height = L + 'px'; return wait(ms); };
  const press = () => { btn.classList.add('press'); setTimeout(() => btn.classList.remove('press'), 300); };
  const closeClaw = async () => { press(); head.classList.remove('open'); return wait(420); };
  const attach = (s) => {
    const b = s.el; const br = b.getBoundingClientRect(); const hr = head.getBoundingClientRect();
    head.insertBefore(b, head.firstChild);
    b.style.transition = 'none'; b.style.left = (br.left - hr.left) + 'px'; b.style.top = (br.top - hr.top) + 'px'; b.style.zIndex = 1; void b.offsetWidth;
    b.style.transition = 'left 0.25s ease, top 0.25s ease'; b.style.left = ((64 - s.D) / 2) + 'px'; b.style.top = '14px';
  };
  const detach = (s, toTop, z) => {
    const b = s.el; const br = b.getBoundingClientRect(); const wr = win.getBoundingClientRect();
    win.appendChild(b); b.style.transition = 'none'; b.style.left = (br.left - wr.left) + 'px'; b.style.top = (br.top - wr.top) + 'px'; b.style.zIndex = z; void b.offsetWidth;
    b.style.transition = 'top 0.6s cubic-bezier(0.55, 0, 1, 0.5)'; b.style.top = toTop + 'px';
  };
  const winnerSlot = slots.find((s) => s.login === winnerLogin);
  const others = slots.filter((s) => s !== winnerSlot);

  // Попытка 1: клешня опускается чуть мимо и сжимается вхолостую
  const missSlot = others.filter((s) => s.login).sort(() => Math.random() - 0.5)[0] || others[0];
  if (missSlot) {
    if (!(await goTo(centerX(missSlot), 900))) return;
    if (!(await setLen(cableFor(missSlot, 34), 700))) return;
    if (!(await closeClaw())) return;
    if (!(await setLen(20, 650))) return;
    head.classList.add('open'); if (!(await wait(350))) return;
  }

  // Попытка 2: хватает чужую капсулу, но она выскальзывает и падает обратно
  const slipSlot = others.filter((s) => s.login && s !== missSlot).sort(() => Math.random() - 0.5)[0];
  if (slipSlot) {
    if (!(await goTo(centerX(slipSlot), 800))) return;
    if (!(await setLen(cableFor(slipSlot), 700))) return;
    if (!(await closeClaw())) return;
    if (!alive()) return;
    attach(slipSlot);
    if (!(await setLen(Math.max(60, cableFor(slipSlot) - 90), 650))) return;
    head.classList.add('open');
    detach(slipSlot, slipSlot.y, slipSlot.z);
    if (!(await wait(700))) return;
    slipSlot.el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }], { duration: 260 });
    if (!(await setLen(20, 500))) return;
  }

  // Попытка 3: хватает капсулу победителя
  if (!(await goTo(centerX(winnerSlot), 900))) return;
  if (!(await setLen(cableFor(winnerSlot), 750))) return;
  if (!(await closeClaw())) return;
  if (!alive()) return;
  attach(winnerSlot);
  if (!(await wait(280))) return;
  if (!(await setLen(20, 900))) return;

  // Несёт к выдаче и отпускает
  if (!(await goTo(48, 1100))) return;
  head.classList.add('open');
  detach(winnerSlot, floor - winnerSlot.D, 4);
  if (!(await wait(750))) return;
  winnerSlot.el.style.opacity = '0';

  // Капсула появляется в лотке и открывается
  const prize = mkBall(winnerLogin, BALL, 3); prize.classList.add('tray-in'); tray.appendChild(prize);
  machine.classList.remove('busy'); machine.classList.add('win');
  if (!(await setLen(20, 300))) return;
  if (!(await wait(450))) return;
  prize.classList.add('open');
  const banner = document.createElement('div'); banner.className = 'claw-banner'; banner.textContent = '🎁 ' + (winnerName || state.users.get(winnerLogin) || winnerLogin); win.appendChild(banner);
  void banner.offsetWidth; banner.classList.add('show');
  try { burstConfetti(win, W / 2, H * 0.34, 36); } catch (e) {}
  if (!(await wait(2300))) return;
  els.spinClaw.hidden = true;
}

/* === PUBG: карта острова, самолёт сбрасывает игроков, зона сужается, перестрелки, финал у аирдропа === */
function pubgBuildMap(svg) {
  const mulberry32 = (a) => () => { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rnd = mulberry32(20240607);   // карта всегда одинаковая
  const CX = 320, CY = 320;
  const rAt = (a) => 236 + 20 * Math.sin(3 * a + 1) + 13 * Math.sin(5 * a + 2) + 9 * Math.sin(7 * a + 0.5);
  const inside = (x, y, sc) => Math.hypot(x - CX, y - CY) < rAt(Math.atan2(y - CY, x - CX)) * (sc == null ? 1 : sc);
  const poly = (sc) => { const pts = []; for (let i = 0; i < 90; i++) { const a = i / 90 * Math.PI * 2; const r = rAt(a) * sc; pts.push((CX + Math.cos(a) * r).toFixed(1) + ',' + (CY + Math.sin(a) * r).toFixed(1)); } return pts.join(' '); };
  const f1 = (n) => n.toFixed(1);
  const randIn = (sc) => { for (let i = 0; i < 300; i++) { const x = 60 + rnd() * 520, y = 60 + rnd() * 520; if (inside(x, y, sc)) return [x, y]; } return [CX, CY]; };

  const locs = [
    { n: 'Покровка', x: 325, y: 305, t: 'city' }, { n: 'Школа', x: 262, y: 372, t: 'school' }, { n: 'Военная база', x: 470, y: 185, t: 'military' },
    { n: 'Порт', x: 520, y: 420, t: 'port' }, { n: 'Завод', x: 195, y: 228, t: 'factory' }, { n: 'Каменка', x: 140, y: 352, t: 'town' },
    { n: 'Озёрск', x: 432, y: 352, t: 'town' }, { n: 'Лесхоз', x: 248, y: 140, t: 'village' }, { n: 'Ферма', x: 395, y: 478, t: 'farm' },
    { n: 'Бункер', x: 340, y: 150, t: 'bunker' }, { n: 'Рыбацкий', x: 108, y: 250, t: 'village' }, { n: 'Шахта', x: 545, y: 300, t: 'mine' }, { n: 'Мост', x: 300, y: 455, t: 'bridge' }
  ];
  locs.forEach((l) => { for (let i = 0; i < 12 && !inside(l.x, l.y, 0.84); i++) { l.x += (CX - l.x) * 0.1; l.y += (CY - l.y) * 0.1; } });
  const L = (name) => locs.find((l) => l.n === name);

  let s = '<defs>' +
    '<linearGradient id="pgOcean" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f6194"/><stop offset="1" stop-color="#12395f"/></linearGradient>' +
    '<pattern id="pgWaves" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(20)"><path d="M0 11 Q5.5 6 11 11 T22 11" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="1.4"/></pattern>' +
    '<radialGradient id="pgGrass" cx="0.45" cy="0.42" r="0.7"><stop offset="0" stop-color="#86ad5f"/><stop offset="1" stop-color="#5f8b45"/></radialGradient>' +
    '<clipPath id="pgIsland"><polygon points="' + poly(0.955) + '"/></clipPath></defs>';
  s += '<rect width="640" height="640" fill="url(#pgOcean)"/><rect width="640" height="640" fill="url(#pgWaves)"/>';
  s += '<polygon points="' + poly(1.03) + '" fill="#e3d49b" stroke="#cdb978" stroke-width="3" stroke-linejoin="round"/>';
  s += '<polygon points="' + poly(0.955) + '" fill="url(#pgGrass)"/>';
  s += '<g clip-path="url(#pgIsland)">';

  // поля
  const fieldCols = ['#b9c878', '#cdb86a', '#9cb860', '#c9c07a'];
  for (let i = 0; i < 9; i++) { const [x, y] = randIn(0.8); s += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + (26 + rnd() * 26) + '" height="' + (16 + rnd() * 16) + '" fill="' + fieldCols[i % 4] + '" opacity="0.85" transform="rotate(' + Math.round(rnd() * 90) + ' ' + f1(x) + ' ' + f1(y) + ')"/>'; }
  // леса
  for (let c = 0; c < 13; c++) {
    let [x, y] = randIn(0.84); if (locs.some((l) => Math.hypot(l.x - x, l.y - y) < 60)) continue;
    for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, r = rnd() * 32; const rr = 8 + rnd() * 8; s += '<circle cx="' + f1(x + Math.cos(a) * r) + '" cy="' + f1(y + Math.sin(a) * r) + '" r="' + f1(rr) + '" fill="#3e6c35" opacity="0.9"/>'; }
    for (let i = 0; i < 4; i++) { const a = rnd() * 6.283, r = rnd() * 22; s += '<circle cx="' + f1(x + Math.cos(a) * r - 2) + '" cy="' + f1(y + Math.sin(a) * r - 2) + '" r="4" fill="#528a45" opacity="0.7"/>'; }
  }
  // горы на северо-востоке
  [[440, 118], [468, 108], [496, 124], [452, 140], [482, 146]].forEach(([x, y]) => { s += '<polygon points="' + x + ',' + (y - 20) + ' ' + (x + 18) + ',' + (y + 12) + ' ' + (x - 18) + ',' + (y + 12) + '" fill="#8d9189" stroke="#6c7068" stroke-width="1"/><polygon points="' + x + ',' + (y - 20) + ' ' + (x + 7) + ',' + (y - 4) + ' ' + (x - 3) + ',' + (y - 1) + '" fill="#c4c8c0"/>'; });
  // озёра и реки
  s += '<ellipse cx="440" cy="300" rx="30" ry="17" fill="#3f8fbf" stroke="#2d6d96" stroke-width="2" transform="rotate(-20 440 300)"/>';
  s += '<ellipse cx="215" cy="305" rx="19" ry="12" fill="#3f8fbf" stroke="#2d6d96" stroke-width="2" transform="rotate(15 215 305)"/>';
  s += '<path d="M440 316 Q472 360 478 410 T505 520" fill="none" stroke="#3f8fbf" stroke-width="5" stroke-linecap="round"/>';
  s += '<path d="M215 316 Q250 380 296 452 T340 600" fill="none" stroke="#3f8fbf" stroke-width="5" stroke-linecap="round"/>';
  // дороги
  [['Покровка', 'Школа'], ['Покровка', 'Озёрск'], ['Покровка', 'Бункер'], ['Покровка', 'Завод'], ['Школа', 'Каменка'], ['Школа', 'Мост'], ['Озёрск', 'Ферма'], ['Озёрск', 'Порт'],
   ['Порт', 'Шахта'], ['Шахта', 'Военная база'], ['Бункер', 'Лесхоз'], ['Каменка', 'Рыбацкий'], ['Завод', 'Лесхоз'], ['Мост', 'Ферма']].forEach(([a, b]) => {
    const A = L(a), B2 = L(b); const mx = (A.x + B2.x) / 2, my = (A.y + B2.y) / 2; const dx = B2.x - A.x, dy = B2.y - A.y; const k = (rnd() - 0.5) * 0.35;
    const d = 'M' + f1(A.x) + ' ' + f1(A.y) + ' Q' + f1(mx - dy * k) + ' ' + f1(my + dx * k) + ' ' + f1(B2.x) + ' ' + f1(B2.y);
    s += '<path d="' + d + '" fill="none" stroke="#7c6e50" stroke-width="5" stroke-linecap="round"/><path d="' + d + '" fill="none" stroke="#dccfa8" stroke-width="3" stroke-linecap="round"/>';
  });
  s += '</g>';

  // поселения
  const B = (x, y, w, h, fill, stroke) => '<rect x="' + f1(x - w / 2) + '" y="' + f1(y - h / 2) + '" width="' + w + '" height="' + h + '" fill="' + (fill || '#d8c8a5') + '" stroke="' + (stroke || '#6f6249') + '" stroke-width="0.9" rx="1"/>';
  const cluster = (x, y, n, rad, wmin, wmax) => { let o = ''; for (let i = 0; i < n; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * rad; o += B(x + Math.cos(a) * r, y + Math.sin(a) * r, wmin + Math.round(rnd() * (wmax - wmin)), wmin - 2 + Math.round(rnd() * (wmax - wmin - 2))); } return o; };
  locs.forEach((l) => {
    const { x, y } = l;
    if (l.t === 'city') s += '<path d="M' + (x - 42) + ' ' + y + ' H' + (x + 42) + ' M' + x + ' ' + (y - 42) + ' V' + (y + 42) + '" stroke="#c9bb97" stroke-width="3" opacity="0.85"/>' + cluster(x, y, 20, 38, 8, 14);
    else if (l.t === 'town') s += cluster(x, y, 10, 25, 7, 11);
    else if (l.t === 'village') s += cluster(x, y, 5, 16, 6, 9);
    else if (l.t === 'school') s += '<ellipse cx="' + (x - 8) + '" cy="' + (y + 22) + '" rx="15" ry="8" fill="#b4c89a" stroke="#fff" stroke-width="1" opacity="0.9"/>' + B(x, y, 28, 14, '#cfd6dd', '#58626c') + B(x + 22, y + 4, 12, 10, '#cfd6dd', '#58626c');
    else if (l.t === 'military') s += B(x, y, 70, 46, '#7e8873', '#434a3b') + B(x - 18, y - 8, 16, 10, '#565d4c', '#2f3529') + B(x + 4, y + 8, 22, 10, '#565d4c', '#2f3529') + B(x + 20, y - 10, 12, 12, '#565d4c', '#2f3529') + '<circle cx="' + (x - 20) + '" cy="' + (y + 12) + '" r="7" fill="none" stroke="#e6d36a" stroke-width="1.6"/>';
    else if (l.t === 'factory') s += B(x - 12, y, 26, 16, '#a9aeb6', '#4b5260') + B(x + 14, y + 6, 20, 12, '#a9aeb6', '#4b5260') + B(x, y - 16, 16, 10, '#9aa0a8', '#4b5260') + '<circle cx="' + (x - 20) + '" cy="' + (y - 12) + '" r="3.5" fill="#6f757e"/><circle cx="' + (x - 11) + '" cy="' + (y - 14) + '" r="3.5" fill="#6f757e"/>';
    else if (l.t === 'port') { const a = Math.atan2(y - CY, x - CX); s += '<line x1="' + x + '" y1="' + y + '" x2="' + f1(x + Math.cos(a) * 40) + '" y2="' + f1(y + Math.sin(a) * 40) + '" stroke="#7a5c3a" stroke-width="5" stroke-linecap="round"/>' + B(x - 14, y - 6, 18, 12, '#cfc7b6') + B(x + 2, y + 12, 22, 12, '#cfc7b6') + B(x - 18, y + 12, 14, 10, '#c0b8a6'); }
    else if (l.t === 'farm') s += B(x - 36, y + 6, 34, 20, '#c9c07a', '#8a8248') + B(x + 36, y - 4, 32, 22, '#9cb860', '#6b8a3c') + B(x, y, 14, 10) + B(x + 14, y + 8, 16, 11, '#b85a4a', '#6b2c22');
    else if (l.t === 'bunker') s += '<circle cx="' + x + '" cy="' + y + '" r="12" fill="none" stroke="#6c7068" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="' + x + '" cy="' + y + '" r="6" fill="#3a3f36" stroke="#8d9189" stroke-width="1.5"/>';
    else if (l.t === 'mine') s += '<polygon points="' + (x - 16) + ',' + (y + 10) + ' ' + (x - 6) + ',' + (y - 12) + ' ' + (x + 12) + ',' + (y - 8) + ' ' + (x + 18) + ',' + (y + 10) + '" fill="#8a6d4b" stroke="#5e4930" stroke-width="1.2"/><circle cx="' + x + '" cy="' + (y + 2) + '" r="5" fill="#2e2418"/>';
    else if (l.t === 'bridge') s += '<rect x="' + (x - 13) + '" y="' + (y - 4) + '" width="26" height="8" fill="#8a6d4b" stroke="#4e3a22" stroke-width="1.2" rx="1"/>';
  });
  // подписи
  locs.forEach((l) => { const big = l.t === 'city'; s += '<text x="' + f1(l.x) + '" y="' + f1(l.y + (big ? 56 : (l.t === 'military' || l.t === 'farm' ? 40 : 32))) + '" text-anchor="middle" font-family="Arial, sans-serif" font-size="' + (big ? 15 : 12) + '" font-weight="800" fill="#fff" stroke="#1c2b18" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round">' + l.n + '</text>'; });
  // сетка карты
  s += '<g stroke="rgba(255,255,255,0.13)" stroke-width="1">'; for (let i = 1; i < 8; i++) s += '<line x1="' + i * 80 + '" y1="0" x2="' + i * 80 + '" y2="640"/><line x1="0" y1="' + i * 80 + '" x2="640" y2="' + i * 80 + '"/>'; s += '</g>';
  s += '<g font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="rgba(255,255,255,0.7)">'; for (let i = 0; i < 8; i++) s += '<text x="' + (i * 80 + 38) + '" y="11">' + 'ABCDEFGH'[i] + '</text><text x="4" y="' + (i * 80 + 44) + '">' + (i + 1) + '</text>'; s += '</g>';
  svg.innerHTML = s;
  return { inside, locs, M: { x: CX, y: CY } };
}

let pubgRunId = 0;   // номер запуска: закрыли игру и запустили заново — старый запуск сам останавливается
async function playPubg(pool, winnerLogin, winnerName) {
  const runId = ++pubgRunId;
  const alive = () => runId === pubgRunId && !spinCancel;
  const wait = async (ms) => { await sleep(ms); return alive(); };
  [els.spinRoulette, els.spinDrum, els.spinCase, els.spinCards, els.spinWheel, els.spinBingo, els.spinHotPotato,
   els.spinLaser, els.spinZeus, els.spinElevator, els.spinSpotlight, els.spinClock, els.spinClaw, els.spinBomb]
    .forEach((el) => { if (el) el.hidden = true; });
  els.spinPubg.hidden = false; await sleep(50);
  if (!alive()) return;

  const S = 640; const svgNS = 'http://www.w3.org/2000/svg'; const $ = (id) => document.getElementById(id);
  const mapEl = $('pg-map'); const playersEl = $('pg-players'); const planeEl = $('pg-plane'); const airdropEl = $('pg-airdrop');
  const aliveEl = $('pg-alive'); const zoneInfoEl = $('pg-zone-info'); const feedEl = $('pg-feed'); const bannerEl = $('pg-banner'); const fx = $('pg-fx');
  const zHole = $('pg-zone-hole'); const zEdge = $('pg-zone-edge'); const zNext = $('pg-zone-next');
  const world = pubgBuildMap($('pg-map-svg'));

  // Сброс
  playersEl.innerHTML = ''; fx.innerHTML = ''; feedEl.innerHTML = ''; bannerEl.className = 'pg-banner'; bannerEl.textContent = '';
  airdropEl.className = 'pg-airdrop'; planeEl.style.transition = 'none'; planeEl.style.opacity = '0';
  let cur = { cx: 320, cy: 320, r: 470 };
  const setZone = (cx, cy, r) => { [zHole, zEdge].forEach((c) => { c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); }); cur = { cx, cy, r }; };
  setZone(320, 320, 470); zNext.setAttribute('opacity', '0');
  const info = (t) => { zoneInfoEl.textContent = t; };
  const rnd = (a, b) => a + Math.random() * (b - a);

  // 20–25 участников (если в списке меньше — все), победитель обязательно среди них
  const uniq = [...new Set(pool)]; if (!uniq.includes(winnerLogin)) uniq.push(winnerLogin);
  const want = Math.min(uniq.length, 20 + Math.floor(Math.random() * 6));
  const chosen = [winnerLogin, ...uniq.filter((l) => l !== winnerLogin).sort(() => Math.random() - 0.5).slice(0, want - 1)];
  const players = chosen.map((login) => {
    const name = state.users.get(login) || login;
    const el = document.createElement('div'); el.className = 'pg-player';
    const chute = document.createElement('div'); chute.className = 'pg-chute'; chute.textContent = '🪂';
    const av = document.createElement('div'); av.className = 'pg-av'; av.style.background = avatarGradient(login); av.textContent = (name || '?').charAt(0).toUpperCase();
    const nick = document.createElement('div'); nick.className = 'pg-nick'; nick.textContent = name;
    el.appendChild(chute); el.appendChild(av); el.appendChild(nick); playersEl.appendChild(el);
    return { login, name, el, av, x: 160, y: 160, alive: true, role: null, land: null };
  });
  const W = players[0]; W.role = 'W';
  const rest0 = players.slice(1);
  const Zp = rest0.length >= 2 ? rest0[0] : null;                 // тот, кого съест зона
  const Sp = rest0.length >= 2 ? rest0[1] : (rest0[0] || null);  // тот, кого застрелит победитель
  if (Zp) Zp.role = 'Z'; if (Sp) Sp.role = 'S';

  const place = (p, x, y, ms, ease) => { p.x = x; p.y = y; p.el.style.transition = ms ? 'left ' + ms + 'ms ' + (ease || 'linear') + ', top ' + ms + 'ms ' + (ease || 'linear') : 'none'; p.el.style.left = (x / S * 100) + '%'; p.el.style.top = (y / S * 100) + '%'; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const refreshAlive = () => { aliveEl.textContent = '👥 ' + players.filter((p) => p.alive).length; };
  refreshAlive();
  const feedLine = (a, sym, b) => {
    const d = document.createElement('div'); d.className = 'pg-feed-line';
    const sa = document.createElement('span'); sa.className = 'k'; sa.textContent = a; const m = document.createElement('span'); m.textContent = ' ' + sym + ' '; const sb = document.createElement('span'); sb.className = 'v'; sb.textContent = b;
    d.appendChild(sa); d.appendChild(m); d.appendChild(sb); feedEl.appendChild(d); while (feedEl.children.length > 5) feedEl.firstChild.remove(); setTimeout(() => d.remove(), 5200);
  };
  const kill = (p, killer) => {
    if (!p.alive) return; p.alive = false; p.el.classList.remove('running', 'danger'); p.el.classList.add('dead'); refreshAlive();
    if (killer) feedLine(killer.name, '🔫', p.name); else feedLine('🔷 Зона', '☠', p.name);
    setTimeout(() => { if (alive()) { p.el.style.transition = 'opacity 0.6s'; p.el.style.opacity = '0'; } }, 1300);
  };
  const tracer = (a, b) => {
    const ln = document.createElementNS(svgNS, 'line'); ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
    ln.setAttribute('stroke', '#ffe27a'); ln.setAttribute('stroke-width', '2.4'); ln.setAttribute('stroke-linecap', 'round'); fx.appendChild(ln);
    ln.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => ln.remove();
    const hit = document.createElementNS(svgNS, 'circle'); hit.setAttribute('cx', b.x); hit.setAttribute('cy', b.y); hit.setAttribute('r', 9); hit.setAttribute('fill', '#ffb03a'); hit.setAttribute('class', 'pg-hit'); fx.appendChild(hit); setTimeout(() => hit.remove(), 480);
    a.av.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 180 });
  };
  const shoot = (a, b) => { tracer(a, b); kill(b, a); };
  const randomShot = () => {   // случайно застрелить соседа
    const pairs = [];
    players.filter((p) => p.alive && !p.role).forEach((v) => {
      const nb = players.filter((o) => o.alive && o !== v && dist(o, v) < 120).sort((a, b) => dist(a, v) - dist(b, v))[0];
      if (nb) pairs.push([nb, v]);
    });
    if (!pairs.length) return false; const [sh, vi] = pairs[Math.floor(Math.random() * pairs.length)]; shoot(sh, vi); return true;
  };
  const animateZone = (to, ms) => new Promise((resolve) => {
    const from = { ...cur }; const t0 = performance.now();
    const step = (now) => { if (!alive()) { resolve(); return; } const t = Math.min((now - t0) / ms, 1); setZone(from.cx + (to.cx - from.cx) * t, from.cy + (to.cy - from.cy) * t, from.r + (to.r - from.r) * t); if (t < 1) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  });

  // Точки приземления: тройка финалистов — рядом с будущим аирдропом, остальные по острову (часть — у городов)
  let D = { x: 320, y: 320 };
  for (let i = 0; i < 300; i++) { const a = rnd(0, 6.283), r = rnd(30, 130); const x = 320 + Math.cos(a) * r, y = 320 + Math.sin(a) * r; if (world.inside(x, y, 0.6)) { D = { x, y }; break; } }
  const spots = []; const farEnough = (x, y, md) => spots.every((s) => Math.hypot(s.x - x, s.y - y) >= md);
  const nearD = (rmin, rmax) => { for (let i = 0; i < 300; i++) { const a = rnd(0, 6.283), r = rnd(rmin, rmax); const x = D.x + Math.cos(a) * r, y = D.y + Math.sin(a) * r; if (world.inside(x, y, 0.86) && farEnough(x, y, 55)) return { x, y }; } return { x: D.x + rnd(-40, 40), y: D.y + rnd(-40, 40) }; };
  [W, Zp, Sp].forEach((p) => { if (p) { p.land = nearD(60, 125); spots.push(p.land); } });
  players.filter((p) => !p.land).forEach((p) => {
    let pt = null;
    for (let md = 54; md >= 30 && !pt; md -= 8) for (let i = 0; i < 250 && !pt; i++) {
      let x, y; if (Math.random() < 0.55) { const l = world.locs[Math.floor(Math.random() * world.locs.length)]; x = l.x + rnd(-42, 42); y = l.y + rnd(-42, 42); } else { x = rnd(70, 570); y = rnd(70, 570); }
      if (world.inside(x, y, 0.86) && farEnough(x, y, md)) pt = { x, y };
    }
    p.land = pt || { x: 320 + rnd(-70, 70), y: 320 + rnd(-70, 70) }; spots.push(p.land);
  });

  // ===== 1. Самолёт летит над островом и сбрасывает игроков =====
  info('✈ Самолёт над островом — десант!');
  const ang = rnd(0, 6.283); const dir = { x: Math.cos(ang), y: Math.sin(ang) }; const perp = { x: -dir.y, y: dir.x };
  const off = rnd(-60, 60); const Qp = { x: 320 + perp.x * off, y: 320 + perp.y * off }; const HALF = 440; const FLIGHT = 6500;
  const pStart = { x: Qp.x - dir.x * HALF, y: Qp.y - dir.y * HALF }; const pEnd = { x: Qp.x + dir.x * HALF, y: Qp.y + dir.y * HALF };
  const route = document.createElementNS(svgNS, 'line'); route.setAttribute('x1', pStart.x); route.setAttribute('y1', pStart.y); route.setAttribute('x2', pEnd.x); route.setAttribute('y2', pEnd.y);
  route.setAttribute('stroke', 'rgba(255,255,255,0.55)'); route.setAttribute('stroke-width', '2'); route.setAttribute('stroke-dasharray', '7 7'); fx.appendChild(route);
  planeEl.style.transform = 'rotate(' + (ang * 180 / Math.PI + 90) + 'deg)';
  planeEl.style.left = (pStart.x / S * 100) + '%'; planeEl.style.top = (pStart.y / S * 100) + '%'; planeEl.style.opacity = '1'; void planeEl.offsetWidth;
  planeEl.style.transition = 'left ' + FLIGHT + 'ms linear, top ' + FLIGHT + 'ms linear';
  planeEl.style.left = (pEnd.x / S * 100) + '%'; planeEl.style.top = (pEnd.y / S * 100) + '%';
  setTimeout(() => { if (alive()) { planeEl.style.opacity = '0'; route.remove(); } }, FLIGHT + 200);

  let lastLand = 0;
  players.forEach((p) => {
    const t = Math.max(0.12, Math.min(0.9, ((p.land.x - pStart.x) * dir.x + (p.land.y - pStart.y) * dir.y) / (2 * HALF)));   // прыгает, когда самолёт ближе всего к его точке
    const jumpAt = t * FLIGHT; const pp = { x: pStart.x + (pEnd.x - pStart.x) * t, y: pStart.y + (pEnd.y - pStart.y) * t };
    const glide = 800 + Math.hypot(p.land.x - pp.x, p.land.y - pp.y) * 4.5; lastLand = Math.max(lastLand, jumpAt + glide);
    setTimeout(() => {
      if (!alive()) return;
      p.el.classList.add('dropping'); p.el.style.opacity = '1'; place(p, pp.x, pp.y, 0); void p.el.offsetWidth;
      place(p, p.land.x, p.land.y, glide, 'cubic-bezier(0.25, 0.6, 0.35, 1)');
      setTimeout(() => { if (alive()) p.el.classList.remove('dropping'); }, glide);
    }, jumpAt);
  });
  if (!(await wait(lastLand + 500))) return;

  // ===== 2. Бой на земле =====
  info('🔫 Бой на земле');
  for (let i = 0; i < 2; i++) { if (randomShot()) { if (!(await wait(700))) return; } }
  await wait(500); if (!alive()) return;

  // ===== 3. Сужение зоны: 3–5 этапов, последний — финал у аирдропа =====
  const P = 3 + Math.floor(Math.random() * 3);
  let prevR = 470;
  const runTarget = (p, c, R) => {
    const dx = c.cx - p.x, dy = c.cy - p.y; const d = Math.hypot(dx, dy) || 1;
    if (d > R - 6) { const need = d - (R - 14 - Math.random() * 8); const mv = need * (p.role ? 1 : 0.35 + Math.random() * 0.5); return { x: p.x + dx / d * mv, y: p.y + dy / d * mv, out: !p.role }; }
    const mv = Math.min(d * 0.35, 8 + Math.random() * 26); return { x: p.x + dx / d * mv, y: p.y + dy / d * mv, out: false };
  };
  for (let k = 1; k < P; k++) {
    if (!alive()) return;
    if (k === P - 1) {   // перед последними зонами падает аирдроп
      airdropEl.style.left = (D.x / S * 100) + '%'; airdropEl.style.top = (D.y / S * 100) + '%'; airdropEl.classList.add('show');
      setTimeout(() => { if (alive()) airdropEl.classList.add('landed'); }, 2200); feedLine('📦', '', 'Аирдроп приземлился!');
    }
    const t = k / P * 0.9; const c = { cx: 320 + (D.x - 320) * t, cy: 320 + (D.y - 320) * t };
    const np = players.filter((p) => p.alive && !p.role).map((p) => ({ p, d: Math.hypot(p.x - c.cx, p.y - c.cy) })).sort((a, b) => a.d - b.d);
    const keep = Math.round(np.length * (k === P - 1 ? 0.45 : 0.6 + Math.random() * 0.12));
    let R = keep > 0 ? np[Math.min(keep, np.length) - 1].d + 10 : 90;
    R = Math.min(Math.max(R, 84 + (P - 1 - k) * 22), prevR * 0.88);

    // пунктирная линия новой зоны
    zNext.setAttribute('cx', c.cx); zNext.setAttribute('cy', c.cy); zNext.setAttribute('r', R); zNext.setAttribute('opacity', '1');
    info('🔷 Зона ' + k + '/' + P + ': новая зона отмечена');
    if (Math.random() < 0.6) randomShot();
    if (!(await wait(1500))) return;

    // зона сужается, игроки бегут в центр
    info('🔷 Зона ' + k + '/' + P + ': сужается — бегите в круг!');
    const SH = 2800;
    players.filter((p) => p.alive).forEach((p) => { const tg = runTarget(p, c, R); place(p, tg.x, tg.y, SH); p.el.classList.add('running'); if (tg.out) p.el.classList.add('danger'); });
    await animateZone({ cx: c.cx, cy: c.cy, r: R }, SH);
    if (!alive()) return;
    zNext.setAttribute('opacity', '0'); players.forEach((p) => p.el.classList.remove('running'));
    const out = players.filter((p) => p.alive && !p.role && Math.hypot(p.x - c.cx, p.y - c.cy) > R + 0.5);
    for (const p of out) { kill(p, null); if (!(await wait(140))) return; }
    players.forEach((p) => p.el.classList.remove('danger'));
    prevR = R;

    // перестрелки между соседями
    const shots = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < shots; i++) { if (randomShot()) { if (!(await wait(450))) return; } }
    if (!(await wait(500))) return;
  }

  // ===== 4. Финал у аирдропа =====
  info('⚔ Финал у аирдропа!');
  zNext.setAttribute('opacity', '0');
  players.filter((p) => p.alive).forEach((p) => {   // все стягиваются к аирдропу
    const d = dist(p, D); const k = Math.min(1, 70 / (d || 1)); place(p, D.x + (p.x - D.x) * k, D.y + (p.y - D.y) * k, 1000); p.el.classList.add('running');
  });
  if (!(await wait(1100))) return;
  players.forEach((p) => p.el.classList.remove('running'));
  let left = players.filter((p) => p.alive && !p.role);
  const gap = Math.max(240, Math.min(620, 3200 / Math.max(left.length, 1)));
  while ((left = players.filter((p) => p.alive && !p.role)).length) {   // лишние выбывают в перестрелке
    if (!alive()) return;
    const v = left[Math.floor(Math.random() * left.length)];
    const sh = players.filter((o) => o.alive && o !== v).sort((a, b) => dist(a, v) - dist(b, v))[0];
    if (sh) shoot(sh, v); else kill(v, null);
    if (!(await wait(gap))) return;
  }
  // трое у аирдропа: Z — чуть за будущей границей, W и S — внутри
  const Rf = 56; const form = [[W, 200, Rf - 26], [Sp, 340, Rf - 26], [Zp, 90, Rf + 28]];
  form.forEach(([p, deg, d]) => { if (p && p.alive) place(p, D.x + Math.cos(deg * Math.PI / 180) * d, D.y + Math.sin(deg * Math.PI / 180) * d, 900); });
  if (!(await wait(1000))) return;
  zNext.setAttribute('cx', D.x); zNext.setAttribute('cy', D.y); zNext.setAttribute('r', Rf); zNext.setAttribute('opacity', '1');
  info('🔷 Последняя зона ' + P + '/' + P + ' — кто-то не успеет');
  if (!(await wait(1400))) return;
  if (Zp && Zp.alive) { const tg = runTarget(Zp, { cx: D.x, cy: D.y }, Rf); place(Zp, Zp.x + (tg.x - Zp.x) * 0.3, Zp.y + (tg.y - Zp.y) * 0.3, 2800); Zp.el.classList.add('running', 'danger'); }
  await animateZone({ cx: D.x, cy: D.y, r: Rf }, 2800);
  if (!alive()) return;
  zNext.setAttribute('opacity', '0');
  if (Zp && Zp.alive) kill(Zp, null);                    // первого съела зона
  if (!(await wait(1000))) return;
  if (Sp && Sp.alive) {                                  // второго убивает победитель
    info('🔫 Дуэль за победу!');
    for (let i = 0; i < 3; i++) { tracer(W, Sp); if (!(await wait(240))) return; }
    kill(Sp, W);
    if (!(await wait(800))) return;
  }

  // ===== 5. Победа =====
  info('🏆 Победитель определён!');
  W.el.classList.add('winner');
  bannerEl.textContent = '🍗 ПОБЕДИТЕЛЬ: ' + (winnerName || W.name); void bannerEl.offsetWidth; bannerEl.classList.add('show');
  try { burstConfetti(mapEl, W.x / S * mapEl.clientWidth, W.y / S * mapEl.clientHeight, 44); } catch (e) {}
  if (!(await wait(2800))) return;
  els.spinPubg.hidden = true;
}

/* === КАРТЫ: раздача → показ ников → переворот → перемешивание → выбор === */
async function playCards(pool) {
  [els.spinRoulette, els.spinDrum, els.spinCase, els.spinWheel, els.spinBingo, els.spinHotPotato,
   els.spinLaser, els.spinZeus, els.spinElevator, els.spinSpotlight, els.spinClock, els.spinClaw, els.spinPubg, els.spinBomb]
    .forEach((el) => { if (el) el.hidden = true; });
  els.spinCards.hidden = false;

  const grid = els.cardsGrid;
  const header = document.getElementById('cards-header');
  const setHeader = (text, pick) => { header.textContent = text; header.classList.toggle('cards-header-pick', !!pick); };
  grid.innerHTML = '';
  grid.classList.remove('pickable');

  // До 10 случайных участников из пула
  const logins = [...new Set(pool)];
  for (let i = logins.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [logins[i], logins[j]] = [logins[j], logins[i]]; }
  logins.length = Math.min(logins.length, 10);
  if (logins.length === 0) return null;

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const wait = async (ms) => { await sleep(ms); return !spinCancel; };

  // 1. Раздача: карты лежат лицом вверх, видны ники
  const cards = logins.map((login, i) => {
    const name = state.users.get(login) || login;
    const letter = (name || '?').charAt(0).toUpperCase();
    const card = mk('div', 'pick-card pick-card-flipped');
    card.style.setProperty('--deal', (i * 0.07) + 's');
    const inner = mk('div', 'pick-card-inner');
    const back = mk('div', 'pick-card-face pick-card-back');
    const front = mk('div', 'pick-card-face pick-card-front');
    ['tl', 'br'].forEach((pos) => {
      const corner = mk('div', 'pick-card-corner ' + pos);
      corner.appendChild(mk('span', null, letter)); corner.appendChild(mk('span', 'pick-card-suit', '◆'));
      front.appendChild(corner);
    });
    const avatar = mk('div', 'pick-card-avatar', letter); avatar.style.background = avatarGradient(login);
    const nameEl = mk('div', 'pick-card-name', name); if (name.length > 14) nameEl.style.fontSize = '8.5px'; else if (name.length > 10) nameEl.style.fontSize = '9.5px';
    front.appendChild(avatar); front.appendChild(nameEl);
    inner.appendChild(back); inner.appendChild(front); card.appendChild(inner);
    grid.appendChild(card);
    return card;
  });

  setHeader('Запоминайте карты');
  if (!(await wait(1700 + logins.length * 70))) return null;

  // 2. Переворачиваем рубашкой вверх
  cards.forEach((c) => c.classList.remove('pick-card-flipped'));
  setHeader('Переворачиваем…');
  if (!(await wait(900))) return null;

  // 3. Перемешиваем: карты меняются местами (через CSS translate)
  setHeader('Перемешиваем…');
  const slots = cards.map((c) => ({ x: c.offsetLeft, y: c.offsetTop }));
  let order = cards.map((_, i) => i);                       // order[k] — слот, где сейчас стоит карта k
  for (let r = 0; r < 7; r++) {
    const perm = [...order];
    for (let i = perm.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    cards.forEach((c, k) => { c.style.translate = (slots[perm[k]].x - slots[k].x) + 'px ' + (slots[perm[k]].y - slots[k].y) + 'px'; });
    order = perm;
    if (!(await wait(580))) return null;
  }

  // 4. Стример выбирает карту кликом
  setHeader('Выберите карту!', true);
  grid.classList.add('pickable');
  const picked = await new Promise((resolve) => {
    let done = false; let poll = null;
    const finish = (v) => { if (done) return; done = true; clearInterval(poll); cards.forEach((c) => { c.onclick = null; }); resolve(v); };
    cards.forEach((c, k) => { c.onclick = () => finish(k); });
    poll = setInterval(() => { if (spinCancel) finish(-1); }, 150);
  });
  grid.classList.remove('pickable');
  if (picked < 0 || spinCancel) return null;

  // 5. Открываем выбранную, затем остальные
  setHeader('Ваша карта!');
  cards[picked].classList.add('pick-card-flipped', 'pick-card-winner');
  if (!(await wait(1000))) return null;
  cards.forEach((c, k) => { if (k !== picked) c.classList.add('pick-card-flipped', 'pick-card-dim'); });
  if (!(await wait(1500))) return null;
  return logins[picked];
}

async function showCardsPick(pool, riggedLogin = null) {
  clearWinnerTimer(); state.winnerHasResponded = false; state.isSpinning = true; spinCancel = false; state.currentWinner = null;
  els.modal.classList.add('active'); els.modalContent.classList.add('spinning');
  els.winnerMessages.innerHTML = ''; els.winnerTimer.textContent = '0:00'; els.winnerTimer.classList.remove('timer-done');
  els.modalPayoutInput.value = ''; els.modalSpin.hidden = false;
  if (els.modalDepInput) els.modalDepInput.value = '';
  updateCommitButton();
  const pickedLogin = await playCards(pool, riggedLogin);
  if (spinCancel || !pickedLogin) { els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true; els.spinCards.hidden = true; state.isSpinning = false; return; }
  state.currentWinner = pickedLogin; state.winnerSelectedAt = Date.now();
  els.winnerName.textContent = state.users.get(pickedLogin) || pickedLogin;
  await sleep(700);
  if (spinCancel) { els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true; els.spinCards.hidden = true; state.currentWinner = null; state.isSpinning = false; return; }
  els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true; els.spinCards.hidden = true; state.isSpinning = false;
  fillWinnerInfo(pickedLogin);
}

function updateCommitButton() {
  if (!els.modalPayoutBtn) return;
  const hasSite = !!state.selectedSite, hasPayout = !!els.modalPayoutInput.value.trim();
  const hasDep = els.modalDepInput ? !!els.modalDepInput.value.trim() : true;
  els.modalPayoutBtn.disabled = !(hasSite && hasPayout && hasDep);
}
function commitCurrentWinner() {
  if (!state.currentWinner) return;
  const payout = els.modalPayoutInput.value.trim(); const dep = els.modalDepInput ? els.modalDepInput.value.trim() : '';
  if (!state.selectedSite || !payout || !dep) { addSystemMessage('⚠ Укажите сайт, вывод и деп.'); return; }
  const displayName = state.users.get(state.currentWinner) || state.currentWinner;
  const siteName = SITES.find(s => s.id === state.selectedSite)?.name || state.selectedSite;
  addWinnerToHistory(displayName, payout, state.selectedSite, dep);
  let msg = '🏆 Победитель: ' + displayName;
  if (payout) msg += ' — ' + payout + ' ₽'; if (siteName) msg += ' [' + siteName + ']'; if (dep) msg += ' (деп: ' + dep + ' ₽)';
  addSystemMessage(msg); closeWinnerModal();
}
function closeWinnerModal() {
  if (state.isSpinning) {
    spinCancel = true;
    if (cardsCancelFn) cardsCancelFn();
    if (bombCancelFn) bombCancelFn();
    if (spotlightCancelFn) spotlightCancelFn();
    if (clockCancelFn) clockCancelFn();
    state.isSpinning = false;
  }
  els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true;
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; els.spinElevator.hidden = true; els.spinSpotlight.hidden = true; els.spinClock.hidden = true; els.spinBomb.hidden = true;
  els.modalPayoutInput.value = ''; clearWinnerTimer(); state.currentWinner = null;
  if (els.modalDepInput) els.modalDepInput.value = '';
  if (els.copyWinnerBtn) { els.copyWinnerBtn.classList.remove('copied'); els.copyWinnerBtn.textContent = '📋'; }
}

/* =========================================================
   РЕНДЕР ПОБЕДИТЕЛЕЙ
   ========================================================= */
function getSortedWinners(list) {
  const arr = [...list];
  if (state.sortMode === 'payout') {
    arr.sort((a, b) => {
      const pa = parseFloat(String(a.payout || '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
      const pb = parseFloat(String(b.payout || '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
      if (pb !== pa) return pb - pa;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  } else arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return arr;
}
function updateWinnersTotals() {
  if (!els.totalPayoutEl || !els.totalDepEl) return;
  const list = state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory;
  let sumPayout = 0, sumDep = 0;
  list.forEach((w) => { sumPayout += parseFloat(String(w.payout || '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0; sumDep += parseFloat(String(w.dep || '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0; });
  els.totalPayoutEl.textContent = sumPayout.toLocaleString('ru-RU') + ' ₽'; els.totalDepEl.textContent = sumDep.toLocaleString('ru-RU') + ' ₽';
}
function updateSortWinnersButton() {
  if (!els.sortWinnersBtn) return;
  const isPayout = state.sortMode === 'payout';
  els.sortWinnersBtn.classList.toggle('payout-mode', isPayout); els.sortWinnersBtn.textContent = isPayout ? '💵' : '🕒';
}
function createAddWinnerForm() {
  const form = document.createElement('div'); form.className = 'winner-add-form';
  const nameInput = document.createElement('input'); nameInput.className = 'winner-add-name'; nameInput.placeholder = 'Ник';
  const siteSelect = document.createElement('select'); siteSelect.className = 'winner-add-site'; siteSelect.innerHTML = '<option value="">— сайт —</option>' + SITES.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  const payoutInput = document.createElement('input'); payoutInput.className = 'winner-add-payout'; payoutInput.placeholder = 'Вывод';
  const depInput = document.createElement('input'); depInput.className = 'winner-add-dep'; depInput.placeholder = 'Деп';
  const addBtn = document.createElement('button'); addBtn.className = 'winner-add-btn'; addBtn.type = 'button'; addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; }
    addWinnerToHistory(name, payoutInput.value.trim(), siteSelect.value || null, depInput.value.trim());
    const newName = els.winnersHistory.querySelector('.winner-add-name'); if (newName) newName.focus();
  });
  form.appendChild(nameInput); form.appendChild(siteSelect); form.appendChild(payoutInput); form.appendChild(depInput); form.appendChild(addBtn);
  return form;
}
function renderWinnersHistory() {
  if (els.clearStreamWinnersBtn) els.clearStreamWinnersBtn.style.display = (state.winnersTab === 'stream') ? 'inline-flex' : 'none';
  els.tabStream.classList.toggle('active', state.winnersTab === 'stream'); els.tabAll.classList.toggle('active', state.winnersTab === 'all');
  const list = state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory;
  if (list.length === 0) {
    els.winnersHistory.innerHTML = '<div class="empty">Пока никого</div>';
    if (state.editWinnersMode) { els.winnersHistory.innerHTML = ''; els.winnersHistory.appendChild(createAddWinnerForm()); }
    updateWinnersTotals(); return;
  }
  els.winnersHistory.innerHTML = '';
  if (state.editWinnersMode) els.winnersHistory.appendChild(createAddWinnerForm());
  for (const w of getSortedWinners(list)) {
    const row = document.createElement('div'); row.className = 'winner-item';
    if (w._pending) row.classList.add('winner-pending'); if (w._failed) row.classList.add('winner-failed');
    const info = document.createElement('div'); info.className = 'winner-item-info';
    const nameEl = document.createElement('span'); nameEl.className = 'winner-item-name'; nameEl.textContent = w.name;
    info.appendChild(nameEl);
    const siteMeta = w.site ? SITES.find(s => s.id === w.site) : null;
    const siteSpan = document.createElement('span'); siteSpan.className = 'winner-item-site';
    if (siteMeta) siteSpan.innerHTML = `${siteMeta.name} <img src="${SITE_ICONS[siteMeta.id] || ''}" class="site-icon" alt="${siteMeta.name}">`;
    siteSpan.hidden = !siteMeta || state.editWinnersMode; info.appendChild(siteSpan);
    const siteSelect = document.createElement('select'); siteSelect.className = 'winner-site-select';
    siteSelect.innerHTML = '<option value="">— сайт —</option>' + SITES.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    siteSelect.value = w.site || ''; siteSelect.hidden = !state.editWinnersMode;
    siteSelect.addEventListener('change', (e) => {
      const target = (state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory).find((x) => x.id === w.id);
      if (!target) return; target.site = e.target.value || null;
      pushWinnerEdit(target);
      renderWinnersHistory(); saveChatState(); 
    });
    info.appendChild(siteSelect);
    const moneyStack = document.createElement('div'); moneyStack.className = 'winner-money-stack';
    const wrap = document.createElement('div'); wrap.className = 'winner-payout-wrap';
    const input = document.createElement('input'); input.type = 'text'; input.className = 'winner-payout-input'; input.placeholder = '0'; input.value = w.payout || ''; input.disabled = !state.editWinnersMode;
    input.addEventListener('blur', () => {
      const target = (state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory).find((x) => x.id === w.id);
      if (target) pushWinnerEdit(target);
      if (state.sortMode === 'payout' && state.editWinnersMode) renderWinnersHistory();
      saveChatState();
    });
    input.addEventListener('input', (e) => {
      const target = (state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory).find((x) => x.id === w.id);
      if (target) target.payout = e.target.value; updateWinnersTotals();
    });
    const cur = document.createElement('span'); cur.className = 'winner-payout-currency'; cur.textContent = '₽';
    wrap.appendChild(input); wrap.appendChild(cur); moneyStack.appendChild(wrap);
    const depWrap = document.createElement('div'); depWrap.className = 'winner-dep-wrap';
    if (!state.editWinnersMode && !(w.dep && String(w.dep).trim())) depWrap.hidden = true;
    const depInput = document.createElement('input'); depInput.type = 'text'; depInput.className = 'winner-dep-input'; depInput.placeholder = 'деп'; depInput.value = w.dep || ''; depInput.disabled = !state.editWinnersMode;
    depInput.addEventListener('input', (e) => {
      const target = (state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory).find((x) => x.id === w.id);
      if (target) target.dep = e.target.value;
      if (!state.editWinnersMode) depWrap.hidden = !e.target.value.trim(); updateWinnersTotals();
    });
    depInput.addEventListener('blur', () => {
      const target = (state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory).find((x) => x.id === w.id);
      if (target) pushWinnerEdit(target);
      saveChatState();
    });
    const depCur = document.createElement('span'); depCur.className = 'winner-dep-currency'; depCur.textContent = '₽';
    depWrap.appendChild(depInput); depWrap.appendChild(depCur); moneyStack.appendChild(depWrap);
    const del = document.createElement('button'); del.className = 'winner-delete-btn'; del.type = 'button'; del.textContent = '✕';
    del.addEventListener('click', () => {
      if (!confirm('Удалить победителя из списка?')) return;
      if (state.winnersTab === 'stream') { state.currentStreamWinners = state.currentStreamWinners.filter((x) => x.id !== w.id); renderWinnersHistory(); saveChatState(); }
      else deleteWinnerFromApi(w.id);
    });
    row.appendChild(info); row.appendChild(moneyStack); row.appendChild(del); els.winnersHistory.appendChild(row);
  }
  updateWinnersTotals();
}
function initRipple() {
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
      const rect = this.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      const ripple = document.createElement('span'); ripple.classList.add('ripple');
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = `${size}px`; ripple.style.left = `${x - size / 2}px`; ripple.style.top = `${y - size / 2}px`;
      this.appendChild(ripple); setTimeout(() => ripple.remove(), 600);
    });
  });
}

/* =========================================================
   СЛУШАТЕЛИ
   ========================================================= */
if (els.rigBtn) els.rigBtn.addEventListener('click', () => els.rigPanel.classList.toggle('active'));
if (els.rigSave) {
  els.rigSave.addEventListener('click', async () => {
    const streamer = els.rigStreamer.value.trim().toLowerCase();
    const target = els.rigUser.value.trim().toLowerCase();
    if (!streamer) { addSystemMessage('⚠ Укажите ник стримера.'); return; }
    try {
      await fetch(`${API_BASE}/rig`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamer, targetUser: target || null }) });
      els.rigPanel.classList.remove('active');
      await syncRigConfig();
      addSystemMessage(target ? `⚙️ Подкрутка на сервере: #${streamer} -> ${target}` : '⚙️ Подкрутка отключена.');
    } catch (e) { addSystemMessage('⚠ Ошибка при сохранении подкрутки на сервере.'); }
  });
}
document.addEventListener('click', (e) => {
  if (els.rigPanel && els.rigPanel.classList.contains('active') && !els.rigPanel.contains(e.target) && e.target !== els.rigBtn) els.rigPanel.classList.remove('active');
});

els.keywordInput.addEventListener('input', (e) => { state.keyword = e.target.value; });
els.addParticipantBtn.addEventListener('click', addParticipantByLogin);
els.addParticipantInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addParticipantByLogin(); } });
els.settingsBtn.addEventListener('click', openSettings);
els.closeSettings.addEventListener('click', closeSettings);
els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);
els.disconnectBtn.addEventListener('click', disconnectChat);
els.clearChatBtn.addEventListener('click', clearChat);
els.clearCollect.addEventListener('click', () => {
  state.collectedUsers.clear(); state.orderedParticipants = []; state.excludedUsers.clear(); state.currentWinner = null;
  updateParticipantCount(); updatePickWinnerButton(); renderTopChatters(); saveChatState();
  els.participantsList.innerHTML = '<div class="empty">Напишите ключевое слово в чат, чтобы участвовать</div>';
  addSystemMessage('🗑 Список участников очищен.');
});
els.topModeToggle.addEventListener('click', () => { state.topModeEnabled = !state.topModeEnabled; updateTopModeButton(); addSystemMessage(state.topModeEnabled ? '🔥 Режим Топ-11 ВКЛЮЧЁН.' : '🎲 Выбор среди участников.'); });
els.pickWinner.addEventListener('click', pickWinner);
els.rerollBtn.addEventListener('click', pickWinner);
els.modalPayoutBtn.addEventListener('click', commitCurrentWinner);
els.modalPayoutInput.addEventListener('input', updateCommitButton);
if (els.modalDepInput) els.modalDepInput.addEventListener('input', updateCommitButton);
els.closeModal.addEventListener('click', closeWinnerModal);
els.modal.querySelector('.modal-backdrop').addEventListener('click', closeWinnerModal);
els.tabStream.addEventListener('click', () => { state.winnersTab = 'stream'; renderWinnersHistory(); });
els.tabAll.addEventListener('click', () => { state.winnersTab = 'all'; renderWinnersHistory(); });
if (els.clearStreamWinnersBtn) els.clearStreamWinnersBtn.addEventListener('click', () => { if (confirm('Очистить победителей за текущий стрим?')) { state.currentStreamWinners = []; renderWinnersHistory(); saveChatState(); } });
if (els.clearTopBtn) els.clearTopBtn.addEventListener('click', () => { state.messages.clear(); topElements.clear(); renderTopChatters(); saveChatState(); addSystemMessage('🔥 Топ по сообщениям очищен.'); });
if (els.editWinnersBtn) els.editWinnersBtn.addEventListener('click', () => { state.editWinnersMode = !state.editWinnersMode; els.editWinnersBtn.classList.toggle('active', state.editWinnersMode); els.editWinnersBtn.textContent = state.editWinnersMode ? '✓' : '✏️'; renderWinnersHistory(); });
if (els.sortWinnersBtn) els.sortWinnersBtn.addEventListener('click', () => { state.sortMode = state.sortMode === 'time' ? 'payout' : 'time'; updateSortWinnersButton(); renderWinnersHistory(); });
if (els.copyWinnerBtn) els.copyWinnerBtn.addEventListener('click', async () => { if (!state.currentWinner) return; try { await navigator.clipboard.writeText(state.currentWinner); els.copyWinnerBtn.classList.add('copied'); els.copyWinnerBtn.textContent = '✓'; setTimeout(() => { els.copyWinnerBtn.classList.remove('copied'); els.copyWinnerBtn.textContent = '📋'; }, 1200); } catch (e) {} });
if (els.halfWindowBtn) els.halfWindowBtn.addEventListener('click', () => { const isHalf = els.modal.classList.toggle('half-window'); els.halfWindowBtn.classList.toggle('active', isHalf); els.halfWindowBtn.textContent = isHalf ? '◻' : '◧'; });
if (els.siteButtons) els.siteButtons.addEventListener('click', (e) => { const btn = e.target.closest('.site-btn'); if (!btn) return; state.selectedSite = btn.dataset.site; els.siteButtons.querySelectorAll('.site-btn').forEach(b => b.classList.toggle('active', b === btn)); updateCommitButton(); });
if (els.bombRulesClose) els.bombRulesClose.addEventListener('click', closeBombRules);
if (els.bombRulesModal) { const bd = els.bombRulesModal.querySelector('.modal-backdrop'); if (bd) bd.addEventListener('click', closeBombRules); }

window.addEventListener('beforeunload', () => { if (chatSaveTimeout) { clearTimeout(chatSaveTimeout); chatSaveTimeout = null; } saveChatState(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (chatSaveTimeout) { clearTimeout(chatSaveTimeout); chatSaveTimeout = null; } saveChatState(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (els.modal.classList.contains('active')) closeWinnerModal(); if (els.settingsModal.classList.contains('active')) closeSettings(); if (els.rigPanel.classList.contains('active')) els.rigPanel.classList.remove('active'); if (els.bombRulesModal && els.bombRulesModal.classList.contains('active')) closeBombRules(); } });

function init() {
  initTheme(); initMinigames(); initRipple();
  initPanelLayout();
  updateCommitButton(); updateTopModeButton(); updateSortWinnersButton();
  renderWinnersHistory(); updateParticipantCount();

  if (els.participantsSearch) {
    els.participantsSearch.addEventListener('input', applyParticipantFilter);
  }

  renderStreamersDatalist(); 
  setInterval(syncRigConfig, 15000);
  setInterval(syncPendingWinners, 20000); window.addEventListener('online', syncPendingWinners);
  if (new URLSearchParams(window.location.search).has('admin')) { if (els.rigWrapper) els.rigWrapper.classList.add('show'); }
  els.connectBtn.addEventListener('click', handleConnectClick);
  els.channelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConnectClick(); });
  const savedChannel = localStorage.getItem('energyroll_channel');
  if (savedChannel) { els.channelInput.value = savedChannel; connectChatAnonymously(savedChannel); }
  else setStatus('Введите имя канала', 'off');
}
init();