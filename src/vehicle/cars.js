// Car catalogue (stats, prices) and voxel model construction.

import * as THREE from 'three';
import { MeshBuilder, lin } from '../world/meshBuilder.js';

export const CARS = [
  {
    id: 'hatch',
    name: 'Pixel Hatch',
    price: 0,
    desc: 'A humble, nimble starter. Front-wheel drive.',
    spec: { mass: 1050, power: 75000, maxSpeed: 40, accel: 0.7, grip: 1.1, drive: 'fwd', steer: 0.62 },
    body: { l: 3.7, w: 1.7, h: 0.6, y: -0.05, cabL: 2.1, cabH: 0.62, cabZ: -0.35, cabW: 1.56, nose: 0.25 },
    paint: 0x3fa7d6,
  },
  {
    id: 'pickup',
    name: 'Hauler Pickup',
    price: 600,
    desc: 'Tough 4x4 that shrugs off dirt roads.',
    spec: { mass: 1700, power: 130000, maxSpeed: 44, accel: 0.72, grip: 1.05, drive: 'awd', steer: 0.55, suspension: 0.85, offroad: 0.97 },
    body: { l: 4.6, w: 1.9, h: 0.75, y: 0.05, cabL: 1.6, cabH: 0.7, cabZ: 0.45, cabW: 1.8, nose: 0.2, bed: true },
    size: [1.9, 1.5, 4.6],
    wheelRadius: 0.44,
    wheelBase: 2.9,
    track: 1.7,
    paint: 0xc0392b,
  },
  {
    id: 'van',
    name: 'Courier Van',
    price: 900,
    desc: 'Built for deliveries: +50% delivery rewards.',
    spec: { mass: 1800, power: 110000, maxSpeed: 42, accel: 0.65, grip: 1.05, drive: 'fwd', steer: 0.55, deliveryBonus: 0.5 },
    body: { l: 4.6, w: 1.9, h: 0.8, y: 0.05, cabL: 3.6, cabH: 1.0, cabZ: -0.35, cabW: 1.86, nose: 0.25, van: true },
    size: [1.9, 1.9, 4.6],
    wheelBase: 2.9,
    track: 1.7,
    wheelRadius: 0.4,
    paint: 0xf2f2f2,
  },
  {
    id: 'rally',
    name: 'Dirt Rally',
    price: 1500,
    desc: 'AWD rally machine. Grips everywhere, loves jumps.',
    spec: { mass: 1150, power: 150000, maxSpeed: 50, accel: 0.9, grip: 1.25, drive: 'awd', steer: 0.6, offroad: 0.95, suspension: 0.9 },
    body: { l: 4.0, w: 1.8, h: 0.6, y: 0.0, cabL: 2.0, cabH: 0.6, cabZ: -0.3, cabW: 1.6, nose: 0.3, wing: true },
    paint: 0x1f6fd1,
  },
  {
    id: 'muscle',
    name: 'Thunder Muscle',
    price: 2500,
    desc: 'Big V8, rear-wheel drive. Drifts all day.',
    spec: { mass: 1500, power: 260000, maxSpeed: 62, accel: 0.95, grip: 1.12, drive: 'rwd', steer: 0.55 },
    body: { l: 4.6, w: 1.9, h: 0.6, y: -0.05, cabL: 1.9, cabH: 0.55, cabZ: -0.5, cabW: 1.6, nose: 0.4, scoop: true },
    size: [1.9, 1.3, 4.6],
    wheelBase: 2.8,
    track: 1.64,
    wheelRadius: 0.38,
    paint: 0xf39c12,
  },
  {
    id: 'coupe',
    name: 'Neon Coupe',
    price: 4000,
    desc: 'Low, light and precise. A corner carver.',
    spec: { mass: 1200, power: 240000, maxSpeed: 66, accel: 1.0, grip: 1.38, drive: 'rwd', steer: 0.6 },
    body: { l: 4.3, w: 1.85, h: 0.5, y: -0.1, cabL: 1.8, cabH: 0.5, cabZ: -0.35, cabW: 1.5, nose: 0.45 },
    size: [1.85, 1.2, 4.3],
    wheelBase: 2.65,
    track: 1.62,
    paint: 0x8e44ad,
  },
  {
    id: 'super',
    name: 'Apex Hyper',
    price: 12000,
    desc: 'The ultimate machine. Absurd speed, AWD grip.',
    spec: { mass: 1300, power: 480000, maxSpeed: 88, accel: 1.25, grip: 1.55, drive: 'awd', steer: 0.55 },
    body: { l: 4.6, w: 2.0, h: 0.45, y: -0.15, cabL: 1.6, cabH: 0.45, cabZ: -0.1, cabW: 1.4, nose: 0.6, wing: true },
    size: [2.0, 1.1, 4.6],
    wheelBase: 2.75,
    track: 1.72,
    wheelRadius: 0.37,
    paint: 0xe74c3c,
  },
];

