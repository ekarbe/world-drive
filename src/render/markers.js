// Glowing zones and floating signs for shops and delivery depots.

import * as THREE from 'three';

export const SPECIAL_INFO = {
  dealer: { icon: '🚗', label: 'Car Dealer', color: 0x2b7de9 },
  tuning: { icon: '🔧', label: 'Tuning Shop', color: 0xff8a1f },
  paint: { icon: '🎨', label: 'Paint Shop', color: 0xe83e8c },
  depot: { icon: '📦', label: 'Delivery Depot', color: 0xf2c230 },
};

const texCache = new Map();

function signTexture(type, name) {
  const key = `${type}:${name}`;
  if (texCache.has(key)) return texCache.get(key);
  const info = SPECIAL_INFO[type];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d');
  const col = '#' + info.color.toString(16).padStart(6, '0');
  g.fillStyle = 'rgba(20,24,32,0.85)';
  roundRect(g, 8, 8, 240, 144, 22);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = col;
  g.stroke();
  g.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(info.icon, 128, 62);
  g.font = 'bold 26px system-ui, sans-serif';
  g.fillStyle = '#fff';
  g.fillText(info.label, 128, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Markers {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = new Map();
    this.beamGeo = new THREE.CylinderGeometry(4.6, 4.6, 2.4, 28, 1, true);
    this.ringGeo = new THREE.RingGeometry(4.2, 4.8, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.beamTex = beamTexture();
    this.time = 0;
  }

  add(sp) {
    if (this.items.has(sp.id)) return;
    const info = SPECIAL_INFO[sp.type];
    const group = new THREE.Group();
    const y = this.world.terrainHeight(sp.x, sp.z);
    group.position.set(sp.x, y, sp.z);
    const beam = new THREE.Mesh(
      this.beamGeo,
      new THREE.MeshBasicMaterial({ color: info.color, map: this.beamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 1.2;
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.25;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(sp.type, sp.name), depthWrite: false }));
    sprite.scale.set(8, 5, 1);
    const by = this.world.terrainHeight(sp.bx, sp.bz);
    sprite.position.set(sp.bx - sp.x, by - y + 14, sp.bz - sp.z);
    group.add(beam, ring, sprite);
    this.scene.add(group);
    this.items.set(sp.id, { sp, group, beam, ring, sprite });
  }

  remove(sp) {
    const it = this.items.get(sp.id);
    if (!it) return;
    this.scene.remove(it.group);
    it.beam.material.dispose();
    it.ring.material.dispose();
    it.sprite.material.dispose();
    this.items.delete(sp.id);
  }

  update(dt, highlightId, hiddenId = null) {
    this.time += dt;
    for (const it of this.items.values()) {
      it.beam.visible = it.ring.visible = it.sp.id !== hiddenId;
      const pulse = 1 + Math.sin(this.time * 3) * 0.05;
      it.ring.scale.setScalar(it.sp.id === highlightId ? pulse * 1.06 : pulse);
      it.beam.material.opacity = it.sp.id === highlightId ? 1 : 0.65;
      it.sprite.position.y += Math.sin(this.time * 1.5) * 0.004;
    }
  }

  clear() {
    for (const it of [...this.items.values()]) this.remove(it.sp);
  }
}
