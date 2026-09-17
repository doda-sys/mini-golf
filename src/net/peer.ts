import Peer, { type DataConnection } from 'peerjs';
import type { NetMessage, PlayerInfo } from '../types';

const PREFIX = 'minigolf-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

export function peerIdFromCode(code: string): string {
  return PREFIX + code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type NetHandlers = {
  onOpen: (peerId: string, isHost: boolean) => void;
  onError: (msg: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onMessage: (msg: NetMessage, fromId: string) => void;
  onPeerJoined: (peerId: string) => void;
  onPeerLeft: (peerId: string) => void;
};

/**
 * PeerJS room sync:
 * - Host creates Peer with id = minigolf-{CODE}
 * - Guests join with random peer id and connect to host peer id
 * - Host relays state; turn-based putts broadcast to all
 */
export class GolfNet {
  peer: Peer | null = null;
  isHost = false;
  roomCode = '';
  localPeerId = '';
  private conns = new Map<string, DataConnection>();
  private handlers: NetHandlers;
  private hostConn: DataConnection | null = null;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  async createRoom(code?: string): Promise<string> {
    this.destroy();
    this.isHost = true;
    this.roomCode = (code ?? generateRoomCode(5)).toUpperCase();
    const id = peerIdFromCode(this.roomCode);
    await this.openPeer(id);
    return this.roomCode;
  }

  async joinRoom(code: string): Promise<void> {
    this.destroy();
    this.isHost = false;
    this.roomCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.roomCode.length < 4 || this.roomCode.length > 6) {
      throw new Error('Room code must be 4–6 characters');
    }
    await this.openPeer(); // random id
    const hostId = peerIdFromCode(this.roomCode);
    const conn = this.peer!.connect(hostId, { reliable: true });
    this.wireConn(conn);
    this.hostConn = conn;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Could not reach room. Check the code and try again.')), 12000);
      conn.on('open', () => {
        clearTimeout(t);
        this.handlers.onConnectionChange(true);
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  private openPeer(id?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id) : new Peer();
      this.peer = peer;
      const fail = (err: Error) => {
        this.handlers.onError(err.message || String(err));
        reject(err);
      };
      peer.on('open', (pid) => {
        this.localPeerId = pid;
        this.handlers.onOpen(pid, this.isHost);
        resolve();
      });
      peer.on('error', (err) => {
        const msg = (err as { type?: string; message?: string }).message || String(err);
        const type = (err as { type?: string }).type;
        if (type === 'unavailable-id') {
          fail(new Error('That room code is taken — try Create again.'));
        } else if (type === 'peer-unavailable') {
          fail(new Error('Room not found. Ask the host for the code.'));
        } else {
          fail(new Error(msg));
        }
      });
      peer.on('connection', (conn) => {
        if (!this.isHost) return;
        this.wireConn(conn);
      });
      peer.on('disconnected', () => this.handlers.onConnectionChange(false));
    });
  }

  private wireConn(conn: DataConnection): void {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.handlers.onPeerJoined(conn.peer);
      this.handlers.onConnectionChange(true);
    });
    conn.on('data', (data) => {
      try {
        const msg = data as NetMessage;
        this.handlers.onMessage(msg, conn.peer);
      } catch {
        /* ignore */
      }
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.handlers.onPeerLeft(conn.peer);
    });
    conn.on('error', () => {
      this.conns.delete(conn.peer);
      this.handlers.onPeerLeft(conn.peer);
    });
  }

  send(msg: NetMessage, toId?: string): void {
    if (toId) {
      this.conns.get(toId)?.send(msg);
      return;
    }
    if (this.isHost) {
      for (const c of this.conns.values()) c.send(msg);
    } else if (this.hostConn) {
      this.hostConn.send(msg);
    }
  }

  /** Host relays a message to everyone except optional exclude */
  relay(msg: NetMessage, excludeId?: string): void {
    if (!this.isHost) return;
    for (const [id, c] of this.conns) {
      if (id === excludeId) continue;
      c.send(msg);
    }
  }

  broadcast(msg: NetMessage): void {
    this.send(msg);
  }

  destroy(): void {
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* */
      }
    }
    this.conns.clear();
    this.hostConn = null;
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* */
      }
    }
    this.peer = null;
  }
}

export const PLAYER_COLORS = ['#f94144', '#577590', '#f9c74f', '#90be6d', '#f3722c', '#43aa8b', '#277da1'];

export function makePlayer(id: string, name: string, color: string, tee: { x: number; y: number }): PlayerInfo {
  return {
    id,
    name,
    color,
    strokes: [],
    totalStrokes: 0,
    finishedHole: false,
    ball: { x: tee.x, y: tee.y },
    vel: { x: 0, y: 0 },
    sunk: false,
  };
}
