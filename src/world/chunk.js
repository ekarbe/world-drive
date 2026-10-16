// Builds the static content of one 64x64 m chunk: voxel terrain, road ribbons, buildings,
// trees, ramps plus gameplay data (colliders, coins, special buildings).

import { MeshBuilder, lin } from './meshBuilder.js';
import { CELL, HALF, ROAD_MAIN, ROAD_STREET, ROAD_WIDTH } from './worldgen.js';
import { mulberry32, hash3, smoothstep } from '../core/rng.js';

const Q = 0.5; // vertical voxel quantum
const DIRS = [
  { k: 'e', dx: 1, dz: 0 },
  { k: 'w', dx: -1, dz: 0 },
  { k: 'n', dx: 0, dz: 1 },
  { k: 's', dx: 0, dz: -1 },
];
const QUADS = [
  { q: 0, sx: 1, sz: 1 },
  { q: 1, sx: -1, sz: 1 },
  { q: 2, sx: -1, sz: -1 },
  { q: 3, sx: 1, sz: -1 },
];

const C = {
  grass: 0x79b84a,
  grassDark: 0x5f9c3c,
  forest: 0x4c8a37,
  dirt: 0x86613f,
  rock: 0x8d877d,
  pave: 0xa3a39e,
  paveSide: 0x85857f,
  asphalt: 0x3e4047,
  street: 0x4a4c53,
  lane: 0x80786c,
  yellow: 0xe9c43f,
  white: 0xf0f0ea,
  trunk: 0x6b4a2f,
  pine: 0x2f6e3c,
  oak: 0x56a03f,
  oak2: 0x6fb446,
  ramp: 0xe0823a,
  rampStripe: 0xf3d34a,
};
const CROPS = [0xd8c058, 0x93c247, 0x8d6a45, 0xb7d36b, 0xc9a34a, 0x9f7fc2];
const CITY_COLORS = [0xd9d4c7, 0xb9b4a8, 0x9aa3ad, 0xc98c6a, 0xa65d4a, 0x7f9fb8, 0x5e8a8f, 0xe3c99a, 0x8d8f99, 0xcfd8dc];
const HOUSE_COLORS = [0xf2ead8, 0xe8d5b0, 0xd9e4ec, 0xf0d2c0, 0xcfe3c4, 0xf5f0e6];
const ROOF_COLORS = [0xa8432f, 0x8a3b2a, 0x5b4a42, 0x3f5a73, 0x6e7a3c];

