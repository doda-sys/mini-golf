/**
 * Compatibility exports + light helpers.
 * Playable course lives in course.ts (curated 9).
 * Layout helpers remain available for expanding the catalog later.
 */
export {
  POOL_SIZE,
  ROUND_HOLES,
  WIND_MAX_MPH,
  WIND_CALM_THRESHOLD,
  windStrengthFromMph,
  windStrength,
  slopeStrength,
  CURATED_HOLES,
  getCuratedHole,
  curatedIds,
} from './course';
