# Historical fidelity audit

Status: research only. No source code or other documentation was changed in
this pass. Findings here supersede the evidence base described in
RESEARCH.md, BEHAVIOUR.md, UNCERTAINTIES.md, PROVENANCE.md and MIDI-AX.md, but
those files have deliberately not been edited yet; see "Documentation
corrections" below.

Audited code: `main` at `4f3f5ec` (engine, scheduler with external clock,
MIDI output, persistence, UI, demos, tests).

All historical material was read from a private source pack outside the
repository. Nothing from it is reproduced here beyond short identifying
phrases; sources are cited by document and section. The original manual and
example files are copyright works (the manual states copyright 1988, Emile
Tobenfeld, with copying restricted) and must not be committed.

---

## 1. Source inventory

| Key | File(s) provided | What it is | Classification |
| --- | --- | --- | --- |
| **FM** | `FINGERS1.TXT` (126 KB); identical copy inside `midiaxtx.zip`; `FINGERS.HYP` (ST-Guide build of the same text) | The Fingers user manual: Dr. T's personal note, Chapters 1 to 7, Appendices 1 and 2. Copyright 1988. Word-processor index markup survives in the text, so it appears to derive from the original manual source rather than OCR. Distributed with the MIDI-AX documentation set by Trond Einar Garmo. | **Full original documentation.** Version of Fingers not stated. |
| **AXM** | `MIDIAXE1.TXT` (77 KB) in `midiaxtx.zip`; `MIDIAXE.HYP` | "The MIDI-Ax Preliminary User's Reference", by Tobenfeld. Includes a section listing changes made to the Fingers part inside MIDI-AX. | **Full original documentation** (preliminary edition) for MIDI-AX. |
| **DOC** | 11 `.DOC` files in `fingstuf.zip` (`MUSICDRT/` by Dr. T, `MUSICJJ/` by Jim Johnson) | Performance notes for the example pieces from the original Fingers disk, per MyAtari 2003. | **Original documentation** (example notes). |
| **FIN** | 17 `.FIN` files in `fingstuf.zip` (13 from the original disk, 2 by Jacky Schreiber), 1 unidentified `PERC1226.TXZ` | Fingers score files, fixed 3744 bytes each. | **Original data files.** Examined for format and behaviour research only (section 6). Not run in any emulator. |
| **MT88** | `fingers_music_technology_1988.html` | Ian Waugh, "Dr T's Fingers", *Music Technology*, October 1988, pp. 80 to 82 (muzines archive page). | **Complete contemporary article.** |
| **MM89** | `battle_of_the_algorithms_1989.html` | Ian Waugh, "Battle of the Algorithms", *Micro Music*, April/May 1989 (Fingers and Tunesmith). | **Complete contemporary article.** |
| **MA03** | `myatari_midiax_2003.html`; `midiax.htm` (byte-identical copy) | "MIDI-ax: Mouse of a Different Color", *MyAtari* issue 30, April 2003, including Tobenfeld's own comments and a tutorial. | **Complete later article** (about MIDI-AX). |
| **TAMW** | `tamw_midiax_overview.html` | Tim Conrardy's MIDI-AX page with Trond Einar Garmo's description and a tutorial. | **Complete later web page** (about MIDI-AX). |

Not provided: the KCS manual, the MIDI-AX program files, any emulator
recording. Nothing was OBSERVED running.

Evidence tags used below:

- **DOCUMENTED**: stated in FM, AXM, DOC, MT88 or MM89 (full texts).
- **OBSERVED**: seen directly in the provided `.FIN` data (structure only).
- **INFERRED**: a reasoned reading not stated outright.
- **UNKNOWN**: not settled by the sources.

Where FM and a review disagree, FM wins. Where FM and AXM disagree, the
difference is a MIDI-AX change, not a Fingers fact.

---

## 2. Summary

The earlier research pass (search excerpts only) got the broad model right:
four monophonic lines, four parameter kinds, independent read positions,
per-parameter direction, Time Adjust phasing, Amount/Type randomisation,
Shift. The full manual shows that several of Feelers' *reconstructions* differ
from Fingers in ways that change what a faithfully entered Fingers score would
play:

1. **A note's Time value is the wait *before* that note**, not after it, and a
   note's length is computed from the *next* Time value.
2. **Series control elements are attributes attached to series elements**, not
   cells of their own. A Skip removes its host element from play without
   deleting the value. A Loop occupies an element slot. End of Series marks the
   last element of a series.
3. **The score is 13 (or 16) typed columns of up to 16 elements.** End of Series
   splits a column into several independent, usable series. Column Link is a
   per-column flag that joins the bottom of a column to the top of the next
   column of the same type to the right, wrapping.
4. **Loops** repeat everything from the series start (or the previous Loop) up
   to the Loop point; count 0 means forever; Loops are ignored by icons moving
   backwards. Feelers' bracket loops behave differently.
5. **Two rest types**, Rest and rest, differ in which line icons advance.
   Feelers has one.
6. **The two auto-randomise symbols differ only in which probability they
   use**, and auto-randomisation rewrites the stored value. Feelers' "wobble
   versus drift" reading of the two symbols is wrong.
7. **Fingers had no external sync input.** It could only send MIDI clock. The
   existing Feelers docs inferred the opposite. The EXT clock input is a
   legitimate modern extension and is not affected by this audit.

Many performance features are documented but missing: fixed values, advance
buttons, Save Starting Points, Restore Last Start, Reset variants, keypad
transposition, the program change table, shadows, undo and others.

External clock, MIDI note safety, the scheduler and the deliberate modern
extensions are not called errors here. Section 5 lists them.

---

## 3. Evidence matrix

