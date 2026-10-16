// Spinning coin pickups rendered with one InstancedMesh.

import * as THREE from 'three';

const MAX = 4000;

export class Coins {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.16, 8);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x6b4a00 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.active = new Map(); // id -> coin
    this.collected = new Set();
    this.dummy = new THREE.Object3D();
    this.time = 0;
    this.sparks = [];
    const sg = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.sparkMesh = new THREE.InstancedMesh(sg, this.sparkMat, 200);
    this.sparkMesh.count = 0;
    this.sparkMesh.frustumCulled = false;
    scene.add(this.sparkMesh);
  }

  addChunk(chunk) {
    for (const c of chunk.coins) {
      if (this.collected.has(c.id)) continue;
      this.active.set(c.id, c);
    }
  }

  removeChunk(chunk) {
    for (const c of chunk.coins) this.active.delete(c.id);
  }

  /** Collect coins near pos; returns number collected this frame. */
  update(dt, pos, radius = 2.4) {
    this.time += dt;
    let got = 0;
    let n = 0;
    const d = this.dummy;
    const r2 = radius * radius;
    for (const [id, c] of this.active) {
      const dx = c.x - pos.x;
      const dy = c.y - pos.y;
      const dz = c.z - pos.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < r2 && Math.abs(dy) < 2.6) {
        this.active.delete(id);
        this.collected.add(id);
        got++;
        this._burst(c);
        continue;
      }
      if (dist2 > 300 * 300 || n >= MAX) continue;
      d.position.set(c.x, c.y + Math.sin(this.time * 2 + c.x * 0.3) * 0.15, c.z);
      d.rotation.set(0, this.time * 2.5 + c.z * 0.1, 0);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Keep the collected set bounded (coins respawn after a long while).
    if (this.collected.size > 6000) {
      const it = this.collected.values();
      for (let k = 0; k < 2000; k++) this.collected.delete(it.next().value);
    }
    this._updateSparks(dt);
    return got;
  }

  _burst(c) {
    for (let k = 0; k < 8; k++) {
      if (this.sparks.length >= 200) this.sparks.shift();
      const a = (k / 8) * Math.PI * 2;
      this.sparks.push({ x: c.x, y: c.y, z: c.z, vx: Math.cos(a) * 4, vy: 3 + Math.random() * 3, vz: Math.sin(a) * 4, life: 0.6 });
    }
  }

  _updateSparks(dt) {
    const d = this.dummy;
    let n = 0;
    this.sparks = this.sparks.filter((s) => (s.life -= dt) > 0);
    for (const s of this.sparks) {
      s.vy -= 12 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      d.position.set(s.x, s.y, s.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(s.life / 0.6);
      d.updateMatrix();
      this.sparkMesh.setMatrixAt(n++, d.matrix);
    }
    d.scale.setScalar(1);
    this.sparkMesh.count = n;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.active.clear();
    this.collected.clear();
  }
}