export function buildChunk(world, i, j, lod) {
  const seed = world.seed;
  const rand = mulberry32(hash3(i, j, 7, seed));
  const mb = new MeshBuilder();
  const colliders = [];
  const coins = [];
  const specials = [];
  const ox = i * CELL; // node / chunk centre
  const oz = j * CELL;
  const arms = world.nodeArms(i, j);
  const anyRoad = arms.e || arms.w || arms.n || arms.s;
  const padW = Math.max(ROAD_WIDTH[arms.e], ROAD_WIDTH[arms.w], ROAD_WIDTH[arms.n], ROAD_WIDTH[arms.s]);
  const ramp = world.chunkRamp(i, j);

  // ---------------------------------------------------------------- lots / quadrants
  const lots = QUADS.map(({ q, sx, sz }) => {
    const vArm = sz > 0 ? arms.n : arms.s;
    const hArm = sx > 0 ? arms.e : arms.w;
    const innerX = vArm ? ROAD_WIDTH[vArm] / 2 + 1.5 : anyRoad ? padW / 2 + 1 : 0.5;
    const innerZ = hArm ? ROAD_WIDTH[hArm] / 2 + 1.5 : anyRoad ? padW / 2 + 1 : 0.5;
    const x0 = sx > 0 ? ox + innerX : ox - HALF + 0.5;
    const x1 = sx > 0 ? ox + HALF - 0.5 : ox - innerX;
    const z0 = sz > 0 ? oz + innerZ : oz - HALF + 0.5;
    const z1 = sz > 0 ? oz + HALF - 0.5 : oz - innerZ;
    const district = world.districtAt(ox + sx * 16, oz + sz * 16);
    const special = world.specialAt(i, j, q);
    let kind = district.type;
    if (special) kind = 'special';
    else if (district.type === 'city' && hash3(i, j, 300 + q, seed) % 100 < 12) kind = 'park';
    return { q, sx, sz, x0, x1, z0, z1, district, special, kind, vArm, hArm };
  });
  const lotAt = (x, z) => lots[x >= ox ? (z >= oz ? 0 : 3) : z >= oz ? 1 : 2];

  // ---------------------------------------------------------------- terrain voxels
  const s = lod === 0 ? 2 : lod === 1 ? 4 : 8;
  const n = CELL / s;
  const x0 = ox - HALF;
  const z0 = oz - HALF;
  const N2 = n + 2;
  const tops = new Float32Array(N2 * N2);
  for (let a = -1; a <= n; a++) {
    for (let b = -1; b <= n; b++) {
      const cx = x0 + (a + 0.5) * s;
      const cz = z0 + (b + 0.5) * s;
      const h = world.terrainHeight(cx, cz);
      const onRoad = world.roadClearance(cx, cz) < s * 0.5 + 0.2;
      tops[(a + 1) * N2 + (b + 1)] = onRoad ? Math.floor(h / Q) * Q - 0.5 : Math.round(h / Q) * Q;
    }
  }
  const cropSeed = (x, z) => hash3(Math.floor(x / 24), Math.floor(z / 24), 501, seed);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const cx = x0 + (a + 0.5) * s;
      const cz = z0 + (b + 0.5) * s;
      const top = tops[(a + 1) * N2 + (b + 1)];
      const lot = lotAt(cx, cz);
      const vr = 0.94 + (hash3(Math.floor(cx), Math.floor(cz), 5, seed) % 1000) / 1000 * 0.12;
      let topC;
      let sideC;
      const nb = [tops[a * N2 + (b + 1)], tops[(a + 2) * N2 + (b + 1)], tops[(a + 1) * N2 + b], tops[(a + 1) * N2 + (b + 2)]];
      const steep = Math.max(...nb.map((t) => Math.abs(t - top))) > 1.6;
      const kind = lot.kind;
      if (kind === 'city' || kind === 'special') {
        topC = lin(C.pave, vr);
        sideC = lin(C.paveSide);
      } else if (steep) {
        topC = lin(C.rock, vr);
        sideC = lin(C.rock, 0.85);
      } else if (kind === 'fields') {
        const r = cropSeed(cx, cz);
        if (r % 100 < 22) {
          topC = lin(C.grass, vr);
        } else {
          const crop = CROPS[r % CROPS.length];
          const stripe = ((r >>> 8) & 1 ? Math.floor(cx / 2) : Math.floor(cz / 2)) % 2 === 0 ? 1 : 0.86;
          topC = lin(crop, stripe * (0.97 + (vr - 1) * 0.5));
        }
        sideC = lin(C.dirt);
      } else if (kind === 'forest') {
        topC = lin(C.forest, vr);
        sideC = lin(C.dirt);
      } else {
        topC = lin(hash3(Math.floor(cx / 6), Math.floor(cz / 6), 9, seed) % 3 === 0 ? C.grassDark : C.grass, vr);
        sideC = lin(C.dirt);
      }
      const xa = x0 + a * s;
      const xb = xa + s;
      const za = z0 + b * s;
      const zb = za + s;
      mb.quad([xa, top, zb], [xb, top, zb], [xb, top, za], [xa, top, za], topC, null, [0, 1, 0]);
      // sides where the neighbour is lower
      const [tw, te, ts, tn] = nb;
      if (te < top) mb.quad([xb, te, zb], [xb, te, za], [xb, top, za], [xb, top, zb], sideC, null, [1, 0, 0]);
      if (tw < top) mb.quad([xa, tw, za], [xa, tw, zb], [xa, top, zb], [xa, top, za], sideC, null, [-1, 0, 0]);
      if (tn < top) mb.quad([xa, tn, zb], [xb, tn, zb], [xb, top, zb], [xa, top, zb], sideC, null, [0, 0, 1]);
      if (ts < top) mb.quad([xb, ts, za], [xa, ts, za], [xa, top, za], [xb, top, za], sideC, null, [0, 0, -1]);
    }
  }

  // ---------------------------------------------------------------- roads
  const ROAD_Y = 0.08;
  const roadColor = (cls) => lin(cls === ROAD_MAIN ? C.asphalt : cls === ROAD_STREET ? C.street : C.lane);
  const th = (x, z) => world.terrainHeight(x, z);
  const st = lod === 0 ? 2 : lod === 1 ? 4 : 8;

  /** Ribbon along an arm direction from t0 to t1, lateral range [l0, l1], lifted by dy. */
  const ribbon = (dir, t0, t1, l0, l1, dy, c, step = st) => {
    const px = -dir.dz;
    const pz = dir.dx;
    const steps = Math.max(1, Math.ceil((t1 - t0) / step));
    const dt = (t1 - t0) / steps;
    for (let k = 0; k < steps; k++) {
      const ta = t0 + k * dt;
      const tb = ta + dt;
      const P = (t, l) => {
        const x = ox + dir.dx * t + px * l;
        const z = oz + dir.dz * t + pz * l;
        return [x, th(x, z) + dy, z];
      };
      upQuad(mb, P(ta, l0), P(tb, l0), P(tb, l1), P(ta, l1), c);
    }
  };

  if (anyRoad) {
    // Intersection pad
    const pc = roadColor(Math.min(...[arms.e, arms.w, arms.n, arms.s].filter(Boolean)));
    const pn = Math.max(1, Math.ceil(padW / st));
    const pd = padW / pn;
    for (let a = 0; a < pn; a++) {
      for (let b = 0; b < pn; b++) {
        const xa = ox - padW / 2 + a * pd;
        const za = oz - padW / 2 + b * pd;
        const P = (x, z) => [x, th(x, z) + ROAD_Y, z];
        upQuad(mb, P(xa, za), P(xa + pd, za), P(xa + pd, za + pd), P(xa, za + pd), pc);
      }
    }
    for (const dir of DIRS) {
      const cls = arms[dir.k];
      if (!cls) continue;
      const w = ROAD_WIDTH[cls];
      const start = padW / 2;
      ribbon(dir, start, HALF, -w / 2, w / 2, ROAD_Y, roadColor(cls));
      if (lod === 0) {
        const MY = ROAD_Y + 0.06;
        if (cls === ROAD_MAIN) {
          // dashed centre line + solid edge lines
          for (let t = start + 2; t + 3 <= HALF; t += 7) ribbon(dir, t, t + 3, -0.15, 0.15, MY, lin(C.yellow), 3);
          ribbon(dir, start, HALF, -w / 2 + 0.5, -w / 2 + 0.75, MY, lin(C.white));
          ribbon(dir, start, HALF, w / 2 - 0.75, w / 2 - 0.5, MY, lin(C.white));
        } else if (cls === ROAD_STREET) {
          for (let t = start + 5; t + 2.5 <= HALF; t += 6) ribbon(dir, t, t + 2.5, -0.12, 0.12, MY, lin(C.white), 2.5);
          // crosswalk
          for (let l = -w / 2 + 0.8; l + 0.6 <= w / 2 - 0.5; l += 1.2) ribbon(dir, start + 0.6, start + 3.4, l, l + 0.6, MY, lin(C.white), 2.8);
          // street lamps
          if (lod === 0) {
            const side = dir.k === 'e' || dir.k === 'n' ? 1 : -1;
            const t = 18;
            const lx = ox + dir.dx * t + -dir.dz * side * (w / 2 + 1.2);
            const lz = oz + dir.dz * t + dir.dx * side * (w / 2 + 1.2);
            const ly = th(lx, lz);
            mb.cbox(lx, ly + 2.75, lz, 0.25, 5.5, 0.25, lin(0x55585e));
            mb.cbox(lx - dir.dz * side * -0.6, ly + 5.5, lz + dir.dx * side * -0.6, 0.5, 0.25, 0.5, lin(0xfff3c4), { shade: 1 });
            colliders.push({ type: 'circle', x: lx, z: lz, r: 0.35 });
          }
        }
      }
      // coins along the arm
      if (hash3(i, j, 600 + dir.dx * 3 + dir.dz, seed) % 100 < (cls === ROAD_MAIN ? 30 : 18)) {
        const lane = (hash3(i, j, 610 + dir.dx * 3 + dir.dz, seed) & 1 ? 1 : -1) * (w / 4);
        for (let k = 0; k < 4; k++) {
          const t = start + 6 + k * 5.5;
          const x = ox + dir.dx * t - dir.dz * lane;
          const z = oz + dir.dz * t + dir.dx * lane;
          coins.push({ id: `${i}:${j}:${dir.k}${k}`, x, y: th(x, z) + 1.1, z });
        }
      }
    }
  }

  // ---------------------------------------------------------------- lots content
  for (const lot of lots) {
    const lr = mulberry32(hash3(i, j, 1000 + lot.q, seed));
    const W = lot.x1 - lot.x0;
    const D = lot.z1 - lot.z0;
    if (W < 4 || D < 4) continue;
    const baseAt = (xa, za, xb, zb) =>
      Math.min(th(xa, za), th(xb, za), th(xa, zb), th(xb, zb), th((xa + xb) / 2, (za + zb) / 2)) - 0.6;

    if (lot.kind === 'special') {
      addSpecial(mb, lot.special, baseAt, colliders, lod);
      specials.push(lot.special);
      continue;
    }

    if (lot.kind === 'city') {
      const u = world.urbanField(ox, oz);
      const hmax = 10 + 48 * smoothstep(0.34, 0.62, u);
      const split = lr() < 0.45 && W > 14 && D > 14;
      const parts = split ? splitLot(lot, lr) : [[lot.x0, lot.z0, lot.x1, lot.z1]];
      for (const [ax, az, bx, bz] of parts) {
        const inset = 1.2;
        const xa = ax + inset, za = az + inset, xb = bx - inset, zb = bz - inset;
        if (xb - xa < 4 || zb - za < 4) continue;
        const y0 = baseAt(xa, za, xb, zb);
        const H = Math.round((7 + lr() * (hmax - 7) * (split ? 0.7 : 1)) / 3.2) * 3.2 + 0.6;
        const col = lin(lr.pick(CITY_COLORS));
        mb.box(xa, y0, za, xb, y0 + H, zb, col, { windows: { sx: 3, sy: 3.2, base: 0.6 }, top: lin(0x8a8a86) });
        if (lod === 0) {
          // roof details
          mb.box(xa, y0 + H, za, xb, y0 + H + 0.5, za + 0.4, lin(0x9c9c98));
          mb.box(xa, y0 + H, zb - 0.4, xb, y0 + H + 0.5, zb, lin(0x9c9c98));
          if (lr() < 0.7) mb.cbox(xa + (xb - xa) * lr.range(0.3, 0.7), y0 + H + 0.8, za + (zb - za) * lr.range(0.3, 0.7), 2.2, 1.6, 1.8, lin(0xb8bcc0));
          if (H > 30 && lr() < 0.5) mb.cbox((xa + xb) / 2, y0 + H + 4, (za + zb) / 2, 0.25, 8, 0.25, lin(0xcc3333));
        }
        colliders.push({ type: 'box', x0: xa, z0: za, x1: xb, z1: zb, top: y0 + H });
      }
      continue;
    }

    if (lot.kind === 'park') {
      const cnt = lod === 2 ? 2 : 5;
      for (let k = 0; k < cnt; k++) {
        const x = lr.range(lot.x0 + 2, lot.x1 - 2);
        const z = lr.range(lot.z0 + 2, lot.z1 - 2);
        addTree(mb, x, th(x, z), z, 'oak', lr, lod);
        colliders.push({ type: 'circle', x, z, r: 0.7 });
      }
      continue;
    }

    if (lot.kind === 'village') {
      if (lot.vArm || lot.hArm) {
        // House facing the nearest road
        const hw = lr.range(7, 9);
        const hd = lr.range(6, 8);
        const cx = lot.sx > 0 ? lot.x0 + 2 + hw / 2 : lot.x1 - 2 - hw / 2;
        const cz = lot.sz > 0 ? lot.z0 + 2 + hd / 2 : lot.z1 - 2 - hd / 2;
        addHouse(mb, cx, cz, hw, hd, baseAt, lr, colliders, lod);
        if (lr() < 0.6) {
          const x = lot.sx > 0 ? lot.x1 - 4 : lot.x0 + 4;
          const z = lot.sz > 0 ? lot.z1 - 4 : lot.z0 + 4;
          addTree(mb, x, th(x, z), z, 'oak', lr, lod);
          colliders.push({ type: 'circle', x, z, r: 0.7 });
        }
      } else {
        scatterTrees(world, mb, lot, lr, 3, lod, colliders, ramp, 'oak');
      }
      continue;
    }

    if (lot.kind === 'forest') {
      scatterTrees(world, mb, lot, lr, lod === 2 ? 5 : 11, lod, colliders, ramp, null);
      const cr = mulberry32(hash3(i, j, 2000 + lot.q, seed));
      if (cr() < 0.12) addCoinCluster(world, lot, cr, coins, `${i}:${j}:f${lot.q}`, colliders);
      continue;
    }

    if (lot.kind === 'fields') {
      const roll = lr();
      if (roll < 0.07 && (lot.vArm || lot.hArm)) {
        const cx = (lot.x0 + lot.x1) / 2;
        const cz = (lot.z0 + lot.z1) / 2;
        addBarn(mb, cx, cz, baseAt, lr, colliders);
      } else if (roll < 0.3) {
        // haystacks
        const cnt = lr.int(1, 3);
        for (let k = 0; k < cnt; k++) {
          const x = lr.range(lot.x0 + 3, lot.x1 - 3);
          const z = lr.range(lot.z0 + 3, lot.z1 - 3);
          if (ramp && Math.hypot(x - ramp.cx, z - ramp.cz) < 16) continue;
          const y = th(x, z);
          mb.cbox(x, y + 0.7, z, 2.2, 1.8, 2.2, lin(0xe2c35a), { top: lin(0xedd27a) });
          colliders.push({ type: 'circle', x, z, r: 1.3 });
        }
      } else if (roll < 0.45) {
        scatterTrees(world, mb, lot, lr, 2, lod, colliders, ramp, 'oak');
      }
      const cr = mulberry32(hash3(i, j, 2000 + lot.q, seed));
      if (cr() < 0.15) addCoinCluster(world, lot, cr, coins, `${i}:${j}:c${lot.q}`, colliders);
    }
  }

  // ---------------------------------------------------------------- ramp
  if (ramp) {
    addRamp(mb, ramp);
    // Coin arc over the jump
    const fx = ramp.alongX ? ramp.dir : 0;
    const fz = ramp.alongX ? 0 : ramp.dir;
    const ex = ramp.cx + fx * ramp.len / 2;
    const ez = ramp.cz + fz * ramp.len / 2;
    for (let k = 0; k < 4; k++) {
      const d = 4 + k * 4;
      coins.push({
        id: `${i}:${j}:r${k}`,
        x: ex + fx * d,
        z: ez + fz * d,
        y: ramp.y + ramp.height + 1.2 + Math.sin((k / 3) * Math.PI) * 0.6,
      });
    }
  }

  return { geometry: mb.build(), colliders, coins, specials, ramp };
}

