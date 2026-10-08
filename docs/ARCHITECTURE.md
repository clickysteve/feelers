# Architecture

Feelers is a static TypeScript application (Vite, no runtime dependencies).
The musical engine knows nothing about time sources, MIDI or the DOM, so it
can be tested deterministically and driven by other controllers later.

## Three layers

| Layer | What | Where |
| --- | --- | --- |
| **Historical musical substrate** | The Fingers model as documented in the manual: typed columns of up to 16 elements, End of Series, Column Link, control elements as attributes of elements, Loop slots, Rest / rest, Time before the note, S/L in sixteenths, persistent `?` / `¿` randomisation with Minimum Time and Pitch Limit, Restore Last Start. Behaviours the sources leave open are explicit choices in `src/engine/choices.ts`. | `src/engine/series.ts`, `engine.ts`, `types.ts` |
| **Common modern instrument facilities** | Web MIDI, the lookahead scheduler, note safety and Panic, external MIDI Clock, Scale Mode, persistence and migration, palettes, the browser UI. Part of the core instrument; no "extended mode" is needed to use them. | `src/scheduler`, `src/midi`, `src/engine/scale.ts`, `src/persistence`, `src/ui` |
| **Explicit extensions** | New compositional behaviour, labelled EXT in the interface: WOBBLE, per-column randomisation and bounds, performance memories, rotate / retrograde. | spread, each marked in code comments and help |

The historical model stays identifiable and testable with the extensions
unused: `tests/unit/series.test.ts` and `engine.test.ts` exercise the
documented rules directly, and nothing in the substrate depends on an
extension. See [BEHAVIOUR.md](BEHAVIOUR.md) for the layer of every behaviour.

```
            ┌──────────────── UI (src/ui) ────────────────┐
            │ bank · editor · lines · topbar · monitor    │
            └──────┬──────────────────────────▲───────────┘
          actions  │                          │ topics, note events at sounding time
            ┌──────▼──────────── App (src/app.ts) ────────┴──┐
            │ wiring, interventions, persistence, devices    │
            └──┬─────────────┬──────────────┬────────────┬───┘
               │             │              │            │
        ┌──────▼─────┐ ┌─────▼──────┐ ┌─────▼─────┐ ┌────▼──────────┐
        │  Engine    │◄┤ Scheduler  ├►│ MidiOutput├►│ Web MIDI port │
        │ (pure)     │ │ lookahead  │ │ note-safe │ └───────────────┘
        └────────────┘ └────────────┘ └─────┬─────┘
                                            │ taps
                                  ┌─────────┴──────────┐
                                  │ AudioPreview, log  │
                                  └────────────────────┘
```

## Modules

| Path | Responsibility |
| --- | --- |
| `src/engine/types.ts` | Plain-data model: `Project`, `Column`, `El` (element), `LineConfig`, `HeadConfig`, `Snapshot`, ranges. |
| `src/engine/series.ts` | Traversal over columns: series boundaries (End, Column Link), Skip, Loop, blanks, `readHead()` / `peekHead()`, randomisation and its limits, cycle length. |
| `src/engine/engine.ts` | `Engine`: runtime line state, note assembly (Time before the note, rest advance rules), `generate(untilTick)`, interventions, Restore Last Start, snapshots. |
| `src/engine/choices.ts` | The unresolved historical behaviours, as switchable choices with documented defaults. |
| `src/engine/scale.ts` | Scale Mode: scales, deterministic quantisation, inheritance. |
| `src/engine/rng.ts` | Seeded PRNG (mulberry32) and gaussian deviates. |
| `src/engine/factory.ts` | Building projects: compact column notation, note names, defaults. |
| `src/scheduler/scheduler.ts` | Lookahead scheduling, tempo anchor, transport, MIDI clock out and in, overlap modes, note-off queue. |
| `src/scheduler/pulses.ts` | Tempo estimate of an incoming clock (display only). |
| `src/midi/output.ts` | `MidiOutput`: id-based note tracking, panic, device switching, cancellation safety, taps. |
| `src/midi/webmidi.ts` | Web MIDI access, port lists, hot-plug events. |
| `src/midi/messages.ts` | Message builders and descriptions. |
| `src/audio/preview.ts` | Web Audio preview synth fed by a `MidiOutput` tap. |
| `src/persistence/project.ts` | Versioned file format (v2), validation and repair. |
| `src/persistence/migrate.ts` | v1 to v2 conversion with a report. |
| `src/persistence/storage.ts` | localStorage autosave and library (all access guarded). |
| `src/persistence/takes.ts` | Take recorder and Standard MIDI File writer. |
| `src/demos/demos.ts` | Original demonstration projects. |
| `src/app.ts` | Application controller: owns everything, exposes actions, publishes topics. |
| `src/ui/palette.ts` | Palette roles, built-ins, library, import / export, CSS generation. |
| `src/ui/*` | DOM views. No framework; each view subscribes to topics and patches itself. |

