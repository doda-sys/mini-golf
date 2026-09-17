import type { Bumper, HoleDef, Wall, Zone } from '../types';
import { themeForHoleId, type HoleThemeId } from './themes';

const CUP_R = 16;
const BORDER_T = 18;
export const POOL_SIZE = 1000;
export const ROUND_HOLES = 9;

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function border(w: number, h: number, t = BORDER_T): Wall[] {
  return [
    { x: 0, y: 0, w, h: t },
    { x: 0, y: h - t, w, h: t },
    { x: 0, y: 0, w: t, h },
    { x: w - t, y: 0, w: t, h },
  ];
}

const ADJECTIVES = [
  'Windy', 'Lucky', 'Crooked', 'Sunny', 'Hidden', 'Bouncy', 'Icy', 'Sandy',
  'Narrow', 'Grand', 'Twisty', 'Quiet', 'Wild', 'Silver', 'Golden', 'Rusty',
  'Foggy', 'Spicy', 'Cosmic', 'Peppy', 'Dusty', 'Misty', 'Jolly', 'Zesty',
];
const NOUNS = [
  'Fairway', 'Dogleg', 'Alley', 'Bowl', 'Lane', 'Cove', 'Pass', 'Ridge',
  'Garden', 'Run', 'Bend', 'Grove', 'Dunes', 'Loop', 'Gate', 'Glen',
  'Trail', 'Basin', 'Creek', 'Knob', 'Hollow', 'Point', 'Meadow', 'Spur',
];

function holeName(id: number, rng: () => number): string {
  const a = ADJECTIVES[(id + Math.floor(rng() * ADJECTIVES.length)) % ADJECTIVES.length];
  const n = NOUNS[(id * 3 + Math.floor(rng() * NOUNS.length)) % NOUNS.length];
  return `${a} ${n}`;
}

function overlapsCircle(x: number, y: number, r: number, cx: number, cy: number, cr: number, pad = 28): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < (r + cr + pad) * (r + cr + pad);
}

function wallHitsPoint(w: Wall, px: number, py: number, pad: number): boolean {
  return px >= w.x - pad && px <= w.x + w.w + pad && py >= w.y - pad && py <= w.y + w.h + pad;
}

/**
 * Procedurally generate one distinct hole from its catalog id (1..POOL_SIZE).
 * Layout, size, par, hazards, and theme are derived from the id seed.
 */
