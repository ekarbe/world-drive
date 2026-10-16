# World Drive 🚗

An endless, procedurally generated voxel driving game that runs in the browser.
Cruise through cities, villages, forests and fields, collect coins, pull stunts,
deliver cargo, and spend your earnings on new cars, upgrades and paint jobs.

**Play:** https://ekarbe.github.io/world-drive/

## Features

- **Endless world**: 64 m chunks are streamed in around you with level of detail. Each save has its own fixed world seed.
- **Simcade driving**: a custom raycast-suspension vehicle model with tyre slip, drifting, jumps and air control.
- **Ways to earn coins**: coin pickups, near misses with traffic, drifts, big air off ramps, and delivery missions between depots.
- **Shops**:
  - 🚗 Car dealers: 7 cars, from the Pixel Hatch to the Apex Hyper.
  - 🔧 Tuning shops: engine, tyres, brakes and suspension, 5 levels each.
  - 🎨 Paint shops: paint, rims, racing stripes, underglow and spoilers.
- **AI traffic**: cars follow lanes and turn at intersections.
- **Audio**: synthesized engine and effects plus generative lo-fi music, with no audio files to download.
- **Controls**: keyboard, gamepad and touch.
- **Saving**: autosaves to `localStorage`.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate / brake & reverse | W / S or ↑ / ↓ | RT / LT |
| Steer | A / D or ← / → | Left stick |
| Handbrake | Space | X / RB |
| Enter shop | E / Enter | B |
| Camera | C | Y |
| Map | M | Back |
| Reset car | R | LB |
| Menu | Esc | Start |
| Horn / music toggle | H / N | |

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests (world generation & physics)
npm run build    # production build into dist/
```

Pushing to `main` builds, tests and deploys the game to GitHub Pages (`.github/workflows/deploy.yml`).
In the repository settings, set **Pages → Source** to **GitHub Actions**.

See [DESIGN.md](DESIGN.md) for the architecture and the roadmap.
