import type { CourseProp, GrassPattern, HoleDef, PlayerInfo, Ramp, Vec2, Zone } from '../types';
import type { LeaderboardEntry } from '../leaderboard';
import { BALL_RADIUS } from '../physics/world';
import { len } from '../physics/math';
import { THEMES, type HoleTheme } from '../levels/themes';
import { WIND_MAX_MPH } from '../levels/generate';
import {
  polyBounds as topoBounds,
  sampleHeight,
  sampleDownhill,
  sampleSteepness,
} from '../levels/topo';

const SAND = '#e8d5a3';
const SAND_DARK = '#d4bc80';
const ICE = '#b8e0f0';
const WATER = '#2a7aad';
const CUP_DARK = '#0a0a0a';

/**
 * Tiny world-space rim around the green AABB so curb/theme trim stays visible.
 * Camera fits the green tightly — plaque is an HTML overlay, not canvas chrome.
 */
export const THEME_PAD = 24;

export type AimPreview = {
  from: Vec2;
  to: Vec2;
  power: number;
} | null;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  /** Full canvas size in CSS pixels (fills the play wrap). */
  viewW = 0;
  viewH = 0;
  scale = 1;
  /** CSS-pixel origin of the fitted content (camMin) on the canvas. */
  worldOx = 0;
  worldOy = 0;
  /** World-space top-left of the fitted content (green AABB − rim). */
  camMinX = 0;
  camMinY = 0;
  offsetX = 0;
  offsetY = 0;
  pad = THEME_PAD;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
  }

  private applyWorldTransform(): void {
    this.ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      this.dpr * this.scale,
      this.dpr * (this.worldOx - this.camMinX * this.scale),
      this.dpr * (this.worldOy - this.camMinY * this.scale),
    );
  }

  resize(hole: HoleDef): void {
    const parent = this.canvas.parentElement ?? document.body;
    const maxW = Math.max(1, parent.clientWidth || window.innerWidth);
    const maxH = Math.max(1, (parent.clientHeight || window.innerHeight) - 4);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.pad = THEME_PAD;

    // Canvas fills the wrap — fairway is fitted to dominate the viewport.
    this.viewW = maxW;
    this.viewH = maxH;
    this.canvas.style.width = `${maxW}px`;
    this.canvas.style.height = `${maxH}px`;
    this.canvas.width = Math.floor(maxW * this.dpr);
    this.canvas.height = Math.floor(maxH * this.dpr);

    const greenPoly = hole.green?.length >= 3 ? hole.green : rectPoly(0, 0, hole.width, hole.height);
    const gb = polyBounds(greenPoly);
    const greenW = Math.max(48, gb.maxX - gb.minX);
    const greenH = Math.max(48, gb.maxY - gb.minY);

    // Fit the green AABB itself to the viewport (tiny CSS inset only). Theme rim may
    // sit partially off-screen — fairway dominates; plaque is HTML outside the green.
    const inset = 4;
    const playW = Math.max(64, maxW - inset * 2);
    const playH = Math.max(64, maxH - inset * 2);
    const fit = Math.min(playW / greenW, playH / greenH);
    const worldViewW = greenW * fit;
    const worldViewH = greenH * fit;
    const ox = (maxW - worldViewW) / 2;
    const oy = (maxH - worldViewH) / 2;

    this.scale = fit;
    // Camera origin = green top-left (no world rim reserved in the fit).
    this.camMinX = gb.minX;
    this.camMinY = gb.minY;
    this.worldOx = ox;
    this.worldOy = oy;
    this.offsetX = ox;
    this.offsetY = oy;
    // Keep a draw pad for surround/trim, but it no longer shrinks the fairway.
    this.pad = THEME_PAD;

    this.applyWorldTransform();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.worldOx) / this.scale + this.camMinX,
      y: (clientY - rect.top - this.worldOy) / this.scale + this.camMinY,
    };
  }

  /** Enter CSS-pixel screen space (0,0 = canvas top-left). */
  private beginScreenSpace(): void {
    this.ctx.save();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private endScreenSpace(): void {
    this.ctx.restore();
  }

  /** Project a world point to CSS canvas pixels. */
  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: this.worldOx + (wx - this.camMinX) * this.scale,
      y: this.worldOy + (wy - this.camMinY) * this.scale,
    };
  }

  /** CSS-pixel screen rect of the playable green AABB (for HTML plaque placement). */
  greenScreenRect(hole: HoleDef): { minX: number; minY: number; maxX: number; maxY: number } {
    const greenPoly = hole.green?.length >= 3 ? hole.green : rectPoly(0, 0, hole.width, hole.height);
    const gb = polyBounds(greenPoly);
    const g0 = this.worldToScreen(gb.minX, gb.minY);
    const g1 = this.worldToScreen(gb.maxX, gb.maxY);
    return { minX: g0.x, minY: g0.y, maxX: g1.x, maxY: g1.y };
  }

  draw(
    hole: HoleDef,
    players: PlayerInfo[],
    localId: string,
    aim: AimPreview,
    highlightId: string | null,
    showGreenMap = false,
  ): void {
    const ctx = this.ctx;
    const theme = THEMES[hole.theme] ?? THEMES.tropical;
    const pad = this.pad;
    const green = hole.green?.length >= 3 ? hole.green : rectPoly(0, 0, hole.width, hole.height);

    // Fill any canvas chrome outside the fitted board with theme backdrop.
    this.beginScreenSpace();
    const bg = ctx.createLinearGradient(0, 0, this.viewW, this.viewH);
    bg.addColorStop(0, theme.outside);
    bg.addColorStop(1, theme.outsideAlt);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    this.endScreenSpace();

    this.applyWorldTransform();

    const gb = polyBounds(green);
    ctx.clearRect(
      this.camMinX - 4,
      this.camMinY - 4,
      gb.maxX - this.camMinX + pad + 8,
      gb.maxY - this.camMinY + pad + 8,
    );

    // Themed surroundings fill everything; green is clipped on top
    drawThemeSurround(ctx, hole, theme, pad, green);

    // Playable grass clipped to green polygon
    ctx.save();
    pathPoly(ctx, green);
    ctx.clip();
    drawGrass(ctx, hole, green);
    if (showGreenMap && hole.topo) {
      drawGreenMapOverlay(ctx, hole, green);
    } else {
      // Subtle always-on break cues (much quieter than full topo book)
      drawSlopeCues(ctx, hole, green, true);
    }
    // Soft inner shadow along green
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 8;
    pathPoly(ctx, green);
    ctx.stroke();
    ctx.restore();

    // Green curb / bevel rim
    drawGreenRim(ctx, green, theme);

    // Ramps (under zones visually but readable)
    for (const ramp of hole.ramps ?? []) drawRamp(ctx, ramp);

    // Zones (hazards) — clipped to green visually via draw order
    ctx.save();
    pathPoly(ctx, green);
    ctx.clip();
    for (const z of hole.zones) drawZone(ctx, z);
    ctx.restore();

    drawTeePad(ctx, hole);
    drawCup(ctx, hole.cup.x, hole.cup.y, hole.cupRadius);

    for (const w of hole.walls) {
      drawWall(ctx, w.x, w.y, w.w, w.h, theme);
    }

    for (const prop of hole.props ?? []) drawCourseProp(ctx, prop, performance.now() / 1000);

    drawThemeTrim(ctx, hole, theme, green);

    for (const b of hole.bumpers) {
      drawBumper(ctx, b.x, b.y, b.r, theme);
    }

    if (aim && aim.power > 0.02) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + aim.power * 0.5})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(aim.from.x, aim.from.y);
      ctx.lineTo(aim.to.x, aim.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = powerColor(aim.power);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(aim.from.x, aim.from.y, BALL_RADIUS + 10 + aim.power * 18, -Math.PI / 2, -Math.PI / 2 + aim.power * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const sorted = [...players].sort((a, b) => (a.id === localId ? 1 : 0) - (b.id === localId ? 1 : 0));
    for (const p of sorted) {
      if (p.sunk) ctx.globalAlpha = 0.35;
      const r = BALL_RADIUS;
      const hop = (p as PlayerInfo & { airHeight?: number }).airHeight ?? 0;
      const lift = hop * 16;
      const drawX = p.ball.x;
      const drawY = p.ball.y - lift;
      if (hop > 0.05) {
        ctx.fillStyle = `rgba(0,0,0,${0.22 + hop * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(p.ball.x, p.ball.y + 2, r * (1.15 - hop * 0.35), r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawGolfBall(ctx, drawX, drawY, r * (1 + hop * 0.18), p.color);
      if (highlightId === p.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(drawX, drawY, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const label = p.name;
      ctx.font = '600 11px system-ui,sans-serif';
      const tw = ctx.measureText(label).width;
      roundRect(ctx, drawX - tw / 2 - 4, drawY - r - 22, tw + 8, 14, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, drawX, drawY - r - 15);
    }

    for (const p of players) {
      const speed = len(p.vel);
      if (speed < 0.5 || p.sunk) continue;
      ctx.strokeStyle =
        p.color === 'galactic' || p.color === '#galactic'
          ? 'rgba(140,100,255,0.35)'
          : `${p.color}55`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.ball.x, p.ball.y);
      ctx.lineTo(p.ball.x - p.vel.x * 2, p.ball.y - p.vel.y * 2);
      ctx.stroke();
    }

    // Plaque / hole name / wind UI live in HTML overlay — canvas stays fairway-first.
    this.applyWorldTransform();
  }
}

function rectPoly(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function pathPoly(ctx: CanvasRenderingContext2D, poly: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function drawGrass(ctx: CanvasRenderingContext2D, hole: HoleDef, green: Vec2[]): void {
  const g: GrassPattern = hole.grass ?? {
    kind: 'carpet',
    width: 18,
    angle: 0,
    a: '#2f9b56',
    b: '#288a4b',
    sheen: '#3aad62',
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of green) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bw = maxX - minX + 8;
  const bh = maxY - minY + 8;

  // Base nap fill
  ctx.fillStyle = g.a;
  ctx.fillRect(minX - 4, minY - 4, bw, bh);

  if (g.kind === 'carpet' || g.kind === 'mow' || g.kind === 'stripes') {
    const ang = 'angle' in g ? g.angle : 0;
    const w = 'width' in g ? g.width : 18;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const span = Math.hypot(maxX - minX, maxY - minY) + 80;
    // Soft directional mow bands (low contrast — short-nap carpet)
    for (let i = -span; i < span; i += w * 2) {
      ctx.fillStyle = g.b;
      ctx.globalAlpha = g.kind === 'stripes' ? 0.85 : 0.28;
      ctx.fillRect(i, -span, w, span * 2);
    }
    // Finer grain lines for carpet texture
    if (g.kind === 'carpet' || g.kind === 'mow') {
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = g.b;
      ctx.lineWidth = 1;
      for (let i = -span; i < span; i += 3.5) {
        ctx.beginPath();
        ctx.moveTo(i, -span);
        ctx.lineTo(i, span);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Nap sheen — soft anisotropic highlight along mow
    ctx.save();
    const sheenColor = g.kind === 'carpet' ? g.sheen : g.a;
    const sg = ctx.createLinearGradient(minX, minY, maxX, maxY);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.35, hexAlpha(sheenColor, 0.14));
    sg.addColorStop(0.55, 'rgba(255,255,255,0.06)');
    sg.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = sg;
    ctx.fillRect(minX - 4, minY - 4, bw, bh);
    ctx.restore();
  } else if (g.kind === 'checker') {
    const tile = g.tile;
    for (let y = Math.floor(minY / tile) * tile; y < maxY; y += tile) {
      for (let x = Math.floor(minX / tile) * tile; x < maxX; x += tile) {
        if ((((x / tile) | 0) + ((y / tile) | 0)) % 2 === 0) {
          ctx.fillStyle = g.b;
          ctx.fillRect(x, y, tile, tile);
        }
      }
    }
  } else if (g.kind === 'diamonds') {
    const s = g.size;
    ctx.fillStyle = g.b;
    ctx.globalAlpha = 0.35;
    for (let y = minY - s; y < maxY + s; y += s) {
      for (let x = minX - s; x < maxX + s; x += s) {
        const ox = ((Math.floor(y / s) % 2) * s) / 2;
        ctx.beginPath();
        ctx.moveTo(x + ox, y);
        ctx.lineTo(x + ox + s / 2, y + s / 2);
        ctx.lineTo(x + ox, y + s);
        ctx.lineTo(x + ox - s / 2, y + s / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  } else if (g.kind === 'noise') {
    const scale = g.scale;
    const seed = hole.id * 9973;
    for (let y = minY; y < maxY; y += scale) {
      for (let x = minX; x < maxX; x += scale) {
        const n = hash2(seed, x, y);
        ctx.fillStyle = n < 0.33 ? g.a : n < 0.66 ? g.b : g.c;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x, y, scale + 0.5, scale + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  } else if (g.kind === 'rings') {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const maxR = Math.hypot(maxX - minX, maxY - minY);
    for (let r = g.spacing; r < maxR; r += g.spacing * 2) {
      ctx.strokeStyle = g.b;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = g.spacing;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Soft contact-shadow vignette at cut edge (reads as thick carpet pile)
  ctx.save();
  pathPoly(ctx, green);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,40,20,0.2)';
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  pathPoly(ctx, green);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 3;
  pathPoly(ctx, green);
  ctx.stroke();
  ctx.restore();
}

function hash2(seed: number, x: number, y: number): number {
  let n = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function polyBounds(green: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of green) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

type ScreenRect = { minX: number; minY: number; maxX: number; maxY: number };

function boxRect(x: number, y: number, w: number, h: number): ScreenRect {
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

function rectsOverlap(a: ScreenRect, b: ScreenRect, pad = 0): boolean {
  return !(
    a.maxX + pad <= b.minX ||
    b.maxX + pad <= a.minX ||
    a.maxY + pad <= b.minY ||
    b.maxY + pad <= a.minY
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Place a w×h chrome box fully outside the green AABB (and optional avoid
 * rects). Returns null if it cannot fit without covering the fairway.
 */
function placeChromeBox(
  viewW: number,
  viewH: number,
  green: ScreenRect,
  boxW: number,
  boxH: number,
  avoid: ScreenRect[] = [],
  prefer: Array<
    'left' | 'right' | 'bottom' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  > = ['left', 'right', 'bottom', 'top'],
): { x: number; y: number; w: number; h: number } | null {
  const margin = 6;
  const gap = 6;
  if (boxW > viewW - margin * 2 || boxH > viewH - margin * 2) return null;

  const leftPocket = green.minX;
  const rightPocket = viewW - green.maxX;
  const topPocket = green.minY;
  const bottomPocket = viewH - green.maxY;

  const candidates: { x: number; y: number }[] = [];
  const push = (x: number, y: number) => {
    candidates.push({
      x: clamp(x, margin, viewW - boxW - margin),
      y: clamp(y, margin, viewH - boxH - margin),
    });
  };

  for (const p of prefer) {
    if (p === 'left' && leftPocket >= boxW + gap + margin) {
      const x = Math.max(margin, (leftPocket - boxW) / 2);
      push(x, green.minY);
      push(x, (green.minY + green.maxY) / 2 - boxH / 2);
      push(x, green.maxY - boxH);
    } else if (p === 'right' && rightPocket >= boxW + gap + margin) {
      const x = green.maxX + Math.max(gap, (rightPocket - boxW) / 2);
      push(x, green.minY);
      push(x, (green.minY + green.maxY) / 2 - boxH / 2);
      push(x, green.maxY - boxH);
    } else if (p === 'bottom' && bottomPocket >= boxH + gap + margin) {
      const y = green.maxY + Math.max(gap, (bottomPocket - boxH) / 2);
      push((viewW - boxW) / 2, y);
      push(margin, y);
      push(viewW - boxW - margin, y);
    } else if (p === 'top' && topPocket >= boxH + gap + margin) {
      const y = Math.max(margin, (topPocket - boxH) / 2);
      push((viewW - boxW) / 2, y);
      push(margin, y);
      push(viewW - boxW - margin, y);
    } else if (p === 'top-left' && leftPocket >= boxW * 0.55 && topPocket >= boxH * 0.35) {
      push(margin, margin);
    } else if (p === 'top-right' && rightPocket >= boxW * 0.55 && topPocket >= boxH * 0.35) {
      push(viewW - boxW - margin, margin);
    } else if (p === 'bottom-left' && leftPocket >= boxW * 0.55 && bottomPocket >= boxH * 0.35) {
      push(margin, viewH - boxH - margin);
    } else if (p === 'bottom-right' && rightPocket >= boxW * 0.55 && bottomPocket >= boxH * 0.35) {
      push(viewW - boxW - margin, viewH - boxH - margin);
    }
  }

  // Also try literal reserved chrome bands (full-strip left/right/bottom/top).
  push(margin, clamp(green.minY, margin, viewH - boxH - margin));
  push(viewW - boxW - margin, clamp(green.minY, margin, viewH - boxH - margin));
  push(clamp((viewW - boxW) / 2, margin, viewW - boxW - margin), viewH - boxH - margin);
  push(clamp((viewW - boxW) / 2, margin, viewW - boxW - margin), margin);

  for (const c of candidates) {
    const r = boxRect(c.x, c.y, boxW, boxH);
    if (rectsOverlap(r, green, gap)) continue;
    if (avoid.some((a) => rectsOverlap(r, a, 4))) continue;
    return { x: c.x, y: c.y, w: boxW, h: boxH };
  }
  return null;
}

function pointInPolyLocal(px: number, py: number, poly: Vec2[]): boolean {
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

/** Subtle break cues when Green Map is off (topo still affects physics). */
function drawSlopeCues(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  green: Vec2[],
  subtle = false,
): void {
  const s = hole.slope;
  if (!s || (s.x === 0 && s.y === 0)) return;
  const mag = Math.hypot(s.x, s.y);
  if (mag < 0.08) return;

  const { minX, minY, maxX, maxY, cx, cy } = polyBounds(green);
  const dx = s.x / mag;
  const dy = s.y / mag;
  const px = -dy;
  const py = dx;
  const span = Math.hypot(maxX - minX, maxY - minY) + 40;
  const strength = Math.min(1, mag / 1.1);
  const alphaMul = subtle ? 0.35 : 1;

  ctx.save();
  const gx0 = cx - dx * span * 0.35;
  const gy0 = cy - dy * span * 0.35;
  const gx1 = cx + dx * span * 0.35;
  const gy1 = cy + dy * span * 0.35;
  const tint = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  tint.addColorStop(0, `rgba(255,255,220,${(0.05 + strength * 0.06) * alphaMul})`);
  tint.addColorStop(0.45, 'rgba(0,0,0,0)');
  tint.addColorStop(1, `rgba(0,40,20,${(0.08 + strength * 0.1) * alphaMul})`);
  ctx.fillStyle = tint;
  ctx.fillRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8);

  if (!subtle) {
    const spacing = 28 + (1 - strength) * 18;
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + strength * 0.18})`;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 7]);
    for (let i = -8; i <= 8; i++) {
      if (i === 0) continue;
      const ox = cx + dx * i * spacing;
      const oy = cy + dy * i * spacing;
      ctx.beginPath();
      ctx.moveTo(ox - px * span, oy - py * span);
      ctx.lineTo(ox + px * span, oy + py * span);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Few downhill chevrons
  const arrowCount = subtle ? 2 : 3 + Math.floor(strength * 2);
  ctx.fillStyle = `rgba(255, 230, 140, ${(0.2 + strength * 0.25) * alphaMul})`;
  ctx.strokeStyle = `rgba(40, 30, 0, ${(0.25 + strength * 0.2) * alphaMul})`;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < arrowCount; i++) {
    const t = (i + 1) / (arrowCount + 1);
    const along = (t - 0.5) * span * 0.55;
    const ax = cx + px * along * 0.35 - dx * span * 0.05;
    const ay = cy + py * along * 0.35 - dy * span * 0.05;
    if (!pointInPolyLocal(ax, ay, green)) continue;
    drawChevron(ctx, ax, ay, dx, dy, 6 + strength * 4);
  }
  ctx.restore();
}

/**
 * Elevation heatmap stops: purple (lowest) → blue → green → yellow → orange → red (highest).
 * Contours/arrows stay professional; only the fill scale uses these colors.
 */
function elevationHeatRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [128, 60, 180], // purple — lowest
    [50, 100, 220], // blue
    [40, 170, 90], // green
    [230, 210, 50], // yellow
    [240, 140, 40], // orange
    [220, 50, 50], // red — highest
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/**
 * StrackaLine / green-book overlay from the SAME height field as physics.
 * Soft elevation heatmap (purple low → red high), neat contour isolines,
 * small downhill tick-arrows. Low opacity so carpet still reads.
 */
function drawGreenMapOverlay(ctx: CanvasRenderingContext2D, hole: HoleDef, green: Vec2[]): void {
  const topo = hole.topo;
  if (!topo) return;
  const bounds = topoBounds(green);
  const { minX, minY, maxX, maxY } = bounds;
  const gw = maxX - minX || 1;
  const gh = maxY - minY || 1;
  // Finer sample grid for smooth professional look
  const step = Math.max(8, Math.min(12, Math.round(Math.min(gw, gh) / 48)));

  let minH = Infinity;
  let maxH = -Infinity;
  let maxSteep = 0.001;
  const cols = Math.floor(gw / step) + 1;
  const rows = Math.floor(gh / step) + 1;
  // Sparse sample list for heatmap + range
  type Cell = { x: number; y: number; h: number; steep: number; inside: boolean };
  const grid: Cell[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = minX + i * step;
      const y = minY + j * step;
      const inside = pointInPolyLocal(x, y, green);
      const h = inside ? sampleHeight(topo, x, y, bounds) : 0;
      const steep = inside ? sampleSteepness(topo, x, y, bounds) : 0;
      grid.push({ x, y, h, steep, inside });
      if (inside) {
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
        maxSteep = Math.max(maxSteep, steep);
      }
    }
  }
  if (!(maxH > minH)) {
    maxH = minH + 1;
  }
  const hRange = maxH - minH;

  ctx.save();

  // --- Soft elevation heatmap (purple low → red high), low opacity ---
  for (const c of grid) {
    if (!c.inside) continue;
    const t = (c.h - minH) / hRange; // 0 low … 1 high
    const [r, gCol, b] = elevationHeatRgb(t);
    const a = 0.12 + t * 0.18; // carpet still reads
    ctx.fillStyle = `rgba(${r},${gCol},${b},${a})`;
    ctx.fillRect(c.x - step / 2, c.y - step / 2, step + 0.5, step + 0.5);
  }

  // Subtle steepness wash on top (warmer where break is strong)
  for (const c of grid) {
    if (!c.inside) continue;
    const s = Math.min(1, c.steep / maxSteep);
    if (s < 0.15) continue;
    ctx.fillStyle = `rgba(210, 90, 40, ${0.04 + s * 0.1})`;
    ctx.fillRect(c.x - step / 2, c.y - step / 2, step + 0.5, step + 0.5);
  }

  // --- Contour isolines (marching squares) at consistent elevation intervals ---
  const nLevels = Math.max(5, Math.min(9, Math.round(hRange / 0.12) + 3));
  const interval = hRange / nLevels;

  // Marching-squares contour segments
  for (let li = 1; li < nLevels; li++) {
    const level = minH + interval * li;
    const major = li % 2 === 0;
    ctx.beginPath();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = grid[j * cols + i];
        const b = grid[j * cols + i + 1];
        const c = grid[(j + 1) * cols + i + 1];
        const d = grid[(j + 1) * cols + i];
        if (!a.inside || !b.inside || !c.inside || !d.inside) continue;
        const corners = [a, b, c, d];
        const above = corners.map((p) => (p.h >= level ? 1 : 0));
        const code = above[0] | (above[1] << 1) | (above[2] << 2) | (above[3] << 3);
        if (code === 0 || code === 15) continue;
        const lerpEdge = (
          p0: Cell,
          p1: Cell,
        ): { x: number; y: number } => {
          const t = Math.abs(p1.h - p0.h) < 1e-9 ? 0.5 : (level - p0.h) / (p1.h - p0.h);
          return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
        };
        const top = lerpEdge(a, b);
        const right = lerpEdge(b, c);
        const bottom = lerpEdge(d, c);
        const left = lerpEdge(a, d);
        const seg = (p: { x: number; y: number }, q: { x: number; y: number }) => {
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
        };
        // Standard MS cases (incl. simple saddles)
        switch (code) {
          case 1:
          case 14:
            seg(left, top);
            break;
          case 2:
          case 13:
            seg(top, right);
            break;
          case 3:
          case 12:
            seg(left, right);
            break;
          case 4:
          case 11:
            seg(right, bottom);
            break;
          case 6:
          case 9:
            seg(top, bottom);
            break;
          case 7:
          case 8:
            seg(left, bottom);
            break;
          case 5:
            seg(left, top);
            seg(right, bottom);
            break;
          case 10:
            seg(top, right);
            seg(left, bottom);
            break;
          default:
            break;
        }
      }
    }
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.5)' : 'rgba(250,250,245,0.32)';
    ctx.lineWidth = major ? 1.2 : 0.8;
    ctx.stroke();
  }

  // --- Small neat downhill ticks (not cheesy chevrons) ---
  const aStep = step * 3.2;
  for (let y = minY + aStep * 0.5; y <= maxY; y += aStep) {
    for (let x = minX + aStep * 0.5; x <= maxX; x += aStep) {
      if (!pointInPolyLocal(x, y, green)) continue;
      const d = sampleDownhill(topo, x, y, bounds);
      const dm = Math.hypot(d.x, d.y);
      if (dm < 0.08) continue;
      const dx = d.x / dm;
      const dy = d.y / dm;
      const tickLen = 5 + Math.min(1, dm / maxSteep) * 5;
      // shaft
      ctx.strokeStyle = 'rgba(30, 40, 55, 0.55)';
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(x - dx * tickLen * 0.35, y - dy * tickLen * 0.35);
      ctx.lineTo(x + dx * tickLen * 0.65, y + dy * tickLen * 0.65);
      ctx.stroke();
      // tiny arrowhead
      const px = -dy;
      const py = dx;
      const tipX = x + dx * tickLen * 0.65;
      const tipY = y + dy * tickLen * 0.65;
      const ah = 2.6 + Math.min(1, dm / maxSteep);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - dx * ah + px * ah * 0.7, tipY - dy * ah + py * ah * 0.7);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - dx * ah - px * ah * 0.7, tipY - dy * ah - py * ah * 0.7);
      ctx.stroke();
    }
  }

  // Compact legend
  const lx = minX + 8;
  const ly = maxY - 36;
  ctx.fillStyle = 'rgba(12, 20, 32, 0.55)';
  roundRect(ctx, lx, ly, 132, 30, 6);
  ctx.fill();
  // mini gradient bar (same purple→…→red scale)
  for (let i = 0; i < 40; i++) {
    const t = i / 39;
    const [r, gCol, b] = elevationHeatRgb(t);
    ctx.fillStyle = `rgba(${r},${gCol},${b},0.85)`;
    ctx.fillRect(lx + 8 + i * 1.15, ly + 7, 1.3, 8);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '600 9px system-ui,sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('low', lx + 8, ly + 22);
  ctx.textAlign = 'right';
  ctx.fillText('high', lx + 54, ly + 22);
  ctx.textAlign = 'left';
  ctx.fillText('· contours · break', lx + 62, ly + 15);

  ctx.restore();
}

function drawChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  size: number,
): void {
  const px = -dy;
  const py = dx;
  ctx.beginPath();
  ctx.moveTo(x - dx * size * 0.2 + px * size * 0.7, y - dy * size * 0.2 + py * size * 0.7);
  ctx.lineTo(x + dx * size * 0.85, y + dy * size * 0.85);
  ctx.lineTo(x - dx * size * 0.2 - px * size * 0.7, y - dy * size * 0.2 - py * size * 0.7);
  ctx.stroke();
}

/** Compact combined hole-title headline in CSS-pixel chrome (same copy as plaque). */
function drawThemeHeadline(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  theme: HoleTheme,
  viewW: number,
  _viewH: number,
  green: ScreenRect,
): void {
  const label = hole.name.toUpperCase();
  const nowSec = performance.now() / 1000;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Compact but still “pop” — fairway keeps the pixels.
  const iconR = Math.round(Math.min(14, Math.max(10, viewW * 0.02)));
  let size = Math.round(Math.min(26, Math.max(15, viewW * 0.038)));
  ctx.font = `900 ${size}px system-ui,sans-serif`;
  const maxText = Math.max(80, viewW - 24 - (iconR * 2 + 18) * 2);
  while (size > 13 && ctx.measureText(label).width > maxText) {
    size -= 1;
    ctx.font = `900 ${size}px system-ui,sans-serif`;
  }

  const tw = ctx.measureText(label).width;
  const padX = 12;
  let boxW = tw + padX * 2 + (iconR * 2 + 10) * 2;
  let boxH = Math.max(size + 10, iconR * 2 + 6);
  // Never cover the green — sit fully in the top chrome strip.
  const maxBottom = green.minY - 6;
  if (boxH > maxBottom - 4) {
    boxH = Math.max(18, maxBottom - 4);
    size = Math.min(size, Math.max(12, boxH - 10));
    ctx.font = `900 ${size}px system-ui,sans-serif`;
  }
  const y = Math.max(boxH / 2 + 3, Math.min(maxBottom - boxH / 2, boxH / 2 + 4));
  const x = viewW / 2;
  // If the plate would still nick the green, shrink width emblems away.
  if (y + boxH / 2 > green.minY - 4) {
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 10);
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.5 + Math.sin(nowSec * 2.4) * 0.1;
  ctx.lineWidth = 1.75;
  roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 10);
  ctx.stroke();
  ctx.globalAlpha = 1;

  drawHoleTitleEmblem(ctx, hole, theme, x - tw / 2 - padX / 2 - iconR, y, iconR, nowSec);
  drawHoleTitleEmblem(ctx, hole, theme, x + tw / 2 + padX / 2 + iconR, y, iconR, nowSec);

  const pulse = 0.5 + Math.sin(nowSec * 3.1) * 0.2;
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 8 + pulse * 6;
  ctx.shadowOffsetY = 0;

  const shimmer = (Math.sin(nowSec * 2.2) + 1) * 0.5;
  const grad = ctx.createLinearGradient(x - tw / 2, y - size / 2, x + tw / 2, y + size / 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(Math.max(0.08, 0.25 + shimmer * 0.35), theme.trim);
  grad.addColorStop(Math.min(0.92, 0.55 + shimmer * 0.3), theme.accent);
  grad.addColorStop(1, theme.trim);
  ctx.fillStyle = grad;
  ctx.letterSpacing = '0.06em';
  ctx.font = `900 ${size}px system-ui,sans-serif`;
  ctx.fillText(label, x, y + 1);
  ctx.shadowBlur = 0;

  ctx.lineWidth = Math.max(1.25, size * 0.045);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(label, x, y + 1);

  ctx.globalAlpha = 0.3 + shimmer * 0.2;
  ctx.lineWidth = Math.max(0.8, size * 0.02);
  ctx.strokeStyle = theme.trim;
  ctx.strokeText(label, x, y + 1);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Tiny canvas emblem beside the hole title — no external assets. */
function drawHoleTitleEmblem(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  theme: HoleTheme,
  cx: number,
  cy: number,
  r: number,
  nowSec: number,
): void {
  const feats = hole.features ?? [];
  let kind: string = theme.decor;
  if (feats.includes('windmill') || hole.props?.some((p) => p.kind === 'windmill')) kind = 'windmill';
  else if (feats.includes('volcano') || hole.props?.some((p) => p.kind === 'volcano')) kind = 'volcano';
  else if (feats.includes('water') || theme.decor === 'waves') kind = 'waves';
  else if (feats.includes('ramp') || feats.includes('jump')) kind = 'ramp';
  else if (theme.id === 'neon') kind = 'neon';
  else if (theme.id === 'space') kind = 'stars';
  else if (theme.id === 'candy') kind = 'candy';
  else if (theme.id === 'desert') kind = 'cacti';
  else if (theme.id === 'tropical') kind = 'palms';
  else if (theme.id === 'autumn') kind = 'leaves';
  else if (theme.id === 'castle') kind = 'stones';
  else if (theme.id === 'arctic') kind = 'snow';
  else if (theme.id === 'pirate') kind = 'waves';

  ctx.save();
  ctx.translate(cx, cy);
  const spin = Math.sin(nowSec * 1.6) * 0.08;
  ctx.rotate(spin);

  // Disc backing
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = theme.trim;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = theme.accent;
  ctx.strokeStyle = theme.trim;
  ctx.lineWidth = 1.75;

  switch (kind) {
    case 'windmill': {
      ctx.fillStyle = theme.trim;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(2, r * 0.18);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + nowSec * 1.2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
        ctx.lineTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
        ctx.stroke();
      }
      break;
    }
    case 'volcano': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, r * 0.55);
      ctx.lineTo(-r * 0.15, -r * 0.35);
      ctx.lineTo(0, -r * 0.05);
      ctx.lineTo(r * 0.15, -r * 0.35);
      ctx.lineTo(r * 0.7, r * 0.55);
      ctx.closePath();
      ctx.fillStyle = '#5a3030';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.2);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(r * 0.12, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'waves': {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(2, r * 0.16);
      for (let i = 0; i < 3; i++) {
        const yy = -r * 0.35 + i * r * 0.35;
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, yy);
        ctx.quadraticCurveTo(-r * 0.35, yy - r * 0.22, 0, yy);
        ctx.quadraticCurveTo(r * 0.35, yy + r * 0.22, r * 0.7, yy);
        ctx.stroke();
      }
      break;
    }
    case 'ramp': {
      ctx.fillStyle = theme.trim;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, r * 0.45);
      ctx.lineTo(r * 0.15, -r * 0.55);
      ctx.lineTo(r * 0.7, -r * 0.55);
      ctx.lineTo(r * 0.7, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.stroke();
      // ball arc hint
      ctx.beginPath();
      ctx.arc(r * 0.15, -r * 0.2, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = theme.accent;
      ctx.fill();
      break;
    }
    case 'neon': {
      ctx.strokeStyle = theme.accent;
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.strokeRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.9);
      ctx.strokeStyle = theme.trim;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.15);
      ctx.lineTo(0, -r * 0.35);
      ctx.lineTo(r * 0.2, r * 0.15);
      ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }
    case 'stars': {
      ctx.fillStyle = theme.trim;
      for (const [sx, sy, sr] of [
        [0, -0.15, 0.35],
        [-0.45, 0.35, 0.18],
        [0.48, 0.28, 0.16],
      ] as const) {
        drawStar(ctx, sx * r, sy * r, sr * r, 5);
      }
      break;
    }
    case 'candy': {
      ctx.rotate(nowSec * 0.8);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? theme.accent : theme.trim;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r * 0.7, (i * Math.PI) / 3, ((i + 1) * Math.PI) / 3);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'cacti': {
      ctx.fillStyle = '#2f8f4e';
      ctx.fillRect(-r * 0.12, -r * 0.55, r * 0.24, r * 1.1);
      ctx.fillRect(-r * 0.5, -r * 0.1, r * 0.38, r * 0.18);
      ctx.fillRect(r * 0.12, r * 0.05, r * 0.38, r * 0.18);
      ctx.fillRect(-r * 0.5, -r * 0.35, r * 0.18, r * 0.28);
      ctx.fillRect(r * 0.32, -r * 0.2, r * 0.18, r * 0.28);
      break;
    }
    case 'palms': {
      ctx.strokeStyle = '#6b4226';
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.beginPath();
      ctx.moveTo(0, r * 0.65);
      ctx.quadraticCurveTo(-r * 0.1, 0, 0, -r * 0.2);
      ctx.stroke();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.15);
        ctx.quadraticCurveTo(i * r * 0.35, -r * 0.55, i * r * 0.55, -r * 0.15);
        ctx.stroke();
      }
      break;
    }
    case 'leaves': {
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.65);
      ctx.quadraticCurveTo(r * 0.7, 0, 0, r * 0.65);
      ctx.quadraticCurveTo(-r * 0.7, 0, 0, -r * 0.65);
      ctx.fill();
      ctx.strokeStyle = theme.trim;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(0, r * 0.5);
      ctx.stroke();
      break;
    }
    case 'stones': {
      ctx.fillStyle = theme.trim;
      ctx.fillRect(-r * 0.55, -r * 0.15, r * 1.1, r * 0.55);
      ctx.fillRect(-r * 0.4, -r * 0.55, r * 0.28, r * 0.45);
      ctx.fillRect(r * 0.12, -r * 0.55, r * 0.28, r * 0.45);
      ctx.strokeStyle = theme.accent;
      ctx.strokeRect(-r * 0.55, -r * 0.15, r * 1.1, r * 0.55);
      break;
    }
    case 'snow': {
      ctx.strokeStyle = theme.trim;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * -r * 0.55, Math.sin(a) * -r * 0.55);
        ctx.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.stroke();
      }
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  points: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.4;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Large screen-space wind key — compass + mph, parked outside the green.
 */