## Score, series and line state

The *material* is the score (`Project.columns`): columns of up to 16
elements. An element is a value (or blank) with optional attributes
(`skip`, `rest`, `ar`, `end`), or a Loop slot. A *series* is not stored: it
is derived from End flags and Column Links (`seriesStart`, `rawNext`,
`rawPrev` in `series.ts`). Heads address elements as `{col, i}`.

The *performance state* is per line:

- `LineConfig` (saved): channel, program, transpose, velocity offset, time
  scale, delay, overlap mode, mute, line scale, and for each kind a
  `HeadConfig` (column, start element, start direction).
- `LineRuntime` (not saved, except through snapshots): four `HeadState`s
  (position, direction, loop counters, last element read), the Time value
  already read for the next note (`pending`), the tick of the next onset,
  pause state and remaining wait.

`readHead()` examines elements from the head's position, passing over
skipped and blank elements and acting on Loops, until it reaches a value or a
rest, then moves the head one element on. `peekHead()` does the same on a
copy without randomising, which `assemble()` uses to find Rest marks before
any head moves: a Rest (R) holds the heads that did not read it.

A note is assembled from this note's own Time value (read with the previous
note), the Pitch, Velocity and S/L reads, and the *next* Time value, which
sets the gap to the next note and the note's length. There is no
precomputed note list: notes exist only once they are assembled, moments
before they sound, so edits, reversals and redirections take effect while
playing.

`Engine.generate(until)` repeatedly takes the line with the earliest next
onset (ties by line number) and assembles its note, until every line's next
onset is at or beyond `until`. Generation is incremental: generating in many
small chunks gives exactly the same notes as one large chunk (tested).

## Scale Mode

`engine.assemble()` computes `prePitch` (series value plus transposition,
folded into 0-127), then `constrain(prePitch, effectiveScale(global, line))`.
The `NoteEvent` carries `pitch` (emitted), `prePitch` and `scaleDelta`, so
every view can show source and output. The scheduler only ever sees
`pitch`; note-offs use the pitch that was actually sent, so changing the
scale while notes sound cannot strand a note. The bank's preview uses the
same functions (`lensView` in `ui/bank.ts`) on the stored values, so what it
marks is exactly what the engine would play.

## Time

- Engine time is **ticks since Start**, 24 per quarter note (MIDI clock
  resolution). Ticks may be fractional because time adjust multiplies them.
- The scheduler maps ticks to `performance.now()` milliseconds with an
  **anchor**: `ms = anchorMs + (tick - anchorTick) x 60000 / (bpm x 24)`.
- A **ticker** calls `pump()` every 25 ms. The default ticker runs in a
  dedicated Worker because browsers throttle main-thread timers in background
  tabs. UI timers are never used for musical timing.
- Each pump schedules everything up to `now + 100 ms` (the *horizon*). MIDI
  messages are handed to Web MIDI with absolute timestamps, so jitter from the
  JavaScript thread does not reach the notes.

### Interventions and the horizon

Notes before the horizon have already been handed to the MIDI port. Live
interventions (NEXT, RESET, pause a line, shift, snapshot recall) therefore
apply **from the horizon** (`Scheduler.at()`), at most one lookahead window
after the click. Series edits and direction changes need no special handling:
they affect the next read, which happens when that note enters the window.

Tempo changes re-anchor at the horizon: everything already scheduled keeps the
old tempo, everything after uses the new one, with no gap or overlap (tested).

## Transport

