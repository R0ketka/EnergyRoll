/* =========================================================
   Состояние
   ========================================================= */
const state = {
  userLogin: null, // Теперь тут хранится имя канала
  ws: null,
  keyword: '',
  collectedUsers: new Set(),
  orderedParticipants: [],
  excludedUsers: new Set(),
  users: new Map(),
  messages: new Map(),
  currentWinner: null,
  winnersHistory: [],

  miniGame: 'instant',
  topModeEnabled: false,
  theme: 'red-light',

  winnerSelectedAt: null,
  winnerHasResponded: false,
  timerInterval: null,

  isSpinning: false
};

let spinCancel = false;
let winnerIdCounter = 0;
let cardsCancelFn = null;
let topChattersScheduled = false;

const topElements = new Map();
const avatarCache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const els = {
  channelInput:      document.getElementById('channel-input'),
  connectBtn:        document.getElementById('connect-btn'),
  settingsBtn:       document.getElementById('settings-btn'),
  keywordInput:      document.getElementById('keyword-input'),
  chatMessages:      document.getElementById('chat-messages'),
  statusText:        document.getElementById('status-text'),
  participantCount:  document.getElementById('participant-count'),
  participantsList:  document.getElementById('participants-list'),
  addParticipantInput: document.getElementById('add-participant-input'),
  addParticipantBtn: document.getElementById('add-participant-btn'),
  clearCollect:      document.getElementById('clear-collect'),
  pickWinner:        document.getElementById('pick-winner'),
  winnersHistory:    document.getElementById('winners-history'),
  topChattersList:   document.getElementById('top-chatters-list'),
  topModeToggle:     document.getElementById('top-mode-toggle'),
  topModeState:      document.getElementById('top-mode-state'),
  modal:             document.getElementById('winner-modal'),
  modalContent:      document.getElementById('modal-content'),
  modalSpin:         document.getElementById('modal-spin'),
  spinRoulette:      document.getElementById('spin-roulette'),
  spinRouletteName:  document.getElementById('spin-roulette-name'),
  spinDrum:          document.getElementById('spin-drum'),
  drumStrip:         document.getElementById('drum-strip'),
  spinCase:          document.getElementById('spin-case'),
  caseContainer:     document.getElementById('case-container'),
  caseStrip:         document.getElementById('case-strip'),
  spinCards:         document.getElementById('spin-cards'),
  cardsGrid:         document.getElementById('cards-grid'),
  spinWheel:         document.getElementById('spin-wheel'),
  wheelRotating:     document.getElementById('wheel-rotating'),
  winnerTimer:       document.getElementById('winner-timer'),
  winnerName:        document.getElementById('winner-name'),
  winnerMessages:    document.getElementById('winner-messages'),
  modalPayoutInput:  document.getElementById('modal-payout-input'),
  modalPayoutBtn:    document.getElementById('modal-payout-btn'),
  rerollBtn:         document.getElementById('reroll-btn'),
  closeModal:        document.getElementById('close-modal'),
  settingsModal:     document.getElementById('settings-modal'),
  closeSettings:     document.getElementById('close-settings'),
  themeList:         document.getElementById('theme-list')
};

/* =========================================================
   🎨 ТЕМЫ
   ========================================================= */
const THEMES = ['red-light', 'red-dark', 'purple', 'orange', 'blue'];

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'red-light';
  state.theme = name;
  document.documentElement.setAttribute('data-theme', name);
  try { localStorage.setItem('energyroll_theme', name); } catch (e) {}
  if (els.themeList) {
    els.themeList.querySelectorAll('.theme-option').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeValue === name);
    });
  }
}

function initTheme() {
  let saved = 'red-light';
  try { saved = localStorage.getItem('energyroll_theme') || 'red-light'; } catch (e) {}
  applyTheme(saved);

  if (els.themeList) {
    els.themeList.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-option');
      if (!btn) return;
      applyTheme(btn.dataset.themeValue);
    });
  }
}

/* =========================================================
   ⚙️ МОДАЛКА НАСТРОЕК
   ========================================================= */
function openSettings() {
  els.settingsModal.classList.add('active');
}

function closeSettings() {
  els.settingsModal.classList.remove('active');
}

/* =========================================================
   Утилиты
   ========================================================= */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min + ':' + String(sec).padStart(2, '0');
}

function secureRandomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  const arr = new Uint32Array(1);
  let val;
  do {
    crypto.getRandomValues(arr);
    val = arr[0];
  } while (val >= limit);
  return val % max;
}

function randomParticipantLogin() {
  const pool = state.orderedParticipants;
  if (pool.length === 0) return '_empty_';
  return pool[secureRandomInt(pool.length)];
}

function randomParticipantName() {
  const login = randomParticipantLogin();
  return state.users.get(login) || login;
}

function setStatus(text, type = 'off') {
  els.statusText.textContent = text;
  els.statusText.className = 'status status-' + type;
}

