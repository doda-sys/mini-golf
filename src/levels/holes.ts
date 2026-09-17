import type { HoleDef } from '../types';
import {
  CURATED_HOLES,
  POOL_SIZE,
  ROUND_HOLES,
  curatedIds,
  getCuratedHole,
} from './course';

/** Catalog = the curated 9 (expandable later from these templates). */
export const HOLE_POOL: HoleDef[] = CURATED_HOLES;

/** Active 9-hole course for the current round. */
export let HOLES: HoleDef[] = [];

/** Seed kept for multiplayer message compat (course is fixed). */
export let courseSeed = 1;

/** Hole ids for the active course. */
export let courseHoleIds: number[] = [];

export { POOL_SIZE, ROUND_HOLES };

function holesFromIds(ids: number[]): HoleDef[] {
  return ids.map((id) => getCuratedHole(id));
}

/** Load the fixed championship 9 (same order every round). */
export function dealCourse(seed?: number): number[] {
  courseSeed = (seed ?? 1) || 1;
  courseHoleIds = curatedIds();
  HOLES = holesFromIds(courseHoleIds);
  return courseHoleIds;
}

/** Load a course from host-synced hole ids (and optional seed). */
export function loadCourse(ids: number[], seed?: number): void {
  if (ids.length < 1) throw new Error('Empty course');
  // Prefer curated ids; fall back to championship order if unknown
  try {
    courseHoleIds = ids.slice();
    HOLES = holesFromIds(courseHoleIds);
  } catch {
    courseHoleIds = curatedIds();
    HOLES = holesFromIds(courseHoleIds);
  }
  courseSeed = seed ?? courseSeed;
}

export function getHole(index: number): HoleDef {
  if (HOLES.length === 0) dealCourse(1);
  return HOLES[Math.max(0, Math.min(HOLES.length - 1, index))];
}

export function getPoolHole(id: number): HoleDef {
  return getCuratedHole(Math.max(1, Math.min(POOL_SIZE, id)));
}

// Default course so early imports have something valid
dealCourse(1);
