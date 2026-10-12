const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const { db } = require('./db');
const { startTracker } = require('./tracker');
const { startBridge, readBridgeConfig } = require('./bridge');
const { Focus } = require('./focus');

app.setAppUserModelId('studio.teamvexor.focus');
app.isQuitting = false;

const focus = new Focus();
let win = null;
let tray = null;
let tracker = null;
let bridge = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#0a0c10',
    title: 'Vexor Focus',
    icon: path.join(__dirname, '../../team-vexor.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../team-vexor.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Vexor Focus');
  tray.on('click', () => {
    if (!win || win.isDestroyed()) return;
    win.isVisible() ? win.hide() : win.show();
  });

  focus.on('change', (state) => {
    const mins = Math.ceil(state.remainingMs / 60000);
    tray.setToolTip(`Vexor Focus — ${state.label}${state.running ? ` (${mins}m)` : ''}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `${state.label}${state.running ? ` — ${mins}m left` : ''}`, enabled: false },
      { type: 'separator' },
      { label: state.running ? 'Pause' : 'Start', click: () => focus.toggle() },
      { label: 'Reset', click: () => focus.reset() },
      { label: 'Skip', click: () => focus.skip() },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => { win?.show(); win?.focus(); } },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    bridge?.broadcast({ type: 'focus', focus: state });
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('focus:state', state); } catch {}
    }
  });
}

function wireIpc() {
  ipcMain.handle('focus:get', () => focus.getState());
  ipcMain.handle('focus:toggle', () => { focus.toggle(); return focus.getState(); });
  ipcMain.handle('focus:reset', () => { focus.reset(); return focus.getState(); });
  ipcMain.handle('focus:skip', () => { focus.skip(); return focus.getState(); });
  ipcMain.handle('focus:set-mode', (_e, mode) => {
    focus.setMode(mode);
    return focus.getState();
  });

  ipcMain.handle('settings:get', () => focus.settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    focus.saveSettings(patch);
    return focus.settings;
  });

  ipcMain.handle('bridge:info', () => {
    const cfg = readBridgeConfig();
    if (!cfg || !cfg.port) return { port: null, token: null };
    return { port: cfg.port, token: cfg.token };
  });

  ipcMain.handle('categories:get', () =>
    db.prepare(`SELECT match, category, productive FROM categories`).all()
  );

  ipcMain.handle('categories:set', (_e, rows) => {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM categories').run();
      const ins = db.prepare('INSERT INTO categories (match, category, productive) VALUES (?, ?, ?)');
      for (const r of rows) {
        ins.run([r.match, r.category, r.category === 'productive' ? 1 : 0]);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return true;
  });

  ipcMain.handle('stats:range', (_e, { from, to }) => {
    return db.prepare(`
      SELECT source, app, domain, SUM(duration_ms) AS ms, COUNT(*) AS visits
      FROM activity
      WHERE started_at >= ? AND started_at < ?
      GROUP BY source, app, domain
      ORDER BY ms DESC
    `).all([from, to]);
  });

  ipcMain.handle('stats:timeline', (_e, { from, to }) => {
    return db.prepare(`
      SELECT id, source, app, domain, title, started_at, duration_ms, idle, focus_session_id
      FROM activity
      WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL
      ORDER BY started_at
    `).all([from, to]);
  });

  ipcMain.handle('data:wipe', () => {
    db.exec(`
      DELETE FROM activity;
      DELETE FROM focus_sessions;
      DELETE FROM categories;
    `);
    return true;
  });
}

app.whenReady().then(async () => {
  createWindow();

  try {
    wireIpc();
  } catch (err) {
    console.error('[main] wireIpc failed:', err);
  }

  createTray();

  tracker = startTracker({
    getFocusSessionId: () => focus.getState().sessionId,
  });
  tracker.start();

  try {
    bridge = await startBridge({
      getFocusState: () => focus.getState(),
      onFocusCommand: (command) => {
        if (command === 'toggle') focus.toggle();
        else if (command === 'reset') focus.reset();
        else if (command === 'skip') focus.skip();
        else if (command === 'set-mode-work') focus.setMode('work');
        else if (command === 'set-mode-short') focus.setMode('short');
        else if (command === 'set-mode-long') focus.setMode('long');
      },
      onClientCountChange: (count) => {
        if (win && !win.isDestroyed()) {
          try { win.webContents.send('bridge:status', { paired: count > 0, clients: count }); } catch {}
        }
      },
    });

    if (bridge) {
      console.log(`[main] bridge ready on port ${bridge.port}`);
    } else {
      console.error('[main] bridge failed to start — no port bound');
    }
  } catch (err) {
    console.error('[main] startBridge threw:', err);
    bridge = null;
  }

  app.on('activate', () => win?.show());
});

app.on('before-quit', () => {
  app.isQuitting = true;
  tracker?.stop();
  bridge?.close();
  try { db.close(); } catch {}
});

app.on('window-all-closed', (e) => e.preventDefault());