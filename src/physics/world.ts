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
    // Fully inside thick wall: push out to nearest edge
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
  // Boost bounce off bumper
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

  // Inside cup: damp kinetic energy hard (prevents slingshot/overshoot).
  ball.vel = scale(ball.vel, CUP_DAMP);

  // Attract only toward cup center without increasing speed.
  if (toCup > 0.15) {
    const toward = scale(sub(hole.cup, ball.pos), 1 / toCup);
    const radial = Math.max(0, dot(ball.vel, toward));
    const tangent = sub(ball.vel, scale(toward, radial));
    // Bleed tangential speed; keep radial-in component; nudge inward gently.
    const nudge = Math.min(0.35, toCup * 0.12);
    const newVel = add(scale(tangent, 0.55), scale(toward, radial + nudge));
    // Energy-safe: never exceed pre-nudge speed after damp.
    const maxSpeed = len(ball.vel) + 1e-6;
    const nv = len(newVel);
    ball.vel = nv > maxSpeed ? scale(newVel, maxSpeed / nv) : newVel;
  }

  const speed = len(ball.vel);

  // Residence timer while deep in the cup.
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

  for (let i = 0; i < steps; i++) {
    if (ball.sunk) return;

    ball.pos = add(ball.pos, scale(ball.vel, h * 60));

    // Bounds as soft walls (course border is in walls usually)
    const margin = ball.radius;
    if (ball.pos.x < margin) {
      ball.pos.x = margin;
      ball.vel.x = Math.abs(ball.vel.x) * 0.72;
    }
    if (ball.pos.x > hole.width - margin) {
      ball.pos.x = hole.width - margin;
      ball.vel.x = -Math.abs(ball.vel.x) * 0.72;
    }
    if (ball.pos.y < margin) {
      ball.pos.y = margin;
      ball.vel.y = Math.abs(ball.vel.y) * 0.72;
    }
    if (ball.pos.y > hole.height - margin) {
      ball.pos.y = hole.height - margin;
      ball.vel.y = -Math.abs(ball.vel.y) * 0.72;
    }

    collideWalls(ball, hole.walls);
    for (const bumper of hole.bumpers) collideBumper(ball, bumper);

    const zone = zoneAt(hole.zones, ball.pos);
    let friction = FRICTION;
    if (zone) {
      if (zone.kind === 'water') {
        // Reset toward tee gently — treat as hazard bounce back
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
