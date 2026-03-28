const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ─── HTTP SERVER ─────────────────────────────────────
const server = http.createServer((req, res) => {
  const safeBase = path.resolve(__dirname);
  let filePath = path.resolve(
    __dirname,
    req.url === '/' ? 'index.html' : req.url.slice(1)
  );

  if (!filePath.startsWith(safeBase)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const extMap = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
  };

  const ext = path.extname(filePath);
  const contentType = extMap[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── WEBSOCKET ─────────────────────────────────────
const wss = new WebSocketServer({ server });

const clients = new Map();
let sharedUrl = '';

function generateId() {
  return 'user_' + Math.random().toString(36).slice(2, 8);
}

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === 1 && c !== exclude) {
      c.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  const userId = generateId();
  clients.set(ws, userId);

  console.log('Connected:', userId);

  ws.send(JSON.stringify({
    type: 'init',
    userId,
    sharedUrl
  }));

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const sender = clients.get(ws);

    // CHAT
    if (data.type === 'chat') {
      const msg = {
        type: 'chat',
        text: data.text,
        senderId: sender
      };

      // sender ko bhi
      ws.send(JSON.stringify({ ...msg, self: true }));

      // others ko
      broadcast({ ...msg, self: false }, ws);
    }

    // URL SYNC
    if (data.type === 'url_sync') {
      sharedUrl = data.url;

      broadcast({
        type: 'url_sync',
        url: sharedUrl
      }, ws);
    }
  });

  ws.on('close', () => {
    console.log('Disconnected:', clients.get(ws));
    clients.delete(ws);
  });
});

// ─── START ─────────────────────────────────────
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