function drawWindKeyScreen(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  viewW: number,
  viewH: number,
  green: ScreenRect,
  avoid: ScreenRect[] = [],
): ScreenRect | null {
  const mph = hole.windMph ?? 0;
  const w = hole.wind ?? { x: 1, y: 0 };
  const ang = Math.atan2(w.y, w.x);
  const strength = Math.min(1, mph / WIND_MAX_MPH);

  let boxW = Math.round(Math.min(96, Math.max(76, viewW * 0.14)));
  let boxH = Math.round(boxW + 6);

  let placed =
    placeChromeBox(viewW, viewH, green, boxW, boxH, avoid, [
      'right',
      'left',
      'top-right',
      'top',
      'bottom',
      'bottom-right',
    ]) ??
    placeChromeBox(viewW, viewH, green, (boxW = Math.round(boxW * 0.88)), (boxH = Math.round(boxH * 0.88)), avoid, [
      'right',
      'left',
      'top-right',
      'bottom',
    ]);
  if (!placed) return null;

  const x = placed.x + placed.w / 2;
  const y = placed.y + placed.h / 2;
  boxW = placed.w;
  boxH = placed.h;

  ctx.save();
  ctx.fillStyle = 'rgba(4, 18, 40, 0.88)';
  roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 12);
  ctx.fill();
  ctx.strokeStyle = mph < 0.5
    ? 'rgba(255,255,255,0.35)'
    : `rgba(140, 220, 255, ${0.55 + strength * 0.45})`;
  ctx.lineWidth = 2.25;
  roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 12);
  ctx.stroke();

  ctx.fillStyle = 'rgba(210, 235, 255, 0.98)';
  ctx.font = '900 11px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WIND', x, y - boxH / 2 + 13);

  const ringR = Math.min(boxW, boxH) * 0.2;
  ctx.beginPath();
  ctx.arc(x, y + 1, ringR + 3, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(200, 230, 255, 0.55)';
  ctx.lineWidth = 1.75;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (ringR - 2), y + 1 + Math.sin(a) * (ringR - 2));
    ctx.lineTo(x + Math.cos(a) * (ringR + 3), y + 1 + Math.sin(a) * (ringR + 3));
    ctx.stroke();
  }

  ctx.translate(x, y + 1);
  ctx.rotate(ang);
  const arrowAlpha = mph < 0.5 ? 0.4 : 0.85 + strength * 0.15;
  ctx.fillStyle = `rgba(190,235,255,${arrowAlpha})`;
  ctx.strokeStyle = 'rgba(10,30,55,0.85)';
  ctx.lineWidth = 2;
  const shaft = ringR * 0.85;
  ctx.beginPath();
  ctx.moveTo(-shaft, 0);
  ctx.lineTo(shaft * 0.35, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shaft * 0.15, -ringR * 0.42);
  ctx.lineTo(shaft * 0.95, 0);
  ctx.lineTo(shaft * 0.15, ringR * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = mph < 0.5 ? 'rgba(210,220,230,0.95)' : '#f0fbff';
  ctx.font = '900 14px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 3;
  ctx.fillText(`${mph} mph`, x, y + boxH / 2 - 14);
  ctx.restore();

  return boxRect(placed.x, placed.y, placed.w, placed.h);
}


