# Vexor Focus

Local-first Pomodoro timer and computer usage tracker. Desktop app for Windows + Chrome extension. Everything stays on your machine — no accounts, no cloud sync, no telemetry.

## What it does

- **Pomodoro timer** — Focus / Short Break / Long Break cycles with auto-start, custom durations, and round tracking.
- **Usage tracking** — Records which app or browser tab you're using and for how long. Data is categorized as productive / neutral / distracting via match rules you control.
- **Browser blocking** — While a Focus session is running in Work mode, sites on your blocklist get blocked in Chrome via declarativeNetRequest.
- **Extension pairing** — The desktop app exposes a local WebSocket bridge; the Chrome extension connects to it to receive timer state and send active-tab reports. Auto-discovery on `127.0.0.1:47890`.

## Architecture

```
apps/
  desktop/          Electron app (main process + renderer)
    src/main/       db, tracker, bridge, focus, preload
    src/renderer/   index.html (UI + logic inline)
  extension/        Chrome extension (manifest v3)
    background.js   service worker
    popup.html/js   popup UI
packages/           shared libraries (currently empty)
```

- **Database**: `node-sqlite3-wasm` SQLite file at `%APPDATA%\TeamVexor\vexor.db` (Windows) or `~/.config/TeamVexor/vexor.db` (other).
- **Bridge**: Local WebSocket server (`ws`) on `127.0.0.1`, port `47891` by default (plus a discovery HTTP server on `47890`). Token-based auth in `bridge.json`.
- **Tracker**: Polls `active-win` every second for desktop windows; extension reports active tab every 30s via alarms.
- **Idle detection**: `powerMonitor.getSystemIdleTime()` — activity paused after 60s of system idle.

## Getting started

### Desktop app

```bash
cd apps/desktop
npm install
npm start
```

Requires Node.js and a Windows build of `active-win` (native module).

### Chrome extension

1. Open `chrome://extensions` → enable Developer mode.
2. Click "Load unpacked" and select `apps/extension`.
3. In the desktop app, go to Settings → Browser extension and copy the Port and Token.
4. In the extension popup, paste them and click **Pair** (or leave blank for auto-discovery).

## Data location

| Item | Path |
|------|------|
| SQLite DB | `%APPDATA%\TeamVexor\vexor.db` |
| Bridge config | `%APPDATA%\TeamVexor\bridge.json` |
| Lock files | `%APPDATA%\TeamVexor\vexor.db.lock/` (cleaned on startup) |

All data is local and deletable. Use **Settings → Delete all data** in the app, or delete the DB file directly.

## Offline

This project runs fully offline. The bridge is `127.0.0.1`-only. The extension's only network call is the local discovery endpoint. No external services are contacted.

## Privacy

- No accounts, no sign-in, no analytics, no telemetry.
- Window titles and domains are stored only on this machine.
- You can disable title tracking in Settings to log app names only.

## Built with

- Electron
- Chrome Extension API (Manifest V3)
- node-sqlite3-wasm
- active-win
- ws
