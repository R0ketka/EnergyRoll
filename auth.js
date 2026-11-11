(function () {
  // Twitch возвращает токен после # в URL
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');

  if (accessToken) {
    sessionStorage.setItem('twitch_access_token', accessToken);
  }
  window.location.href = 'index.html';
})();