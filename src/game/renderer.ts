import type { GrassPattern, HoleDef, PlayerInfo, Vec2, Zone } from '../types';
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

/** World-space padding around the playable green for themed surroundings. */
export const THEME_PAD = 56;

export type AimPreview = {
  from: Vec2;
  to: Vec2;
  power: number;
} | null;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  viewW = 0;
  viewH = 0;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  pad = THEME_PAD;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
  }

  resize(hole: HoleDef): void {
    const parent = this.canvas.parentElement ?? document.body;
    const maxW = parent.clientWidth || window.innerWidth;
    const maxH = (parent.clientHeight || window.innerHeight) - 8;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const totalW = hole.width + this.pad * 2;
    const totalH = hole.height + this.pad * 2;
    const fit = Math.min(maxW / totalW, maxH / totalH);
    this.scale = fit;
    this.viewW = totalW * fit;
    this.viewH = totalH * fit;
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.ctx.setTransform(
      this.dpr * fit,
      0,
      0,
      this.dpr * fit,
      this.dpr * fit * this.pad,
      this.dpr * fit * this.pad,
    );
    this.offsetX = (maxW - this.viewW) / 2;
    this.offsetY = 0;
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.scale - this.pad,
      y: (clientY - rect.top) / this.scale - this.pad,
    };
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

    ctx.clearRect(-pad, -pad, hole.width + pad * 2, hole.height + pad * 2);

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

    // Large wind key outside the putting green (always, including 0 mph)
    drawWindKey(ctx, hole, green, pad);

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
      const g = ctx.createRadialGradient(p.ball.x - 3, p.ball.y - 3, 1, p.ball.x, p.ball.y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, p.color);
      g.addColorStop(1, shade(p.color, -40));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.ball.x, p.ball.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (highlightId === p.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.ball.x, p.ball.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const label = p.name;
      ctx.font = '600 11px system-ui,sans-serif';
      const tw = ctx.measureText(label).width;
      roundRect(ctx, p.ball.x - tw / 2 - 4, p.ball.y - r - 22, tw + 8, 14, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.ball.x, p.ball.y - r - 15);
    }

    for (const p of players) {
      const speed = len(p.vel);
      if (speed < 0.5 || p.sunk) continue;
      ctx.strokeStyle = `${p.color}55`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.ball.x, p.ball.y);
      ctx.lineTo(p.ball.x - p.vel.x * 2, p.ball.y - p.vel.y * 2);
      ctx.stroke();
    }
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
 * Full green-book / PuttView-style overlay from the same height field as physics.
 * Heatmap by steepness, contour lines of equal elevation, downhill arrows.
 */
