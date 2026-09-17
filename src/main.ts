import './style.css';
import './plaques.css';
import {
  considerTipsAfterRoundComplete,
  createTipPanel,
  hideTipPanel,
  resetTipRoundGate,
} from './tips';
import { HOLES, getHole, dealCourse, loadCourse, courseSeed, courseHoleIds, ROUND_HOLES } from './levels/holes';
import { Renderer } from './game/renderer';
import { THEMES } from './levels/themes';
import { InputController } from './game/input';
import {
  applyPutt,
  createBall,
  isMoving,
  stepBall,
  type BallState,
} from './physics/world';
import { GolfNet, PLAYER_COLORS, generateRoomCode, makePlayer } from './net/peer';
import type { GameMode, NetMessage, PlayerInfo, Vec2 } from './types';
import { len } from './physics/math';
import {
  ensureScoreToken,
  ensureHoleScoreToken,
  fetchLeaderboard,
  fetchHoleLeaderboard,
  formatVsPar as lbFormatVsPar,
  recordScoreCheckin,
  submitRoundScore,
  submitHoleScore,
  vsParForScore,
  type LeaderboardEntry,
} from './leaderboard';

const SHARE_URL = 'https://doda-sys.github.io/mini-golf/';
const SHARE_TITLE = 'Fooze n Froops Mini Golf';
const SHARE_TEXT = 'Play Fooze n Froops Mini Golf — solo or multiplayer mini golf in the browser!';
const MENU_PREVIEW_TOP_N = 5;


/** Designer plaque material keys (data-theme) mapped from course themes / hole order. */
const PLAQUE_THEME_BY_HOLE_THEME: Record<string, string> = {
  tropical: 'palm-wood',
  autumn: 'autumn-wood',
  castle: 'windmill-enamel',
  neon: 'neon-acrylic',
  pirate: 'pirate-brass',
  desert: 'desert-stone',
  space: 'sci-fi-panel',
  volcano: 'lava-rock',
  candy: 'candy-sign',
  arctic: 'palm-wood',
};

const PLAQUE_THEME_BY_HOLE: string[] = [
  'palm-wood',
  'autumn-wood',
  'windmill-enamel',
  'neon-acrylic',
  'pirate-brass',
  'desert-stone',
  'sci-fi-panel',
  'lava-rock',
  'candy-sign',
];

function plaqueThemeForHole(holeIndex: number, themeId?: string): string {
  return (
    PLAQUE_THEME_BY_HOLE[holeIndex] ??
    PLAQUE_THEME_BY_HOLE_THEME[themeId ?? ''] ??
    'palm-wood'
  );
}

const COLORS = PLAYER_COLORS;

type BallStyleId = 'white' | 'highlighter' | 'pink' | 'galactic';

const BALL_STYLES: { id: BallStyleId; label: string; color: string }[] = [
  { id: 'white', label: 'White', color: '#f5f5f5' },
  { id: 'highlighter', label: 'Highlighter yellow', color: '#d6ff00' },
  { id: 'pink', label: 'Pink', color: '#ff6eb4' },
  { id: 'galactic', label: 'Galactic', color: 'galactic' },
];

const BALL_STYLE_KEY = 'mg-ball-style';

function loadBallStyle(): BallStyleId {
  const v = localStorage.getItem(BALL_STYLE_KEY);
  if (v === 'white' || v === 'highlighter' || v === 'pink' || v === 'galactic') return v;
  return 'white';
}

function ballColorFromStyle(id: BallStyleId): string {
  return BALL_STYLES.find((s) => s.id === id)?.color ?? '#f5f5f5';
}

function chipBackground(color: string): string {
  if (color === 'galactic' || color === '#galactic') {
    return 'linear-gradient(135deg, #1a1040 0%, #a050ff 45%, #2080ff 100%)';
  }
  return color;
}

