import type { HoleDef, PlayerInfo, Vec2, Zone } from '../types';
import { BALL_RADIUS } from '../physics/world';
import { len } from '../physics/math';
import { THEMES, type HoleTheme } from '../levels/themes';

const GRASS_A = '#2d8a4e';
const GRASS_B = '#267a44';
const SAND = '#e8d5a3';
const SAND_DARK = '#d4bc80';
const ICE = '#b8e0f0';
const WATER = '#2a7aad';
const CUP_DARK = '#0a0a0a';
const TEE = 'rgba(255,255,255,0.35)';

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
    // Translate so (0,0) is the playable green origin; pad draws in negative space
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
  ): void {
    const ctx = this.ctx;
    const theme = THEMES[hole.theme] ?? THEMES.tropical;
    const pad = this.pad;

    // Clear full frame including themed surround
    ctx.clearRect(-pad, -pad, hole.width + pad * 2, hole.height + pad * 2);

    // Themed surroundings (outside the green)
    drawThemeSurround(ctx, hole, theme, pad);

    // Playable grass checker
    const tile = 40;
    for (let y = 0; y < hole.height; y += tile) {
      for (let x = 0; x < hole.width; x += tile) {
        ctx.fillStyle = ((x / tile + y / tile) | 0) % 2 === 0 ? GRASS_A : GRASS_B;
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // Soft inner shadow at green edge
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, hole.width - 6, hole.height - 6);

    // Zones (hazards)
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

    // Walls — theme-colored
    for (const w of hole.walls) {
      drawWall(ctx, w.x, w.y, w.w, w.h, theme);
    }

    // Themed trim ring just outside border walls
    drawThemeTrim(ctx, hole, theme);

    // Bumpers
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

function drawThemeSurround(ctx: CanvasRenderingContext2D, hole: HoleDef, theme: HoleTheme, pad: number): void {
  const tw = hole.width + pad * 2;
  const th = hole.height + pad * 2;
  const g = ctx.createLinearGradient(-pad, -pad, -pad + tw, -pad + th);
  g.addColorStop(0, theme.outside);
  g.addColorStop(1, theme.outsideAlt);
  ctx.fillStyle = g;
  ctx.fillRect(-pad, -pad, tw, th);

  // Decorative motifs in the pad ring only (clip out the green)
  ctx.save();
  ctx.beginPath();
  ctx.rect(-pad, -pad, tw, th);
  ctx.rect(hole.width, 0, -hole.width, hole.height); // cut out playable (even-odd)
  ctx.clip('evenodd');

  const seed = hole.id * 9973;
  const n = 18 + (hole.id % 12);
  for (let i = 0; i < n; i++) {
    const t = ((seed + i * 7919) % 10000) / 10000;
    const u = ((seed * 3 + i * 6571) % 10000) / 10000;
    // Place along the frame: map to perimeter
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

function drawThemeTrim(ctx: CanvasRenderingContext2D, hole: HoleDef, theme: HoleTheme): void {
  ctx.save();
  ctx.strokeStyle = theme.trim;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.setLineDash(theme.id === 'neon' || theme.decor === 'grid' ? [6, 4] : []);
  ctx.strokeRect(-4, -4, hole.width + 8, hole.height + 8);
  ctx.setLineDash([]);
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.strokeRect(-8, -8, hole.width + 16, hole.height + 16);
  ctx.restore();

  // Theme label chip (top-left outside)
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
    const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
    g.addColorStop(0, '#f0e0b8');
    g.addColorStop(0.5, SAND);
    g.addColorStop(1, SAND_DARK);
    ctx.fillStyle = g;
    roundRect(ctx, z.x, z.y, z.w, z.h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,130,70,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
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
    ctx.strokeStyle = 'rgba(180,230,255,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
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
  ctx.fillStyle = 'rgba(20,60,35,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 4, 0, Math.PI * 2);
  ctx.fill();

  const rim = ctx.createRadialGradient(cx - 2, cy - 2, cupR * 0.4, cx, cy, cupR + 2);
  rim.addColorStop(0, '#2a2a2a');
  rim.addColorStop(0.7, '#1a1a1a');
  rim.addColorStop(0.85, '#555');
  rim.addColorStop(1, '#333');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR + 2, 0, Math.PI * 2);
  ctx.fill();

  const hole = ctx.createRadialGradient(cx, cy, 1, cx, cy, cupR);
  hole.addColorStop(0, '#000');
  hole.addColorStop(0.7, CUP_DARK);
  hole.addColorStop(1, '#1a1a1a');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(cx, cy, cupR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 2, cupR * 0.55, cupR * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#f5f5f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - 38);
  ctx.stroke();

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

function drawWall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: HoleTheme,
): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, theme.wallTop);
  g.addColorStop(0.35, theme.wall);
  g.addColorStop(1, theme.wallEdge);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,180,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = theme.wallEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const rr = Math.min(5, w / 2, h / 2);
  ctx.moveTo(x + rr, y + h);
  ctx.lineTo(x + w - rr, y + h);
  ctx.stroke();
}

function drawBumper(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
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

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.35, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();

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
