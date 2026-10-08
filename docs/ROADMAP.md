# Roadmap

What the first version does not do yet, roughly in order of usefulness.

## Verification

1. **Re-verify the research against full texts** (MT88 above all) and, if a
   legitimate copy can be obtained, observe Fingers in an emulator. The
   checklist is at the end of [RESEARCH.md](RESEARCH.md). Correct BEHAVIOUR
   and PROVENANCE where the evidence changes.
2. **Physical hardware testing.** Only a simulated Web MIDI device has been
   tested. Check with a USB MIDI interface and a Squarp Hermod+: clock
   following, Start / Stop / Continue handling, gate lengths in strict and
   legato modes, behaviour on unplugging.

## Next development pass (recommended)

3. **External clock in.** Done: SYNC INT / EXT follows 24 PPQN MIDI Clock
   with Start / Stop / Continue (see ARCHITECTURE, "External clock").
   Still to verify on real hardware (Squarp Hermod+).
4. **MIDI CC control of performance parameters** with MIDI learn: transpose,
   time adjust, velocity offset, direction, pause and mute per line, tempo,
   memory recall. Every target is an existing `App` action.
5. **Undo / redo** for series edits.

## Later

6. **MIDI-AX Performance Mode** (see [MIDI-AX.md](MIDI-AX.md)): gesture pad,
   holds as a fifth line, cross-control matrix.
7. **Line relationships**: conductor lines (one line's notes advance
   another's heads), shared clocks, probabilistic traversal (a head moves
   forward, back or stays by probability), conditional elements.
8. **More series control elements** if the remaining historical ones are
   identified.
9. **Scale-aware editing** of pitch series (entering degrees of a scale) as an
   optional convenience, keeping MIDI notes as the stored values.
10. **Original-format import**, only if the formats can be documented
    independently.
