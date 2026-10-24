const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { db } = require('./db');

const DEFAULTS = { work: 25, short: 5, long: 15, interval: 4, autoStart: true, startOnLogin: false };
const LABELS = { work: 'Focus', short: 'Short Break', long: 'Long Break' };

class Focus extends EventEmitter {
  constructor() {
    super();
    this.settings = this.#loadSettings();
    this.mode = 'work';
    this.totalMs = this.settings.work * 60000;
    this.deadline = 0;
    this.running = false;
    this.remainingMs = this.totalMs;
    this.sessionId = null;
    this.roundsDone = 0;
    this.timer = null;
  }

  #loadSettings() {
    const row = db().prepare(`SELECT value FROM meta WHERE key = 'settings'`).get();
    if (!row) return { ...DEFAULTS };
    try { return { ...DEFAULTS, ...JSON.parse(row.value) }; }
    catch { return { ...DEFAULTS }; }
  }

  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    db().prepare(`
      INSERT INTO meta (key, value) VALUES ('settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run([JSON.stringify(this.settings)]);
    if (!this.running) {
      this.totalMs = this.settings[this.mode] * 60000;
      this.remainingMs = this.totalMs;
    }
    this.#emit();
  }

  getState() {
    const ms = this.running ? Math.max(0, this.deadline - Date.now()) : this.remainingMs;
    return {
      mode: this.mode,
      label: LABELS[this.mode],
      running: this.running,
      remainingMs: ms,
      totalMs: this.totalMs,
      roundsDone: this.roundsDone % this.settings.interval,
      interval: this.settings.interval,
      sessionId: this.sessionId,
    };
  }

  setMode(next) {
    if (!['work', 'short', 'long'].includes(next)) return;
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.#endSession(false);
    this.mode = next;
    this.totalMs = this.settings[next] * 60000;
    this.remainingMs = this.totalMs;
    this.sessionId = null;
    this.#emit();
  }

  start() {
    if (this.running) return;
    if (this.remainingMs <= 0) this.remainingMs = this.totalMs;

    if (!this.sessionId) {
      this.sessionId = randomUUID();
      db().prepare(`
        INSERT INTO focus_sessions (id, mode, planned_ms, started_at)
        VALUES (?, ?, ?, ?)
      `).run([this.sessionId, this.mode, this.totalMs, Date.now()]);
    }

    this.deadline = Date.now() + this.remainingMs;
    this.running = true;
    this.timer = setInterval(() => this.#tick(), 250);
    this.#emit();
  }

  pause() {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.deadline - Date.now());
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this.#emit();
  }

  toggle() { this.running ? this.pause() : this.start(); }

  reset() {
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.remainingMs = this.totalMs;
    this.#endSession(false);
    this.#emit();
  }

  skip() { this.#advance(false); }

  #tick() {
    if (!this.running) return;
    if (this.deadline - Date.now() <= 0) {
      this.remainingMs = 0;
      this.#advance(true);
      return;
    }
    this.#emit();
  }

  #advance(completed) {
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.#endSession(completed);

    if (completed && this.mode === 'work') this.roundsDone++;

    let next;
    if (this.mode === 'work') {
      const due = this.roundsDone > 0 && this.roundsDone % this.settings.interval === 0;
      next = due ? 'long' : 'short';
    } else {
      if (this.mode === 'long') this.roundsDone = 0;
      next = 'work';
    }

    this.mode = next;
    this.totalMs = this.settings[next] * 60000;
    this.remainingMs = this.totalMs;
    this.sessionId = null;

    if (completed) {
      this.emit('session-complete', { mode: next, label: LABELS[next] });
      if (this.settings.autoStart) this.start();
      else this.#emit();
    } else {
      this.#emit();
    }
  }

  #endSession(completed) {
    if (!this.sessionId) return;
    db().prepare(`
      UPDATE focus_sessions SET ended_at = ?, completed = ? WHERE id = ?
    `).run([Date.now(), completed ? 1 : 0, this.sessionId]);
  }

  #emit() { this.emit('change', this.getState()); }
}

module.exports = { Focus, LABELS };
