# Behaviour: the Fingers musical model, and how Feelers realises it

This is a systematic description of the instrument, section by section. The
historical claims rest on the full Fingers manual and the other sources
inventoried in [HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md) (keys such as
FM = Fingers manual, MT88 = Music Technology review). Nothing here has been
OBSERVED on a running copy of Fingers.

Every behaviour belongs to one of four layers:

| Layer | Meaning |
| --- | --- |
| **FINGERS** | Documented Fingers behaviour, implemented as documented. |
| **CHOICE** | The sources leave this open; Feelers makes a stated, tested choice ([UNCERTAINTIES.md](UNCERTAINTIES.md)). Where practical the choice is isolated in `src/engine/choices.ts`. |
| **MODERN** | A common modern instrument facility: part of the core instrument, but not a Fingers feature (Web MIDI, the scheduler, note safety, external clock, Scale Mode, palettes, persistence). |
| **EXTENSION** | A genuinely new compositional behaviour, labelled as such in the interface (WOBBLE, per-column randomisation, performance memories, rotate and retrograde). |

Evidence tags: **DOCUMENTED**, **OBSERVED** (structure of original `.FIN` files only), **INFERRED**, **UNKNOWN**.

---

## 1. Lines

| Historical | Source | Tag |
| --- | --- | --- |
| Four monophonic lines; each note is made from Time, Pitch, Velocity and S/L. | FM ch. 1; MT88; MM89 | DOCUMENTED |
| Each line has four line icons, one per parameter, moving independently. | FM ch. 1 | DOCUMENTED |
| Several lines may read the same column. | FM ch. 2-4 | DOCUMENTED |
| S/L of 16 or more overlaps the next note; the manual warns some synths misbehave. No cutting is described. | FM ch. 3 | DOCUMENTED (overlap); INFERRED (no cut) |

**Feelers.** Four lines, each with four *heads* (`time`, `pitch`,
`velocity`, `artic` = S/L). Lines may share columns freely. How a line's notes
may overlap is chosen per line (NOTES):

- **AS WRITTEN** (FINGERS, the default for new lines): every note keeps the
  length its S/L gives it, so S/L over 16 overlaps the next note.
- **LEGATO** (MODERN): the previous note is released just after the next one
  starts, so a mono synth glides.
- **MONO** (MODERN): strict monophony, each note ends at the next onset.

In every mode a note of the same pitch on the same channel is released before
it is struck again (MODERN note safety), and a rest never cuts a sounding
note.

## 2. Note assembly

| Historical | Source | Tag |
| --- | --- | --- |
| A note's Time is the time from the start of the previous note to the start of this note: the wait comes *before* the note. | FM ch. 1; MT88 | DOCUMENTED |
| A note's length is the *next* Time value times its own S/L value, divided by 16. | FM ch. 6 | DOCUMENTED |
| Time values are 1-999 steps of 24 per beat. | FM ch. 3, ch. 6 | DOCUMENTED |
| Time Adjust: actual time = Time x Tm / 16. | FM ch. 4 | DOCUMENTED |
| Whether a line's first Time value is waited before its first note. | FM ch. 4-5 | UNKNOWN |

**Feelers** (FINGERS):

```
note k sounds when the wait of its own Time value, Tim(k), has passed
Tim(k+1)   = the next Time value: the gap after note k
gap        = Tim(k+1) x line.timeScale             (ticks, 24 per quarter; timeScale = Tm / 16)
duration   = gap x S/L(k) / 16                     (S/L 1 staccato, 15 just before, 16 touching, >16 overlap)
pitch      = see section 7 (series value, transposition, Scale Mode)
velocity   = Vel(k) + line.velOffset              (clamped; 0 is silent)
```

The Time head therefore reads one element ahead of the others; a line panel
shows the note's own Time value, and the length/gap it played.

**CHOICE (T2).** The first note of a line sounds at Start plus the line's
entry delay; the Time value read with it is consumed but not waited. Every
later note waits its own Time value. The alternative (the first Time value is
also waited) is implemented and tested (`firstNoteWaits` in
`src/engine/choices.ts`). This choice keeps notes on the downbeat when a
sequencer starts Feelers, and lets v1 projects keep their rhythm exactly.

Because the heads are independent, a line's period is the least common
multiple of its series' cycle lengths; the bank shows each column's cycle
(×n).

## 3. Columns and series

| Historical | Source | Tag |
| --- | --- | --- |
| The score is a row of typed columns (13, or 16 in the alternative configuration); a column holds up to 16 elements. | FM ch. 3, ch. 5 | DOCUMENTED; OBSERVED (`.FIN` layout) |
| End of Series splits a column into two or more separate series, all usable. | FM ch. 3 | DOCUMENTED |
| Column Link joins the bottom of a column to the top of the next column of the same type to the right, wrapping from the rightmost to the leftmost. Linked columns act as one continuous column. | FM ch. 3 | DOCUMENTED; OBSERVED (link byte) |
| Pit values 0-127 shown as note names; Vel 1-127; S/L as described above. | FM ch. 3 | DOCUMENTED |

