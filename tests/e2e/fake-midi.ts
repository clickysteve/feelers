/**
 * Simulated Web MIDI for browser tests. Installed before the app loads; it
 * records every message with its timestamp in window.__midi.sent and lets a
 * test unplug or replug the device. It also offers one input port that can
 * stream MIDI Clock and transport bytes (window.__midi.clockStart etc.).
 * No physical hardware is involved.
 */
export const installFakeMidi = (): void => {
  type Msg = { bytes: number[]; t: number; at: number };
  const sent: Msg[] = [];
  const listeners: ((e: unknown) => void)[] = [];
  let accessRef: { onstatechange: ((e: unknown) => void) | null } | null = null;
  const port = {
    id: 'fake-out-1',
    name: 'Feelers Test Device',
    manufacturer: 'Simulated',
    type: 'output',
    state: 'connected',
    connection: 'open',
    send(bytes: number[], t?: number) {
      if (port.state !== 'connected') throw new Error('InvalidStateError: port disconnected');
      sent.push({ bytes: Array.from(bytes), t: t ?? performance.now(), at: performance.now() });
    },
    clear() {
      const now = performance.now();
      for (let i = sent.length - 1; i >= 0; i--) if (sent[i]!.t > now) sent.splice(i, 1);
    },
  };
  const outputs = new Map([[port.id, port]]);
  const input = {
    id: 'fake-in-1',
    name: 'Feelers Test Clock',
    manufacturer: 'Simulated',
    type: 'input',
    state: 'connected',
    connection: 'open',
    onmidimessage: null as null | ((e: { data: Uint8Array; timeStamp: number }) => void),
  };
  const inputs = new Map([[input.id, input]]);
  const deliver = (bytes: number[]) => {
    if (input.state !== 'connected') return;
    input.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() });
  };
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let clockPulses = 0;
  const fire = (p: unknown = port) => {
    const e = { port: p };
    accessRef?.onstatechange?.(e);
    listeners.forEach((l) => l(e));
  };
  (window as unknown as { __midi: unknown }).__midi = {
    sent,
    unplug() {
      port.state = 'disconnected';
      fire();
    },
    replug() {
      port.state = 'connected';
      fire();
    },
    reset() {
      sent.length = 0;
    },
    /** Send raw bytes from the input (e.g. [0xfa]). */
    sendIn(bytes: number[]) {
      deliver(bytes);
    },
    /** Stream F8 at a tempo until clockStop(). */
    clockStart(bpm: number) {
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = setInterval(() => {
        clockPulses++;
        deliver([0xf8]);
      }, 60000 / (bpm * 24));
    },
    clockStop() {
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
    },
    get clockPulses() {
      return clockPulses;
    },
    unplugIn() {
      input.state = 'disconnected';
      fire(input);
    },
    replugIn() {
      input.state = 'connected';
      fire(input);
    },
  };
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: async () => {
      const access = { inputs, outputs, sysexEnabled: false, onstatechange: null as ((e: unknown) => void) | null, addEventListener: (_: string, l: (e: unknown) => void) => listeners.push(l) };
      accessRef = access;
      return access;
    },
  });
};
