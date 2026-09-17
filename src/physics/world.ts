import type { Bumper, HoleDef, Vec2, Wall, Zone } from '../types';
import { add, clamp, dist, dot, len, scale, sub } from './math';

export const BALL_RADIUS = 8;
export const FRICTION = 0.985;
export const MIN_SPEED = 0.08;
export const MAX_PUTT_POWER = 14;
/** Max speed at which a ball over the cup sinks immediately. Slightly forgiving. */
export const CUP_SINK_SPEED = 2.8;
/** Frames of residence (at ~60Hz sim scale) needed to sink while center is deep in cup. */
export const CUP_RESIDENCE_FRAMES = 8;
/** Capture damping when ball center is inside the cup (energy-safe). */
export const CUP_DAMP = 0.82;
/** Max fraction of cup radius for "deep" residence capture. */
export const CUP_DEEP_FRAC = 0.9;
/**
 * Wind acceleration scale. hole.wind is roughly 0–1.2 magnitude;
 * applied as gentle accel only while the ball is moving.
 */
export const WIND_ACCEL = 0.018;

export type BallState = {
  pos: Vec2;
  vel: Vec2;
  sunk: boolean;
  radius: number;
  hazard?: boolean;
  /** Consecutive substeps with center deep inside the cup. */
  cupResidence?: number;
};

function circleAabbResolve(cx: number, cy: number, r: number, wall: Wall): Vec2 | null {
  const nearestX = clamp(cx, wall.x, wall.x + wall.w);
  const nearestY = clamp(cy, wall.y, wall.y + wall.h);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r || d2 === 0) {
    if (
      cx > wall.x &&
      cx < wall.x + wall.w &&
      cy > wall.y &&
      cy < wall.y + wall.h
    ) {
      const left = cx - wall.x;
      const right = wall.x + wall.w - cx;
      const top = cy - wall.y;
      const bottom = wall.y + wall.h - cy;
      const m = Math.min(left, right, top, bottom);
      if (m === left) return { x: -(left + r), y: 0 };
      if (m === right) return { x: right + r, y: 0 };
      if (m === top) return { x: 0, y: -(top + r) };
      return { x: 0, y: bottom + r };
    }
    return null;
  }
  const d = Math.sqrt(d2);
  const overlap = r - d;
  return { x: (dx / d) * overlap, y: (dy / d) * overlap };
}

function reflectVelocity(vel: Vec2, normal: Vec2, bounce = 0.72): Vec2 {
  const nLen = len(normal);
  if (nLen < 1e-8) return scale(vel, -bounce);
  const n = scale(normal, 1 / nLen);
  const vn = dot(vel, n);
  if (vn >= 0) return vel;
  return sub(vel, scale(n, (1 + bounce) * vn));
}

function zoneAt(zones: Zone[], p: Vec2): Zone | null {
  for (const z of zones) {
    if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) return z;
  }
  return null;
}

function collideBumper(ball: BallState, b: Bumper): void {
  const d = dist(ball.pos, { x: b.x, y: b.y });
  const minD = ball.radius + b.r;
  if (d >= minD || d < 1e-6) return;
  const n = scale(sub(ball.pos, { x: b.x, y: b.y }), 1 / d);
  ball.pos = add({ x: b.x, y: b.y }, scale(n, minD + 0.5));
  const incoming = Math.max(2, -dot(ball.vel, n));
  ball.vel = add(sub(ball.vel, scale(n, 2 * Math.min(0, -incoming))), scale(n, incoming * 0.55));
  const speed = len(ball.vel);
  if (speed < 3) ball.vel = scale(n, 4.5);
}

