# Behaviour: the Fingers musical model, and how Feelers realises it

This is a systematic description of the musical model, section by section.
Each section gives the historical behaviour with its evidence tag, then the
behaviour Feelers implements. Sources and caveats are in
[RESEARCH.md](RESEARCH.md); every DOCUMENTED claim rests on excerpts of the
cited reviews and should be re-verified against the full texts.

Tags: **DOCUMENTED**, **OBSERVED** (none yet), **INFERRED**, **UNKNOWN**.

---

## 1. Lines

| Historical | Tag |
| --- | --- |
| Four monophonic Lines. | DOCUMENTED (MT88, MM89) |
| Each note built from Time, Pitch, Velocity, Articulation. | DOCUMENTED (MT88) |
| Each Line has four Line icons, one per parameter, stepping through the series in time with the clock. | DOCUMENTED (MT88) |
| A Line's icons sit in columns of the matching type; several Lines may read the same column. | INFERRED (icons are drawn as digits in shared columns) |
| Monophony: what happens if a note is still sounding when the next starts. | UNKNOWN |

**Feelers.** Four lines. Each line has four *heads* (`time`, `pitch`,
`velocity`, `artic`), each pointing at a series of the same kind. Lines may
share series freely. A line is strictly monophonic by default: if its previous
note is still sounding when the next one starts, the previous note is released
at the new onset, before the new note-on. With **LEGATO** on, the release is
sent immediately after the new note-on instead, so mono synths can glide; a
repeated pitch is always released before being re-struck so no note is ever
doubled. A rest never cuts a sounding note; it simply lets it finish.

## 2. Note assembly

| Historical | Tag |
| --- | --- |
| Time is the interval from the start of one note to the start of the next. | DOCUMENTED (MT88) |
| Articulation sets the note's length / phrasing (S/L). | DOCUMENTED (MT88) |
| The icon's position determines which element sets the parameter of the next note. | DOCUMENTED (MT88) |
| Units of Time and S/L values. | UNKNOWN |

**Feelers.** When a line's next onset falls due, each of its four heads reads
one value (stepping over control elements as described in section 4) and then
advances one cell in its own direction. The note is:

```
time      = timeValue  x line.timeScale              (ticks, 24 per quarter)
duration  = time       x articValue / 100
pitch     = pitchValue + line.transpose               (folded by octaves into 0-127)
velocity  = velocityValue + line.velOffset            (clamped; 0 means silent)
next onset = this onset + time
```

Units are an independent decision (see PROVENANCE): time in MIDI-clock ticks
(24 per quarter note: 6 = sixteenth, 8 = triplet eighth, 12 = eighth,
24 = quarter), articulation as a percentage of the time value (values over 100
overlap the next note), pitch as MIDI note numbers, velocity 0-127.

Because the heads are independent, the period of a line is the least common
multiple of its series' cycle lengths. In the default demo, line 1 has a
5-step time series and a 7-step pitch series, so a particular rhythm/pitch
pairing recurs only every 35 notes. The bank shows each series' cycle (×n).

## 3. Series

| Historical | Tag |
| --- | --- |
| Four series types: Tim, Pit, Vel, S/L. | DOCUMENTED (MT88) |
| Drawn as vertical columns; "13 or 16 columns". | DOCUMENTED for MIDI-AX (TAMW, SOS01); INFERRED for Fingers |
| End of Series splits a column into two series. | DOCUMENTED (MT88) |
| Link joins adjacent columns. | DOCUMENTED (MT88) |
| Maximum series length, number of series per type. | UNKNOWN |

**Feelers.** A bank of 16 series, four of each kind (T1-T4, P1-P4, V1-V4,
A1-A4), each up to 64 cells, drawn as horizontal strips. A cell is either a
value or a control element. A series' *active region* runs from cell 1 to the
first END (or to the last cell).

## 4. Traversal and series control elements