function drawGreenMapOverlay(ctx: CanvasRenderingContext2D, hole: HoleDef, green: Vec2[]): void {
  const topo = hole.topo;
  if (!topo) return;
  const bounds = topoBounds(green);
  const { minX, minY, maxX, maxY } = bounds;
  const step = 14;

  // Sample steepness range for color scale
  let maxSteep = 0.001;
  const samples: { x: number; y: number; steep: number; h: number }[] = [];
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!pointInPolyLocal(x, y, green)) continue;
      const steep = sampleSteepness(topo, x, y, bounds);
      const h = sampleHeight(topo, x, y, bounds);
      samples.push({ x, y, steep, h });
      if (steep > maxSteep) maxSteep = steep;
    }
  }

  ctx.save();
  // Heatmap tiles: cool blue (flat) → warm red (steep)
  for (const s of samples) {
    const t = Math.min(1, s.steep / maxSteep);
    const r = Math.round(40 + t * 200);
    const g = Math.round(120 + (1 - Math.abs(t - 0.45) * 2) * 80);
    const b = Math.round(220 - t * 180);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.22 + t * 0.28})`;
    ctx.fillRect(s.x - step / 2, s.y - step / 2, step, step);
  }

  // Contour lines — march heights
  let minH = Infinity;
  let maxH = -Infinity;
  for (const s of samples) {
    minH = Math.min(minH, s.h);
    maxH = Math.max(maxH, s.h);
  }
  const levels = 7;
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([]);
  for (let li = 1; li < levels; li++) {
    const level = minH + ((maxH - minH) * li) / levels;
    ctx.beginPath();
    let drawing = false;
    // Horizontal scan for iso crossings (simple)
    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX - step; x += step) {
        if (!pointInPolyLocal(x, y, green) || !pointInPolyLocal(x + step, y, green)) {
          drawing = false;
          continue;
        }
        const h0 = sampleHeight(topo, x, y, bounds);
        const h1 = sampleHeight(topo, x + step, y, bounds);
        if ((h0 - level) * (h1 - level) <= 0) {
          const t = Math.abs(h1 - h0) < 1e-9 ? 0.5 : (level - h0) / (h1 - h0);
          const cx = x + t * step;
          if (!drawing) {
            ctx.moveTo(cx, y);
            drawing = true;
          } else {
            ctx.lineTo(cx, y);
          }
        } else {
          drawing = false;
        }
      }
      drawing = false;
    }
    ctx.stroke();
  }

  // Slope arrows pointing downhill on a coarse grid
  const aStep = step * 2.2;
  for (let y = minY + aStep / 2; y <= maxY; y += aStep) {
    for (let x = minX + aStep / 2; x <= maxX; x += aStep) {
      if (!pointInPolyLocal(x, y, green)) continue;
      const d = sampleDownhill(topo, x, y, bounds);
      const dm = Math.hypot(d.x, d.y);
      if (dm < 1e-5) continue;
      const dx = d.x / dm;
      const dy = d.y / dm;
      const size = 5 + Math.min(1, dm / maxSteep) * 7;
      ctx.strokeStyle = 'rgba(255, 236, 150, 0.85)';
      ctx.fillStyle = 'rgba(255, 200, 80, 0.35)';
      ctx.lineWidth = 1.6;
      drawChevron(ctx, x, y, dx, dy, size);
    }
  }

  // Legend chip
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, minX + 6, maxY - 28, 118, 22, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 11px system-ui,sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TOPO · flat→steep', minX + 14, maxY - 17);
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

/**
 * Fairly large wind key in the themed surround (outside the putting green).
 * Shows compass arrow (direction wind is blowing) + speed 0–25 mph.
 */
function drawWindKey(
  ctx: CanvasRenderingContext2D,
  hole: HoleDef,
  green: Vec2[],
  pad: number,
): void {
  const mph = hole.windMph ?? 0;
  const w = hole.wind ?? { x: 1, y: 0 };
  const ang = Math.atan2(w.y, w.x);
  const { minX, minY, maxX, maxY } = polyBounds(green);

  // Prefer top-right of the board, clamped into the pad surround
  let x = Math.min(hole.width + pad - 58, Math.max(maxX + 36, hole.width - 20));
  let y = Math.max(-pad + 58, Math.min(minY - 36, 40));
  // If green is tall and fills width, park in bottom-left pad
  if (x > hole.width + pad - 40 || y < -pad + 30) {
    x = Math.max(-pad + 58, minX - 40);
    y = Math.min(hole.height + pad - 58, Math.max(maxY + 40, hole.height - 30));
  }
  // Final clamp into padded view
  x = Math.max(-pad + 52, Math.min(hole.width + pad - 52, x));
  y = Math.max(-pad + 52, Math.min(hole.height + pad - 52, y));

  const strength = Math.min(1, mph / WIND_MAX_MPH);
  const boxW = 100;
  const boxH = 96;

  ctx.save();
  // Panel
  ctx.fillStyle = 'rgba(8, 24, 48, 0.78)';
  roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 14);
  ctx.fill();
  ctx.strokeStyle = mph < 0.5
    ? 'rgba(255,255,255,0.22)'
    : `rgba(140, 210, 255, ${0.45 + strength * 0.45})`;
  ctx.lineWidth = 2;
  roundRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 14);
  ctx.stroke();

  // Title
  ctx.fillStyle = 'rgba(200, 230, 255, 0.95)';
  ctx.font = 'bold 11px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WIND', x, y - boxH / 2 + 14);

  // Compass ring
  ctx.beginPath();
  ctx.arc(x, y + 2, 26, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cardinal ticks
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.4)';
  ctx.lineWidth = 1.25;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 22, y + 2 + Math.sin(a) * 22);
    ctx.lineTo(x + Math.cos(a) * 26, y + 2 + Math.sin(a) * 26);
    ctx.stroke();
  }

  // Arrow (blowing toward)
  ctx.translate(x, y + 2);
  ctx.rotate(ang);
  const arrowAlpha = mph < 0.5 ? 0.35 : 0.75 + strength * 0.25;
  ctx.fillStyle = `rgba(180,230,255,${arrowAlpha})`;
  ctx.strokeStyle = 'rgba(20,50,80,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(8, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, -10);
  ctx.lineTo(20, 0);
  ctx.lineTo(4, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // MPH label (after restore so rotation doesn't affect text)
  ctx.save();
  ctx.fillStyle = mph < 0.5 ? 'rgba(200,210,220,0.85)' : 'rgba(230, 248, 255, 0.98)';
  ctx.font = 'bold 16px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${mph} mph`, x, y + boxH / 2 - 14);
  ctx.restore();
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

  ctx.save();
  ctx.font = '700 11px system-ui,sans-serif';
  const label = theme.label;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, 4, -THEME_PAD + 10, tw + 12, 18, 6);
  ctx.fill();
  ctx.fillStyle = theme.trim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 10, -THEME_PAD + 19);
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