function avatarGradient(login) {
  let cached = avatarCache.get(login);
  if (cached) return cached;
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = ((hash << 5) - hash + login.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  const result = `linear-gradient(135deg, hsl(${h1}, 65%, 48%), hsl(${h2}, 60%, 36%))`;
  avatarCache.set(login, result);
  return result;
}

/* =========================================================
   🔥 Топ по сообщениям
   ========================================================= */
function getTopByMessages(n = 10) {
  const arr = [];
  for (const [login, msgs] of state.messages) {
    arr.push({
      login,
      name: state.users.get(login) || login,
      count: msgs.length
    });
  }
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, n);
}

function createTopItemEl() {
  const row = document.createElement('div');
  row.className = 'top-item';

  const rank = document.createElement('span');
  rank.className = 'top-rank';

  const name = document.createElement('span');
  name.className = 'top-name';

  const count = document.createElement('span');
  count.className = 'top-count';

  row.appendChild(rank);
  row.appendChild(name);
  row.appendChild(count);
  return row;
}

function renderTopChatters() {
  const top = getTopByMessages(10);
  const list = els.topChattersList;

  if (top.length === 0) {
    const hasEmpty = list.querySelector('.empty');
    if (!hasEmpty) {
      list.innerHTML = '<div class="empty">Пока никого</div>';
      topElements.clear();
    }
    return;
  }

  const empty = list.querySelector('.empty');
  if (empty) empty.remove();

  const currentLogins = new Set(top.map((x) => x.login));

  for (const [login, el] of topElements) {
    if (!currentLogins.has(login)) {
      el.remove();
      topElements.delete(login);
    }
  }

  top.forEach((item, i) => {
    let el = topElements.get(item.login);
    if (!el) {
      el = createTopItemEl();
      topElements.set(item.login, el);
    }

    el.children[0].textContent = String(i + 1);
    el.children[1].textContent = item.name;
    el.children[1].title = item.name;
    el.children[2].textContent = String(item.count);

    const target = list.children[i];
    if (target !== el) {
      list.insertBefore(el, target || null);
    }
  });
}

function scheduleTopChattersRender() {
  if (topChattersScheduled) return;
  topChattersScheduled = true;
  requestAnimationFrame(() => {
    topChattersScheduled = false;
    renderTopChatters();
  });
}

function getActiveWinnerPool() {
  let pool;
  if (state.topModeEnabled) {
    pool = getTopByMessages(10).map((x) => x.login);
  } else {
    pool = state.orderedParticipants;
  }
  if (state.excludedUsers.size === 0) return pool;
  return pool.filter((login) => !state.excludedUsers.has(login));
}

function updateTopModeButton() {
  els.topModeToggle.classList.toggle('active', state.topModeEnabled);
  els.topModeState.textContent = state.topModeEnabled ? 'Вкл' : 'Выкл';
  updatePickWinnerButton();
}

function updatePickWinnerButton() {
  els.pickWinner.disabled = getActiveWinnerPool().length === 0;
}

let pickWinnerScheduled = false;
function schedulePickWinnerUpdate() {
  if (pickWinnerScheduled) return;
  pickWinnerScheduled = true;
  requestAnimationFrame(() => {
    pickWinnerScheduled = false;
    updatePickWinnerButton();
  });
}

function toggleExcludeParticipant(login) {
  if (state.excludedUsers.has(login)) {
    state.excludedUsers.delete(login);
  } else {
    state.excludedUsers.add(login);
  }
  updateParticipantVisual(login);
  updatePickWinnerButton();
}

function updateParticipantVisual(login) {
  const items = els.participantsList.querySelectorAll('.participant-item');
  let target = null;
  for (const it of items) {
    if (it.dataset.login === login) { target = it; break; }
  }
  if (!target) return;

  const excluded = state.excludedUsers.has(login);
  target.classList.toggle('participant-excluded', excluded);

  const btn = target.querySelector('.participant-exclude-btn');
  if (btn) {
    btn.textContent = excluded ? '↺' : '✕';
    btn.title = excluded ? 'Вернуть в розыгрыш' : 'Исключить из розыгрыша';
  }
}

/* =========================================================
   ➕ Добавление по нику
   ========================================================= */
function addParticipantByLogin() {
  const raw = els.addParticipantInput.value.trim();
  if (!raw) return;

  const displayName = raw.replace(/^@/, '').trim();
  if (!displayName) return;
  const login = displayName.toLowerCase().replace(/\s+/g, '');

  if (state.collectedUsers.has(login)) {
    addSystemMessage('⚠ ' + displayName + ' уже в списке участников.');
    els.addParticipantInput.value = '';
    els.addParticipantInput.focus();
    return;
  }

  state.collectedUsers.add(login);
  state.orderedParticipants.push(login);
  if (!state.users.has(login)) state.users.set(login, displayName);
  if (!state.messages.has(login)) state.messages.set(login, []);

  renderParticipant(login, state.users.get(login), true);
  updateParticipantCount();
  updatePickWinnerButton();
  addSystemMessage('➕ Добавлен: ' + displayName);

  els.addParticipantInput.value = '';
  els.addParticipantInput.focus();
}

