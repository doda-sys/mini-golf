import type { Vec2 } from '../types';
import { clamp, dist, len, scale, sub } from '../physics/math';
import type { Renderer } from './renderer';

export type AimState = {
  active: boolean;
  origin: Vec2;
  current: Vec2;
  power: number;
  dir: Vec2;
};

export class InputController {
  aiming = false;
  origin: Vec2 = { x: 0, y: 0 };
  current: Vec2 = { x: 0, y: 0 };
  enabled = true;
  private ballGetter: () => Vec2 | null;
  private onPutt: (dir: Vec2, power: number) => void;
  private renderer: Renderer;
  private maxDrag = 120;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: Renderer,
    ballGetter: () => Vec2 | null,
    onPutt: (dir: Vec2, power: number) => void,
  ) {
    this.renderer = renderer;
    this.ballGetter = ballGetter;
    this.onPutt = onPutt;

    const start = (x: number, y: number) => {
      if (!this.enabled) return;
      const ball = this.ballGetter();
      if (!ball) return;
      const world = this.renderer.screenToWorld(x, y);
      // Allow drag from near ball or anywhere (pull-back aiming)
      if (dist(world, ball) > 80) {
        // still allow if clicking near ball area for mobile convenience — require near ball
        return;
      }
      this.aiming = true;
      this.origin = { ...ball };
      this.current = world;
    };

    const move = (x: number, y: number) => {
      if (!this.aiming) return;
      this.current = this.renderer.screenToWorld(x, y);
    };

    const end = () => {
      if (!this.aiming) return;
      const aim = this.getAim();
      this.aiming = false;
      if (aim.power > 0.05) {
        this.onPutt(aim.dir, aim.power);
      }
    };

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      start(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', end);

    canvas.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        start(t.clientX, t.clientY);
      },
      { passive: false },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        if (!this.aiming) return;
        e.preventDefault();
        const t = e.changedTouches[0];
        move(t.clientX, t.clientY);
      },
      { passive: false },
    );
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }

  getAim(): AimState {
    // Pull-back: direction is opposite of drag from ball
    const drag = sub(this.current, this.origin);
    const dragLen = Math.min(len(drag), this.maxDrag);
    const power = clamp(dragLen / this.maxDrag, 0, 1);
    const dir =
      dragLen < 1e-3
        ? { x: 0, y: 0 }
        : scale(drag, -1 / len(drag)); // opposite of pull
    const previewLen = 40 + power * 100;
    return {
      active: this.aiming,
      origin: this.origin,
      current: {
        x: this.origin.x + dir.x * previewLen,
        y: this.origin.y + dir.y * previewLen,
      },
      power,
      dir,
    };
  }
}