export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));

export const UPGRADES = [
  { id: 'engine', name: 'Engine', desc: '+power & top speed', base: 150 },
  { id: 'tires', name: 'Tyres', desc: '+grip', base: 110 },
  { id: 'brakes', name: 'Brakes', desc: '+stopping power', base: 80 },
  { id: 'suspension', name: 'Suspension', desc: '+handling & stability', base: 90 },
];
export const MAX_UPGRADE = 5;

export function upgradePrice(car, upg, level) {
  const tier = 1 + car.price / 3000;
  return Math.round((upg.base * tier * Math.pow(1.75, level)) / 10) * 10;
}

export const PAINTS = [
  0xe74c3c, 0xc0392b, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x16a085, 0x3fa7d6, 0x1f6fd1,
  0x8e44ad, 0xe84393, 0xf2f2f2, 0x95a5a6, 0x34495e, 0x1b1b1f, 0x6d4c41, 0x7bed9f,
];
export const RIMS = [0xc8ccd0, 0x2b2b2f, 0xd4af37, 0xe74c3c, 0x3fa7d6, 0xf2f2f2];
export const GLOWS = [0x00e5ff, 0xff2bd6, 0x39ff14, 0xffb300, 0x8c52ff];
export const COSMETIC_PRICES = { paint: 50, rims: 40, spoiler: 120, stripes: 80, glow: 150 };

/** Physics spec for a car with upgrades applied. */
export function buildSpec(car, upgrades = {}) {
  const u = (k) => upgrades[k] || 0;
  const s = { ...car.spec };
  if (car.size) s.size = car.size;
  if (car.wheelRadius) s.wheelRadius = car.wheelRadius;
  if (car.wheelBase) s.wheelBase = car.wheelBase;
  if (car.track) s.track = car.track;
  s.power *= 1 + 0.12 * u('engine');
  s.maxSpeed *= 1 + 0.045 * u('engine');
  s.accel = (s.accel ?? 0.75) * (1 + 0.05 * u('engine'));
  s.grip *= 1 + 0.05 * u('tires');
  s.brake = (s.brake ?? 1) * (1 + 0.12 * u('brakes'));
  s.suspension = (s.suspension ?? 1) * (1 + 0.06 * u('suspension'));
  s.steer = (s.steer ?? 0.6) * (1 + 0.025 * u('suspension'));
  return s;
}

/** 0..1 ratings for UI bars. */
export function ratings(spec) {
  return {
    speed: Math.min(1, (spec.maxSpeed - 30) / 70),
    accel: Math.min(1, spec.power / spec.mass / 400),
    grip: Math.min(1, (spec.grip - 0.9) / 0.9),
    brake: Math.min(1, (spec.brake ?? 1) / 1.8),
  };
}

const wheelGeoCache = new Map();

/**
 * Builds a THREE.Group for a car. Returns { group, wheels[], paintMat, setPaint(), ... }.
 * look: { paint, rims, spoiler, stripes, glow }
 */
const modelGeoCache = new Map();
let glowTex = null;