/* =========================================================
   Подключение к чату (анонимно)
   ========================================================= */
function connectChatAnonymously(channelName) {
  if (state.ws) {
    state.ws.close();
  }

  const channel = channelName.toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  if (!channel) {
    addSystemMessage('⚠ Введите корректное имя канала.');
    return;
  }

  localStorage.setItem('energyroll_channel', channel);
  state.userLogin = channel;

  setStatus('Подключение...', 'wait');
  state.ws = new WebSocket(CONFIG.CHAT_WS_URL);

  state.ws.onopen = () => {
    const anonNick = 'justinfan' + Math.floor(Math.random() * 99999);
    
    state.ws.send('PASS schmoopiie');
    state.ws.send('NICK ' + anonNick);
    state.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    state.ws.send('JOIN #' + channel);
    
    setStatus('В чате: #' + channel, 'ok');
  };

  state.ws.onmessage = (event) => {
    const lines = event.data.split('\r\n');
    for (const line of lines) if (line) handleIrcLine(line);
  };

  state.ws.onclose = () => {
    setStatus('Переподключение...', 'wait');
    setTimeout(() => connectChatAnonymously(channel), 3000);
  };

  state.ws.onerror = () => {
    setStatus('Ошибка соединения', 'off');
  };
}

function handleConnectClick() {
  const channel = els.channelInput.value.trim();
  if (!channel) {
    addSystemMessage('⚠ Введите имя канала.');
    return;
  }
  connectChatAnonymously(channel);
}

/* =========================================================
   Парсинг IRC
   ========================================================= */
function parseTags(raw) {
  const tags = {};
  if (!raw) return tags;
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    tags[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return tags;
}

function handleIrcLine(line) {
  if (line.startsWith('PING')) {
    state.ws.send('PONG :tmi.twitch.tv');
    return;
  }
  let rest = line;
  let tags = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.substring(1, sp));
    rest = rest.substring(sp + 1);
  }
  if (rest.startsWith(':')) {
    rest = rest.substring(rest.indexOf(' ') + 1);
  }
  const sp = rest.indexOf(' ');
  const command = sp === -1 ? rest : rest.substring(0, sp);
  const params = sp === -1 ? '' : rest.substring(sp + 1);
  if (command !== 'PRIVMSG') return;

  const sep = params.indexOf(' :');
  if (sep === -1) return;
  const message = params.substring(sep + 2);

  const login = tags['login'];
  const displayName = tags['display-name'] || login;
  if (login) addMessage(login, displayName, message);
}

/* =========================================================
   Сообщения
   ========================================================= */
function addMessage(login, displayName, text) {
  const time = new Date();

  state.users.set(login, displayName);
  if (!state.messages.has(login)) state.messages.set(login, []);
  state.messages.get(login).push({ text, time });

  const keyword = state.keyword.trim().toLowerCase();
  if (keyword && text.trim().toLowerCase() === keyword) {
    if (!state.collectedUsers.has(login)) {
      state.collectedUsers.add(login);
      state.orderedParticipants.push(login);
      renderParticipant(login, displayName, true);
      updateParticipantCount();
      updatePickWinnerButton();
    }
  }

  if (
    state.currentWinner === login &&
    els.modal.classList.contains('active') &&
    !state.isSpinning
  ) {
    appendWinnerMessage({ text, time }, true);
    if (!state.winnerHasResponded) {
      state.winnerHasResponded = true;
      stopWinnerTimer();
    }
  }

  renderChatMessage(login, displayName, text);

  scheduleTopChattersRender();
  schedulePickWinnerUpdate();
}

function renderParticipant(login, displayName, isNew = false) {
  const empty = els.participantsList.querySelector('.empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'participant-item' + (isNew ? ' participant-new' : '');
  el.dataset.login = login;

  const avatar = document.createElement('div');
  avatar.className = 'participant-avatar';
  avatar.style.background = avatarGradient(login);
  avatar.textContent = (displayName || '?').charAt(0).toUpperCase();
  avatar.title = displayName;

  const name = document.createElement('span');
  name.className = 'participant-name';
  name.textContent = displayName;
  name.title = displayName;

  const excludeBtn = document.createElement('button');
  excludeBtn.className = 'participant-exclude-btn';
  excludeBtn.type = 'button';
  excludeBtn.textContent = state.excludedUsers.has(login) ? '↺' : '✕';
  excludeBtn.title = state.excludedUsers.has(login)
    ? 'Вернуть в розыгрыш'
    : 'Исключить из розыгрыша';
  excludeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExcludeParticipant(login);
  });

  el.appendChild(avatar);
  el.appendChild(name);
  el.appendChild(excludeBtn);

  if (state.excludedUsers.has(login)) {
    el.classList.add('participant-excluded');
  }

  els.participantsList.appendChild(el);
  els.participantsList.scrollTop = els.participantsList.scrollHeight;
}

