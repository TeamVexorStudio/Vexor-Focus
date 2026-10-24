const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { db, CONFIG_DIR } = require('./db');

const BRIDGE_FILE = path.join(CONFIG_DIR, 'bridge.json');
const PROTOCOL_VERSION = 1;
const FIXED_PORT = 47891;
const DISCOVERY_PORT = 47890;

function loadOrCreateConfig() {
  // Clean up stale/invalid bridge.json that can block startup
  let cfg = null;
  try {
    const raw = fs.readFileSync(BRIDGE_FILE, 'utf8');
    cfg = JSON.parse(raw);
    if (cfg && typeof cfg === 'object' && cfg.token) {
      cfg.port = cfg.port || FIXED_PORT;
      // Validate port is sane
      if (typeof cfg.port !== 'number' || cfg.port < 1024 || cfg.port > 65535) {
        cfg = null;
      }
    } else {
      cfg = null;
    }
  } catch {
    cfg = null;
  }

  if (!cfg) {
    try { fs.unlinkSync(BRIDGE_FILE); } catch {}
    cfg = {
      port: FIXED_PORT,
      token: randomBytes(24).toString('hex'),
    };
    fs.writeFileSync(BRIDGE_FILE, JSON.stringify(cfg, null, 2));
  }

  return cfg;
}

function readBridgeConfig() {
  try {
    return JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function startBridge({ getFocusState, onFocusCommand, onClientCountChange }) {
  const baseCfg = loadOrCreateConfig();

  let wss = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = baseCfg.port + attempt;
    try {
      wss = await new Promise((resolve, reject) => {
        const server = new WebSocketServer({ host: '127.0.0.1', port });
        server.once('listening', () => resolve(server));
        server.once('error', reject);
      });
      baseCfg.port = port;
      fs.writeFileSync(BRIDGE_FILE, JSON.stringify(baseCfg, null, 2));
      break;
    } catch (err) {
      lastErr = err;
      wss = null;
    }
  }
  if (!wss) {
    console.error('[bridge] could not bind any port:', lastErr?.message);
    return null;
  }

  const cfg = baseCfg;
  const clients = new Set();

  const insertRow = db.prepare(`
    INSERT INTO activity (source, domain, title, started_at, focus_session_id)
    VALUES ('extension', ?, ?, ?, ?)
  `);
  const closeRow = db.prepare(`
    UPDATE activity SET ended_at = ?, duration_ms = ? WHERE id = ?
  `);
  const touchRow = db.prepare(`
    UPDATE activity SET duration_ms = ? WHERE id = ?
  `);

  let openWeb = null;

  function notifyCount() {
    try { onClientCountChange?.(clients.size); } catch {}
  }

  wss.on('connection', (ws) => {
    let authed = false;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (!authed) {
        if (msg.type !== 'hello' || msg.token !== cfg.token) {
          ws.send(JSON.stringify({ type: 'error', error: 'bad-token' }));
          ws.close();
          return;
        }
        authed = true;
        clients.add(ws);
        notifyCount();
        ws.send(JSON.stringify({
          type: 'welcome',
          version: PROTOCOL_VERSION,
          focus: getFocusState(),
        }));
        return;
      }

      if (msg.type === 'web') {
        const now = Date.now();
        const key = `${msg.domain}|${msg.title}`;
        if (!openWeb || openWeb.key !== key) {
          if (openWeb) closeRow.run([now, now - openWeb.startedAt, openWeb.id]);
          const info = insertRow.run([
            msg.domain || null,
            msg.title || null,
            now,
            getFocusState().sessionId,
          ]);
          openWeb = { id: Number(info.lastInsertRowid), key, startedAt: now };
        } else {
          // Same tab — update duration so long single-tab sessions are recorded accurately
          touchRow.run([now - openWeb.startedAt, openWeb.id]);
        }
      } else if (msg.type === 'focus-command') {
        try { onFocusCommand(msg.command); } catch (err) {
          console.error('[bridge] focus-command failed:', err.message);
        }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (authed) notifyCount();
      if (openWeb) {
        const now = Date.now();
        closeRow.run([now, now - openWeb.startedAt, openWeb.id]);
        openWeb = null;
      }
    });
  });

  function broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  // Discovery server — lets the extension auto-configure
  const discovery = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    if (!origin.startsWith('chrome-extension://')) {
      res.writeHead(403).end();
      return;
    }
    if (req.url !== '/discover') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    });
    res.end(JSON.stringify({
      port: cfg.port,
      token: cfg.token,
      version: PROTOCOL_VERSION,
    }));
  });
  discovery.on('error', (err) => {
    console.warn('[bridge] discovery server failed:', err.message);
  });
  discovery.listen(DISCOVERY_PORT, '127.0.0.1', () => {
    console.log(`[bridge] discovery listening on 127.0.0.1:${DISCOVERY_PORT}`);
  });

  console.log(`[bridge] listening on 127.0.0.1:${cfg.port}`);

  return {
    port: cfg.port,
    token: cfg.token,
    broadcast,
    close: () => {
      try { discovery.close(); } catch {}
      try { wss.close(); } catch {}
    },
  };
}

module.exports = { startBridge, readBridgeConfig };