Columns: **Claim** (historical) / **Source** / **Ev.** (evidence quality) /
**Feelers now** (code path and behaviour) / **Finding** / **Impact** (musical) /
**Conf.** (confidence in the finding) / **Suggested change**.

### 3.1 Score structure and series

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Four monophonic lines; each note from Time, Pitch, Velocity, Articulation. | FM Ch1 "How It Works"; MT88; MM89 | DOCUMENTED | `engine.ts` `assemble()`; four `LineRuntime`s | MATCH | Core | High | None. |
| S2 | Each line has four line icons (one per parameter) that move independently through series. | FM Ch1; MT88 | DOCUMENTED | `HeadState` per kind per line (`series.ts`) | MATCH | Core | High | None. |
| S3 | The score normally has 13 columns (option: 16); each column holds up to 16 elements. | FM Ch3 "Series and Columns"; FM Ch5 "Config/Clear"; MT88; AXM "Play screens" | DOCUMENTED; OBSERVED (FIN: 16 records of 16 slots) | 16 fixed series, 4 per kind, up to 64 cells (`types.ts` `MAX_CELLS`, `factory.ts` `fullBank`) | PARTIAL MATCH (count matches 16 mode; per-series length is an extension) | Medium | High | Model columns explicitly; allow 13/16; cap a column at 16 elements in a "historical" profile. |
| S4 | Any column can be any type; default is 4 Tim, 4 Pit, 4 Vel, then 1 S/L. Config/Clear changes types. | FM Ch3; FM Ch5 "Config/Clear"; MT88; FM tutorial (only one S/L series by default) | DOCUMENTED; OBSERVED (FIN type bytes vary per file, e.g. a file with no S/L column) | Fixed 4/4/4/4 bank | CONTRADICTION (layout); MISSING (Config/Clear) | Medium: original pieces use custom layouts | High | Configurable column types; default 4/4/4/1. |
| S5 | End of Series splits a column into two or more *separate series*, all usable. The End marker sits on the last element of a series and can coexist with another control element on that element. | FM Ch3 "Series and Columns", "Series Control Elements"; DOC AUTOMAT, SLOWFILE (sub-series made with End markers, one-element series) | DOCUMENTED | `END` is a cell; cells after it are dormant and unreachable (`activeLength()` in `series.ts`) | CONTRADICTION | High: a key composition and improvisation tool (trap icons in short chunks, park and redirect to sub-series) | High | Represent End as a per-element flag; a column becomes a list of series delimited by End flags; heads address (column, index). |
| S6 | Column Link is a flag on a column header: the bottom of the column continues at the top of the next column of the same type to the right, wrapping past the rightmost column. | FM Ch2 tutorial; FM Ch3 "Series Control Elements"; DOC GROOVE, BACHSTAB, CZ_DX; MT88 | DOCUMENTED; OBSERVED (FIN per-column link byte and next/previous same-type pointers) | `LINK` is a cell placed anywhere; forward jumps to next series of same kind; reverse handled by an inferred rule (`readHead()` `case 'link'`) | PARTIAL MATCH (direction of chaining matches; placement and granularity differ) | Medium | High | Column-level link flag; derive traversal from column order. Behaviour in reverse remains UNKNOWN (see 4.1). |
| S7 | Pit values are MIDI notes shown as note names, with the lowest octave written C- (C-1); Tim 1 to 999; Vel 1 to 127. | FM Ch3 "Series and Columns" | DOCUMENTED | Pitch 0 to 127 (C4 = 60); time 1 to 999; velocity 0 to 127 (`KIND_RANGE`) | MATCH (pitch, time); PARTIAL (Feelers allows velocity 0) | Low | High | Optional: restrict velocity series to 1 to 127 in historical profile. Note naming: FM's C4 is MIDI 60 under the KCS convention (INFERRED from "lowest key on a five octave keyboard is C2"), same as Feelers. |
| S8 | S/L values: 1 is staccato, 15 sustains until just before the next note, 16 or more overlaps. Note length is the next note's Tim times the current S/L divided by 16 (after time adjust, INFERRED). | FM Ch3; FM Ch6 "Steps per Beat and S/L Time Limits" | DOCUMENTED | Articulation is a percentage 1 to 400; duration = this note's time times percent / 100 (`assemble()`) | PARTIAL MATCH (equivalent ratio: S/L 16 = 100%; unit and scale differ; pairing differs, see T1) | Medium for score entry and import | High | Store S/L in sixteenths in a historical profile, or display both; convert on import. |
| S9 | Each line has an S/L Time Limit: maximum note length per line. | FM Ch6 | DOCUMENTED | None | MISSING | Low to medium (long notes over long gaps) | High | Per-line max duration. |

