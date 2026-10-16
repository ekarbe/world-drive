// Unified input: keyboard, gamepad and on-screen touch controls.

const KEYMAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, left: 0, right: 0, handbrake: 0 };
    this.pressed = new Set(); // one-shot actions this frame
    this.steer = 0;
    this.usingTouch = false;
    this.gamepadIndex = null;
    this._padPrev = {};
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this._action(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => (this.gamepadIndex = e.gamepad.index));
    window.addEventListener('gamepaddisconnected', () => (this.gamepadIndex = null));
  }

  _action(code) {
    const map = {
      KeyC: 'camera',
      KeyR: 'reset',
      KeyE: 'interact',
      Enter: 'interact',
      KeyM: 'map',
      Escape: 'pause',
      KeyP: 'pause',
      KeyH: 'horn',
      KeyN: 'music',
    };
    if (map[code]) this.pressed.add(map[code]);
  }

  /** Trigger an action from UI buttons. */
  trigger(action) {
    this.pressed.add(action);
  }

  consume(action) {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  clearActions() {
    this.pressed.clear();
  }

  _key(name) {
    return KEYMAP[name].some((k) => this.keys.has(k)) ? 1 : 0;
  }

  /** Reads all devices and returns the vehicle control state. */
  read(dt) {
    let throttle = Math.max(this._key('throttle'), this.touch.throttle);
    let brake = Math.max(this._key('brake'), this.touch.brake);
    let handbrake = Math.max(this._key('handbrake'), this.touch.handbrake);
    let steerDigital = this._key('right') - this._key('left') + this.touch.right - this.touch.left;
    let steerAnalog = null;
    let pitch = this._key('throttle') - this._key('brake');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : [...pads].find((p) => p);
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steerAnalog = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
      const rt = pad.buttons[7]?.value || 0;
      const lt = pad.buttons[6]?.value || 0;
      throttle = Math.max(throttle, rt, pad.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt);
      handbrake = Math.max(handbrake, pad.buttons[2]?.pressed || pad.buttons[5]?.pressed ? 1 : 0);
      const ay = pad.axes[1] || 0;
      if (Math.abs(ay) > 0.3) pitch = -ay;
      const btn = (i, action) => {
        const p = !!pad.buttons[i]?.pressed;
        if (p && !this._padPrev[i]) this.pressed.add(action);
        this._padPrev[i] = p;
      };
      btn(3, 'camera');
      btn(1, 'interact');
      btn(9, 'pause');
      btn(8, 'map');
      btn(4, 'reset');
    }

    // Smooth digital steering so keyboard feels analogue.
    if (steerAnalog != null) {
      this.steer = steerAnalog;
    } else {
      const target = Math.max(-1, Math.min(1, steerDigital));
      const rate = target === 0 ? 6 : Math.sign(target) !== Math.sign(this.steer) ? 9 : 4.5;
      const d = target - this.steer;
      this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: 1, pitch: 0, roll: 0 };
    return { throttle, brake, steer: this.steer, handbrake, pitch, roll: 0 };
  }
}
