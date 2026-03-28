const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const safeBase = path.resolve(__dirname);
  let filePath = path.resolve(__dirname, req.url === '/' ? 'index.html' : req.url.slice(1));

  // Security: block path traversal
  if (!filePath.startsWith(safeBase)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extMap = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.ico':  'image/x-icon',
  };
  const ext = path.extname(filePath);
  const contentType = extMap[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// Track connected clients: Map<ws, { id, joinedAt }>
const clients = new Map();

// Shared state
let sharedUrl = '';

function generateId() {
  return 'user_' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client !== excludeWs) {
      client.send(msg);
    }
  });
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  const userId = generateId();
  clients.set(ws, { id: userId, joinedAt: Date.now() });
  const userCount = clients.size;

  console.log(`[WS] Client connected: ${userId} | Total clients: ${userCount}`);

  // Send this client their own ID + current shared URL + user count
  ws.send(JSON.stringify({
    type: 'init',
    userId,
    sharedUrl,
    userCount,
  }));

  // Notify others that user count changed
  broadcast({ type: 'user_count', userCount }, ws);

  // Notify this client that they joined
  broadcastAll({
    type: 'system',
    text: userCount === 1 ? 'You are connected. Waiting for the other user...' : `${userId} joined the session`,
    userCount,
  });

  // ── Handle incoming messages ──
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('[WS] Invalid JSON from client:', raw);
      return;
    }

    const client = clients.get(ws);
    if (!client) return;

    console.log(`[WS] Message from ${client.id}:`, data);

    switch (data.type) {
      // ── Chat message ──
      case 'chat': {
        const msg = {
          type: 'chat',
          senderId: client.id,
          text: data.text,
          timestamp: Date.now(),
        };
        console.log(`[WS] Chat → broadcast: "${data.text}" from ${client.id}`);
        // Echo back to sender (so they see their own message confirmed)
        ws.send(JSON.stringify({ ...msg, self: true }));
        // Send to others
        broadcast({ ...msg, self: false }, ws);
        break;
      }

      // ── URL sync ──
      case 'url_sync': {
        sharedUrl = data.url;
        console.log(`[WS] URL sync → "${sharedUrl}" from ${client.id}`);
        // Send to all OTHER clients
        broadcast({
          type: 'url_sync',
          url: sharedUrl,
          fromId: client.id,
        }, ws);
        break;
      }

      default:
        console.warn('[WS] Unknown message type:', data.type);
    }
  });

  // ── Handle disconnect ──
  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      console.log(`[WS] Client disconnected: ${client.id}`);
      clients.delete(ws);
      const userCount = clients.size;
      broadcastAll({
        type: 'system',
        text: `${client.id} left the session`,
        userCount,
      });
      broadcastAll({ type: 'user_count', userCount });
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket error:', err.message);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket ready on ws://localhost:${PORT}`);
  console.log('─'.repeat(40));
});