| Historical | Tag |
| --- | --- |
| Icons move up and down columns (direction is reversible per parameter). | DOCUMENTED (MT88) |
| Eight series control elements; used to skip and loop. | DOCUMENTED (MT88) |
| Loop repeats a section up to 999 times. | DOCUMENTED (MT88) |
| Skip hops over a parameter. | DOCUMENTED (MT88) |
| Rests can be inserted with control elements. | DOCUMENTED (MM89) |
| The remaining elements and exact semantics. | UNKNOWN |

**Feelers** implements the five documented functions with these rules (the
exact rules are INFERRED / designed; tests in `tests/unit/series.test.ts`):

- **Wrap.** Moving forward past the active end returns to cell 1; moving in
  reverse past cell 1 returns to the last active cell.
- **END.** The series wraps at END. Cells after it are dormant (drawn hatched)
  and come back if END is moved or removed. This is how a column is "split":
  material can be parked after END.
- **LINK.** Moving forward onto LINK, the head jumps to the start of the next
  series of the same kind (bank order, wrapping), so series chain into longer
  ones, or into cycles. Moving in reverse past the start of a series whose
  predecessor contains a LINK, the head re-enters the predecessor just before
  that LINK.
- **SKIP.** The next value (or REST) in the head's direction of travel is
  jumped.
- **REST.** In Pitch, Velocity and Articulation series a REST is read like a
  value and makes the note silent (time still passes). In a Time series, REST
  marks the *following* time value as a silent gap, because a time value is
  still needed to know how long the silence lasts.
- **Loops** `[ ... ]×n`. The bracketed section plays n times in total (n from
  1 to 999). Loops nest. When a head runs in reverse, the brackets swap roles
  and share one counter, so loops still work backwards.
- **Reversing mid-stream.** When a head is reversed, it turns around on the
  cell it last read, so the next note comes from the neighbouring cell on the
  other side (no cell is repeated at the turn).
- **Starting positions.** Each head has a start cell and start direction, used
  by Start and by RESET. While the transport is stopped, HEAD HERE and the
  direction buttons edit these.

## 5. Randomisation

| Historical | Tag |
| --- | --- |
| Amount and Type: Type > 0 gives multiples of Amount up to Type; Type 0 gives gaussian changes. | DOCUMENTED (MT88) |
| Two columns set the probability that an element is randomised. | DOCUMENTED (MT88) |
| Two kinds of auto-randomise, "?" and inverted "?". | DOCUMENTED (MT88) |
| Pit and Tim limits restrict results. | DOCUMENTED (MT88) |
| What distinguishes the two kinds; whether randomisation is temporary or rewrites the series. | UNKNOWN |

**Feelers.** Each series has Amount, Type, Probability and Low/High limits
(limits apply to every value read, in all four kinds). Each value cell is
FIXED, **? WOBBLE** or **~ DRIFT**. When a flagged cell is read, with the
series' probability it is displaced: by `±Amount x k` with k uniform in
1..Type, or, if Type is 0, by a gaussian step with standard deviation Amount.
WOBBLE uses the displaced value for this note only; DRIFT writes it back, so
the series performs a random walk inside its limits. Mapping "?" and inverted
"?" to wobble and drift is an INFERRED interpretation.

All randomness comes from one seeded generator (mulberry32). Start reseeds it,
so a performance with the same interventions replays identically.

## 6. Live performance controls