function upQuad(mb, a, b, c, d, col) {
  // Ensure the face points upwards.
  const ux = b[0] - a[0], uz = b[2] - a[2];
  const vx = d[0] - a[0], vz = d[2] - a[2];
  const ny = uz * vx - ux * vz;
  if (ny >= 0) mb.quad(a, b, c, d, col);
  else mb.quad(d, c, b, a, col);
}

function splitLot(lot, r) {
  const { x0, x1, z0, z1 } = lot;
  if (r() < 0.5) {
    const m = x0 + (x1 - x0) * r.range(0.4, 0.6);
    return [[x0, z0, m, z1], [m, z0, x1, z1]];
  }
  const m = z0 + (z1 - z0) * r.range(0.4, 0.6);
  return [[x0, z0, x1, m], [x0, m, x1, z1]];
}

export function addTree(mb, x, y, z, kind, r, lod) {
  const tint = r.range(0.88, 1.1);
  if (kind === 'pine') {
    const h = r.range(0.9, 1.3);
    mb.cbox(x, y + 1.0 * h, z, 0.7, 2 * h, 0.7, lin(C.trunk));
    if (lod === 2) {
      mb.cbox(x, y + 4 * h, z, 3.2, 5 * h, 3.2, lin(C.pine, tint));
      return;
    }
    const c = lin(C.pine, tint);
    mb.cbox(x, y + 2.6 * h, z, 3.8, 1.6 * h, 3.8, c);
    mb.cbox(x, y + 4.2 * h, z, 2.8, 1.6 * h, 2.8, c);
    mb.cbox(x, y + 5.8 * h, z, 1.8, 1.6 * h, 1.8, c);
    mb.cbox(x, y + 7.0 * h, z, 0.8, 1.0 * h, 0.8, c);
  } else {
    const h = r.range(0.85, 1.25);
    mb.cbox(x, y + 1.4 * h, z, 0.8, 2.8 * h, 0.8, lin(C.trunk));
    const c = lin(r() < 0.5 ? C.oak : C.oak2, tint);
    mb.cbox(x, y + 4.2 * h, z, 4.2 * h, 3.2 * h, 4.2 * h, c);
    if (lod === 0) {
      mb.cbox(x + 1.2 * h, y + 5.6 * h, z - 0.6 * h, 2.4 * h, 1.8 * h, 2.4 * h, c);
      mb.cbox(x - 1.0 * h, y + 3.4 * h, z + 1.2 * h, 2.2 * h, 1.6 * h, 2.2 * h, c);
    }
  }
}

