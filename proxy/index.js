import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;
const TWITCH_IRC = 'wss://irc-ws.chat.twitch.tv:443';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Twitch IRC Proxy OK');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (client, req) => {
  console.log(`[${new Date().toISOString()}] Client connected`);
  
  const twitch = new WebSocket(TWITCH_IRC);
  const pending = [];
  
  client.on('message', (msg) => {
    if (twitch.readyState === WebSocket.OPEN) twitch.send(msg);
    else pending.push(msg);
  });
  
  twitch.on('open', () => {
    console.log(`Twitch connected. Flushing ${pending.length} messages.`);
    while (pending.length) twitch.send(pending.shift());
  });
  
  twitch.on('message', (msg) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
  
  twitch.on('error', (e) => {
    console.error('Twitch Error:', e.message);
    if (client.readyState === WebSocket.OPEN) client.close();
  });
  
  client.on('error', (e) => console.error('Client Error:', e.message));
  
  client.on('close', (code) => {
    console.log(`Client disconnected. Code: ${code}`);
    if (twitch.readyState === WebSocket.OPEN) twitch.close();
  });
  
  twitch.on('close', (code, reason) => {
    console.log(`Twitch disconnected. Code: ${code}, Reason: ${reason.toString()}`);
    if (client.readyState === WebSocket.OPEN) client.close();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy listening on port ${PORT}`);
});