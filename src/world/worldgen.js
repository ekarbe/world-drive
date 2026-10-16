// Pure, deterministic world description: terrain height, districts, road network and points of interest.
// No rendering code lives here so it can be unit tested and shared by physics, traffic and the minimap.
//
// Layout:
//  - The world is a grid of CELL x CELL (64 m) chunks. Chunk (i, j) is centred on node (i*64, j*64).
//  - Roads only run along node lines, so every chunk holds one (possible) intersection at its centre
//    plus up to four road "arms" leading out of it.
//  - Districts are DISTRICT x DISTRICT (256 m = 4 chunks). Main roads run along district borders,
//    cities have a street on every node line, villages have one cross street.

import { createNoise2D, fbm, hash3, hashFloat, smoothstep, lerp } from '../core/rng.js';

export const CELL = 64;
export const HALF = CELL / 2;
export const DCELLS = 4;
export const DISTRICT = CELL * DCELLS;

export const ROAD_NONE = 0;
export const ROAD_MAIN = 1;
export const ROAD_STREET = 2;
export const ROAD_LANE = 3;
export const ROAD_WIDTH = [0, 11, 9, 7];

export const SHOP_TYPES = ['dealer', 'tuning', 'paint', 'depot'];

const mod = (a, n) => ((a % n) + n) % n;

