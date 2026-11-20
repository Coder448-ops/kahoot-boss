/* KAHOOT BOSS — minimal Bayeux (CometD) client over WebSocket.
   Implements exactly what the Kahoot player flow needs: handshake, the
   /meta/connect long-poll heartbeat loop, subscribe, publish and disconnect.
   Every wait has a timeout; every failure is reported, never masked. */

import WebSocket from 'ws';

export interface BayeuxMessage {
  id?: string;
  channel: string;
  clientId?: string;
  successful?: boolean;
  error?: string;
  advice?: { reconnect?: string; timeout?: number; interval?: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  subscription?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type BayeuxState = 'idle' | 'connecting' | 'handshaking' | 'connected' | 'closed' | 'failed';

export interface BayeuxOptions {
  handshakeTimeoutMs: number;
  connectTimeoutMs: number;
  userAgent: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class BayeuxClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private clientId: string | null = null;
  private state: BayeuxState = 'idle';
  private connectTimer: NodeJS.Timeout | null = null;
  private lastConnectSentAt = 0;
  private lastRttMs = 0;
  private destroyed = false;
  private handshakeDone = false;

  private messageHandlers = new Set<(channel: string, msg: BayeuxMessage) => void>();
  private closeHandlers = new Set<(info: { code: number; reason: string; unexpected: boolean }) => void>();
  private errorHandlers = new Set<(err: Error) => void>();

  constructor(private readonly opts: BayeuxOptions) {}

  onMessage(fn: (channel: string, msg: BayeuxMessage) => void): () => void {
    this.messageHandlers.add(fn);
    return () => this.messageHandlers.delete(fn);
  }

  onClose(fn: (info: { code: number; reason: string; unexpected: boolean }) => void): () => void {
    this.closeHandlers.add(fn);
    return () => this.closeHandlers.delete(fn);
  }

  onError(fn: (err: Error) => void): () => void {
    this.errorHandlers.add(fn);
    return () => this.errorHandlers.delete(fn);
  }

  getState(): BayeuxState {
    return this.state;
  }

  getClientId(): string | null {
    return this.clientId;
  }

  getLastRttMs(): number {
    return this.lastRttMs;
  }

  private nextId(): string {
    this.msgId += 1;
    return String(this.msgId);
  }

  private send(messages: BayeuxMessage[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Cannot send: WebSocket is not open.');
    }
    this.ws.send(JSON.stringify(messages));
  }

  async connect(url: string): Promise<void> {
    if (this.state === 'connecting' || this.state === 'handshaking' || this.state === 'connected') {
      throw new Error('Bayeux client is already active.');
    }
    this.destroyed = false;
    this.state = 'connecting';

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(url, { headers: { 'User-Agent': this.opts.userAgent } });
        this.ws = ws;
        ws.on('open', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        ws.on('message', (data) => this.handleFrame(String(data)));
        ws.on('close', (code, reason) => this.handleClose(code, String(reason ?? '')));
        ws.on('error', (err) => {
          this.errorHandlers.forEach((fn) => {
            try { fn(err instanceof Error ? err : new Error(String(err))); } catch { /* listener crash-proof */ }
          });
          if (!settled) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      }),
      this.opts.connectTimeoutMs,
      `WebSocket connection timed out after ${this.opts.connectTimeoutMs} ms.`,
    );
  }

  /** Full handshake + start of the /meta/connect heartbeat loop. */
  async handshake(): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Cannot handshake: WebSocket is not open.');
    this.state = 'handshaking';
    const id = this.nextId();

    const done = new Promise<string>((resolve, reject) => {
      const off = this.onMessage((channel, msg) => {
        if (channel !== '/meta/handshake') return;
        if (msg.id !== id) return;
        off();
        if (msg.successful && msg.clientId) {
          this.clientId = msg.clientId;
          this.handshakeDone = true;
          this.state = 'connected';
          resolve(msg.clientId);
        } else {
          this.state = 'failed';
          reject(new Error(`Bayeux handshake rejected${msg.error ? `: ${msg.error}` : ''}.`));
        }
      });
    });

    this.send([
      {
        id,
        channel: '/meta/handshake',
        version: '1.0',
        minimumVersion: '1.0',
        supportedConnectionTypes: ['websocket'],
        advice: { timeout: 60000, interval: 0 },
      },
    ]);

    const clientId = await withTimeout(
      done,
      this.opts.handshakeTimeoutMs,
      `Bayeux handshake timed out after ${this.opts.handshakeTimeoutMs} ms.`,
    );
    this.pumpConnect();
    return clientId;
  }

  /** The heartbeat: exactly one outstanding /meta/connect at a time. */
  private pumpConnect(): void {
    if (this.destroyed || !this.handshakeDone || !this.clientId) return;
    if (this.connectTimer) return; // one outstanding at a time
    try {
      this.lastConnectSentAt = Date.now();
      this.send([{ id: this.nextId(), channel: '/meta/connect', clientId: this.clientId, connectionType: 'websocket' }]);
    } catch {
      return; // socket closing; close handler will report
    }
    // Safety net: if the server never answers a connect, surface it instead of hanging.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.destroyed && this.handshakeDone) {
        this.errorHandlers.forEach((fn) => {
          try { fn(new Error('Heartbeat (/meta/connect) timed out — the game server stopped responding.')); } catch { /* noop */ }
        });
        this.destroy(1013, 'heartbeat timeout');
      }
    }, 90000);
    this.connectTimer.unref?.();
  }

  private onConnectReply(msg: BayeuxMessage): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.lastConnectSentAt > 0) {
      this.lastRttMs = Date.now() - this.lastConnectSentAt;
      this.lastConnectSentAt = 0;
    }
    const advice = msg.advice?.reconnect;
    if (msg.successful === false || advice === 'none') {
      this.destroy(1012, 'server refused to continue the session (reconnect:none)');
      return;
    }
    if (advice === 'handshake') {
      // Re-handshake once, then fail honestly rather than looping forever.
      this.handshakeDone = false;
      this.handshake().catch((e: Error) => {
        this.errorHandlers.forEach((fn) => {
          try { fn(e instanceof Error ? e : new Error(String(e))); } catch { /* noop */ }
        });
      });
      return;
    }
    // Normal case: immediately queue the next heartbeat.
    setImmediate(() => this.pumpConnect());
  }

  async subscribe(channels: string[]): Promise<void> {
    if (!this.clientId) throw new Error('Cannot subscribe before handshake.');
    this.send(channels.map((subscription) => ({ id: this.nextId(), channel: '/meta/subscribe', clientId: this.clientId!, subscription })));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publish(channel: string, data: any): void {
    if (!this.clientId) throw new Error('Cannot publish before handshake.');
    this.send([{ id: this.nextId(), channel, clientId: this.clientId, data }]);
  }

  private handleFrame(frame: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      return; // ignore non-JSON frames
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const raw of messages) {
      const msg = raw as BayeuxMessage;
      if (!msg || typeof msg.channel !== 'string') continue;
      if (msg.channel === '/meta/connect') {
        this.onConnectReply(msg);
        continue;
      }
      this.messageHandlers.forEach((fn) => {
        try { fn(msg.channel, msg); } catch { /* listener crash-proof */ }
      });
    }
  }

  private handleClose(code: number, reason: string): void {
    const wasUnexpected = !this.destroyed && (this.state === 'connected' || this.state === 'handshaking' || this.state === 'connecting');
    this.state = 'closed';
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.closeHandlers.forEach((fn) => {
      try { fn({ code, reason, unexpected: wasUnexpected }); } catch { /* noop */ }
    });
  }

  /** Graceful disconnect: /meta/disconnect + socket close. */
  async disconnect(reason = 'client disconnect'): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.clientId) {
        this.send([{ id: this.nextId(), channel: '/meta/disconnect', clientId: this.clientId }]);
      }
    } catch { /* best effort */ }
    try {
      this.ws?.close(1000, reason);
    } catch { /* best effort */ }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private destroy(code: number, reason: string): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.ws?.close(code, reason);
    } catch { /* best effort */ }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
}
