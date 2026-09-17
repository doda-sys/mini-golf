/**
 * Shared all-time leaderboard via Scores (https://scores.keithcirkel.co.uk).
 * Game id is public; admin password must never ship in the client.
 */

export const SCORES_GAME_ID = 'VTCn8iZ31IDp';
export const SCORES_BASE = 'https://scores.keithcirkel.co.uk';

/** Championship 9 course par — client-side vs-par display only. */
export const COURSE_PAR = 36;

export type LeaderboardEntry = {
  rank: number;
  name: string;
  /** Total strokes (lower is better). */
  score: number;
};

const TOKEN_URL = `${SCORES_BASE}/g/${SCORES_GAME_ID}/token`;
const SUBMIT_URL = `${SCORES_BASE}/g/${SCORES_GAME_ID}`;
const LIST_URL = `${SCORES_BASE}/g/${SCORES_GAME_ID}.json`;

let pendingToken: string | null = null;
let tokenRequestedAt = 0;
let tokenInflight: Promise<string | null> | null = null;
/** Seconds since token mint at each hole / milestone (anti-abuse checkins). */
let checkins: number[] = [];

export function formatVsPar(vsPar: number): string {
  if (vsPar === 0) return 'E';
  return vsPar > 0 ? `+${vsPar}` : String(vsPar);
}

export function vsParForScore(totalStrokes: number): number {
  return totalStrokes - COURSE_PAR;
}

function clampName(name: string): string {
  return (name || 'Golfer').trim().slice(0, 15) || 'Golfer';
}

function clampScore(score: number): number {
  // Server bounds: min 18, max 200
  return Math.max(18, Math.min(200, Math.round(score)));
}

function secondsSinceToken(): number {
  if (!tokenRequestedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - tokenRequestedAt) / 1000));
}

/** Request (or reuse) a submit token. Call when a round starts. */
export async function ensureScoreToken(): Promise<string | null> {
  if (pendingToken) return pendingToken;
  if (tokenInflight) return tokenInflight;

  tokenInflight = (async () => {
    try {
      const res = await fetch(TOKEN_URL, { method: 'POST' });
      if (!res.ok) throw new Error(`token HTTP ${res.status}`);
      const data = (await res.json()) as { token?: string };
      if (!data.token) throw new Error('token missing');
      pendingToken = data.token;
      tokenRequestedAt = Date.now();
      checkins = [0];
      return pendingToken;
    } catch {
      return null;
    } finally {
      tokenInflight = null;
    }
  })();

  return tokenInflight;
}

/** Record a milestone (e.g. hole complete) as seconds since token mint. */
export function recordScoreCheckin(): void {
  if (!pendingToken || !tokenRequestedAt) return;
  const t = secondsSinceToken();
  const last = checkins.length ? checkins[checkins.length - 1]! : -1;
  if (t > last) checkins.push(t);
}

/** Drop the cached token (after submit attempt or abandoned round). */
export function clearScoreToken(): void {
  pendingToken = null;
  tokenRequestedAt = 0;
  checkins = [];
}

/**
 * Submit one player's completed 9-hole total.
 * Uses the token acquired at round start (min_play_time is 60s server-side).
 * Returns true on success; never throws.
 */
export async function submitRoundScore(name: string, totalStrokes: number): Promise<boolean> {
  try {
    let token = pendingToken;
    if (!token) {
      token = await ensureScoreToken();
    }
    if (!token) return false;

    // Server min_play_time is 60s from token mint. A real 9-hole round exceeds that.
    const elapsed = Date.now() - tokenRequestedAt;
    const need = 60_000 - elapsed;
    if (need > 0) {
      await new Promise((r) => setTimeout(r, Math.min(need + 300, 65_000)));
    }

    recordScoreCheckin();

    const body = new URLSearchParams();
    body.set('token', token);
    body.set('name', clampName(name));
    body.set('score', String(clampScore(totalStrokes)));
    if (checkins.length > 0) {
      body.set('checkins', JSON.stringify(checkins));
    }

    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'follow',
    });

    // Service often responds 303 → board; treat 2xx/3xx as success.
    const ok = res.ok || (res.status >= 300 && res.status < 400);
    clearScoreToken();
    return ok;
  } catch {
    clearScoreToken();
    return false;
  }
}

