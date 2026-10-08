# Roadmap

What Feelers does not do yet, roughly in order of usefulness. The historical
items follow the batches in [HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md),
section 8; batch 1 (the historical score model) is done.

## Verification

1. **Settle the open historical choices** ([UNCERTAINTIES.md](UNCERTAINTIES.md))
   by running Fingers or the Fingers part of MIDI-AX in an Atari ST emulator
   with small test scores and logging the MIDI output. Each answer changes a
   default in `src/engine/choices.ts` or a documented rule.
2. **Physical hardware testing.** Only a simulated Web MIDI device has been
   tested. Check with a USB MIDI interface and a Squarp Hermod+: clock
   following, Start / Stop / Continue, gate lengths in AS WRITTEN, LEGATO and
   MONO, overlapping notes on polyphonic and monophonic synths, Scale Mode
   output, behaviour on unplugging.

## Batch 2: performance controls (historical)

3. Fixed values per line parameter (FM ch. 4).
4. Advance buttons (silent per-head step, all heads, with Time) and the
   series-jump arm (FM ch. 4).
5. Save Starting Points per line and Reset Starts (FM ch. 4-5).
6. P for all lines; Re for the Time head only; PA released plays at once
   (with the current behaviour kept as an option).
7. Keypad and arrow-key transposition with per-line enables; `[` / `]` to
   double and halve Time Adjust; Tm shown as an integer over 16.
8. Undo (single level, as documented) and Shadows.
9. S/L Time Limit per line.

## Batch 3: editing and files

10. Ran (one-shot randomise), Copy, Swap, Adj; Rec / Rep from a MIDI keyboard.
11. Program change table.
12. Configurable column types and 13 / 16 column modes (default 4 / 4 / 4 / 1).
13. Optional `.FIN` import for user-supplied files.

## Modern facilities and extensions

14. **MIDI CC control** of performance parameters with MIDI learn.
15. **Scale-aware editing** of pitch columns (entering scale degrees), keeping
    MIDI notes as the stored values.
16. **MIDI-AX-inspired Performance Mode** ([MIDI-AX.md](MIDI-AX.md)): gesture
    pad, holds, cross-control matrix, line linking.
