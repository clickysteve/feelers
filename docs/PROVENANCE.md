# Provenance

Feelers is an independent browser-based interactive MIDI composition
instrument inspired by the musical concepts explored in Dr. T's Fingers and
MIDI-AX, developed by Emile Tobenfeld.

Feelers is not an official port or continuation of either application and is
not affiliated with or endorsed by Emile Tobenfeld or any historical publisher
or distributor. Feelers is independently implemented and does not distribute
the original software or its associated assets.

## Licence scope

Feelers' independently written source code is licensed under the MIT License.
This licence applies only to the original code and other original material
contained in this repository. It does not grant rights in Dr. T's Fingers,
MIDI-AX, their documentation, software, assets, trademarks, or other
third-party material. The `LICENSE` file is the unmodified MIT text; this
section, not that file, explains its scope.

## What this repository contains, and what it does not

- All code, wording, interface design, graphics and demonstration material
  were written for Feelers.
- No original source code, binaries, disk images, graphical assets, fonts,
  manuals or manual text, factory presets or example files are included.
- The first versions were reconstructed from published reviews (listed in
  [RESEARCH.md](RESEARCH.md)). For the historical audit (October 2026) the
  repository owner supplied copies of the Fingers manual, the MIDI-AX
  preliminary reference, original example notes and `.FIN` score files, and
  later contemporary articles. These were read outside the repository, for
  research only; none of them, and no extract longer than a short phrase, is
  in the repository or its history. The audit
  ([HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md)) cites them by chapter and
  section. The `.FIN` files were examined for structure only and were not
  run.
- Behaviour learned from those sources is re-expressed in Feelers' own code,
  words and interface. Short phrases appear in the documentation for
  identification only.
- MIDI-AX was released as shareware in 2001 on stated conditions. That does
  not make it, or Fingers, public domain or freely redistributable, and
  Feelers does not treat it as such.
- No permission or endorsement has been sought or received.
- Development tools (Vite, TypeScript, Vitest, Playwright) are
  devDependencies under their own licences; they are not committed to the
  repository. The production build contains only Feelers' own code plus the
  small module-loading helper Vite injects (MIT).

## Audit record

Before first publication (October 2026) every tracked file and every path in
the Git history was reviewed. Findings:

- 50 tracked files, all plain text (TypeScript, CSS, HTML, Markdown, JSON,
  YAML). No binaries, images, fonts, disk images, archives, presets or example
  files exist in any commit, and no file was ever added and later deleted.
- The only icon is an inline SVG favicon drawn for Feelers. No external fonts
  are loaded; the interface uses the system monospace font.
- UI labels (PAUSE, MUTE, NEXT, STEP, RESET, REV, REST, SKIP, END, LOOP,
  WOBBLE, RESTORE, SCALE) are plain functional words chosen for Feelers; help
  text is original.
- Demo data is original (see below). Test fixtures are synthetic, apart from
  `tests/fixtures/v1-golden.json`, which holds Feelers' own v1 demo projects
  and synthetic projects with the notes the v1 Feelers engine produced for
  them.
- The research documents quote only short phrases and article titles from the
  cited reviews, with attribution, for identification and commentary. No
  manual text, tables or screenshots are reproduced.

No material needed removing or replacing.

## Feature provenance

Layers (see [ARCHITECTURE.md](ARCHITECTURE.md)):

- **Fingers (documented)**: described in the Fingers manual and implemented
  as described. Feelers' realisation is still its own code and design.
- **Choice (unresolved)**: the sources leave it open; Feelers makes a
  documented, tested choice ([UNCERTAINTIES.md](UNCERTAINTIES.md)).
- **Modern facility**: common modern instrument functionality, part of the
  core instrument, not a Fingers feature.
- **Extension**: new compositional behaviour, labelled EXT in the interface.