function updateParticipantCount() {
  els.participantCount.textContent = state.collectedUsers.size;
}

function renderChatMessage(login, displayName, text) {
  const empty = els.chatMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'chat-msg';

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.style.background = avatarGradient(login);
  avatar.textContent = (displayName || '?').charAt(0).toUpperCase();
  avatar.title = displayName;

  const body = document.createElement('div');
  body.className = 'chat-msg-body';

  const author = document.createElement('span');
  author.className = 'chat-author';
  author.textContent = displayName;
  author.title = displayName;

  const sep = document.createTextNode(': ');

  const textSpan = document.createElement('span');
  textSpan.className = 'chat-text';
  textSpan.textContent = text;

  body.appendChild(author);
  body.appendChild(sep);
  body.appendChild(textSpan);

  el.appendChild(avatar);
  el.appendChild(body);
  els.chatMessages.appendChild(el);

  while (els.chatMessages.children.length > 100) {
    els.chatMessages.removeChild(els.chatMessages.firstChild);
  }
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  els.chatMessages.appendChild(el);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function startWinnerTimer() {
  els.winnerTimer.classList.remove('timer-done');
  els.winnerTimer.textContent = '0:00';

  const startTime = state.winnerSelectedAt;
  state.timerInterval = setInterval(() => {
    els.winnerTimer.textContent = formatDuration(Date.now() - startTime);
  }, 250);
}

function stopWinnerTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  els.winnerTimer.textContent = formatDuration(Date.now() - state.winnerSelectedAt);
  els.winnerTimer.classList.add('timer-done');
}

function clearWinnerTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function appendWinnerMessage(msg, isNew) {
  const empty = els.winnerMessages.querySelector('.empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'winner-msg' + (isNew ? ' winner-msg-new' : ' winner-msg-dim');
  el.innerHTML =
    '<span class="winner-msg-time">' + formatTime(msg.time) + '</span>' +
    escapeHtml(msg.text);

  if (isNew) {
    els.winnerMessages.prepend(el);
    els.winnerMessages.scrollTop = 0;
  } else {
    els.winnerMessages.appendChild(el);
  }
}

function fillWinnerInfo(login) {
  const messages = state.messages.get(login) || [];
  const recent = messages.slice(-100);

  if (recent.length === 0) {
    els.winnerMessages.innerHTML =
      '<div class="empty">У победителя пока нет сообщений в этой сессии</div>';
  } else {
    for (const msg of recent) appendWinnerMessage(msg, false);
  }
  els.winnerMessages.scrollTop = els.winnerMessages.scrollHeight;
  startWinnerTimer();
}

function initMinigames() {
  const known = ['instant', 'roulette', 'drum', 'case', 'cards', 'wheel'];
  let saved = localStorage.getItem('energyroll_minigame');
  if (!known.includes(saved)) saved = 'instant';

  state.miniGame = saved;

  const buttons = document.querySelectorAll('.minigame-item');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === saved);
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      state.miniGame = mode;
      localStorage.setItem('energyroll_minigame', mode);
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
}

function updateRouletteName(name) {
  els.spinRouletteName.textContent = name;
  els.spinRouletteName.title = name;
  const len = name.length;
  els.spinRouletteName.classList.toggle('spin-name-long', len > 12 && len <= 20);
  els.spinRouletteName.classList.toggle('spin-name-xlong', len > 20);
}

function playRoulette(displayName) {
  return new Promise((resolve) => {
    els.spinRoulette.hidden = false;
    els.spinDrum.hidden = true;
    els.spinCase.hidden = true;
    els.spinCards.hidden = true;
    els.spinWheel.hidden = true;
    els.spinRouletteName.classList.remove('spin-name-final');

    const duration = 2500;
    const start = performance.now();

    const tick = () => {
      if (spinCancel) { resolve(); return; }

      const elapsed = performance.now() - start;
      if (elapsed >= duration) {
        updateRouletteName(displayName);
        els.spinRouletteName.classList.add('spin-name-final');
        setTimeout(() => {
          els.spinRoulette.hidden = true;
          els.spinRouletteName.classList.remove('spin-name-final');
          resolve();
        }, 500);
        return;
      }

      updateRouletteName(randomParticipantName());

      const progress = elapsed / duration;
      const interval = 45 + progress * 160;
      setTimeout(tick, interval);
    };

    tick();
  });
}

const DRUM_ITEM_HEIGHT   = 64;
const DRUM_VISIBLE_ITEMS = 5;
const DRUM_TOTAL_ITEMS   = 50;
const DRUM_WINNER_INDEX  = 22;
const DRUM_DURATION      = 3800;