| Control | Historical | Tag | Feelers |
| --- | --- | --- | --- |
| Pause (per line) | First control in each Line's row. | DOCUMENTED | PAUSE: the line stops reading and keeps how long it still had to wait; resuming carries on. |
| Mute (per line) | Present. | DOCUMENTED | MUTE: releases the sounding note; heads keep moving silently (INFERRED). |
| Direction | Arrows for Time, Pitch, Velocity, Articulation per line. | DOCUMENTED | → / ← per head; REV flips all four. |
| P | Plays the line's next note, e.g. when held up by a long note. | DOCUMENTED | NEXT: the next note is assembled now instead of waiting. While stopped it auditions one note. |
| Re | Restarts the line. | DOCUMENTED (excerpt) | RESET: heads back to start cells, the line starts again now. |
| Manual step / skip | Elements can be skipped manually. | DOCUMENTED (MM89) | STEP: with the line paused, plays exactly one note and advances. HEAD HERE moves a head to any cell. |
| MIDI channel | Per line. | DOCUMENTED | Per line, 1-16; changing it releases the sounding note on the old channel. |
| Program | Per line; optionally sent on Start. | DOCUMENTED | PROG per line, sent when changed and (option) on Start. |
| Pitch transposition | Per line. | DOCUMENTED | TRANS, semitones. |
| Velocity transposition | Per line. | DOCUMENTED | VEL±. |
| Time Adjust | Double/halve speed; in-between values drift ("phase music"). | DOCUMENTED | TIME×, a multiplier with presets ½ ⅔ ¾ 1 4⁄3 1½ 2 and fine steps of 0.005. |
| Advance/Delay | Sets lines' relative timing; delay holds back entry; Adjust during playback. | DOCUMENTED | SHIFT ◂ ▸: while stopped edits the entry delay; while playing moves the line 3 ticks (shift: a quarter) against the others. |
| Tempo | Global tempo. | DOCUMENTED (MIDI-AX slider) | BPM, applied from the scheduling horizon. |
| Last nine performances | Kept; could be saved. | DOCUMENTED (meaning UNKNOWN) | Takes: the last nine Start-to-Stop performances, downloadable as MIDI files. |

### Material versus performance

Feelers keeps the historical distinction between changing the **material**
(series values and control elements, the bank) and changing **how it is
performed** (heads, directions, line controls, tempo). Editing a series
changes what every line reading it will play the next time it reaches that
cell. Performance controls change one line's reading without touching the
material. While the transport is stopped, head directions, positions and
delays edit the **starting state** that Start returns to; while playing they
act on the performance only.

## 7. Transport

| Historical | Tag |
| --- | --- |
| A Start command exists (program changes can be sent each time Start is selected). | DOCUMENTED (MT88) |
| Global pause / continue, stop / reset semantics. | UNKNOWN |
| Synchronisation with external sequencers or drum machines. | DOCUMENTED (direction of sync UNKNOWN) |

**Feelers** (a deliberate, explicit modern design):

- **START**: reset to the defined starting state (heads at start cells and
  directions, loop counters cleared, seed reset, line pauses released, each
  line waiting its entry delay) and play. With CLOCK on: MIDI Start (FA),
  then Clock (F8) at 24 per quarter note.
- **PAUSE**: takes effect at the end of what is already scheduled (at most
  about 100 ms ahead), releases sounding notes, and keeps everything else,
  including each line's remaining wait. With CLOCK on: MIDI Stop (FC).
- **CONTINUE**: carries on from exactly the paused position. With CLOCK on:
  MIDI Continue (FB) and the clock resumes.
- **STOP**: silences immediately (queued messages are cancelled where the
  browser allows), releases every note, and resets to the beginning. With
  CLOCK on: MIDI Stop and Song Position Pointer 0.

MIDI Clock (timing pulses) and MIDI Start / Stop / Continue (transport
messages) are distinct and handled separately. Feelers sends clock; it does
not yet follow incoming clock (see UNCERTAINTIES and ARCHITECTURE).

## 8. Performance memories (modern extension)

Nine memories store the live performance state of all four lines: each head's
series, position and direction, pause, mute, transposition, velocity offset,
time adjust, plus tempo. Recalling one applies it from the scheduling horizon
without disturbing line timing. This answers the brief's "saving and recalling
performance states"; Fingers' own facility for this is UNKNOWN.

## 9. Things that are deliberately not reproduced

- The ST's internal sound chip voices and GIST sounds (Feelers offers a Web
  Audio preview instead).
- MIDI byte delay and Running Status options (handled by the browser and OS).
- Original screen layout, wording and graphics.
