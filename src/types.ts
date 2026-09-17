export type Vec2 = { x: number; y: number };

export type Wall = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Bumper = {
  x: number;
  y: number;
  r: number;
};

export type Zone = {
  x: number;
  y: number;
  w: number;
  h: number;
  frictionMul: number; // >1 = sand/slow
  kind: 'sand' | 'ice' | 'water';
};

export type HoleDef = {
  id: number;
  name: string;
  par: number;
  width: number;
  height: number;
  tee: Vec2;
  cup: Vec2;
  cupRadius: number;
  walls: Wall[];
  bumpers: Bumper[];
  zones: Zone[];
};

export type PlayerInfo = {
  id: string;
  name: string;
  color: string;
  strokes: number[];
  totalStrokes: number;
  finishedHole: boolean;
  ball: Vec2;
  vel: Vec2;
  sunk: boolean;
};

export type GameMode = 'menu' | 'solo' | 'lobby' | 'playing' | 'scorecard' | 'finished';

export type NetMessage =
  | { type: 'hello'; name: string; color: string }
  | { type: 'welcome'; players: PlayerInfo[]; hostId: string; holeIndex: number; turnPlayerId: string; mode: string }
  | { type: 'player-joined'; player: PlayerInfo }
  | { type: 'player-left'; id: string }
  | { type: 'start'; holeIndex: number; turnPlayerId: string }
  | { type: 'putt'; playerId: string; vx: number; vy: number; ball: Vec2; strokes: number }
  | { type: 'state-sync'; players: PlayerInfo[]; holeIndex: number; turnPlayerId: string; phase: string }
  | { type: 'hole-complete'; playerId: string; strokes: number }
  | { type: 'next-hole'; holeIndex: number; turnPlayerId: string; players: PlayerInfo[] }
  | { type: 'chat'; name: string; text: string }
  | { type: 'ping' }
  | { type: 'pong' };