function isValidBallColor(color: string): boolean {
  if (color === 'galactic' || color === '#galactic') return true;
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

const app = document.getElementById('app')!;

// ---- UI structure ----
const menuScreen = el('div', { class: 'screen', id: 'menu-screen' });
const lobbyScreen = el('div', { class: 'screen hidden', id: 'lobby-screen' });
const gameScreen = el('div', { class: 'screen hidden', id: 'game-screen' });
const scoreOverlay = el('div', { class: 'overlay-card hidden', id: 'score-overlay' });
const leaderboardOverlay = el('div', { class: 'overlay-card hidden', id: 'leaderboard-overlay' });
const toast = el('div', { id: 'toast' });

app.append(menuScreen, lobbyScreen, gameScreen, scoreOverlay, leaderboardOverlay, toast);

// Menu
menuScreen.append(
  el('div', { id: 'menu-decor', text: '⛳' }),
  el('h1', { class: 'logo' }, ['Fooze n Froops ', el('span', { text: 'Mini Golf' })]),
  el('p', { class: 'tagline', text: `Solo or multiplayer · ${ROUND_HOLES} curated holes · drag to aim` }),
);

const menuCard = el('div', { class: 'card' });
const nameInput = el('input', {
  type: 'text',
  id: 'player-name',
  maxlength: '12',
  placeholder: 'Your name',
  autocomplete: 'nickname',
});
nameInput.value = localStorage.getItem('mg-name') || randomName();

let selectedBallStyle: BallStyleId = loadBallStyle();
const ballColorLabel = el('label', { text: 'Ball color' });
const ballColorRow = el('div', { class: 'ball-color-row', role: 'radiogroup', 'aria-label': 'Ball color' });
const ballColorButtons: HTMLButtonElement[] = [];
for (const style of BALL_STYLES) {
  const btn = el('button', {
    type: 'button',
    class: `ball-color-btn${style.id === selectedBallStyle ? ' selected' : ''}`,
    title: style.label,
    'aria-label': style.label,
    'data-style': style.id,
  }) as HTMLButtonElement;
  btn.setAttribute('role', 'radio');
  btn.setAttribute('aria-checked', style.id === selectedBallStyle ? 'true' : 'false');
  const swatch = el('span', { class: `ball-swatch ball-swatch-${style.id}` });
  const caption = el('span', { class: 'ball-swatch-label', text: style.label });
  btn.append(swatch, caption);
  btn.addEventListener('click', () => {
    selectedBallStyle = style.id;
    localStorage.setItem(BALL_STYLE_KEY, style.id);
    for (const b of ballColorButtons) {
      const sid = b.getAttribute('data-style');
      const on = sid === selectedBallStyle;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  });
  ballColorButtons.push(btn);
  ballColorRow.append(btn);
}

const soloBtn = el('button', { class: 'btn accent', type: 'button', text: 'Play Solo' });
const createBtn = el('button', { class: 'btn', type: 'button', text: 'Create Room' });
const leaderboardMenuBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Full leaderboard' });
const shareMenuBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Share' });
const joinRow = el('div', { class: 'row' });
const joinCodeInput = el('input', {
  type: 'text',
  maxlength: '6',
  placeholder: 'Room code',
  autocomplete: 'off',
  spellcheck: 'false',
});
joinCodeInput.style.textTransform = 'uppercase';
const joinBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Join' });
joinRow.append(joinCodeInput, joinBtn);
const menuError = el('div', { class: 'error' });

const menuLbPreview = el('div', { class: 'menu-lb-preview', id: 'menu-lb-preview' });
const menuLbPreviewTitle = el('div', { class: 'menu-lb-preview-title', text: 'Top scores · worldwide' });
const menuLbPreviewBody = el('div', { class: 'menu-lb-preview-body' });
menuLbPreviewBody.append(el('p', { class: 'leaderboard-empty menu-lb-loading', text: 'Loading top scores…' }));
const menuLbPreviewActions = el('div', { class: 'menu-lb-actions' });
menuLbPreviewActions.append(leaderboardMenuBtn, shareMenuBtn);
menuLbPreview.append(menuLbPreviewTitle, menuLbPreviewBody, menuLbPreviewActions);

menuCard.append(
  el('label', { text: 'Player name', for: 'player-name' }),
  nameInput,
  ballColorLabel,
  ballColorRow,
  soloBtn,
  createBtn,
  el('label', { text: 'Join with code' }),
  joinRow,
  menuError,
  menuLbPreview,
  el('p', {
    class: 'hint',
    text: 'Multiplayer is peer-to-peer with room codes — both players must keep the tab open. Take turns on the same hole.',
  }),
);
menuScreen.append(menuCard);

// Lobby
const lobbyCard = el('div', { class: 'card' });
const lobbyTitle = el('h2', { text: 'Lobby', style: 'margin:0' });
const lobbyCode = el('div', { class: 'hud-pill room', text: 'CODE' });
lobbyCode.style.alignSelf = 'center';
lobbyCode.style.fontSize = '1.4rem';
const lobbyPlayers = el('div', { id: 'lobby-players' });
const startBtn = el('button', { class: 'btn accent', type: 'button', text: 'Start Round' });
const leaveLobbyBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Leave' });
const lobbyHint = el('p', { class: 'hint', text: '' });
lobbyCard.append(lobbyTitle, lobbyCode, lobbyPlayers, startBtn, leaveLobbyBtn, lobbyHint);
lobbyScreen.append(lobbyCard);

// Game HUD + canvas
const hud = el('div', { id: 'hud' });
const holePill = el('div', { class: 'hud-pill', text: 'Hole 1' });
const strokesPill = el('div', { class: 'hud-pill', text: 'Strokes 0' });
const topoBtn = el('button', {
  class: 'btn secondary topo-toggle',
  type: 'button',
  text: 'Green Map',
  title: 'Toggle green topography (contours, break arrows, steepness)',
  style: 'padding:5px 10px;font-size:0.8rem',
});
const turnPill = el('div', { class: 'hud-pill turn', text: 'Your turn' });
const roomPill = el('div', { class: 'hud-pill room hidden', text: '' });
const playersBar = el('div', { id: 'players-bar' });
const menuBackBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Menu', style: 'padding:5px 10px;font-size:0.8rem' });
hud.append(holePill, strokesPill, topoBtn, turnPill, roomPill, playersBar, menuBackBtn);

const playWrap = el('div', { id: 'play-wrap' });
const canvasWrap = el('div', { id: 'canvas-wrap' });
const canvas = el('canvas', { id: 'game-canvas' });
const plaqueDock = el('div', { id: 'plaque-dock', 'aria-live': 'polite' });

// Designer HTML plaque — under the green in #plaque-dock (never overlays fairway).
// Default compact strip; tap toggles expanded bottom-sheet (grows dock upward).
const holePlaque = el('aside', {
  id: 'hole-plaque',
  class: 'plaque plaque--compact',
  role: 'button',
  tabindex: '0',
  'aria-expanded': 'false',
  'aria-label': 'Hole info',
  'data-hole': '1',
  'data-theme': 'palm-wood',
});

const plaqueStrip = el('div', { class: 'plaque__strip' });
const plaqueStripEyebrow = el('span', { class: 'plaque__eyebrow', text: 'Hole 01' });
const plaqueStripTitle = el('span', { class: 'plaque__title plaque__title--short', text: '' });
const plaqueStripMeta = el('span', { class: 'plaque__meta' });
const plaqueStripPar = el('span', { class: 'plaque__par', text: 'Par 3' });
const plaqueStripDot = el('span', { class: 'plaque__meta-dot', 'aria-hidden': 'true' });
const plaqueStripLength = el('span', { class: 'plaque__length', text: '132 ft' });
plaqueStripMeta.append(plaqueStripPar, plaqueStripDot, plaqueStripLength);
plaqueStrip.append(plaqueStripEyebrow, plaqueStripTitle, plaqueStripMeta);

const plaqueBody = el('div', { class: 'plaque__body' });
const plaqueEyebrow = el('div', { class: 'plaque__eyebrow', text: 'Hole 01' });
const plaqueTitle = el('h2', { class: 'plaque__title', text: '' });
const plaqueMeta = el('div', { class: 'plaque__meta' });
const plaquePar = el('span', { class: 'plaque__par', text: 'Par 3' });
const plaqueDot = el('span', { class: 'plaque__meta-dot', 'aria-hidden': 'true' });
const plaqueLength = el('span', { class: 'plaque__length', text: '132 ft' });
plaqueMeta.append(plaquePar, plaqueDot, plaqueLength);
const plaqueDivider = el('div', { class: 'plaque__divider', role: 'presentation' });
const plaqueBest = el('div', { class: 'plaque__best' });
const plaqueBestLabel = el('div', { class: 'plaque__best-label', text: 'WORLD BEST' });
const plaqueBestList = el('ol', { class: 'plaque__best-list' });
const plaqueBestEmpty = el('p', { class: 'plaque__best-empty', text: 'Be the first' });
plaqueBest.append(plaqueBestLabel, plaqueBestList, plaqueBestEmpty);
plaqueBody.append(plaqueEyebrow, plaqueTitle, plaqueMeta, plaqueDivider, plaqueBest);

holePlaque.append(plaqueStrip, plaqueBody);

function setPlaqueExpanded(expanded: boolean): void {
  holePlaque.classList.toggle('plaque--compact', !expanded);
  holePlaque.classList.toggle('plaque--expanded', expanded);
  holePlaque.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  plaqueDock.classList.toggle('plaque-open', expanded);
  // Refit fairway after dock height changes so the plaque never covers green.
  requestAnimationFrame(() => {
    if (mode === 'playing') layout();
  });
}

function togglePlaque(): void {
  setPlaqueExpanded(holePlaque.getAttribute('aria-expanded') !== 'true');
}

holePlaque.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlaque();
});
holePlaque.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    togglePlaque();
  } else if (e.key === 'Escape') {
    setPlaqueExpanded(false);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPlaqueExpanded(false);
});

