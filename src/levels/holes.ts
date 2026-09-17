import type { HoleDef, Wall } from '../types';

function border(w: number, h: number, t = 18): Wall[] {
  return [
    { x: 0, y: 0, w, h: t },
    { x: 0, y: h - t, w, h: t },
    { x: 0, y: 0, w: t, h },
    { x: w - t, y: 0, w: t, h },
  ];
}

export const HOLES: HoleDef[] = [
  {
    id: 1,
    name: 'Straight Shot',
    par: 2,
    width: 480,
    height: 720,
    tee: { x: 240, y: 620 },
    cup: { x: 240, y: 100 },
    cupRadius: 14,
    walls: [
      ...border(480, 720),
      { x: 160, y: 300, w: 160, h: 20 },
    ],
    bumpers: [{ x: 240, y: 380, r: 22 }],
    zones: [],
  },
  {
    id: 2,
    name: 'Dogleg Right',
    par: 3,
    width: 520,
    height: 740,
    tee: { x: 100, y: 640 },
    cup: { x: 420, y: 100 },
    cupRadius: 14,
    walls: [
      ...border(520, 740),
      { x: 200, y: 400, w: 24, h: 280 },
      { x: 200, y: 200, w: 220, h: 24 },
      { x: 80, y: 280, w: 140, h: 20 },
    ],
    bumpers: [
      { x: 320, y: 500, r: 26 },
      { x: 140, y: 180, r: 20 },
    ],
    zones: [{ x: 240, y: 240, w: 160, h: 100, frictionMul: 2.4, kind: 'sand' }],
  },
  {
    id: 3,
    name: 'Sand Trap Alley',
    par: 3,
    width: 500,
    height: 760,
    tee: { x: 250, y: 680 },
    cup: { x: 250, y: 90 },
    cupRadius: 14,
    walls: [
      ...border(500, 760),
      { x: 80, y: 220, w: 140, h: 22 },
      { x: 280, y: 220, w: 140, h: 22 },
      { x: 180, y: 420, w: 140, h: 22 },
      { x: 60, y: 520, w: 22, h: 140 },
      { x: 418, y: 520, w: 22, h: 140 },
    ],
    bumpers: [
      { x: 140, y: 340, r: 24 },
      { x: 360, y: 340, r: 24 },
      { x: 250, y: 540, r: 20 },
    ],
    zones: [
      { x: 100, y: 250, w: 300, h: 70, frictionMul: 2.6, kind: 'sand' },
      { x: 160, y: 450, w: 180, h: 50, frictionMul: 2.8, kind: 'sand' },
    ],
  },
  {
    id: 4,
    name: 'Bumper Bowl',
    par: 4,
    width: 540,
    height: 720,
    tee: { x: 270, y: 640 },
    cup: { x: 270, y: 120 },
    cupRadius: 13,
    walls: [
      ...border(540, 720),
      { x: 120, y: 300, w: 22, h: 200 },
      { x: 398, y: 300, w: 22, h: 200 },
      { x: 200, y: 180, w: 140, h: 22 },
    ],
    bumpers: [
      { x: 180, y: 420, r: 28 },
      { x: 360, y: 420, r: 28 },
      { x: 270, y: 320, r: 32 },
      { x: 200, y: 240, r: 22 },
      { x: 340, y: 240, r: 22 },
      { x: 270, y: 500, r: 24 },
    ],
    zones: [{ x: 220, y: 560, w: 100, h: 40, frictionMul: 0.4, kind: 'ice' }],
  },
  {
    id: 5,
    name: 'Water Hazard',
    par: 4,
    width: 560,
    height: 780,
    tee: { x: 100, y: 700 },
    cup: { x: 460, y: 100 },
    cupRadius: 14,
    walls: [
      ...border(560, 780),
      { x: 200, y: 560, w: 24, h: 160 },
      { x: 40, y: 400, w: 200, h: 24 },
      { x: 320, y: 300, w: 24, h: 220 },
      { x: 320, y: 180, w: 160, h: 24 },
      { x: 160, y: 220, w: 24, h: 120 },
    ],
    bumpers: [
      { x: 280, y: 480, r: 26 },
      { x: 420, y: 400, r: 22 },
      { x: 120, y: 280, r: 24 },
      { x: 380, y: 140, r: 20 },
    ],
    zones: [
      { x: 240, y: 420, w: 80, h: 160, frictionMul: 1, kind: 'water' },
      { x: 360, y: 220, w: 120, h: 60, frictionMul: 2.5, kind: 'sand' },
      { x: 60, y: 500, w: 120, h: 50, frictionMul: 2.3, kind: 'sand' },
    ],
  },
];

export function getHole(index: number): HoleDef {
  return HOLES[Math.max(0, Math.min(HOLES.length - 1, index))];
}