export class WorldGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.hNoise = createNoise2D(this.seed ^ 0x1234);
    this.dNoise = createNoise2D(this.seed ^ 0x5678);
    this.uNoise = createNoise2D(this.seed ^ 0x9abc);
    this.fNoise = createNoise2D(this.seed ^ 0xdef0);
    this.cNoise = createNoise2D(this.seed ^ 0x2468);
    this._districts = new Map();
    this._ramps = new Map();
  }

  // ---------------------------------------------------------------- districts

  /** Urbanisation field; cities form where this is high. */
  urbanField(x, z) {
    return fbm(this.uNoise, x / 2200, z / 2200, 3) + 0.25 * this.uNoise(x / 700 + 31.7, z / 700 - 12.3);
  }

  /** District info for district coordinates (dx, dz). Cached. */
  district(dx, dz) {
    const key = (dx + 32768) * 65536 + (dz + 32768);
    let d = this._districts.get(key);
    if (d) return d;
    const cx = (dx + 0.5) * DISTRICT;
    const cz = (dz + 0.5) * DISTRICT;
    const u = this.urbanField(cx, cz);
    let type;
    if (u > 0.34) type = 'city';
    else if (hashFloat(dx, dz, 11, this.seed) < 0.16) type = 'village';
    else type = fbm(this.fNoise, cx / 900, cz / 900, 2) > 0.02 ? 'forest' : 'fields';
    d = { dx, dz, type, specials: [] };
    this._districts.set(key, d);
    d.specials = this._makeSpecials(d);
    if (this._districts.size > 20000) this._districts.clear();
    return d;
  }

  districtAt(x, z) {
    return this.district(Math.floor(x / DISTRICT), Math.floor(z / DISTRICT));
  }

  _makeSpecials(d) {
    const out = [];
    const h = (k) => hash3(d.dx, d.dz, k, this.seed);
    let types = [];
    if (d.type === 'city') {
      const a = h(21) % 4;
      let b = h(22) % 3;
      if (b >= a) b++;
      types = [SHOP_TYPES[a], SHOP_TYPES[b]];
    } else if (d.type === 'village') {
      if (h(23) % 100 < 75) types.push('depot');
      if (h(24) % 100 < 20) types.push('paint');
    }
    const used = new Set();
    types.forEach((type, n) => {
      // Pick an interior chunk node and a quadrant beside it.
      for (let tries = 0; tries < 8; tries++) {
        const r = h(30 + n * 8 + tries);
        const li = d.type === 'village' ? 2 : 1 + (r % 3);
        const lj = d.type === 'village' ? 2 : 1 + ((r >>> 4) % 3);
        const q = (r >>> 8) % 4;
        const key = `${li},${lj},${q}`;
        if (used.has(key)) continue;
        used.add(key);
        const ci = d.dx * DCELLS + li;
        const cj = d.dz * DCELLS + lj;
        const sx = q === 0 || q === 3 ? 1 : -1;
        const sz = q === 0 || q === 1 ? 1 : -1;
        out.push({
          type,
          id: `${type}:${ci}:${cj}:${q}`,
          ci,
          cj,
          q,
          sx,
          sz,
          // Building sits at the outer corner of the quadrant, parking zone near the road.
          bx: ci * CELL + sx * 22.5,
          bz: cj * CELL + sz * 22.5,
          x: ci * CELL + sx * 10.5,
          z: cj * CELL + sz * 10.5,
          name: this._placeName(d, n),
        });
        break;
      }
    });
    return out;
  }

  _placeName(d, n) {
    const A = ['Oak', 'River', 'Stone', 'Maple', 'Sun', 'Pine', 'Iron', 'Fox', 'Silver', 'Elm', 'North', 'Red', 'Lake', 'Cedar', 'Gold', 'Ash'];
    const B = ['ville', 'field', 'ford', 'brook', 'haven', 'ton', 'wood', 'bury', 'port', 'dale', 'gate', 'stead'];
    // Name cities by their "anchor" so neighbouring districts usually share it.
    const ax = Math.floor(d.dx / 3);
    const az = Math.floor(d.dz / 3);
    const r = hash3(ax, az, 99 + n * 0, this.seed);
    return A[r % A.length] + B[(r >>> 8) % B.length];
  }

  townName(x, z) {
    const d = this.districtAt(x, z);
    return this._placeName(d, 0);
  }

  // ---------------------------------------------------------------- terrain

  /** Weight [0..1] of how flattened terrain is for settlements around (x, z). */
  flatWeight(x, z) {
    const dx0 = Math.floor(x / DISTRICT);
    const dz0 = Math.floor(z / DISTRICT);
    let w = 0;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const d = this.district(dx0 + a, dz0 + b);
        if (d.type !== 'city' && d.type !== 'village') continue;
        const x0 = d.dx * DISTRICT;
        const z0 = d.dz * DISTRICT;
        const ex = Math.max(x0 - x, 0, x - (x0 + DISTRICT));
        const ez = Math.max(z0 - z, 0, z - (z0 + DISTRICT));
        const dist = Math.hypot(ex, ez);
        const strength = d.type === 'city' ? 1 : 0.7;
        w = Math.max(w, strength * (1 - smoothstep(0, 110, dist)));
      }
    }
    return w;
  }

  /** Smooth terrain height in metres. Used by physics, roads and terrain meshing. */
  terrainHeight(x, z) {
    const low = fbm(this.hNoise, x / 900, z / 900, 2) * 26;
    const hills = fbm(this.hNoise, x / 380 + 17.1, z / 380 - 4.2, 3) * 12;
    const detail = this.dNoise(x / 120, z / 120) * 2.2;
    const base = low + hills + detail;
    const w = this.flatWeight(x, z);
    if (w <= 0) return base;
    return lerp(base, low * 0.6, w);
  }

  /** Ground height including dynamic features (ramps). */
  groundHeight(x, z) {
    const h = this.terrainHeight(x, z);
    const ramp = this.rampAt(x, z);
    if (!ramp) return h;
    const rh = rampSurface(ramp, x, z);
    return rh > 0 ? Math.max(h, ramp.y + rh) : h;
  }

  /** Approximate ground normal by finite differences. Writes into out {x,y,z}. */
  groundNormal(x, z, out) {
    const e = 0.6;
    const hl = this.groundHeight(x - e, z);
    const hr = this.groundHeight(x + e, z);
    const hd = this.groundHeight(x, z - e);
    const hu = this.groundHeight(x, z + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l;
    out.y = ny / l;
    out.z = nz / l;
    return out;
  }

  // ---------------------------------------------------------------- roads

  _mainEdge(a, b, horizontal) {
    // Main road along a district border. horizontal: edge from corner (a,b) to (a+1,b).
    const d1 = horizontal ? this.district(a, b - 1) : this.district(a - 1, b);
    const d2 = this.district(a, b);
    const urban = (d) => d.type === 'city' || d.type === 'village';
    if (urban(d1) || urban(d2)) return true;
    return hashFloat(a, b, horizontal ? 71 : 72, this.seed) < 0.72;
  }

  /** Road class of horizontal segment from node (i, j) to (i+1, j). */
  segH(i, j) {
    if (mod(j, DCELLS) === 0) {
      return this._mainEdge(Math.floor(i / DCELLS), j / DCELLS, true) ? ROAD_MAIN : ROAD_NONE;
    }
    const d = this.district(Math.floor(i / DCELLS), Math.floor(j / DCELLS));
    if (d.type === 'city') return ROAD_STREET;
    if (d.type === 'village' && mod(j, DCELLS) === 2) return ROAD_LANE;
    return ROAD_NONE;
  }

  /** Road class of vertical segment from node (i, j) to (i, j+1). */
  segV(i, j) {
    if (mod(i, DCELLS) === 0) {
      return this._mainEdge(i / DCELLS, Math.floor(j / DCELLS), false) ? ROAD_MAIN : ROAD_NONE;
    }
    const d = this.district(Math.floor(i / DCELLS), Math.floor(j / DCELLS));
    if (d.type === 'city') return ROAD_STREET;
    if (d.type === 'village' && mod(i, DCELLS) === 2) return ROAD_LANE;
    return ROAD_NONE;
  }

  /** Arms leaving node (i, j): east(+x), west(-x), north(+z), south(-z). */
  nodeArms(i, j) {
    return {
      e: this.segH(i, j),
      w: this.segH(i - 1, j),
      n: this.segV(i, j),
      s: this.segV(i, j - 1),
    };
  }

  /**
   * Road under a point, or null. Returns { cls, axis: 'x'|'z', dist } where dist is the
   * distance from the road centre line.
   */
  roadAt(x, z) {
    const i = Math.round(x / CELL);
    const j = Math.round(z / CELL);
    let best = null;
    // Horizontal road on line z = j*CELL
    const dzl = Math.abs(z - j * CELL);
    if (dzl < 6) {
      const cls = this.segH(Math.floor(x / CELL), j);
      if (cls && dzl <= ROAD_WIDTH[cls] / 2) best = { cls, axis: 'x', dist: dzl };
    }
    const dxl = Math.abs(x - i * CELL);
    if (dxl < 6) {
      const cls = this.segV(i, Math.floor(z / CELL));
      if (cls && dxl <= ROAD_WIDTH[cls] / 2 && (!best || dxl < best.dist)) best = { cls, axis: 'z', dist: dxl };
    }
    return best;
  }

  /** Distance from a point to the nearest road edge (0 if on road). Max lookup ~ one cell. */
  roadClearance(x, z) {
    const i = Math.round(x / CELL);
    const j = Math.round(z / CELL);
    let d = Infinity;
    const clsH = this.segH(Math.floor(x / CELL), j);
    if (clsH) d = Math.min(d, Math.max(0, Math.abs(z - j * CELL) - ROAD_WIDTH[clsH] / 2));
    const clsV = this.segV(i, Math.floor(z / CELL));
    if (clsV) d = Math.min(d, Math.max(0, Math.abs(x - i * CELL) - ROAD_WIDTH[clsV] / 2));
    return d;
  }

  // ---------------------------------------------------------------- ramps

  /** Ramps live in field chunks. Returns ramp descriptor for chunk (i, j) or null. */
  chunkRamp(i, j) {
    const key = (i + 32768) * 65536 + (j + 32768);
    if (this._ramps.has(key)) return this._ramps.get(key);
    let ramp = null;
    const d = this.district(Math.floor(i / DCELLS), Math.floor(j / DCELLS));
    if ((d.type === 'fields' || d.type === 'forest') && hashFloat(i, j, 41, this.seed) < (d.type === 'fields' ? 0.16 : 0.05)) {
      const r = hash3(i, j, 42, this.seed);
      const q = r % 4;
      const sx = q === 0 || q === 3 ? 1 : -1;
      const sz = q === 0 || q === 1 ? 1 : -1;
      const alongX = ((r >>> 4) & 1) === 1;
      const dir = ((r >>> 5) & 1) === 1 ? 1 : -1;
      const cx = i * CELL + sx * 18;
      const cz = j * CELL + sz * 18;
      const len = 11;
      const wid = 7;
      const height = 2.4 + ((r >>> 8) % 3) * 0.5;
      // Base level: lowest terrain under the footprint so the ramp never floats.
      let y = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        y = Math.min(y, this.terrainHeight(cx + a * (alongX ? len : wid) / 2, cz + b * (alongX ? wid : len) / 2));
      }
      ramp = { cx, cz, len, wid, height, alongX, dir, y: y - 0.2 };
    }
    this._ramps.set(key, ramp);
    if (this._ramps.size > 20000) this._ramps.clear();
    return ramp;
  }

  rampAt(x, z) {
    const i = Math.round(x / CELL);
    const j = Math.round(z / CELL);
    const r = this.chunkRamp(i, j);
    if (!r) return null;
    return rampSurface(r, x, z) > -0.01 ? r : null;
  }

  // ---------------------------------------------------------------- points of interest

  /** All special buildings (shops / depots) within radius r of (x, z). */
  poisNear(x, z, r) {
    const out = [];
    const d0x = Math.floor((x - r) / DISTRICT);
    const d1x = Math.floor((x + r) / DISTRICT);
    const d0z = Math.floor((z - r) / DISTRICT);
    const d1z = Math.floor((z + r) / DISTRICT);
    for (let a = d0x; a <= d1x; a++) {
      for (let b = d0z; b <= d1z; b++) {
        for (const s of this.district(a, b).specials) {
          if (Math.hypot(s.x - x, s.z - z) <= r) out.push(s);
        }
      }
    }
    return out;
  }

  /** Special in the given chunk quadrant, if any. */
  specialAt(i, j, q) {
    const d = this.district(Math.floor(i / DCELLS), Math.floor(j / DCELLS));
    return d.specials.find((s) => s.ci === i && s.cj === j && s.q === q) || null;
  }

  /** Finds a spawn point: in front of the nearest dealership/ depot to the origin. */
  findSpawn() {
    for (let r = 0; r < 40; r++) {
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
          const d = this.district(a, b);
          if (d.type !== 'city') continue;
          const s = d.specials.find((p) => p.type === 'dealer') || d.specials[0];
          if (!s) continue;
          // Place the car on the road next to the special, facing along the road.
          const x = s.ci * CELL + s.sx * 14;
          const z = s.cj * CELL;
          return { x, z, heading: s.sx > 0 ? Math.PI / 2 : -Math.PI / 2, special: s };
        }
      }
    }
    return { x: 0, z: 0, heading: 0, special: null };
  }
}

/** Height of a ramp surface above its base at (x, z); negative if outside the footprint. */
export function rampSurface(r, x, z) {
  const lx = r.alongX ? x - r.cx : z - r.cz;
  const lz = r.alongX ? z - r.cz : x - r.cx;
  if (Math.abs(lz) > r.wid / 2 || Math.abs(lx) > r.len / 2) return -1;
  // t from 0 (low end) to 1 (high end)
  const t = (lx * r.dir) / r.len + 0.5;
  return t * r.height;
}