canvasWrap.append(canvas);
plaqueDock.append(holePlaque);
playWrap.append(canvasWrap, plaqueDock);
gameScreen.append(hud, playWrap);

// Score overlay content
const scoreCard = el('div', { class: 'card' });
const scoreTitle = el('h2', { text: 'Scorecard', style: 'margin:0' });
const scoreBody = el('div');
const nextHoleBtn = el('button', { class: 'btn accent', type: 'button', text: 'Next Hole' });
const scoreMenuBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Main Menu' });
const scoreLeaderboardBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Leaderboard' });
const scoreShareBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Share' });
const tipPanel = createTipPanel();
scoreCard.append(scoreTitle, scoreBody, tipPanel, nextHoleBtn, scoreLeaderboardBtn, scoreShareBtn, scoreMenuBtn);
scoreOverlay.append(scoreCard);

// Leaderboard overlay
const lbCard = el('div', { class: 'card leaderboard-card' });
const lbTitle = el('h2', { text: 'All-time leaderboard', style: 'margin:0' });
const lbNote = el('p', {
  class: 'hint lb-note',
  text: 'Shared worldwide · lowest strokes wins · ties: first score recorded ranks higher',
});
const lbBody = el('div', { class: 'leaderboard-list', id: 'leaderboard-list' });
const lbCloseBtn = el('button', { class: 'btn accent', type: 'button', text: 'Close' });
lbCard.append(lbTitle, lbNote, lbBody, lbCloseBtn);
leaderboardOverlay.append(lbCard);

// ---- State ----
type Phase = 'aiming' | 'rolling' | 'hole-done' | 'round-done';

let mode: GameMode = 'menu';
let solo = true;
let isHost = false;
let localId = 'local';
let localName = nameInput.value;
let localColor = ballColorFromStyle(selectedBallStyle);
let holeIndex = 0;
/** Worldwide top scores for the current hole plaque. */
let holePlaqueScores: LeaderboardEntry[] = [];
/** Avoid double-posting the same hole sink. */
let holeScorePostedForIndex = -1;
let players: PlayerInfo[] = [];
let balls = new Map<string, BallState>();
let turnPlayerId = localId;
let phase: Phase = 'aiming';
let holeStrokes = new Map<string, number>();
let net: GolfNet | null = null;
let roomCode = '';
let lastTs = 0;
let syncAccum = 0;
let showGreenMap = false;
/** Prevent double-saving the same completed 9 into the leaderboard. */
let leaderboardSavedThisRound = false;

const renderer = new Renderer(canvas);

topoBtn.addEventListener('click', () => {
  showGreenMap = !showGreenMap;
  topoBtn.classList.toggle('active', showGreenMap);
  topoBtn.textContent = showGreenMap ? 'Topo ON' : 'Green Map';
  topoBtn.title = showGreenMap
    ? 'Hide green topography overlay'
    : 'Show green topography (contours, break, steepness)';
});

function playerName(): string {
  const n = nameInput.value.trim().slice(0, 12);
  localStorage.setItem('mg-name', n || 'Golfer');
  return n || 'Golfer';
}

function randomName(): string {
  const a = ['Ace', 'Birdie', 'Chip', 'Dash', 'Eagle', 'Fairway', 'Putt', 'Slice'];
  return a[(Math.random() * a.length) | 0] + ((Math.random() * 90 + 10) | 0);
}

function showToast(msg: string, ms = 2200): void {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), ms);
}

function showScreen(which: 'menu' | 'lobby' | 'game'): void {
  menuScreen.classList.toggle('hidden', which !== 'menu');
  lobbyScreen.classList.toggle('hidden', which !== 'lobby');
  gameScreen.classList.toggle('hidden', which !== 'game');
  if (which === 'menu') void refreshMenuLeaderboardPreview();
}

function localPlayer(): PlayerInfo | undefined {
  return players.find((p) => p.id === localId);
}

function isMyTurn(): boolean {
  return turnPlayerId === localId && phase === 'aiming';
}

function syncBallToPlayer(p: PlayerInfo): void {
  const b = balls.get(p.id);
  if (!b) return;
  p.ball = { ...b.pos };
  p.vel = { ...b.vel };
  p.sunk = b.sunk;
  (p as PlayerInfo & { airHeight?: number }).airHeight = b.airHeight ?? 0;
}

function resetHolePositions(): void {
  const hole = getHole(holeIndex);
  for (const p of players) {
    const b = createBall(hole.tee);
    // Slight offset so balls don't stack perfectly
    const idx = players.indexOf(p);
    b.pos.x += (idx - (players.length - 1) / 2) * 14;
    balls.set(p.id, b);
    p.finishedHole = false;
    p.sunk = false;
    p.ball = { ...b.pos };
    p.vel = { x: 0, y: 0 };
    holeStrokes.set(p.id, 0);
  }
}

function startSolo(): void {
  destroyNet();
  hideTipPanel();
  resetTipRoundGate();
  solo = true;
  isHost = true;
  localId = 'local';
  localName = playerName();
  localColor = selectedPlayerColor();
  dealCourse();
  holeIndex = 0;
  leaderboardSavedThisRound = false;
  beginRoundScoreToken();
  players = [makePlayer(localId, localName, localColor, getHole(0).tee)];
  balls.clear();
  resetHolePositions();
  turnPlayerId = localId;
  phase = 'aiming';
  mode = 'playing';
  roomPill.classList.add('hidden');
  showScreen('game');
  layout();
  beginHoleScoreToken();
  input.enabled = true;
  showToast('Drag from the ball to aim · release to putt');
}