**Feelers** (FINGERS): sixteen columns, four of each kind (T1-T4, P1-P4,
V1-V4, S1-S4), each holding up to 16 elements. A **series** is what a head
walks:

- An element with **End** is the last of its series; the next element starts
  another series. The strip shows the split as a gap.
- A column with **Column Link** continues at the top of the next column of its
  kind to the right (wrapping). The bottom series of the linked column and
  the top series of the next form one series; a ring of linked columns never
  wraps.
- Past the end of its series a forward head returns to the series start; a
  backward head past the start goes to the series end.

Configurable column types and 13-column mode are not implemented yet
(audit item S4, batch 3). Migrated v1 projects may have extra columns
(section 10).

## 4. Series control elements

| Historical | Source | Tag |
| --- | --- | --- |
| Eight control elements: End of Series, Column Link, Loop, Skip, Rest, rest, and two auto-randomise marks. They sit beside an element (Column Link on the column header). | FM ch. 3 | DOCUMENTED |
| Skip: heads skip that element. It overrides a Loop or rest on the same element; beside End, the element is skipped but End still applies. Removing a Skip leaves the value. | FM ch. 2-3 | DOCUMENTED |
| Rest and rest: the next note is silent. With Rest, only the Time icon and the icon in the series holding the Rest advance; with rest, all icons advance. | FM ch. 3 | DOCUMENTED |
| Loop: repeats everything above it back to the series start or the previous Loop, for its count (0-999; 0 = forever). Ignored by icons moving backwards. A Loop takes an element slot. | FM ch. 3 | DOCUMENTED; OBSERVED (Loop slot values) |

**Feelers** (FINGERS unless marked):

- Control elements are **marks on an element**: switching Skip, Rest, rest,
  End or a randomise mark on or off never changes the value or the positions
  of the other elements. Only a **Loop** replaces the element in its slot.
- **Skip** passes over its element in either direction. Loop and rest on the
  same element are ignored; End still ends the series.
- **Rest (R)** silences the note; the Time head and the head that read the
  Rest advance, the other heads hold (the line panel shows *hold*). **rest
  (r)** silences the note; every head advances. A rest still takes its Time.
  CHOICE: if several heads read rests for one note, an `r` anywhere advances
  every head; otherwise each head that read an `R` advances.
- **Loop** with count n: CHOICE (C4) n means n *more* passes (n + 1 in all);
  0 repeats forever. The alternative (n passes in all) is implemented and
  tested (`loopCount`).
- **Blank** elements (no value) are passed over (CHOICE). A blank element can
  carry a rest.
- **Reversing** (CHOICE): a reversed head turns round at the element it last
  read; the next note comes from its neighbour on the other side.
- **Starting positions**: each head has a start element and direction, used
  by Start and RESET. While stopped, HEAD HERE and the direction buttons edit
  them.

## 5. Randomisation

| Historical | Source | Tag |
| --- | --- | --- |
| One set of Amount and Type per parameter type. Type > 0: change is +/- Amount x k, k from 1 to Type, all equally likely. Type 0: gaussian, average change about Amount. | FM ch. 6; MT88 | DOCUMENTED |
| The two marks (`?` and inverted `?`) differ only in having separate probability settings. | FM ch. 3, ch. 6 | DOCUMENTED |
| Auto-randomisation changes the stored element (values drift; recovered with Shadows, Backups or Restore Last Start). | FM ch. 3, ch. 5; original example notes | DOCUMENTED |
| Minimum Time: randomised Time values never go below it. Pitch Limit: randomised pitches stay within the range the series had when Fingers started, widened by Pitch Limit semitones. Limits apply to randomisation only. | FM ch. 6 | DOCUMENTED |

**Feelers.**

- FINGERS: Amount, Type and the two probabilities (`?` and `¿`) are set per
  kind (± beside each kind in the bank). A `?` or `¿` element read with its
  probability is changed and **the change is kept**. Gaussian changes are
  scaled so their average size is about Amount (CHOICE on the exact scale:
  standard deviation = Amount x sqrt(pi/2)). Minimum Time and Pitch Limit
  apply to randomised values only; Pitch Limit uses each Pitch series' range
  taken at Start. Values as written are never limited.
- FINGERS: **RESTORE** (Restore Last Start) puts every series value and line
  setting back to how it was when Start was last pressed; pressing it again
  undoes the restore.
- EXTENSION: **WOBBLE** (`~`) displaces the value read with its own
  probability and never changes the stored value.
- EXTENSION: a column can have **its own settings** and low/high bounds
  (bounds again apply to randomised values only). Migrated v1 projects use
  this to keep their per-series settings.
