import { describe, it, expect } from 'vitest';
import { WorldGen, CELL, ROAD_WIDTH } from '../src/world/worldgen.js';

describe('WorldGen', () => {
  it('is deterministic for a seed', () => {
    const a = new WorldGen(42);
    const b = new WorldGen(42);
    for (let k = 0; k < 50; k++) {
      const x = k * 37.3 - 900;
      const z = k * -51.7 + 400;
      expect(a.terrainHeight(x, z)).toBe(b.terrainHeight(x, z));
      expect(a.districtAt(x, z).type).toBe(b.districtAt(x, z).type);
    }
  });

  it('produces every district type and keeps heights in range', () => {
    const w = new WorldGen(12345);
    const types = new Set();
    for (let a = -20; a < 20; a++) for (let b = -20; b < 20; b++) types.add(w.district(a, b).type);
    expect([...types].sort()).toEqual(['city', 'fields', 'forest', 'village']);
    for (let x = -3000; x < 3000; x += 97) {
      for (let z = -3000; z < 3000; z += 89) {
        const h = w.terrainHeight(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(Math.abs(h)).toBeLessThan(60);
      }
    }
  });

  it('road segments are consistent from both ends of a node', () => {
    const w = new WorldGen(7);
    for (let i = -10; i < 10; i++) {
      for (let j = -10; j < 10; j++) {
        expect(w.nodeArms(i, j).e).toBe(w.nodeArms(i + 1, j).w);
        expect(w.nodeArms(i, j).n).toBe(w.nodeArms(i, j + 1).s);
      }
    }
  });

  it('roadAt finds the road under a segment centre', () => {
    const w = new WorldGen(7);
    let checked = 0;
    for (let i = -10; i < 10; i++) {
      for (let j = -10; j < 10; j++) {
        const cls = w.segH(i, j);
        if (!cls) continue;
        const r = w.roadAt(i * CELL + CELL / 2, j * CELL + ROAD_WIDTH[cls] / 4);
        expect(r).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('finds a spawn next to a city special on a road', () => {
    const w = new WorldGen(99);
    const s = w.findSpawn();
    expect(s.special).not.toBeNull();
    expect(w.roadAt(s.x, s.z)).not.toBeNull();
  });
});
