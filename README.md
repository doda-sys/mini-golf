# Fooze n Froops Mini Golf ⛳

Browser-based top-down miniature golf — solo offline play or real-time multiplayer with short room codes. Built with **Vite + TypeScript + HTML Canvas** and **Trystero** (BitTorrent tracker signaling) for peer-to-peer sync. No accounts, no paid backend.

Each round plays a fixed **championship course of 9 curated holes** (2× Par 3 · 5× Par 4 · 2× Par 5) with large geometric fairways, ramps/jumps, windmills, a volcano, real green slopes, and wind.

## Championship nine

| # | Name | Par | Highlights |
|---|------|-----|------------|
| 1 | Froops Fairway | 3 | Clean opener, gated — not a free HIO |
| 2 | Dogleg Delight | 4 | Risk/reward dogleg **shortcut** |
| 3 | Windmill Whirl | 4 | Rotating **windmill** gate |
| 4 | Banker's Alley | 3 | Short, narrow bank shot |
| 5 | Pirate's Moat | 4 | **Water** hazard / bridge |
| 6 | Canyon Leap | 5 | Long route + **ramp jump shortcut** over **water** |
| 7 | Skybridge Ramp | 4 | **Ramp/jump** over sand |
| 8 | Volcano Vista | 4 | **Volcano** + lava hazard |
| 9 | Fooze Finale | 5 | Spectacle finale + **shortcut** ramp + windmill |

Water on **2/9** (~20%). Shortcuts on **3/9** (~30%). Every green has real topo break; **slope dominates wind**.

## How to play

1. **Aim:** Click/touch near your ball and **drag away** (pull-back aiming). The dashed line shows putt direction; the arc shows power.
2. **Release** to putt. Friction slows the ball; sink it in the cup when you’re slow enough over the hole.
3. Avoid **walls**, bounce off **bumpers**, slog through **sand**, slide on **ice**, and don’t splash in **water/lava** (resets to tee +1).
4. Hit **ramps** with enough speed/aim to jump gaps — failed landings splash or reset fairly.
5. Watch the large on-course **WIND** key (compass + **0–25 mph**) — secondary to green break.
6. Toggle **Green Map / Topo** for contour lines, downhill arrows, and a steepness heatmap (same height field as physics).
7. Read the **hole plaque** (outside the green): number, name, par, length in feet.
8. Clear all **9 holes**, check the **scorecard**, then play another 9 (same course order).

### Solo

Tap **Play Solo** — works fully offline after the page loads.

### Multiplayer (room codes)

1. One player taps **Create Room** → gets a **5-character code**. **Keep that tab open.**
2. Others enter that code and tap **Join**.
3. Host taps **Start Round** — syncs the championship 9 to everyone.
4. **Turn-based stroke play** on the same hole.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy (GitHub Pages)

Live URL: https://doda-sys.github.io/mini-golf/

## Tech overview

| Piece | Role |
|--------|------|
| `src/physics/world.ts` | Walls, bumpers, hazards, cup, wind, topo break, ramps, windmill blades |
| `src/levels/course.ts` | Curated championship 9 |
| `src/levels/topo.ts` | Height field (map + physics) |
| `src/levels/themes.ts` | Themed surrounds |
| `src/game/renderer.ts` | Canvas, plaque, wind key, green map, props |
| `src/net/peer.ts` | Trystero P2P |
| `src/main.ts` | UI + game loop |
