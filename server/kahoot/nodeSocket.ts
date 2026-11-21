/* KAHOOT BOSS — Node WebSocket adapter for the isomorphic Bayeux client.
   Node-only (imports the `ws` package): imported by the connector and the
   test suite, never by browser bundles. */

import WebSocket from 'ws';
import type { BayeuxSocket, WsFactory } from './bayeux';

class NodeSocket implements BayeuxSocket {
  private readonly ws: WebSocket;

  constructor(url: string, userAgent: string) {
    this.ws = new WebSocket(url, { headers: { 'User-Agent': userAgent } });
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  onOpen(fn: () => void): void {
    this.ws.on('open', fn);
  }

  onMessage(fn: (data: string) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.ws.on('message', (data: any) => fn(String(data)));
  }

  onClose(fn: (code: number, reason: string) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.ws.on('close', (code: number, reason: any) => fn(code, String(reason ?? '')));
  }

  onError(fn: (err: Error) => void): void {
    this.ws.on('error', (err) => fn(err instanceof Error ? err : new Error(String(err))));
  }
}

export const createNodeSocket: WsFactory = (url, userAgent) => new NodeSocket(url, userAgent);
