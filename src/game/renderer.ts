import type { HoleDef, PlayerInfo, Vec2 } from '../types';
import { BALL_RADIUS } from '../physics/world';
import { len } from '../physics/math';

const GRASS_A = '#2d8a4e';
const GRASS_B = '#267a44';
const WALL = '#5c4033';
const WALL_EDGE = '#3d2a22';
const SAND = '#e8d5a3';
const ICE = '#b8e0f0';
const WATER = '#2a7aad';
const CUP_DARK = '#111';
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

    // Grass checker
    const tile = 40;
    for (let y = 0; y < hole.height; y += tile) {
      for (let x = 0; x < hole.width; x += tile) {
        ctx.fillStyle = ((x / tile + y / tile) | 0) % 2 === 0 ? GRASS_A : GRASS_B;
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // Zones
    for (const z of hole.zones) {
      if (z.kind === 'sand') {
        ctx.fillStyle = SAND;
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = 'rgba(180,150,80,0.35)';
        for (let i = 0; i < 12; i++) {
          const sx = z.x + ((i * 37) % z.w);
          const sy = z.y + ((i * 53) % z.h);
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (z.kind === 'ice') {
        ctx.fillStyle = ICE;
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.strokeRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4);
      } else if (z.kind === 'water') {
        ctx.fillStyle = WATER;
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          const yy = z.y + 10 + i * (z.h / 4);
          ctx.moveTo(z.x + 4, yy);
          ctx.quadraticCurveTo(z.x + z.w / 2, yy + 6, z.x + z.w - 4, yy);
          ctx.stroke();
        }
      }
    }

    // Tee marker
    ctx.fillStyle = TEE;
    ctx.beginPath();
    ctx.arc(hole.tee.x, hole.tee.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cup
    ctx.fillStyle = CUP_DARK;
    ctx.beginPath();
    ctx.arc(hole.cup.x, hole.cup.y, hole.cupRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(hole.cup.x - 2, hole.cup.y - 2, hole.cupRadius * 0.7, 0, Math.PI * 2);
    ctx.fill();
    // Flag
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hole.cup.x, hole.cup.y);
    ctx.lineTo(hole.cup.x, hole.cup.y - 36);
    ctx.stroke();
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.moveTo(hole.cup.x, hole.cup.y - 36);
    ctx.lineTo(hole.cup.x + 18, hole.cup.y - 28);
    ctx.lineTo(hole.cup.x, hole.cup.y - 20);
    ctx.closePath();
    ctx.fill();

    // Walls
    for (const w of hole.walls) {
      ctx.fillStyle = WALL;
      roundRect(ctx, w.x, w.y, w.w, w.h, 4);
      ctx.fill();
      ctx.strokeStyle = WALL_EDGE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Bumpers
    for (const b of hole.bumpers) {
      const g = ctx.createRadialGradient(b.x - 4, b.y - 4, 2, b.x, b.y, b.r);
      g.addColorStop(0, '#ff8fab');
      g.addColorStop(1, '#c9184a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
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
