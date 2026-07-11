// WebSocket client (§2.4) — the renderer is the CLIENT; the mod is the server, so we
// reconnect freely without restarting GD. Messages are newline-delimited JSON; a single
// frame may carry several lines, so split on '\n'.

import { WS_URL, MSG } from '../../shared/protocol.js';

export class TapClient {
  constructor(url = WS_URL, handlers = {}) {
    this.url = url;
    this.h = handlers;          // { onTick, onLevelStart, onReset, onPause, onResume, onLevelEnd, onStatus }
    this.ws = null;
    this.retryMs = 500;
    this._stopped = false;
  }

  connect() {
    this._stopped = false;
    this._open();
  }

  stop() {
    this._stopped = true;
    if (this.ws) this.ws.close();
  }

  _open() {
    this._status('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      return this._scheduleRetry();
    }
    this.ws = ws;

    ws.onopen = () => { this.retryMs = 500; this._status('connected'); };
    ws.onclose = () => { this._status('disconnected'); this._scheduleRetry(); };
    ws.onerror = () => { /* onclose will follow */ };
    ws.onmessage = (ev) => this._onData(ev.data);
  }

  _scheduleRetry() {
    if (this._stopped) return;
    setTimeout(() => this._open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 5000); // capped exponential backoff
  }

  _onData(data) {
    for (const line of String(data).split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let msg;
      try { msg = JSON.parse(s); } catch { continue; } // drop malformed lines silently
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    switch (msg.t) {
      case MSG.TICK:        this.h.onTick?.(msg); break;
      case MSG.LEVEL_START: this.h.onLevelStart?.(msg); break;
      case MSG.RESET:       this.h.onReset?.(msg); break;   // renderer must flush + re-seek
      case MSG.PAUSE:       this.h.onPause?.(msg); break;
      case MSG.RESUME:      this.h.onResume?.(msg); break;
      case MSG.LEVEL_END:   this.h.onLevelEnd?.(msg); break;
      default: break;
    }
  }

  _status(s) { this.h.onStatus?.(s); }
}
