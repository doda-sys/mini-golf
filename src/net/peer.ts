import { joinRoom, selfId, type Room, type MessageAction } from '@trystero-p2p/torrent';
import type { NetMessage, PlayerInfo } from '../types';

const APP_ID = 'putt-putt-mini-golf-doda';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_ATTEMPTS = 3;
const JOIN_PEER_TIMEOUT_MS = 14000;

export function generateRoomCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

export type NetHandlers = {
  onOpen: (peerId: string, isHost: boolean) => void;
  onError: (msg: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onMessage: (msg: NetMessage, fromId: string) => void;
  onPeerJoined: (peerId: string) => void;
  onPeerLeft: (peerId: string) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Trystero (BitTorrent tracker) room sync:
 * Host and guests both joinRoom({ appId }, roomCode) — no custom peer-id lookup.
 * Turn-based NetMessage protocol is preserved for main.ts.
 */
export class GolfNet {
  isHost = false;
  roomCode = '';
  localPeerId = '';
  private room: Room | null = null;
  private action: MessageAction<NetMessage> | null = null;
  private peers = new Set<string>();
  private handlers: NetHandlers;
  private generation = 0;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  async createRoom(code?: string): Promise<string> {
    this.destroy();
    this.isHost = true;
    this.roomCode = (code ?? generateRoomCode(5)).toUpperCase();
    await this.openRoom(this.roomCode, false);
    return this.roomCode;
  }

  async joinRoom(code: string): Promise<void> {
    this.destroy();
    this.isHost = false;
    this.roomCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.roomCode.length < 4 || this.roomCode.length > 6) {
      throw new Error('Room code must be 4–6 characters');
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt++) {
      try {
        await this.openRoom(this.roomCode, true);
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        this.destroy();
        if (attempt < JOIN_ATTEMPTS - 1) await sleep(700 * (attempt + 1));
      }
    }
    throw new Error(
      lastErr?.message ||
        'Could not join. Keep the host tab open, check the code, or create a fresh room.',
    );
  }

  private async openRoom(roomCode: string, waitForPeer: boolean): Promise<void> {
    const gen = ++this.generation;
    this.localPeerId = selfId;
    this.peers.clear();

    const room = joinRoom(
      { appId: APP_ID },
      roomCode,
      {
        onJoinError: (details) => {
          if (gen !== this.generation) return;
          this.handlers.onError(
            details.error ||
              'Connection failed. Keep the host tab open and try a fresh room if needed.',
          );
        },
      },
    );
    this.room = room;

    const action = room.makeAction<NetMessage>('golf');
    this.action = action;
    action.onMessage = (data, { peerId }) => {
      if (gen !== this.generation) return;
      this.handlers.onMessage(data, peerId);
    };

    room.onPeerJoin = (peerId) => {
      if (gen !== this.generation) return;
      this.peers.add(peerId);
      this.handlers.onPeerJoined(peerId);
      this.handlers.onConnectionChange(true);
    };
    room.onPeerLeave = (peerId) => {
      if (gen !== this.generation) return;
      this.peers.delete(peerId);
      this.handlers.onPeerLeft(peerId);
      this.handlers.onConnectionChange(this.peers.size > 0);
    };

    // Already-connected peers (rare race)
    for (const id of Object.keys(room.getPeers())) {
      this.peers.add(id);
      this.handlers.onPeerJoined(id);
    }
    if (this.peers.size > 0) this.handlers.onConnectionChange(true);

    this.handlers.onOpen(selfId, this.isHost);

    if (!waitForPeer) return;

    if (this.peers.size > 0) return;

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(
          new Error(
            'Room not reachable. Keep the host’s tab open, double-check the code, or create a fresh room.',
          ),
        );
      }, JOIN_PEER_TIMEOUT_MS);

      const prevJoin = room.onPeerJoin;
      room.onPeerJoin = (peerId) => {
        prevJoin?.(peerId);
        clearTimeout(t);
        resolve();
      };
    });
  }

  send(msg: NetMessage, toId?: string): void {
    if (!this.action) return;
    if (toId) {
      void this.action.send(msg, { target: toId });
      return;
    }
    void this.action.send(msg);
  }

  /** Host relays to everyone except optional exclude (targeted send). */
  relay(msg: NetMessage, excludeId?: string): void {
    if (!this.isHost || !this.action) return;
    const targets = [...this.peers].filter((id) => id !== excludeId);
    if (targets.length === 0) return;
    void this.action.send(msg, { target: targets });
  }

  broadcast(msg: NetMessage): void {
    this.send(msg);
  }

  destroy(): void {
    this.generation++;
    this.peers.clear();
    this.action = null;
    if (this.room) {
      const r = this.room;
      this.room = null;
      try {
        void r.leave();
      } catch {
        /* */
      }
    }
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
