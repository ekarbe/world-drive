// Lightweight "simcade" rigid body vehicle: raycast suspension against a heightfield,
// slip-angle based tyre model with a friction circle, power-limited engine and aero drag.
// Local frame: +z forward, +y up, +x left.

import * as THREE from 'three';

const G = 9.81;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 };
const _qInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();

export const DEFAULT_SPEC = {
  mass: 1200,
  size: [1.8, 1.3, 4.1], // width, height, length (collision box)
  wheelBase: 2.5,
  track: 1.56,
  wheelRadius: 0.36,
  hardpointY: -0.05,
  restLength: 0.42,
  power: 90000, // W
  maxSpeed: 40, // m/s
  accel: 0.75, // max drive force in g
  grip: 1.15, // tyre friction coefficient
  brake: 1.0, // braking force in g
  steer: 0.6, // max steering angle (rad) at low speed
  drive: 'rwd',
  suspension: 1.0, // stiffness multiplier
};

export class VehiclePhysics {
  constructor(env, spec = {}) {
    this.env = env;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, pitch: 0, roll: 0 };
    this.steerAngle = 0;
    this.wheels = [];
    this.setSpec(spec);
    // Telemetry for gameplay / audio
    this.speed = 0; // signed forward speed m/s
    this.contacts = 0;
    this.airTime = 0;
    this.slip = 0; // max lateral slip (m/s) of rear wheels
    this.onRoad = true;
    this.lastImpact = 0;
  }

  setSpec(spec) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    const s = this.spec;
    const [w, h, l] = s.size;
    this.mass = s.mass;
    // Box inertia, with extra roll/pitch inertia for stability.
    this.inertia = new THREE.Vector3(
      (s.mass / 12) * (h * h + l * l) * 1.3,
      (s.mass / 12) * (w * w + l * l),
      (s.mass / 12) * (w * w + h * h) * 1.8,
    );
    const share = (s.mass * G) / 4;
    const staticComp = s.restLength * 0.45;
    this.k = (share / staticComp) * s.suspension;
    this.c = 2 * 0.42 * Math.sqrt(this.k * (s.mass / 4));
    this.dragK = s.power / Math.pow(s.maxSpeed, 3);
    const hw = s.track / 2;
    const hl = s.wheelBase / 2;
    const prev = this.wheels;
    this.wheels = [
      { local: new THREE.Vector3(hw, s.hardpointY, hl), front: true, left: true },
      { local: new THREE.Vector3(-hw, s.hardpointY, hl), front: true, left: false },
      { local: new THREE.Vector3(hw, s.hardpointY, -hl), front: false, left: true },
      { local: new THREE.Vector3(-hw, s.hardpointY, -hl), front: false, left: false },
    ].map((w, idx) => ({
      ...w,
      driven: s.drive === 'awd' || (s.drive === 'rwd' ? !w.front : w.front),
      compression: prev[idx]?.compression ?? 0,
      length: s.restLength,
      contact: false,
      spin: prev[idx]?.spin ?? 0,
      spinVel: 0,
      lat: 0,
      load: 0,
    }));
    // Body corners for ground collision
    this.corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 0, 1]) {
      this.corners.push(new THREE.Vector3((sx * w) / 2, (sy * h) / 2 + 0.3, (sz * l) / 2));
    }
  }

  /** Place the car upright at (x, z) with heading (radians, 0 = +z). */
  reset(x, z, heading) {
    const y = this.env.groundHeight(x, z) + this.spec.wheelRadius + this.spec.restLength * 0.6 - this.spec.hardpointY + 0.3;
    this.pos.set(x, y, z);
    this.quat.setFromAxisAngle(_v1.set(0, 1, 0), heading);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    for (const w of this.wheels) w.compression = 0;
  }

  get heading() {
    const f = _v1.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(f.x, f.z);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(this.quat);
  }

  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  /** Apply world space force at world point (accumulators). */
  _addForce(F, T, f, point) {
    F.add(f);
    _v3.subVectors(point, this.pos).cross(f);
    T.add(_v3);
  }

  _applyInvInertia(vec) {
    _qInv.copy(this.quat).invert();
    vec.applyQuaternion(_qInv);
    vec.set(vec.x / this.inertia.x, vec.y / this.inertia.y, vec.z / this.inertia.z);
    vec.applyQuaternion(this.quat);
    return vec;
  }

  /** Apply an impulse J (world) at world point p. */
  applyImpulse(J, p) {
    this.vel.addScaledVector(J, 1 / this.mass);
    const r = _v2.subVectors(p, this.pos);
    const ang = _v3.copy(r).cross(J);
    this._applyInvInertia(ang);
    this.angVel.add(ang);
  }

  step(dt) {
    const s = this.spec;
    const env = this.env;
    const inp = this.input;
    const up = this.up(new THREE.Vector3());
    const fwd = this.forward(new THREE.Vector3());
    const left = new THREE.Vector3().crossVectors(up, fwd);
    const F = new THREE.Vector3(0, -this.mass * G, 0);
    const T = new THREE.Vector3();

    const vF = this.vel.dot(fwd);
    this.speed = vF;
    const speedAbs = this.vel.length();

    // Steering: speed sensitive and rate limited.
    const maxSteer = s.steer * (1 / (1 + Math.max(0, Math.abs(vF) - 6) / 14));
    const target = -inp.steer * maxSteer;
    const rate = 3.2 * dt;
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle));

    // Engine
    let throttle = inp.throttle;
    let brake = inp.brake;
    if (brake > 0.05 && vF < 1.0 && throttle < 0.05) {
      // reverse
      throttle = vF > -12 ? -brake * 0.6 : 0;
      brake = 0;
    } else if (throttle > 0.05 && vF < -0.5) {
      brake = throttle;
      throttle = 0;
    }
    const maxDrive = s.accel * this.mass * G;
    const driveForce = throttle * Math.min(maxDrive, s.power / Math.max(Math.abs(vF), 1));
    const nDriven = this.wheels.reduce((a, w) => a + (w.driven && w.contact ? 1 : 0), 0) || 1;

    this.contacts = 0;
    let maxRearSlip = 0;
    let roadContacts = 0;
    const hp = new THREE.Vector3();
    const cp = new THREE.Vector3();
    const wf = new THREE.Vector3();
    const ws = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const n = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const down = up.clone().negate();

    for (const w of this.wheels) {
      hp.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      // Find suspension length t such that the wheel centre sits radius above ground.
      let t = s.restLength;
      let contact = down.y < -0.3;
      if (contact) {
        for (let k = 0; k < 3; k++) {
          cp.copy(hp).addScaledVector(down, t);
          const g = env.groundHeight(cp.x, cp.z);
          t += (cp.y - (g + s.wheelRadius)) / -down.y;
        }
        if (t >= s.restLength) contact = false;
      }
      const prevComp = w.compression;
      if (!contact) {
        w.contact = false;
        w.compression = 0;
        w.length = Math.min(s.restLength, w.length + dt * 4);
        w.load = 0;
        w.spinVel *= 0.99;
        if (w.driven && Math.abs(throttle) > 0.1) w.spinVel += throttle * 60 * dt;
        w.spin += w.spinVel * dt;
        continue;
      }
      w.contact = true;
      this.contacts++;
      const tc = Math.max(t, 0);
      w.length = tc;
      const comp = s.restLength - tc;
      w.compression = comp;
      const compVel = (comp - prevComp) / dt;
      let Fs = this.k * comp + this.c * compVel;
      if (comp > s.restLength * 0.8) Fs += this.k * 6 * (comp - s.restLength * 0.8);
      if (t < 0) Fs += this.k * 10 * -t;
      Fs = Math.max(0, Math.min(Fs, this.mass * G * 6));
      w.load = Fs;
      this._addForce(F, T, tmp.copy(up).multiplyScalar(Fs), hp);

      // Contact point and ground frame
      cp.copy(hp).addScaledVector(down, tc + s.wheelRadius);
      env.groundNormal(cp.x, cp.z, _n);
      n.set(_n.x, _n.y, _n.z);
      const surf = env.surfaceAt(cp.x, cp.z);
      if (surf.road) roadContacts++;

      const steer = w.front ? this.steerAngle : 0;
      wf.copy(fwd).multiplyScalar(Math.cos(steer)).addScaledVector(left, Math.sin(steer));
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      ws.crossVectors(n, wf).normalize();

      // velocity of the contact point
      tmp.subVectors(cp, this.pos);
      vc.crossVectors(this.angVel, tmp).add(this.vel);
      const vLong = vc.dot(wf);
      const vLat = vc.dot(ws);

      let mu = s.grip * surf.grip;
      let latMu = mu;
      const hand = inp.handbrake > 0.5 && !w.front;
      if (hand) latMu *= 0.42;

      const N = Fs;
      // Lateral (slip angle based)
      const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 4));
      const peak = 0.13;
      let Flat = -N * latMu * Math.max(-1, Math.min(1, slipAngle / peak));
      // Longitudinal
      let Flong = 0;
      if (w.driven) Flong += driveForce / nDriven;
      if (brake > 0.01) {
        const bmax = (s.brake * this.mass * G * brake) / 4;
        const stopF = (Math.abs(vLong) * (this.mass / 4)) / dt;
        Flong -= Math.sign(vLong) * Math.min(bmax, stopF);
      }
      if (hand) {
        const stopF = (Math.abs(vLong) * (this.mass / 4)) / dt;
        Flong -= Math.sign(vLong) * Math.min(N * mu * 0.9, stopF);
      }
      // rolling resistance & holding at standstill
      Flong -= Math.sign(vLong) * Math.min(N * surf.roll, (Math.abs(vLong) * (this.mass / 4)) / dt);
      if (Math.abs(throttle) < 0.05 && brake < 0.05 && speedAbs < 1.5) {
        Flong -= vLong * N * 2;
      }
      // Friction circle
      const fmax = N * mu;
      const fl = Math.hypot(Flong, Flat);
      let spinRatio = 0;
      if (fl > fmax && fl > 0) {
        const sc = fmax / fl;
        // Longitudinal demand eats into lateral grip (power oversteer / lock-up)
        spinRatio = 1 - sc;
        Flong *= sc;
        Flat *= sc;
      }
      if (!w.front) maxRearSlip = Math.max(maxRearSlip, Math.abs(vLat));
      w.lat = vLat;

      // Apply tyre force slightly above the contact point to reduce roll-over tendency.
      tmp.subVectors(cp, this.pos);
      const vert = tmp.dot(up);
      tmp.addScaledVector(up, -vert * 0.65).add(this.pos);
      const tf = new THREE.Vector3().copy(wf).multiplyScalar(Flong).addScaledVector(ws, Flat);
      this._addForce(F, T, tf, tmp);

      // Visual wheel spin
      const roll = vLong / s.wheelRadius;
      w.spinVel = w.driven && spinRatio > 0.2 && Math.abs(throttle) > 0.5 ? roll + throttle * 25 * spinRatio : hand ? 0 : roll;
      w.spin += w.spinVel * dt;
    }
    this.slip = maxRearSlip;
    this.onRoad = roadContacts >= 2 || (this.contacts === 0 && this.onRoad);

    // Aero drag & downforce
    const vmag = this.vel.length();
    F.addScaledVector(this.vel, -this.dragK * vmag);
    if (this.contacts > 0) F.addScaledVector(up, -this.mass * 0.004 * vmag * vmag * 0.5);

    // Stabiliser: keeps the car upright-ish (simcade assist)
    const worldUp = _v1.set(0, 1, 0);
    const corr = _v2.crossVectors(up, worldUp);
    const stab = this.contacts >= 2 ? 1.2 : 2.5;
    T.addScaledVector(corr, this.mass * stab * 4);
    // Air control
    if (this.contacts === 0) {
      T.addScaledVector(left, -inp.pitch * this.mass * 4);
      T.addScaledVector(fwd, inp.roll * this.mass * 3);
      T.addScaledVector(up, -inp.steer * this.mass * 2.5);
    }

    // Integrate
    this.vel.addScaledVector(F, dt / this.mass);
    const angAcc = this._applyInvInertia(T.clone());
    this.angVel.addScaledVector(angAcc, dt);
    // angular damping
    const damp = this.contacts > 0 ? 1.2 : 0.6;
    this.angVel.multiplyScalar(Math.max(0, 1 - damp * dt));
    // extra yaw damping at very low speed to avoid creeping spins
    if (vmag < 1 && Math.abs(inp.throttle) < 0.05) {
      this.angVel.multiplyScalar(0.9);
    }
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    _dq.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += _dq.x;
    this.quat.y += _dq.y;
    this.quat.z += _dq.z;
    this.quat.w += _dq.w;
    this.quat.normalize();

    this._groundCollision();

    if (this.contacts === 0) this.airTime += dt;
    else this.airTime = 0;
  }

  /** Keep the body above ground (body box corners vs heightfield). */
  _groundCollision() {
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const r = new THREE.Vector3();
    const vc = new THREE.Vector3();
    let maxPen = 0;
    let impact = 0;
    for (const c of this.corners) {
      p.copy(c).applyQuaternion(this.quat).add(this.pos);
      const g = this.env.groundHeight(p.x, p.z);
      const pen = g - p.y;
      if (pen <= 0) continue;
      maxPen = Math.max(maxPen, pen);
      this.env.groundNormal(p.x, p.z, _n);
      n.set(_n.x, _n.y, _n.z);
      r.subVectors(p, this.pos);
      vc.crossVectors(this.angVel, r).add(this.vel);
      const vn = vc.dot(n);
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        // effective mass along n
        const rn = _v1.copy(r).cross(n);
        this._applyInvInertia(rn);
        const denom = 1 / this.mass + rn.cross(r).dot(n);
        const j = (-(1 + 0.15) * vn) / denom / 4;
        const J = n.clone().multiplyScalar(j);
        // friction
        const vt = vc.clone().addScaledVector(n, -vn);
        const vtl = vt.length();
        if (vtl > 0.01) J.addScaledVector(vt, (-Math.min(0.4 * j, (vtl * this.mass) / 8)) / vtl);
        this.applyImpulse(J, p);
      }
    }
    if (maxPen > 0) this.pos.y += maxPen * 0.8;
    if (impact > 2) this.lastImpact = Math.max(this.lastImpact, impact);
  }

  /**
   * Resolve collision against a world-space horizontal normal (nx, nz) with penetration depth,
   * at contact point (px, py, pz). Returns impact speed.
   */
  resolveHorizontal(nx, nz, depth, px, py, pz, restitution = 0.25, otherVel = null) {
    this.pos.x += nx * depth;
    this.pos.z += nz * depth;
    const p = new THREE.Vector3(px, py, pz);
    const r = new THREE.Vector3().subVectors(p, this.pos);
    const n = new THREE.Vector3(nx, 0, nz);
    const vc = new THREE.Vector3().crossVectors(this.angVel, r).add(this.vel);
    if (otherVel) vc.sub(otherVel);
    const vn = vc.dot(n);
    if (vn >= 0) return 0;
    const rn = new THREE.Vector3().copy(r).cross(n);
    this._applyInvInertia(rn);
    const denom = 1 / this.mass + rn.cross(r).dot(n);
    const j = (-(1 + restitution) * vn) / denom;
    const J = n.clone().multiplyScalar(j);
    const vt = vc.clone().addScaledVector(n, -vn);
    vt.y = 0;
    const vtl = vt.length();
    if (vtl > 0.01) J.addScaledVector(vt, -Math.min(0.3 * j, (vtl * this.mass) / 3) / vtl);
    this.applyImpulse(J, p);
    return -vn;
  }
}
