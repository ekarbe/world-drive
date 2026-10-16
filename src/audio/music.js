// Generative lo-fi driving music: chord pads, bass, soft drums and a sparse pentatonic melody.
// Scheduled ahead of time with the WebAudio clock.

const PROGRESSIONS = [
  // semitone offsets from the key root for 4-note chords
  [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]], // Imaj7 vi7 ii7 V7
  [[0, 4, 7, 11], [5, 9, 12, 16], [9, 12, 16, 19], [7, 11, 14, 17]], // I IV vi V
  [[9, 12, 16, 19], [5, 9, 12, 16], [0, 4, 7, 11], [7, 11, 14, 17]], // vi IV I V
];
const PENTA = [0, 2, 4, 7, 9];
const KEYS = [57, 60, 62, 55, 53]; // MIDI roots: A3 C4 D4 G3 F3

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(ctx, out, noiseBuf) {
    this.ctx = ctx;
    this.out = out;
    this.noiseBuf = noiseBuf;
    this.bpm = 84;
    this.step = 0; // 16th notes
    this.nextTime = 0;
    this.enabled = true;
    this.timer = null;
    this._newSong();
    // gentle lo-fi colouring
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.bus.connect(lp).connect(out);
    // simple feedback delay for space
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    this.send = ctx.createGain();
    this.send.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(lp);
  }

  _newSong() {
    this.prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    this.root = KEYS[Math.floor(Math.random() * KEYS.length)];
    this.bars = 0;
    this.lastNote = 2;
  }

  start() {
    this.nextTime = this.ctx.currentTime + 0.2;
    this.timer = setInterval(() => this._schedule(), 100);
  }

  toggle() {
    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(this.enabled ? 1 : 0, t, 0.3);
    return this.enabled;
  }

  _schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const spb = 60 / this.bpm / 4;
    // swing
    while (this.nextTime < ctx.currentTime + 0.4) {
      const sw = this.step % 2 === 1 ? spb * 0.18 : 0;
      this._playStep(this.step, this.nextTime + sw);
      this.nextTime += spb;
      this.step++;
      if (this.step % 16 === 0) {
        this.bars++;
        if (this.bars >= 32) this._newSong();
      }
    }
  }

  _playStep(step, t) {
    if (!this.enabled) return;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = this.prog[bar % 4];
    const sectionB = Math.floor(bar / 8) % 2 === 1;
    if (s16 === 0) this._pad(chord, t, (60 / this.bpm) * 4);
    // bass
    if (s16 === 0 || s16 === 10 || (sectionB && s16 === 7)) this._bass(this.root - 24 + chord[0], t, 0.45);
    // drums
    if (s16 === 0 || s16 === 10 || (s16 === 7 && sectionB)) this._kick(t);
    if (s16 === 4 || s16 === 12) this._snare(t);
    if (s16 % 2 === 0) this._hat(t, s16 % 4 === 2 ? 0.05 : 0.03);
    // melody
    if (s16 % 2 === 0 && Math.random() < (sectionB ? 0.38 : 0.22)) {
      const move = Math.floor(Math.random() * 5) - 2;
      this.lastNote = Math.max(0, Math.min(9, this.lastNote + move));
      const oct = Math.floor(this.lastNote / 5);
      const note = this.root + 12 + PENTA[this.lastNote % 5] + oct * 12;
      this._lead(note, t, Math.random() < 0.3 ? 0.5 : 0.25);
    }
  }

  _pad(chord, t, dur) {
    const ctx = this.ctx;
    for (const n of chord) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(this.root + n);
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.4);
      g.gain.setValueAtTime(0.035, t + dur - 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  _bass(m, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _lead(m, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(m);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(m) * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.bus);
    g.connect(this.send);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.4);
    o2.stop(t + dur + 0.4);
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.35);
  }

  _snare(t) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(f).connect(g).connect(this.bus);
    n.start(t, Math.random());
    n.stop(t + 0.2);
  }

  _hat(t, vol) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f).connect(g).connect(this.bus);
    n.start(t, Math.random());
    n.stop(t + 0.07);
  }
}