function layout(): void {
  renderer.resize(getHole(holeIndex));
  updateHolePlaque(true);
}

let plaqueContentKey = '';

function updateHolePlaque(force = false): void {
  const hole = getHole(holeIndex);
  const themeId = hole.theme ?? 'tropical';
  const plaqueTheme = plaqueThemeForHole(holeIndex, themeId);
  const top = holePlaqueScores.slice(0, 3);
  const contentKey = `${holeIndex}|${plaqueTheme}|${hole.name}|${hole.par}|${hole.lengthFeet}|${top.map((e) => `${e.rank}:${e.name}:${e.score}`).join(';')}`;
  if (force || contentKey !== plaqueContentKey) {
    plaqueContentKey = contentKey;
    const n = holeIndex + 1;
    const holeLabel = `Hole ${String(n).padStart(2, '0')}`;
    const lengthText = `${hole.lengthFeet} ft`;
    const parText = `Par ${hole.par}`;

    holePlaque.dataset.hole = String(n);
    holePlaque.dataset.theme = plaqueTheme;
    holePlaque.setAttribute('aria-label', `Hole ${n}: ${hole.name}`);

    // Keep compact default when switching holes unless already expanded.
    if (!holePlaque.classList.contains('plaque--expanded') && !holePlaque.classList.contains('plaque--compact')) {
      holePlaque.classList.add('plaque--compact');
    }

    plaqueStripEyebrow.textContent = holeLabel;
    plaqueStripTitle.textContent = hole.name;
    plaqueStripPar.textContent = parText;
    plaqueStripLength.textContent = lengthText;

    plaqueEyebrow.textContent = holeLabel;
    plaqueTitle.textContent = hole.name;
    plaquePar.textContent = parText;
    plaqueLength.textContent = lengthText;

    plaqueBestList.replaceChildren();
    if (top.length === 0) {
      plaqueBestEmpty.hidden = false;
      plaqueBestList.hidden = true;
    } else {
      plaqueBestEmpty.hidden = true;
      plaqueBestList.hidden = false;
      for (const e of top) {
        const li = document.createElement('li');
        const nm = e.name.length > 12 ? e.name.slice(0, 11) + '…' : e.name;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = `${e.rank}. ${nm}`;
        const strokesSpan = document.createElement('span');
        strokesSpan.className = 'strokes';
        strokesSpan.textContent = String(e.score);
        li.append(nameSpan, strokesSpan);
        plaqueBestList.append(li);
      }
    }
  }
  positionHolePlaque();
}

function positionHolePlaque(): void {
  // Plaque lives in #plaque-dock under the canvas — clear any legacy overlay coords.
  holePlaque.style.left = '';
  holePlaque.style.top = '';
  holePlaque.dataset.place = 'dock';
}

function updateHud(): void {
  const hole = getHole(holeIndex);
  holePill.textContent = `Hole ${holeIndex + 1}/${HOLES.length} · Par ${hole.par}`;
  holePill.title = hole.name;
  const me = localPlayer();
  const st = holeStrokes.get(localId) ?? 0;
  strokesPill.textContent = `Strokes ${st}`;
  updateHolePlaque();
  if (solo) {
    turnPill.textContent = phase === 'rolling' ? 'Ball rolling…' : phase === 'hole-done' ? 'Hole complete!' : 'Your turn';
  } else {
    const tp = players.find((p) => p.id === turnPlayerId);
    turnPill.textContent =
      phase === 'rolling'
        ? 'Ball rolling…'
        : turnPlayerId === localId
          ? 'Your turn'
          : `${tp?.name ?? '…'}'s turn`;
  }
  if (!solo && roomCode) {
    roomPill.classList.remove('hidden');
    roomPill.textContent = roomCode;
  }
  playersBar.replaceChildren(
    ...players.map((p) => {
      const chip = el('div', { class: `player-chip${p.id === turnPlayerId ? ' active' : ''}` });
      const dot = el('span', { class: 'dot' });
      applyChipDot(dot, p.color);
      const hs = holeStrokes.get(p.id) ?? 0;
      chip.append(dot, document.createTextNode(`${p.name} (${hs})`));
      return chip;
    }),
  );
}

function everyoneFinished(): boolean {
  return players.every((p) => p.finishedHole || p.sunk);
}

function advanceTurn(): void {
  if (solo) {
    turnPlayerId = localId;
    phase = 'aiming';
    return;
  }
  // Next player who hasn't finished
  const ids = players.map((p) => p.id);
  let idx = ids.indexOf(turnPlayerId);
  for (let i = 0; i < ids.length; i++) {
    idx = (idx + 1) % ids.length;
    const p = players[idx];
    if (!p.finishedHole && !p.sunk) {
      turnPlayerId = p.id;
      phase = 'aiming';
      return;
    }
  }
  phase = 'hole-done';
}

function onHoleSunk(playerId: string): void {
  const p = players.find((x) => x.id === playerId);
  if (!p || p.finishedHole) return;
  p.finishedHole = true;
  p.sunk = true;
  const st = holeStrokes.get(playerId) ?? 0;
  p.strokes[holeIndex] = st;
  p.totalStrokes = p.strokes.reduce((a, b) => a + (b || 0), 0);
  showToast(`${p.name} sunk it in ${st}!`);
  if (playerId === localId) {
    postLocalHoleScore(st);
  }

  if (everyoneFinished()) {
    phase = 'hole-done';
    openScorecard(false);
    if (!solo && isHost) {
      net?.broadcast({
        type: 'state-sync',
        players: clonePlayers(),
        holeIndex,
        turnPlayerId,
        phase: 'hole-done',
      });
    }
  } else if (playerId === turnPlayerId) {
    advanceTurn();
    broadcastSync();
  }
}

function clonePlayers(): PlayerInfo[] {
  return players.map((p) => ({
    ...p,
    ball: { ...p.ball },
    vel: { ...p.vel },
    strokes: [...p.strokes],
  }));
}

function broadcastSync(): void {
  if (solo || !isHost || !net) return;
  for (const p of players) syncBallToPlayer(p);
  net.broadcast({
    type: 'state-sync',
    players: clonePlayers(),
    holeIndex,
    turnPlayerId,
    phase,
  });
}

/** Format strokes vs par: E, +2, -3, etc. */
function formatToPar(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : String(diff);
}

function scoreDiffClass(diff: number): string {
  if (diff <= -2) return 'score-eagle';
  if (diff === -1) return 'score-birdie';
  if (diff === 0) return 'score-par';
  if (diff === 1) return 'score-bogey';
  return 'score-double';
}

