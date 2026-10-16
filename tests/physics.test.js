import { describe, it, expect } from 'vitest';
import { VehiclePhysics } from '../src/vehicle/vehiclePhysics.js';
import { CARS, buildSpec } from '../src/vehicle/cars.js';
import { WorldGen } from '../src/world/worldgen.js';

const flat = {
  groundHeight: () => 0,
  groundNormal: (x, z, o) => Object.assign(o, { x: 0, y: 1, z: 0 }),
  surfaceAt: () => ({ grip: 1, roll: 0.015, road: true }),
};

function sim(v, seconds, ctl = () => {}) {
  for (let k = 0; k < seconds * 120; k++) {
    ctl(v, k / 120);
    v.step(1 / 120);
  }
}

describe('VehiclePhysics', () => {
  it('settles at rest on flat ground', () => {
    const v = new VehiclePhysics(flat);
    v.reset(0, 0, 0);
    sim(v, 3);
    expect(v.contacts).toBe(4);
    expect(v.vel.length()).toBeLessThan(0.05);
    expect(v.up().y).toBeGreaterThan(0.999);
  });

  it.each(CARS.map((c) => c.id))('%s accelerates close to its top speed and stays upright', (id) => {
    const car = CARS.find((c) => c.id === id);
    const v = new VehiclePhysics(flat, buildSpec(car));
    v.reset(0, 0, 0);
    sim(v, 60, (v) => (v.input.throttle = 1));
    expect(v.speed).toBeGreaterThan(v.spec.maxSpeed * 0.85);
    expect(v.speed).toBeLessThan(v.spec.maxSpeed * 1.05);
    expect(v.up().y).toBeGreaterThan(0.99);
  });

  it('survives hard cornering and rough terrain without flipping or NaN', () => {
    const w = new WorldGen(1);
    const env = {
      groundHeight: (x, z) => w.groundHeight(x, z),
      groundNormal: (x, z, o) => w.groundNormal(x, z, o),
      surfaceAt: () => ({ grip: 0.8, roll: 0.045, road: false }),
    };
    const v = new VehiclePhysics(env, buildSpec(CARS.find((c) => c.id === 'super')));
    v.reset(1500, 1500, 0.3);
    sim(v, 30, (v, t) => {
      v.input.throttle = 1;
      v.input.steer = Math.sin(t * 0.7);
    });
    expect(Number.isFinite(v.pos.x)).toBe(true);
    expect(v.up().y).toBeGreaterThan(0.5);
  });
});