/** Fetch the shared scoreboard. Returns [] on failure. */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(LIST_URL, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      scores?: Array<{ rank?: number; name?: string; score?: number }>;
    };
    if (!Array.isArray(data.scores)) return [];
    const out: LeaderboardEntry[] = [];
    for (const s of data.scores) {
      if (!s || typeof s.name !== 'string' || typeof s.score !== 'number') continue;
      out.push({
        rank: typeof s.rank === 'number' ? s.rank : out.length + 1,
        name: s.name.slice(0, 15),
        score: s.score,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Per-hole worldwide boards (ids only — never ship admin passwords). */
export const HOLE_BOARD_IDS: Record<number, string> = {
  1: 'm3n8pbypIBo6',
  2: '3fLSLLq9dtJ2',
  3: 'TK6iApVfUHF8',
  4: 'KJd4fBWeLC01',
  5: 'zsfndVHRbhRf',
  6: 'qntg1eH6Psbk',
  7: '2hfHw9pegMn8',
  8: 'gr97VdH0w60Q',
  9: '5cVf_HJmvH-y',
};

/** Hole boards: strokes 1–15, lower is better. Server min_play_time is ~5s. */
const HOLE_MIN_SCORE = 1;
const HOLE_MAX_SCORE = 15;
const HOLE_MIN_PLAY_MS = 5_500;

type HoleTokenState = {
  holeNumber: number;
  token: string | null;
  requestedAt: number;
  checkins: number[];
  inflight: Promise<string | null> | null;
};

let holeTok: HoleTokenState | null = null;

function holeBoardId(holeNumber: number): string | null {
  return HOLE_BOARD_IDS[holeNumber] ?? null;
}

function clampHoleScore(score: number): number {
  return Math.max(HOLE_MIN_SCORE, Math.min(HOLE_MAX_SCORE, Math.round(score)));
}

function holeSecondsSinceToken(state: HoleTokenState): number {
  if (!state.requestedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - state.requestedAt) / 1000));
}

/** Request (or reuse) a submit token for this hole. Call when the hole starts. */
export async function ensureHoleScoreToken(holeNumber: number): Promise<string | null> {
  const id = holeBoardId(holeNumber);
  if (!id) return null;

  if (holeTok && holeTok.holeNumber === holeNumber && holeTok.token) {
    return holeTok.token;
  }
  if (holeTok && holeTok.holeNumber === holeNumber && holeTok.inflight) {
    return holeTok.inflight;
  }

  holeTok = {
    holeNumber,
    token: null,
    requestedAt: 0,
    checkins: [],
    inflight: null,
  };
  const state = holeTok;

  state.inflight = (async () => {
    try {
      const res = await fetch(`${SCORES_BASE}/g/${id}/token`, { method: 'POST' });
      if (!res.ok) throw new Error(`hole token HTTP ${res.status}`);
      const data = (await res.json()) as { token?: string };
      if (!data.token) throw new Error('hole token missing');
      state.token = data.token;
      state.requestedAt = Date.now();
      state.checkins = [0];
      return state.token;
    } catch {
      return null;
    } finally {
      state.inflight = null;
    }
  })();

  return state.inflight;
}

export function clearHoleScoreToken(): void {
  holeTok = null;
}

function recordHoleCheckin(): void {
  if (!holeTok?.token || !holeTok.requestedAt) return;
  const t = holeSecondsSinceToken(holeTok);
  const last = holeTok.checkins.length ? holeTok.checkins[holeTok.checkins.length - 1]! : -1;
  if (t > last) holeTok.checkins.push(t);
}

/**
 * Submit strokes for a single hole (1–15). Uses token from hole start.
 * Returns true on success; never throws.
 */
export async function submitHoleScore(
  holeNumber: number,
  name: string,
  strokes: number,
): Promise<boolean> {
  const id = holeBoardId(holeNumber);
  if (!id) return false;
  try {
    let token = holeTok?.holeNumber === holeNumber ? holeTok.token : null;
    if (!token) {
      token = await ensureHoleScoreToken(holeNumber);
    }
    if (!token || !holeTok) return false;

    const elapsed = Date.now() - holeTok.requestedAt;
    const need = HOLE_MIN_PLAY_MS - elapsed;
    if (need > 0) {
      await new Promise((r) => setTimeout(r, Math.min(need + 200, 8_000)));
    }

    recordHoleCheckin();

    const body = new URLSearchParams();
    body.set('token', token);
    body.set('name', clampName(name));
    body.set('score', String(clampHoleScore(strokes)));
    if (holeTok.checkins.length > 0) {
      body.set('checkins', JSON.stringify(holeTok.checkins));
    }

    const res = await fetch(`${SCORES_BASE}/g/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'follow',
    });

    const ok = res.ok || (res.status >= 300 && res.status < 400);
    clearHoleScoreToken();
    return ok;
  } catch {
    clearHoleScoreToken();
    return false;
  }
}

/** Fetch top scores for one hole. Returns [] on failure. */
export async function fetchHoleLeaderboard(holeNumber: number): Promise<LeaderboardEntry[]> {
  const id = holeBoardId(holeNumber);
  if (!id) return [];
  try {
    const res = await fetch(`${SCORES_BASE}/g/${id}.json`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      scores?: Array<{ rank?: number; name?: string; score?: number }>;
    };
    if (!Array.isArray(data.scores)) return [];
    const out: LeaderboardEntry[] = [];
    for (const s of data.scores) {
      if (!s || typeof s.name !== 'string' || typeof s.score !== 'number') continue;
      out.push({
        rank: typeof s.rank === 'number' ? s.rank : out.length + 1,
        name: s.name.slice(0, 15),
        score: s.score,
      });
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
}
