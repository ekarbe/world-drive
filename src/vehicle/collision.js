// Car vs static world collisions in the horizontal plane.
// The car is approximated by three circles along its length.

import * as THREE from 'three';
import { rampSurface } from '../world/worldgen.js';

const _f = new THREE.Vector3();

/** World-space circle centres approximating the car body. */
export function carCircles(vehicle, out = []) {
  const [w, , l] = vehicle.spec.size;
  vehicle.forward(_f);
  const r = w / 2;
  const off = l / 2 - r;
  out.length = 0;
  for (const k of [-1, 0, 1]) {
    out.push({ x: vehicle.pos.x + _f.x * off * k, z: vehicle.pos.z + _f.z * off * k, r });
  }
  return out;
}

const circles = [];

/** Resolves collisions; returns the strongest impact speed (m/s). */
export function collideStatic(vehicle, colliders) {
  carCircles(vehicle, circles);
  const bottom = vehicle.pos.y - 0.4;
  let impact = 0;
  for (const c of circles) {
    for (const col of colliders) {
      let nx = 0;
      let nz = 0;
      let depth = 0;
      if (col.type === 'circle') {
        const dx = c.x - col.x;
        const dz = c.z - col.z;
        const d = Math.hypot(dx, dz);
        const pen = c.r + col.r - d;
        if (pen <= 0) continue;
        nx = d > 1e-4 ? dx / d : 1;
        nz = d > 1e-4 ? dz / d : 0;
        depth = pen;
      } else if (col.type === 'box' || col.type === 'ramp') {
        let x0, x1, z0, z1;
        if (col.type === 'ramp') {
          const r = col.ramp;
          const hx = r.alongX ? r.len / 2 : r.wid / 2;
          const hz = r.alongX ? r.wid / 2 : r.len / 2;
          x0 = r.cx - hx; x1 = r.cx + hx; z0 = r.cz - hz; z1 = r.cz + hz;
          // Only a wall where the ramp surface is well above the car's bottom.
          const surf = rampSurface(r, Math.min(Math.max(c.x, x0), x1), Math.min(Math.max(c.z, z0), z1));
          if (r.y + surf < bottom + 0.7) continue;
        } else {
          if (col.top < bottom) continue;
          x0 = col.x0; x1 = col.x1; z0 = col.z0; z1 = col.z1;
        }
        const px = Math.min(Math.max(c.x, x0), x1);
        const pz = Math.min(Math.max(c.z, z0), z1);
        const dx = c.x - px;
        const dz = c.z - pz;
        const d = Math.hypot(dx, dz);
        if (d >= c.r) continue;
        if (d > 1e-4) {
          nx = dx / d;
          nz = dz / d;
          depth = c.r - d;
        } else {
          // centre inside the box: push out along the shallowest axis
          const ex = [c.x - x0, x1 - c.x, c.z - z0, z1 - c.z];
          const m = Math.min(...ex);
          const k = ex.indexOf(m);
          nx = k === 0 ? -1 : k === 1 ? 1 : 0;
          nz = k === 2 ? -1 : k === 3 ? 1 : 0;
          depth = m + c.r;
        }
      } else continue;
      const imp = vehicle.resolveHorizontal(nx, nz, depth, c.x - nx * c.r, vehicle.pos.y, c.z - nz * c.r, 0.2);
      c.x += nx * depth;
      c.z += nz * depth;
      impact = Math.max(impact, imp);
    }
  }
  return impact;
}
