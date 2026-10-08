/**
 * Simulated Web MIDI for browser tests. Installed before the app loads; it
 * records every message with its timestamp in window.__midi.sent and lets a
 * test unplug or replug the device. No physical hardware is involved.
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
  const fire = () => {
    const e = { port };
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
  };
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: async () => {
      const access = { inputs: new Map(), outputs, sysexEnabled: false, onstatechange: null as ((e: unknown) => void) | null, addEventListener: (_: string, l: (e: unknown) => void) => listeners.push(l) };
      accessRef = access;
      return access;
    },
  });
};
