/**
 * Measures an incoming 24 PPQN MIDI Clock stream.
 *
 * This is never the source of musical time: incoming pulses themselves
 * advance Feelers' position. The estimator only supplies
 *  - `periodMs()`: a short-window pulse period, used to place events that fall
 *    *between* two pulses (fractional ticks from Time Adjust or articulation);
 *  - `bpm()`: a longer-window, jitter-resistant tempo for display.
 */
import { PPQ } from '../engine/types';

/** Intervals used to place fractional events (responsive to tempo changes). */
const SHORT = 6;
/** Intervals used for the displayed tempo (two beats). */
const LONG = 48;
/** An interval this many times the running period starts a new measurement. */
const GAP_FACTOR = 4;

export class PulseEstimator {
  private times: number[] = [];
  private shown: number | null = null;

  /** Record a pulse arriving at `t` (ms). */
  add(t: number): void {
    const last = this.times[this.times.length - 1];
    if (last !== undefined) {
      const dt = t - last;
      const p = this.periodMs();
      // A long silence (clock stopped and restarted) is not a slow tempo.
      if (dt <= 0 || dt > 1000 || (p !== null && dt > p * GAP_FACTOR)) this.times = [];
    }
    this.times.push(t);
    if (this.times.length > LONG + 1) this.times.splice(0, this.times.length - (LONG + 1));
  }

  reset(): void {
    this.times = [];
    this.shown = null;
  }

  /** Mean of the last few pulse intervals, or null with fewer than two pulses. */
  periodMs(): number | null {
    const n = Math.min(SHORT, this.times.length - 1);
    if (n < 1) return null;
    const a = this.times[this.times.length - 1 - n]!;
    const b = this.times[this.times.length - 1]!;
    return (b - a) / n;
  }

  /**
   * Tempo over up to two beats, or null until a quarter beat has been seen.
   * The period is the least-squares slope of arrival time against pulse
   * number, which averages out per-pulse timestamp jitter far better than
   * comparing the first and last pulse.
   */
  rawBpm(): number | null {
    const n = this.times.length;
    if (n - 1 < PPQ / 4) return null;
    const t0 = this.times[0]!;
    const mx = (n - 1) / 2;
    let my = 0;
    for (const t of this.times) my += t - t0;
    my /= n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - mx;
      sxy += dx * (this.times[i]! - t0 - my);
      sxx += dx * dx;
    }
    const p = sxy / sxx;
    return p > 0 ? 60000 / (p * PPQ) : null;
  }

  /**
   * Tempo for display. Moves only when the measurement differs from what is
   * shown by more than the jitter it is likely to contain, so the number does
   * not flicker; real tempo changes come through within about a beat.
   */
  bpm(): number | null {
    const raw = this.rawBpm();
    if (raw === null) {
      this.shown = null;
      return null;
    }
    const tolerance = Math.max(0.15, raw * 0.002);
    if (this.shown === null || Math.abs(raw - this.shown) > tolerance) this.shown = Math.round(raw * 10) / 10;
    return this.shown;
  }
}