function scatterTrees(world, mb, lot, r, count, lod, colliders, ramp, kind) {
  const placed = [];
  for (let k = 0; k < count * 3 && placed.length < count; k++) {
    const x = r.range(lot.x0 + 1.5, lot.x1 - 1.5);
    const z = r.range(lot.z0 + 1.5, lot.z1 - 1.5);
    if (placed.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 20)) continue;
    if (ramp && Math.abs(x - ramp.cx) < ramp.len + 10 && Math.abs(z - ramp.cz) < ramp.len + 10) continue;
    if (world.roadClearance(x, z) < 2.5) continue;
    placed.push([x, z]);
    const k2 = kind || (r() < 0.65 ? 'pine' : 'oak');
    addTree(mb, x, world.terrainHeight(x, z), z, k2, r, lod);
    colliders.push({ type: 'circle', x, z, r: 0.6 });
  }
}

function addCoinCluster(world, lot, r, coins, idBase, colliders) {
  const cx = r.range(lot.x0 + 5, lot.x1 - 5);
  const cz = r.range(lot.z0 + 5, lot.z1 - 5);
  if (colliders.some((c) => c.type === 'circle' && Math.hypot(c.x - cx, c.z - cz) < 4)) return;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const x = cx + Math.cos(a) * 2.5;
    const z = cz + Math.sin(a) * 2.5;
    coins.push({ id: `${idBase}${k}`, x, y: world.terrainHeight(x, z) + 1.1, z });
  }
}