function drawGreenRim(ctx: CanvasRenderingContext2D, green: Vec2[], theme: HoleTheme): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Outer rail shadow
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 14;
  pathPoly(ctx, green);
  ctx.stroke();
  // Theme wood/metal rail body
  ctx.strokeStyle = theme.wall;
  ctx.lineWidth = 9;
  pathPoly(ctx, green);
  ctx.stroke();
  // Top bevel
  ctx.strokeStyle = theme.wallTop;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 4;
  pathPoly(ctx, green);
  ctx.stroke();
  // Clean cut lip against carpet
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  pathPoly(ctx, green);
  ctx.stroke();
  // Inner dark edge (carpet cut)
  ctx.strokeStyle = 'rgba(10,40,20,0.35)';
  ctx.lineWidth = 2;
  pathPoly(ctx, green);
  ctx.stroke();
  ctx.restore();
}

function drawThemeSurround(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  theme: HoleTheme,
  pad: number,
  green: Vec2[],
): void {
  const tw = hole.width + pad * 2;
  const th = hole.height + pad * 2;
  const g = ctx.createLinearGradient(-pad, -pad, -pad + tw, -pad + th);
  g.addColorStop(0, theme.outside);
  g.addColorStop(1, theme.outsideAlt);
  ctx.fillStyle = g;
  ctx.fillRect(-pad, -pad, tw, th);

  // Decorative motifs outside the green (pad + cutouts)
  ctx.save();
  ctx.beginPath();
  ctx.rect(-pad, -pad, tw, th);
  // cut out green via even-odd
  pathPoly(ctx, green);
  ctx.clip('evenodd');

  const seed = hole.id * 9973;
  const n = 18 + (hole.id % 12);
  for (let i = 0; i < n; i++) {
    const t = ((seed + i * 7919) % 10000) / 10000;
    const u = ((seed * 3 + i * 6571) % 10000) / 10000;
    let x: number;
    let y: number;
    const edge = (t * 4) | 0;
    const along = t * 4 - edge;
    if (edge === 0) {
      x = -pad + along * tw;
      y = -pad + 8 + u * (pad - 16);
    } else if (edge === 1) {
      x = hole.width + 8 + u * (pad - 16);
      y = -pad + along * th;
    } else if (edge === 2) {
      x = -pad + along * tw;
      y = hole.height + 8 + u * (pad - 16);
    } else {
      x = -pad + 8 + u * (pad - 16);
      y = -pad + along * th;
    }
    drawDecorMotif(ctx, theme, x, y, i, seed);
  }
  ctx.restore();
}

