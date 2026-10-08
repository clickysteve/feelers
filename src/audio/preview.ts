/**
 * Built-in audio preview.
 *
 * A tiny Web Audio synth that listens to the same MIDI byte stream sent to
 * the hardware output (via a MidiOutput tap). It never feeds back into the
 * engine or scheduler: the MIDI stream is the musical truth, and the preview
 * is just one more listener. Channels 1-16 map to four simple timbres.
 */

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  key: number;
  endAt: number;
}

const TIMBRES: { type: OscillatorType; attack: number; release: number; level: number }[] = [
  { type: 'triangle', attack: 0.005, release: 0.12, level: 0.22 },
  { type: 'sawtooth', attack: 0.004, release: 0.08, level: 0.1 },
  { type: 'sine', attack: 0.002, release: 0.35, level: 0.25 },
  { type: 'square', attack: 0.02, release: 0.25, level: 0.07 },
];

export class AudioPreview {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice[]>();
  enabled = false;
  volume = 0.7;

  /** Must be called from a user gesture (browser autoplay rules). */
  async enable(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
      }
      await this.ctx.resume();
      this.enabled = true;
      return true;
    } catch {
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
    this.silence();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** performance.now() milliseconds to AudioContext seconds. */
  private toCtxTime(ms: number): number {
    const ctx = this.ctx!;
    return Math.max(ctx.currentTime, ctx.currentTime + (ms - performance.now()) / 1000);
  }

  /** MidiOutput tap. */
  handle = (bytes: number[], timestampMs: number): void => {
    if (!this.enabled || !this.ctx || !this.master) return;
    const [status = 0, d1 = 0, d2 = 0] = bytes;
    const type = status & 0xf0;
    const ch = status & 0x0f;
    const at = this.toCtxTime(timestampMs);
    if (type === 0x90 && d2 > 0) this.noteOn(ch, d1, d2, at);
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) this.noteOff(ch, d1, at);
    else if (type === 0xb0 && (d1 === 123 || d1 === 120)) this.silence();
  };

  private noteOn(ch: number, note: number, vel: number, at: number): void {
    const ctx = this.ctx!;
    const t = TIMBRES[ch % TIMBRES.length]!;
    const osc = ctx.createOscillator();
    osc.type = t.type;
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    const gain = ctx.createGain();
    const peak = t.level * Math.pow(vel / 127, 1.5);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + t.attack);
    gain.gain.setTargetAtTime(peak * 0.6, at + t.attack, 0.3);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    // Safety: no preview voice outlives 20 s even if a note-off is lost.
    osc.stop(at + 20);
    const key = ch * 128 + note;
    const list = this.voices.get(key) ?? [];
    list.push({ osc, gain, key, endAt: at + 20 });
    this.voices.set(key, list);
    osc.onended = () => {
      const l = this.voices.get(key);
      if (l) this.voices.set(key, l.filter((v) => v.osc !== osc));
    };
  }

  private noteOff(ch: number, note: number, at: number): void {
    const t = TIMBRES[ch % TIMBRES.length]!;
    const list = this.voices.get(ch * 128 + note);
    const v = list?.find((x) => x.endAt > at);
    if (!v) return;
    v.endAt = at;
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setTargetAtTime(0, at, t.release / 4);
    try {
      v.osc.stop(at + t.release * 2);
    } catch {
      /* already stopped */
    }
  }

  /** Stop every voice now. */
  silence(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const list of this.voices.values()) {
      for (const v of list) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setTargetAtTime(0, now, 0.01);
          v.osc.stop(now + 0.05);
        } catch {
          /* ignore */
        }
      }
    }
    this.voices.clear();
  }
}
