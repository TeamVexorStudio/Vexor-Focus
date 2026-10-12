# Vexor Focus

A local-first activity tracker and Pomodoro timer for Windows and Chrome.
Built by Team Vexor Studio.

![Team Vexor](images/team-vexor.png)

## What it does
- Pomodoro timer with focus/short/long break cycles
- Tracks which app and site is active, all day
- Categorizes activity as productive / neutral / distracting
- Browser extension blocks sites during focus sessions
- Day timeline, top activity, and per-category totals

## Architecture
- `apps/desktop` — Electron app (Windows). The brain: tracking, storage, timer state, bridge server.
- `apps/extension` — Chrome MV3. Sensor (reports active tab) and enforcer (blocks sites).
- `packages/core` — shared bridge protocol and category logic.
- The desktop app runs a WebSocket server on `127.0.0.1`. The extension connects with a token shown in Settings.

## Privacy
- All data stays on your machine (`%APPDATA%\TeamVexor\vexor.db`).
- No telemetry, no accounts, no cloud sync.
- Window titles are optional. Full URLs are never logged - only domains.
- Nothing is captured while the app is paused, and there's a delete-all button.

## Troubleshooting

**App window opens but extension says "connecting…" forever**
- Make sure only one copy of the app is running. Closing the window hides to
  tray — check Task Manager for stray "Electron" or "Vexor Focus" processes.
- Check `%APPDATA%\TeamVexor\bridge.json` — the port there should match what
  the extension popup has.
- In the extension's service worker console, clear stale config:
  `chrome.storage.local.remove('bridge')`
- The desktop terminal should always show
  `[bridge] listening on 127.0.0.1:<port>` at startup. If it doesn't, the
  port range is blocked by a ghost instance.

**`Attempted to register a second handler for '<channel>'`**
- You have a duplicate `ipcMain.handle(...)` in `main.js`. Remove one.

**Stats tab shows "No handler registered"**
- You're missing an `ipcMain.handle('stats:...')` in `wireIpc()`.

## Development
```bash
pnpm install
pnpm --filter @team-vexor/desktop rebuild   # native deps
pnpm --filter @team-vexor/desktop start