function drawDecorMotif(
  ctx: CanvasRenderingContext2D,
  theme: HoleTheme,
  x: number,
  y: number,
  i: number,
  seed: number,
): void {
  ctx.save();
  switch (theme.decor) {
    case 'palms': {
      ctx.strokeStyle = '#2d6a4f';
      ctx.fillStyle = '#40916c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.quadraticCurveTo(x + 2, y, x, y - 16);
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const a = -1.2 + k * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y - 14);
        ctx.quadraticCurveTo(x + Math.cos(a) * 18, y - 14 + Math.sin(a) * 10, x + Math.cos(a) * 22, y - 6 + Math.sin(a) * 14);
        ctx.stroke();
      }
      break;
    }
    case 'cacti': {
      ctx.fillStyle = '#2d6a4f';
      roundRect(ctx, x - 4, y - 14, 8, 28, 3);
      ctx.fill();
      roundRect(ctx, x - 14, y - 4, 10, 6, 2);
      ctx.fill();
      roundRect(ctx, x + 4, y - 8, 10, 6, 2);
      ctx.fill();
      break;
    }
    case 'snow': {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const r = 2 + (i % 3);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y + 6);
      ctx.stroke();
      break;
    }
    case 'lava': {
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.55 + (i % 3) * 0.1;
      ctx.beginPath();
      ctx.arc(x, y, 4 + (i % 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'grid': {
      ctx.strokeStyle = theme.trim;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 10, y - 10, 20, 20);
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x - 2, y - 2, 4, 4);
      ctx.globalAlpha = 1;
      break;
    }
    case 'waves': {
      ctx.strokeStyle = theme.trim;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 12, y);
      ctx.quadraticCurveTo(x - 4, y - 6, x, y);
      ctx.quadraticCurveTo(x + 4, y + 6, x + 12, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'stars': {
      ctx.fillStyle = i % 2 === 0 ? theme.trim : theme.accent;
      const s = 1.5 + ((seed + i) % 4);
      ctx.globalAlpha = 0.5 + (i % 5) * 0.1;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k * 4 * Math.PI) / 5 - Math.PI / 2;
        const r = k % 2 === 0 ? s * 2.2 : s;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'leaves': {
      ctx.fillStyle = i % 2 === 0 ? theme.accent : theme.trim;
      ctx.beginPath();
      ctx.ellipse(x, y, 7, 4, (i % 6) * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'stones': {
      ctx.fillStyle = theme.trim;
      ctx.globalAlpha = 0.35;
      roundRect(ctx, x - 8, y - 5, 16, 10, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'stripes': {
      ctx.fillStyle = i % 2 === 0 ? theme.accent : theme.trim;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - 8, y - 3, 16, 6);
      ctx.globalAlpha = 1;
      break;
    }
  }
  ctx.restore();
}

function drawThemeTrim(ctx: CanvasRenderingContext2D, hole: HoleDef, theme: HoleTheme, green: Vec2[]): void {
  ctx.save();
  ctx.strokeStyle = theme.trim;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;
  ctx.setLineDash(theme.id === 'neon' || theme.decor === 'grid' ? [6, 4] : []);
  pathPoly(ctx, green);
  // inflate visually by stroking outside — just stroke green offset via lineWidth
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawZone(ctx: CanvasRenderingContext2D, z: Zone): void {
  const r = 10;
  if (z.kind === 'sand') {
    // Depth: rim shadow + raised dune lip
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, z.x + 2, z.y + 3, z.w, z.h, r);
    ctx.fill();
    const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
    g.addColorStop(0, '#f5e6c4');
    g.addColorStop(0.4, SAND);
    g.addColorStop(1, SAND_DARK);
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    // Bevel rim
    ctx.strokeStyle = 'rgba(255,240,200,0.55)';
    ctx.lineWidth = 2;
    roundRect(ctx, z.x + 1, z.y + 1, z.w - 2, z.h - 2, r - 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,95,45,0.45)';
    ctx.lineWidth = 2;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,130,60,0.35)';
    const n = Math.min(32, Math.floor((z.w * z.h) / 380));
    for (let i = 0; i < n; i++) {
      const sx = z.x + 6 + ((i * 47 + 13) % Math.max(1, z.w - 12));
      const sy = z.y + 6 + ((i * 31 + 7) % Math.max(1, z.h - 12));
      ctx.beginPath();
      ctx.arc(sx, sy, 1.2 + (i % 3) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (z.kind === 'ice') {
    ctx.fillStyle = 'rgba(80,140,180,0.2)';
    roundRect(ctx, z.x + 2, z.y + 3, z.w, z.h, r);
    ctx.fill();
    const g = ctx.createLinearGradient(z.x, z.y, z.x + z.w, z.y + z.h);
    g.addColorStop(0, '#f2fbff');
    g.addColorStop(0.4, ICE);
    g.addColorStop(1, '#8ec6dc');
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    // Gloss sheen
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, z.x + 4, z.y + 3, z.w * 0.45, z.h * 0.28, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const yy = z.y + 8 + i * ((z.h - 16) / 3);
      ctx.beginPath();
      ctx.moveTo(z.x + 8, yy);
      ctx.lineTo(z.x + z.w - 8, yy + 4);
      ctx.stroke();
    }
  } else if (z.kind === 'water') {
    ctx.fillStyle = 'rgba(0,40,80,0.28)';
    roundRect(ctx, z.x + 2, z.y + 3, z.w, z.h, r);
    ctx.fill();
    const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
    g.addColorStop(0, '#4eb0e0');
    g.addColorStop(0.45, WATER);
    g.addColorStop(1, '#154e72');
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    // Depth vignette
    const vg = ctx.createRadialGradient(z.x + z.w / 2, z.y + z.h / 2, 4, z.x + z.w / 2, z.y + z.h / 2, Math.max(z.w, z.h) / 2);
    vg.addColorStop(0, 'rgba(255,255,255,0.12)');
    vg.addColorStop(1, 'rgba(0,30,60,0.35)');
    ctx.fillStyle = vg;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,230,255,0.45)';
    ctx.lineWidth = 3;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.8;
    const waves = Math.max(2, Math.min(5, Math.floor(z.h / 28)));
    for (let i = 0; i < waves; i++) {
      ctx.beginPath();
      const yy = z.y + 10 + i * (z.h / waves);
      ctx.moveTo(z.x + 6, yy);
      ctx.quadraticCurveTo(z.x + z.w * 0.33, yy + 5, z.x + z.w * 0.5, yy);
      ctx.quadraticCurveTo(z.x + z.w * 0.66, yy - 5, z.x + z.w - 6, yy);
      ctx.stroke();
    }

  } else if (z.kind === 'lava') {
    ctx.fillStyle = 'rgba(40,0,0,0.35)';
    roundRect(ctx, z.x + 2, z.y + 3, z.w, z.h, r);
    ctx.fill();
    const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
    g.addColorStop(0, '#ffb347');
    g.addColorStop(0.35, '#ff4500');
    g.addColorStop(0.7, '#cc2200');
    g.addColorStop(1, '#5a0a0a');
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 220, 80, 0.45)';
    for (let i = 0; i < 8; i++) {
      const sx = z.x + 8 + ((i * 37) % Math.max(1, z.w - 16));
      const sy = z.y + 8 + ((i * 53) % Math.max(1, z.h - 16));
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 180, 60, 0.7)';
    ctx.lineWidth = 2.5;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.stroke();
  }
}

function drawCup(ctx: CanvasRenderingContext2D, cx: number, cy: number, cupR: number): void {
  // Closely-mown collar ring
  ctx.fillStyle = 'rgba(40, 110, 60, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 7, 0, Math.PI * 2);
  ctx.stroke();

  // White cup liner ring
  ctx.strokeStyle = 'rgba(245,245,245,0.92)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 2.5, 0, Math.PI * 2);
  ctx.stroke();

  const rim = ctx.createRadialGradient(cx - 2, cy - 2, cupR * 0.35, cx, cy, cupR + 2);
  rim.addColorStop(0, '#222');
  rim.addColorStop(0.65, '#111');
  rim.addColorStop(0.88, '#666');
  rim.addColorStop(1, '#444');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 2, 0, Math.PI * 2);
  ctx.fill();

  const hole = ctx.createRadialGradient(cx - 1, cy - 1, 1, cx, cy, cupR);
  hole.addColorStop(0, '#000');
  hole.addColorStop(0.65, CUP_DARK);
  hole.addColorStop(1, '#1a1a1a');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 2, cupR * 0.55, cupR * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flagstick
  ctx.strokeStyle = '#f8f8f8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - 40);
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,200,200,0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy - 40, 2.2, 0, Math.PI * 2);
  ctx.fill();

  const flagG = ctx.createLinearGradient(cx, cy - 40, cx + 22, cy - 22);
  flagG.addColorStop(0, '#ff6b6b');
  flagG.addColorStop(1, '#c9184a');
  ctx.fillStyle = flagG;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 40);
  ctx.lineTo(cx + 22, cy - 30);
  ctx.lineTo(cx, cy - 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTeePad(ctx: CanvasRenderingContext2D, hole: HoleDef): void {
  const tx = hole.tee.x;
  const ty = hole.tee.y;
  const ang = Math.atan2(hole.cup.y - ty, hole.cup.x - tx);
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(ang);
  // Rubber / turf tee mat
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  roundRect(ctx, -18, -14, 36, 28, 5);
  ctx.fill();
  const g = ctx.createLinearGradient(0, -12, 0, 12);
  g.addColorStop(0, '#3d5c45');
  g.addColorStop(0.5, '#2f4a38');
  g.addColorStop(1, '#24382c');
  ctx.fillStyle = g;
  roundRect(ctx, -16, -12, 32, 24, 4);
  ctx.fill();
  // Mat grain
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = -10; i <= 10; i += 3) {
    ctx.beginPath();
    ctx.moveTo(-12, i);
    ctx.lineTo(12, i);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, -16, -12, 32, 24, 4);
  ctx.stroke();
  // Center spot
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function hexAlpha(hex: string, a: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: HoleTheme,
): void {
  // Drop shadow for depth
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, x + 2, y + 3, w, h, 5);
  ctx.fill();

  const mat = theme.wallMaterial;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, theme.wallTop);
  g.addColorStop(0.35, theme.wall);
  g.addColorStop(1, theme.wallEdge);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();

  // Material detail
  ctx.save();
  if (mat === 'wood') {
    ctx.strokeStyle = 'rgba(60,30,10,0.25)';
    ctx.lineWidth = 1;
    const lines = Math.max(1, Math.floor(h / 10));
    for (let i = 1; i < lines; i++) {
      const yy = y + (h * i) / lines;
      ctx.beginPath();
      ctx.moveTo(x + 4, yy);
      ctx.lineTo(x + w - 4, yy);
      ctx.stroke();
    }
  } else if (mat === 'brick') {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    const bh = 10;
    const bw = 16;
    for (let row = 0; row * bh < h; row++) {
      const oy = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col * bw < w + bw; col++) {
        const bx = x + col * bw + oy;
        const by = y + row * bh;
        ctx.strokeRect(bx, by, bw, bh);
      }
    }
  } else if (mat === 'stone') {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 5; i++) {
      const sx = x + 4 + ((i * 37) % Math.max(1, w - 12));
      const sy = y + 4 + ((i * 23) % Math.max(1, h - 12));
      roundRect(ctx, sx, sy, 8 + (i % 3) * 3, 5 + (i % 2) * 2, 2);
      ctx.fill();
    }
  } else if (mat === 'metal') {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3);
    ctx.lineTo(x + w - 3, y + 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, x + 3, y + 3, w * 0.35, Math.min(8, h * 0.3), 2);
    ctx.fill();
  } else if (mat === 'ice') {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 4);
    ctx.stroke();
  } else if (mat === 'candy') {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < w; i += 10) {
      ctx.fillRect(x + i, y, 5, h);
    }
  }
  ctx.restore();

  // Top highlight bevel
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const rr = Math.min(5, w / 2, h / 2);
  ctx.moveTo(x + rr, y + 1.5);
  ctx.lineTo(x + w - rr, y + 1.5);
  ctx.stroke();
  // Bottom edge
  ctx.strokeStyle = theme.wallEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + rr, y + h);
  ctx.lineTo(x + w - rr, y + h);
  ctx.stroke();
}

