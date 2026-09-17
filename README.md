# Fooze n Froops Mini Golf ⛳

Browser-based top-down miniature golf — solo offline play or real-time multiplayer with short room codes. Built with **Vite + TypeScript + HTML Canvas** and **Trystero** (BitTorrent tracker signaling) for peer-to-peer sync. No accounts, no paid backend.

Each round plays a fixed **championship course of 9 curated holes** (2× Par 3 · 5× Par 4 · 2× Par 5) with large geometric fairways, ramps/jumps, windmills, a volcano, **real green slopes** (speed up / slow down / break), and wind.

## Championship nine

| # | Name | Par | Highlights |
|---|------|-----|------------|
| 1 | Palm Froops Paradise | 3 | Tropical opener, gated — not a free HIO |
| 2 | Crimson Leaf Dogleg | 4 | Autumn risk/reward dogleg **shortcut** |
| 3 | Dutch Devil Windmill | 4 | Castle **windmill** gate |
| 4 | Neon Banker's Blitz | 3 | Neon arcade narrow bank shot |
| 5 | Blackbeard's Moat | 4 | Pirate **water** hazard / bridge |
| 6 | Mirage Canyon Leap | 5 | Desert long route + **ramp jump shortcut** over **water** |
| 7 | Orbital Skybridge | 4 | Space **ramp/jump** over sand |
| 8 | Mount Magma Mayhem | 4 | **Volcano** + lava hazard |
| 9 | Sugar-Rush Fooze Finale | 5 | Candy spectacle finale + **shortcut** ramp + windmill |

Water on **2/9** (~20%). Shortcuts on **3/9** (~30%). Every green has a coherent height field; **slope dominates wind**. Boards are roomy (~1.5× prior footprint) for phone-filling putts.

## How to play

1. **Aim:** Click/touch near your ball and **drag away** (pull-back aiming). The dashed line shows putt direction; the arc shows power.
2. **Release** to putt. Friction slows the ball; sink it in the cup when you’re slow enough over the hole.
3. Avoid **walls**, bounce off **bumpers**, slog through **sand**, slide on **ice**, and don’t splash in **water/lava** (resets to tee +1).
4. Hit **ramps** with enough speed/aim to jump gaps — failed landings splash or reset fairly.
5. Wind still affects putts subtly when present (no on-screen wind meter).
6. Toggle **Green Map / Topo** for StrackaLine-style contours, downhill ticks, and elevation heatmap (**same height field as physics**).
7. Read the **themed hole plaque** under the green (compact strip; tap to expand): number, full name, par, length, plus **WORLD BEST** per-hole scores.
8. Pick your **ball color** on the start menu (White / Highlighter yellow / Pink / Galactic) — saved for next time.
9. Clear all **9 holes**, check the **scorecard**, then play another 9 (same course order).
10. The **start menu** shows a live **top-scores preview** from the worldwide board; open **Full leaderboard** for everyone. Ties: first recorded score at that stroke total ranks higher (client sorts by strokes, then timestamp when the Scores API provides one).
11. Tap **Share** to send the game link (Web Share on phones, or copy/SMS/email fallback).

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
| `src/physics/world.ts` | Walls, bumpers, hazards, cup, wind, topo break (−g∇h), ramps, windmill blades |
| `src/levels/course.ts` | Curated championship 9 (large fairways) |
| `src/levels/topo.ts` | Height field (map + physics, char-length scaled) |
| `src/levels/themes.ts` | Themed surrounds |
| `src/game/renderer.ts` | Canvas fairway render, green-book map, props |
| `src/net/peer.ts` | Trystero P2P |
| `src/plaques.css` | Designer under-green hole plaques |
| `src/main.ts` | UI + game loop |