/**
 * Submit this client's local player to the shared board.
 * Each MP peer submits only themselves (tokens are IP-bound & single-use).
 */
function recordRoundOnLeaderboard(): void {
  if (leaderboardSavedThisRound) return;
  if (holeIndex < HOLES.length - 1) return;
  const me = localPlayer();
  if (
    !me ||
    !(me.totalStrokes > 0) ||
    me.strokes.length < HOLES.length ||
    !me.strokes.slice(0, HOLES.length).every((s) => typeof s === 'number' && s > 0)
  ) {
    return;
  }
  leaderboardSavedThisRound = true;
  const name = me.name;
  const strokes = me.totalStrokes;
  void (async () => {
    const ok = await submitRoundScore(name, strokes);
    if (ok) showToast('Score posted to leaderboard!');
    else showToast('Could not post score (offline?) — round still counts locally');
  })();
}

async function copyShareLink(): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(SHARE_URL);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = SHARE_URL;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function shareGame(): Promise<void> {
  const payload: ShareData = {
    title: SHARE_TITLE,
    text: SHARE_TEXT,
    url: SHARE_URL,
  };
  try {
    if (typeof navigator.share === 'function') {
      // Some browsers require canShare; treat failure as cancel / fallback.
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return;
      }
    }
  } catch (err) {
    // User cancel — don't toast an error
    if (err instanceof DOMException && err.name === 'AbortError') return;
  }

  const copied = await copyShareLink();
  if (copied) {
    showToast('Link copied — paste into Texts or Messages!');
    return;
  }

  // Last resort: open SMS / mailto with the link
  const smsBody = encodeURIComponent(`${SHARE_TEXT} ${SHARE_URL}`);
  const smsUrl = `sms:?&body=${smsBody}`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${smsBody}`;
  const choice = window.confirm('Open Messages to text the game link?\\n\\nCancel opens email instead.');
  window.location.href = choice ? smsUrl : mailUrl;
}

function buildLeaderboardTable(entries: LeaderboardEntry[], opts?: { compact?: boolean }): HTMLTableElement {
  const table = el('table', {
    class: opts?.compact ? 'leaderboard-table menu-lb-table' : 'leaderboard-table',
  });
  const head = el('tr');
  head.append(
    el('th', { text: '#' }),
    el('th', { text: 'Name' }),
    el('th', { text: 'Strokes' }),
    el('th', { text: '+/−', title: 'Vs championship course par' }),
  );
  table.append(head);
  for (const e of entries) {
    const tr = el('tr');
    const vs = vsParForScore(e.score);
    tr.append(
      el('td', { class: 'lb-rank', text: String(e.rank) }),
      el('td', { class: 'lb-name', text: e.name }),
      el('td', { class: 'lb-score', text: String(e.score) }),
      el('td', { class: `lb-vs ${scoreDiffClass(vs)}`, text: lbFormatVsPar(vs) }),
    );
    table.append(tr);
  }
  return table;
}

async function refreshMenuLeaderboardPreview(): Promise<void> {
  menuLbPreviewBody.replaceChildren(
    el('p', { class: 'leaderboard-empty menu-lb-loading', text: 'Loading top scores…' }),
  );
  const entries = await fetchLeaderboard();
  if (entries.length === 0) {
    menuLbPreviewBody.replaceChildren(
      el('p', {
        class: 'leaderboard-empty',
        text: 'No scores yet — finish a 9 to post yours!',
      }),
    );
    return;
  }
  const top = entries.slice(0, MENU_PREVIEW_TOP_N);
  menuLbPreviewBody.replaceChildren(buildLeaderboardTable(top, { compact: true }));
}

async function renderLeaderboardList(): Promise<void> {
  lbBody.replaceChildren(
    el('p', { class: 'leaderboard-empty', text: 'Loading leaderboard…' }),
  );
  const entries = await fetchLeaderboard();
  if (entries.length === 0) {
    lbBody.replaceChildren(
      el('p', {
        class: 'leaderboard-empty',
        text: 'No scores yet — or the board is unreachable. Finish a 9-hole round to post yours!',
      }),
    );
    return;
  }
  lbBody.replaceChildren(buildLeaderboardTable(entries));
}

function openLeaderboard(): void {
  leaderboardOverlay.classList.remove('hidden');
  void renderLeaderboardList();
}

function closeLeaderboard(): void {
  leaderboardOverlay.classList.add('hidden');
}

function beginRoundScoreToken(): void {
  void ensureScoreToken();
}

function beginHoleScoreToken(): void {
  const holeNum = getHole(holeIndex).id;
  holeScorePostedForIndex = -1;
  void ensureHoleScoreToken(holeNum);
  void refreshHolePlaqueScores();
}

async function refreshHolePlaqueScores(): Promise<void> {
  const holeNum = getHole(holeIndex).id;
  const entries = await fetchHoleLeaderboard(holeNum);
  // Ignore stale responses if the player advanced holes
  if (getHole(holeIndex).id !== holeNum) return;
  holePlaqueScores = entries;
  updateHolePlaque();
}

function selectedPlayerColor(): string {
  return ballColorFromStyle(selectedBallStyle);
}

function applyChipDot(dot: HTMLElement, color: string): void {
  dot.style.background = chipBackground(color);
}

function postLocalHoleScore(strokes: number): void {
  if (holeScorePostedForIndex === holeIndex) return;
  if (!(strokes >= 1)) return;
  holeScorePostedForIndex = holeIndex;
  const holeNum = getHole(holeIndex).id;
  const name = localPlayer()?.name || playerName();
  void (async () => {
    const ok = await submitHoleScore(holeNum, name, strokes);
    if (ok) {
      await refreshHolePlaqueScores();
    }
  })();
}

function openScorecard(final: boolean): void {
  recordScoreCheckin();
  scoreTitle.textContent = final ? 'Final Scores' : `Hole ${holeIndex + 1} Complete`;
  const table = el('table', { class: 'score-table' });
  const head = el('tr');
  head.append(el('th', { text: 'Player' }));
  for (let i = 0; i <= holeIndex; i++) {
    const hn = HOLES[i]?.name ?? `Hole ${i + 1}`;
    head.append(el('th', { text: String(i + 1), title: hn }));
  }
  head.append(el('th', { text: 'Tot' }));
  head.append(el('th', { text: '+/−', title: 'Score relative to par' }));
  table.append(head);

  // Par row — per-hole par + total par for holes played (and full 9 when final)
  const parRow = el('tr', { class: 'par-row' });
  parRow.append(el('td', { text: 'Par' }));
  let parSumShown = 0;
  for (let i = 0; i <= holeIndex; i++) {
    const p = HOLES[i]?.par ?? 4;
    parSumShown += p;
    parRow.append(el('td', { text: String(p) }));
  }
  const fullNinePar = HOLES.reduce((a, h) => a + h.par, 0);
  parRow.append(el('td', { class: 'total', text: String(parSumShown) }));
  parRow.append(el('td', { class: 'total', text: 'E' }));
  table.append(parRow);

  const sorted = [...players].sort((a, b) => a.totalStrokes - b.totalStrokes);
  for (const p of sorted) {
    const tr = el('tr');
    tr.append(el('td', { text: p.name }));
    for (let i = 0; i <= holeIndex; i++) {
      const strokes = p.strokes[i];
      const par = HOLES[i]?.par ?? 4;
      const td = el('td');
      if (strokes != null) {
        const diff = strokes - par;
        td.className = scoreDiffClass(diff);
        // Strokes + clear vs-par (E / +1 / -2)
        const vs = el('span', { class: 'vs-par', text: formatToPar(diff) });
        const stk = el('span', { class: 'hole-strokes', text: String(strokes) });
        td.append(vs, stk);
        td.title = `${strokes} strokes · ${formatToPar(diff)} vs par ${par}`;
      } else {
        td.textContent = '—';
      }
      tr.append(td);
    }
    const toPar = p.totalStrokes - parSumShown;
    const tot = el('td', { class: 'total', text: String(p.totalStrokes) });
    const rel = el('td', {
      class: `total to-par ${scoreDiffClass(toPar)}`,
      text: formatToPar(toPar),
    });
    rel.title = `${p.totalStrokes} strokes vs par ${parSumShown}`;
    tr.append(tot, rel);
    table.append(tr);
  }

  const parNote = el('p', {
    class: 'hint',
    text: `Course par (9): ${fullNinePar} · Through hole ${holeIndex + 1}: par ${parSumShown} · Scores shown vs par (E / + / −)`,
  });
  scoreBody.replaceChildren(table, parNote);
  const more = holeIndex < HOLES.length - 1;
  if (more) {
    hideTipPanel();
    nextHoleBtn.classList.toggle('hidden', !solo && !isHost);
    nextHoleBtn.textContent = 'Next Hole';
    nextHoleBtn.disabled = !solo && !isHost;
    scoreMenuBtn.textContent = 'Main Menu';
  } else {
    // End of 9 — stop and ask for another round (don't auto-continue)
    phase = 'round-done';
    scoreTitle.textContent = 'Round Complete — Final Scores';
    nextHoleBtn.classList.remove('hidden');
    nextHoleBtn.textContent = solo || isHost ? 'Play another 9' : 'Waiting for host…';
    nextHoleBtn.disabled = !solo && !isHost;
    scoreMenuBtn.textContent = 'Back to menu';
    recordRoundOnLeaderboard();
    // Soft tip: local player's completed-9 stats only (solo / host / guest)
    const me = localPlayer();
    const localTotal = me?.totalStrokes ?? 0;
    considerTipsAfterRoundComplete(localTotal);
  }
  scoreOverlay.classList.remove('hidden');
}

function startAnotherNine(): void {
  // Replay the same curated championship 9
  hideTipPanel();
  resetTipRoundGate();
  const ids = dealCourse();
  holeIndex = 0;
  leaderboardSavedThisRound = false;
  beginRoundScoreToken();
  for (const p of players) {
    p.strokes = [];
    p.totalStrokes = 0;
  }
  resetHolePositions();
  turnPlayerId = players[0]?.id ?? localId;
  phase = 'aiming';
  mode = 'playing';
  scoreOverlay.classList.add('hidden');
  layout();
  beginHoleScoreToken();
  updateHud();
  if (!solo && isHost && net) {
    net.broadcast({
      type: 'start',
      holeIndex,
      turnPlayerId,
      holeIds: ids,
      courseSeed,
    });
  }
  showToast(`New round! Hole 1: ${getHole(0).name}`);
}

function goNextHole(): void {
  hideTipPanel();
  scoreOverlay.classList.add('hidden');
  if (holeIndex >= HOLES.length - 1) {
    // Should use startAnotherNine instead — safety fallback
    startAnotherNine();
    return;
  }
  holeIndex++;
  setPlaqueExpanded(false);
  resetHolePositions();
  turnPlayerId = players[0]?.id ?? localId;
  phase = 'aiming';
  layout();
  beginHoleScoreToken();
  updateHud();
  if (!solo && isHost) {
    net?.broadcast({
      type: 'next-hole',
      holeIndex,
      turnPlayerId,
      players: clonePlayers(),
    });
  }
  showToast(`Hole ${holeIndex + 1}: ${getHole(holeIndex).name}`);
}

function doPutt(dir: Vec2, power: number): void {
  if (!isMyTurn()) return;
  const b = balls.get(localId);
  if (!b || isMoving(b) || b.sunk) return;
  applyPutt(b, dir, power);
  const st = (holeStrokes.get(localId) ?? 0) + 1;
  holeStrokes.set(localId, st);
  const me = localPlayer();
  if (me) {
    me.strokes[holeIndex] = st;
    syncBallToPlayer(me);
  }
  phase = 'rolling';
  updateHud();

  if (!solo && net) {
    net.send({
      type: 'putt',
      playerId: localId,
      vx: b.vel.x,
      vy: b.vel.y,
      ball: { ...b.pos },
      strokes: st,
    });
  }
}

const input = new InputController(
  canvas,
  renderer,
  () => {
    if (!isMyTurn()) return null;
    const b = balls.get(localId);
    return b && !b.sunk ? b.pos : null;
  },
  doPutt,
);

function applyRemotePutt(msg: Extract<NetMessage, { type: 'putt' }>): void {
  const b = balls.get(msg.playerId);
  if (!b) return;
  b.pos = { ...msg.ball };
  b.vel = { x: msg.vx, y: msg.vy };
  b.sunk = false;
  b.awaitingPutt = false;
  b.settleSteps = 0;
  holeStrokes.set(msg.playerId, msg.strokes);
  const p = players.find((x) => x.id === msg.playerId);
  if (p) p.strokes[holeIndex] = msg.strokes;
  phase = 'rolling';
  turnPlayerId = msg.playerId;
  updateHud();
}

function destroyNet(): void {
  net?.destroy();
  net = null;
}

function renderLobbyPlayers(): void {
  lobbyPlayers.replaceChildren(
    ...players.map((p) => {
      const row = el('div', { class: 'player-chip', style: 'margin:4px 0' });
      const dot = el('span', { class: 'dot' });
      applyChipDot(dot, p.color);
      row.append(dot, document.createTextNode(p.name + (p.id === localId ? ' (you)' : '') + (isHost && p.id === localId ? ' · host' : '')));
      return row;
    }),
  );
  startBtn.style.display = isHost ? '' : 'none';
  lobbyHint.textContent = isHost
    ? 'Share the room code and keep this tab open. Start when everyone has joined.'
    : 'Waiting for host to start… Keep this tab open.';
}

function setupNetHandlers(): GolfNet {
  const g = new GolfNet({
    onOpen: (pid, host) => {
      localId = pid;
      isHost = host;
    },
    onError: (msg) => {
      menuError.textContent = msg;
      showToast(msg);
    },
    onConnectionChange: () => {},
    onPeerJoined: (peerId) => {
      showToast(isHost ? 'Player connecting…' : 'Connected to host');
      void peerId;
    },
    onPeerLeft: (peerId) => {
      players = players.filter((p) => p.id !== peerId);
      balls.delete(peerId);
      if (turnPlayerId === peerId) advanceTurn();
      renderLobbyPlayers();
      updateHud();
      if (isHost) broadcastSync();
    },
    onMessage: (msg, fromId) => handleNetMessage(msg, fromId),
  });
  return g;
}

function handleNetMessage(msg: NetMessage, fromId: string): void {
  switch (msg.type) {
    case 'hello': {
      if (!isHost) return;
      const color = isValidBallColor(msg.color)
        ? msg.color
        : COLORS[players.length % COLORS.length];
      const p = makePlayer(fromId, msg.name || 'Guest', color, getHole(holeIndex).tee);
      players.push(p);
      balls.set(fromId, createBall(getHole(holeIndex).tee));
      net?.send(
        {
          type: 'welcome',
          players: clonePlayers(),
          hostId: localId,
          holeIndex,
          turnPlayerId,
          mode: mode === 'playing' ? 'playing' : 'lobby',
          holeIds: courseHoleIds.length ? courseHoleIds : undefined,
        },
        fromId,
      );
      net?.relay({ type: 'player-joined', player: p }, fromId);
      renderLobbyPlayers();
      break;
    }
    case 'welcome': {
      if (msg.holeIds?.length) loadCourse(msg.holeIds, courseSeed);
      players = msg.players;
      holeIndex = msg.holeIndex;
      turnPlayerId = msg.turnPlayerId;
      balls.clear();
      for (const p of players) {
        const b = createBall(p.ball);
        b.pos = { ...p.ball };
        b.vel = { ...p.vel };
        b.sunk = p.sunk;
        const moving = Math.hypot(p.vel.x, p.vel.y) > 0.08;
        b.awaitingPutt = !moving && !p.sunk;
        b.settleSteps = 0;
        balls.set(p.id, b);
        if (p.strokes[holeIndex] != null) holeStrokes.set(p.id, p.strokes[holeIndex]);
      }
      const me = players.find((p) => p.id === localId);
      if (me) {
        localName = me.name;
        localColor = me.color;
      }
      renderLobbyPlayers();
      if (msg.mode === 'playing') {
        showScreen('game');
        mode = 'playing';
        layout();
      }
      break;
    }
    case 'player-joined': {
      if (players.some((p) => p.id === msg.player.id)) break;
      players.push(msg.player);
      balls.set(msg.player.id, createBall(msg.player.ball));
      renderLobbyPlayers();
      showToast(`${msg.player.name} joined`);
      break;
    }
    case 'player-left': {
      players = players.filter((p) => p.id !== msg.id);
      balls.delete(msg.id);
      renderLobbyPlayers();
      updateHud();
      break;
    }
    case 'start': {
      if (msg.holeIds?.length) loadCourse(msg.holeIds, msg.courseSeed);
      hideTipPanel();
      resetTipRoundGate();
      holeIndex = msg.holeIndex;
      turnPlayerId = msg.turnPlayerId;
      leaderboardSavedThisRound = false;
      beginRoundScoreToken();
      resetHolePositions();
      // re-apply from sync if players already set
      phase = 'aiming';
      mode = 'playing';
      showScreen('game');
      scoreOverlay.classList.add('hidden');
      roomPill.classList.remove('hidden');
      roomPill.textContent = roomCode;
      layout();
      beginHoleScoreToken();
      updateHud();
      showToast('Round started!');
      break;
    }
    case 'putt': {
      applyRemotePutt(msg);
      if (isHost) net?.relay(msg, fromId);
      break;
    }
    case 'state-sync': {
      if (isHost) break;
      players = msg.players;
      holeIndex = msg.holeIndex;
      turnPlayerId = msg.turnPlayerId;
      phase = msg.phase as Phase;
      balls.clear();
      for (const p of players) {
        const b = createBall(p.ball);
        b.pos = { ...p.ball };
        b.vel = { ...p.vel };
        b.sunk = p.sunk;
        const moving = Math.hypot(p.vel.x, p.vel.y) > 0.08;
        b.awaitingPutt = !moving && !p.sunk;
        b.settleSteps = 0;
        balls.set(p.id, b);
        holeStrokes.set(p.id, p.strokes[holeIndex] ?? 0);
      }
      if (phase === 'hole-done') openScorecard(holeIndex >= HOLES.length - 1);
      updateHud();
      layout();
      break;
    }
    case 'next-hole': {
      if (isHost) break;
      holeIndex = msg.holeIndex;
      turnPlayerId = msg.turnPlayerId;
      players = msg.players;
      balls.clear();
      holeStrokes.clear();
      for (const p of players) {
        const b = createBall(p.ball);
        b.pos = { ...p.ball };
        balls.set(p.id, b);
        holeStrokes.set(p.id, 0);
      }
      phase = 'aiming';
      scoreOverlay.classList.add('hidden');
      layout();
      beginHoleScoreToken();
      updateHud();
      showToast(`Hole ${holeIndex + 1}: ${getHole(holeIndex).name}`);
      break;
    }
    case 'hole-complete': {
      onHoleSunk(msg.playerId);
      break;
    }
    default:
      break;
  }
}

async function createRoom(): Promise<void> {
  menuError.textContent = '';
  localName = playerName();
  solo = false;
  destroyNet();
  net = setupNetHandlers();
  try {
    createBtn.disabled = true;
    roomCode = await net.createRoom(generateRoomCode(5));
    isHost = true;
    localId = net.localPeerId;
    localColor = selectedPlayerColor();
    holeIndex = 0;
    players = [makePlayer(localId, localName, localColor, getHole(0).tee)];
    balls.clear();
    balls.set(localId, createBall(getHole(0).tee));
    turnPlayerId = localId;
    mode = 'lobby';
    lobbyCode.textContent = roomCode;
    renderLobbyPlayers();
    showScreen('lobby');
    showToast(`Room ${roomCode} created — keep this tab open`);
  } catch (e) {
    menuError.textContent = e instanceof Error ? e.message : String(e);
    destroyNet();
  } finally {
    createBtn.disabled = false;
  }
}

async function joinRoom(): Promise<void> {
  menuError.textContent = '';
  localName = playerName();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    menuError.textContent = 'Enter a 4–6 character room code';
    return;
  }
  solo = false;
  destroyNet();
  net = setupNetHandlers();
  try {
    joinBtn.disabled = true;
    await net.joinRoom(code);
    roomCode = code;
    isHost = false;
    localId = net.localPeerId;
    mode = 'lobby';
    lobbyCode.textContent = roomCode;
    localColor = selectedPlayerColor();
    net.send({ type: 'hello', name: localName, color: localColor });
    renderLobbyPlayers();
    showScreen('lobby');
    showToast(`Joined ${roomCode}`);
  } catch (e) {
    menuError.textContent = e instanceof Error ? e.message : String(e);
    destroyNet();
  } finally {
    joinBtn.disabled = false;
  }
}

function startMultiplayerRound(): void {
  if (!isHost) return;
  hideTipPanel();
  resetTipRoundGate();
  const ids = dealCourse();
  holeIndex = 0;
  leaderboardSavedThisRound = false;
  beginRoundScoreToken();
  for (const p of players) {
    p.strokes = [];
    p.totalStrokes = 0;
  }
  resetHolePositions();
  turnPlayerId = players[0].id;
  phase = 'aiming';
  mode = 'playing';
  showScreen('game');
  roomPill.classList.remove('hidden');
  roomPill.textContent = roomCode;
  layout();
  beginHoleScoreToken();
  updateHud();
  net?.broadcast({ type: 'start', holeIndex, turnPlayerId, holeIds: ids, courseSeed });
  showToast('Round started!');
}

// Events
soloBtn.addEventListener('click', startSolo);
leaderboardMenuBtn.addEventListener('click', openLeaderboard);
scoreLeaderboardBtn.addEventListener('click', openLeaderboard);
shareMenuBtn.addEventListener('click', () => void shareGame());
scoreShareBtn.addEventListener('click', () => void shareGame());
lbCloseBtn.addEventListener('click', closeLeaderboard);
leaderboardOverlay.addEventListener('click', (e) => {
  if (e.target === leaderboardOverlay) closeLeaderboard();
});
createBtn.addEventListener('click', () => void createRoom());
joinBtn.addEventListener('click', () => void joinRoom());
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void joinRoom();
});
startBtn.addEventListener('click', startMultiplayerRound);
leaveLobbyBtn.addEventListener('click', () => {
  destroyNet();
  showScreen('menu');
  mode = 'menu';
});
menuBackBtn.addEventListener('click', () => {
  hideTipPanel();
  resetTipRoundGate();
  destroyNet();
  scoreOverlay.classList.add('hidden');
  closeLeaderboard();
  showScreen('menu');
  mode = 'menu';
  input.enabled = false;
});
nextHoleBtn.addEventListener('click', () => {
  if (!solo && !isHost) return;
  if (holeIndex >= HOLES.length - 1 || phase === 'round-done') {
    startAnotherNine();
    return;
  }
  goNextHole();
});
scoreMenuBtn.addEventListener('click', () => {
  hideTipPanel();
  resetTipRoundGate();
  destroyNet();
  scoreOverlay.classList.add('hidden');
  closeLeaderboard();
  showScreen('menu');
  mode = 'menu';
});

window.addEventListener('resize', () => {
  if (mode === 'playing') layout();
});

// Initial menu leaderboard preview
void refreshMenuLeaderboardPreview();

// Game loop
function tick(ts: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0.016);
  lastTs = ts;

  if (mode !== 'playing') return;

  const hole = getHole(holeIndex);
  let anyMoving = false;

  for (const p of players) {
    const b = balls.get(p.id);
    if (!b) continue;
    const wasSunk = b.sunk;
    if (!b.sunk) stepBall(b, hole, dt);
    if (b.hazard) {
      b.hazard = false;
      const st = (holeStrokes.get(p.id) ?? 0) + 1;
      holeStrokes.set(p.id, st);
      p.strokes[holeIndex] = st;
      showToast(`${p.name} hazard! +1 stroke`);
    }
    syncBallToPlayer(p);
    if (isMoving(b)) anyMoving = true;
    if (!wasSunk && b.sunk) {
      onHoleSunk(p.id);
    }
  }

  if (phase === 'rolling' && !anyMoving) {
    // Water hazard etc. may have stopped — check whose turn ball stopped
    const cur = players.find((p) => p.id === turnPlayerId);
    if (cur && !cur.sunk && !cur.finishedHole) {
      // Still on course — next turn (stroke play: after your ball stops, next player)
      if (solo) {
        phase = 'aiming';
      } else {
        advanceTurn();
        if (isHost) broadcastSync();
      }
    }
    updateHud();
  }

  // Host periodic soft sync while rolling
  if (!solo && isHost && phase === 'rolling') {
    syncAccum += dt;
    if (syncAccum > 0.2) {
      syncAccum = 0;
      broadcastSync();
    }
  }

  const aim = input.getAim();
  const aimPreview =
    aim.active && isMyTurn()
      ? { from: aim.origin, to: aim.current, power: aim.power }
      : null;

  input.enabled = isMyTurn();
  renderer.draw(hole, players, localId, aimPreview, turnPlayerId, showGreenMap);
  updateHud();
}

requestAnimationFrame(tick);

// Expose for smoke tests
(window as unknown as { __miniGolf?: unknown }).__miniGolf = {
  startSolo,
  getHole,
  HOLES,
  applyPutt,
  createBall,
  stepBall,
  isMoving,
};
