import type { Bumper, CourseProp, HoleDef, Ramp, Vec2, Wall, Zone } from '../types';
import { add, clamp, dist, dot, len, scale, sub } from './math';
import { polyBounds, sampleDownhill } from '../levels/topo';
import { WIND_MAX_MPH } from '../levels/generate';

export const BALL_RADIUS = 8;
export const FRICTION = 0.985;
export const MIN_SPEED = 0.08;
export const MAX_PUTT_POWER = 14;
/** Max speed at which a ball over the cup sinks immediately. Slightly forgiving. */
export const CUP_SINK_SPEED = 2.8;
/** Frames of residence (at ~60Hz sim scale) needed to sink while center is deep in cup. */
export const CUP_RESIDENCE_FRAMES = 8;
/** Capture damping when ball center is inside the cup (energy-safe). */
export const CUP_DAMP = 0.78;
/** Max fraction of cup radius for "deep" residence capture. */
export const CUP_DEEP_FRAC = 0.9;
/**
 * Crosswind at full 25 mph — readable but secondary to topo break.
 */
export const WIND_CROSS = 0.016;
/** Weaker along-track wind (head/tail). */
export const WIND_ALONG = 0.0045;
/** Speed (px/frame-ish) at which wind reaches full strength. Weaker near stop. */
export const WIND_SPEED_REF = 7.5;
/**
 * Gravity-style scale for topo break: a ≈ SLOPE_G * (−∇h · L).
 * Tuned so medium putts break/speed-up/slow-down obviously; stronger than wind.
 */
export const SLOPE_G = 0.145;
/** Cap on scaled downhill magnitude (after ·L). Keeps extreme bumps playable. */
export const SLOPE_GRAD_CAP = 0.9;
/** Radius multiplier around cup where slope force is faded so cups still capture. */
export const CUP_SLOPE_FADE = 2.4;
/** Legacy alias — some UI may reference SLOPE_ACCEL. */
export const SLOPE_ACCEL = SLOPE_G;