- MODERN: all randomness comes from one seeded generator; Start reseeds it, so
  a performance with the same interventions replays identically.

Not yet implemented (audit batch 2/3): the Ran one-shot option, Shadows,
Backups, Undo, Shift applying to randomisation.

## 6. Live performance controls

| Control | Historical (FM ch. 4-5) | Feelers |
| --- | --- | --- |
| Pause / Mute | PA stops a line; MU silences it while its icons move. | PAUSE keeps the remaining wait (CHOICE: FM's PA plays at once on release; batch 2). MUTE releases sounding notes; heads keep moving. |
| Direction | Arrow per icon. | → / ← per head; REV flips all four. |
| P | Plays the next note now. | NEXT; while stopped it auditions a note. |
| Re | Restarts the line. | RESET (all heads; the Tim-only variant is batch 2). |
| Redirection | Click an element to move a line's icon there. | HEAD HERE in the editor; column select per head. |
| Channel / program | Per line. | Per line; channel change releases notes on the old channel. |
| PT / VT | Pitch and velocity transposition per line. | TRANS and VEL± (keypad transposition is batch 2). |
| Tm | Time adjust, integer / 16. | TIME×, a multiplier with presets and 0.005 steps (MODERN: finer than Fingers). |
| Advance / Delay | Initial delay and live shifts. | SHIFT: entry delay while stopped, 3 or 24 tick shifts while playing. |
| Fixed values, advance buttons, Save Starting Points | Documented. | Not yet (batch 2). |

### Material versus performance

Editing the bank changes the **material**: what every line reading it plays
next time it reaches that element. Line controls change **how** one line
performs it. While the transport is stopped, head directions, positions and
delays edit the starting state that Start returns to.

## 7. Pitch processing and Scale Mode (MODERN)

Fingers had no scale quantiser; Scale Mode is a modern Feelers facility, part
of the core instrument and optional. For every note:

```
stored (or randomised) Pit value
  -> + line transposition, folded into 0-127 by octaves
  -> Scale Mode constraint, if the line has a scale
  -> MIDI note
```

- **Global**: SCALE on/off, root, scale and direction in the top bar.
- **Per line**: G (follow the global scale, only while it is on), OWN (the
  line's own root, scale and direction, whatever the global setting) or OFF
  (never constrained).
- **Directions**: NEAREST (a tie goes up: C#4 in C major plays D4), DOWN (the
  scale note at or below), UP (at or above). A result outside 0-127 falls
  back to the other direction.
- **Scales**: Chromatic, Major, Natural Minor, Harmonic Minor, Melodic Minor,
  Dorian, Phrygian, Lydian, Mixolydian, Locrian, Major Pentatonic, Minor
  Pentatonic, Blues, Whole Tone, Diminished (whole-half), Diminished
  (half-whole).
- The stored series are **never rewritten**; OFF plays them exactly.
- **Visible**: a note the scale moved shows in its line panel as
  `source → output +n` (for example `C#4 → D4 +1`); an unchanged note shows
  just its name. In the bank, Pitch elements that the scale shown would move
  carry a Transform underline and the change in the corner; the lens chooses
  the global scale (G) or one line's scale and transposition (1-4). Changes
  to root, scale, direction or inheritance redraw the marks at once.
- Out-of-range pitches after transposition are folded by octaves (CHOICE:
  Fingers' method is UNKNOWN).

## 8. Transport (MODERN, with FINGERS mapping)

- **START**: reset to the starting state (heads at start elements and
  directions, loop counters cleared, seed reset, Pitch ranges taken for Pitch
  Limit, the state remembered for RESTORE) and play. With CLOCK on: FA, then
  F8 at 24 per quarter note.
- **PAUSE / CONTINUE**: keep everything; with CLOCK on, FC and FB. Fingers'
  Stop followed by Con corresponds to this.
- **STOP**: silence immediately and reset; with CLOCK on, FC and Song
  Position 0.
- **EXT clock**: follow incoming MIDI Clock and FA/FB/FC
  ([ARCHITECTURE.md](ARCHITECTURE.md), "External clock"). Fingers could only
  send clock (FM ch. 7); following a clock is MODERN.

## 9. Performance memories (EXTENSION)

Nine memories store each head's column, position and direction, pause, mute,
transposition, velocity offset, time adjust and tempo. Recall applies from the
scheduling horizon without disturbing line timing.

## 10. Older projects

Projects saved by earlier versions of Feelers (format 1) are converted on
load; see [FORMAT.md](FORMAT.md), "Migrating version 1 projects". They keep
their material and, apart from LINK, play the same notes; every conversion
note is added to the project notes.

## 11. Deliberately not reproduced

- The ST's internal sound chip voices (a Web Audio preview listens instead).
- MIDI byte delay and Running Status options (handled by the browser and OS).
- The original screen layout, wording and graphics.