function addHouse(mb, cx, cz, w, d, baseAt, r, colliders, lod) {
  const xa = cx - w / 2, xb = cx + w / 2, za = cz - d / 2, zb = cz + d / 2;
  const y0 = baseAt(xa, za, xb, zb);
  const wallH = r.range(3.4, 4.2) + 0.6;
  const wall = lin(r.pick(HOUSE_COLORS));
  const roof = lin(r.pick(ROOF_COLORS));
  mb.box(xa, y0, za, xb, y0 + wallH, zb, wall);
  // stepped voxel roof along the longer side
  const alongX = w >= d;
  const steps = 4;
  for (let k = 0; k < steps; k++) {
    const shrink = (k / steps) * ((alongX ? d : w) / 2);
    const y = y0 + wallH + k * 0.7;
    if (alongX) mb.box(xa - 0.4, y, za - 0.4 + shrink, xb + 0.4, y + 0.7, zb + 0.4 - shrink, roof);
    else mb.box(xa - 0.4 + shrink, y, za - 0.4, xb + 0.4 - shrink, y + 0.7, zb + 0.4, roof);
  }
  if (lod === 0) {
    const win = lin(0x4d6d8a);
    const doorC = lin(0x6b4a2f);
    mb.box(cx - 0.6, y0 + 0.6, zb, cx + 0.6, y0 + 2.8, zb + 0.08, doorC);
    mb.box(cx - 0.6, y0 + 0.6, za - 0.08, cx + 0.6, y0 + 2.8, za, doorC);
    for (const ox of [-w / 3, w / 3]) {
      mb.box(cx + ox - 0.6, y0 + 1.9, zb, cx + ox + 0.6, y0 + 3.0, zb + 0.08, win);
      mb.box(cx + ox - 0.6, y0 + 1.9, za - 0.08, cx + ox + 0.6, y0 + 3.0, za, win);
    }
    // chimney
    mb.cbox(xa + w * 0.25, y0 + wallH + 2.4, cz, 0.8, 2, 0.8, lin(0x8a5a4a));
  }
  colliders.push({ type: 'box', x0: xa - 0.3, z0: za - 0.3, x1: xb + 0.3, z1: zb + 0.3, top: y0 + wallH + 2.8 });
}