function createDrumItem(login, name) {
  const item = document.createElement('div');
  item.className = 'drum-item';

  const avatar = document.createElement('div');
  avatar.className = 'drum-avatar';
  avatar.style.background = avatarGradient(login);
  avatar.textContent = (name || '?').charAt(0).toUpperCase();
  avatar.title = name;

  const nameEl = document.createElement('div');
  nameEl.className = 'drum-name';
  nameEl.textContent = name;
  nameEl.title = name;

  item.appendChild(avatar);
  item.appendChild(nameEl);
  return item;
}

function playDrum(winnerLogin, winnerName) {
  return new Promise((resolve) => {
    els.spinRoulette.hidden = true;
    els.spinDrum.hidden = false;
    els.spinCase.hidden = true;
    els.spinCards.hidden = true;
    els.spinWheel.hidden = true;

    const strip = els.drumStrip;
    strip.innerHTML = '';
    strip.style.transform = 'translateY(0)';

    for (let i = 0; i < DRUM_TOTAL_ITEMS; i++) {
      let login, name;
      if (i === DRUM_WINNER_INDEX) {
        login = winnerLogin;
        name = winnerName;
      } else {
        login = randomParticipantLogin();
        name = state.users.get(login) || login;
      }
      strip.appendChild(createDrumItem(login, name));
    }

    void strip.offsetHeight;

    const centerIndex = Math.floor(DRUM_VISIBLE_ITEMS / 2);
    const targetTranslate = -(DRUM_WINNER_INDEX - centerIndex) * DRUM_ITEM_HEIGHT;

    const start = performance.now();

    const tick = (now) => {
      if (spinCancel) { resolve(); return; }

      const elapsed = now - start;
      const t = Math.min(elapsed / DRUM_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = targetTranslate * eased;

      strip.style.transform = `translateY(${current}px)`;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        strip.style.transform = `translateY(${targetTranslate}px)`;
        setTimeout(() => {
          els.spinDrum.hidden = true;
          resolve();
        }, 700);
      }
    };

    requestAnimationFrame(tick);
  });
}

const CASE_ITEM_WIDTH  = 120;
const CASE_ITEM_GAP    = 8;
const CASE_TOTAL_ITEMS = 40;
const CASE_WINNER_IDX  = 25;
const CASE_DURATION    = 3600;

function playCase(winnerLogin, winnerName) {
  return new Promise((resolve) => {
    els.spinRoulette.hidden = true;
    els.spinDrum.hidden = true;
    els.spinCase.hidden = false;
    els.spinCards.hidden = true;
    els.spinWheel.hidden = true;

    const strip = els.caseStrip;
    strip.innerHTML = '';
    strip.style.transform = 'translateX(0)';

    const rarities = ['common', 'uncommon', 'rare', 'epic'];

    for (let i = 0; i < CASE_TOTAL_ITEMS; i++) {
      let login, name, rarity;
      if (i === CASE_WINNER_IDX) {
        login = winnerLogin;
        name = winnerName;
        rarity = 'legendary';
      } else {
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
      avatar.title = name;

      const nameEl = document.createElement('div');
      nameEl.className = 'case-name';
      nameEl.textContent = name;
      nameEl.title = name;

      item.appendChild(avatar);
      item.appendChild(nameEl);
      strip.appendChild(item);
    }

    void strip.offsetHeight;

    const containerWidth = els.caseContainer.clientWidth;
    const winnerPos = CASE_WINNER_IDX * (CASE_ITEM_WIDTH + CASE_ITEM_GAP);
    const targetX = containerWidth / 2 - CASE_ITEM_WIDTH / 2 - winnerPos;

    const start = performance.now();

    function tick(now) {
      if (spinCancel) { resolve(); return; }

      const elapsed = now - start;
      const t = Math.min(elapsed / CASE_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      const current = targetX * eased;

      strip.style.transform = `translateX(${current}px)`;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        strip.style.transform = `translateX(${targetX}px)`;
        const winnerEl = strip.children[CASE_WINNER_IDX];
        winnerEl.classList.add('case-item-winner');

        setTimeout(() => {
          els.spinCase.hidden = true;
          resolve();
        }, 900);
      }
    }

    requestAnimationFrame(tick);
  });
}

async function shuffleCardsWithFlip(grid) {
  return new Promise((resolve) => {
    const cards = Array.from(grid.children);
    const firstRects = new Map();
    cards.forEach((c) => firstRects.set(c, c.getBoundingClientRect()));

    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    shuffled.forEach((c) => grid.appendChild(c));

    shuffled.forEach((c) => {
      const first = firstRects.get(c);
      const last = c.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (dx || dy) {
        c.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
        );
      }
    });

    setTimeout(resolve, 360);
  });
}

