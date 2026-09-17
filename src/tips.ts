/**
 * Soft tip panel after Round Complete (end of 9).
 * Live Stripe Payment Links — real money.
 */

import './tips.css';

const ROUNDS_KEY = 'mg-tip-rounds';
const BEST_KEY = 'mg-tip-best-strokes';

/** Live donate.stripe.com Payment Links (F&F Mini Golf). */
export const TIP_LINKS = {
  tip3: 'https://donate.stripe.com/bJe8wP5hVc4z16Lgx99IQ00',
  tip5: 'https://donate.stripe.com/eVq28r39N6Kf2aP94H9IQ01',
  tip10: 'https://donate.stripe.com/9B6cN5eSv2tZ9Dhft59IQ03',
  custom: 'https://donate.stripe.com/bJe4gz8u7c4z8zddkX9IQ02',
} as const;

const TIP_COPY =
  'Nice round.\nFooze n Froops is free — built for people who love a real putt. If you had fun, a tip helps fund new holes and polish. Totally optional.';

let tipRoot: HTMLElement | null = null;
/** Prevent double-count if Round Complete scorecard opens more than once. */
let recordedThisRound = false;

function readInt(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeInt(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getCompletedRounds(): number {
  return readInt(ROUNDS_KEY) ?? 0;
}

export function getBestStrokes(): number | null {
  return readInt(BEST_KEY);
}

/** Call when starting a new 9 or returning to menu so the next finish can record again. */
export function resetTipRoundGate(): void {
  recordedThisRound = false;
}

export function hideTipPanel(): void {
  if (tipRoot) tipRoot.classList.add('hidden');
}

function openTipLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Build (once) a tip card. Insert into the score overlay card near the score body.
 */
export function createTipPanel(): HTMLElement {
  if (tipRoot) return tipRoot;

  const root = document.createElement('div');
  root.id = 'tip-panel';
  root.className = 'tip-panel hidden';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Optional tip');

  const title = document.createElement('h3');
  title.className = 'tip-title';
  title.textContent = 'Nice round.';

  const body = document.createElement('p');
  body.className = 'tip-body';
  body.textContent =
    'Fooze n Froops is free — built for people who love a real putt. If you had fun, a tip helps fund new holes and polish. Totally optional.';

  const actions = document.createElement('div');
  actions.className = 'tip-actions';

  const mkLinkBtn = (label: string, url: string, extraClass = 'btn tip-btn'): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.className = extraClass;
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      // Prefer window.open with noopener; still allow default as fallback
      e.preventDefault();
      openTipLink(url);
    });
    return a;
  };

  actions.append(
    mkLinkBtn('Tip $3', TIP_LINKS.tip3, 'btn tip-btn'),
    mkLinkBtn('Tip $5', TIP_LINKS.tip5, 'btn tip-btn'),
    mkLinkBtn('Tip $10', TIP_LINKS.tip10, 'btn tip-btn accent'),
    mkLinkBtn('Custom', TIP_LINKS.custom, 'btn tip-btn secondary'),
  );

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn secondary tip-later';
  later.textContent = 'Maybe later';
  later.addEventListener('click', () => hideTipPanel());

  root.append(title, body, actions, later);
  tipRoot = root;
  return root;
}

export type TipShowReason = 'first-round' | 'personal-best' | 'milestone-15' | null;

/**
 * Increment completed-round count once, update personal best from local strokes,
 * and show the tip panel when the show rules match.
 *
 * Show when ANY of:
 * 1. First completed round ever (count becomes 1)
 * 2. This round’s totalStrokes beats stored best (lower), or first time setting a best
 * 3. Every 15th completed round (count % 15 === 0 after increment)
 */
export function considerTipsAfterRoundComplete(localTotalStrokes: number): TipShowReason {
  const panel = createTipPanel();

  if (recordedThisRound) {
    return null;
  }
  recordedThisRound = true;

  const prevRounds = getCompletedRounds();
  const completedRounds = prevRounds + 1;
  writeInt(ROUNDS_KEY, completedRounds);

  const prevBest = getBestStrokes();
  const firstBest = prevBest === null;
  const beatBest =
    typeof localTotalStrokes === 'number' &&
    Number.isFinite(localTotalStrokes) &&
    localTotalStrokes > 0 &&
    (firstBest || localTotalStrokes < prevBest);

  if (beatBest) {
    writeInt(BEST_KEY, localTotalStrokes);
  }

  const firstRound = completedRounds === 1;
  const milestone = completedRounds % 15 === 0;

  let reason: TipShowReason = null;
  if (firstRound) reason = 'first-round';
  else if (beatBest) reason = 'personal-best';
  else if (milestone) reason = 'milestone-15';

  if (reason) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
  return reason;
}

/** Kept for docs / debugging; mirrors TIP_COPY intent. */
export const TIP_PANEL_COPY = TIP_COPY;