function addBarn(mb, cx, cz, baseAt, r, colliders) {
  const w = 10, d = 8;
  const xa = cx - w / 2, xb = cx + w / 2, za = cz - d / 2, zb = cz + d / 2;
  const y0 = baseAt(xa, za, xb, zb);
  mb.box(xa, y0, za, xb, y0 + 5.6, zb, lin(0xa33b2c));
  for (let k = 0; k < 4; k++) {
    const sh = k * 1.0;
    mb.box(xa - 0.3, y0 + 5.6 + k * 0.8, za - 0.3 + sh, xb + 0.3, y0 + 6.4 + k * 0.8, zb + 0.3 - sh, lin(0x5b4a42));
  }
  mb.box(cx - 1.8, y0 + 0.6, zb, cx + 1.8, y0 + 4.4, zb + 0.1, lin(0xf0ece0));
  // silo
  mb.cbox(xb + 2.4, y0 + 4.5, cz, 3, 9, 3, lin(0xc8ccd0));
  mb.cbox(xb + 2.4, y0 + 9.4, cz, 2.2, 0.8, 2.2, lin(0x8e949a));
  colliders.push({ type: 'box', x0: xa - 0.3, z0: za - 0.3, x1: xb + 0.3, z1: zb + 0.3, top: y0 + 9 });
  colliders.push({ type: 'circle', x: xb + 2.4, z: cz, r: 2.1 });
}