### 3.2 Note assembly and timing

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | A note's Tim value is the time from the start of the previous note to the start of *this* note (the wait comes before the note). | FM Ch1 "How It Works"; MT88 (explains the consequence for a written rhythm); FM Ch6 (length uses the *next* Tim) | DOCUMENTED | The time value read with a note sets the gap *after* it: `rt.nextTick = tick + time` (`engine.ts` `assemble()`) | CONTRADICTION | High for fidelity: every pitch/velocity/S-L value is paired with a different Time value than in Fingers. Low for self-authored Feelers scores (a fixed phase shift of the Time head). | High | Read the Time head first, wait, then sound the note; compute length from a peek at the following Time value. Decide first-note behaviour (T2). Provide a migration for existing projects. |
| T2 | After Start, each line waits its initial delay before starting. Whether the first Tim value also elapses before the first note is not stated. | FM Ch4 "Advance and Delay"; FM Ch5 "Start, Stop and Continue" | DOCUMENTED (delay); UNKNOWN (first Tim) | First note at the delay tick (`freshLine()`) | UNKNOWN | Medium | Medium | Choose and document; keep switchable until verified in an emulator. |
| T3 | Tim values are always in 24 steps per beat; Steps per Beat (24/48/96) only affects saved-file resolution and the precision of time-adjusted values (24 can produce fractional, inexact timing). | FM Ch6 "Steps per Beat" | DOCUMENTED | 24 ticks per quarter; fractional ticks kept exactly (`PPQ`, scheduler) | MATCH (units); EXTENSION (Feelers is more precise than Fingers at 24) | Low | High | None needed; optionally emulate quantisation in a historical profile. |
| T4 | Time Adjust (Tm) is an integer 1 to 999; actual time = Tim times Tm / 16; default 16. Left click changes by 1; right click doubles or halves; `[` doubles and `]` halves selected lines. | FM Ch4 "Time Adjustment"; FM Ch2; DOC SLOWFILE (Tm 61/64/67), STRANGE3 | DOCUMENTED | Float `timeScale`, presets and 0.005 steps (`lines.ts`) | PARTIAL MATCH (same maths; finer resolution is an extension; no per-line key control) | Low | High | Show Tm as an integer over 16; add double/halve keys with per-line enable (see P6). |
| T5 | Tempo 25 to 400 BPM via the tempo strip; arithmetic icons change by 1 or 12; Shift doubles or halves. | FM Ch5 "The Tempo Strip" | DOCUMENTED | BPM 10 to 400 stepper | PARTIAL MATCH | Low | High | Optional. |
| T6 | Overlapping notes are allowed (S/L 16 and above); the manual warns some synths misbehave. No monophony enforcement is described. | FM Ch3; DOC STRANGE3 (needs more than four voices because S/L is over 15) | DOCUMENTED (overlap allowed); INFERRED (no cut) | Strict monophony by default; LEGATO releases the old note just after the new note-on (`scheduler.ts` `handleNote()`) | CONTRADICTION (default), deliberate safety choice | Medium: long S/L overlaps in original pieces would be cut | High | Add an "overlap as written" mode that keeps each note's computed length, still within note-safety rules (same pitch re-strike cut first). |
| T7 | Out-of-range transposed pitch or velocity is brought back into range; velocity below 1 becomes 1 unless Mute Zero Velocities is on. | FM Ch4 "Pitch and Velocity Transposition"; FM Ch6 "MIDI Switches" | DOCUMENTED (velocity); UNKNOWN (pitch method) | Pitch folded by octaves; velocity 0 after offset is silent (`assemble()`) | PARTIAL MATCH; MISSING (option) | Low | Medium | Add Mute Zero Velocities option; default per FM (play at 1). |