function playCards(pool) {
  return new Promise((resolve) => {
    els.spinRoulette.hidden = true;
    els.spinDrum.hidden = true;
    els.spinCase.hidden = true;
    els.spinCards.hidden = false;
    els.spinWheel.hidden = true;

    const grid = els.cardsGrid;
    grid.innerHTML = '';

    const cardsCount = Math.min(10, pool.length);
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, cardsCount);

    const cardData = shuffled.map((login) => {
      const name = state.users.get(login) || login;

      const card = document.createElement('div');
      card.className = 'pick-card';
      card.dataset.login = login;

      const front = document.createElement('div');
      front.className = 'pick-card-face pick-card-front';

      const back = document.createElement('div');
      back.className = 'pick-card-face pick-card-back';

      const avatar = document.createElement('div');
      avatar.className = 'pick-card-avatar';
      avatar.style.background = avatarGradient(login);
      avatar.textContent = (name || '?').charAt(0).toUpperCase();
      avatar.title = name;

      const nameEl = document.createElement('div');
      nameEl.className = 'pick-card-name';
      nameEl.textContent = name;
      nameEl.title = name;

      back.appendChild(avatar);
      back.appendChild(nameEl);
      card.appendChild(front);
      card.appendChild(back);

      card.classList.add('pick-card-flipped');
      grid.appendChild(card);

      return { card, login, name };
    });

    let picked = null;

    const clickHandler = (e) => {
      if (picked) return;
      const card = e.target.closest('.pick-card');
      if (!card) return;

      picked = card;

      cardData.forEach(({ card: c }) => {
        c.removeEventListener('click', clickHandler);
        c.dataset.clickable = 'false';
      });

      card.classList.add('pick-card-flipped');
      card.classList.add('pick-card-winner');

      setTimeout(() => {
        cardsCancelFn = null;
        resolve(card.dataset.login);
      }, 900);
    };

    cardsCancelFn = () => {
      cardData.forEach(({ card }) => {
        card.removeEventListener('click', clickHandler);
      });
      cardsCancelFn = null;
      resolve(null);
    };

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

      cardData.forEach(({ card }) => {
        card.dataset.clickable = 'true';
        card.addEventListener('click', clickHandler);
      });
    })();
  });
}

