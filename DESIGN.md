# World Drive: Design

## Decisions (from the kickoff interview)

| Topic | Decision |
| --- | --- |
| Visual style | Voxel / blocky |
| Stack | Vite + Three.js, deployed to GitHub Pages by GitHub Actions |
| Platforms | Desktop (keyboard/gamepad) and mobile (touch) |
| Driving model | Simcade: custom raycast vehicle, no physics library |
| World | Open, infinite chunked terrain with a road grid |
| Biomes | Cities & villages, forests & fields |
| Traffic | Simple AI traffic |
| Atmosphere | Static daytime |
| Coins | Pickups, stunts / near misses, delivery missions |
| Shops | Car dealer, tuning (performance), paint (cosmetics) |
| Fail state | None: a chill game |
| Saving | localStorage autosave |
| Camera | Chase cam, plus toggles (far chase, hood, top-down) |
| Audio | Synthesized SFX + generative music |
| World seed | Fixed per save |

## Architecture

```
src/
  core/rng.js            hashing, seeded PRNG, simplex noise
  world/worldgen.js      pure world description: height, districts, roads, ramps, POIs
  world/chunk.js         builds one chunk's merged voxel mesh + colliders + coins
  world/chunkManager.js  streaming & LOD around the player
  world/meshBuilder.js   quad/box geometry builder
  vehicle/vehiclePhysics.js  raycast suspension rigid body
  vehicle/collision.js   car vs static colliders (circles vs boxes/circles)
  vehicle/cars.js        car catalogue, upgrades, voxel car models
  game/                  coins, traffic, bonuses, missions, save game
  render/                materials, sky & clouds, camera rig, shop markers
  audio/                 WebAudio engine/SFX and generative music
  ui/                    DOM HUD, menus, shops, minimap
  main.js                game loop & state machine
```

### World layout
- **Chunks** are 64 m squares. Chunk *(i, j)* is centred on road node *(64i, 64j)*,
  so every chunk holds at most one intersection and four road "arms".
- **Districts** are 4×4 chunks (256 m). A low-frequency "urbanisation" noise decides
  where cities are. Rural districts become villages, forests or fields.
- **Roads**: main roads follow district borders, and some rural segments are dropped
  for variety. Cities have a street on every node line, and villages have one cross street.
- Terrain is flattened around settlements. Physics uses the *smooth* height
  function, and the visuals quantise it into 2 m voxel columns, lowered under roads so
  the road ribbons sit on top.
- Everything is derived from the seed, so the world never needs to be stored.

### Vehicle model
Fixed 120 Hz steps. Each wheel raycasts against the heightfield, with a spring and damper
suspension. The tyre model is slip-angle based, with a friction circle shared between
longitudinal and lateral grip, which gives power oversteer and handbrake drifts. The engine
is power-limited, top speed comes from aero drag, and a mild stabiliser plus air control
make it simcade. Upgrades scale the spec (power, grip, brakes, suspension).

## Roadmap / ideas
- Day/night cycle with headlights; weather that affects grip
- Mountains, lakes, bridges, more biomes (desert, snow, beach)
- More mission types (time trials, races vs AI, taxi fares)
- Pedestrians and animals, traffic lights
- Save export/import codes and a shareable seed via URL
- Greedy meshing / web workers for chunk generation on low-end devices