### 3.3 Series control elements and traversal

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Exactly eight control elements: End of Series, Column Link, Loop, Skip, Rest, rest, and two Auto-randomise symbols. | FM Ch3 "Series Control Elements"; MT88 | DOCUMENTED | REST, SKIP, `[`, `]`, END, LINK, plus per-cell wobble/drift flags | PARTIAL MATCH | High | High | Adopt the documented set; retire the bracket model (keep as extension only if wanted). |
| C2 | Control elements are attached beside a host element (Skip on the right; others on the left; Column Link on the header). | FM Ch3 | DOCUMENTED; OBSERVED (FIN per-element code bytes and flags) | Control elements are separate cells that occupy steps and change indices (`Cell` union in `types.ts`) | CONTRADICTION | High: changes series lengths, head positions and editing | High | Per-element attribute model (see 7, batch 1). |
| C3 | Skip: the line icons skip *the host element*. Toggling Skip on and off keeps the value. A Skip overrides Loop, Rest or rest on the same element; beside End, the element is skipped but End still applies. | FM Ch2 tutorial; FM Ch3 | DOCUMENTED | SKIP cell skips the *next* value; turning a value cell into SKIP via the editor replaces the value (`app.ts` `setCellType`) | CONTRADICTION | High: the documented improvisation technique (prepare Skips on, say, all C#s, then remove them while playing) is not possible without losing values | High | Skip as a toggle flag on an element. |
| C4 | Loop: repeats all elements above the Loop point back to the series start or the previous Loop in that series, for the count in its data field; count 0 to 999, 0 loops forever. Placing a Loop on an element effectively deletes that element (it occupies the slot). Loops are ignored by icons moving backwards. | FM Ch3; FM Ch3 "Loop" option; FM Ch4 (redirecting to a Loop) | DOCUMENTED; OBSERVED (FIN stores Loop as a slot value of 10000 plus count, e.g. counts 1, 2, 4, 8, 96, 99, 160) | Bracket pairs `[ ... ]n`, n is total plays 1 to 999, nesting allowed, loops also run in reverse (`readHead()`) | CONTRADICTION | High: loop extents, counts and reverse behaviour all differ | High (structure); Medium (exact count meaning, see 4.1) | Implement documented Loop; decide whether count n means n extra passes or n total (UNKNOWN). Keep reverse-loop support only as an opt-in extension. |
| C5 | Rest and rest: either makes the line's next note silent. With Rest, only the Tim icon and the icon in the series holding the Rest advance; the other icons stay. With rest, all icons advance. | FM Ch3 | DOCUMENTED | One REST cell; every head advances every note; in a Time series REST makes the next time silent (`readHead()`) | CONTRADICTION / MISSING (Rest variant) | Medium to high: Rest shifts the alignment of the other series, which is musically distinctive | High | Two rest flags with documented advance rules. Whether the host element's value is consumed is UNKNOWN (see 4.1). |
| C6 | Direction arrows per icon; arrow down is forward, up is backward. | FM Ch4 "Fixed Values and Direction Arrows"; FM Ch2; MT88 | DOCUMENTED | `→`/`←` per head (`toggleDirection`) | MATCH | Core | High | None. Turnaround behaviour at reversal is UNKNOWN; Feelers' rule is a design choice. |
| C7 | Line select (L1 to L4 or F1 to F4) chooses which line the right mouse redirects; right click on an element moves that line's icon of that type there at once. Redirecting onto a Loop point jumps past it after the current loop. | FM Ch4 "Line Selection and Redirection"; FM Ch2 | DOCUMENTED | HEAD HERE buttons and series selector (`app.ts` `placeHead`, `assign`) | PARTIAL MATCH (capability present, different interaction) | Medium | High | Optional: selected-line plus click redirection as a fast performance gesture. |
| C8 | Fixed values: each line parameter can be pinned to a fixed value (shown with an asterisk) instead of following an icon; set by clicking the field, which takes the current element's value. Original pieces use fixed S/L values. | FM Ch4; DOC CZ_DX; OBSERVED (FIN example with no S/L column) | DOCUMENTED | None (workaround: a one-cell series) | MISSING | High for original material; medium otherwise | High | Per-line, per-parameter fixed value. Note: AXM says MIDI-AX removed this UI; it is a Fingers feature. |
| C9 | Advance buttons T, P, V, S, A per line step one icon (or all) one element in the arrow direction, without playing; Control adds the Tim icon. Right click makes the icon jump to the next or previous series of that type when it reaches the end of its current series. | FM Ch4 "Advance and Delay"; MM89 (manual skipping); DOC SLOWFILE | DOCUMENTED | STEP plays a note; no silent per-icon advance; no series jump | MISSING | High: central live technique for re-aligning lines | High | Add per-icon advance and the series-jump arm. |

### 3.4 Randomisation

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Amount and Type per *parameter type* (four sets). Type > 0: change is plus or minus Amount times k, k from 1 to Type, all equally likely. | FM Ch6 "Randomization"; MT88 | DOCUMENTED | Per *series* settings; same Type > 0 rule (`randomDelta()`) | MATCH (distribution); PARTIAL (scope) | Low to medium | High | Move settings to per-kind in historical profile, or allow per-series as extension. |
| R2 | Type 0: gaussian; the average size of the change is roughly Amount; signs equally likely. | FM Ch6; MT88 | DOCUMENTED | Gaussian with standard deviation Amount (mean absolute change about 0.8 x Amount) | PARTIAL MATCH | Low | Medium (FM gives an example, not a formula) | Scale so mean absolute change is about Amount (sd about 1.25 x Amount). |
| R3 | The two auto-randomise symbols differ only in having separate probability settings (per parameter type) on the Options screen. Placed with Shift or Alternate in Ran mode. | FM Ch3; FM Ch3 "Randomize"; FM Ch6; AXM "Fing Rand" slider type (two probabilities) | DOCUMENTED | `?` WOBBLE (temporary) vs `~` DRIFT (persistent); one probability per series (`series.ts`, `editor.ts`) | CONTRADICTION | Medium: UI, docs and behaviour misrepresent the original | High | Two probability settings, symbols `?` and inverted `?`. Keep WOBBLE only as a labelled Feelers extension. |
| R4 | Auto-randomisation changes the stored element (values drift and must be restored via Shadows, Backups or Restore Last Start). | FM Ch3 (tonal centre changes over minutes); FM Ch5 "Restore Last Start"; FM Ch7; DOC AUTOMAT, FB01BELZ, CZ_DX | DOCUMENTED (via the original example notes) | DRIFT persists; WOBBLE does not | PARTIAL MATCH | Medium | High | Both historical symbols persist. |
| R5 | Minimum Time: randomised Tim values never go below it. Pitch Limit: randomised Pit values stay within the range the series had when Fingers started, widened by Pitch Limit semitones. Limits apply to randomisation only. | FM Ch6; MT88 | DOCUMENTED | Absolute per-series low/high limits applied to *every* value read, randomised or not (`readHead()` clamps) | CONTRADICTION | Medium: Feelers silently changes non-random values outside limits | High | Apply limits only to randomised output; implement Minimum Time and relative Pitch Limit. |
| R6 | Ran series option: clicking an element replaces it with a random value once. | FM Ch3 "Randomize" | DOCUMENTED | None | MISSING | Medium | High | Add one-shot randomise. |
| R7 | Shift applies to Tim changes made by arithmetic icons and randomisation (not typed edits) and never changes series length; changes to the final Tim element of a series are refused. | FM Ch5 "UNDO, <> and Shift"; FM Ch7; DOC AUTOMAT3 | DOCUMENTED | `shiftEdit` applies to every `setValue` including typed values; last element compensates nothing; randomisation ignores Shift (`engine.ts` `setValue`) | CONTRADICTION (scope) | Medium (keeps rhythmic cycles locked, which the docs rely on) | High | Apply Shift to steps and randomisation, not typing; lock final element. |
| R8 | Randomness is not described as repeatable. | FM | UNKNOWN | Seeded, repeatable from Start | EXTENSION | n/a | n/a | Keep (Feelers extension). |

### 3.5 Line displays and live controls

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | PA: icons stop and the line is silent; releasing PA starts the line playing immediately (players are told to click in time). MU: icons keep moving, line silent. F7 to F10 toggle MU. | FM Ch4 "Pause and Mute"; FM Ch2 | DOCUMENTED | PAUSE preserves the remaining wait and resumes after it; MUTE matches (`setPaused`, `toggleMute`) | PARTIAL MATCH (pause release timing) | Medium | High | Release PA plays the next note at once (historical); keep "resume remaining wait" as an option. |
| L2 | P plays the line's next note immediately; right click on any P makes all four lines play their next note (resync). | FM Ch4 "Save Starting Points, Play and Reset"; FM Ch7; MT88 | DOCUMENTED | NEXT per line; no all-lines variant | PARTIAL MATCH | Medium | High | Add all-lines P. |
| L3 | Re restarts the line: left click resets only the Tim icon, right click resets all icons. | FM Ch4 | DOCUMENTED | RESET resets all four heads (`resetLine`) | PARTIAL MATCH | Low to medium | High | Add Tim-only reset. |
| L4 | S (Save Starting Points) stores the line's current icon positions as its starting points; Reset Starts does it for all lines. Start jumps icons to their starting points. | FM Ch4; FM Ch5 "Reset Starts" | DOCUMENTED | Start positions only editable while stopped via HEAD HERE / direction (`placeHead`) | MISSING (live capture) | Medium | High | Add S per line and Reset Starts. |
| L5 | Restore Last Start returns everything on the main screen (including all series values) to its state when Start was last pressed; a second click undoes it. | FM Ch5 | DOCUMENTED | None | MISSING | High given persistent randomisation | High | Snapshot score and line displays at Start; toggle restore. |
| L6 | Per-line MIDI channel (left 1, right 4) and program (below zero = none). Program sent at Start (option) or immediately if playing; program changes received at MIDI in update the display. | FM Ch4 "MIDI Channel and Program Number"; FM Ch6 | DOCUMENTED | Channel and program per line; sent on change and optionally on Start; no input reflection | PARTIAL MATCH | Low | High | Optional: reflect incoming program changes. |
| L7 | PT and VT transposition per line (PT steps 1 or 12, VT steps 4 or 16). Numeric keypad sets PT to an absolute semitone and octave for selected lines; arrow keys change PT or VT by programmable amounts; per-line enable switches. | FM Ch4 "Pitch and Velocity Transposition", "The Transposition Keys"; FM Ch6 "Line Transpose Selectors"; DOC CZ_DX; MA03 and TAMW tutorials (keypad in MIDI-AX's Fingers part) | DOCUMENTED | TRANS and VEL± per line; no keys | PARTIAL MATCH; MISSING (keys) | Medium (a primary documented performance gesture) | High | Keypad and arrow transposition with per-line enables. |
| L8 | Advance/Delay line: initial delay per line (steps 1/6, with Control 24/96); `+`/`-` shift the current note by 1 or 3 steps without changing the delay. | FM Ch4 "Advance and Delay"; MT88 | DOCUMENTED | Entry delay and live SHIFT by 3 or 24 ticks (`app.ts` `nudge`) | MATCH (function); PARTIAL (step sizes) | Low | High | Match step sizes. |

### 3.6 Transport, recording, MIDI and files

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | Start: icons jump to starting points, delays run, unpaused lines play; Start while playing resets. Con: continue from current positions, no delays. Stop halts without resetting positions. Keys: Shift-Space, Tab, Shift-Return. | FM Ch5 "Start, Stop and Continue" | DOCUMENTED | INT: START (reset), PAUSE/CONTINUE (keep), STOP (reset) | PARTIAL MATCH: Fingers Stop then Con equals Feelers Pause then Continue; Feelers STOP resetting is a deliberate modern semantic | Low | High | Keep; document the mapping. Optionally add Con after Stop. |
| M2 | Send MIDI Clock option; Start, Con and Stop then drive an external sequencer. | FM Ch6 "MIDI Switches"; FM Ch7 "Using Fingers with an External Sequencer" | DOCUMENTED | CLOCK out with FA/FB/FC (INT) | MATCH | n/a | High | None. |
| M3 | **Fingers does not accept an external sync source.** The MT88 phrase about synchronising with external devices refers to clock output. | FM Ch7 "Using Fingers with an External Sequencer" | DOCUMENTED | SYNC EXT follows external clock | EXTENSION (correctly labelled modern in PROVENANCE; wrongly inferred as historical "likely slave" in UNCERTAINTIES #22 and RESEARCH) | n/a | High | Keep EXT. Correct the docs. |
| M4 | MIDI input is merged into the output (thru), optionally recorded; Rec/Rep enter pitch and velocity from a MIDI keyboard; the manual warns about MIDI loops. | FM Personal Note; FM Ch1 "Equipment Hookup"; FM Ch3 "Record and Replace"; FM Ch6 | DOCUMENTED | No thru; input used only for clock | MISSING | Low (thru) to medium (Rec/Rep) | High | Rec/Rep worth adding later; thru optional and must respect EXT clock and loop safety. |
| M5 | Fingers records continuously; Save Seq lists up to nine sequences (newest first). A new sequence starts at Start, or at Con after visiting the menu; Con without the menu continues the same recording. Options record tempo changes, program changes and external MIDI. Saved as KCS/MRS formats (.SEQ, .ALL); SMF via a separate converter. | FM Personal Note; FM Ch6 "Disk I/O and Recording", "Recording Switches"; MT88 | DOCUMENTED | Takes: last nine Start-to-Stop performances, SMF export (`takes.ts`) | PARTIAL MATCH; EXTENSION (SMF) | Low | High | Optionally match take-splitting rules and record program changes. |
| M6 | Program Change Table: 40 presets of four programs, recalled by QWERTY keys (not while editing); Escape plus key stores the current four. | FM Ch5 "Prog Change Table"; DOC AUTOMAT | DOCUMENTED | None | MISSING | Medium for performance with hardware | High | Add later. |
| M7 | MIDI Slow and Running Status options. | FM Ch6 | DOCUMENTED | Not applicable (browser/OS) | n/a | n/a | High | None. |
| M8 | Internal ST sound chip voices (3) assignable to channels. | FM Ch5 "Internal Sounds"; MT88; MM89 | DOCUMENTED | Web Audio preview (listener on MIDI stream) | EXTENSION (substitute) | n/a | High | None. |
| M9 | .FIN files store score, line displays, starting points, program table, column configuration and Options; not shadows, backups or internal sounds. DEFAULT.FIN loads at boot. | FM Ch6 "Disk I/O and Recording" | DOCUMENTED; OBSERVED (format, section 6) | JSON project format | EXTENSION | n/a | High | Optional future importer (section 6). |

### 3.7 Editing

| ID | Claim | Source | Ev. | Feelers now | Finding | Impact | Conf. | Suggested change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | Eleven series options: Edit, Rest, Skip, Loop, Ran, Copy, Swap, Adj, Rec, Rep, Shad. | FM Ch3 "Series Options and Editing the Score" | DOCUMENTED | Edit bar with element type buttons, insert/delete, rotate, retrograde, offset | PARTIAL MATCH | Medium | High | Add Copy, Swap, Adj, Ran; Rec/Rep with MIDI input. |
| E2 | Typed entry: pitch letters, octave and sharp in any order; numeric fields edit by digit position; Insert, Delete, Clr Home (blank an element), Return moves on. | FM Ch3 "Edit" | DOCUMENTED | Typed note names or numbers; Insert/Delete | PARTIAL MATCH | Low | High | Blank-element support needed for attribute model. |
| E3 | Step sizes: invisible icons (enabled by `<>`) change Pit 1/12, Tim 1/3, Vel 4/16, S/L 1/4; expanded icons 1, 3, 12, 24. | FM Ch1; FM Ch3; FM Ch5 | DOCUMENTED | Up/down 1, shift 12 (pitch) or 10 | PARTIAL MATCH | Low | High | Optional. |
| E4 | UNDO toggles the last single edit, randomisation, copy, swap or shadow operation. | FM Ch5 | DOCUMENTED | None | MISSING | Medium | High | Add single-level undo (multi-level as extension). |
| E5 | Shadows: a hidden alternate value per element; Shad recalls, Shift-click copies to shadow, Alternate-click swaps; Save Shadows copies all. Not saved in files. | FM Ch3 "Shad"; FM Ch5 "Save Shadows"; DOC FB01BELZ, CZ_DX, STRANGE3 | DOCUMENTED | None (performance memories are a different, modern feature) | MISSING | Medium: the documented way to recover from drift and to switch key or chord quality | High | Add shadows. |
| E6 | Backup Series / Get Backups swap series with backups. Column Copy and Swap (column type follows source). | FM Ch5 | DOCUMENTED | None | MISSING | Low | High | Later. |
| E7 | Copy From KCS: first 16 notes of a KCS sequence into series. | FM Ch5, Ch6 "Fingers and the MPE"; DOC BACHSTAB | DOCUMENTED | None | n/a (no KCS) | Low | High | A future "import first 16 notes from SMF" would be the modern analogue. |

---

## 4. Evidence gaps

### 4.1 Still unresolved for Fingers

- Whether the first Tim value elapses before a line's first note after Start (T2).
- Loop count meaning: total passes or repeats after the first (C4). FM says the elements are repeated "for the number of times" in the field; FIN files use counts such as 1 and 8, which does not settle it.
- What a Rest, rest or Skip host element contributes: whether its own value is read and discarded, and whether a Rest on a Tim element differs.
- Exact traversal when an icon moving backwards meets a Column Link boundary, an End marker, or a Loop point (Loops are documented as ignored; the others are not).
- Behaviour at the instant of reversal (which element plays next).
- Pitch out-of-range handling (clamp or fold) after transposition.
- Whether overlapping same-pitch notes on one line are cut.
- The exact Gaussian scaling used.
- Which `.FIN` code value maps to which control element (section 6).
- Fingers version history (FM is undated beyond copyright 1988).

Each of these can be settled by running Fingers or the Fingers part of
MIDI-AX in an emulator (Hatari or STEem; TAMW reports STEem works with
MIDI-AX) and logging MIDI output for small test scores. Several can also be
narrowed by decoding the `.FIN` examples against their `.DOC` descriptions.

### 4.2 MIDI-AX facts that must not be attributed to Fingers

From AXM "Fingers Changes" and the MIDI-AX sections:

- **Line linking**: two link objects per line. A link fires after every note or
  when the Time series recycles; `*` schedules the linked line's next note after
  its initial delay; T, P, V, S move the linked line's icons to the tops of their
  columns, ignoring column links. (This settles what TAMW's "linking to other
  lines" means.) MIDI-AX only.
- **Fixed-value fields removed** from the line display in MIDI-AX (fixed values
  only via one-element series). Fingers had them.
- **Fingers lines can start KCS sequences** (program numbers 112 to 127; S/L
  reused as a sequence number). MIDI-AX only.
- **Sliders** (42) can set Fingers elements, transposes, mutes, minimum
  velocity and randomisation probability/amount, and Fingers lines can drive
  sliders. MIDI-AX only.
- Redirection with modifier keys linking several icons of one line. MIDI-AX
  only.
- Shift-click on a rest element restores play. MIDI-AX only.
- Gestures, holds, mouse states, key overrides, tempo tables, tap tempo, song
  playback. MIDI-AX only.
- TAMW's "time division" in the line display is not a term in AXM; it most
  likely refers to the existing Tm control (INFERRED).

### 4.3 Previous Feelers documentation now known to be wrong or outdated

(Not edited in this pass.)

- RESEARCH.md: all claims were from excerpts; full texts now exist. "13 or 16
  columns" is DOCUMENTED for Fingers itself.
- BEHAVIOUR.md sections 2 to 5: time pairing (T1), control elements (C2 to C5),
  End and Link (S5, S6), randomisation symbols (R3, R4), limits (R5).
- UNCERTAINTIES.md: items 3 to 9, 11 to 19, 21 to 23 and 25 to 26 are now
  answered (most as contradictions of the inferred rules). Item 22 is wrong:
  Fingers had no external sync input.
- PROVENANCE.md: rows for END/LINK/loops/REST, WOBBLE/DRIFT, limits and line
  controls need reclassifying.
- MIDI-AX.md: line linking and the Fingers changes are now DOCUMENTED.

---

## 5. Deliberate Feelers extensions (not defects)

These are modern additions or substitutions and should stay, clearly
labelled, unless the owner decides otherwise:

- External MIDI Clock input (SYNC EXT) with FA/FB/FC handling and clock-loss
  behaviour; clock out disabled while following.
- Note-safety layer: id-based note pairing, panic, cancellation-safe release,
  device-loss handling; lookahead scheduler.
- Seeded, repeatable randomness.
- Performance memories 1 to 9 (MT88 notes Fingers lacked M-style snapshots).
- Audio preview (substitute for the ST sound chip).
- Takes as Standard MIDI Files.
- Rotate, retrograde and value-offset series tools.
- Series longer than 16 elements, LEGATO toggle and strict monophony as a
  safety default, finer Time Adjust resolution.
- WOBBLE randomisation (non-persistent), once relabelled as a Feelers mode.
- Bracket loops, nested loops and reverse-running loops, if retained, as an
  explicitly non-historical mode.
- JSON project format, autosave, browser library, contextual help.

---

## 6. `.FIN` format notes (OBSERVED, partial)

From the 17 provided files (all 3744 bytes). Values are big-endian
(Motorola 68000).

- Bytes 0 to 1: header (zero in all files examined).
- Then 16 column records of 172 bytes each (bytes 2 to 2753):
  - byte 0: column type (0 Tim, 1 Pit, 2 Vel, 3 S/L).
  - byte 1, byte 2: index of the next and previous column of the same type
    (a ring; 255 when the column is the only one of its type).
  - byte 3: Column Link flag (1 = linked), matching the pieces whose notes say
    they use Column Links.
  - 16 x 16-bit element values; 65535 = blank. Values of 10000 + n are Loop
    elements with count n.
  - A 16-byte per-element code array (values 1 to 4 seen; INFERRED to encode
    Rest, rest and the two Auto-randomise symbols; mapping UNKNOWN).
  - A 16-word block that mirrors the element values in some files and is zero
    in others (UNKNOWN: possibly saved shadow or start-state copies, although
    FM says shadows are not saved).
  - Per-element flag bytes (value 1 seen; INFERRED to include End of Series
    and Skip; mapping UNKNOWN).
- Bytes 2754 to 3743 (990 bytes): line displays, starting points, Options,
  program change table and global settings; not decoded.

AXM states MIDI-AX `.FIN` files are almost identical to Fingers' own, so one
importer could cover both. An importer is feasible but low priority, and the
original files must never be bundled; user-supplied files only.

---

## 7. Discrepancies by priority

Priorities: **P0** contradicts a core documented rule of note assembly or score
structure, so a faithfully entered Fingers score plays differently. **P1** a
documented feature central to performance practice is missing or wrong.
**P2** secondary documented feature or parameter detail. **P3** peripheral,
hardware-era or cosmetic.

| Pri | ID(s) | Discrepancy | Expected regression-test approach |
| --- | --- | --- | --- |
| P0 | T1 (+T2) | Time value precedes its note; length uses the next Time value. | Engine unit tests: Tim [24, 12], Pit [C4, D4]: assert onset times, pitch pairing and durations (next Tim x S/L / 16); reversal and Time Adjust variants; golden sequences for each demo after migration. Scheduler and external-clock suites must pass unchanged (they compare scheduler output with engine output). |
| P0 | C1, C2, C3 | Control elements as attributes of host elements; Skip skips its host and keeps the value. | Model tests: toggling Skip does not change values, indices or head positions; skipped element never read in either direction; Skip overrides Rest/rest/Loop on same element; Skip beside End keeps End. |
| P0 | S5, S6 (+S3, S4) | Columns of up to 16 typed elements; End splits a column into independent series; Column Link is a column flag chaining to the next same-type column (wrap). | Traversal tests: icon wraps at End to its own sub-series start; icons in different sub-series of one column are independent; linked columns behave as one series; wrap-around link from rightmost column; redirect into a sub-series. |
| P0 | C4 | Loop semantics: region from series start or previous Loop; count 0 = infinite; occupies a slot; ignored backwards. | Tests for single and consecutive Loops, count 0, redirect onto a Loop point, backward traversal ignoring Loops; parametrised for the count interpretation once decided. |
| P0 | C5 | Rest vs rest advance rules. | Tests that Rest advances only Tim and the host series' icon while others hold; rest advances all; both silence exactly one note; interaction with Skip. |
| P0 | R3, R4 | `?` and inverted `?` are two probabilities (per parameter type); both persist. Feelers' WOBBLE/DRIFT labels misdescribe them. | Statistical tests per symbol with separate probabilities; persistence of change; determinism with seed; WOBBLE extension tested separately. |
| P1 | R5 | Limits apply to randomised values only; Minimum Time; Pitch Limit relative to series range captured at Start. | Non-randomised out-of-range values pass unchanged; randomised Pit stays within captured range +/- limit; Tim never below minimum. |
| P1 | C8 | Fixed values per line parameter. | A line with fixed S/L plays constant articulation while other icons move; setting from current element; deleting under an icon falls back to fixed. |
| P1 | C9 | Advance buttons (silent icon step, all-icons, Control+Tim) and right-click series jump. | Head positions after advance without note output; series-jump arm takes effect at end of current series in arrow direction. |
| P1 | L4, L5 | Save Starting Points, Reset Starts, Restore Last Start. | Start returns to saved points; Restore Last Start restores series values changed by edits and auto-randomisation; second restore undoes. |
| P1 | T6, S8, S9 | S/L in sixteenths; overlapping notes as written; per-line S/L time limit. | Duration tests at S/L 1, 15, 16, 24; overlap mode keeps both notes sounding with correct offs (pairing check); limit caps duration; strict mode unchanged. |
| P1 | E4, E5 | Undo toggle and Shadows. | Undo toggles last edit/randomise/copy/swap/shadow; shadow copy/swap/recall per element and Save Shadows. |
| P1 | M3 docs | Docs claim Fingers probably synced to external clock. | Docs-only change; no code test. |
| P2 | L1, L2, L3 | Pause release plays at once; P all lines; Re Tim-only. | Timing tests for unpause; all-lines P resync; Tim-only reset leaves other heads. |
| P2 | L7, T4 | Keypad absolute and arrow relative transposition, `[`/`]` double/halve, per-line enables; integer Tm. | Key handler unit tests on App; per-line enable masks; Tm 8/16/32 equivalences. |
| P2 | R1, R2, R6, R7 | Per-type randomisation settings; Gaussian scale; Ran one-shot; Shift scope and final-element lock. | Mean absolute change near Amount for Type 0; Ran changes one element once; Shift ignores typing and refuses last-element change. |
| P2 | E1, E2, E6, M4 (Rec/Rep), M6 | Copy/Swap/Adj, blank elements, backups and column copy/swap, Rec/Rep from MIDI input, program change table. | Unit tests per operation; Rec/Rep with simulated MIDI input (browser test). |
| P2 | S4 | Configurable column types and 13/16 column mode; default 4/4/4/1. | Project normalisation tests; migration of existing projects. |
| P3 | T5, L8, E3, T7, L6, M5, M1 | Step sizes, tempo range, Mute Zero Velocities, program-change input reflection, take-splitting rules, Con after Stop. | Small unit tests each. |
| P3 | M9 / section 6 | `.FIN` importer (user-supplied files only). | Round-trip of synthetic test files built from the documented layout; no original files in the repository. |

---

## 8. Suggested next implementation batch

Batch 1, "historical score model" (engine and data model only):

1. Introduce a project format v2 with columns, per-element attributes (Skip,
   Rest, rest, auto-randomise `?` and inverted `?`, End) and Loop slots, and
   column-level links; migrate v1 projects (cells to attributes where a direct
   mapping exists; otherwise flag for review). Re-author the five demos.
2. Time-before-note assembly (T1) with a documented decision on T2, and S/L in
   sixteenths with lengths from the next Time value (S8).
3. Documented Loop, Rest/rest and Skip semantics (C3 to C5), End sub-series and
   Column Link traversal (S5, S6).
4. Auto-randomise per FM: two probabilities per parameter type, persistent
   changes, limits only on randomised values, Minimum Time and Pitch Limit
   (R1 to R5). Keep WOBBLE as an opt-in, labelled extension.
5. Restore Last Start (L5), because persistent randomisation needs it.

Constraints for that batch: the scheduler, external clock, note-safety layer
and their tests stay untouched; the engine keeps emitting the same
`NoteEvent` shape so the scheduler and EXT clock suites remain valid. Existing
unit tests for the old rules will need replacing, not deleting silently: each
replaced test should be paired with a new test for the documented rule.

Batch 2: fixed values, advance buttons, Save Starting Points, P/Re/PA
variants, overlap-as-written mode, transposition keys, Undo, Shadows.

Batch 3: Ran, Copy/Swap/Adj, Rec/Rep, program change table, column
configuration, optional `.FIN` import.

Before or alongside batch 1, an emulator session with a few small test scores
would settle most of section 4.1 and would let several INFERRED rules become
OBSERVED.

---

## 9. Source index

Citations only; no reproductions.

- Emile Tobenfeld, *Fingers* user manual, Dr. T's Music Software, copyright
  1988 (text as distributed in the MIDI-AX documentation set, `FINGERS1.TXT`,
  and ST-Guide `FINGERS.HYP`). Cited as FM with chapter and section.
- Emile Tobenfeld, *The MIDI-Ax: Preliminary User's Reference* (`MIDIAXE1.TXT`,
  `MIDIAXE.HYP`). Cited as AXM with section.
- Original Fingers example notes (`*.DOC`) and score files (`*.FIN`) from the
  `FINGSTUF.ZIP` collection linked from MyAtari issue 30. Cited as DOC
  (filename) and FIN.
- Ian Waugh, "Dr T's Fingers", *Music Technology*, October 1988.
  <https://www.muzines.co.uk/articles/dr-ts-fingers/373>
- Ian Waugh, "Battle of the Algorithms", *Micro Music*, April/May 1989.
  <https://www.muzines.co.uk/articles/battle-of-the-algorithms/5195>
- "MIDI-ax: Mouse of a Different Color", *MyAtari* issue 30, April 2003.
  <https://www.exxosforum.co.uk/atari/mirror/myatari/issues/apr2003/midiax.htm>
- Tim Conrardy and Trond Einar Garmo, "The MIDI AX", Tim's Atari MIDI World.
  <https://exxosforum.co.uk/atari/mirror/tamw/midiax.htm>
