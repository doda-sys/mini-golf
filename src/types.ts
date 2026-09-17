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

export type HoleThemeId =
  | 'tropical'
  | 'desert'
  | 'arctic'
  | 'volcano'
  | 'neon'
  | 'pirate'
  | 'space'
  | 'autumn'
  | 'castle'
  | 'candy';

/** Deterministic grass look — same hole id ⇒ same pattern in multiplayer. */
export type GrassPattern =
  | { kind: 'carpet'; width: number; angle: number; a: string; b: string; sheen: string }
  | { kind: 'mow'; width: number; angle: number; a: string; b: string }
  | { kind: 'checker'; tile: number; a: string; b: string }
  | { kind: 'stripes'; width: number; angle: number; a: string; b: string }
  | { kind: 'diamonds'; size: number; a: string; b: string }
  | { kind: 'noise'; scale: number; a: string; b: string; c: string }
  | { kind: 'rings'; spacing: number; a: string; b: string };

/** Gaussian bump in normalized green AABB coords (see levels/topo.ts). */
export type TopoBump = {
  x: number;
  y: number;
  amp: number;
  rx: number;
  ry: number;
};

/** Coherent height field — drives green-map overlay AND physics break. */
export type GreenTopo = {
  bumps: TopoBump[];
  tiltX: number;
  tiltY: number;
  strength: number;
};

export type HoleDef = {
  id: number;
  name: string;
  par: number;
  /** Axis-aligned bounds used for camera / layout (green polygon lives inside). */
  width: number;
  height: number;
  /** Playable green outline (closed polygon, world coords). Ball stays inside. */
  green: Vec2[];
  tee: Vec2;
  cup: Vec2;
  cupRadius: number;
  walls: Wall[];
  bumpers: Bumper[];
  zones: Zone[];
  /** Visual theme for surroundings outside the green */
  theme: HoleThemeId;
  /** Grass fill style (deterministic from hole id). */
  grass: GrassPattern;
  /**
   * Unit wind direction (blowing toward). Calm holes still set a direction
   * with windMph === 0 so the compass can show 0 mph.
   * Deterministic from hole id for multiplayer sync.
   */
  wind: Vec2;
  /** Wind speed in mph, inclusive 0–25. */
  windMph: number;
  /**
   * Height field for green break. Visual topo map and physics use the same field.
   * Deterministic from hole id.
   */
  topo: GreenTopo;
  /**
   * @deprecated Prefer topo — kept as average downhill for HUD hints.
   * Constant gravity-like vector derived from topo tilt.
   */
  slope: Vec2;
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
  | { type: 'welcome'; players: PlayerInfo[]; hostId: string; holeIndex: number; turnPlayerId: string; mode: string; holeIds?: number[] }
  | { type: 'player-joined'; player: PlayerInfo }
  | { type: 'player-left'; id: string }
  | { type: 'start'; holeIndex: number; turnPlayerId: string; holeIds: number[]; courseSeed: number }
  | { type: 'putt'; playerId: string; vx: number; vy: number; ball: Vec2; strokes: number }
  | { type: 'state-sync'; players: PlayerInfo[]; holeIndex: number; turnPlayerId: string; phase: string }
  | { type: 'hole-complete'; playerId: string; strokes: number }
  | { type: 'next-hole'; holeIndex: number; turnPlayerId: string; players: PlayerInfo[] }
  | { type: 'chat'; name: string; text: string }
  | { type: 'ping' }
  | { type: 'pong' };
