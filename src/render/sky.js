// Gradient sky dome, sun and drifting voxel clouds that follow the player.

import * as THREE from 'three';
import { MeshBuilder, lin } from '../world/meshBuilder.js';
import { mulberry32 } from '../core/rng.js';

export const SKY_TOP = 0x3d8fe0;
export const SKY_HORIZON = 0xcde6f5;

export class Sky {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(1, 24, 12);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
        sunDir: { value: new THREE.Vector3(0.4, 0.75, 0.3).normalize() },
      },
      vertexShader: `varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.9999, p.w);
        }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.9, 0.7) * (pow(s, 400.0) * 1.5 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.scale.setScalar(1000);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // Clouds
    const mb = new MeshBuilder();
    const r = mulberry32(42);
    this.cloudSpan = 1400;
    for (let k = 0; k < 26; k++) {
      const cx = r.range(-0.5, 0.5) * this.cloudSpan;
      const cz = r.range(-0.5, 0.5) * this.cloudSpan;
      const cy = r.range(110, 150);
      const parts = r.int(3, 6);
      for (let p = 0; p < parts; p++) {
        const sx = r.range(14, 34);
        const sz = r.range(10, 24);
        const sy = r.range(5, 9);
        mb.cbox(cx + r.range(-18, 18), cy + r.range(-2, 3), cz + r.range(-12, 12), sx, sy, sz, lin(0xffffff), { bottom: true, shade: 0.94 });
      }
    }
    this.clouds = new THREE.Mesh(
      mb.build(),
      new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x9aa7b3, transparent: true, opacity: 0.92, fog: false }),
    );
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
    this.offset = 0;
  }

  update(dt, camPos) {
    this.dome.position.copy(camPos);
    this.offset += dt * 3;
    const span = this.cloudSpan;
    // Wrap the cloud layer around the camera
    const ox = Math.round((camPos.x - this.offset) / span) * span + this.offset;
    const oz = Math.round(camPos.z / span) * span;
    this.clouds.position.set(ox, 0, oz);
  }
}
