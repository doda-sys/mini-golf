import type { Vec2 } from '../types';

/** Gaussian-ish bump on the green (normalized coords 0–1 in green AABB). */
export type TopoBump = {
  x: number;
  y: number;
  amp: number;
  rx: number;
  ry: number;
};

/**
 * Coherent per-hole height field. Same seed ⇒ same break in multiplayer.
 * Height is relative; downhill for physics is −∇h.
 */
export type GreenTopo = {
  bumps: TopoBump[];
  /** Global planar tilt (world-ish, small). */
  tiltX: number;
  tiltY: number;
  /** Overall break strength ~0.15–1. */
  strength: number;
};

export type GreenBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function polyBounds(poly: Vec2[]): GreenBounds {
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
  return { minX, minY, maxX, maxY };
}

function toLocal(x: number, y: number, b: GreenBounds): Vec2 {
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  return { x: (x - b.minX) / w, y: (y - b.minY) / h };
}

/** Height at world point (relative units). */
export function sampleHeight(topo: GreenTopo, x: number, y: number, b: GreenBounds): number {
  const loc = toLocal(x, y, b);
  let h = topo.tiltX * (loc.x - 0.5) + topo.tiltY * (loc.y - 0.5);
  for (const bump of topo.bumps) {
    const dx = (loc.x - bump.x) / (bump.rx || 0.2);
    const dy = (loc.y - bump.y) / (bump.ry || 0.2);
    h += bump.amp * Math.exp(-0.5 * (dx * dx + dy * dy));
  }
  return h * topo.strength;
}

/**
 * World-space downhill acceleration direction (not normalized).
 * Magnitude grows with local steepness; scaled gently for playability.
 */
export function sampleDownhill(topo: GreenTopo, x: number, y: number, b: GreenBounds): Vec2 {
  const eps = 3;
  const hx0 = sampleHeight(topo, x - eps, y, b);
  const hx1 = sampleHeight(topo, x + eps, y, b);
  const hy0 = sampleHeight(topo, x, y - eps, b);
  const hy1 = sampleHeight(topo, x, y + eps, b);
  // ∇h in world ≈ (dh/dx, dh/dy); downhill = −∇h
  const gx = (hx1 - hx0) / (2 * eps);
  const gy = (hy1 - hy0) / (2 * eps);
  return { x: -gx, y: -gy };
}

/** Steepness magnitude at a point (for heatmap). */
export function sampleSteepness(topo: GreenTopo, x: number, y: number, b: GreenBounds): number {
  const d = sampleDownhill(topo, x, y, b);
  return Math.hypot(d.x, d.y);
}

/** Build a coherent field from a seeded RNG + optional path bias. */
export function makeTopo(
  rng: () => number,
  pathDir: Vec2,
  intensity: number,
): GreenTopo {
  const pl = Math.hypot(pathDir.x, pathDir.y) || 1;
  const along = { x: pathDir.x / pl, y: pathDir.y / pl };
  const lat = { x: -along.y, y: along.x };
  const side = rng() < 0.5 ? 1 : -1;
  // Mild overall tilt: mix along-path and lateral break
  const mix = 0.25 + rng() * 0.5;
  const tiltMag = 0.35 + rng() * 0.55;
  const tiltX = (along.x * (1 - mix) + lat.x * mix * side) * tiltMag;
  const tiltY = (along.y * (1 - mix) + lat.y * mix * side) * tiltMag;

  const bumpCount = 2 + Math.floor(rng() * 3); // 2–4
  const bumps: TopoBump[] = [];
  for (let i = 0; i < bumpCount; i++) {
    bumps.push({
      x: 0.18 + rng() * 0.64,
      y: 0.18 + rng() * 0.64,
      amp: (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.55),
      rx: 0.14 + rng() * 0.22,
      ry: 0.14 + rng() * 0.22,
    });
  }

  const strength = Math.max(0.2, Math.min(1, intensity));
  return {
    bumps,
    tiltX: Math.round(tiltX * 1000) / 1000,
    tiltY: Math.round(tiltY * 1000) / 1000,
    strength: Math.round(strength * 1000) / 1000,
  };
}
