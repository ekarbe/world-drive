// Minimap (heading-up, around the player) and full-screen world map (north-up).

import { CELL, DISTRICT, ROAD_MAIN, ROAD_WIDTH } from '../world/worldgen.js';
import { SPECIAL_INFO } from '../render/markers.js';

const DISTRICT_COLORS = {
  city: '#a9aaa6',
  village: '#8cc265',
  forest: '#4f8f3c',
  fields: '#b5c766',
};
const ROAD_COLORS = ['', '#3a3c42', '#55575e', '#8a8173'];

/**
 * Draws the map. view: { cx, cz, radius, rotation, size, ctx, world, player, heading, pois, target, traffic, iconSize }
 */
export function drawMap(o) {
  const { ctx, size, cx, cz, radius, rotation, world } = o;
  const scale = size / (radius * 2);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#6ca04a';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  // world -> map: x maps to -x on screen (because +x is to the player's left when facing +z)
  ctx.scale(-1, -1);
  ctx.translate(-cx, -cz);
  const R = radius * 1.45;

  // Districts
  const d0x = Math.floor((cx - R) / DISTRICT);
  const d1x = Math.floor((cx + R) / DISTRICT);
  const d0z = Math.floor((cz - R) / DISTRICT);
  const d1z = Math.floor((cz + R) / DISTRICT);
  for (let a = d0x; a <= d1x; a++) {
    for (let b = d0z; b <= d1z; b++) {
      const d = world.district(a, b);
      ctx.fillStyle = DISTRICT_COLORS[d.type];
      ctx.fillRect(a * DISTRICT - 0.5, b * DISTRICT - 0.5, DISTRICT + 1, DISTRICT + 1);
    }
  }

  // Roads
  const i0 = Math.floor((cx - R) / CELL);
  const i1 = Math.ceil((cx + R) / CELL);
  const j0 = Math.floor((cz - R) / CELL);
  const j1 = Math.ceil((cz + R) / CELL);
  const minW = 2.2 / scale;
  ctx.lineCap = 'square';
  for (const pass of [0, 1]) {
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const h = world.segH(i, j);
        const v = world.segV(i, j);
        for (const [cls, x2, z2] of [[h, (i + 1) * CELL, j * CELL], [v, i * CELL, (j + 1) * CELL]]) {
          if (!cls) continue;
          if ((pass === 1) !== (cls === ROAD_MAIN)) continue;
          ctx.strokeStyle = ROAD_COLORS[cls];
          ctx.lineWidth = Math.max(ROAD_WIDTH[cls] * (radius > 600 ? 1.6 : 1), minW * (cls === ROAD_MAIN ? 1.5 : 1));
          ctx.beginPath();
          ctx.moveTo(i * CELL, j * CELL);
          ctx.lineTo(x2, z2);
          ctx.stroke();
        }
      }
    }
  }

  // Traffic
  if (o.traffic) {
    ctx.fillStyle = '#ffffff';
    const tr = 2.2 / scale;
    for (const p of o.traffic) {
      ctx.beginPath();
      ctx.arc(p.x, p.z, tr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Icons drawn upright in screen space
  const toScreen = (x, z) => {
    let dx = -(x - cx) * scale;
    let dz = -(z - cz) * scale;
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    return [size / 2 + dx * c - dz * s, size / 2 + dx * s + dz * c];
  };
  const iconSize = o.iconSize || 16;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.labels) {
    // One label per town, at the centre of its districts
    const towns = new Map();
    for (let a = d0x; a <= d1x; a++) {
      for (let b = d0z; b <= d1z; b++) {
        const d = world.district(a, b);
        if (d.type !== 'city' && d.type !== 'village') continue;
        const name = world.townName((a + 0.5) * DISTRICT, (b + 0.5) * DISTRICT);
        const t = towns.get(name) || { x: 0, z: 0, n: 0, city: false };
        t.x += (a + 0.5) * DISTRICT;
        t.z += (b + 0.5) * DISTRICT;
        t.n++;
        t.city ||= d.type === 'city';
        towns.set(name, t);
      }
    }
    for (const [name, t] of towns) {
      const [sx, sy] = toScreen(t.x / t.n, t.z / t.n);
      ctx.font = `800 ${Math.round(iconSize * (t.city ? 1.05 : 0.8))}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.fillStyle = '#fff';
      ctx.strokeText(name, sx, sy);
      ctx.fillText(name, sx, sy);
    }
  }
  for (const p of o.pois || []) {
    const [sx, sy] = toScreen(p.x, p.z);
    if (sx < -20 || sy < -20 || sx > size + 20 || sy > size + 20) continue;
    const info = SPECIAL_INFO[p.type];
    ctx.fillStyle = '#' + info.color.toString(16).padStart(6, '0');
    ctx.beginPath();
    ctx.arc(sx, sy, iconSize * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `${iconSize * 0.85}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(info.icon, sx, sy + 1);
  }

  // Mission target (clamped to the edge)
  if (o.target) {
    let [sx, sy] = toScreen(o.target.x, o.target.z);
    const mx = sx - size / 2;
    const my = sy - size / 2;
    const lim = size / 2 - 14;
    const len = Math.hypot(mx, my);
    const outside = len > lim;
    if (outside) {
      sx = size / 2 + (mx / len) * lim;
      sy = size / 2 + (my / len) * lim;
    }
    ctx.fillStyle = '#ff3d6e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, outside ? 8 : 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText('★', sx, sy + 1);
  }

  // Player arrow
  const [px, py] = toScreen(o.player.x, o.player.z);
  ctx.save();
  ctx.translate(px, py);
  // heading 0 = +z. Screen: +z maps to -y before rotation.
  ctx.rotate(rotation + Math.PI - o.heading);
  ctx.fillStyle = '#ffc928';
  ctx.strokeStyle = '#1b1b1f';
  ctx.lineWidth = 2;
  const a = o.size > 300 ? 11 : 8;
  ctx.beginPath();
  ctx.moveTo(0, a);
  ctx.lineTo(a * 0.75, -a * 0.8);
  ctx.lineTo(0, -a * 0.35);
  ctx.lineTo(-a * 0.75, -a * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
