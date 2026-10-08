# Research: Dr. T's Fingers and MIDI-AX

This document records what was found about the historical systems that
inspired Feelers, where it came from, and how reliable it is. The systematic
behavioural model is in [BEHAVIOUR.md](BEHAVIOUR.md); open questions are in
[UNCERTAINTIES.md](UNCERTAINTIES.md); how Feelers uses all of this is in
[PROVENANCE.md](PROVENANCE.md).

## Status (October 2026): partly superseded

This document records the **first** research pass, made from search
excerpts only. The full Fingers manual and other complete sources were later
examined in the historical audit ([HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md)),
which supersedes this file wherever they differ. The main corrections:

- A Time value is the wait *before* its note; a note's length uses the *next*
  Time value; S/L is in sixteenths.
- Series control elements are marks on elements; Skip skips its own element;
  Rest and rest differ in which heads advance; End splits a column into
  usable series; Column Link is a column flag; Loops run from the series start
  or the previous Loop and are ignored backwards.
- The two auto-randomise marks differ only in their probabilities and both
  keep their changes; limits apply only to randomised values (Minimum Time,
  relative Pitch Limit).
- **Fingers did not follow an external clock**; "synchronise with external
  sequencers" referred to sending MIDI clock (FM ch. 7).

The text below is kept as the record of what was known at the time.

## How this research was done (first pass)

The first research pass was carried out from a cloud build container whose
network policy blocked direct access to the key archive hosts
(`muzines.co.uk`, `exxosforum.co.uk`, `archive.org`, `atarimagazines.com`,
`soundonsound.com`). The pages could not be fetched or read in full.

What *was* available was a web search service that returns short excerpts and
summaries of those same pages. Every historical claim below was obtained that
way: from excerpts of the cited articles, cross-checked where several excerpts
or several articles agreed. No original software, disk image or manual was
obtained, run or examined, and nothing was observed first hand.

Consequences:

- Claims marked **DOCUMENTED** are supported by an excerpt attributed to a
  named historical source. They have not been checked against the complete
  article text. A summarising search tool can paraphrase badly, so these
  should be re-verified (see the checklist at the end).
- There are **no OBSERVED** claims in this pass. Observation would require
  running Fingers or MIDI-AX in an emulator (for example Hatari) with a
  legitimately obtained copy, which was out of reach here.
- Short phrases quoted below are quoted from excerpts for identification and
  commentary only. No substantial text from any manual or article is
  reproduced.

Classification used throughout the docs:

| Tag | Meaning |
| --- | --- |
| DOCUMENTED | Explicitly supported by historical documentation (here: by excerpts of named sources). |
| OBSERVED | Confirmed by legitimate testing or demonstration. (None yet.) |
| INFERRED | A reasonable reconstruction supported by the available evidence. |
| UNKNOWN | Insufficient evidence. |

## Historical overview

**Emile Tobenfeld** ("Dr. T"), who holds a PhD in theoretical physics, founded
Dr. T's Music Software in Massachusetts in 1984. The company produced MIDI
software for the Commodore 64/128, Atari ST, Amiga, IBM PC and Macintosh,
including the KCS (Keyboard Controlled Sequencer) family, the Multi Program
Environment (MPE), and several algorithmic tools: its own **Fingers**, Jim
Johnson's **Tunesmith**, and a licensed version of Laurie Spiegel's **Music
Mouse**; the MIDI Association article also lists Intelligent Music's **M**
among the generative tools the company released. Tobenfeld later worked mainly as
a video artist and VJ. In 2026 the MIDI Association presented him with a MIDI
Lifetime Achievement Award.

**Fingers** (Atari ST, 1988) was subtitled "the Interactive Composition
Program". Reviews report Tobenfeld's stated aim: an instrument-like program that
could be played in the same sense as a keyboard, guitar or saxophone, and that
people without musical training could use. It ran inside Dr. T's MPE, either
standalone or alongside KCS, in medium or high resolution.

**MIDI-AX** (also written MIDI-ax, MIDI-Axe) is described by Tim Conrardy as
"the second generation of the program originally released as Fingers". It was
developed by Tobenfeld largely for his own use, was not commercially marketed,
and was released as shareware in March 2001 on the condition that users bought
one of Tobenfeld's videos. It combined a Fingers-style algorithmic engine with
an alternate mouse controller in the spirit of Music Mouse, running as an MPE
module within KCS (Omega).

## Sources

Primary and contemporary (reviews written while the software was current):

1. Ian Waugh, "Dr T's Fingers", *Music Technology*, October 1988, pp. 80-82.
   <https://www.muzines.co.uk/articles/dr-ts-fingers/373>
   The most detailed source found: series, Line icons, control elements, line
   controls, randomisation, options. (Referred to below as **MT88**.)
2. Ian Waugh, "Battle of the Algorithms", *Micro Music*, April/May 1989,
   pp. 66-69 (Fingers compared with Tunesmith).
   <https://www.muzines.co.uk/articles/battle-of-the-algorithms/5195>
   (**MM89**.)
