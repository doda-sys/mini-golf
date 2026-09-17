import type { Bumper, GrassPattern, HoleDef, Vec2, Wall, Zone } from '../types';
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

const GRASS_PALETTES: Array<[string, string, string]> = [
  ['#2d8a4e', '#267a44', '#1f6b3a'],
  ['#3a9b55', '#2f8748', '#24753c'],
  ['#4aaf62', '#3a9852', '#2e7f44'],
  ['#2a7a48', '#226a3e', '#1a5a34'],
  ['#358f5a', '#2c7a4c', '#23663e'],
  ['#1e8a60', '#187a52', '#126a44'],
  ['#4c9a3c', '#3f8532', '#327028'],
  ['#2f9b6a', '#26885c', '#1e744e'],
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

function pointInPoly(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polyCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function distToEdge(px: number, py: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = px - a.x;
    const apy = py - a.y;
    const ab2 = abx * abx + aby * aby || 1;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

function randomPointInPoly(rng: () => number, poly: Vec2[], minEdge = 36, tries = 80): Vec2 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  for (let i = 0; i < tries; i++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (pointInPoly(x, y, poly) && distToEdge(x, y, poly) >= minEdge) return { x, y };
  }
  const c = polyCentroid(poly);
  if (pointInPoly(c.x, c.y, poly)) return c;
  return null;
}

function ovalPoly(cx: number, cy: number, rx: number, ry: number, n = 20): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

function rectPoly(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Build a playable green polygon inside the AABB [0,w]x[0,h], inset by border. */
function makeGreen(rng: () => number, w: number, h: number): Vec2[] {
  const m = BORDER_T;
  const roll = rng();

  // ~28% classic rectangle (inset)
  if (roll < 0.28) {
    return rectPoly(m, m, w - m * 2, h - m * 2);
  }

  // L-shape
  if (roll < 0.48) {
    const cutW = w * (0.28 + rng() * 0.28);
    const cutH = h * (0.28 + rng() * 0.28);
    const flip = rng() < 0.5;
    if (flip) {
      // missing bottom-right
      return [
        { x: m, y: m },
        { x: w - m, y: m },
        { x: w - m, y: h - cutH },
        { x: w - cutW, y: h - cutH },
        { x: w - cutW, y: h - m },
        { x: m, y: h - m },
      ];
    }
    // missing top-left-ish / bottom-left variant
    return [
      { x: m, y: m },
      { x: w - cutW, y: m },
      { x: w - cutW, y: cutH },
      { x: w - m, y: cutH },
      { x: w - m, y: h - m },
      { x: m, y: h - m },
    ];
  }

  // Dogleg / bent corridor
  if (roll < 0.62) {
    const midY = h * (0.42 + rng() * 0.16);
    const leftW = w * (0.38 + rng() * 0.18);
    const rightW = w * (0.38 + rng() * 0.18);
    const leftX = m;
    const rightX = w - m - rightW;
    return [
      { x: leftX, y: midY },
      { x: leftX + leftW, y: midY },
      { x: leftX + leftW, y: m },
      { x: w - m, y: m },
      { x: w - m, y: midY + (h - midY - m) * 0.55 },
      { x: rightX, y: midY + (h - midY - m) * 0.55 },
      { x: rightX, y: h - m },
      { x: leftX, y: h - m },
    ];
  }

  // Oval / stadium (polygon approx)
  if (roll < 0.76) {
    const rx = (w - m * 2) * (0.42 + rng() * 0.08);
    const ry = (h - m * 2) * (0.42 + rng() * 0.08);
    return ovalPoly(w / 2, h / 2, rx, ry, 18 + Math.floor(rng() * 6));
  }

  // T-shape
  if (roll < 0.86) {
    const barH = h * (0.28 + rng() * 0.12);
    const stemW = w * (0.28 + rng() * 0.16);
    const stemX = (w - stemW) / 2;
    return [
      { x: m, y: m },
      { x: w - m, y: m },
      { x: w - m, y: m + barH },
      { x: stemX + stemW, y: m + barH },
      { x: stemX + stemW, y: h - m },
      { x: stemX, y: h - m },
      { x: stemX, y: m + barH },
      { x: m, y: m + barH },
    ];
  }

  // Irregular / soft octagon-ish
  if (roll < 0.94) {
    const inset = m + 10 + rng() * 24;
    const jx = () => (rng() - 0.5) * 36;
    const jy = () => (rng() - 0.5) * 36;
    return [
      { x: inset + jx(), y: inset + jy() },
      { x: w / 2 + jx(), y: m + 8 + jy() * 0.4 },
      { x: w - inset + jx(), y: inset + jy() },
      { x: w - m - 8 + jx() * 0.3, y: h / 2 + jy() },
      { x: w - inset + jx(), y: h - inset + jy() },
      { x: w / 2 + jx(), y: h - m - 8 + jy() * 0.4 },
      { x: inset + jx(), y: h - inset + jy() },
      { x: m + 8 + jx() * 0.3, y: h / 2 + jy() },
    ].map((p) => ({
      x: Math.max(m, Math.min(w - m, p.x)),
      y: Math.max(m, Math.min(h - m, p.y)),
    }));
  }

  // Narrow fairway strip with rounded ends (capsule-ish)
  const stripW = w * (0.42 + rng() * 0.22);
  const sx = (w - stripW) / 2;
  const top = ovalPoly(w / 2, m + stripW * 0.35, stripW * 0.48, stripW * 0.32, 10);
  const bot = ovalPoly(w / 2, h - m - stripW * 0.35, stripW * 0.48, stripW * 0.32, 10);
  // Connect as stadium: left side of strip + half ovals
  return [
    { x: sx, y: m + stripW * 0.4 },
    ...top.filter((_, i) => i <= 5).reverse(),
    { x: sx + stripW, y: m + stripW * 0.4 },
    { x: sx + stripW, y: h - m - stripW * 0.4 },
    ...bot.filter((_, i) => i <= 5),
    { x: sx, y: h - m - stripW * 0.4 },
  ];
}

function makeGrass(id: number, rng: () => number): GrassPattern {
  const pal = GRASS_PALETTES[id % GRASS_PALETTES.length];
  const [a, b, c] = pal;
  const kindRoll = rng();
  if (kindRoll < 0.18) {
    return { kind: 'checker', tile: 28 + Math.floor(rng() * 28), a, b };
  }
  if (kindRoll < 0.36) {
    return { kind: 'stripes', width: 18 + rng() * 28, angle: rng() * Math.PI, a, b };
  }
  if (kindRoll < 0.52) {
    return { kind: 'mow', width: 14 + rng() * 22, angle: (rng() - 0.5) * 0.9, a, b };
  }
  if (kindRoll < 0.68) {
    return { kind: 'diamonds', size: 22 + rng() * 26, a, b };
  }
  if (kindRoll < 0.84) {
    return { kind: 'noise', scale: 12 + rng() * 24, a, b, c };
  }
  return { kind: 'rings', spacing: 28 + rng() * 36, a, b };
}

function makeWind(rng: () => number): Vec2 {
  // Strength 0 (calm) to ~1.2; direction anywhere. Many holes stay calm.
  const calm = rng();
  if (calm < 0.22) return { x: 0, y: 0 };
  const ang = rng() * Math.PI * 2;
  const mag = 0.25 + rng() * 0.95;
  return { x: Math.cos(ang) * mag, y: Math.sin(ang) * mag };
}

/**
 * Procedurally generate one distinct hole from its catalog id (1..POOL_SIZE).
 * Layout, size, par, hazards, green shape, grass, wind, and theme are derived from the id seed.
 */
export function generateHole(id: number): HoleDef {
  const rng = mulberry32(id * 2654435761 + 0x9e3779b9);
  const theme = themeForHoleId(id);
  const themeId = theme.id as HoleThemeId;

  const width = 420 + Math.floor(rng() * 180);
  const height = 640 + Math.floor(rng() * 200);
  const green = makeGreen(rng, width, height);
  const grass = makeGrass(id, rng);
  const wind = makeWind(rng);

  // Tee near "bottom" of green, cup near "top"
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of green) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(80, maxY - minY);

  let tee =
    randomPointInPoly(rng, green, 40) ??
    polyCentroid(green);
  // Bias tee toward bottom third
  for (let i = 0; i < 24; i++) {
    const c = randomPointInPoly(rng, green, 40);
    if (c && c.y > minY + span * 0.55) {
      tee = c;
      break;
    }
  }

  let cup =
    randomPointInPoly(rng, green, 44) ??
    { x: polyCentroid(green).x, y: minY + 50 };
  for (let i = 0; i < 28; i++) {
    const c = randomPointInPoly(rng, green, 44);
    if (c && c.y < minY + span * 0.4 && Math.hypot(c.x - tee.x, c.y - tee.y) > 120) {
      cup = c;
      break;
    }
  }
  // Ensure separation
  if (Math.hypot(cup.x - tee.x, cup.y - tee.y) < 100) {
    const alt = randomPointInPoly(rng, green, 44);
    if (alt && Math.hypot(alt.x - tee.x, alt.y - tee.y) > Math.hypot(cup.x - tee.x, cup.y - tee.y)) {
      cup = alt;
    }
  }

  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  const complexity = 0.35 + rng() * 0.65;
  const wallCount = 2 + Math.floor(complexity * 6);
  const bumperCount = Math.floor(complexity * 6);
  const zoneCount = Math.floor(rng() * 4 * complexity);

  const margin = BORDER_T + 20;

  for (let i = 0; i < wallCount; i++) {
    const kind = rng();
    let w: Wall;
    if (kind < 0.4) {
      const ww = 70 + rng() * (width * 0.28);
      const wh = 16 + rng() * 8;
      w = {
        x: margin + rng() * Math.max(10, width - margin * 2 - ww),
        y: height * (0.25 + rng() * 0.5),
        w: ww,
        h: wh,
      };
    } else if (kind < 0.75) {
      const ww = 16 + rng() * 8;
      const wh = 70 + rng() * (height * 0.24);
      w = {
        x: margin + rng() * Math.max(10, width - margin * 2 - ww),
        y: height * (0.2 + rng() * 0.45),
        w: ww,
        h: wh,
      };
    } else {
      const ww = 36 + rng() * 60;
      const wh = 36 + rng() * 60;
      w = {
        x: margin + rng() * Math.max(10, width - margin * 2 - ww),
        y: height * (0.22 + rng() * 0.5),
        w: ww,
        h: wh,
      };
    }
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    if (!pointInPoly(cx, cy, green)) continue;
    if (distToEdge(cx, cy, green) < 28) continue;
    if (wallHitsPoint(w, tee.x, tee.y, 40) || wallHitsPoint(w, cup.x, cup.y, 44)) continue;
    walls.push(w);
  }

  for (let i = 0; i < bumperCount; i++) {
    const r = 16 + rng() * 16;
    const pt = randomPointInPoly(rng, green, r + 24);
    if (!pt) continue;
    if (overlapsCircle(pt.x, pt.y, r, tee.x, tee.y, 14) || overlapsCircle(pt.x, pt.y, r, cup.x, cup.y, CUP_R)) continue;
    bumpers.push({ x: pt.x, y: pt.y, r });
  }

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
    const zw = 50 + rng() * 100;
    const zh = 36 + rng() * 70;
    const pt = randomPointInPoly(rng, green, Math.max(zw, zh) / 2 + 10);
    if (!pt) continue;
    const zx = pt.x - zw / 2;
    const zy = pt.y - zh / 2;
    if (overlapsCircle(pt.x, pt.y, Math.max(zw, zh) / 2, tee.x, tee.y, 20, 10)) continue;
    if (overlapsCircle(pt.x, pt.y, Math.max(zw, zh) / 2, cup.x, cup.y, CUP_R, 10)) continue;
    // Keep zone mostly on green
    if (!pointInPoly(zx + 8, zy + 8, green) || !pointInPoly(zx + zw - 8, zy + zh - 8, green)) continue;
    const frictionMul = kind === 'ice' ? 0.35 + rng() * 0.15 : kind === 'sand' ? 2.3 + rng() * 0.6 : 1;
    zones.push({ x: zx, y: zy, w: zw, h: zh, frictionMul, kind });
  }

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
    green: green.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
    tee: { x: Math.round(tee.x), y: Math.round(tee.y) },
    cup: { x: Math.round(cup.x), y: Math.round(cup.y) },
    cupRadius: CUP_R,
    walls,
    bumpers,
    zones,
    theme: themeId,
    grass,
    wind: { x: Math.round(wind.x * 1000) / 1000, y: Math.round(wind.y * 1000) / 1000 },
  };
}

export function buildHolePool(size = POOL_SIZE): HoleDef[] {
  const pool: HoleDef[] = [];
  for (let id = 1; id <= size; id++) pool.push(generateHole(id));
  return pool;
}

export function pickCourseIds(seed: number, count = ROUND_HOLES, poolSize = POOL_SIZE): number[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const ids = Array.from({ length: poolSize }, (_, i) => i + 1);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

/** Wind strength 0–1 for HUD (from stored vector). */
export function windStrength(wind: Vec2): number {
  return Math.min(1, Math.hypot(wind.x, wind.y) / 1.2);
}