function collideWalls(ball: BallState, walls: Wall[]): void {
  for (const wall of walls) {
    const push = circleAabbResolve(ball.pos.x, ball.pos.y, ball.radius, wall);
    if (!push) continue;
    ball.pos = add(ball.pos, push);
    ball.vel = reflectVelocity(ball.vel, push);
  }
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

function closestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): Vec2 {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

/**
 * Keep the ball inside the green polygon by colliding with boundary edges.
 * Push is along the inward normal of the nearest edge.
 */
function collideGreenBoundary(ball: BallState, green: Vec2[]): void {
  if (green.length < 3) return;
  const r = ball.radius;
  const cx = ball.pos.x;
  const cy = ball.pos.y;
  const inside = pointInPoly(cx, cy, green);

  let bestD = Infinity;
  let bestNx = 0;
  let bestNy = 0;
  let bestOverlap = 0;

  for (let i = 0; i < green.length; i++) {
    const a = green[i];
    const b = green[(i + 1) % green.length];
    const c = closestOnSeg(cx, cy, a.x, a.y, b.x, b.y);
    const dx = cx - c.x;
    const dy = cy - c.y;
    const d = Math.hypot(dx, dy);

    // Edge tangent → outward candidate (perp). Pick inward via centroid test.
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    let nx = -ey;
    let ny = ex;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    // Midpoint + normal should go toward outside; flip if midpoint+normal is still inside.
    const mx = (a.x + b.x) / 2 + nx * 2;
    const my = (a.y + b.y) / 2 + ny * 2;
    if (pointInPoly(mx, my, green)) {
      nx = -nx;
      ny = -ny;
    }
    // Inward normal is opposite of outward
    const inx = -nx;
    const iny = -ny;

    if (!inside) {
      // Outside: push toward closest edge along inward direction
      if (d < bestD) {
        bestD = d;
        bestNx = inx;
        bestNy = iny;
        bestOverlap = d + r;
      }
    } else if (d < r && d < bestD) {
      bestD = d;
      bestNx = inx;
      bestNy = iny;
      bestOverlap = r - d;
    }
  }

  if (bestOverlap <= 0 || !Number.isFinite(bestOverlap)) return;

  // If outside, move onto edge then inset by radius
  if (!inside) {
    // Find closest edge point and place ball inside
    let nearest = { x: cx, y: cy };
    let nd = Infinity;
    for (let i = 0; i < green.length; i++) {
      const a = green[i];
      const b = green[(i + 1) % green.length];
      const c = closestOnSeg(cx, cy, a.x, a.y, b.x, b.y);
      const d = Math.hypot(cx - c.x, cy - c.y);
      if (d < nd) {
        nd = d;
        nearest = c;
      }
    }
    ball.pos = { x: nearest.x + bestNx * (r + 0.5), y: nearest.y + bestNy * (r + 0.5) };
    ball.vel = reflectVelocity(ball.vel, { x: bestNx, y: bestNy });
    return;
  }

  ball.pos = add(ball.pos, scale({ x: bestNx, y: bestNy }, bestOverlap + 0.15));
  ball.vel = reflectVelocity(ball.vel, { x: bestNx, y: bestNy });
}

/**
 * Energy-safe cup capture:
 * - Heavy damping while center is over the cup (no unbounded pull that adds KE).
 * - Keep/attract only the component toward the cup center (clamped so speed never increases).
 * - Sink when slow enough OR after brief residence deep in the cup.
 * - Fast skims can rim out without magically accelerating away.
 */
function applyCupCapture(ball: BallState, hole: HoleDef): boolean {
  if (ball.sunk) return true;

  const toCup = dist(ball.pos, hole.cup);
  const cupR = hole.cupRadius;
  const deepR = cupR * CUP_DEEP_FRAC;

  if (toCup >= cupR) {
    ball.cupResidence = 0;
    return false;
  }

  ball.vel = scale(ball.vel, CUP_DAMP);

  if (toCup > 0.15) {
    const toward = scale(sub(hole.cup, ball.pos), 1 / toCup);
    const radial = Math.max(0, dot(ball.vel, toward));
    const tangent = sub(ball.vel, scale(toward, radial));
    const nudge = Math.min(0.35, toCup * 0.12);
    const newVel = add(scale(tangent, 0.55), scale(toward, radial + nudge));
    const maxSpeed = len(ball.vel) + 1e-6;
    const nv = len(newVel);
    ball.vel = nv > maxSpeed ? scale(newVel, maxSpeed / nv) : newVel;
  }

  const speed = len(ball.vel);

  if (toCup < deepR) {
    ball.cupResidence = (ball.cupResidence ?? 0) + 1;
  } else {
    ball.cupResidence = Math.max(0, (ball.cupResidence ?? 0) - 1);
  }

  const slowEnough = speed < CUP_SINK_SPEED && toCup < cupR;
  const resided = (ball.cupResidence ?? 0) >= CUP_RESIDENCE_FRAMES && toCup < deepR;

  if (slowEnough || resided) {
    ball.sunk = true;
    ball.pos = { x: hole.cup.x, y: hole.cup.y };
    ball.vel = { x: 0, y: 0 };
    ball.cupResidence = 0;
    return true;
  }

  return false;
}

export function createBall(tee: Vec2): BallState {
  return {
    pos: { x: tee.x, y: tee.y },
    vel: { x: 0, y: 0 },
    sunk: false,
    radius: BALL_RADIUS,
    cupResidence: 0,
  };
}

export function isMoving(ball: BallState): boolean {
  return !ball.sunk && len(ball.vel) > MIN_SPEED;
}

export function stepBall(ball: BallState, hole: HoleDef, dt: number): void {
  if (ball.sunk) return;

  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  const green = hole.green?.length >= 3 ? hole.green : [
    { x: 0, y: 0 },
    { x: hole.width, y: 0 },
    { x: hole.width, y: hole.height },
    { x: 0, y: hole.height },
  ];

  for (let i = 0; i < steps; i++) {
    if (ball.sunk) return;

    // Wind only while moving (so aiming stays fair)
    const speedBefore = len(ball.vel);
    if (speedBefore > MIN_SPEED && (hole.wind.x !== 0 || hole.wind.y !== 0)) {
      ball.vel = add(ball.vel, scale(hole.wind, WIND_ACCEL * h * 60));
    }

    ball.pos = add(ball.pos, scale(ball.vel, h * 60));

    collideGreenBoundary(ball, green);
    collideWalls(ball, hole.walls);
    for (const bumper of hole.bumpers) collideBumper(ball, bumper);

    const zone = zoneAt(hole.zones, ball.pos);
    let friction = FRICTION;
    if (zone) {
      if (zone.kind === 'water') {
        ball.pos = { x: hole.tee.x, y: hole.tee.y };
        ball.vel = { x: 0, y: 0 };
        ball.hazard = true;
        ball.cupResidence = 0;
        return;
      }
      friction = Math.pow(FRICTION, zone.frictionMul);
      if (zone.kind === 'ice') friction = 0.994;
    }

    ball.vel = scale(ball.vel, Math.pow(friction, h * 60));

    if (applyCupCapture(ball, hole)) return;

    const speed = len(ball.vel);
    if (speed < MIN_SPEED) {
      ball.vel = { x: 0, y: 0 };
    }
  }
}

export function applyPutt(ball: BallState, dir: Vec2, power01: number): void {
  if (ball.sunk || isMoving(ball)) return;
  const p = clamp(power01, 0, 1) * MAX_PUTT_POWER;
  const d = len(dir) < 1e-6 ? { x: 0, y: -1 } : { x: dir.x / len(dir), y: dir.y / len(dir) };
  ball.vel = scale(d, p);
  ball.cupResidence = 0;
}
