// Delivery missions between depots.

import { hash3, mulberry32 } from '../core/rng.js';

const CARGO = [
  'Fresh bread', 'Flower bouquets', 'Vinyl records', 'Spare tyres', 'Birthday cake', 'Garden gnomes',
  'Medical supplies', 'Pizza (still hot)', 'Antique vase', 'Concert tickets', 'Tropical fish', 'Board games',
  'Mail sacks', 'Coffee beans', 'Robot parts', 'Wedding dress',
];

export function offersFor(world, depot, count = 3) {
  const all = world
    .poisNear(depot.x, depot.z, 2600)
    .filter((p) => p.type === 'depot' && p.id !== depot.id)
    .map((p) => ({ p, d: Math.hypot(p.x - depot.x, p.z - depot.z) }))
    .filter((o) => o.d > 350);
  if (!all.length) return [];
  // Stable-ish selection that changes every few minutes.
  const epoch = Math.floor(Date.now() / (4 * 60 * 1000));
  const r = mulberry32(hash3(depot.ci, depot.cj, epoch, world.seed));
  all.sort((a, b) => a.d - b.d);
  const picks = [];
  const buckets = [all.slice(0, Math.ceil(all.length / 3)), all.slice(Math.ceil(all.length / 3), Math.ceil((2 * all.length) / 3)), all.slice(Math.ceil((2 * all.length) / 3))];
  for (const b of buckets) {
    if (b.length && picks.length < count) picks.push(b[Math.floor(r() * b.length)]);
  }
  return picks.map(({ p, d }) => {
    const reward = Math.round(25 + d * 0.07);
    return {
      from: depot.id,
      fromName: depot.name,
      to: { id: p.id, x: p.x, z: p.z, name: p.name },
      cargo: CARGO[Math.floor(r() * CARGO.length)],
      distance: d,
      reward,
      timeLimit: Math.round(d / 13 + 45),
    };
  });
}

/** Reward for finishing an active mission. */
export function missionPayout(mission, elapsed, bonusMul = 0) {
  const onTime = elapsed <= mission.timeLimit;
  const base = mission.reward;
  const timeBonus = onTime ? Math.round(base * 0.5) : 0;
  const carBonus = Math.round((base + timeBonus) * bonusMul);
  return { onTime, base, timeBonus, carBonus, total: base + timeBonus + carBonus };
}
