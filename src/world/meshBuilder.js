// Collects quads/boxes into flat arrays and turns them into a single BufferGeometry.
// Colours are given as sRGB hex and converted to linear for vertex colours.
// UVs are only meaningful for building facades (window texture); everything else samples
// a transparent texel at uv (0.01, 0.01) so the vertex colour shows through.

import * as THREE from 'three';

const tmpColor = new THREE.Color();
const colorCache = new Map();

/** Linear-space RGB triplet for an sRGB hex colour, optionally multiplied. */
export function lin(hex, mul = 1) {
  let c = colorCache.get(hex);
  if (!c) {
    tmpColor.setHex(hex);
    c = [tmpColor.r, tmpColor.g, tmpColor.b];
    colorCache.set(hex, c);
  }
  if (mul === 1) return c;
  return [c[0] * mul, c[1] * mul, c[2] * mul];
}

const NOUV = 0.01;

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this.vcount = 0;
  }

  get empty() {
    return this.vcount === 0;
  }

  /**
   * Adds a quad from 4 corner points (counter-clockwise when viewed from the front).
   * c: linear rgb triplet. uvs: optional [u0,v0,u1,v1,u2,v2,u3,v3].
   */
  quad(p0, p1, p2, p3, c, uvs = null, normal = null) {
    let nx, ny, nz;
    if (normal) {
      [nx, ny, nz] = normal;
    } else {
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
      nx = ay * bz - az * by;
      ny = az * bx - ax * bz;
      nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }
    const v = this.vcount;
    const pts = [p0, p1, p2, p3];
    for (let k = 0; k < 4; k++) {
      const p = pts[k];
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(c[0], c[1], c[2]);
      if (uvs) this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
      else this.uv.push(NOUV, NOUV);
    }
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.vcount += 4;
  }

  tri(p0, p1, p2, c) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const v = this.vcount;
    for (const p of [p0, p1, p2]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(c[0], c[1], c[2]);
      this.uv.push(NOUV, NOUV);
    }
    this.idx.push(v, v + 1, v + 2);
    this.vcount += 3;
  }

  /**
   * Axis aligned box. opts:
   *  - bottom: include bottom face (default false)
   *  - top: colour for the top face (defaults to c)
   *  - shade: multiply side faces (default 0.92) for a subtle voxel look
   *  - windows: {sx, sy} metres per window tile -> facade UVs on the four sides
   */
  box(x0, y0, z0, x1, y1, z1, c, opts = {}) {
    const top = opts.top || c;
    const shade = opts.shade ?? 0.92;
    const side = shade === 1 ? c : [c[0] * shade, c[1] * shade, c[2] * shade];
    const w = opts.windows;
    const fuv = (len) => {
      if (!w) return null;
      const u = len / w.sx;
      const v = (y1 - y0 - (w.base || 0)) / w.sy;
      const v0 = -(w.base || 0) / w.sy;
      return [0, v0, u, v0, u, v, 0, v];
    };
    // top
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, null, [0, 1, 0]);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side, null, [0, -1, 0]);
    // +z
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side, fuv(x1 - x0), [0, 0, 1]);
    // -z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side, fuv(x1 - x0), [0, 0, -1]);
    // +x
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side, fuv(z1 - z0), [1, 0, 0]);
    // -x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side, fuv(z1 - z0), [-1, 0, 0]);
  }

  /** Box given by centre and size. */
  cbox(cx, cy, cz, sx, sy, sz, c, opts) {
    this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, c, opts);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const IndexArray = this.vcount > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArray(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
