# Fooze n Froops Mini Golf ⛳

Browser-based top-down miniature golf — solo offline play or real-time multiplayer with short room codes. Built with **Vite + TypeScript + HTML Canvas** and **Trystero** (BitTorrent tracker signaling) for peer-to-peer sync. No accounts, no paid backend.

Each round deals **9 holes from a pool of 1,000** procedurally generated courses, each with a themed surround (tropical, desert, arctic, volcano, neon, pirate, space, autumn, castle, candy).

## How to play

1. **Aim:** Click/touch near your ball and **drag away** (pull-back aiming). The dashed line shows putt direction; the arc shows power.
2. **Release** to putt. Friction slows the ball; sink it in the cup when you’re slow enough over the hole.
3. Avoid **walls**, bounce off **pink bumpers**, slog through **sand**, slide on **ice**, and don’t splash in **water** (resets to tee).
4. Watch the **wind** HUD arrow (and on-green compass) — crosswind drifts the ball more on longer/faster putts. Some greens show **break** (contour lines + downhill chevrons).
5. Clear all **9 holes**, check the **scorecard**, then next hole.

### Solo

Tap **Play Solo** — works fully offline after the page loads. No network required. You get a fresh random 9 from the 1000-hole pool.

### Multiplayer (room codes)

1. One player taps **Create Room** → gets a **5-character code** (e.g. `K7MP2`). **Keep that tab open.**
2. Others enter that code and tap **Join** (both players must keep their tabs open).
3. Host taps **Start Round** — the host deals 9 holes from the 1000-pool and syncs that course to everyone.
4. **Turn-based stroke play** on the same hole: synced ball positions, whose turn, and strokes.
5. HUD shows room code, player list, hole, strokes, and whose turn.

Room codes work **peer-to-peer** via WebRTC (Trystero + public BitTorrent trackers for signaling only). Game data stays between browsers. Solo never needs the network.

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

## Tech overview

| Piece | Role |
|--------|------|
| `src/physics/world.ts` | Walls, bumpers, friction, hazards, cup sink, lateral wind, slope break |
| `src/levels/generate.ts` | Procedural 1000-hole catalog, wind/slope seeds, course deal |
| `src/levels/themes.ts` | Themed surrounds outside each green |
| `src/levels/holes.ts` | Active 9-hole course from the pool |
| `src/game/renderer.ts` | Canvas drawing + theme frames |
| `src/game/input.ts` | Mouse + touch pull-back aim |
| `src/net/peer.ts` | Room codes + Trystero P2P sync |
| `src/main.ts` | UI, game loop, multiplayer orchestration |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |

## License

MIT — have fun on the green.