3. Jim Pierson-Perry, "The Doctor Is In", *START* Vol. 3 No. 9, April 1989
   (profile of Tobenfeld). <https://www.atarimagazines.com/startv3n9/drt.html>
4. "Dr T's Tunesmith", *Music Technology*, January 1989, and the *START*
   Tunesmith review "Variations on a Theme" (context: Dr. T's timing units;
   Tunesmith counts 24 clocks per beat).

Later secondary sources (written about MIDI-AX, which contains Fingers):

5. Tim Conrardy, "Midi AX", *Tim's Atari MIDI World* (TAMW), mirrored at
   <https://exxosforum.co.uk/atari/mirror/tamw/midiax.htm>. (**TAMW**.)
6. "MIDI-ax: Mouse of a Different Color", *MyAtari* issue 30, April 2003.
   <https://www.exxosforum.co.uk/atari/mirror/myatari/issues/apr2003/midiax.htm>
   (**MyAtari03**.)
7. Derek Johnson, "Dr T's MIDI-Ax", *Sound On Sound*, June 2001 (Atari Notes).
   <https://www.soundonsound.com/techniques/dr-ts-midi-ax> (**SOS01**.)
8. Tim Conrardy, "Exploring Algorithmic Music", *MyAtari*, January 2001.
   <https://exxosforum.co.uk/atari/mirror/myatari/issues/jan2001/music.htm>

Background:

9. "Dr. T's Music Software", Wikipedia.
10. Athan Billias, "Emile Tobenfeld, Dr. T's Music Software, and the Frontiers
    of Algorithmic Creativity", MIDI Association, 2026.
11. Biography page, people.csail.mit.edu/jrb/cc/people/tobenfeld/.

Not obtained: the Fingers manual (reportedly written by Jim Johnson), the
MIDI-AX documentation (TAMW lists TXT and ST-Guide versions), any disk image.

## Significant findings

### The musical model (Fingers)

- Output is **four monophonic Lines**. Every note of a Line is created from
  four note parameters: **Time, Pitch, Velocity and Articulation**. (MT88,
  MM89. DOCUMENTED.)
- **Time is an inter-onset interval**: the gap from the start of the previous
  note to the start of the current one, not a note length. (MT88. DOCUMENTED.)
- **Articulation** governs phrasing / note length; its series is labelled S/L
  (staccato/legato, or short/long). (MT88, MM89. DOCUMENTED.) Its units are
  UNKNOWN.
- The values come from **Parameter Series** of four types, headed **Tim, Pit,
  Vel and S/L**, drawn as vertical columns in the upper part of the screen.
  (MT88, MM89. DOCUMENTED.) Later sources describe that upper area as "13 or
  16 columns". (TAMW, SOS01, about MIDI-AX's Fingers screen. DOCUMENTED for
  MIDI-AX; INFERRED for Fingers.)
- Each Line has **four Line icons** (the digits 1-4, in red) that step
  through the series in time with the clock; an icon's position decides which
  element sets that parameter of the Line's next note. Icons move **up and
  down** the columns. (MT88. DOCUMENTED.)
- Because each parameter is traversed independently, a Time series of one
  length "imposes" a cycle of durations on a Pitch series of another length.
  (MT88. DOCUMENTED in substance.) This is the central idea Feelers preserves.

### Series control elements

- Red letters placed beside series elements steer the Line icons. MT88 says
  there are **eight** of them, used "to skip elements and perform loops".
  (DOCUMENTED.)
- Named or described functions: **End of Series** (splits a column into two
  series), **Link** (joins adjacent columns), **Loop** (repeats a section of a
  column, up to **999** times), **Skip** (hops over an element), and **rests**.
  (MT88, MM89. DOCUMENTED.) The other elements, the letters used, and exact
  semantics are UNKNOWN.

### Editing

- **Shift**: when on, changing a Time value makes the following Time value
  change the opposite way, so the series keeps its overall length. (MT88,
  MM89. DOCUMENTED.)
- Parameters were entered with the mouse, the ST keyboard and occasionally a
  MIDI controller. (MT88. DOCUMENTED.)

### Performance controls (per Line)

- A row of controls per Line, reading left to right: **Pause; Mute;
  direction arrows** for Time, Pitch, Velocity and Articulation; **MIDI
  channel; Program number; Pitch transposition; Velocity transposition; Time
  Adjust**. (MT88. DOCUMENTED.)
- **P** makes the Line play its next note immediately, for example when it is
  held up by a very long note. A neighbouring **Re** control restarts the
  Line. (MT88 excerpt. DOCUMENTED, but see UNCERTAINTIES.)
- An **Advance/Delay** row beneath the columns sets each Line's timing
  relative to the others; a delay holds back a Line's entry, and an **Adjust**
  function changes it during playback. Elements can also be skipped manually.
  (MT88, MM89. DOCUMENTED.)
- **Time Adjust** can double or halve a Line's speed, and in-between values
  make Lines drift in and out of phase ("phase music"). (MT88, MM89.
  DOCUMENTED.)

### Randomisation

