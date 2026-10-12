const REPORT_MS = 2000;
const RECONNECT_MIN = 2000;
const RECONNECT_MAX = 30000;

let socket = null;
let focusState = null;
let reconnectDelay = RECONNECT_MIN;
let reconnectTimer = null;

async function getConfig() {
  const { bridge } = await chrome.storage.local.get('bridge');
  return bridge || null;
}

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function scheduleReconnect() {
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    connect();
  }, reconnectDelay);
}

async function tryDiscovery() {
  const { bridge } = await chrome.storage.local.get('bridge');
  if (bridge?.port && bridge?.token) return false;

  try {
    const res = await fetch('http://127.0.0.1:47890/discover');
    if (!res.ok) return false;
    const cfg = await res.json();
    if (!cfg.port || !cfg.token) return false;
    await chrome.storage.local.set({ bridge: { port: cfg.port, token: cfg.token } });
    console.log('[vexor] auto-discovered bridge on port', cfg.port);
    return true;
  } catch {
    return false;
  }
}

async function connect() {
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  const cfg = await getConfig();
  if (!cfg?.port || !cfg?.token) return;

  try {
    socket = new WebSocket(`ws://127.0.0.1:${cfg.port}`);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectDelay = RECONNECT_MIN;
    const hello = JSON.stringify({ type: 'hello', token: cfg.token, version: 1 });

    const trySend = (attempt = 0) => {
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(hello); } catch (err) {
          console.warn('[vexor] hello send failed:', err.message);
        }
        return;
      }
      if (attempt < 10) {
        setTimeout(() => trySend(attempt + 1), 25);
      } else {
        console.warn('[vexor] gave up sending hello — socket never opened');
        try { socket.close(); } catch {}
      }
    };
    trySend();
  };

  socket.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'welcome' || msg.type === 'focus') {
      focusState = msg.focus ?? null;
      chrome.storage.local.set({ focusState });
      updateBadge();
      applyBlocking();
      chrome.runtime.sendMessage({ type: 'focus-update', focus: focusState }).catch(() => {});
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    try { socket?.close(); } catch {}
  };
}

async function disconnect() {
  clearReconnect();
  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }
}

async function hardDisconnect() {
  await disconnect();
  focusState = null;
  await chrome.storage.local.remove(['focusState', 'bridge']);
  updateBadge();
  applyBlocking();
  chrome.runtime.sendMessage({ type: 'focus-update', focus: null }).catch(() => {});
}

async function reportActiveTab() {
  if (!socket || socket.readyState !== 1) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    let domain;
    try { domain = new URL(tab.url).hostname; } catch { return; }
    socket.send(JSON.stringify({
      type: 'web', domain, title: tab.title || '', ts: Date.now(),
    }));
  } catch {}
}

function updateBadge() {
  if (focusState?.running) {
    const mins = Math.ceil(focusState.remainingMs / 60000);
    chrome.action.setBadgeText({ text: String(mins) });
    chrome.action.setBadgeBackgroundColor({
      color: focusState.mode === 'work' ? '#39ff14' : '#00bfff',
    });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function applyBlocking() {
  const blocking = focusState?.running && focusState?.mode === 'work';
  const { blocklist = [] } = await chrome.storage.local.get('blocklist');
  const rules = blocking
    ? blocklist.map((domain, i) => ({
        id: i + 1,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: `||${domain}^`, resourceTypes: ['main_frame'] },
      }))
    : [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'reconnect') {
    disconnect().then(connect);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'disconnect') {
    hardDisconnect().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'focus-command') {
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({ type: 'focus-command', command: msg.command }));
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'not-connected' });
    }
    return true;
  }
  if (msg.type === 'get-focus') {
    sendResponse({ focus: focusState });
    return true;
  }
});

chrome.alarms.create('report', { periodInMinutes: REPORT_MS / 60000 });
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'report') reportActiveTab();
  if (a.name === 'keepalive') {
    const { bridge } = await chrome.storage.local.get('bridge');
    if (!bridge?.port) await tryDiscovery();
    if (!socket || socket.readyState > 1) connect();
    else reportActiveTab();
  }
});

chrome.tabs.onActivated.addListener(reportActiveTab);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') reportActiveTab();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

(async () => {
  await tryDiscovery();
  connect();
})();