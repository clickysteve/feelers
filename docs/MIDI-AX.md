# MIDI-AX and a future Performance Mode

MIDI-AX is researched here separately from Fingers, and is **not implemented**
in this version. Evidence tags as in [RESEARCH.md](RESEARCH.md); all of it
comes from search excerpts of TAMW, MyAtari03 and SOS01.

## What MIDI-AX was

- The "second generation" of Fingers (TAMW), built by Tobenfeld mainly for his
  own use and released as shareware in 2001. DOCUMENTED.
- Two parts in one program: a **Fingers** part (four algorithmic lines, a
  complete system by itself) and a **mouse controller** part in the spirit of
  Laurie Spiegel's Music Mouse. DOCUMENTED.
- It ran as an MPE module inside KCS (Omega), could record its output into
  KCS, and could interact with KCS sequences. DOCUMENTED.

## Which concepts belong where

| Concept | Fingers (1988) | MIDI-AX (c. 2001) |
| --- | --- | --- |
| Four lines from Tim / Pit / Vel / S/L series | DOCUMENTED | DOCUMENTED (pitch, velocity, duration) |
| Series control elements, loops to 999 | DOCUMENTED | INFERRED (same screen "looks a lot like" Fingers) |
| Per-line pause, mute, direction, channel, program, transposition | DOCUMENTED | DOCUMENTED |
| Time Adjust | DOCUMENTED | "time division" DOCUMENTED; relation UNKNOWN |
| Linking lines to each other | Not found | DOCUMENTED, meaning UNKNOWN |
| Randomisation (Amount / Type / gaussian) | DOCUMENTED | UNKNOWN |
| Tempo slider | Not found | DOCUMENTED |
| Mouse gestures playing notes and velocities | No | DOCUMENTED |
| Per-button gesture programming (Note, NoteRep, Gliss) | No | DOCUMENTED |
| Holds: recorded gestures, draggable, mute / grab / reverse | No | DOCUMENTED |
| Control by computer keys, KCS, external MIDI CCs | Not found | DOCUMENTED |
| Fingers and mouse parts in separate tempi, cross-controlled via sliders | n/a | DOCUMENTED |

## The mouse model, as far as it is known

- A **gesture** is a drag across the screen; it plays notes (and velocities)
  as it moves. Each mouse button can be assigned a command.
- **Note** plays a note per gesture position; **NoteRep** repeats the note at
  the time separation of the last two; **Gliss** glides from note to note
  while held.
- **Holds** record a short gesture as a loop that keeps playing; it appears as
  a numbered item that can be grabbed (control-click) and dragged to transpose
  it in pitch and velocity, muted, or reversed.
- Keyboard keys select what the keyboard does during a hold.
- A sliders page lets the gesture side and the Fingers side control each
  other's parameters.

Unknown: the screen-to-pitch mapping (scale quantisation? harmony like Music
Mouse?), velocity mapping, timing of gestures, and exactly which Fingers
parameters the sliders can reach.

## Design sketch: a Feelers Performance Mode

The engine was built so that any controller can drive it through the same
methods the UI uses, each taking an `at` tick. A future Performance Mode could
add, without changing the core model:

1. **Gesture surface (X/Y pad).** A panel the size of the field view. X maps
   to pitch through a chosen scale, Y to velocity. Modes per pointer button,
   inspired by (not copying) the documented commands: *strike* (one note per
   cell crossed), *repeat* (strike, then repeat at the last interval),
   *glide* (legato with pitch bend). Output goes through the same
   `MidiOutput`, on its own channel, so note safety still holds.
2. **Holds as series.** A recorded gesture becomes a temporary set of Time,
   Pitch and Velocity series, played by a fifth "hold" line. Dragging a hold
   would change that line's transpose and velocity offset; reverse flips its
   heads. This keeps holds inside the Feelers model instead of adding a
   separate sequencer.
3. **Cross-control (sliders).** A modulation matrix: sources (pointer X/Y,
   incoming MIDI CC, a line's current pitch or velocity) to destinations (line
   transpose, time scale, velocity offset, series probability, tempo).
   Destinations are existing `App` actions, applied at the horizon.
4. **MIDI CC in.** The same matrix, with a learn function, for hardware
   controllers and, via MIDI-to-CV gear in reverse, modular sources.
5. **Line relationships.** Possible readings of MIDI-AX's "linking to other
   lines": one line's head advances only when another plays (a conductor), or
   a line borrows another line's next time value. Both fit `Engine` as new
   options on `LineConfig`.

Each of these is a modern extension and would be labelled as such in
PROVENANCE.md.
