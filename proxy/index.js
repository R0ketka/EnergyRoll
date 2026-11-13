import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;
const TWITCH_IRC = 'wss://irc-ws.chat.twitch.tv:443';

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (client) => {
  console.log('Клиент подключился, открываю соединение с Twitch...');
  const twitch = new WebSocket(TWITCH_IRC);

  // Браузер → Twitch
  client.on('message', (msg) => {
    if (twitch.readyState === WebSocket.OPEN) twitch.send(msg);
  });

  // Twitch → Браузер
  twitch.on('message', (msg) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });

  // Корректное закрытие
  const closeBoth = () => {
    if (client.readyState === WebSocket.OPEN) client.close();
    if (twitch.readyState === WebSocket.OPEN) twitch.close();
  };

  client.on('close', closeBoth);
  twitch.on('close', closeBoth);
  client.on('error', closeBoth);
  twitch.on('error', closeBoth);

  twitch.on('open', () => console.log('Соединение с Twitch установлено'));
});

console.log(`Прокси-сервер запущен на порту ${PORT}`);