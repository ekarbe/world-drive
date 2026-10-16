// Camera modes: chase, hood, top-down and a showroom orbit used inside shops.

import * as THREE from 'three';

export const CAMERA_MODES = ['Chase', 'Far chase', 'Hood', 'Top-down'];

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.orbit = 0;
    this.showroom = false;
    this.orbitDist = 7.5;
    this.orbitHeight = 2.2;
    this.shake = 0;
    this._f = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this.initialised = false;
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.initialised = false;
    return CAMERA_MODES[this.mode];
  }

  addShake(s) {
    this.shake = Math.min(1, this.shake + s);
  }

  update(dt, v) {
    const cam = this.camera;
    const p = v.pos;
    const f = v.forward(this._f);
    const speed = v.vel.length();
    const k = (rate) => 1 - Math.exp(-rate * dt);

    if (this.showroom) {
      this.orbit += dt * 0.35;
      const d = this.orbitDist;
      const target = new THREE.Vector3(p.x + Math.sin(this.orbit) * d, p.y + this.orbitHeight, p.z + Math.cos(this.orbit) * d);
      target.y = Math.max(target.y, this.world.groundHeight(target.x, target.z) + 1.2);
      this.pos.lerp(target, this.initialised ? k(4) : 1);
      this.look.set(p.x, p.y + 0.3, p.z);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.fov += (50 - cam.fov) * k(4);
      cam.updateProjectionMatrix();
      this.initialised = true;
      return;
    }

    // Heading follows velocity a bit when drifting/sliding, otherwise the car's nose.
    let yawTarget = Math.atan2(f.x, f.z);
    if (speed > 8 && v.speed > 4) {
      // While sliding, swing partially towards the direction of travel.
      const velYaw = Math.atan2(v.vel.x, v.vel.z);
      let d = Math.atan2(Math.sin(velYaw - yawTarget), Math.cos(velYaw - yawTarget));
      yawTarget += d * 0.35;
    }
    if (!this.initialised) this.yaw = yawTarget;
    let dy = yawTarget - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k(this.mode === 2 ? 30 : 4.5);

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let desired;
    let lookAt;
    let fov = 62 + Math.min(speed / 70, 1) * 16;

    if (this.mode === 0 || this.mode === 1) {
      const far = this.mode === 1;
      const dist = (far ? 10 : 6.6) + Math.min(speed * 0.04, 2);
      const h = far ? 3.8 : 2.5;
      desired = new THREE.Vector3(p.x - fx * dist, p.y + h, p.z - fz * dist);
      const ground = this.world.groundHeight(desired.x, desired.z) + 1.2;
      if (desired.y < ground) desired.y = ground;
      lookAt = new THREE.Vector3(p.x + fx * 4, p.y + 0.9, p.z + fz * 4);
      this.pos.lerp(desired, this.initialised ? k(10) : 1);
      // Keep the vertical follow snappy so jumps stay framed.
      this.pos.y += (desired.y - this.pos.y) * k(6);
    } else if (this.mode === 2) {
      const u = v.up(this._u);
      desired = new THREE.Vector3().copy(p).addScaledVector(u, 0.85).addScaledVector(f, 0.4);
      lookAt = desired.clone().addScaledVector(f, 10);
      this.pos.copy(desired);
      fov += 6;
    } else {
      desired = new THREE.Vector3(p.x - fx * 8, p.y + 42 + speed * 0.3, p.z - fz * 8);
      lookAt = new THREE.Vector3(p.x + fx * 6, p.y, p.z + fz * 6);
      this.pos.lerp(desired, this.initialised ? k(5) : 1);
      fov = 55;
    }
    if (!this.initialised) this.look.copy(lookAt);
    this.look.lerp(lookAt, this.mode === 2 ? 1 : k(14));
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }
    cam.lookAt(this.look);
    cam.fov += (fov - cam.fov) * k(3);
    cam.updateProjectionMatrix();
    this.initialised = true;
  }
}