function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.translate(32, 64);
  g.scale(1, 2);
  const grad = g.createRadialGradient(0, 0, 4, 0, 0, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(-32, -32, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Builds (once per car type) the merged body geometries. */
function carGeometries(car) {
  if (modelGeoCache.has(car.id)) return modelGeoCache.get(car.id);
  const b = car.body;
  const paint = new MeshBuilder();
  const detail = new MeshBuilder();
  const hl = b.l / 2;
  const hw = b.w / 2;
  const y0 = b.y - b.h / 2;
  const y1 = b.y + b.h / 2;

  // Main body (with a slightly lower nose)
  paint.box(-hw, y0, -hl, hw, y1, hl - b.nose * 1.6, lin(0xffffff));
  paint.box(-hw, y0, hl - b.nose * 1.6, hw, y1 - b.nose * 0.35, hl, lin(0xffffff));
  // Cabin: glass band + roof
  const cw = b.cabW / 2;
  const cz0 = b.cabZ - b.cabL / 2;
  const cz1 = b.cabZ + b.cabL / 2;
  const glass = lin(0x1e2a36);
  if (b.van) {
    // Van: solid cargo box with windscreen and cab side windows only
    paint.box(-cw, y1, cz0, cw, y1 + b.cabH * 0.8, cz1 - 1.0, lin(0xffffff));
    detail.box(-cw, y1, cz1 - 1.0, cw, y1 + b.cabH * 0.8, cz1, glass, { shade: 1 });
  } else {
    detail.box(-cw, y1, cz0, cw, y1 + b.cabH * 0.8, cz1, glass, { shade: 1 });
  }
  paint.box(-cw - 0.02, y1 + b.cabH * 0.8, cz0 - 0.02, cw + 0.02, y1 + b.cabH, cz1 + 0.02, lin(0xffffff));
  // pillars
  for (const sx of [-1, 1]) {
    paint.box(sx * cw - 0.06 * (sx > 0 ? 1 : 0), y1, cz1 - 0.12, sx * cw + 0.06 * (sx > 0 ? 0 : 1), y1 + b.cabH * 0.8, cz1, lin(0xffffff));
  }
  if (b.bed) {
    // pickup bed walls
    const bz1 = cz0 - 0.1;
    paint.box(-hw, y1, -hl, -hw + 0.12, y1 + 0.35, bz1, lin(0xffffff));
    paint.box(hw - 0.12, y1, -hl, hw, y1 + 0.35, bz1, lin(0xffffff));
    paint.box(-hw, y1, -hl, hw, y1 + 0.35, -hl + 0.12, lin(0xffffff));
    detail.box(-hw + 0.12, y1, -hl + 0.12, hw - 0.12, y1 + 0.05, bz1, lin(0x2a2a2a));
  }
  if (b.scoop) detail.box(-0.3, y1 - 0.02, hl - 1.6, 0.3, y1 + 0.18, hl - 0.8, lin(0x1b1b1f));
  // Lights, grille, bumpers
  const fz = hl;
  const ly = y1 - b.nose * 0.35 - 0.18;
  detail.box(hw - 0.45, ly - 0.1, fz, hw - 0.1, ly + 0.08, fz + 0.04, lin(0xfff6cc), { shade: 1 });
  detail.box(-hw + 0.1, ly - 0.1, fz, -hw + 0.45, ly + 0.08, fz + 0.04, lin(0xfff6cc), { shade: 1 });
  detail.box(-hw + 0.5, ly - 0.12, fz, hw - 0.5, ly + 0.06, fz + 0.03, lin(0x222428));
  detail.box(hw - 0.4, y1 - 0.25, -hl - 0.04, hw - 0.08, y1 - 0.08, -hl, lin(0xd0312d), { shade: 1 });
  detail.box(-hw + 0.08, y1 - 0.25, -hl - 0.04, -hw + 0.4, y1 - 0.08, -hl, lin(0xd0312d), { shade: 1 });
  detail.box(-hw - 0.02, y0 - 0.02, fz - 0.1, hw + 0.02, y0 + 0.18, fz + 0.08, lin(0x2b2d31));
  detail.box(-hw - 0.02, y0 - 0.02, -hl - 0.08, hw + 0.02, y0 + 0.18, -hl + 0.1, lin(0x2b2d31));
  // side skirts
  detail.box(-hw - 0.03, y0 - 0.02, -hl + 0.5, hw + 0.03, y0 + 0.1, hl - 0.5, lin(0x2b2d31));

  const wing = new MeshBuilder();
  const wy = y1 + (b.wing ? 0.45 : 0.35);
  wing.box(-0.55, y1, -hl + 0.15, -0.45, wy, -hl + 0.35, lin(0x222222));
  wing.box(0.45, y1, -hl + 0.15, 0.55, wy, -hl + 0.35, lin(0x222222));
  wing.box(-hw + 0.05, wy, -hl + 0.02, hw - 0.05, wy + 0.08, -hl + 0.5, lin(0xffffff));

  const stripe = new MeshBuilder();
  const sy = y1 + 0.012;
  stripe.box(-0.32, sy - 0.01, cz1, -0.12, sy, hl - b.nose * 1.6, lin(0xffffff), { shade: 1 });
  stripe.box(0.12, sy - 0.01, cz1, 0.32, sy, hl - b.nose * 1.6, lin(0xffffff), { shade: 1 });
  stripe.box(-0.32, y1 + b.cabH + 0.005, cz0, -0.12, y1 + b.cabH + 0.015, cz1, lin(0xffffff), { shade: 1 });
  stripe.box(0.12, y1 + b.cabH + 0.005, cz0, 0.32, y1 + b.cabH + 0.015, cz1, lin(0xffffff), { shade: 1 });
  if (!b.bed) {
    stripe.box(-0.32, sy - 0.01, -hl, -0.12, sy, cz0, lin(0xffffff), { shade: 1 });
    stripe.box(0.12, sy - 0.01, -hl, 0.32, sy, cz0, lin(0xffffff), { shade: 1 });
  }
  const geos = { paint: paint.build(), detail: detail.build(), wing: wing.build(), stripe: stripe.build() };
  modelGeoCache.set(car.id, geos);
  return geos;
}

/**
 * Builds a THREE.Group for a car. Returns { group, wheels[], paintMat, setLook(), ... }.
 * look: { paint, rims, spoiler, stripes, glow }
 */
export function buildCarModel(car, look = {}, opts = {}) {
  const b = car.body;
  const group = new THREE.Group();
  const geos = carGeometries(car);
  const paintMat = new THREE.MeshPhongMaterial({ color: look.paint ?? car.paint, shininess: 70, specular: 0x666666, vertexColors: true });
  const detailMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const paintMesh = new THREE.Mesh(geos.paint, paintMat);
  const detailMesh = new THREE.Mesh(geos.detail, detailMat);
  paintMesh.castShadow = !opts.noShadow;
  detailMesh.castShadow = !opts.noShadow;
  group.add(paintMesh, detailMesh);

  // Optional cosmetics (built always; toggled via visibility)
  const extras = {};
  extras.spoilerMat = new THREE.MeshLambertMaterial({ color: look.paint ?? car.paint, vertexColors: true });
  extras.spoiler = new THREE.Mesh(geos.wing, extras.spoilerMat);
  extras.spoiler.castShadow = !opts.noShadow;
  extras.spoiler.visible = !!(look.spoiler || b.wing);
  group.add(extras.spoiler);

  extras.stripeMat = new THREE.MeshLambertMaterial({ color: look.stripes ?? 0xffffff, vertexColors: true });
  extras.stripes = new THREE.Mesh(geos.stripe, extras.stripeMat);
  extras.stripes.visible = look.stripes != null;
  group.add(extras.stripes);

  extras.glowMat = new THREE.MeshBasicMaterial({ color: look.glow ?? 0x00e5ff, map: glowTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  extras.glow = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 2.2, b.l + 2.4), extras.glowMat);
  extras.glow.rotation.x = -Math.PI / 2;
  extras.glow.visible = look.glow != null;
  extras.glow.renderOrder = 2;
  // the glow plane is placed on the ground each frame by the owner

  // Wheels
  const r = car.wheelRadius || 0.36;
  const key = r.toFixed(2);
  let wg = wheelGeoCache.get(key);
  if (!wg) {
    const tire = new THREE.CylinderGeometry(r, r, 0.3, 10);
    tire.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.32, 6);
    rim.rotateZ(Math.PI / 2);
    wg = { tire, rim };
    wheelGeoCache.set(key, wg);
  }
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
  const rimMat = new THREE.MeshLambertMaterial({ color: look.rims ?? 0xc8ccd0 });
  const wb = (car.wheelBase || 2.5) / 2;
  const tr = (car.track || 1.56) / 2;
  const wheels = [];
  for (const [x, z] of [[tr, wb], [-tr, wb], [tr, -wb], [-tr, -wb]]) {
    const pivot = new THREE.Group(); // steering
    const spin = new THREE.Group();
    const t = new THREE.Mesh(wg.tire, tireMat);
    const rm = new THREE.Mesh(wg.rim, rimMat);
    t.castShadow = !opts.noShadow;
    spin.add(t, rm);
    pivot.add(spin);
    pivot.position.set(x, -0.5, z);
    group.add(pivot);
    wheels.push({ pivot, spin, x, z });
  }

  return {
    group,
    wheels,
    paintMat,
    rimMat,
    extras,
    wheelRadius: r,
    setLook(lk) {
      paintMat.color.setHex(lk.paint ?? car.paint);
      extras.spoilerMat.color.setHex(lk.paint ?? car.paint);
      rimMat.color.setHex(lk.rims ?? 0xc8ccd0);
      extras.spoiler.visible = !!(lk.spoiler || b.wing);
      extras.stripes.visible = lk.stripes != null;
      if (lk.stripes != null) extras.stripeMat.color.setHex(lk.stripes);
      extras.glow.visible = lk.glow != null;
      if (lk.glow != null) extras.glowMat.color.setHex(lk.glow);
    },
    dispose() {
      // geometries are shared via caches; only materials are per instance
      group.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      });
      extras.glow.geometry.dispose();
      extras.glowMat.dispose();
    },
  };
}