function playWheel(pool, winnerLogin, winnerName) {
  return new Promise((resolve) => {
    els.spinRoulette.hidden = true;
    els.spinDrum.hidden = true;
    els.spinCase.hidden = true;
    els.spinCards.hidden = true;
    els.spinWheel.hidden = false;

    const MAX = 12;
    let wheelLogins;

    if (pool.length <= MAX) {
      wheelLogins = [...pool];
    } else {
      const others = pool.filter((l) => l !== winnerLogin);
      for (let i = others.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        [others[i], others[j]] = [others[j], others[i]];
      }
      wheelLogins = others.slice(0, MAX - 1);
      wheelLogins.push(winnerLogin);
    }

    for (let i = wheelLogins.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [wheelLogins[i], wheelLogins[j]] = [wheelLogins[j], wheelLogins[i]];
    }

    const N = wheelLogins.length;
    const segAngle = 360 / N;
    const winnerIdx = wheelLogins.indexOf(winnerLogin);

    const svgNS = 'http://www.w3.org/2000/svg';
    const g = els.wheelRotating;
    g.innerHTML = '';

    const themeColors = [
      getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim() || '#2e1212',
      getComputedStyle(document.documentElement).getPropertyValue('--bg-tertiary').trim() || '#3c1a1a',
      getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#260f0f'
    ];
    const segColors = [themeColors[0], themeColors[1], themeColors[2]];

    for (let i = 0; i < N; i++) {
      const startAngle = -90 + i * segAngle;
      const endAngle = -90 + (i + 1) * segAngle;
      const midAngle = (startAngle + endAngle) / 2;

      const startRad = startAngle * Math.PI / 180;
      const endRad = endAngle * Math.PI / 180;
      const x1 = Math.cos(startRad) * 140;
      const y1 = Math.sin(startRad) * 140;
      const x2 = Math.cos(endRad) * 140;
      const y2 = Math.sin(endRad) * 140;

      const largeArc = segAngle > 180 ? 1 : 0;

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M 0 0 L ${x1} ${y1} A 140 140 0 ${largeArc} 1 ${x2} ${y2} Z`);
      path.setAttribute('fill', segColors[i % segColors.length]);
      path.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#5c2828');
      path.setAttribute('stroke-width', '1.5');
      g.appendChild(path);

      const midRad = midAngle * Math.PI / 180;
      const ax = Math.cos(midRad) * 40;
      const ay = Math.sin(midRad) * 40;

      const name = state.users.get(wheelLogins[i]) || wheelLogins[i];
      const MAX_CHARS = 11;
      const display = name.length > MAX_CHARS
        ? name.slice(0, MAX_CHARS - 1) + '…'
        : name;

      let fontSize = '11';
      if (display.length > 9) fontSize = '9';
      else if (display.length > 7) fontSize = '10';

      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', '#f2e6e6');
      text.setAttribute('font-size', fontSize);
      text.setAttribute('font-weight', '700');
      text.setAttribute('transform', `translate(${ax} ${ay}) rotate(${midAngle})`);
      text.textContent = display;

      const titleEl = document.createElementNS(svgNS, 'title');
      titleEl.textContent = name;
      text.appendChild(titleEl);

      g.appendChild(text);
    }

    const targetRotation = 360 * 5 - (winnerIdx + 0.5) * segAngle;

    g.style.transition = 'none';
    g.style.transform = 'rotate(0deg)';
    void g.getBoundingClientRect();

    const duration = 4200;
    const start = performance.now();

    function tick(now) {
      if (spinCancel) { resolve(); return; }

      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      const current = targetRotation * eased;

      g.style.transform = `rotate(${current}deg)`;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        g.style.transform = `rotate(${targetRotation}deg)`;
        setTimeout(() => {
          els.spinWheel.hidden = true;
          resolve();
        }, 900);
      }
    }

    requestAnimationFrame(tick);
  });
}

async function pickWinner() {
  if (state.isSpinning) return;

  const basePool = getActiveWinnerPool();

  if (basePool.length === 0) {
    addSystemMessage(
      state.topModeEnabled
        ? '⚠ Нет активных в чате (или все исключены).'
        : '⚠ Нет участников (или все исключены).'
    );
    return;
  }
  const pool = basePool.filter((login) => login !== state.currentWinner);
  if (pool.length === 0) {
    addSystemMessage('⚠ Нет других участников для рерола.');
    return;
  }

  if (state.miniGame === 'cards') {
    await showCardsPick(pool);
    return;
  }

  const winnerLogin = pool[secureRandomInt(pool.length)];
  await showWinnerWithSpin(winnerLogin);
}

async function showWinnerWithSpin(login) {
  clearWinnerTimer();

  state.currentWinner = login;
  state.winnerHasResponded = false;
  state.isSpinning = true;
  spinCancel = false;

  const displayName = state.users.get(login) || login;

  els.modal.classList.add('active');
  els.modalContent.classList.add('spinning');

  els.winnerName.textContent = displayName;
  els.winnerName.title = displayName;
  els.winnerMessages.innerHTML = '';
  els.winnerTimer.textContent = '0:00';
  els.winnerTimer.classList.remove('timer-done');
  els.modalPayoutInput.value = '';

  els.modalSpin.hidden = false;

  if (state.miniGame === 'roulette') {
    await playRoulette(displayName);
  } else if (state.miniGame === 'drum') {
    await playDrum(login, displayName);
  } else if (state.miniGame === 'case') {
    await playCase(login, displayName);
  } else if (state.miniGame === 'wheel') {
    const basePool = getActiveWinnerPool().filter((l) => l !== login);
    const wheelPool = [...new Set([...basePool, login])];
    await playWheel(wheelPool, login, displayName);
  }

  els.modalSpin.hidden = true;

  if (spinCancel) {
    els.modal.classList.remove('active');
    els.modalContent.classList.remove('spinning');
    state.isSpinning = false;
    return;
  }

  els.modalContent.classList.remove('spinning');
  state.isSpinning = false;
  state.winnerSelectedAt = Date.now();

  fillWinnerInfo(login);
}

async function showCardsPick(pool) {
  clearWinnerTimer();

  state.winnerHasResponded = false;
  state.isSpinning = true;
  spinCancel = false;
  state.currentWinner = null;

  els.modal.classList.add('active');
  els.modalContent.classList.add('spinning');

  els.winnerMessages.innerHTML = '';
  els.winnerTimer.textContent = '0:00';
  els.winnerTimer.classList.remove('timer-done');
  els.modalPayoutInput.value = '';

  els.modalSpin.hidden = false;

  const pickedLogin = await playCards(pool);

  if (spinCancel || !pickedLogin) {
    els.modal.classList.remove('active');
    els.modalContent.classList.remove('spinning');
    els.modalSpin.hidden = true;
    els.spinCards.hidden = true;
    state.isSpinning = false;
    return;
  }

  state.currentWinner = pickedLogin;
  state.winnerSelectedAt = Date.now();

  const displayName = state.users.get(pickedLogin) || pickedLogin;
  els.winnerName.textContent = displayName;
  els.winnerName.title = displayName;

  await sleep(700);

  if (spinCancel) {
    els.modal.classList.remove('active');
    els.modalContent.classList.remove('spinning');
    els.modalSpin.hidden = true;
    els.spinCards.hidden = true;
    state.currentWinner = null;
    state.isSpinning = false;
    return;
  }

  els.modalContent.classList.remove('spinning');
  els.modalSpin.hidden = true;
  els.spinCards.hidden = true;
  state.isSpinning = false;

  fillWinnerInfo(pickedLogin);
}

function commitCurrentWinner() {
  if (!state.currentWinner) return;

  const payout = els.modalPayoutInput.value.trim();
  const displayName = state.users.get(state.currentWinner) || state.currentWinner;

  addWinnerToHistory(displayName, payout);

  const msg = '🏆 Победитель: ' + displayName + (payout ? ' — ' + payout + ' ₽' : '');
  addSystemMessage(msg);

  closeWinnerModal();
}

function closeWinnerModal() {
  if (state.isSpinning) {
    spinCancel = true;
    if (cardsCancelFn) cardsCancelFn();
    state.isSpinning = false;
  }
  els.modal.classList.remove('active');
  els.modalContent.classList.remove('spinning');
  els.modalSpin.hidden = true;
  els.spinRoulette.hidden = true;
  els.spinDrum.hidden = true;
  els.spinCase.hidden = true;
  els.spinCards.hidden = true;
  els.spinWheel.hidden = true;
  els.modalPayoutInput.value = '';
  clearWinnerTimer();
  state.currentWinner = null;
}

function addWinnerToHistory(displayName, payout = '') {
  state.winnersHistory.unshift({
    id: ++winnerIdCounter,
    name: displayName,
    payout: payout
  });
  renderWinnersHistory();
}

function renderWinnersHistory() {
  if (state.winnersHistory.length === 0) {
    els.winnersHistory.innerHTML = '<div class="empty">Пока никого</div>';
    return;
  }

  els.winnersHistory.innerHTML = '';

  for (const w of state.winnersHistory) {
    const row = document.createElement('div');
    row.className = 'winner-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'winner-item-name';
    nameEl.textContent = w.name;
    nameEl.title = w.name;

    const wrap = document.createElement('div');
    wrap.className = 'winner-payout-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'winner-payout-input';
    input.placeholder = '0';
    input.value = w.payout || '';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;

    input.addEventListener('input', (e) => {
      const item = state.winnersHistory.find((x) => x.id === w.id);
      if (item) item.payout = e.target.value;
    });

    const cur = document.createElement('span');
    cur.className = 'winner-payout-currency';
    cur.textContent = '₽';

    wrap.appendChild(input);
    wrap.appendChild(cur);

    const del = document.createElement('button');
    del.className = 'winner-delete-btn';
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Удалить из победителей';
    del.addEventListener('click', () => {
      state.winnersHistory = state.winnersHistory.filter((x) => x.id !== w.id);
      renderWinnersHistory();
    });

    row.appendChild(nameEl);
    row.appendChild(wrap);
    row.appendChild(del);
    els.winnersHistory.appendChild(row);
  }
}

/* =========================================================
   Обработчики
   ========================================================= */
els.keywordInput.addEventListener('input', (e) => {
  state.keyword = e.target.value;
});

els.addParticipantBtn.addEventListener('click', addParticipantByLogin);
els.addParticipantInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addParticipantByLogin();
  }
});

els.settingsBtn.addEventListener('click', openSettings);
els.closeSettings.addEventListener('click', closeSettings);
els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);

els.clearCollect.addEventListener('click', () => {
  state.collectedUsers.clear();
  state.orderedParticipants = [];
  state.excludedUsers.clear();
  state.currentWinner = null;
  updateParticipantCount();
  updatePickWinnerButton();
  els.participantsList.innerHTML =
    '<div class="empty">Напишите ключевое слово в чат, чтобы участвовать</div>';
  addSystemMessage('🗑 Список участников очищен.');
});

els.topModeToggle.addEventListener('click', () => {
  state.topModeEnabled = !state.topModeEnabled;
  updateTopModeButton();
  addSystemMessage(
    state.topModeEnabled
      ? '🔥 Режим Топ-10 по сообщениям ВКЛЮЧЁН.'
      : '🎲 Выбор снова среди участников ключевого слова.'
  );
});

els.pickWinner.addEventListener('click', pickWinner);
els.rerollBtn.addEventListener('click', pickWinner);
els.modalPayoutBtn.addEventListener('click', commitCurrentWinner);
els.modalPayoutInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitCurrentWinner();
  }
});
els.closeModal.addEventListener('click', closeWinnerModal);
els.modal.querySelector('.modal-backdrop').addEventListener('click', closeWinnerModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (els.modal.classList.contains('active')) closeWinnerModal();
    if (els.settingsModal.classList.contains('active')) closeSettings();
  }
});

/* =========================================================
   Старт
   ========================================================= */
function init() {
  initTheme();
  initMinigames();
  updateTopModeButton();
  renderTopChatters();

  els.connectBtn.addEventListener('click', handleConnectClick);
  els.channelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleConnectClick();
  });

  const savedChannel = localStorage.getItem('energyroll_channel');
  if (savedChannel) {
    els.channelInput.value = savedChannel;
    connectChatAnonymously(savedChannel);
  } else {
    setStatus('Введите имя канала', 'off');
  }
}

init();