| Feature | Layer | Notes |
| --- | --- | --- |
| Four lines; notes from Time, Pitch, Velocity and S/L | Fingers | FM ch. 1. |
| Independent head per line per parameter, with direction | Fingers | "Heads" is Feelers' term for line icons. |
| Time is the wait before a note; length = next Time x S/L / 16 | Fingers | FM ch. 1, ch. 6. |
| First note at Start plus delay, first Time value consumed | Choice | `choices.firstNoteWaits`. |
| Typed columns of up to 16 elements; 16 columns, 4 per kind | Fingers (16-column mode) | Configurable column types not yet implemented. |
| End of Series splitting a column into usable series | Fingers | FM ch. 3. |
| Column Link to the next column of the same kind, wrapping | Fingers | FM ch. 3. Backward traversal across links is a choice. |
| Control elements as attributes of elements | Fingers | FM ch. 3; `.FIN` structure. |
| Skip (own element, keeps value, overrides Loop / rest, not End) | Fingers | FM ch. 2-3. |
| Rest (R) and rest (r) with their advance rules | Fingers | FM ch. 3. Several rests on one note: choice. |
| Loop slot, count 0-999, 0 forever, from series start or previous Loop, ignored backwards | Fingers | Count meaning (repeats or passes): choice. |
| Blank elements passed over | Choice | |
| Reversal turns at the element last read | Choice | |
| `?` and `¿` with separate probabilities, both persistent | Fingers | FM ch. 3, ch. 6. |
| Amount / Type per kind; gaussian with average change about Amount | Fingers | Exact gaussian scale: choice. |
| Minimum Time; Pitch Limit relative to the range at Start; limits only on randomised values | Fingers | FM ch. 6. |
| Restore Last Start (toggle) | Fingers | FM ch. 5. |
| S/L in sixteenths; overlaps AS WRITTEN | Fingers | FM ch. 3. Range 1-64: choice. |
| LEGATO and MONO overlap modes | Modern facility | Safety and glide for mono and CV gear. |
| Pause, Mute, NEXT (P), RESET (Re), STEP, HEAD HERE | Fingers (functions) / Modern (STEP) | Pause release timing and Tim-only reset follow later (batch 2). |
| MIDI channel, program, transposition, velocity offset per line | Fingers | |
| Time adjust (phasing) | Fingers | Free multiplier and ratio presets are modern. |
| Advance / delay | Fingers | Step sizes are Feelers'. |
| Shift editing of time values | Fingers (partly) | Scope differs (audit R7). |
| Program changes on Start | Fingers | |
| MIDI Clock out with Start / Stop / Continue / Song Position | Fingers (clock out) / Modern (details) | Fingers could send clock (FM ch. 7). |
| External MIDI Clock input (SYNC EXT) | Modern facility | Fingers could not follow an external clock (FM ch. 7). |
| Global Start / Pause / Continue / Stop | Modern facility | Fingers' Stop then Con = Pause then Continue. |
| Scale Mode (global and per line, nearest / down / up, visible changes) | Modern facility | Fingers had no scale quantiser. |
| Palettes | Modern facility | Shared design with emmm ([DESIGN.md](DESIGN.md)). |
| Web MIDI device handling, Panic, note-pairing safety, lookahead scheduler | Modern facility | |
| Takes (last nine performances) as Standard MIDI Files | Fingers (recording) / Modern (SMF) | |
| Seeded, repeatable randomness | Modern facility | |
| Project format v2, migration from v1, autosave, JSON import / export | Modern facility | Not compatible with `.FIN`. |
| Audio preview | Modern facility | A listener on the MIDI stream; replaces the ST sound chip. |
| WOBBLE (`~`) | Extension | Non-persistent randomisation. |
| Per-column randomisation settings and bounds | Extension | Fingers has one set per kind. |
| Performance memories 1-9 | Extension | |
| Rotate, retrograde, offset values | Extension | |
| Horizontal strips, head tabs, transform marks, line readouts, feeler field | Independent design | Not modelled on original screens. |
| Contextual help line and help panel | Independent design | |
| MIDI-AX gestures, holds, sliders, line linking | Not implemented | MIDI-AX only; see MIDI-AX.md. |

## Demonstration material

The six demos in `src/demos/demos.ts` (First Contact, Phase Garden,
Clockwork, Drift, Four Lanes, Scale Lens) were composed for Feelers. They are
not derived from any original Fingers or MIDI-AX example file, preset or
tutorial.

## Prior projects

Feelers belongs to a small collection of independent browser MIDI
instruments, with emmm (inspired by Intelligent Music's M), FrakMC (inspired
by Hugh McDowell's Fractal Music Composer) and ANVIL. The palette system
follows emmm's design (semantic roles, built-in palettes that are never
edited, import / export, contrast warnings) and was written for Feelers; it
can read emmm palette files. No code was copied from the other instruments.
