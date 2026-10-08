# Uncertainties

What the historical sources leave open, and what Feelers does about each
point. The evidence base is now the full Fingers manual, the MIDI-AX
preliminary reference, the original example notes, the structure of original
`.FIN` files and complete contemporary articles (inventory in
[HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md), section 1). Nothing has been
OBSERVED on a running copy of Fingers, so every item below is a choice, not a
verified fact. Where practical the choice is isolated in
`src/engine/choices.ts` and tested both ways.

Items that earlier versions of this file listed as open but that the full
manual answers (control elements, End, Link, loops, rests, randomisation
symbols and limits, S/L units, sync direction) are recorded in
[HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md), section 4.3, and are now
implemented as documented ([BEHAVIOUR.md](BEHAVIOUR.md)).

## Still unresolved for Fingers

| # | Question (audit ref.) | Feelers' choice | Where | Alternative available |
| --- | --- | --- | --- | --- |
| 1 | Is a line's first Time value waited before its first note? (T2) | No: the first note sounds at Start plus the entry delay; its Time value is consumed. Every later note waits its own Time value. | `choices.firstNoteWaits = false` | Yes (`true`), tested |
| 2 | Does a Loop count n mean n repeats or n passes? (C4) | n *more* passes (n + 1 in all); 0 = forever. Original example files use counts such as 1 and 8, which does not decide it. | `choices.loopCount = 'repeats'` | Yes (`'passes'`), tested |
| 3 | Is a Rest / rest / Skip host element's own value read? (C5) | A rest element is read (its value is shown) but the note is silent; a skipped element is not read at all. | `series.ts` `readHead` | No |
| 4 | Several rests on one note. | Any `r` advances every head; otherwise each head that read an `R` advances, with Time. | `engine.ts` `assemble` | No |
| 5 | What blank elements do. | Heads pass over them. A blank may carry a rest. | `series.ts` | No |
| 6 | Traversal when a backward head meets a Column Link or End. | Symmetric: backward heads cross links into the linking column and stop at End boundaries exactly as forward heads do. Loops are ignored backwards (documented). | `series.ts` `rawPrev` | No |
| 7 | Which element plays next when a head is reversed. | It turns round at the element last read; the next note is its neighbour on the other side. | `engine.ts` `setDirection` | No |
| 8 | Pitch out of range after transposition. | Folded by octaves into 0-127 (velocity clamps, as documented). | `engine.ts` | No |
| 9 | Overlapping same-pitch notes on one line. | Released before being struck again (note safety), in every overlap mode. | `scheduler.ts` | No |
| 10 | Exact gaussian scaling. | Standard deviation = Amount x sqrt(pi/2), so the average change is Amount (FM gives only an example). | `series.ts` `GAUSS_SCALE` | No |
| 11 | Default Minimum Time, Pitch Limit, probabilities. | Minimum Time 1, Pitch Limit 12, `?` 50 %, `¿` 5 %, WOBBLE 50 %. Migrated v1 projects get Pitch Limit 127 (no change to their walks). | `factory.ts` | n/a |
| 12 | S/L range. | 1-64 sixteenths (v1's articulation went to 400 %). | `types.ts` `KIND_RANGE` | n/a |
| 13 | Which `.FIN` code byte means which control element; the 990 trailing bytes. | Not needed yet (no importer). | audit section 6 | n/a |
| 14 | Fingers version history. | Not modelled. | | |

## Choices that deliberately differ from documented Fingers behaviour

These are known differences, kept for now and scheduled in the audit's later
batches (or kept as modern behaviour):

- **Pause release.** FM's PA starts the line at once when released; Feelers'
  PAUSE resumes after the remaining wait (batch 2 will add the documented
  behaviour).
- **Re** resets all four heads; the Time-only variant is batch 2.
- **Time Adjust** is a free multiplier, finer than Fingers' integer Tm / 16
  (MODERN).
- **Column types** are fixed at 4 / 4 / 4 / 4 (Fingers defaults to
  4 / 4 / 4 / 1 and lets any column take any type; batch 3).
- **Velocity 0** is allowed and silent (Fingers' range is 1-127; its Mute
  Zero Velocities option is P3 in the audit).
- **STOP resets** to the beginning (a modern transport); Fingers' Stop then
  Con equals Feelers' PAUSE then CONTINUE.

## Modern facilities and extensions (not uncertainties)

External MIDI Clock input, Scale Mode, palettes, the scheduler, note safety,
seeded randomness, takes as Standard MIDI Files, performance memories,
WOBBLE, per-column randomisation and rotate/retrograde are deliberate
additions, not reconstructions. Fingers could send MIDI clock but could not
follow one (FM ch. 7); earlier versions of this file guessed the opposite.
See [PROVENANCE.md](PROVENANCE.md).

## MIDI-AX

MIDI-AX facts must not be attributed to Fingers: line linking (L objects),
KCS sequence starts, sliders, gestures, and the removal of fixed-value fields
are MIDI-AX changes ([MIDI-AX.md](MIDI-AX.md); audit section 4.2). None is
implemented.

## How to settle the open items

Run Fingers (or the Fingers part of MIDI-AX) in an Atari ST emulator such as
Hatari or STEem, play small test scores, and log the MIDI output. Items 1-7
can each be settled with a two- or three-element score. Several could also be
narrowed by decoding the `.FIN` examples against their notes.