- Governed by **Amount** and **Type**. If Type is greater than zero, random
  changes are multiples of Amount up to Type times (Amount 4, Type 3 gives
  changes of 4, 8 or 12 in either direction). If Type is zero, changes follow a
  **gaussian** (bell-curve) distribution, small changes being more likely.
  (MT88. DOCUMENTED.)
- **Two additional columns set the probability** that an element is
  randomised. (MT88. DOCUMENTED; how the two columns differ is UNKNOWN.)
- **Two kinds of auto-randomise**, shown as "?" and an inverted "?", chosen
  from the Options screen. (MT88. DOCUMENTED; their difference is UNKNOWN.)
- **Pit and Tim limits** restrict randomised results. (MT88. DOCUMENTED.)

### Options, MIDI and saving

- Options: **synchronise with external sequencers or drum machines**, a delay
  between MIDI bytes, Running Status, **send program changes each time Start
  is selected**, and allocation of the ST's internal voices to MIDI channels
  (with custom sounds via the GIST editor). (MT88. DOCUMENTED.)
- The program kept **the last nine performances**, which could be saved;
  under KCS, performances went to KCS. (MT88 excerpt. DOCUMENTED, meaning
  partly UNKNOWN.)
- No information was found about the Fingers file format.

### Reception

Both Waugh reviews found the jargon a barrier ("certainly a boffin's
program"), and observed that most processes operate on numbers rather than on
musical material, so musical results depend on the user. Demos by users (not
Tobenfeld) showed it could make melodic material. Feelers takes this as a
design brief: keep the model, explain it on screen.

### MIDI-AX (kept separate)

- Fingers survives inside MIDI-AX as an **independent, complete algorithmic
  system**: four lines of pitch, velocity and duration with controls for
  patch change, tempo (a slider at the lower left), MIDI channel and
  transposition. (MyAtari03. DOCUMENTED for MIDI-AX.)
- The **lower quarter** of the screen holds per-line controls: mute, **time
  division**, MIDI channel, patch, transposition, direction, **linking to other
  lines**. When playback starts the cursors run down or up the columns and the
  user can redirect them or change values in real time. (TAMW. DOCUMENTED for
  MIDI-AX.) "Time division" and "linking to other lines" are not described for
  Fingers in the 1988-89 reviews, so they may be MIDI-AX additions (UNKNOWN).
- The **mouse controller**: dragging the mouse across the screen (a
  **gesture**) plays notes and velocities; each mouse button can be
  programmed separately. Commands described include **Note**, **NoteRep**
  (repeats at the last time separation) and **Gliss** (glides between notes
  while a button is held). (MyAtari03. DOCUMENTED.)
- **Holds**: after choosing H, a stroke across the screen is recorded as a
  short "gesture" loop, shown as a blinking number; it can then be dragged in
  pitch and velocity, and set to Off, Mute, Grab or Rev(erse). (TAMW,
  MyAtari03. DOCUMENTED.)
- Fingers and the mouse part do **not share tempo**, but can control each
  other through a sliders page; playback can also be steered from computer
  keys, Fingers, KCS, or external MIDI continuous controllers. (TAMW,
  MyAtari03. DOCUMENTED.)
- The interface was dense, numeric and arrow-driven; SOS01 called this
  functional, non-graphic style a Dr. T trademark.

See [MIDI-AX.md](MIDI-AX.md) for how a MIDI-AX-like Performance Mode could be
added to Feelers.

## Smallest coherent subset

The distinctive character of Fingers comes from a small core, and the first
version of Feelers implements all of it:

1. Four monophonic lines.
2. Four parameter kinds, each in its own series, with time as inter-onset.
3. One independently moving read position per line per parameter, each with its
   own direction.
4. Series of independent lengths, so combinations evolve.
5. Series control elements that reshape traversal (end, link, loop, skip,
   rest).
6. Live per-line performance controls: pause, mute, direction, next note,
   restart, channel, program, transposition, velocity offset, time adjust,
   advance/delay.
7. Randomisation by Amount / Type / probability with limits.

## Re-verification checklist

Checked against the full manual in the historical audit (October 2026):

- [x] The eight series control elements (End of Series, Column Link, Loop,
      Skip, Rest, rest, two auto-randomise marks); Rest is one of them.
- [x] P plays the next note at once (right click: all lines); Re restarts the
      line (left click: Time icon only; right click: all icons).
- [x] The two probability settings belong to the two auto-randomise marks.
- [x] Units: Time in 24 steps per beat, 1-999; S/L in sixteenths of the next
      Time value; columns of 16 elements, 13 or 16 columns.
- [x] "Synchronise" means sending MIDI clock; Fingers had no clock input.
- [x] Fingers records continuously and keeps nine sequences.
- [x] MIDI-AX "linking to other lines" is line linking (L objects), a MIDI-AX
      addition; "time division" is most likely Tm (INFERRED).
- [ ] Whether any of the above changed between Fingers versions (the manual
      is undated beyond 1988).
- [ ] Behaviour the manual leaves open: see [UNCERTAINTIES.md](UNCERTAINTIES.md).
