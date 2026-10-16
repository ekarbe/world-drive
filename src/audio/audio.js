// All sound is synthesised with WebAudio: no audio files to download.

import { Music } from './music.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.sfxVol = 0.8;
    this.musicVol = 0.5;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.started) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVol * 0.55;
    this.musicGain.connect(this.master);
    this.noiseBuf = this._noiseBuffer(2);
    this._setupEngine();
    this.music = new Music(ctx, this.musicGain, this.noiseBuf);
    this.music.start();
    this.started = true;
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
    this.musicGain.gain.setTargetAtTime(music * 0.55, t, 0.05);
  }

  suspend(paused) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.engineOut.gain.setTargetAtTime(paused ? 0 : 1, t, 0.05);
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = loop;
    return src;
  }

  _setupEngine() {
    const ctx = this.ctx;
    this.engineOut = ctx.createGain();
    this.engineOut.gain.value = 1;
    this.engineOut.connect(this.sfx);

    // Engine: two detuned oscillators through a low-pass filter
    this.eFilter = ctx.createBiquadFilter();
    this.eFilter.type = 'lowpass';
    this.eFilter.frequency.value = 600;
    this.eFilter.Q.value = 3;
    this.eGain = ctx.createGain();
    this.eGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.eFilter);
    this.osc2.connect(g2).connect(this.eFilter);
    this.eFilter.connect(this.eGain).connect(this.engineOut);
    this.osc1.start();
    this.osc2.start();

    // Tyre screech: band-passed noise
    const sn = this._noise();
    this.sFilter = ctx.createBiquadFilter();
    this.sFilter.type = 'bandpass';
    this.sFilter.frequency.value = 1400;
    this.sFilter.Q.value = 6;
    this.sGain = ctx.createGain();
    this.sGain.gain.value = 0;
    sn.connect(this.sFilter).connect(this.sGain).connect(this.engineOut);
    sn.start();

    // Wind / road rumble
    const wn = this._noise();
    this.wFilter = ctx.createBiquadFilter();
    this.wFilter.type = 'lowpass';
    this.wFilter.frequency.value = 400;
    this.wGain = ctx.createGain();
    this.wGain.gain.value = 0;
    wn.connect(this.wFilter).connect(this.wGain).connect(this.engineOut);
    wn.start();
  }

  /** Called every frame with vehicle telemetry. */
  updateEngine(v, throttle, maxSpeed) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const speed = Math.abs(v.speed);
    const gears = 5;
    const gearSpan = maxSpeed / gears;
    const gear = Math.min(gears - 1, Math.floor(speed / gearSpan));
    let frac = (speed - gear * gearSpan) / gearSpan;
    if (gear > 0) frac = 0.35 + frac * 0.65;
    const airborne = v.contacts === 0;
    const rpm = Math.min(1.1, 0.12 + frac * 0.88 + (airborne && throttle > 0.1 ? 0.25 : 0));
    const f = 38 + rpm * 120;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5 * 1.01, t, 0.04);
    this.eFilter.frequency.setTargetAtTime(300 + rpm * 900 + throttle * 600, t, 0.05);
    this.eGain.gain.setTargetAtTime(0.06 + throttle * 0.07 + rpm * 0.03, t, 0.05);
    const screech = v.contacts > 1 ? Math.max(0, Math.min(1, (v.slip - 2.5) / 6)) * Math.min(1, speed / 6) : 0;
    this.sGain.gain.setTargetAtTime(screech * 0.12, t, 0.05);
    this.sFilter.frequency.setTargetAtTime(1200 + screech * 500, t, 0.1);
    const wind = Math.min(1, speed / 60);
    this.wGain.gain.setTargetAtTime(wind * wind * 0.12 + (v.onRoad ? 0 : Math.min(speed / 20, 1) * 0.05), t, 0.1);
    this.wFilter.frequency.setTargetAtTime(v.onRoad ? 300 + wind * 700 : 160 + wind * 300, t, 0.1);
  }

  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _tone(freq, type, start, dur, vol, dest = this.sfx) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, start, 0.005, vol, dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.05);
    return o;
  }

  coin(n = 1) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const base = 988 * Math.pow(2, Math.min(n - 1, 6) / 12);
    this._tone(base, 'square', t, 0.08, 0.05);
    this._tone(base * 1.335, 'square', t + 0.07, 0.18, 0.05);
  }

  bonus() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, k) => this._tone(f, 'triangle', t + k * 0.06, 0.25, 0.09));
  }

  purchase() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    [392, 494, 587, 784, 988].forEach((f, k) => this._tone(f, 'square', t + k * 0.05, 0.3, 0.05));
  }

  error() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this._tone(180, 'square', t, 0.15, 0.06);
    this._tone(140, 'square', t + 0.12, 0.2, 0.06);
  }

  click() {
    if (!this.started) return;
    this._tone(1400, 'sine', this.ctx.currentTime, 0.04, 0.05);
  }

  crash(strength) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.min(1, strength / 15);
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + s * 1600;
    const g = ctx.createGain();
    this._env(g, t, 0.003, 0.25 + s * 0.4, 0.25 + s * 0.3);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + 0.7);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g2 = ctx.createGain();
    this._env(g2, t, 0.003, 0.3 + s * 0.4, 0.3);
    o.connect(g2).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
  }

  whoosh() {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2500, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    const g = ctx.createGain();
    this._env(g, t, 0.08, 0.35, 0.45);
    n.connect(f).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + 0.7);
  }

  horn() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    for (const f of [415, 523]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g.gain.setValueAtTime(0.06, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  toggleMusic() {
    if (!this.music) return false;
    return this.music.toggle();
  }
}
