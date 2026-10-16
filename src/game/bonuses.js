// Stunt bonuses: airtime, drifting and near misses.

export class Bonuses {
  constructor() {
    this.driftTime = 0;
    this.driftCalm = 0;
    this.wasAir = 0;
    this.nearCombo = 0;
    this.comboTimer = 0;
  }

  reset() {
    this.driftTime = 0;
    this.driftCalm = 0;
    this.wasAir = 0;
  }

  /**
   * Update with vehicle telemetry; returns list of awards {kind, coins, label, value}.
   * impact: collision speed this frame (cancels running drift).
   */
  update(dt, v, impact, nearMisses) {
    const out = [];
    // Airtime: award on landing
    if (v.contacts === 0) {
      this.wasAir = v.airTime;
    } else if (this.wasAir > 0) {
      const t = this.wasAir;
      this.wasAir = 0;
      if (t > 0.7 && impact < 9) {
        const coins = Math.round(4 + (t - 0.7) * 14);
        out.push({ kind: 'air', coins, label: t > 1.6 ? 'HUGE AIR' : 'BIG AIR', value: t });
      }
    }

    // Drift: sustained rear slip at speed
    const speed = Math.abs(v.speed);
    const drifting = v.contacts >= 3 && speed > 9 && v.slip > 3.2;
    if (impact > 4) {
      this.driftTime = 0;
    } else if (drifting) {
      this.driftTime += dt;
      this.driftCalm = 0;
    } else if (this.driftTime > 0) {
      this.driftCalm += dt;
      if (this.driftCalm > 0.35) {
        const t = this.driftTime;
        this.driftTime = 0;
        if (t > 1.0) {
          const coins = Math.round(2 + t * 3.5);
          out.push({ kind: 'drift', coins, label: t > 4 ? 'EPIC DRIFT' : 'DRIFT', value: t });
        }
      }
    }

    // Near misses build a combo
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.nearCombo = 0;
    for (let k = 0; k < nearMisses; k++) {
      this.nearCombo++;
      this.comboTimer = 4;
      const coins = 3 + Math.min(this.nearCombo - 1, 5) * 2;
      out.push({ kind: 'near', coins, label: this.nearCombo > 1 ? `NEAR MISS x${this.nearCombo}` : 'NEAR MISS', value: this.nearCombo });
    }
    return out;
  }

  /** Live drift time for the HUD meter. */
  get liveDrift() {
    return this.driftTime;
  }
}