export type BallState = {
  pos: Vec2;
  vel: Vec2;
  sunk: boolean;
  radius: number;
  hazard?: boolean;
  /** Consecutive substeps with center deep inside the cup. */
  cupResidence?: number;
  /** Remaining airborne time (seconds). */
  airborne?: number;
  /** Visual hop height 0–1 while airborne. */
  airHeight?: number;
  /** Suppress re-triggering the same ramp until clear. */
  rampCooldown?: number;
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

    const ex = b.x - a.x;
    const ey = b.y - a.y;
    let nx = -ey;
    let ny = ex;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const mx = (a.x + b.x) / 2 + nx * 2;
    const my = (a.y + b.y) / 2 + ny * 2;
    if (pointInPoly(mx, my, green)) {
      nx = -nx;
      ny = -ny;
    }
    const inx = -nx;
    const iny = -ny;

    if (!inside) {
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

  if (!inside) {
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
    ball.airborne = 0;
    ball.airHeight = 0;
    return true;
  }

  return false;
}

function inRamp(ball: BallState, ramp: Ramp): boolean {
  return (
    ball.pos.x >= ramp.x &&
    ball.pos.x <= ramp.x + ramp.w &&
    ball.pos.y >= ramp.y &&
    ball.pos.y <= ramp.y + ramp.h
  );
}

function tryLaunchRamp(ball: BallState, ramp: Ramp): void {
  if ((ball.airborne ?? 0) > 0) return;
  if ((ball.rampCooldown ?? 0) > 0) return;
  if (!inRamp(ball, ramp)) return;
  const speed = len(ball.vel);
  if (speed < ramp.minSpeed) return;
  const inv = 1 / speed;
  const align = ball.vel.x * inv * ramp.dir.x + ball.vel.y * inv * ramp.dir.y;
  if (align < 0.55) return;
  // Launch
  const launchSpeed = Math.max(speed * ramp.boost, ramp.minSpeed * 1.05);
  ball.vel = scale(ramp.dir, launchSpeed);
  const airT = Math.max(0.22, ramp.gap / (launchSpeed * 60));
  ball.airborne = airT;
  ball.airHeight = 1;
  ball.rampCooldown = airT + 0.35;
}

/** Rotating windmill blades as thin colliding segments (gap is passable). */
function collideWindmills(ball: BallState, props: CourseProp[], nowSec: number): void {
  for (const p of props) {
    if (p.kind !== 'windmill') continue;
    const blades = p.blades ?? 4;
    const base = nowSec * p.rps * Math.PI * 2;
    const bladeHalf = 0.14; // rad thickness approx via point test
    for (let i = 0; i < blades; i++) {
      const ang = base + (i * Math.PI * 2) / blades;
      // Gap centered between blades — skip if ball is in open sector near hub
      const toBall = Math.atan2(ball.pos.y - p.y, ball.pos.x - p.x);
      let dAng = toBall - ang;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      while (dAng < -Math.PI) dAng += Math.PI * 2;
      // Open gap is opposite each blade? Actually gapHalf is open around angles between blades
      // Treat blade as blocking when |dAng| < blade half-width; gap is the rest near hub only
      if (Math.abs(dAng) > bladeHalf + 0.08) continue;

      const distHub = Math.hypot(ball.pos.x - p.x, ball.pos.y - p.y);
      if (distHub < p.r * 0.85 || distHub > p.bladeLen + ball.radius) continue;

      // Push off blade along perpendicular to blade axis
      const bx = Math.cos(ang);
      const by = Math.sin(ang);
      // Closest point on blade segment
      const t = clamp(
        ((ball.pos.x - p.x) * bx + (ball.pos.y - p.y) * by),
        p.r,
        p.bladeLen,
      );
      const cx = p.x + bx * t;
      const cy = p.y + by * t;
      const dx = ball.pos.x - cx;
      const dy = ball.pos.y - cy;
      const d = Math.hypot(dx, dy);
      const thick = 10;
      if (d >= ball.radius + thick || d < 1e-6) continue;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = ball.radius + thick - d;
      ball.pos = { x: ball.pos.x + nx * overlap, y: ball.pos.y + ny * overlap };
      ball.vel = reflectVelocity(ball.vel, { x: nx, y: ny }, 0.65);
    }
  }
}

/** Volcano hub acts as a solid rock circle. */
function collideVolcanoHub(ball: BallState, props: CourseProp[]): void {
  for (const p of props) {
    if (p.kind !== 'volcano' && p.kind !== 'rock') continue;
    const hubR = p.kind === 'volcano' ? p.r * 0.55 : p.r;
    const d = Math.hypot(ball.pos.x - p.x, ball.pos.y - p.y);
    const minD = ball.radius + hubR;
    if (d >= minD || d < 1e-6) continue;
    const n = { x: (ball.pos.x - p.x) / d, y: (ball.pos.y - p.y) / d };
    ball.pos = { x: p.x + n.x * (minD + 0.5), y: p.y + n.y * (minD + 0.5) };
    ball.vel = reflectVelocity(ball.vel, n, 0.7);
  }
}

function resetHazard(ball: BallState, hole: HoleDef): void {
  ball.pos = { x: hole.tee.x, y: hole.tee.y };
  ball.vel = { x: 0, y: 0 };
  ball.hazard = true;
  ball.cupResidence = 0;
  ball.airborne = 0;
  ball.airHeight = 0;
}

export function createBall(tee: Vec2): BallState {
  return {
    pos: { x: tee.x, y: tee.y },
    vel: { x: 0, y: 0 },
    sunk: false,
    radius: BALL_RADIUS,
    cupResidence: 0,
    airborne: 0,
    airHeight: 0,
    rampCooldown: 0,
  };
}

export function isMoving(ball: BallState): boolean {
  return !ball.sunk && (len(ball.vel) > MIN_SPEED || (ball.airborne ?? 0) > 0);
}

export function stepBall(ball: BallState, hole: HoleDef, dt: number): void {
  if (ball.sunk) return;

  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  const green =
    hole.green?.length >= 3
      ? hole.green
      : [
          { x: 0, y: 0 },
          { x: hole.width, y: 0 },
          { x: hole.width, y: hole.height },
          { x: 0, y: hole.height },
        ];
  const nowSec = performance.now() / 1000;
  const props = hole.props ?? [];
  const ramps = hole.ramps ?? [];

  for (let i = 0; i < steps; i++) {
    if (ball.sunk) return;

    if ((ball.rampCooldown ?? 0) > 0) {
      ball.rampCooldown = Math.max(0, (ball.rampCooldown ?? 0) - h);
    }

    const flying = (ball.airborne ?? 0) > 0;

    // Green break from height field (same field as the Green Map overlay).
    // force ≈ −g · ∇h (via sampleDownhill which returns −∇h·L). Stronger than wind.
    // Skipped while airborne. Faded near the cup so slope cannot spit balls out.
    let slopePull = 0;
    if (!flying && hole.topo) {
      const bounds = polyBounds(green);
      const downhill = sampleDownhill(hole.topo, ball.pos.x, ball.pos.y, bounds);
      const dm = Math.hypot(downhill.x, downhill.y);
      if (dm > 1e-8) {
        const capped = Math.min(dm, SLOPE_GRAD_CAP);
        let sx = (downhill.x / dm) * capped;
        let sy = (downhill.y / dm) * capped;
        const toCup = dist(ball.pos, hole.cup);
        const fadeR = hole.cupRadius * CUP_SLOPE_FADE;
        if (toCup < fadeR) {
          // Quadratic fade → 0 at cup center (capture stays fair on sloped greens)
          const fade = (toCup / fadeR) * (toCup / fadeR);
          sx *= fade;
          sy *= fade;
        }
        slopePull = Math.hypot(sx, sy) * SLOPE_G;
        ball.vel = {
          x: ball.vel.x + sx * SLOPE_G * h * 60,
          y: ball.vel.y + sy * SLOPE_G * h * 60,
        };
      }
    } else if (!flying && hole.slope && (hole.slope.x !== 0 || hole.slope.y !== 0)) {
      slopePull = len(hole.slope) * SLOPE_G * 0.55;
      ball.vel = add(ball.vel, scale(hole.slope, SLOPE_G * 0.55 * h * 60));
    }

    // Wind secondary to topo; none while airborne.
    const speedBefore = len(ball.vel);
    const mph = hole.windMph ?? 0;
    const wind = hole.wind;
    if (!flying && speedBefore > MIN_SPEED && mph > 0 && wind) {
      const windFactor = Math.min(1, mph / WIND_MAX_MPH);
      const invSp = 1 / speedBefore;
      const tx = ball.vel.x * invSp;
      const ty = ball.vel.y * invSp;
      const nx = -ty;
      const ny = tx;
      const windLat = wind.x * nx + wind.y * ny;
      const windAlong = wind.x * tx + wind.y * ty;
      const sf = Math.min(1, Math.max(0, (speedBefore - MIN_SPEED) / (WIND_SPEED_REF - MIN_SPEED)));
      const windScale = h * 60 * sf * windFactor;
      ball.vel = {
        x: ball.vel.x + (nx * windLat * WIND_CROSS + tx * windAlong * WIND_ALONG) * windScale,
        y: ball.vel.y + (ny * windLat * WIND_CROSS + ty * windAlong * WIND_ALONG) * windScale,
      };
    }

    // Ramp launch check (grounded only)
    if (!flying) {
      for (const ramp of ramps) tryLaunchRamp(ball, ramp);
    }

    ball.pos = add(ball.pos, scale(ball.vel, h * 60));

    if (flying) {
      ball.airborne = Math.max(0, (ball.airborne ?? 0) - h);
      const t = ball.airborne ?? 0;
      // Parabolic hop visual
      const totalGuess = 0.45;
      const u = Math.min(1, 1 - t / totalGuess);
      ball.airHeight = Math.max(0, 4 * u * (1 - u));
      // Light air drag
      ball.vel = scale(ball.vel, Math.pow(0.995, h * 60));
      // Still bounce off solid hubs / windmill while in air (fair)
      collideVolcanoHub(ball, props);
      collideWindmills(ball, props, nowSec);

      if ((ball.airborne ?? 0) <= 0) {
        ball.airHeight = 0;
        // Landing check — fair failure into water/lava/off-green/sand deep
        if (!pointInPoly(ball.pos.x, ball.pos.y, green)) {
          resetHazard(ball, hole);
          return;
        }
        const landZone = zoneAt(hole.zones, ball.pos);
        if (landZone && (landZone.kind === 'water' || landZone.kind === 'lava')) {
          resetHazard(ball, hole);
          return;
        }
        // Soft sand landing just slows — ok
      }
    } else {
      ball.airHeight = 0;
      collideGreenBoundary(ball, green);
      collideWalls(ball, hole.walls);
      for (const bumper of hole.bumpers) collideBumper(ball, bumper);
      collideVolcanoHub(ball, props);
      collideWindmills(ball, props, nowSec);

      const z = zoneAt(hole.zones, ball.pos);
      let friction = FRICTION;
      if (z) {
        if (z.kind === 'water' || z.kind === 'lava') {
          resetHazard(ball, hole);
          return;
        }
        friction = Math.pow(FRICTION, z.frictionMul);
        if (z.kind === 'ice') friction = 0.994;
      }

      ball.vel = scale(ball.vel, Math.pow(friction, h * 60));
    }

    if (applyCupCapture(ball, hole)) return;

    const speed = len(ball.vel);
    // Only freeze when nearly stopped AND slope cannot keep the ball rolling downhill.
    // A ball released with tiny velocity on a slope must accelerate down the fall line.
    if (
      speed < MIN_SPEED &&
      (ball.airborne ?? 0) <= 0 &&
      slopePull < MIN_SPEED * 0.35
    ) {
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
