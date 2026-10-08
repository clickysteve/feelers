/**
 * Web MIDI access: device discovery and hot-plug handling.
 *
 * Feelers never requires a device. When Web MIDI is unavailable or refused,
 * the rest of the instrument (engine, visuals, audio preview) still runs.
 */
import type { MidiSink } from './output';

export type MidiStatus =
  | { state: 'unsupported'; message: string }
  | { state: 'pending'; message: string }
  | { state: 'denied'; message: string }
  | { state: 'ready'; message: string };

export interface PortInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

export interface MidiAccessEvents {
  onPortsChanged(ports: PortInfo[]): void;
  onSelectedLost(id: string): void;
  onSelectedReturned(id: string): void;
}

class WebMidiSink implements MidiSink {
  constructor(private port: MIDIOutput) {}
  get id(): string {
    return this.port.id;
  }
  get name(): string {
    return this.port.name ?? this.port.id;
  }
  send(bytes: number[], timestamp?: number): void {
    this.port.send(bytes, timestamp);
  }
  clear(): void {
    const p = this.port as MIDIOutput & { clear?: () => void };
    if (typeof p.clear === 'function') p.clear();
  }
}

export class MidiAccess {
  access: MIDIAccess | null = null;
  status: MidiStatus = { state: 'pending', message: 'MIDI not yet requested' };
  private selectedId: string | null = null;
  private lostId: string | null = null;

  constructor(private events: MidiAccessEvents) {}

  static supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async request(): Promise<MidiStatus> {
    if (!MidiAccess.supported()) {
      this.status = {
        state: 'unsupported',
        message: 'This browser has no Web MIDI. Use Chrome, Edge, Opera or Firefox for MIDI output; the audio preview still works.',
      };
      return this.status;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.status = {
        state: 'denied',
        message: `MIDI access was refused (${err instanceof Error ? err.message : String(err)}). Allow MIDI for this site to use hardware.`,
      };
      return this.status;
    }
    this.access.onstatechange = (e: Event) => this.handleState(e as MIDIConnectionEvent);
    this.status = { state: 'ready', message: 'MIDI ready' };
    this.events.onPortsChanged(this.ports());
    return this.status;
  }

  ports(): PortInfo[] {
    if (!this.access) return [];
    const list: PortInfo[] = [];
    this.access.outputs.forEach((p) => {
      list.push({ id: p.id, name: p.name ?? p.id, manufacturer: p.manufacturer ?? '', connected: p.state === 'connected' });
    });
    return list;
  }

  /** Open an output by id. Returns a sink or null. */
  open(id: string | null): MidiSink | null {
    this.selectedId = id;
    this.lostId = null;
    if (!id || !this.access) return null;
    const port = this.access.outputs.get(id);
    if (!port || port.state !== 'connected') return null;
    return new WebMidiSink(port);
  }

  private handleState(e: MIDIConnectionEvent): void {
    const port = e.port;
    if (port && port.type === 'output') {
      if (port.id === this.selectedId && port.state === 'disconnected') {
        this.lostId = port.id;
        this.events.onSelectedLost(port.id);
      } else if (port.id === this.lostId && port.state === 'connected') {
        this.lostId = null;
        this.events.onSelectedReturned(port.id);
      }
    }
    this.events.onPortsChanged(this.ports());
  }
}
