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
  rigTarget: null // Сюда сохраняется ник для подкрутки
};

const SITES = [
  { id: 'magicdrop', name: 'Magic Drop' }, { id: 'ninjacase', name: 'NinjaCase' },
  { id: 'zavod', name: 'Zavod' }, { id: 'downgrader', name: 'Downgrader' }, { id: 'cshappy', name: 'CShappy' }
];

const SITE_ICONS = {
  magicdrop: 'magic.jpg', ninjacase: 'ninja.jpg', zavod: 'zavod.jpg',
  downgrader: 'downgrader.jpg', cshappy: 'cshappy.jpg'
};

let spinCancel = false, cardsCancelFn = null, topChattersScheduled = false;
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
  caseContainer: document.getElementById('case-container'), caseStrip: document.getElementById('case-strip'),
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
  spinElevator: document.getElementById('spin-elevator')
};

/* =========================================================
   ПОДСКАЗКИ СТРИМЕРОВ (Datalist)
   ========================================================= */
const STREAMERS_KEY = 'energyroll_saved_streamers';

function loadSavedStreamers() {
  try {
    const raw = localStorage.getItem(STREAMERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
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
   ПОДКРУТКА (Синхронизация с сервером)
   ========================================================= */
async function syncRigConfig() {
  if (!state.userLogin) return;
  try {
    const res = await fetch(`${API_BASE}/rig/${state.userLogin}`);
    if (res.ok) {
      const rig = await res.json();
      if (rig.targetUser && !rig.isUsed) {
        state.rigTarget = rig.targetUser.toLowerCase();
      } else {
        state.rigTarget = null;
      }
    }
  } catch (e) {}
}

/* =========================================================
   СОХРАНЕНИЕ ЧАТА
   ========================================================= */
function getChatStateKey() { return `energyroll_chat_state_${state.userLogin || 'offline'}`; }
function saveChatState() {
  try {
    const usersArr = Array.from(state.users.entries()), msgsArr = [];
    for (const [login, msgs] of state.messages.entries()) {
      msgsArr.push([login, msgs.slice(-100).map(m => ({ text: m.text, time: m.time.getTime() }))]);
    }
    const data = { 
      users: usersArr, messages: msgsArr, currentStreamWinners: state.currentStreamWinners,
      excludedUsers: Array.from(state.excludedUsers)
    };
    localStorage.setItem(getChatStateKey(), JSON.stringify(data));
  } catch (e) {}
}
function scheduleChatSave() { if (chatSaveTimeout) return; chatSaveTimeout = setTimeout(() => { chatSaveTimeout = null; saveChatState(); }, 1000); }
function loadChatState() {
  try {
    const raw = localStorage.getItem(getChatStateKey()); if (!raw) return;
    const data = JSON.parse(raw);
    if (data.users) for (const [login, name] of data.users) state.users.set(login, name);
    if (data.messages) for (const [login, msgs] of data.messages) state.messages.set(login, msgs.map(m => ({ text: m.text, time: new Date(m.time) })));
    if (data.currentStreamWinners) state.currentStreamWinners = data.currentStreamWinners;
    if (data.excludedUsers) state.excludedUsers = new Set(data.excludedUsers);
  } catch (e) {}
}

/* =========================================================
   API ЗАПРОСЫ
   ========================================================= */
async function loadWinnersFromApi() {
  if (!state.userLogin) return;
  try {
    const res = await fetch(`${API_BASE}/winners?streamer=${state.userLogin}`);
    if (!res.ok) throw new Error(res.status);
    const list = await res.json();
    if (list.length === 0 && state.winnersHistory.length > 0) return; 
    state.winnersHistory = list.map((w) => ({ id: w.id, name: w.name, payout: w.payout || '', site: w.site || null, dep: w.dep || '', createdAt: w.createdAt }));
    renderWinnersHistory();
  } catch (e) { addSystemMessage('⚠ Не удалось загрузить победителей.'); }
}

async function addWinnerToHistory(displayName, payout = '', site = null, dep = '') {
  const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const newWinner = { id: tempId, name: displayName, payout, site, dep, createdAt: new Date().toISOString(), _pending: !!state.userLogin };
  state.currentStreamWinners.unshift(newWinner);
  state.winnersHistory.unshift(newWinner);
  if (state.winnersHistory.length > 100) state.winnersHistory.length = 100;
  renderWinnersHistory();
  saveChatState();
  if (!state.userLogin) return;
  try {
    const res = await fetch(`${API_BASE}/winners`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: displayName, payout, dep, site, streamer: state.userLogin })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const saved = await res.json();
    const s = state.currentStreamWinners.find(x => x.id === tempId);
    if (s) { s.id = saved.id; s._pending = false; }
    const h = state.winnersHistory.find(x => x.id === tempId);
    if (h) { h.id = saved.id; h._pending = false; }
  } catch (e) {
    const s = state.currentStreamWinners.find(x => x.id === tempId);
    if (s) { s._failed = true; s._pending = false; }
    const h = state.winnersHistory.find(x => x.id === tempId);
    if (h) { h._failed = true; h._pending = false; }
    addSystemMessage('⚠ Не удалось сохранить в базу. Запись сохранена локально.');
    renderWinnersHistory();
  }
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
   УТИЛИТЫ И ТЕМЫ
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
    if (!el) { 
      el = createTopItemEl(); topElements.set(item.login, el); 
      const btn = el.querySelector('.top-exclude-btn');
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleExcludeParticipant(item.login); });
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
   ДОБАВЛЕНИЕ И ЧАТ
   ========================================================= */
function addParticipantByLogin() {
  const raw = els.addParticipantInput.value.trim(); if (!raw) return;
  const displayName = raw.replace(/^@/, '').trim(); if (!displayName) return;
  const login = displayName.toLowerCase().replace(/\s+/g, '');
  if (state.collectedUsers.has(login)) { addSystemMessage('⚠ ' + displayName + ' уже в списке.'); els.addParticipantInput.value = ''; return; }
  state.collectedUsers.add(login); state.orderedParticipants.push(login);
  if (!state.users.has(login)) state.users.set(login, displayName);
  if (!state.messages.has(login)) state.messages.set(login, []);
  renderParticipant(login, state.users.get(login), true);
  updateParticipantCount(); updatePickWinnerButton();
  addSystemMessage('➕ Добавлен: ' + displayName);
  els.addParticipantInput.value = ''; els.addParticipantInput.focus();
}

function connectChatAnonymously(channelName) {
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  const channel = channelName.toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  if (!channel) { addSystemMessage('⚠ Введите корректное имя канала.'); setStatus('Введите имя канала', 'off'); return; }
  if (state.userLogin !== channel) {
    state.users.clear(); state.messages.clear(); topElements.clear();
    state.currentStreamWinners = []; state.winnersHistory = []; state.userLogin = channel;
    state.excludedUsers.clear();
    loadChatState(); renderTopChatters(); renderWinnersHistory(); loadWinnersFromApi();
    syncRigConfig(); // Сразу проверяем подкрутку
  }
  localStorage.setItem('energyroll_channel', channel);
  saveStreamerToList(channel); 
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
  const keyword = state.keyword.trim().toLowerCase();
  if (keyword && text.trim().toLowerCase() === keyword && !state.collectedUsers.has(login)) {
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
   ТАЙМЕР И МОДАЛКА
   ========================================================= */
function startWinnerTimer() { els.winnerTimer.classList.remove('timer-done'); els.winnerTimer.textContent = '0:00'; const start = state.winnerSelectedAt; state.timerInterval = setInterval(() => { els.winnerTimer.textContent = formatDuration(Date.now() - start); }, 250); }
function stopWinnerTimer() { if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; } els.winnerTimer.textContent = formatDuration(Date.now() - state.winnerSelectedAt); els.winnerTimer.classList.add('timer-done'); }
function clearWinnerTimer() { if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; } }
function appendWinnerMessage(msg, isNew) {
  const empty = els.winnerMessages.querySelector('.empty'); if (empty) empty.remove();
  const el = document.createElement('div'); el.className = 'winner-msg' + (isNew ? ' winner-msg-new' : ' winner-msg-dim');
  el.innerHTML = '<span class="winner-msg-time">' + formatTime(msg.time) + '</span>' + escapeHtml(msg.text);
  if (isNew) { els.winnerMessages.prepend(el); els.winnerMessages.scrollTop = 0; } else els.winnerMessages.appendChild(el);
}
function fillWinnerInfo(login) {
  const recent = (state.messages.get(login) || []).slice(-100);
  if (recent.length === 0) els.winnerMessages.innerHTML = '<div class="empty">У победителя пока нет сообщений в этой сессии</div>';
  else for (const msg of recent) appendWinnerMessage(msg, false);
  els.winnerMessages.scrollTop = els.winnerMessages.scrollHeight; startWinnerTimer();
}

/* =========================================================
   МИНИ-ИГРЫ
   ========================================================= */
function initMinigames() {
  const known = ['instant', 'roulette', 'drum', 'case', 'cards', 'wheel', 'bingo', 'hotpotato', 'laser', 'zeus', 'elevator'];
  let saved = localStorage.getItem('energyroll_minigame'); if (!known.includes(saved)) saved = 'instant'; state.miniGame = saved;
  const buttons = document.querySelectorAll('.minigame-item');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === saved);
    btn.addEventListener('click', () => { const mode = btn.dataset.mode; state.miniGame = mode; localStorage.setItem('energyroll_minigame', mode); buttons.forEach((b) => b.classList.toggle('active', b === btn)); });
  });
}
function updateRouletteName(name) { els.spinRouletteName.textContent = name; els.spinRouletteName.title = name; const len = name.length; els.spinRouletteName.classList.toggle('spin-name-long', len > 12 && len <= 20); els.spinRouletteName.classList.toggle('spin-name-xlong', len > 20); }
function playRoulette(displayName) { return new Promise((resolve) => { els.spinRoulette.hidden = false; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; els.spinRouletteName.classList.remove('spin-name-final'); const duration = 2500; const start = performance.now(); const tick = () => { if (spinCancel) { resolve(); return; } const elapsed = performance.now() - start; if (elapsed >= duration) { updateRouletteName(displayName); els.spinRouletteName.classList.add('spin-name-final'); setTimeout(() => { els.spinRoulette.hidden = true; els.spinRouletteName.classList.remove('spin-name-final'); resolve(); }, 500); return; } updateRouletteName(randomParticipantName()); const progress = elapsed / duration; const interval = 45 + progress * 160; setTimeout(tick, interval); }; tick(); }); }
const DRUM_ITEM_HEIGHT = 64; const DRUM_VISIBLE_ITEMS = 5; const DRUM_TOTAL_ITEMS = 50; const DRUM_WINNER_INDEX = 22; const DRUM_DURATION = 3800;
function createDrumItem(login, name) { const item = document.createElement('div'); item.className = 'drum-item'; const avatar = document.createElement('div'); avatar.className = 'drum-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (name || '?').charAt(0).toUpperCase(); const nameEl = document.createElement('div'); nameEl.className = 'drum-name'; nameEl.textContent = name; item.appendChild(avatar); item.appendChild(nameEl); return item; }
function playDrum(winnerLogin, winnerName) { return new Promise((resolve) => { els.spinRoulette.hidden = true; els.spinDrum.hidden = false; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; const strip = els.drumStrip; strip.innerHTML = ''; strip.style.transform = 'translateY(0)'; for (let i = 0; i < DRUM_TOTAL_ITEMS; i++) { let login, name; if (i === DRUM_WINNER_INDEX) { login = winnerLogin; name = winnerName; } else { login = randomParticipantLogin(); name = state.users.get(login) || login; } strip.appendChild(createDrumItem(login, name)); } void strip.offsetHeight; const centerIndex = Math.floor(DRUM_VISIBLE_ITEMS / 2); const targetTranslate = -(DRUM_WINNER_INDEX - centerIndex) * DRUM_ITEM_HEIGHT; const start = performance.now(); const tick = (now) => { if (spinCancel) { resolve(); return; } const elapsed = now - start; const t = Math.min(elapsed / DRUM_DURATION, 1); const eased = 1 - Math.pow(1 - t, 3); strip.style.transform = `translateY(${targetTranslate * eased}px)`; if (t < 1) requestAnimationFrame(tick); else { strip.style.transform = `translateY(${targetTranslate}px)`; setTimeout(() => { els.spinDrum.hidden = true; resolve(); }, 700); } }; requestAnimationFrame(tick); }); }
const CASE_ITEM_WIDTH = 120; const CASE_ITEM_GAP = 8; const CASE_TOTAL_ITEMS = 40; const CASE_WINNER_IDX = 25; const CASE_DURATION = 3600;
function playCase(winnerLogin, winnerName) { return new Promise((resolve) => { els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = false; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; const strip = els.caseStrip; strip.innerHTML = ''; strip.style.transform = 'translateX(0)'; const rarities = ['common', 'uncommon', 'rare', 'epic']; for (let i = 0; i < CASE_TOTAL_ITEMS; i++) { let login, name, rarity; if (i === CASE_WINNER_IDX) { login = winnerLogin; name = winnerName; rarity = 'legendary'; } else { login = randomParticipantLogin(); name = state.users.get(login) || login; rarity = rarities[Math.floor(Math.random() * rarities.length)]; } const item = document.createElement('div'); item.className = 'case-item case-rarity-' + rarity; const avatar = document.createElement('div'); avatar.className = 'case-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (name || '?').charAt(0).toUpperCase(); const nameEl = document.createElement('div'); nameEl.className = 'case-name'; nameEl.textContent = name; item.appendChild(avatar); item.appendChild(nameEl); strip.appendChild(item); } void strip.offsetHeight; const containerWidth = els.caseContainer.clientWidth; const targetX = containerWidth / 2 - CASE_ITEM_WIDTH / 2 - (CASE_WINNER_IDX * (CASE_ITEM_WIDTH + CASE_ITEM_GAP)); const start = performance.now(); function tick(now) { if (spinCancel) { resolve(); return; } const elapsed = now - start; const t = Math.min(elapsed / CASE_DURATION, 1); const eased = 1 - Math.pow(1 - t, 4); strip.style.transform = `translateX(${targetX * eased}px)`; if (t < 1) requestAnimationFrame(tick); else { strip.style.transform = `translateX(${targetX}px)`; strip.children[CASE_WINNER_IDX].classList.add('case-item-winner'); setTimeout(() => { els.spinCase.hidden = true; resolve(); }, 900); } } requestAnimationFrame(tick); }); }
async function shuffleCardsWithFlip(grid) { return new Promise((resolve) => { const cards = Array.from(grid.children); const firstRects = new Map(); cards.forEach((c) => firstRects.set(c, c.getBoundingClientRect())); const shuffled = [...cards].sort(() => Math.random() - 0.5); shuffled.forEach((c) => grid.appendChild(c)); shuffled.forEach((c) => { const first = firstRects.get(c); const last = c.getBoundingClientRect(); const dx = first.left - last.left; const dy = first.top - last.top; if (dx || dy) c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }); }); setTimeout(resolve, 360); }); }

function playCards(pool, riggedLogin = null) { 
  return new Promise((resolve) => { 
    els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = false; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; 
    const grid = els.cardsGrid; grid.innerHTML = ''; 
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(10, pool.length)); 
    const cardData = shuffled.map((login) => { 
      const name = state.users.get(login) || login; const card = document.createElement('div'); card.className = 'pick-card'; card.dataset.login = login; 
      const front = document.createElement('div'); front.className = 'pick-card-face pick-card-front'; 
      const back = document.createElement('div'); back.className = 'pick-card-face pick-card-back'; 
      const avatar = document.createElement('div'); avatar.className = 'pick-card-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (name || '?').charAt(0).toUpperCase(); 
      const nameEl = document.createElement('div'); nameEl.className = 'pick-card-name'; nameEl.textContent = name; 
      back.appendChild(avatar); back.appendChild(nameEl); card.appendChild(front); card.appendChild(back); card.classList.add('pick-card-flipped'); grid.appendChild(card); 
      return { card, login }; 
    }); 
    let picked = null; 
    const clickHandler = (e) => { 
      if (picked) return; 
      const card = e.target.closest('.pick-card'); 
      if (!card) return; 
      
      let finalCard = card;
      if (riggedLogin) {
        const riggedCardData = cardData.find(c => c.login === riggedLogin);
        if (riggedCardData) finalCard = riggedCardData.card;
      }
      
      picked = finalCard; 
      cardData.forEach(({ card: c }) => { c.removeEventListener('click', clickHandler); c.dataset.clickable = 'false'; }); 
      picked.classList.add('pick-card-flipped'); picked.classList.add('pick-card-winner'); 
      setTimeout(() => { cardsCancelFn = null; resolve(picked.dataset.login); }, 900); 
    }; 
    cardsCancelFn = () => { cardData.forEach(({ card }) => card.removeEventListener('click', clickHandler)); cardsCancelFn = null; resolve(null); }; 
    (async () => { 
      await sleep(1500); 
      if (spinCancel || picked) return; 
      cardData.forEach(({ card }) => card.classList.remove('pick-card-flipped')); 
      await sleep(450); 
      if (spinCancel) return; 
      for (let i = 0; i < 3; i++) { 
        if (spinCancel) return; 
        await shuffleCardsWithFlip(grid); 
        await sleep(80); 
      } 
      if (spinCancel) return; 
      cardData.forEach(({ card }) => { card.dataset.clickable = 'true'; card.addEventListener('click', clickHandler); }); 
    })(); 
  }); 
}

function playWheel(pool, winnerLogin, winnerName) { return new Promise((resolve) => { els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = false; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; let wheelLogins = pool.length <= 12 ? [...pool] : pool.filter(l => l !== winnerLogin).slice(0, 11).concat([winnerLogin]); for (let i = wheelLogins.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [wheelLogins[i], wheelLogins[j]] = [wheelLogins[j], wheelLogins[i]]; } const N = wheelLogins.length; const segAngle = 360 / N; const winnerIdx = wheelLogins.indexOf(winnerLogin); const svgNS = 'http://www.w3.org/2000/svg'; const g = els.wheelRotating; g.innerHTML = ''; const c1 = getComputedStyle(document.documentElement).getPropertyValue('--bg-tertiary').trim() || '#3c1a1a'; const c2 = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim() || '#4d2222'; const c3 = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#260f0f'; const themeColors = [c1, c2, c3]; for (let i = 0; i < N; i++) { const startAngle = -90 + i * segAngle; const endAngle = -90 + (i + 1) * segAngle; const midAngle = (startAngle + endAngle) / 2; const startRad = startAngle * Math.PI / 180; const endRad = endAngle * Math.PI / 180; const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', `M 0 0 L ${Math.cos(startRad) * 140} ${Math.sin(startRad) * 140} A 140 140 0 ${segAngle > 180 ? 1 : 0} 1 ${Math.cos(endRad) * 140} ${Math.sin(endRad) * 140} Z`); path.setAttribute('fill', themeColors[i % themeColors.length]); path.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#5c2828'); path.setAttribute('stroke-width', '1.5'); g.appendChild(path); const midRad = midAngle * Math.PI / 180; const name = state.users.get(wheelLogins[i]) || wheelLogins[i]; const display = name.length > 11 ? name.slice(0, 10) + '…' : name; const text = document.createElementNS(svgNS, 'text'); text.setAttribute('text-anchor', 'start'); text.setAttribute('dominant-baseline', 'middle'); text.setAttribute('fill', '#f2e6e6'); text.setAttribute('font-size', display.length > 9 ? '9' : (display.length > 7 ? '10' : '11')); text.setAttribute('font-weight', '700'); text.setAttribute('transform', `translate(${Math.cos(midRad) * 40} ${Math.sin(midRad) * 40}) rotate(${midAngle})`); text.textContent = display; g.appendChild(text); } const targetRotation = 360 * 5 - (winnerIdx + 0.5) * segAngle; g.style.transition = 'none'; g.style.transform = 'rotate(0deg)'; void g.getBoundingClientRect(); const duration = 4200; const start = performance.now(); function tick(now) { if (spinCancel) { resolve(); return; } const elapsed = now - start; const t = Math.min(elapsed / duration, 1); const eased = 1 - Math.pow(1 - t, 4); g.style.transform = `rotate(${targetRotation * eased}deg)`; if (t < 1) requestAnimationFrame(tick); else { g.style.transform = `rotate(${targetRotation}deg)`; setTimeout(() => { els.spinWheel.hidden = true; resolve(); }, 900); } } requestAnimationFrame(tick); }); }
function playBingo(pool, winnerLogin, winnerName) { return new Promise((resolve) => { els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = false; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; const grid = els.bingoGrid; grid.innerHTML = ''; let bingoLogins = [...pool]; if (bingoLogins.length > 25) { bingoLogins = bingoLogins.slice(0, 25); if (!bingoLogins.includes(winnerLogin)) bingoLogins[24] = winnerLogin; } else if (bingoLogins.length < 25) { while (bingoLogins.length < 25) bingoLogins.push(bingoLogins[Math.floor(Math.random() * bingoLogins.length)] || winnerLogin); } for (let i = bingoLogins.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [bingoLogins[i], bingoLogins[j]] = [bingoLogins[j], bingoLogins[i]]; } const cells = []; bingoLogins.forEach((login) => { const name = state.users.get(login) || login; const cell = document.createElement('div'); cell.className = 'bingo-cell'; const avatar = document.createElement('div'); avatar.className = 'bingo-avatar'; avatar.style.background = avatarGradient(login); avatar.textContent = (name || '?').charAt(0).toUpperCase(); const nameEl = document.createElement('div'); nameEl.className = 'bingo-name'; nameEl.textContent = name; cell.appendChild(avatar); cell.appendChild(nameEl); grid.appendChild(cell); cells.push({ el: cell, login }); }); const toCross = cells.filter(c => c.login !== winnerLogin); for (let i = toCross.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [toCross[i], toCross[j]] = [toCross[j], toCross[i]]; } let index = 0; const interval = 400; function crossNext() { if (spinCancel) { resolve(); return; } if (index < toCross.length) { toCross[index].el.classList.add('crossed'); index++; setTimeout(crossNext, interval); } else { const winnerCell = cells.find(c => c.login === winnerLogin); if (winnerCell) winnerCell.el.classList.add('winner'); setTimeout(() => { els.spinBingo.hidden = true; resolve(); }, 1500); } } setTimeout(crossNext, 500); }); }
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
  return new Promise((resolve) => {
    const container = document.getElementById('laser-container'); const crosshair = document.getElementById('laser-crosshair');
    container.querySelectorAll('.laser-participant, .laser-beam, svg').forEach(el => el.remove());
    let lPool = [...pool]; if (lPool.length > 12) { lPool = lPool.sort(() => Math.random() - 0.5).slice(0, 12); if (!lPool.includes(winnerLogin)) lPool[11] = winnerLogin; } lPool = lPool.sort(() => Math.random() - 0.5);
    const rect = container.getBoundingClientRect(); const W = rect.width || 700; const H = rect.height || 500;
    const positions = getGridPositions(lPool.length, W, H, 60, 60); const nodes = [];
    lPool.forEach((login, i) => { const { x, y } = positions[i]; const node = document.createElement('div'); node.className = 'laser-participant'; node.style.left = `${x}px`; node.style.top = `${y}px`; const fullName = state.users.get(login) || login; node.textContent = fullName; node.title = fullName; container.appendChild(node); nodes.push({ el: node, login, x, y }); });
    const duration = 4000; const start = performance.now(); let fired = false; const winnerNode = nodes.find(n => n.login === winnerLogin);
    let cx = W / 2, cy = H / 2; let angle = Math.random() * Math.PI * 2; const speed = 700; let lastTime = performance.now(); const margin = 40;
    function animate(now) {
      if (spinCancel) { resolve(); return; }
      const elapsed = now - start; const t = Math.min(elapsed / duration, 1);
      if (t < 0.85) {
        const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
        angle += 0.35 * dt; cx += Math.cos(angle) * speed * dt; cy += Math.sin(angle) * speed * dt;
        if (cx < margin) { cx = margin; angle = Math.PI - angle; } else if (cx > W - margin) { cx = W - margin; angle = Math.PI - angle; }
        if (cy < margin) { cy = margin; angle = -angle; } else if (cy > H - margin) { cy = H - margin; angle = -angle; }
        crosshair.style.left = `${cx}px`; crosshair.style.top = `${cy}px`; requestAnimationFrame(animate);
      } else if (!fired) {
        fired = true; crosshair.style.transition = 'all 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)'; crosshair.style.left = `${winnerNode.x}px`; crosshair.style.top = `${winnerNode.y}px`;
        setTimeout(() => {
          const beam = document.createElement('div'); beam.className = 'laser-beam';
          const sx = crosshair.offsetLeft, sy = crosshair.offsetTop; beam.style.left = `${sx}px`; beam.style.top = `${sy}px`;
          const dx = winnerNode.x - sx, dy = winnerNode.y - sy; beam.style.width = `${Math.sqrt(dx * dx + dy * dy)}px`; beam.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
          container.appendChild(beam); beam.animate([{ opacity: 1 }, { opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
          setTimeout(() => { winnerNode.el.classList.add('hit'); setTimeout(() => { els.spinLaser.hidden = true; resolve(); }, 1200); }, 100);
        }, 600);
      }
    }
    requestAnimationFrame(animate);
  });
}
async function playZeusLightning(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true;
  els.spinZeus.hidden = false; await sleep(50);
  return new Promise((resolve) => {
    const container = document.getElementById('zeus-container'); const flash = document.getElementById('zeus-flash');
    container.querySelectorAll('.zeus-participant, svg').forEach(el => el.remove());
    let zPool = [...pool]; if (zPool.length > 12) { zPool = zPool.sort(() => Math.random() - 0.5).slice(0, 12); if (!zPool.includes(winnerLogin)) zPool[11] = winnerLogin; } zPool = zPool.sort(() => Math.random() - 0.5);
    const rect = container.getBoundingClientRect(); const W = rect.width || 700; const H = rect.height || 500;
    const positions = getGridPositions(zPool.length, W, H, 60, 120); const nodes = [];
    zPool.forEach((login, i) => { const { x, y } = positions[i]; const node = document.createElement('div'); node.className = 'zeus-participant'; node.style.left = `${x}px`; node.style.top = `${y}px`; const fullName = state.users.get(login) || login; node.textContent = fullName; node.title = fullName; container.appendChild(node); nodes.push({ el: node, login, x, y }); });
    const victims = nodes.filter(n => n.login !== winnerLogin); victims.sort(() => Math.random() - 0.5);
    const duration = 4000; const interval = duration / (victims.length + 1); const start = performance.now(); let victimIndex = 0, nextStrikeTime = start + interval;
    const winnerNode = nodes.find(n => n.login === winnerLogin);
    function createBolt(x1, y1, x2, y2) {
      const svgNS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;');
      const poly = document.createElementNS(svgNS, 'polyline'); let points = `${x1},${y1} `, cx = x1, cy = y1;
      for (let i = 1; i <= 5; i++) { const tx = x1 + (x2 - x1) * (i / 5), ty = y1 + (y2 - y1) * (i / 5); if (i !== 5) { cx = tx + (Math.random() - 0.5) * 40; cy = ty; } else { cx = tx; cy = ty; } points += `${cx},${cy} `; }
      poly.setAttribute('points', points); poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#fff'); poly.setAttribute('stroke-width', '4'); poly.setAttribute('style', 'filter: drop-shadow(0 0 8px #60a5fa);');
      svg.appendChild(poly); container.appendChild(svg); svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }); setTimeout(() => svg.remove(), 300);
    }
    function animate(now) {
      if (spinCancel) { resolve(); return; }
      if (now >= nextStrikeTime && victimIndex < victims.length) {
        const victim = victims[victimIndex];
        if (victim.el.parentNode) {
          flash.style.animation = 'none'; void flash.offsetWidth; flash.style.animation = 'flashAnim 0.3s ease-out';
          createBolt(victim.x + (Math.random() - 0.5) * 20, 0, victim.x, victim.y);
          setTimeout(() => { victim.el.classList.add('struck'); setTimeout(() => { victim.el.style.opacity = '0'; victim.el.style.transform = 'translate(-50%, -50%) scale(0)'; victim.el.remove(); }, 200); }, 100);
        }
        victimIndex++; nextStrikeTime = now + interval;
      }
      if (victimIndex < victims.length) { requestAnimationFrame(animate); }
      else {
        flash.style.animation = 'none'; void flash.offsetWidth; flash.style.animation = 'flashAnim 0.4s ease-out';
        createBolt(winnerNode.x, 0, winnerNode.x, winnerNode.y); winnerNode.el.classList.add('winner');
        setTimeout(() => { els.spinZeus.hidden = true; resolve(); }, 1500);
      }
    }
    requestAnimationFrame(animate);
  });
}

/* =========================================================
   ЛИФТЫ
   ========================================================= */
async function playElevator(pool, winnerLogin, winnerName) {
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true;
  els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true;
  els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true;
  els.spinElevator.hidden = false;
  await sleep(50);

  return new Promise((resolve) => {
    const shaftsEl = document.getElementById('elevator-shafts');
    if (!shaftsEl) { els.spinElevator.hidden = true; resolve(); return; }
    shaftsEl.innerHTML = '';

    const FLOOR_COUNT = 14;
    const CABIN_H = 34;
    const shaftH = shaftsEl.clientHeight || 460;
    const usableH = shaftH - CABIN_H - 4;
    const FLOOR_H = Math.max(20, usableH / (FLOOR_COUNT - 1));

    // Пул: победитель + до 5 других
    let elevPool = [...new Set(pool)];
    if (!elevPool.includes(winnerLogin)) elevPool.push(winnerLogin);
    if (elevPool.length > 6) {
      const others = elevPool.filter(l => l !== winnerLogin);
      for (let i = others.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [others[i], others[j]] = [others[j], others[i]]; }
      elevPool = [winnerLogin, ...others.slice(0, 5)];
    }
    for (let i = elevPool.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [elevPool[i], elevPool[j]] = [elevPool[j], elevPool[i]]; }

    // Этажи для не-победителей (6..11)
    const availableFloors = [];
    for (let f = 6; f <= FLOOR_COUNT - 3; f++) availableFloors.push(f);
    for (let i = availableFloors.length - 1; i > 0; i--) { const j = secureRandomInt(i + 1); [availableFloors[i], availableFloors[j]] = [availableFloors[j], availableFloors[i]]; }

    const elevators = [];
    elevPool.forEach((login, idx) => {
      const name = state.users.get(login) || login;
      const isWinner = login === winnerLogin;
      const finalFloor = isWinner ? FLOOR_COUNT : (availableFloors[idx] || 6);

      const shaft = document.createElement('div');
      shaft.className = 'elevator-shaft';

      for (let f = 1; f < FLOOR_COUNT; f++) {
        const line = document.createElement('div');
        line.className = 'elevator-floor-line';
        line.style.bottom = (f * FLOOR_H) + 'px';
        shaft.appendChild(line);
      }

      const cabin = document.createElement('div');
      cabin.className = 'elevator-cabin';

      const floorNum = document.createElement('div');
      floorNum.className = 'elevator-floor-num';
      floorNum.textContent = '1';

      const nameEl = document.createElement('div');
      nameEl.className = 'elevator-name';
      nameEl.textContent = name;
      nameEl.title = name;

      const crown = document.createElement('div');
      crown.className = 'elevator-crown';
      crown.textContent = '👑';

      cabin.appendChild(floorNum);
      cabin.appendChild(nameEl);
      cabin.appendChild(crown);
      shaft.appendChild(cabin);
      shaftsEl.appendChild(shaft);

      elevators.push({
        el: cabin, floorNum,
        login, name, isWinner, finalFloor,
        targetY: -(finalFloor - 1) * FLOOR_H
      });
    });

    function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
    function computeProgress(e, t) {
      if (e.isWinner) return easeOutCubic(Math.min(t / 0.72, 1));
      let p = t;
      const pauseStart = 0.35, pauseEnd = 0.47;
      if (p > pauseStart && p < pauseEnd) p = pauseStart;
      else if (p >= pauseEnd) p -= (pauseEnd - pauseStart);
      return easeOutCubic(Math.min(p / 0.88, 1));
    }

    const DURATION = 4800;
    const startTime = performance.now();
    let lastFloorUpdate = 0;

    function tick(now) {
      if (spinCancel) { resolve(); return; }
      const t = Math.min((now - startTime) / DURATION, 1);

      elevators.forEach(e => {
        const p = computeProgress(e, t);
        e.el.style.transform = `translateY(${p * e.targetY}px)`;
      });

      if (now - lastFloorUpdate > 80) {
        lastFloorUpdate = now;
        elevators.forEach(e => {
          const p = computeProgress(e, t);
          const floor = Math.round(-(p * e.targetY) / FLOOR_H) + 1;
          e.floorNum.textContent = Math.min(floor, e.finalFloor);
        });
      }

      if (t < 1) requestAnimationFrame(tick);
      else {
        elevators.forEach(e => {
          e.el.style.transform = `translateY(${e.targetY}px)`;
          e.floorNum.textContent = e.finalFloor;
          if (e.isWinner) e.el.classList.add('winner');
        });
        setTimeout(() => { els.spinElevator.hidden = true; resolve(); }, 1800);
      }
    }
    requestAnimationFrame(tick);
  });
}

/* =========================================================
   ВЫБОР ПОБЕДИТЕЛЯ И СТАРТ
   ========================================================= */
async function pickWinner() {
  if (state.isSpinning) return;
  
  // Подкрутка берется из памяти (синхронизируется в фоне)
  let riggedLogin = state.rigTarget;
  
  if (riggedLogin) {
    state.rigTarget = null; 
    // Отправляем сигнал на сервер, что подкрутка использована
    fetch(`${API_BASE}/rig/use`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamer: state.userLogin })
    }).catch(()=>{});
  }
  
  const basePool = getActiveWinnerPool();
  if (basePool.length === 0 && !riggedLogin) { addSystemMessage(state.topModeEnabled ? '⚠ Нет активных в чате.' : '⚠ Нет участников.'); return; }
  
  let pool = basePool.filter((login) => login !== state.currentWinner);
  if (pool.length === 0 && !riggedLogin) { addSystemMessage('⚠ Нет других участников для рерола.'); return; }
  
  let winnerLogin = null;

  if (riggedLogin) {
    winnerLogin = riggedLogin;
    // Если подкрученного нет в списке участников, добавляем принудительно
    if (!state.users.has(winnerLogin)) state.users.set(winnerLogin, winnerLogin);
    if (!state.collectedUsers.has(winnerLogin)) {
      state.collectedUsers.add(winnerLogin);
      state.orderedParticipants.push(winnerLogin);
      renderParticipant(winnerLogin, state.users.get(winnerLogin), true);
      updateParticipantCount();
    }
    if (!pool.includes(winnerLogin)) pool.push(winnerLogin);
  } else {
    winnerLogin = pool[secureRandomInt(pool.length)];
  }
  
  if (state.miniGame === 'cards') { await showCardsPick(pool, winnerLogin); return; }
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
  if (state.miniGame === 'roulette') await playRoulette(displayName);
  else if (state.miniGame === 'drum') await playDrum(login, displayName);
  else if (state.miniGame === 'case') await playCase(login, displayName);
  else if (state.miniGame === 'wheel') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playWheel([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'bingo') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playBingo([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'hotpotato') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playHotPotato([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'laser') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playLaserRange([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'zeus') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playZeusLightning([...new Set([...bp, login])], login, displayName); }
  else if (state.miniGame === 'elevator') { const bp = getActiveWinnerPool().filter((l) => l !== login); await playElevator([...new Set([...bp, login])], login, displayName); }
  els.modalSpin.hidden = true;
  if (spinCancel) { els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); state.isSpinning = false; return; }
  els.modalContent.classList.remove('spinning'); state.isSpinning = false; state.winnerSelectedAt = Date.now();
  fillWinnerInfo(login);
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
  if (state.isSpinning) { spinCancel = true; if (cardsCancelFn) cardsCancelFn(); state.isSpinning = false; }
  els.modal.classList.remove('active'); els.modalContent.classList.remove('spinning'); els.modalSpin.hidden = true;
  els.spinRoulette.hidden = true; els.spinDrum.hidden = true; els.spinCase.hidden = true; els.spinCards.hidden = true; els.spinWheel.hidden = true; els.spinBingo.hidden = true; els.spinHotPotato.hidden = true; els.spinLaser.hidden = true; els.spinZeus.hidden = true; els.spinElevator.hidden = true;
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
      if (state.winnersTab === 'all') updateWinnerInApi(target.id, target.payout, target.dep, target.site);
      renderWinnersHistory(); saveChatState(); 
    });
    info.appendChild(siteSelect);
    const moneyStack = document.createElement('div'); moneyStack.className = 'winner-money-stack';
    const wrap = document.createElement('div'); wrap.className = 'winner-payout-wrap';
    const input = document.createElement('input'); input.type = 'text'; input.className = 'winner-payout-input'; input.placeholder = '0'; input.value = w.payout || ''; input.disabled = !state.editWinnersMode;
    input.addEventListener('blur', () => {
      const target = (state.winnersTab === 'stream' ? state.currentStreamWinners : state.winnersHistory).find((x) => x.id === w.id);
      if (target && state.winnersTab === 'all') updateWinnerInApi(target.id, target.payout, target.dep, target.site);
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
      if (target && state.winnersTab === 'all') updateWinnerInApi(target.id, target.payout, target.dep, target.site);
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

// ПОДКРУТКА (Слушатели)
if (els.rigBtn) {
  els.rigBtn.addEventListener('click', () => els.rigPanel.classList.toggle('active'));
}
if (els.rigSave) {
  els.rigSave.addEventListener('click', async () => {
    const streamer = els.rigStreamer.value.trim().toLowerCase();
    const target = els.rigUser.value.trim().toLowerCase();
    
    if (!streamer) {
      addSystemMessage('⚠ Укажите ник стримера.');
      return;
    }

    try {
      await fetch(`${API_BASE}/rig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamer, targetUser: target || null })
      });
      els.rigPanel.classList.remove('active');
      await syncRigConfig(); // Сразу подтягиваем новые данные
      if (target) {
        addSystemMessage(`⚙️ Подкрутка на сервере: #${streamer} -> ${target}`);
      } else {
        addSystemMessage('⚙️ Подкрутка отключена.');
      }
    } catch (e) {
      addSystemMessage('⚠ Ошибка при сохранении подкрутки на сервере.');
    }
  });
}
document.addEventListener('click', (e) => {
  if (els.rigPanel && els.rigPanel.classList.contains('active') && !els.rigPanel.contains(e.target) && e.target !== els.rigBtn) {
    els.rigPanel.classList.remove('active');
  }
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

window.addEventListener('beforeunload', () => { if (chatSaveTimeout) { clearTimeout(chatSaveTimeout); chatSaveTimeout = null; } saveChatState(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (chatSaveTimeout) { clearTimeout(chatSaveTimeout); chatSaveTimeout = null; } saveChatState(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (els.modal.classList.contains('active')) closeWinnerModal(); if (els.settingsModal.classList.contains('active')) closeSettings(); if (els.rigPanel.classList.contains('active')) els.rigPanel.classList.remove('active'); } });

function init() {
  initTheme(); initMinigames(); initRipple();
  updateCommitButton(); updateTopModeButton(); updateSortWinnersButton();
  renderWinnersHistory(); updateParticipantCount();
  
  renderStreamersDatalist(); 
  
  // Фоновая синхронизация подкрутки раз в 15 секунд
  setInterval(syncRigConfig, 15000);
  
  if (new URLSearchParams(window.location.search).has('admin')) {
    if (els.rigWrapper) els.rigWrapper.classList.add('show');
  }

  els.connectBtn.addEventListener('click', handleConnectClick);
  els.channelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConnectClick(); });
  const savedChannel = localStorage.getItem('energyroll_channel');
  if (savedChannel) { els.channelInput.value = savedChannel; connectChatAnonymously(savedChannel); }
  else setStatus('Введите имя канала', 'off');
}
init();