function drawBumper(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, theme: HoleTheme): void {
  const style = theme.bumperStyle;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
  ctx.fill();

  if (style === 'metal') {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 2, x, y, r);
    g.addColorStop(0, '#f0f4f8');
    g.addColorStop(0.4, '#a8b4c0');
    g.addColorStop(0.85, '#5a6570');
    g.addColorStop(1, '#2a3038');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Bolt
    ctx.fillStyle = '#3a4048';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (style === 'candy') {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
    g.addColorStop(0, '#fff5c8');
    g.addColorStop(0.45, '#ff8fab');
    g.addColorStop(1, '#c9184a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Swirl
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0.2, Math.PI * 1.2);
    ctx.stroke();
  } else {
    // Rubber toy
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 2, x, y, r);
    g.addColorStop(0, '#ffb3c6');
    g.addColorStop(0.45, '#ff4d6d');
    g.addColorStop(1, '#a4133c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Rubber ridge rings
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.32, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function powerColor(p: number): string {
  if (p < 0.4) return '#8ac926';
  if (p < 0.75) return '#ffca3a';
  return '#ff595e';
}

function shade(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const num = parseInt(n.length === 3 ? n.split('').map((c) => c + c).join('') : n, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (num & 255) + amt));
  return `rgb(${r},${g},${b})`;
}


/**
 * Compact hole plaque + WORLD BEST in CSS pixels — always parked fully
 * outside the putting green AABB so putts stay unobstructed.
 */
function drawHolePlaqueScreen(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  viewW: number,
  viewH: number,
  green: ScreenRect,
  scores: LeaderboardEntry[] = [],
  avoid: ScreenRect[] = [],
): ScreenRect | null {
  const topN = Math.min(5, Math.max(scores.length, 0));
  let boxW = Math.round(Math.min(188, Math.max(148, viewW * 0.28)));
  const headerH = 72;
  const rowH = 18;
  let showRows = topN;
  let boxH = headerH + 28 + showRows * rowH + (showRows === 0 ? 18 : 10);

  const trySizes: Array<{ w: number; h: number; rows: number }> = [
    { w: boxW, h: boxH, rows: showRows },
    {
      w: Math.round(boxW * 0.92),
      h: headerH + 28 + Math.min(3, topN) * rowH + 10,
      rows: Math.min(3, topN),
    },
    {
      w: Math.round(Math.min(boxW, 152)),
      h: headerH + 28 + Math.min(2, topN) * rowH + 8,
      rows: Math.min(2, topN),
    },
    {
      w: Math.round(Math.min(boxW, 140)),
      h: headerH + (topN === 0 ? 36 : 28 + rowH + 6),
      rows: Math.min(1, topN),
    },
  ];

  let placed: { x: number; y: number; w: number; h: number } | null = null;
  let maxRows = showRows;
  const preferOrders: Array<
    Array<'left' | 'right' | 'bottom' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>
  > = [
    ['left', 'right', 'bottom', 'top-left', 'top-right'],
    ['bottom', 'left', 'right', 'top'],
    ['left', 'right', 'bottom', 'top'],
  ];

  for (const sz of trySizes) {
    for (const prefer of preferOrders) {
      placed = placeChromeBox(viewW, viewH, green, sz.w, sz.h, avoid, prefer);
      if (placed) {
        boxW = placed.w;
        boxH = placed.h;
        maxRows = sz.rows;
        break;
      }
    }
    if (placed) break;
  }
  if (!placed) return null;

  const x = placed.x;
  const y = placed.y;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, x + 4, y + 5, boxW, boxH, 10);
  ctx.fill();

  ctx.fillStyle = '#3b2519';
  ctx.fillRect(x + boxW / 2 - 5, y + boxH - 2, 10, 18);

  const g = ctx.createLinearGradient(x, y, x, y + boxH);
  g.addColorStop(0, '#fff8e8');
  g.addColorStop(0.55, '#f4e4bd');
  g.addColorStop(1, '#dfc891');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, boxW, boxH, 10);
  ctx.fill();
  ctx.strokeStyle = '#4d2c0d';
  ctx.lineWidth = 3.5;
  roundRect(ctx, x, y, boxW, boxH, 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 5, y + 5, boxW - 10, boxH - 10, 7);
  ctx.stroke();

  const cx = x + boxW / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#4a2605';
  ctx.font = '900 15px system-ui,sans-serif';
  ctx.fillText(`HOLE ${hole.id}`, cx, y + 16);

  const theme = THEMES[hole.theme] ?? THEMES.tropical;
  let nameSize = 16;
  ctx.font = `900 ${nameSize}px system-ui,sans-serif`;
  const name = hole.name;
  while (nameSize > 11 && ctx.measureText(name).width > boxW - 20) {
    nameSize -= 1;
    ctx.font = `900 ${nameSize}px system-ui,sans-serif`;
  }
  // Same combined title as the top headline — theme-accented for pop.
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 4;
  const nameGrad = ctx.createLinearGradient(cx - 60, y + 28, cx + 60, y + 46);
  nameGrad.addColorStop(0, '#1a1008');
  nameGrad.addColorStop(0.45, theme.accent);
  nameGrad.addColorStop(1, '#1a1008');
  ctx.fillStyle = nameGrad;
  ctx.fillText(name, cx, y + 36);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.strokeText(name, cx, y + 36);

  ctx.font = '800 12px system-ui,sans-serif';
  ctx.fillStyle = '#2f1b08';
  ctx.fillText(`Par ${hole.par}  ·  ${hole.lengthFeet} ft`, cx, y + 54);

  ctx.strokeStyle = 'rgba(73, 42, 13, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + headerH - 10);
  ctx.lineTo(x + boxW - 12, y + headerH - 10);
  ctx.stroke();

  ctx.font = '900 12px system-ui,sans-serif';
  ctx.fillStyle = '#4b2b08';
  ctx.fillText('WORLD BEST', cx, y + headerH + 8);

  const listTop = y + headerH + 26;
  const rowsFit = Math.max(0, Math.min(maxRows, Math.floor((boxH - headerH - 28) / rowH)));
  if (rowsFit === 0 && topN === 0) {
    ctx.font = '700 11px system-ui,sans-serif';
    ctx.fillStyle = '#5b4529';
    ctx.fillText('No scores yet — sink it!', cx, listTop);
  } else {
    for (let i = 0; i < rowsFit; i++) {
      const e = scores[i]!;
      const rowY = listTop + i * rowH;
      ctx.font = '800 12px system-ui,sans-serif';
      ctx.fillStyle = i === 0 ? '#744700' : '#4a321d';
      ctx.textAlign = 'left';
      ctx.fillText(String(e.rank), x + 12, rowY);
      const nm = e.name.length > 12 ? e.name.slice(0, 11) + '…' : e.name;
      ctx.font = '700 12px system-ui,sans-serif';
      ctx.fillStyle = '#120d06';
      ctx.fillText(nm, x + 36, rowY);
      ctx.textAlign = 'right';
      ctx.font = '900 13px system-ui,sans-serif';
      ctx.fillStyle = '#231305';
      ctx.fillText(String(e.score), x + boxW - 12, rowY);
    }
  }

  ctx.restore();
  return boxRect(x, y, boxW, boxH);
}


function drawGolfBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  if (color === 'galactic' || color === '#galactic') {
    // Dark cosmic base
    const base = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    base.addColorStop(0, '#3a2a6a');
    base.addColorStop(0.45, '#1a1040');
    base.addColorStop(1, '#050510');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Nebula sheen
    const neb = ctx.createRadialGradient(x + r * 0.2, y - r * 0.15, 0, x, y, r * 0.95);
    neb.addColorStop(0, 'rgba(180, 80, 255, 0.55)');
    neb.addColorStop(0.35, 'rgba(40, 160, 255, 0.28)');
    neb.addColorStop(0.7, 'rgba(255, 60, 140, 0.12)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Stars (deterministic-ish from position)
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const seed = Math.abs((x * 12.9898 + y * 78.233) % 1);
    for (let i = 0; i < 10; i++) {
      const a = seed * 6.28 + i * 2.399;
      const d = r * (0.25 + ((i * 37) % 10) / 14);
      const sx = x + Math.cos(a) * d;
      const sy = y + Math.sin(a * 1.3) * d * 0.9;
      const sr = 0.45 + (i % 3) * 0.25;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(180,220,255,0.95)' : 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Specular rim
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, color);
  g.addColorStop(1, shade(color, -40));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawRamp(ctx: CanvasRenderingContext2D, ramp: Ramp): void {
  ctx.save();
  const g = ctx.createLinearGradient(ramp.x, ramp.y + ramp.h, ramp.x, ramp.y);
  g.addColorStop(0, '#6b7280');
  g.addColorStop(0.5, '#9ca3af');
  g.addColorStop(1, '#d1d5db');
  ctx.fillStyle = g;
  roundRect(ctx, ramp.x, ramp.y, ramp.w, ramp.h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  roundRect(ctx, ramp.x, ramp.y, ramp.w, ramp.h, 8);
  ctx.stroke();
  // Direction chevrons
  const cx = ramp.x + ramp.w / 2;
  const cy = ramp.y + ramp.h / 2;
  const dx = ramp.dir.x;
  const dy = ramp.dir.y;
  ctx.strokeStyle = 'rgba(255, 220, 100, 0.9)';
  ctx.fillStyle = 'rgba(255, 200, 60, 0.35)';
  ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    const ox = cx + dx * i * 10;
    const oy = cy + dy * i * 10;
    drawChevron(ctx, ox, oy, dx, dy, 7);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.font = 'bold 9px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RAMP', cx, ramp.y + ramp.h - 8);
  ctx.restore();
}

function drawCourseProp(ctx: CanvasRenderingContext2D, prop: CourseProp, nowSec: number): void {
  if (prop.kind === 'windmill') {
    drawWindmill(ctx, prop, nowSec);
  } else if (prop.kind === 'volcano') {
    drawVolcano(ctx, prop, nowSec);
  } else if (prop.kind === 'rock') {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(prop.x + 2, prop.y + 3, prop.r, prop.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(prop.x - prop.r * 0.3, prop.y - prop.r * 0.3, 2, prop.x, prop.y, prop.r);
    g.addColorStop(0, '#9a9a9a');
    g.addColorStop(1, '#4a4a4a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(prop.x, prop.y, prop.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (prop.kind === 'sign') {
    ctx.save();
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(prop.x - 3, prop.y, 6, 28);
    ctx.fillStyle = '#f4d35e';
    roundRect(ctx, prop.x - 28, prop.y - 22, 56, 22, 4);
    ctx.fill();
    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 2;
    roundRect(ctx, prop.x - 28, prop.y - 22, 56, 22, 4);
    ctx.stroke();
    ctx.fillStyle = '#3a2a14';
    ctx.font = 'bold 10px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(prop.text, prop.x, prop.y - 11);
    ctx.restore();
  }
}

function drawWindmill(
  ctx: CanvasRenderingContext2D,
  prop: Extract<CourseProp, { kind: 'windmill' }>,
  nowSec: number,
): void {
  const blades = prop.blades ?? 4;
  const ang = nowSec * prop.rps * Math.PI * 2;
  ctx.save();
  // Tower
  ctx.fillStyle = '#e8e0d0';
  roundRect(ctx, prop.x - 14, prop.y - 8, 28, 70, 4);
  ctx.fill();
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 2;
  roundRect(ctx, prop.x - 14, prop.y - 8, 28, 70, 4);
  ctx.stroke();
  // Hub
  ctx.translate(prop.x, prop.y);
  ctx.rotate(ang);
  for (let i = 0; i < blades; i++) {
    ctx.rotate((Math.PI * 2) / blades);
    ctx.fillStyle = i % 2 === 0 ? '#c45c26' : '#f0e6d2';
    ctx.strokeStyle = '#3a2a14';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(prop.r * 0.4, -7);
    ctx.lineTo(prop.bladeLen, -11);
    ctx.lineTo(prop.bladeLen, 11);
    ctx.lineTo(prop.r * 0.4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, prop.r, 0, Math.PI * 2);
  ctx.fillStyle = '#5c4033';
  ctx.fill();
  ctx.strokeStyle = '#f4d35e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawVolcano(
  ctx: CanvasRenderingContext2D,
  prop: Extract<CourseProp, { kind: 'volcano' }>,
  nowSec: number,
): void {
  ctx.save();
  const r = prop.r;
  // Cone
  ctx.beginPath();
  ctx.moveTo(prop.x - r, prop.y + r * 0.55);
  ctx.lineTo(prop.x, prop.y - r * 0.85);
  ctx.lineTo(prop.x + r, prop.y + r * 0.55);
  ctx.closePath();
  const cone = ctx.createLinearGradient(prop.x, prop.y - r, prop.x, prop.y + r);
  cone.addColorStop(0, '#3a2018');
  cone.addColorStop(0.5, '#5a3028');
  cone.addColorStop(1, '#2a1510');
  ctx.fillStyle = cone;
  ctx.fill();
  ctx.strokeStyle = '#1a0c0a';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Crater glow
  const pulse = 0.55 + Math.sin(nowSec * 4) * 0.2;
  const glow = ctx.createRadialGradient(prop.x, prop.y - r * 0.35, 2, prop.x, prop.y - r * 0.2, r * 0.45);
  glow.addColorStop(0, `rgba(255, 220, 80, ${pulse})`);
  glow.addColorStop(0.4, `rgba(255, 80, 0, ${pulse * 0.9})`);
  glow.addColorStop(1, 'rgba(80, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(prop.x, prop.y - r * 0.3, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  // Overflow rivulets
  ctx.strokeStyle = `rgba(255, 100, 20, ${0.5 + pulse * 0.3})`;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(prop.x + side * 8, prop.y - r * 0.25);
    ctx.quadraticCurveTo(prop.x + side * r * 0.45, prop.y + 4, prop.x + side * r * 0.7, prop.y + r * 0.45);
    ctx.stroke();
  }
  ctx.restore();
}
