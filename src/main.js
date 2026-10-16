// World Drive - entry point and game loop.

import * as THREE from 'three';
import './style.css';
import { WorldGen, DISTRICT } from './world/worldgen.js';
import { ChunkManager } from './world/chunkManager.js';
import { VehiclePhysics } from './vehicle/vehiclePhysics.js';
import { collideStatic } from './vehicle/collision.js';
import { CAR_BY_ID, buildCarModel, buildSpec } from './vehicle/cars.js';
import { Coins } from './game/coins.js';
import { Traffic } from './game/traffic.js';
import { Bonuses } from './game/bonuses.js';
import { SaveGame } from './game/save.js';
import { missionPayout } from './game/missions.js';
import { Input } from './input/input.js';
import { AudioSystem } from './audio/audio.js';
import { Sky, SKY_HORIZON } from './render/sky.js';
import { CameraRig } from './render/cameraRig.js';
import { Markers, SPECIAL_INFO } from './render/markers.js';
import { UI } from './ui/ui.js';

const STEP = 1 / 120;
const SUN_DIR = new THREE.Vector3(0.4, 0.75, 0.3).normalize();
const QUALITY = {
  low: { radius: 4, lod0: 1, lod1: 2, shadows: false, shadowSize: 0, pixelRatio: 1, traffic: 6 },
  medium: { radius: 6, lod0: 2, lod1: 4, shadows: true, shadowSize: 1024, pixelRatio: 1.5, traffic: 10 },
  high: { radius: 8, lod0: 2, lod1: 5, shadows: true, shadowSize: 2048, pixelRatio: 2, traffic: 14 },
};
const ROAD_SURFACE = { grip: 1, roll: 0.015, road: true };
const OFFROAD_SURFACE = { grip: 0.8, roll: 0.045, road: false };