| Action | Engine | Scheduler | MIDI (with CLOCK on) |
| --- | --- | --- | --- |
| Start | `reset()`: start elements, directions, seed, Pitch ranges; `captureStart()` for Restore Last Start | anchor at now + 40 ms | Program changes (option), FA, then F8 x 24/qn |
| Pause | untouched | stop pumping at the horizon; pending note-offs sent at the pause point | FC |
| Continue | untouched | re-anchor the paused tick at now + 40 ms | FB, clock resumes at the next tick |
| Stop | `reset()` | cancel queued messages, release all notes now | FC, then F2 00 00 (Song Position 0) |

Pause keeps every line's remaining wait, loop counters and heads, so Continue
is seamless. Clock pulses are counted in ticks and resume on the next integer
tick after Continue.

## MIDI output and note safety

`MidiOutput` gives every note-on an id. A (channel, note) pair is released only
when every id holding it has been released. This guarantees:

- note-on / note-off pairing, including when two lines share a channel and
  pitch (the pair is re-struck, and held until both release);
- stale note-offs (for example after a panic, or after a channel change) are
  ignored instead of cutting a newer note;
- a channel change releases the old note on the old channel.

**Overlap** is handled in the scheduler per line. AS WRITTEN (Fingers) keeps
every note's computed length, so a line may sound several notes; MONO cuts
the previous note at the new onset; LEGATO cuts it just after. In every mode
a note of the same pitch and channel on the same line is released before it
is struck again, and muting, pausing a line or changing its channel releases
every note the line holds.

**Cancellation.** Stop and panic call `MIDIOutput.clear()` where supported,
which drops messages queued for the future, including note-offs already
queued. `MidiOutput` remembers those queued note-offs and re-sends them,
together with offs for held notes, immediately. Where `clear()` is not
supported, emergency note-offs are timestamped after the latest queued message
so a queued note-on cannot overtake them.

**Device changes.** Switching device releases held notes on the old one first.
If the selected port disconnects, held notes are forgotten (nothing can be
sent), playback continues, and the UI says so; when the same port returns it
is reattached. Send errors are counted and never stop the scheduler.

**Panic** releases everything and sends All Notes Off (CC 123) and All Sound
Off (CC 120) on all 16 channels.

## Audio preview

The preview is a `MidiOutput` tap: it hears exactly the bytes sent to the
hardware (with their timestamps) and plays them with Web Audio oscillators.
It never feeds anything back. A cancelled stream (stop, panic) silences it.

## UI update model

- Views subscribe to topics (`project`, `bank`, `lines`, `heads`, `transport`,
  `midi`, `selection`, `snapshots`, `takes`, `status`, `scale`).
- Colours come only from palette roles (CSS custom properties); see
  [DESIGN.md](DESIGN.md).
- Note events from the scheduler are queued with their sounding time; the
  animation-frame loop releases them when due, so head tabs, the NOTE readout,
  cell flashes and the field show what is *heard*, not what was scheduled 100
  ms early.
- Views patch themselves rather than rebuilding where focus matters
  (steppers keep focus while values update underneath).

## Persistence

See [FORMAT.md](FORMAT.md). The current project autosaves to localStorage
800 ms after any change; named saves live in a browser library; JSON export
and import use the same versioned format (v2). Loading always goes through
migration (v1 files), validation and repair; a conversion report is added to
the project notes. Palettes and device choices are browser preferences
(`feelers.palette.*`, `feelers.port`, `feelers.clockSource`,
`feelers.clockInput`), never part of a project.

## External clock

The clock source is INTERNAL (above) or EXTERNAL. EXTERNAL is a modern
interoperability feature; it makes no claim about how Fingers synchronised.

**Pulses are ticks.** The engine already measures time in ticks at 24 per
quarter note, the MIDI Clock resolution, so incoming F8 pulse *n* after Start
*is* engine tick *n*. Nothing is converted to a tempo and back.

**Per-pulse scheduling.** When pulse *k* arrives at time *T* (the Web MIDI
event timestamp, sanity-checked against `performance.now()`), the scheduler
calls the same `advance()` routine INTERNAL uses, with horizon *k + 1*:

- events at exactly tick *k* (and note-offs due at *k*) are sent at *T*;
- events at a fractional tick *k + f* (Time Adjust, articulation, shifts) are
  sent at *T + f x P*, where *P* is the mean of the last six pulse intervals.

