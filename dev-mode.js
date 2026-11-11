/* ==========================================================
   🧪 DEV MODE — ТОЛЬКО ДЛЯ РАЗРАБОТКИ
   Активируется через URL:  index.html?dev=1
   Отключает подключение к реальному чату и запускает фейковый.
   ========================================================== */
(function () {
  'use strict';
  if (!new URLSearchParams(location.search).has('dev')) return;

  console.log(
    '%c🧪 DEV MODE ON%c — фейковый чат',
    'background:#e63858;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold',
    'color:#e63858'
  );

  const DEV_KEYWORD = '!roll';

  const FAKE_USERS = [
    { login: 'pixel_sniper',  display: 'PixelSniper' },
    { login: 'noobmaster69',  display: 'NoobMaster69' },
    { login: 'kabanchik',     display: 'Кабанчик' },
    { login: 'drop_hunter',   display: 'DropHunter' },
    { login: 'xXx_awp_xXx',   display: 'xXx_awp_xXx' },
    { login: 'shadow_fox',    display: 'ShadowFox' },
    { login: 'mamkin_hacker', display: 'МамкинХакер' },
    { login: 'case_open_fan', display: 'CaseOpenFan' },
    { login: 'toxic_andy',    display: 'ToxicAndy' },
    { login: 'luckynoob',     display: 'LuckyNoob' }
  ];

  const FAKE_MESSAGES = [
    '!roll', '!roll', '!roll', '!roll', '!roll',
    'давай мне нож', '!roll', '!roll', 'я хочу кейс',
    '!roll', 'w', 'gg', '!roll', '!roll',
    'надеюсь выпадет бабочка', '!roll', '!roll',
    'первый раз у тебя', '!roll', 'фартовый день сегодня'
  ];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function initDevMode() {
    // Отключаем реальное подключение, если оно началось
    if (window.state && window.state.ws) {
      window.state.ws.close();
    }

    setStatus('DEV MODE', 'wait');

    const banner = document.createElement('div');
    banner.textContent = '🧪 DEV MODE — фейковый чат (уберите ?dev=1 из URL)';
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '999',
      padding: '6px 12px',
      background: 'repeating-linear-gradient(45deg, #e63858 0 12px, #b01840 12px 24px)',
      color: '#fff',
      fontWeight: '700',
      fontSize: '12px',
      textAlign: 'center',
      letterSpacing: '0.5px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)'
    });
    document.body.appendChild(banner);
    document.body.style.paddingTop = '52px';

    els.keywordInput.value = DEV_KEYWORD;
    state.keyword = DEV_KEYWORD;

    els.clearCollect.disabled = false;

    for (let i = 0; i < 14; i++) {
      const user = pick(FAKE_USERS);
      addMessage(user.login, user.display, pick(FAKE_MESSAGES));
    }

    function tick() {
      const user = pick(FAKE_USERS);
      addMessage(user.login, user.display, pick(FAKE_MESSAGES));
      setTimeout(tick, 300 + Math.random() * 1200);
    }
    setTimeout(tick, 600);

    addSystemMessage(
      '🧪 DEV MODE: ключевое слово — "' + DEV_KEYWORD + '". Участники добавляются автоматически.'
    );
  }

  // Небольшая задержка, чтобы app.js успел инициализироваться
  setTimeout(initDevMode, 100);
})();