export function generateHole(id: number): HoleDef {
  const rng = mulberry32(id * 2654435761 + 0x9e3779b9);
  const theme = themeForHoleId(id);
  const themeId = theme.id as HoleThemeId;

  // Size variety: short/long, narrow/wide
  const width = 420 + Math.floor(rng() * 180); // 420–599
  const height = 640 + Math.floor(rng() * 200); // 640–839
  const layoutRoll = rng();

  const margin = BORDER_T + 36;
  const tee = {
    x: margin + rng() * (width - margin * 2),
    y: height - margin - 20 - rng() * 40,
  };
  const cup = {
    x: margin + rng() * (width - margin * 2),
    y: margin + 30 + rng() * 50,
  };

  // Bias cup/tee for layout archetypes
  if (layoutRoll < 0.2) {
    // Straight-ish corridor
    tee.x = width * 0.5 + (rng() - 0.5) * 40;
    cup.x = width * 0.5 + (rng() - 0.5) * 40;
  } else if (layoutRoll < 0.45) {
    // Dogleg
    tee.x = margin + 20 + rng() * 40;
    cup.x = width - margin - 20 - rng() * 40;
  } else if (layoutRoll < 0.65) {
    tee.x = width - margin - 20 - rng() * 40;
    cup.x = margin + 20 + rng() * 40;
  }

  const walls: Wall[] = [...border(width, height)];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  const complexity = 0.35 + rng() * 0.65;
  const wallCount = 2 + Math.floor(complexity * 6); // 2–8 inner walls
  const bumperCount = Math.floor(complexity * 6); // 0–5
  const zoneCount = Math.floor(rng() * 4 * complexity); // 0–3ish

  // Inner walls — horizontal bars, vertical gates, L-ish blocks
  for (let i = 0; i < wallCount; i++) {
    const kind = rng();
    let w: Wall;
    if (kind < 0.4) {
      // Horizontal barrier
      const ww = 80 + rng() * (width * 0.35);
      const wh = 18 + rng() * 8;
      w = {
        x: margin + rng() * Math.max(10, width - margin * 2 - ww),
        y: height * (0.25 + rng() * 0.5),
        w: ww,
        h: wh,
      };
    } else if (kind < 0.75) {
      // Vertical gate
      const ww = 18 + rng() * 8;
      const wh = 80 + rng() * (height * 0.28);
      w = {
        x: margin + rng() * Math.max(10, width - margin * 2 - ww),
        y: height * (0.2 + rng() * 0.45),
        w: ww,
        h: wh,
      };
    } else {
      // Block
      const ww = 40 + rng() * 70;
      const wh = 40 + rng() * 70;
      w = {
        x: margin + rng() * Math.max(10, width - margin * 2 - ww),
        y: height * (0.22 + rng() * 0.5),
        w: ww,
        h: wh,
      };
    }
    if (wallHitsPoint(w, tee.x, tee.y, 40) || wallHitsPoint(w, cup.x, cup.y, 44)) continue;
    walls.push(w);
  }

  for (let i = 0; i < bumperCount; i++) {
    const r = 16 + rng() * 16;
    const x = margin + 20 + rng() * (width - margin * 2 - 40);
    const y = height * (0.25 + rng() * 0.5);
    if (overlapsCircle(x, y, r, tee.x, tee.y, 14) || overlapsCircle(x, y, r, cup.x, cup.y, CUP_R)) continue;
    bumpers.push({ x, y, r });
  }

  // Hazard mix biased slightly by theme
  const kinds: Array<Zone['kind']> =
    themeId === 'arctic'
      ? ['ice', 'ice', 'sand', 'water']
      : themeId === 'desert'
        ? ['sand', 'sand', 'sand', 'water']
        : themeId === 'volcano'
          ? ['sand', 'water', 'sand', 'ice']
          : themeId === 'pirate' || themeId === 'tropical'
            ? ['water', 'sand', 'water', 'ice']
            : ['sand', 'ice', 'water', 'sand'];

  for (let i = 0; i < zoneCount; i++) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const zw = 60 + rng() * 120;
    const zh = 40 + rng() * 80;
    const zx = margin + rng() * Math.max(10, width - margin * 2 - zw);
    const zy = height * (0.2 + rng() * 0.55);
    // Keep clear of tee/cup
    const cx = zx + zw / 2;
    const cy = zy + zh / 2;
    if (overlapsCircle(cx, cy, Math.max(zw, zh) / 2, tee.x, tee.y, 20, 10)) continue;
    if (overlapsCircle(cx, cy, Math.max(zw, zh) / 2, cup.x, cup.y, CUP_R, 10)) continue;
    const frictionMul = kind === 'ice' ? 0.35 + rng() * 0.15 : kind === 'sand' ? 2.3 + rng() * 0.6 : 1;
    zones.push({ x: zx, y: zy, w: zw, h: zh, frictionMul, kind });
  }

  // Par from length + clutter
  const dist = Math.hypot(cup.x - tee.x, cup.y - tee.y);
  let par = 2;
  if (dist > 280 || wallCount >= 4) par = 3;
  if (dist > 400 || wallCount >= 6 || bumperCount >= 4) par = 4;
  if (dist > 480 && (zoneCount >= 2 || bumperCount >= 5)) par = 5;
  par = Math.max(2, Math.min(5, par + (rng() < 0.15 ? 1 : 0)));

  return {
    id,
    name: holeName(id, rng),
    par,
    width: Math.round(width),
    height: Math.round(height),
    tee: { x: Math.round(tee.x), y: Math.round(tee.y) },
    cup: { x: Math.round(cup.x), y: Math.round(cup.y) },
    cupRadius: CUP_R,
    walls,
    bumpers,
    zones,
    theme: themeId,
  };
}

/** Build the full 1000-hole catalog (deterministic). */
export function buildHolePool(size = POOL_SIZE): HoleDef[] {
  const pool: HoleDef[] = [];
  for (let id = 1; id <= size; id++) pool.push(generateHole(id));
  return pool;
}

/** Pick `count` unique hole ids from the pool using a seed. */
export function pickCourseIds(seed: number, count = ROUND_HOLES, poolSize = POOL_SIZE): number[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const ids = Array.from({ length: poolSize }, (_, i) => i + 1);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}