class Game {
  constructor() {
    this.save = new SaveGame();
    this.input = new Input();
    this.audio = new AudioSystem();
    this.state = 'title';
    this.bonuses = new Bonuses();
    this.events = [];

    // Renderer
    const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance' });
    this.renderer.domElement.id = 'game';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('app').prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 150, 400);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 2000);

    this.hemi = new THREE.HemisphereLight(0xd8ecff, 0x5d6b45, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target);

    this.sky = new Sky(this.scene);
    this.rig = new CameraRig(this.camera, null);
    this.ui = new UI(this);

    // Mission guidance: arrow above the car and a beacon at the destination.
    this.arrow = this._makeArrow();
    this.scene.add(this.arrow);
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, 400, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff3d6e, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.beacon.visible = false;
    this.scene.add(this.beacon);

    this._setupWorld();
    this.applySettings();

    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._persist();
        if (this.state === 'play') this.setPaused(true);
      }
    });
    window.addEventListener('beforeunload', () => this._persist());
    this._resize();

    this.ui.hideLoading();
    this.ui.showTitle(true);
    this._showroom('title');
    this.last = performance.now();
    this.acc = 0;
    this.saveTimer = 0;
    this.renderer.setAnimationLoop((t) => this._frame(t));
  }

  // ---------------------------------------------------------------- setup

  _setupWorld() {
    if (this.chunks) {
      this.chunks.clear();
      this.traffic.clear();
      this.markers.clear();
      this.coins.clear();
      this.scene.remove(this.coins.mesh, this.coins.sparkMesh);
      this.scene.remove(this.carModel.group, this.carModel.extras.glow);
      this.carModel.dispose();
    }
    const data = this.save.data;
    this.world = new WorldGen(data.seed);
    this.rig.world = this.world;
    this.coins = new Coins(this.scene);
    this.markers = new Markers(this.scene, this.world);
    this.chunks = new ChunkManager(this.world, this.scene, {
      onLoad: (c) => {
        this.coins.addChunk(c);
        for (const s of c.specials) this.markers.add(s);
      },
      onUnload: (c) => {
        this.coins.removeChunk(c);
        for (const s of c.specials) this.markers.remove(s);
      },
    });
    this.traffic = new Traffic(this.scene, this.world);

    const env = {
      groundHeight: (x, z) => this.world.groundHeight(x, z),
      groundNormal: (x, z, o) => this.world.groundNormal(x, z, o),
      surfaceAt: (x, z) => {
        if (this.world.roadAt(x, z)) return ROAD_SURFACE;
        OFFROAD_SURFACE.grip = this.player?.spec.offroad ?? 0.8;
        return OFFROAD_SURFACE;
      },
    };
    const car = CAR_BY_ID[this.save.carId] || CAR_BY_ID.hatch;
    this.player = new VehiclePhysics(env, buildSpec(car, this.save.carState.upgrades));
    this.carModel = null;
    this._buildCarModel(car.id, this.save.carState.look);

    const spawn = data.position || this.world.findSpawn();
    this.spawn = this.world.findSpawn();
    this.chunks.setQuality(QUALITY[data.settings.quality]);
    this.chunks.warmup(spawn.x, spawn.z);
    this.player.reset(spawn.x, spawn.z, spawn.heading);
    this.rig.initialised = false;
    this.rig.mode = data.settings.camera || 0;
    this.lastDistrict = null;
    this.lastTown = null;
    this.flipTimer = 0;
    this.bonuses.reset();
  }

  _buildCarModel(id, look) {
    if (this.carModel) {
      this.scene.remove(this.carModel.group);
      this.scene.remove(this.carModel.extras.glow);
      this.carModel.dispose();
    }
    this.carModel = buildCarModel(CAR_BY_ID[id], look || {});
    this.carModel.group.traverse((o) => {
      if (o.isMesh) o.castShadow = this.chunks ? this.chunks.shadows : true;
    });
    this.scene.add(this.carModel.group);
    this.scene.add(this.carModel.extras.glow);
  }

  _makeArrow() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xff3d6e, emissive: 0x661030 });
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.6;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 1), mat);
    shaft.position.z = -0.3;
    g.add(head, shaft);
    g.visible = false;
    return g;
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applySettings() {
    const s = this.save.data.settings;
    const q = QUALITY[s.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.chunks.setQuality(q);
    this.carModel.group.traverse((o) => {
      if (o.isMesh) o.castShadow = q.shadows;
    });
    const range = q.radius * 64;
    this.scene.fog.near = range * 0.35;
    this.scene.fog.far = range * 0.92;
    this.traffic.setMax(q.traffic);
    this.audio.setVolumes(s.sfx, s.music);
    this.save.emit();
    this.save.save();
    // force material recompile for shadow changes
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- state changes

  start(newWorld = false) {
    this.audio.start();
    this.audio.setVolumes(this.save.data.settings.sfx, this.save.data.settings.music);
    if (newWorld) {
      this.save.reset((Math.random() * 2 ** 31) | 0);
      this._setupWorld();
      this.applySettings();
    }
    this.ui.showTitle(false);
    this.ui.showHUD(true);
    this.ui.showPause(false);
    this.rig.showroom = false;
    this.rig.initialised = false;
    this.state = 'play';
    this.input.enabled = true;
    this.audio.suspend(false);
    this.ui.updateCoins();
    if (!this.save.hasProgress) {
      setTimeout(() => this.ui.toast('<span class="big">Welcome!</span>Collect coins, pull stunts and deliver cargo.<br>Visit 🚗 dealers, 🔧 tuners and 🎨 paint shops.', 5500), 600);
    }
  }

  toTitle() {
    this._persist();
    this.state = 'title';
    this.ui.showPause(false);
    this.ui.showHUD(false);
    this.ui.showTitle(true);
    this._showroom('title');
    this.audio.suspend(true);
  }

  setPaused(p) {
    if (this.state !== 'play' && this.state !== 'pause') return;
    this.state = p ? 'pause' : 'play';
    this.ui.showPause(p);
    this.audio.suspend(p);
    if (p) this._persist();
  }

  toggleMap() {
    if (this.state === 'map') {
      this.state = 'play';
      this.ui.toggleBigMap(false);
      this.audio.suspend(false);
    } else if (this.state === 'play') {
      this.state = 'map';
      this.ui.toggleBigMap(true);
      this.audio.suspend(true);
    }
  }

  openShop(sp) {
    this.state = 'shop';
    this.shopSpecial = sp;
    this.player.vel.set(0, 0, 0);
    this.player.angVel.set(0, 0, 0);
    this._showroom('shop');
    this.audio.suspend(true);
    this.audio.click();
    this.ui.setPrompt(null);
    document.body.classList.add('in-shop');
    this.ui.showShop(sp);
  }

  closeShop() {
    if (this.state !== 'shop') return;
    this.state = 'play';
    this.shopSpecial = null;
    this.rig.showroom = false;
    this.rig.initialised = false;
    this.applyCar();
    this.ui.showShop(null);
    document.body.classList.remove('in-shop');
    this.audio.suspend(false);
    this.audio.click();
    this._persist();
  }

  _showroom(kind) {
    this.rig.showroom = true;
    this.rig.initialised = false;
    this.rig.orbitDist = kind === 'title' ? 13 : 7.5;
    this.rig.orbitHeight = kind === 'title' ? 5.5 : 2.6;
  }

  previewCar(id) {
    const look = this.save.owns(id) ? this.save.data.owned[id].look : {};
    this._buildCarModel(id, look);
  }

  previewLook(look) {
    this.carModel.setLook(look || this.save.carState.look);
  }

  /** Rebuild player car from save state (after buy/select/upgrade). */
  applyCar() {
    const car = CAR_BY_ID[this.save.carId];
    this._buildCarModel(car.id, this.save.carState.look);
    this.player.setSpec(buildSpec(car, this.save.carState.upgrades));
  }

  acceptMission(offer) {
    this.save.data.mission = { ...offer, elapsed: 0 };
    this.save.emit();
    this.save.save();
    this.audio.bonus();
    this.closeShop();
    this.ui.toast(`<span class="big">📦 ${offer.cargo}</span>Deliver to ${offer.to.name} Depot (${(offer.distance / 1000).toFixed(1)} km)`, 3500);
  }

  cancelMission() {
    this.save.data.mission = null;
    this.save.emit();
    this.save.save();
  }

  resetCar() {
    // Put the car back on the nearest road, upright.
    const p = this.player.pos;
    const i = Math.round(p.x / 64);
    const j = Math.round(p.z / 64);
    let best = null;
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        const arms = this.world.nodeArms(i + a, j + b);
        if (!(arms.e || arms.w || arms.n || arms.s)) continue;
        const x = (i + a) * 64;
        const z = (j + b) * 64;
        const d = Math.hypot(x - p.x, z - p.z);
        if (!best || d < best.d) best = { x, z, d, heading: arms.n ? 0 : arms.e ? Math.PI / 2 : arms.s ? Math.PI : -Math.PI / 2 };
      }
    }
    if (best && best.d < 220) {
      // a bit away from the intersection centre, along the road
      this.player.reset(best.x + Math.sin(best.heading) * 8, best.z + Math.cos(best.heading) * 8, best.heading);
    } else {
      this.player.reset(p.x, p.z, this.player.heading);
    }
    this.rig.initialised = false;
    this.bonuses.reset();
  }

  getMapView() {
    const p = this.player.pos;
    const m = this.save.data.mission;
    return {
      world: this.world,
      cx: p.x,
      cz: p.z,
      player: p,
      heading: this.player.heading,
      target: m ? m.to : null,
    };
  }

  _persist() {
    if (!this.player) return;
    const p = this.player.pos;
    if (Number.isFinite(p.x) && this.state !== 'title') this.save.data.position = { x: p.x, z: p.z, heading: this.player.heading };
    this.save.save();
  }

  // ---------------------------------------------------------------- frame

  _frame(t) {
    const dt = Math.min((t - this.last) / 1000, 0.1);
    this.last = t;
    const inp = this.input;

    // Global actions
    if (inp.consume('pause')) {
      if (this.state === 'shop') this.closeShop();
      else if (this.state === 'map') this.toggleMap();
      else if (this.state === 'play' || this.state === 'pause') this.setPaused(this.state === 'play');
    }
    if (inp.consume('map')) this.toggleMap();
    if (inp.consume('music')) {
      const on = this.audio.toggleMusic();
      this.ui.feed(on ? '🎵 Music on' : '🎵 Music off');
    }
    if (this.state === 'play') {
      if (inp.consume('camera')) {
        const name = this.rig.cycle();
        this.save.data.settings.camera = this.rig.mode;
        this.ui.feed(`🎥 ${name}`);
      }
      if (inp.consume('reset')) this.resetCar();
      if (inp.consume('horn')) this.audio.horn();
    }
    const wantInteract = inp.consume('interact');
    inp.clearActions();

    if (this.state === 'play') this._updatePlay(dt, wantInteract);
    else if (this.state === 'title') {
      this.player.input = { throttle: 0, brake: 0, steer: 0, handbrake: 1, pitch: 0, roll: 0 };
      this.acc += dt;
      while (this.acc >= STEP) {
        this.player.step(STEP);
        this.acc -= STEP;
      }
    }

    this.chunks.update(this.player.pos.x, this.player.pos.z, this.state === 'play' ? 6 : 10);
    this._syncCar();
    this.rig.update(dt, this.player);
    this.sky.update(dt, this.camera.position);
    const p = this.player.pos;
    this.sun.position.set(p.x + SUN_DIR.x * 150, p.y + SUN_DIR.y * 150, p.z + SUN_DIR.z * 150);
    this.sun.target.position.copy(p);
    this.markers.update(dt, this.nearSpecial?.id, this.shopSpecial?.id);
    if (this.state !== 'play') this.coins.update(dt, { x: 1e9, y: 0, z: 1e9 });

    this.renderer.render(this.scene, this.camera);
  }

  _updatePlay(dt, wantInteract) {
    const v = this.player;
    v.input = this.input.read(dt);
    this.acc += dt;
    let impact = 0;
    let steps = 0;
    const cols = [];
    while (this.acc >= STEP && steps < 8) {
      v.step(STEP);
      this.chunks.collidersNear(v.pos.x, v.pos.z, cols);
      impact = Math.max(impact, collideStatic(v, cols));
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    impact = Math.max(impact, v.lastImpact * 0.5);
    v.lastImpact = 0;

    // Traffic
    this.events.length = 0;
    this.traffic.update(dt, v, v.vel, this.events);
    let nearMisses = 0;
    for (const e of this.events) {
      if (e.type === 'nearmiss') nearMisses++;
      if (e.type === 'traffichit') impact = Math.max(impact, e.speed);
    }
    if (impact > 3) {
      this.audio.crash(impact);
      this.rig.addShake(Math.min(1, impact / 12));
    }

    // Coins
    const got = this.coins.update(dt, v.pos);
    if (got > 0) {
      this.save.addCoins(got);
      this.audio.coin(got);
    }

    // Stunts
    const st = this.save.data.stats;
    for (const a of this.bonuses.update(dt, v, impact, nearMisses)) {
      this.save.addCoins(a.coins);
      if (a.kind === 'near') {
        st.nearMisses++;
        this.audio.whoosh();
      } else this.audio.bonus();
      if (a.kind === 'air') st.bestAir = Math.max(st.bestAir, a.value);
      if (a.kind === 'drift') st.bestDrift = Math.max(st.bestDrift, a.value);
      const extra = a.kind === 'air' ? ` ${a.value.toFixed(1)}s` : a.kind === 'drift' ? ` ${a.value.toFixed(1)}s` : '';
      this.ui.feed(`${a.label}${extra} <b>+${a.coins}</b>`, a.kind === 'near' ? '#3fa7d6' : a.kind === 'air' ? '#3ddc84' : '#ff8a1f');
    }
    st.distance += Math.hypot(v.vel.x, v.vel.z) * dt;

    // Recover from being stuck upside down or falling through the world
    if (v.up().y < 0.35 && v.vel.length() < 3) this.flipTimer += dt;
    else this.flipTimer = 0;
    if (this.flipTimer > 2.5 || v.pos.y < this.world.terrainHeight(v.pos.x, v.pos.z) - 8 || !Number.isFinite(v.pos.x)) {
      this.flipTimer = 0;
      if (!Number.isFinite(v.pos.x)) v.reset(this.spawn.x, this.spawn.z, this.spawn.heading);
      else this.resetCar();
      this.ui.feed('↺ Car recovered');
    }

    // Shops and depots
    const mission = this.save.data.mission;
    const pois = this.world.poisNear(v.pos.x, v.pos.z, 12);
    let near = null;
    for (const sp of pois) {
      const d = Math.hypot(sp.x - v.pos.x, sp.z - v.pos.z);
      if (d < 5.5 && (!near || d < near.d)) near = { sp, d };
    }
    this.nearSpecial = near ? near.sp : null;
    if (mission && near && near.sp.id === mission.to.id) {
      this._completeMission(mission);
    } else if (near) {
      const label = SPECIAL_INFO[near.sp.type].label;
      if (Math.abs(v.speed) > 7) this.ui.setPrompt(`Slow down to enter ${label}`);
      else {
        this.ui.setPrompt(`Enter ${label}`);
        if (wantInteract) this.openShop(near.sp);
      }
    } else this.ui.setPrompt(null);

    // Mission tracking
    let missionView = null;
    if (this.save.data.mission) {
      const m = this.save.data.mission;
      m.elapsed += dt;
      const dist = Math.hypot(m.to.x - v.pos.x, m.to.z - v.pos.z);
      missionView = { ...m, dist };
      this.arrow.visible = true;
      this.arrow.position.set(v.pos.x, v.pos.y + 2.8 + Math.sin(performance.now() / 300) * 0.1, v.pos.z);
      this.arrow.rotation.y = Math.atan2(m.to.x - v.pos.x, m.to.z - v.pos.z);
      this.beacon.visible = true;
      this.beacon.position.set(m.to.x, this.world.terrainHeight(m.to.x, m.to.z) + 200, m.to.z);
    } else {
      this.arrow.visible = false;
      this.beacon.visible = false;
    }

    // Town announcements
    const dx = Math.floor(v.pos.x / DISTRICT);
    const dz = Math.floor(v.pos.z / DISTRICT);
    const dkey = `${dx},${dz}`;
    if (dkey !== this.lastDistrict) {
      this.lastDistrict = dkey;
      const d = this.world.district(dx, dz);
      if (d.type === 'city' || d.type === 'village') {
        const name = this.world.townName(v.pos.x, v.pos.z);
        if (name !== this.lastTown) {
          this.lastTown = name;
          this.ui.showLocation(name, d.type === 'city' ? 'CITY' : 'VILLAGE');
        }
      } else this.lastTown = null;
    }

    // HUD & audio
    this.ui.updateHUD(dt, v, this.bonuses.liveDrift, missionView);
    const pois2 = this.world.poisNear(v.pos.x, v.pos.z, 320);
    this.ui.drawMinimap(dt, { ...this.getMapView(), pois: pois2, traffic: this.traffic.positions() });
    this.audio.updateEngine(v, v.input.throttle, v.spec.maxSpeed);

    this.saveTimer += dt;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      this._persist();
    }
  }

  _completeMission(m) {
    const bonus = this.player.spec.deliveryBonus || 0;
    const pay = missionPayout(m, m.elapsed, bonus);
    this.save.data.mission = null;
    this.save.data.stats.deliveries++;
    this.save.addCoins(pay.total);
    this.save.save();
    this.audio.purchase();
    const parts = [`Delivery <b>+${pay.base}</b>`];
    if (pay.timeBonus) parts.push(`On time <b>+${pay.timeBonus}</b>`);
    if (pay.carBonus) parts.push(`Van bonus <b>+${pay.carBonus}</b>`);
    this.ui.toast(`<span class="big">📦 Delivered! +${pay.total}</span>${parts.join(' · ')}`, 4000);
  }

  _syncCar() {
    const v = this.player;
    const m = this.carModel;
    m.group.position.copy(v.pos);
    m.group.quaternion.copy(v.quat);
    const s = v.spec;
    for (let k = 0; k < 4; k++) {
      const w = v.wheels[k];
      const mw = m.wheels[k];
      mw.pivot.position.y = s.hardpointY - w.length;
      mw.pivot.rotation.y = w.front ? v.steerAngle : 0;
      mw.spin.rotation.x = w.spin;
    }
    const glow = m.extras.glow;
    if (glow.visible) {
      glow.position.set(v.pos.x, this.world.groundHeight(v.pos.x, v.pos.z) + 0.12, v.pos.z);
      glow.rotation.set(-Math.PI / 2, 0, v.heading);
      glow.material.opacity = 0.45 + Math.sin(performance.now() / 250) * 0.08;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.game = new Game();
  } catch (err) {
    console.error(err);
    const l = document.getElementById('loading');
    l.innerHTML = `<div style="max-width:420px;text-align:center;padding:20px">Sorry, World Drive could not start.<br><small>${String(err.message || err)}</small><br><small>A browser with WebGL support is required.</small></div>`;
  }
});
