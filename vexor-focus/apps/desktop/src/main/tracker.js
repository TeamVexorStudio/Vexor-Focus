const { powerMonitor } = require('electron');
const { db } = require('./db');

const POLL_MS = 1000;
const IDLE_AFTER_SEC = 60;

const insertRow = db.prepare(`
  INSERT INTO activity (source, app, domain, title, started_at, focus_session_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const closeRow = db.prepare(`
  UPDATE activity SET ended_at = ?, duration_ms = ?, idle = ? WHERE id = ?
`);

// Update the duration of the currently-open row without closing it
const touchRow = db.prepare(`
  UPDATE activity SET duration_ms = ? WHERE id = ?
`);

function startTracker({ getFocusSessionId }) {
  let activeWin = null;
  let open = null;
  let idleSince = null;
  let timer = null;

  (async () => {
    try {
      activeWin = (await import('active-win')).default;
    } catch (err) {
      console.error('[tracker] active-win unavailable:', err.message);
    }
  })();

  function closeOpen(endedAt, idle) {
    if (!open) return;
    closeRow.run([endedAt, endedAt - open.startedAt, idle ? 1 : 0, open.id]);
    open = null;
  }

  function openNew(sample, now) {
    const info = insertRow.run([
      sample.source,
      sample.app ?? null,
      sample.domain ?? null,
      sample.title ?? null,
      now,
      getFocusSessionId(),
    ]);
    open = { id: Number(info.lastInsertRowid), key: sample.key, startedAt: now };
  }

  async function poll() {
    const now = Date.now();
    const idleSec = powerMonitor.getSystemIdleTime();
    const isIdle = idleSec >= IDLE_AFTER_SEC;

    if (isIdle) {
      if (!idleSince) idleSince = now - idleSec * 1000;
      closeOpen(now, true);
      return;
    }
    idleSince = null;

    if (!activeWin) return;

    let win = null;
    try {
      win = await activeWin();
    } catch {
      return;
    }
    if (!win || !win.owner) {
      closeOpen(now, false);
      return;
    }

    const sample = {
      source: 'desktop',
      app: win.owner.name || 'unknown',
      domain: null,
      title: win.title || null,
      key: `desktop|${win.owner.name}|${win.title}`,
    };

    if (open && open.key === sample.key) {
      // Same window — update duration so long single-window sessions are recorded accurately
      touchRow.run([now - open.startedAt, open.id]);
      return;
    }
    closeOpen(now, false);
    openNew(sample, now);
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      poll().catch((err) => console.error('[tracker]', err.message));
    }, POLL_MS);
    poll().catch((err) => console.error('[tracker]', err.message));
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    closeOpen(Date.now(), false);
  }

  return { start, stop };
}

module.exports = { startTracker };
