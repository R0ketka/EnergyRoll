import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;
const TWITCH_IRC = 'wss://irc-ws.chat.twitch.tv:443';

// HTTP сервер для пробуждения и проверки
const server = http.createServer((req, res) => {
  // РАЗРЕШАЕМ ЗАПРОСЫ С ЛЮБЫХ ДОМЕНОВ (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Обработка preflight-запросов
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Twitch IRC Proxy OK');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (client, req) => {
  console.log(`[${new Date().toISOString()}] Client connected from ${req.socket.remoteAddress}`);
  
  const twitch = new WebSocket(TWITCH_IRC);
  const pending = [];
  
  client.on('message', (msg) => {
    if (twitch.readyState === WebSocket.OPEN) {
      twitch.send(msg);
    } else {
      pending.push(msg);
    }
  });
  
  twitch.on('open', () => {
    console.log(`Flushing ${pending.length} buffered messages to Twitch`);
    while (pending.length) {
      twitch.send(pending.shift());
    }
  });
  
  twitch.on('message', (msg) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
  
  twitch.on('error', (e) => {
    console.error('Twitch error:', e.message);
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'Twitch error');
  });
  
  client.on('error', (e) => console.error('Client error:', e.message));
  
  client.on('close', () => {
    if (twitch.readyState === WebSocket.OPEN) twitch.close();
  });
  
  twitch.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close();
  });
});

// ВАЖНО: слушаем на 0.0.0.0 для Render
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy listening on port ${PORT}`);
});