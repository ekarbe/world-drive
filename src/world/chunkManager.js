// Streams chunks in and out around the player, with distance based level of detail.

import * as THREE from 'three';
import { buildChunk } from './chunk.js';
import { CELL } from './worldgen.js';
import { getWorldMaterial } from '../render/materials.js';

export class ChunkManager {
  constructor(world, scene, hooks = {}) {
    this.world = world;
    this.scene = scene;
    this.hooks = hooks; // onLoad(chunk), onUnload(chunk)
    this.chunks = new Map();
    this.radius = 5;
    this.lod0 = 2;
    this.lod1 = 4;
    this.shadows = true;
    this.material = getWorldMaterial();
    this.budgetMs = 7;
  }

  key(i, j) {
    return `${i},${j}`;
  }

  setQuality({ radius, lod0, lod1, shadows }) {
    this.radius = radius;
    this.lod0 = lod0;
    this.lod1 = lod1;
    this.shadows = shadows;
    for (const c of this.chunks.values()) {
      c.mesh.receiveShadow = shadows;
      c.mesh.castShadow = shadows && c.lod === 0;
    }
  }

  lodFor(d) {
    return d <= this.lod0 ? 0 : d <= this.lod1 ? 1 : 2;
  }

  /** Synchronously builds everything near (x, z); used on spawn. */
  warmup(x, z) {
    this.update(x, z, 1e9, 2);
  }

  update(x, z, budgetMs = this.budgetMs, maxRadius = this.radius) {
    const ci = Math.round(x / CELL);
    const cj = Math.round(z / CELL);
    const R = Math.min(this.radius, maxRadius);
    const wanted = [];
    for (let a = -R; a <= R; a++) {
      for (let b = -R; b <= R; b++) {
        const d = Math.max(Math.abs(a), Math.abs(b));
        if (a * a + b * b > (R + 0.5) * (R + 0.5)) continue;
        const i = ci + a;
        const j = cj + b;
        const lod = this.lodFor(d);
        const c = this.chunks.get(this.key(i, j));
        if (!c || c.lod !== lod) wanted.push({ i, j, lod, d: a * a + b * b, existing: c });
      }
    }
    // Unload far chunks
    for (const [k, c] of this.chunks) {
      if (Math.max(Math.abs(c.i - ci), Math.abs(c.j - cj)) > R + 1) {
        this._remove(k, c);
      }
    }
    wanted.sort((p, q) => p.d - q.d);
    const t0 = performance.now();
    let built = 0;
    for (const w of wanted) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      // Upgrading LOD of distant chunks is less urgent than missing chunks.
      if (w.existing && w.lod > 0 && built > 0) continue;
      this._build(w.i, w.j, w.lod, w.existing);
      built++;
    }
    return wanted.length - built;
  }

  _build(i, j, lod, existing) {
    const data = buildChunk(this.world, i, j, lod);
    const mesh = new THREE.Mesh(data.geometry, this.material);
    mesh.receiveShadow = this.shadows;
    mesh.castShadow = this.shadows && lod === 0;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    const k = this.key(i, j);
    if (existing) {
      // swap mesh, keep gameplay data (coins, markers) of the existing chunk
      this.scene.remove(existing.mesh);
      existing.mesh.geometry.dispose();
      existing.mesh = mesh;
      existing.lod = lod;
      if (lod === 0) existing.colliders = data.colliders;
      return;
    }
    const chunk = { i, j, lod, mesh, colliders: data.colliders, coins: data.coins, specials: data.specials, ramp: data.ramp };
    this.chunks.set(k, chunk);
    this.hooks.onLoad?.(chunk);
  }

  _remove(k, c) {
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    this.chunks.delete(k);
    this.hooks.onUnload?.(c);
  }

  /** Static colliders around a point (3x3 chunks). */
  collidersNear(x, z, out = []) {
    out.length = 0;
    const ci = Math.round(x / CELL);
    const cj = Math.round(z / CELL);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const c = this.chunks.get(this.key(ci + a, cj + b));
        if (!c) continue;
        for (const col of c.colliders) out.push(col);
        if (c.ramp) out.push({ type: 'ramp', ramp: c.ramp });
      }
    }
    return out;
  }

  clear() {
    for (const [k, c] of [...this.chunks]) this._remove(k, c);
  }
}
