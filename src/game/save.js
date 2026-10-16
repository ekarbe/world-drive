// Persistent game state in localStorage.

import { CAR_BY_ID, upgradePrice, UPGRADES, MAX_UPGRADE, COSMETIC_PRICES } from '../vehicle/cars.js';

const KEY = 'worlddrive.save.v1';

export function defaultSettings() {
  const touch = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
  return { music: 0.5, sfx: 0.8, quality: touch ? 'low' : 'medium', camera: 0, units: 'kmh' };
}

export function newSave(seed = (Math.random() * 2 ** 31) | 0) {
  return {
    version: 1,
    seed,
    coins: 0,
    car: 'hatch',
    owned: { hatch: { upgrades: {}, look: {} } },
    stats: { distance: 0, earned: 0, deliveries: 0, nearMisses: 0, bestAir: 0, bestDrift: 0 },
    mission: null,
    position: null,
    settings: defaultSettings(),
  };
}

export class SaveGame {
  constructor() {
    this.data = this._load() || newSave();
    this.dirty = false;
    this.listeners = new Set();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.version !== 1) return null;
      const base = newSave(d.seed);
      return { ...base, ...d, stats: { ...base.stats, ...d.stats }, settings: { ...base.settings, ...d.settings } };
    } catch {
      return null;
    }
  }

  get hasProgress() {
    return this.data.stats.distance > 50 || this.data.coins > 0;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      this.dirty = false;
    } catch {
      /* storage unavailable (private mode) - progress lives for this session only */
    }
  }

  reset(seed) {
    const settings = this.data.settings;
    this.data = newSave(seed);
    this.data.settings = settings;
    this.save();
    this.emit();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.dirty = true;
    for (const fn of this.listeners) fn(this.data);
  }

  get coins() {
    return this.data.coins;
  }

  addCoins(n) {
    if (n <= 0) return;
    this.data.coins += n;
    this.data.stats.earned += n;
    this.emit();
  }

  spend(n) {
    if (this.data.coins < n) return false;
    this.data.coins -= n;
    this.emit();
    this.save();
    return true;
  }

  get carId() {
    return this.data.car;
  }

  get carState() {
    return this.data.owned[this.data.car];
  }

  owns(id) {
    return !!this.data.owned[id];
  }

  buyCar(id) {
    const car = CAR_BY_ID[id];
    if (!car || this.owns(id)) return false;
    if (!this.spend(car.price)) return false;
    this.data.owned[id] = { upgrades: {}, look: {} };
    this.data.car = id;
    this.emit();
    this.save();
    return true;
  }

  selectCar(id) {
    if (!this.owns(id)) return false;
    this.data.car = id;
    this.emit();
    this.save();
    return true;
  }

  upgradeCost(upgId) {
    const car = CAR_BY_ID[this.data.car];
    const lvl = this.carState.upgrades[upgId] || 0;
    if (lvl >= MAX_UPGRADE) return null;
    return upgradePrice(car, UPGRADES.find((u) => u.id === upgId), lvl);
  }

  buyUpgrade(upgId) {
    const cost = this.upgradeCost(upgId);
    if (cost == null || !this.spend(cost)) return false;
    const u = this.carState.upgrades;
    u[upgId] = (u[upgId] || 0) + 1;
    this.emit();
    this.save();
    return true;
  }

  /** Buy a cosmetic: kind in paint|rims|stripes|glow|spoiler, value colour or boolean/null. */
  buyCosmetic(kind, value) {
    const cost = COSMETIC_PRICES[kind];
    if (!this.spend(cost)) return false;
    this.carState.look[kind] = value;
    this.emit();
    this.save();
    return true;
  }
}
