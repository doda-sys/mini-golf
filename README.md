# Putt-Putt Mini Golf ⛳

Browser-based top-down miniature golf — solo offline play or real-time multiplayer with short room codes. Built with **Vite + TypeScript + HTML Canvas** and **PeerJS** (free cloud broker) for P2P sync. No accounts, no paid backend.

## How to play

1. **Aim:** Click/touch near your ball and **drag away** (pull-back aiming). The dashed line shows putt direction; the arc shows power.
2. **Release** to putt. Friction slows the ball; sink it in the cup when you’re slow enough over the hole.
3. Avoid **walls**, bounce off **pink bumpers**, slog through **sand**, slide on **ice**, and don’t splash in **water** (resets to tee).
4. Clear all **5 holes**, check the **scorecard**, then next hole.

### Solo

Tap **Play Solo** — works fully offline after the page loads. No network required.

### Multiplayer (room codes)

1. One player taps **Create Room** → gets a **5-character code** (e.g. `K7MP2`).
2. Others enter that code and tap **Join**.
3. Host taps **Start Round**.
4. **Turn-based stroke play** on the same hole: synced ball positions, whose turn, and strokes.
5. HUD shows room code, player list, hole, strokes, and whose turn.

Uses [PeerJS](https://peerjs.com/) cloud PeerServer (free). Both players need network access for WebRTC. Solo never needs it.

## Local development

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Build

```bash
npm run build
```

Static files land in `dist/`. Preview with:

```bash
npm run preview
```

## Deploy (GitHub Pages)

This repo is configured for **GitHub Pages from GitHub Actions**:

- Workflow: `.github/workflows/deploy-pages.yml`
- Builds with `npm ci && npm run build`
- Publishes the `dist/` folder
- Vite `base` is `./` so the game works from project pages or a custom root

**Enable Pages:** Repo → Settings → Pages → Source: **GitHub Actions**.

After the first successful workflow run, the site URL appears on the Actions / Pages settings page.

You can also drop `dist/` onto any static host (Netlify, Cloudflare Pages, S3, nginx, etc.).

### Optional: custom PeerServer

By default the game uses the public PeerJS broker. For heavier traffic, run your own PeerServer and point PeerJS at it in `src/net/peer.ts`.

## Tech overview

| Piece | Role |
|--------|------|
| `src/physics/world.ts` | Circle vs AABB walls, bumper bounce, friction, sand/ice/water, cup sink |
| `src/levels/holes.ts` | 5 distinct holes |
| `src/game/renderer.ts` | Canvas drawing |
| `src/game/input.ts` | Mouse + touch pull-back aim |
| `src/net/peer.ts` | Room codes + PeerJS host/guest sync |
| `src/main.ts` | UI, game loop, multiplayer orchestration |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |

## License

MIT — have fun on the green.