function addRamp(mb, r) {
  // Build a wedge in ramp-local coordinates then map to world.
  const L = r.len / 2;
  const Wd = r.wid / 2;
  const toW = (lx, y, lz) => (r.alongX ? [r.cx + lx * r.dir, r.y + y, r.cz + lz] : [r.cx + lz, r.y + y, r.cz + lx * r.dir]);
  const seg = 6;
  for (let k = 0; k < seg; k++) {
    const t0 = k / seg, t1 = (k + 1) / seg;
    const la = -L + t0 * 2 * L, lb = -L + t1 * 2 * L;
    const c = lin(k % 2 === 0 ? C.ramp : C.rampStripe);
    upQuad(mb, toW(la, t0 * r.height, -Wd), toW(lb, t1 * r.height, -Wd), toW(lb, t1 * r.height, Wd), toW(la, t0 * r.height, Wd), c);
  }
  const side = lin(0x9a6a44);
  // back wall
  const p0 = toW(L, 0, -Wd), p1 = toW(L, 0, Wd), p2 = toW(L, r.height, Wd), p3 = toW(L, r.height, -Wd);
  faceOut(mb, p0, p1, p2, p3, side, toW(0, r.height / 2, 0));
  // side triangles
  for (const sgn of [-1, 1]) {
    const a = toW(-L, 0, sgn * Wd), b = toW(L, 0, sgn * Wd), c = toW(L, r.height, sgn * Wd);
    const centre = toW(0, r.height / 3, 0);
    triOut(mb, a, b, c, side, centre);
  }
}

