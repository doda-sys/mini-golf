import type { HoleDef, PlayerInfo, Vec2, Zone } from '../types';
import { BALL_RADIUS } from '../physics/world';
import { len } from '../physics/math';

const GRASS_A = '#2d8a4e';
const GRASS_B = '#267a44';
const WALL = '#6b4a36';
const WALL_TOP = '#8b6348';
const WALL_EDGE = '#3d2a22';
const SAND = '#e8d5a3';
const SAND_DARK = '#d4bc80';
const ICE = '#b8e0f0';
const WATER = '#2a7aad';
const CUP_DARK = '#0a0a0a';
const TEE = 'rgba(255,255,255,0.35)';

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
    const fit = Math.min(maxW / hole.width, maxH / hole.height);
    this.scale = fit;
    this.viewW = hole.width * fit;
    this.viewH = hole.height * fit;
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.ctx.setTransform(this.dpr * fit, 0, 0, this.dpr * fit, 0, 0);
    this.offsetX = (maxW - this.viewW) / 2;
    this.offsetY = 0;
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.scale,
      y: (clientY - rect.top) / this.scale,
    };
  }

  draw(
    hole: HoleDef,
    players: PlayerInfo[],
    localId: string,
    aim: AimPreview,
    highlightId: string | null,
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, hole.width, hole.height);

    // Grass checker with soft vignette feel via slightly varied tiles
    const tile = 40;
    for (let y = 0; y < hole.height; y += tile) {
      for (let x = 0; x < hole.width; x += tile) {
        ctx.fillStyle = ((x / tile + y / tile) | 0) % 2 === 0 ? GRASS_A : GRASS_B;
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // Zones (hazards) — polished fills
    for (const z of hole.zones) {
      drawZone(ctx, z);
    }

    // Tee marker
    ctx.fillStyle = TEE;
    ctx.beginPath();
    ctx.arc(hole.tee.x, hole.tee.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '700 10px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TEE', hole.tee.x, hole.tee.y);

    // Cup + flag
    drawCup(ctx, hole.cup.x, hole.cup.y, hole.cupRadius);

    // Walls — wood-like with highlight edge
    for (const w of hole.walls) {
      drawWall(ctx, w.x, w.y, w.w, w.h);
    }

    // Bumpers — glossy with rim highlight
    for (const b of hole.bumpers) {
      drawBumper(ctx, b.x, b.y, b.r);
    }

    // Aim preview
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
      // Power arc
      ctx.strokeStyle = powerColor(aim.power);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(aim.from.x, aim.from.y, BALL_RADIUS + 10 + aim.power * 18, -Math.PI / 2, -Math.PI / 2 + aim.power * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Balls
    const sorted = [...players].sort((a, b) => (a.id === localId ? 1 : 0) - (b.id === localId ? 1 : 0));
    for (const p of sorted) {
      if (p.sunk) {
        // Dim in cup
        ctx.globalAlpha = 0.35;
      }
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

      // Name tag
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

    // Speed trails for moving balls
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

function drawZone(ctx: CanvasRenderingContext2D, z: Zone): void {
  const r = 10;
  if (z.kind === 'sand') {
    const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
    g.addColorStop(0, '#f0e0b8');
    g.addColorStop(0.5, SAND);
    g.addColorStop(1, SAND_DARK);
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    // Soft edge ring
    ctx.strokeStyle = 'rgba(160,130,70,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Speckle pattern (deterministic, cheap)
    ctx.fillStyle = 'rgba(170,140,70,0.4)';
    const n = Math.min(28, Math.floor((z.w * z.h) / 400));
    for (let i = 0; i < n; i++) {
      const sx = z.x + 6 + ((i * 47 + 13) % Math.max(1, z.w - 12));
      const sy = z.y + 6 + ((i * 31 + 7) % Math.max(1, z.h - 12));
      ctx.beginPath();
      ctx.arc(sx, sy, 1.4 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (z.kind === 'ice') {
    const g = ctx.createLinearGradient(z.x, z.y, z.x + z.w, z.y + z.h);
    g.addColorStop(0, '#e8f7fc');
    g.addColorStop(0.45, ICE);
    g.addColorStop(1, '#9ecfe3');
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Shine streaks
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const yy = z.y + 8 + i * ((z.h - 16) / 3);
      ctx.beginPath();
      ctx.moveTo(z.x + 8, yy);
      ctx.lineTo(z.x + z.w - 8, yy + 4);
      ctx.stroke();
    }
  } else if (z.kind === 'water') {
    const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
    g.addColorStop(0, '#3a9ad0');
    g.addColorStop(0.5, WATER);
    g.addColorStop(1, '#1a5f8a');
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    // Soft shore edge
    ctx.strokeStyle = 'rgba(180,230,255,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Wave lines
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
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
  // Outer grass rim (slightly raised look)
  ctx.fillStyle = 'rgba(20,60,35,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 4, 0, Math.PI * 2);
  ctx.fill();

  // Cup rim (metal-ish ring)
  const rim = ctx.createRadialGradient(cx - 2, cy - 2, cupR * 0.4, cx, cy, cupR + 2);
  rim.addColorStop(0, '#2a2a2a');
  rim.addColorStop(0.7, '#1a1a1a');
  rim.addColorStop(0.85, '#555');
  rim.addColorStop(1, '#333');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 2, 0, Math.PI * 2);
  ctx.fill();

  // Dark hole interior
  const hole = ctx.createRadialGradient(cx, cy, 1, cx, cy, cupR);
  hole.addColorStop(0, '#000');
  hole.addColorStop(0.7, CUP_DARK);
  hole.addColorStop(1, '#1a1a1a');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR, 0, Math.PI * 2);
  ctx.fill();

  // Inner shadow ellipse for depth
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 2, cupR * 0.55, cupR * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flagpole
  ctx.strokeStyle = '#f5f5f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - 38);
  ctx.stroke();

  // Flag
  const flagG = ctx.createLinearGradient(cx, cy - 38, cx + 20, cy - 20);
  flagG.addColorStop(0, '#ff6b6b');
  flagG.addColorStop(1, '#c9184a');
  ctx.fillStyle = flagG;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 38);
  ctx.lineTo(cx + 20, cy - 29);
  ctx.lineTo(cx, cy - 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, WALL_TOP);
  g.addColorStop(0.35, WALL);
  g.addColorStop(1, WALL_EDGE);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  // Top highlight
  ctx.strokeStyle = 'rgba(255,220,180,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Bottom edge shadow
  ctx.strokeStyle = WALL_EDGE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const rr = Math.min(5, w / 2, h / 2);
  ctx.moveTo(x + rr, y + h);
  ctx.lineTo(x + w - rr, y + h);
  ctx.stroke();
}

function drawBumper(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  // Soft shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
  ctx.fill();

  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 2, x, y, r);
  g.addColorStop(0, '#ffb3c6');
  g.addColorStop(0.45, '#ff4d6d');
  g.addColorStop(1, '#a4133c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Glossy rim
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.35, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Center dimple
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
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
