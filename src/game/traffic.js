// AI traffic driving along the road grid with lanes, turns at intersections and simple
// car-following. Also detects player collisions and near misses.

import * as THREE from 'three';
import { CELL, ROAD_MAIN, ROAD_STREET, ROAD_WIDTH } from '../world/worldgen.js';
import { CARS, buildCarModel, PAINTS } from '../vehicle/cars.js';
import { carCircles } from '../vehicle/collision.js';

const DIRS = { e: [1, 0], w: [-1, 0], n: [0, 1], s: [0, -1] };
const OPP = { e: 'w', w: 'e', n: 's', s: 'n' };
const TRAFFIC_MODELS = ['hatch', 'van', 'pickup', 'muscle', 'coupe', 'hatch'];
const TURN = 8; // metres before/after a node where cars follow a turn curve

function segClass(world, i, j, d) {
  if (d === 'e') return world.segH(i, j);
  if (d === 'w') return world.segH(i - 1, j);
  if (d === 'n') return world.segV(i, j);
  return world.segV(i, j - 1);
}

export class Traffic {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.cars = [];
    this.maxCars = 12;
    this.models = CARS.filter((c) => TRAFFIC_MODELS.includes(c.id));
    this.spawnTimer = 0;
    this._tmp = new THREE.Vector3();
    this._circles = [];
    this._pc = [];
  }

  setMax(n) {
    this.maxCars = n;
  }

  clear() {
    for (const c of this.cars) this._dispose(c);
    this.cars = [];
  }

  _dispose(c) {
    this.scene.remove(c.model.group);
    c.model.dispose();
  }

  _spawn(px, pz, rand = Math.random) {
    // Random node in a ring around the player
    for (let tries = 0; tries < 12; tries++) {
      const ang = rand() * Math.PI * 2;
      const dist = 110 + rand() * 120;
      const i = Math.round((px + Math.cos(ang) * dist) / CELL);
      const j = Math.round((pz + Math.sin(ang) * dist) / CELL);
      const dirs = Object.keys(DIRS).filter((d) => segClass(this.world, i, j, d));
      if (!dirs.length) continue;
      const d = dirs[Math.floor(rand() * dirs.length)];
      const cls = segClass(this.world, i, j, d);
      // don't stack cars
      if (this.cars.some((c) => c.i === i && c.j === j && c.dir === d)) continue;
      const def = this.models[Math.floor(rand() * this.models.length)];
      const model = buildCarModel(def, { paint: PAINTS[Math.floor(rand() * PAINTS.length)] }, { noShadow: true });
      this.scene.add(model.group);
      const car = {
        def,
        model,
        i,
        j,
        dir: d,
        cls,
        u: TURN + rand() * 30,
        speed: 8,
        target: 12,
        next: null,
        turn: null,
        stopped: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        heading: 0,
        nearMiss: false,
        hitCooldown: 0,
        minDist: Infinity,
        bump: new THREE.Vector3(),
      };
      car.next = this._chooseNext(car);
      this._place(car, 0);
      this.cars.push(car);
      return car;
    }
    return null;
  }

  _chooseNext(car) {
    const [dx, dz] = DIRS[car.dir];
    const ni = car.i + dx;
    const nj = car.j + dz;
    const opts = Object.keys(DIRS).filter((d) => d !== OPP[car.dir] && segClass(this.world, ni, nj, d));
    if (!opts.length) return OPP[car.dir];
    // prefer straight on
    if (opts.includes(car.dir) && Math.random() < 0.55) return car.dir;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  _laneOffset(dir, cls) {
    const [dx, dz] = DIRS[dir];
    const w = ROAD_WIDTH[cls] || 8;
    const off = cls === ROAD_MAIN ? w / 4 + 0.2 : w / 4;
    // right-hand traffic: right = (-dz, dx) for forward (dx, dz) with +x being left
    return [-dz * off, dx * off];
  }

  /** Computes position & heading for car at its current state. */
  _place(car) {
    const [dx, dz] = DIRS[car.dir];
    const [lx, lz] = this._laneOffset(car.dir, car.cls);
    let x, z, hx, hz;
    if (car.turn) {
      const t = car.turn;
      const s = t.s;
      const a = 1 - s;
      x = a * a * t.p0[0] + 2 * a * s * t.c[0] + s * s * t.p2[0];
      z = a * a * t.p0[1] + 2 * a * s * t.c[1] + s * s * t.p2[1];
      hx = 2 * a * (t.c[0] - t.p0[0]) + 2 * s * (t.p2[0] - t.c[0]);
      hz = 2 * a * (t.c[1] - t.p0[1]) + 2 * s * (t.p2[1] - t.c[1]);
    } else {
      x = car.i * CELL + dx * car.u + lx;
      z = car.j * CELL + dz * car.u + lz;
      hx = dx;
      hz = dz;
    }
    x += car.bump.x;
    z += car.bump.z;
    const heading = Math.atan2(hx, hz);
    const w = this.world;
    const y = w.terrainHeight(x, z);
    const fx = Math.sin(heading) * 1.4;
    const fz = Math.cos(heading) * 1.4;
    const yf = w.terrainHeight(x + fx, z + fz);
    const yb = w.terrainHeight(x - fx, z - fz);
    const pitch = Math.atan2(yb - yf, 2.8);
    const prev = car.pos.clone();
    car.pos.set(x, y, z);
    car.heading = heading;
    const g = car.model.group;
    const r = car.model.wheelRadius;
    g.position.set(x, y + 0.5 + r + 0.05, z);
    g.rotation.set(pitch, heading, 0, 'YXZ');
    return prev;
  }

  update(dt, player, playerVel, events) {
    const px = player.pos.x;
    const pz = player.pos.z;
    // spawn / despawn
    this.spawnTimer -= dt;
    if (this.cars.length < this.maxCars && this.spawnTimer <= 0) {
      this._spawn(px, pz);
      this.spawnTimer = 0.25;
    }
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      if (Math.hypot(c.pos.x - px, c.pos.z - pz) > 300 || this.cars.length > this.maxCars) {
        this._dispose(c);
        this.cars.splice(k, 1);
      }
    }

    for (const c of this.cars) {
      // Desired speed
      c.target = c.cls === ROAD_MAIN ? 19 : c.cls === ROAD_STREET ? 13 : 10;
      if (c.turn && c.turn.turning) c.target = 7;
      else if (!c.turn && c.u > CELL - TURN - 14 && c.next !== c.dir) c.target = Math.min(c.target, 9);
      // Car following (other traffic and the player)
      const hx = Math.sin(c.heading);
      const hz = Math.cos(c.heading);
      let limit = Infinity;
      const check = (ox, oz, ospeed) => {
        const rx = ox - c.pos.x;
        const rz = oz - c.pos.z;
        const ahead = rx * hx + rz * hz;
        const lat = Math.abs(rx * hz - rz * hx);
        if (ahead > 0 && ahead < 22 && lat < 2.4) {
          limit = Math.min(limit, Math.max(0, (ahead - 6.5) * 0.9), ahead < 9 ? 0 : Infinity);
          if (ospeed != null) limit = Math.min(limit, Math.max(ospeed, 0) + (ahead - 7) * 0.6);
        }
      };
      for (const o of this.cars) if (o !== c) check(o.pos.x, o.pos.z, o.speed * ((Math.sin(o.heading) * hx + Math.cos(o.heading) * hz) > 0.5 ? 1 : 0));
      check(px, pz, null);
      if (c.stopped > 0) {
        c.stopped -= dt;
        limit = 0;
      }
      const tgt = Math.min(c.target, limit);
      const acc = tgt > c.speed ? 4 : 9;
      c.speed += Math.max(-acc * dt, Math.min(acc * dt, tgt - c.speed));
      c.speed = Math.max(0, c.speed);
      c.bump.multiplyScalar(Math.max(0, 1 - dt * 0.8));

      // Advance
      let dist = c.speed * dt;
      if (c.turn) {
        c.turn.s += dist / c.turn.len;
        if (c.turn.s >= 1) {
          // finished turn: now on the next segment
          const over = (c.turn.s - 1) * c.turn.len;
          c.turn = null;
          c.u = TURN + over;
        }
      } else {
        c.u += dist;
        if (c.u >= CELL - TURN) {
          this._beginTurn(c);
        }
      }
      const prev = this._place(c);
      c.vel.set((c.pos.x - prev.x) / dt, 0, (c.pos.z - prev.z) / dt);
      c.hitCooldown = Math.max(0, c.hitCooldown - dt);
      for (const wh of c.model.wheels) wh.spin.rotation.x += (c.speed / c.model.wheelRadius) * dt;

      // Player interaction
      const dx = c.pos.x - px;
      const dz = c.pos.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < 7) {
        const hit = this._collidePlayer(c, player, events);
        if (hit) c.nearMiss = false;
      }
      // Near miss detection
      const rel = Math.hypot(playerVel.x - c.vel.x, playerVel.z - c.vel.z);
      if (d < 4.6 && rel > 11 && c.hitCooldown <= 0) {
        c.nearMiss = true;
      }
      if (c.nearMiss && d > 9) {
        c.nearMiss = false;
        if (c.hitCooldown <= 0) events.push({ type: 'nearmiss' });
      }
    }
  }

  _beginTurn(c) {
    const [dx, dz] = DIRS[c.dir];
    const ni = c.i + dx;
    const nj = c.j + dz;
    const nd = c.next || this._chooseNext(c);
    const ncls = segClass(this.world, ni, nj, nd);
    if (!ncls) {
      // road ended (shouldn't happen) - turn around
      c.dir = OPP[c.dir];
      c.i = ni;
      c.j = nj;
      c.u = CELL - c.u;
      c.next = this._chooseNext(c);
      return;
    }
    const [lx0, lz0] = this._laneOffset(c.dir, c.cls);
    const [ndx, ndz] = DIRS[nd];
    const [lx1, lz1] = this._laneOffset(nd, ncls);
    const nx = ni * CELL;
    const nz = nj * CELL;
    const p0 = [nx - dx * TURN + lx0, nz - dz * TURN + lz0];
    const p2 = [nx + ndx * TURN + lx1, nz + ndz * TURN + lz1];
    let cpt;
    if (nd === c.dir) cpt = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    else if (nd === OPP[c.dir]) cpt = [nx + dx * 4, nz + dz * 4];
    else {
      // intersection of the incoming and outgoing lane lines
      cpt = [dx !== 0 ? nx + lx1 : nx + lx0, dz !== 0 ? nz + lz1 : nz + lz0];
    }
    const len = Math.hypot(cpt[0] - p0[0], cpt[1] - p0[1]) + Math.hypot(p2[0] - cpt[0], p2[1] - cpt[1]);
    c.turn = { p0, c: cpt, p2, s: (c.u - (CELL - TURN)) / len, len: len * 0.92, turning: nd !== c.dir };
    c.i = ni;
    c.j = nj;
    c.dir = nd;
    c.cls = ncls;
    c.next = this._chooseNext(c);
  }

  _collidePlayer(c, player, events) {
    carCircles(player, this._pc);
    const hx = Math.sin(c.heading);
    const hz = Math.cos(c.heading);
    const tc = [-1.2, 0, 1.2].map((k) => ({ x: c.pos.x + hx * k, z: c.pos.z + hz * k, r: 0.95 }));
    let hit = false;
    for (const a of this._pc) {
      for (const b of tc) {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d = Math.hypot(dx, dz);
        const pen = a.r + b.r - d;
        if (pen <= 0 || d < 1e-4) continue;
        if (Math.abs(player.pos.y - c.pos.y) > 3) continue;
        const nx = dx / d;
        const nz = dz / d;
        const imp = player.resolveHorizontal(nx, nz, pen * 0.7, b.x + nx * b.r, player.pos.y, b.z + nz * b.r, 0.35, c.vel);
        c.bump.x -= nx * pen * 0.3;
        c.bump.z -= nz * pen * 0.3;
        a.x += nx * pen * 0.7;
        a.z += nz * pen * 0.7;
        if (imp > 0.5) {
          hit = true;
          c.stopped = 2.5;
          c.speed *= 0.3;
          if (c.hitCooldown <= 0) events.push({ type: 'traffichit', speed: imp });
          c.hitCooldown = 3;
        }
      }
    }
    return hit;
  }

  /** Positions for the minimap. */
  positions() {
    return this.cars.map((c) => c.pos);
  }
}
