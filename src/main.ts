import './style.css';
import { HOLES, getHole } from './levels/holes';
import { Renderer } from './game/renderer';
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

const COLORS = PLAYER_COLORS;

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
const toast = el('div', { id: 'toast' });

app.append(menuScreen, lobbyScreen, gameScreen, scoreOverlay, toast);

// Menu
menuScreen.append(
  el('div', { id: 'menu-decor', text: '⛳' }),
  el('h1', { class: 'logo' }, ['Putt-Putt ', el('span', { text: 'Mini Golf' })]),
  el('p', { class: 'tagline', text: 'Solo or multiplayer · 5 holes · drag to aim' }),
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
const soloBtn = el('button', { class: 'btn accent', type: 'button', text: 'Play Solo' });
const createBtn = el('button', { class: 'btn', type: 'button', text: 'Create Room' });
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
menuCard.append(
  el('label', { text: 'Player name', for: 'player-name' }),
  nameInput,
  soloBtn,
  createBtn,
  el('label', { text: 'Join with code' }),
  joinRow,
  menuError,
  el('p', {
    class: 'hint',
    text: 'Multiplayer uses PeerJS (free cloud broker). Create a room, share the code, take turns on the same hole.',
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
const turnPill = el('div', { class: 'hud-pill turn', text: 'Your turn' });
const roomPill = el('div', { class: 'hud-pill room hidden', text: '' });
const playersBar = el('div', { id: 'players-bar' });
const menuBackBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Menu', style: 'padding:6px 12px;font-size:0.85rem' });
hud.append(holePill, strokesPill, turnPill, roomPill, playersBar, menuBackBtn);

const canvasWrap = el('div', { id: 'canvas-wrap' });
const canvas = el('canvas', { id: 'game-canvas' });
canvasWrap.append(canvas);
gameScreen.append(hud, canvasWrap);

// Score overlay content
const scoreCard = el('div', { class: 'card' });
const scoreTitle = el('h2', { text: 'Scorecard', style: 'margin:0' });
const scoreBody = el('div');
const nextHoleBtn = el('button', { class: 'btn accent', type: 'button', text: 'Next Hole' });
const scoreMenuBtn = el('button', { class: 'btn secondary', type: 'button', text: 'Main Menu' });
scoreCard.append(scoreTitle, scoreBody, nextHoleBtn, scoreMenuBtn);
scoreOverlay.append(scoreCard);

// ---- State ----
type Phase = 'aiming' | 'rolling' | 'hole-done' | 'round-done';

let mode: GameMode = 'menu';
let solo = true;
let isHost = false;
let localId = 'local';
let localName = nameInput.value;
let localColor = COLORS[0];
let holeIndex = 0;
let players: PlayerInfo[] = [];
let balls = new Map<string, BallState>();
let turnPlayerId = localId;
let phase: Phase = 'aiming';
let holeStrokes = new Map<string, number>();
let net: GolfNet | null = null;
let roomCode = '';
let lastTs = 0;
let syncAccum = 0;

const renderer = new Renderer(canvas);

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
  solo = true;
  isHost = true;
  localId = 'local';
  localName = playerName();
  localColor = COLORS[0];
  holeIndex = 0;
  players = [makePlayer(localId, localName, localColor, getHole(0).tee)];
  balls.clear();
  resetHolePositions();
  turnPlayerId = localId;
  phase = 'aiming';
  mode = 'playing';
  roomPill.classList.add('hidden');
  showScreen('game');
  layout();
  input.enabled = true;
  showToast('Drag from the ball to aim · release to putt');
}

function layout(): void {
  renderer.resize(getHole(holeIndex));
}

function updateHud(): void {
  const hole = getHole(holeIndex);
  holePill.textContent = `Hole ${holeIndex + 1}/${HOLES.length} · Par ${hole.par}`;
  const me = localPlayer();
  const st = holeStrokes.get(localId) ?? 0;
  strokesPill.textContent = `Strokes ${st}`;
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
      dot.style.background = p.color;
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

function openScorecard(final: boolean): void {
  scoreTitle.textContent = final ? 'Final Scores' : `Hole ${holeIndex + 1} Complete`;
  const table = el('table', { class: 'score-table' });
  const head = el('tr');
  head.append(el('th', { text: 'Player' }));
  for (let i = 0; i <= holeIndex; i++) head.append(el('th', { text: String(i + 1) }));
  head.append(el('th', { text: 'Tot' }));
  table.append(head);
  const sorted = [...players].sort((a, b) => a.totalStrokes - b.totalStrokes);
  for (const p of sorted) {
    const tr = el('tr');
    tr.append(el('td', { text: p.name }));
    for (let i = 0; i <= holeIndex; i++) {
      tr.append(el('td', { text: p.strokes[i] != null ? String(p.strokes[i]) : '—' }));
    }
    const tot = el('td', { class: 'total', text: String(p.totalStrokes) });
    tr.append(tot);
    table.append(tr);
  }
  scoreBody.replaceChildren(table);
  const more = holeIndex < HOLES.length - 1;
  nextHoleBtn.classList.toggle('hidden', !more || (!solo && !isHost));
  nextHoleBtn.textContent = more ? 'Next Hole' : 'Finish';
  if (!more) {
    nextHoleBtn.classList.remove('hidden');
    nextHoleBtn.textContent = solo || isHost ? 'Play Again' : 'Waiting for host…';
    if (!solo && !isHost) nextHoleBtn.disabled = true;
    else nextHoleBtn.disabled = false;
  } else {
    nextHoleBtn.disabled = !solo && !isHost;
  }
  scoreOverlay.classList.remove('hidden');
}

function goNextHole(): void {
  scoreOverlay.classList.add('hidden');
  if (holeIndex >= HOLES.length - 1) {
    // Restart course
    holeIndex = 0;
    for (const p of players) {
      p.strokes = [];
      p.totalStrokes = 0;
    }
  } else {
    holeIndex++;
  }
  resetHolePositions();
  turnPlayerId = players[0]?.id ?? localId;
  phase = 'aiming';
  layout();
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
      dot.style.background = p.color;
      row.append(dot, document.createTextNode(p.name + (p.id === localId ? ' (you)' : '') + (isHost && p.id === localId ? ' · host' : '')));
      return row;
    }),
  );
  startBtn.style.display = isHost ? '' : 'none';
  lobbyHint.textContent = isHost
    ? 'Share the room code. Start when everyone has joined.'
    : 'Waiting for host to start…';
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
      if (!isHost) return;
      // Wait for hello
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
      const color = COLORS[players.length % COLORS.length];
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
        },
        fromId,
      );
      net?.relay({ type: 'player-joined', player: p }, fromId);
      renderLobbyPlayers();
      break;
    }
    case 'welcome': {
      players = msg.players;
      holeIndex = msg.holeIndex;
      turnPlayerId = msg.turnPlayerId;
      balls.clear();
      for (const p of players) {
        const b = createBall(p.ball);
        b.pos = { ...p.ball };
        b.vel = { ...p.vel };
        b.sunk = p.sunk;
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
      holeIndex = msg.holeIndex;
      turnPlayerId = msg.turnPlayerId;
      resetHolePositions();
      // re-apply from sync if players already set
      phase = 'aiming';
      mode = 'playing';
      showScreen('game');
      scoreOverlay.classList.add('hidden');
      roomPill.classList.remove('hidden');
      roomPill.textContent = roomCode;
      layout();
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
    localColor = COLORS[0];
    holeIndex = 0;
    players = [makePlayer(localId, localName, localColor, getHole(0).tee)];
    balls.clear();
    balls.set(localId, createBall(getHole(0).tee));
    turnPlayerId = localId;
    mode = 'lobby';
    lobbyCode.textContent = roomCode;
    renderLobbyPlayers();
    showScreen('lobby');
    showToast(`Room ${roomCode} created`);
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
    net.send({ type: 'hello', name: localName, color: COLORS[1] });
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
  holeIndex = 0;
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
  updateHud();
  net?.broadcast({ type: 'start', holeIndex, turnPlayerId });
  showToast('Round started!');
}

// Events
soloBtn.addEventListener('click', startSolo);
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
  destroyNet();
  scoreOverlay.classList.add('hidden');
  showScreen('menu');
  mode = 'menu';
  input.enabled = false;
});
nextHoleBtn.addEventListener('click', () => {
  if (!solo && !isHost) return;
  if (holeIndex >= HOLES.length - 1) {
    // play again
    goNextHole();
    return;
  }
  goNextHole();
});
scoreMenuBtn.addEventListener('click', () => {
  destroyNet();
  scoreOverlay.classList.add('hidden');
  showScreen('menu');
  mode = 'menu';
});

window.addEventListener('resize', () => {
  if (mode === 'playing') layout();
});

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
      showToast(`${p.name} splashed! +1 stroke`);
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
  renderer.draw(hole, players, localId, aimPreview, turnPlayerId);
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
