import type { HoleDef } from '../types';
import {
  POOL_SIZE,
  ROUND_HOLES,
  buildHolePool,
  pickCourseIds,
} from './generate';

/** Full catalog of 1000 procedurally generated holes (ids 1..1000). */
export const HOLE_POOL: HoleDef[] = buildHolePool(POOL_SIZE);

/** Active 9-hole course for the current round (mutated by deal/load). */
export let HOLES: HoleDef[] = [];

/** Seed used for the current course deal (multiplayer sync). */
export let courseSeed = 0;

/** Hole ids for the active course. */
export let courseHoleIds: number[] = [];

export { POOL_SIZE, ROUND_HOLES };

function holesFromIds(ids: number[]): HoleDef[] {
  return ids.map((id) => {
    const hole = HOLE_POOL[id - 1];
    if (!hole) throw new Error(`Unknown hole id ${id}`);
    return hole;
  });
}

/** Deal a fresh random 9-hole course from the 1000-pool. Returns hole ids. */
export function dealCourse(seed?: number): number[] {
  courseSeed = (seed ?? ((Math.random() * 0xffffffff) >>> 0)) || 1;
  courseHoleIds = pickCourseIds(courseSeed, ROUND_HOLES, POOL_SIZE);
  HOLES = holesFromIds(courseHoleIds);
  return courseHoleIds;
}

/** Load a course from host-synced hole ids (and optional seed). */
export function loadCourse(ids: number[], seed?: number): void {
  if (ids.length < 1) throw new Error('Empty course');
  courseHoleIds = ids.slice();
  courseSeed = seed ?? courseSeed;
  HOLES = holesFromIds(courseHoleIds);
}

export function getHole(index: number): HoleDef {
  if (HOLES.length === 0) dealCourse(1);
  return HOLES[Math.max(0, Math.min(HOLES.length - 1, index))];
}

export function getPoolHole(id: number): HoleDef {
  return HOLE_POOL[Math.max(0, Math.min(POOL_SIZE - 1, id - 1))];
}

// Default course so early imports have something valid
dealCourse(42);