function faceOut(mb, a, b, c, d, col, centre) {
  const n = normalOf(a, b, d);
  const out = [a[0] - centre[0], a[1] - centre[1], a[2] - centre[2]];
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) mb.quad(a, b, c, d, col);
  else mb.quad(d, c, b, a, col);
}

function triOut(mb, a, b, c, col, centre) {
  const n = normalOf(a, b, c);
  const out = [a[0] - centre[0], a[1] - centre[1], a[2] - centre[2]];
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) mb.tri(a, b, c, col);
  else mb.tri(c, b, a, col);
}

function normalOf(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

const SPECIAL_STYLE = {
  dealer: { wall: 0x8fc3e6, roof: 0xf4f4f4, accent: 0x2b7de9, h: 6.5 },
  tuning: { wall: 0x6f7680, roof: 0x4a4f57, accent: 0xff8a1f, h: 7.5 },
  paint: { wall: 0xf4f1ea, roof: 0xd8d4cc, accent: 0xe83e8c, h: 6.5 },
  depot: { wall: 0xa0522d, roof: 0x6b6b6b, accent: 0xf2c230, h: 8 },
};

function addSpecial(mb, sp, baseAt, colliders, lod) {
  const st = SPECIAL_STYLE[sp.type];
  const half = 6.5;
  const xa = sp.bx - half, xb = sp.bx + half, za = sp.bz - half, zb = sp.bz + half;
  const y0 = baseAt(xa, za, xb, zb);
  mb.box(xa, y0, za, xb, y0 + st.h, zb, lin(st.wall), { top: lin(st.roof) });
  mb.box(xa - 0.5, y0 + st.h, za - 0.5, xb + 0.5, y0 + st.h + 0.6, zb + 0.5, lin(st.roof));
  // accent band
  mb.box(xa - 0.05, y0 + st.h - 1.6, za - 0.05, xb + 0.05, y0 + st.h - 0.8, zb + 0.05, lin(st.accent), { shade: 1 });
  if (sp.type === 'paint' && lod === 0) {
    const cols = [0xe74c3c, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6];
    cols.forEach((c, k) => mb.box(xa - 0.06, y0 + 0.8 + k * 0.6, za - 0.06, xb + 0.06, y0 + 1.3 + k * 0.6, zb + 0.06, lin(c), { shade: 1 }));
  }
  if (sp.type === 'depot' && lod === 0) {
    // stacked shipping containers on the roof edge
    const cc = [0x2e86c1, 0xc0392b, 0x27ae60];
    for (let k = 0; k < 3; k++) mb.cbox(sp.bx + (k - 1) * 3.2, y0 + st.h + 1.9, sp.bz + sp.sz * 3, 2.6, 2.6, 6, lin(cc[k]));
  }
  // big door facing the zone (diagonal corner): two doors on the faces toward the node
  const doorC = lin(0x30343a);
  const fx = sp.sx > 0 ? xa - 0.06 : xb + 0.06;
  const fz = sp.sz > 0 ? za - 0.06 : zb + 0.06;
  mb.box(Math.min(fx, sp.sx > 0 ? xa : xb), y0 + 0.6, sp.bz - 2.5, Math.max(fx, sp.sx > 0 ? xa : xb), y0 + 4.6, sp.bz + 2.5, doorC);
  mb.box(sp.bx - 2.5, y0 + 0.6, Math.min(fz, sp.sz > 0 ? za : zb), sp.bx + 2.5, y0 + 4.6, Math.max(fz, sp.sz > 0 ? za : zb), doorC);
  colliders.push({ type: 'box', x0: xa, z0: za, x1: xb, z1: zb, top: y0 + st.h });
}