The engine never runs ahead of the pulse that has actually arrived, so it
never assembles notes for time that may not come. Integer-tick events
are exactly on their pulse. A fractional event can be early or late by at
most *f* times the tempo change within one pulse, and it is still released
on the pulse that precedes it. Note-offs are queued exactly as under
INTERNAL and leave only when their pulse arrives, so long notes, legato
overlap and monophonic cuts all follow the incoming clock.

**Transport.**

| Byte | Effect |
| --- | --- |
| FA Start | `engine.reset()` (starting state, seed), release any notes, wait: the next F8 is tick 0. |
| F8 Clock | Running: advance one tick. Stopped: tempo display only; never starts. |
| FC Stop | Release held notes (at the time the next pulse was due, so notes already sent for this pulse are not overtaken), keep the position and engine state. |
| FB Continue | Resume from the stop position (or from the beginning if never started). Nothing is reset. |

**Loss.** A watchdog (the same ticker, every 25 ms) marks the clock LOST if no
pulse has arrived for 500 ms while running. Unplugging or changing the input
does the same at once. LOST releases every held note, keeps the transport
running (no FC was received) and holds the position. The next F8 carries on.
There is no fallback to internal time and no free-running at an estimated
tempo.

**Tempo estimate** (`src/scheduler/pulses.ts`): a least-squares fit of pulse
arrival times over the last two beats, shown with hysteresis so jitter does
not make it flicker. A gap longer than four pulse periods (or 1 s) starts a
new measurement. It is display only (and the between-pulse placement above
uses the short-window period, not this figure).

**Clock out** is forced off while EXTERNAL (`Scheduler.clockOut`), so clock
can never be echoed back to its source. There is no clock-thru.

**What differs from INTERNAL.** INTERNAL schedules 100 ms ahead with exact
timestamps, so browser jitter never reaches the notes. EXTERNAL cannot know
future pulses: output timing inherits the incoming clock's timing plus the
browser's input latency and jitter (event timestamps are used where the
browser provides them).

## Testing

- `tests/unit` (Vitest, Node):
  - `series.test.ts`: columns, End, Column Link (adjacent, non-adjacent,
    wrapping, rings, backwards), Skip (overrides, beside End), Loops (counts,
    0, consecutive, backwards, across links, both count readings), blanks,
    rests, randomisation (persistence, the two probabilities, Type n,
    gaussian average, Minimum Time, Pitch Limit, limits only on randomised
    values), WOBBLE.
  - `engine.test.ts`: Time before the note (both first-note readings), length
    from the next Time value, S/L 1 / 15 / 16 / 24, Rest and rest advance
    rules, interventions, Restore Last Start, determinism.
  - `scale.test.ts`: every scale x root x direction x pitch against a
    brute-force reference, ties, octave and range edges, inheritance,
    transposition before the scale, live changes, persistence, note safety,
    internal and external clock.
  - `migration.test.ts`: v1 projects against note streams recorded from the v1
    engine, structural conversion, overflow, snapshots, repair.
  - `scheduler.test.ts`, `external-clock.test.ts`: timing, overlap modes,
    transport, clock in and out, device loss, panic.
  - `persistence.test.ts`, `app.test.ts`, `palette.test.ts`.
- `tests/e2e` (Playwright, Chromium): the built app with a simulated Web
  MIDI device; musical output, live edits, control element marks, Scale Mode
  marks and readouts, Restore Last Start, palettes, v1 import, external
  clock, no-MIDI browsers, phone width and the `/feelers/` sub-path.

No physical MIDI hardware has been tested by the automated suite.

## Extension points

- **Controllers.** Everything a performer can do is an `Engine` or `App`
  method taking an `at` tick. A MIDI-CC mapper or an X/Y gesture surface can
  call the same methods (see [MIDI-AX.md](MIDI-AX.md)).
- **External clock.** Implemented in the scheduler; the engine only sees ticks.
- **Historical choices.** `Engine` takes an `EngineChoices` object; an
  emulator-verified answer changes one default.
- **Later batches** (audit section 8): fixed values, advance buttons, Save
  Starting Points, Shadows, Undo, configurable column types, `.FIN` import.
