import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;
const TWITCH_IRC = 'wss://irc-ws.chat.twitch.tv:443';

// HTTP сервер нужен для пробуждения (pre-warm через fetch) и проверки "жив ли"
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Twitch IRC Proxy OK');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (client, req) => {
  console.log(`[${new Date().toISOString()}] Client connected from ${req.socket.remoteAddress}`);
  
  const twitch = new WebSocket(TWITCH_IRC);
  const pending = []; // ← БУФЕР: копим сообщения, пока Twitch не подключится
  
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
    console.log(`[${new Date().toISOString()}] Client disconnected`);
    if (twitch.readyState === WebSocket.OPEN) twitch.close();
  });
  
  twitch.on('close', () => {
    console.log(`[${new Date().toISOString()}] Twitch disconnected`);
    if (client.readyState === WebSocket.OPEN) client.close();
  });
});

server.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`);
});