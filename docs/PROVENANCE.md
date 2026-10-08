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
  manuals or manual text, factory presets or example files are included. None
  were obtained during development.
- Historical behaviour was reconstructed from published reviews and
  documentation (listed in [RESEARCH.md](RESEARCH.md)). Short phrases from
  those sources appear in the research notes for identification only.
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
- UI labels (PAUSE, MUTE, NEXT, STEP, RESET, REV, REST, SKIP, END, LINK,
  WOBBLE, DRIFT) are plain functional words chosen for Feelers; help text is
  original.
- Demo data is original (see below). Test fixtures are synthetic.
- The research documents quote only short phrases and article titles from the
  cited reviews, with attribution, for identification and commentary. No
  manual text, tables or screenshots are reproduced.

No material needed removing or replacing.

## Feature provenance

Categories:

- **Historical (documented)**: the concept is described in historical sources.
  Feelers' realisation of it is still its own code and design.
- **Reconstruction (inferred)**: the sources imply the behaviour without
  specifying it; Feelers fills the gap with a documented decision.
- **Independent design**: needed to make a working instrument; no historical
  claim is made.
- **Modern extension**: deliberately goes beyond the historical system.

| Feature | Category | Notes |
| --- | --- | --- |
| Four monophonic lines | Historical | |
| Notes from separate Time, Pitch, Velocity, Articulation series | Historical | The core of the instrument. |
| Time as inter-onset interval | Historical | |
| Independent read position and direction per line per parameter | Historical | Directions per parameter are documented; "heads" is Feelers' term. |
| Lines sharing series | Reconstruction | |
| 16 series (4 per kind), up to 64 cells | Independent design | Matches the "16 columns" of later descriptions only loosely. |
| END, LINK, loops up to 999, SKIP, REST | Historical (functions) / Reconstruction (exact rules) | Rules in BEHAVIOUR section 4. |
| Loops running in reverse, nested loops, reverse through LINK | Reconstruction | |
| Starting cell and direction per head | Reconstruction | |
| Shift editing of time values | Historical | Option in the project panel. |
| Pause, Mute, P (NEXT), Re (RESET) per line | Historical | Feelers' names; NEXT/RESET semantics partly inferred. |
| Manual STEP of a paused line; HEAD HERE | Reconstruction / Independent design | Manual skipping is documented; these are Feelers' controls for it. |
| MIDI channel, program, pitch transposition, velocity offset per line | Historical | |
| Time adjust with in-between values (phasing) | Historical | Ratio presets and 0.005 steps are Feelers' design. |
| Advance / delay (entry delay and live shift) | Historical | Units and step sizes are Feelers' design. |
| Randomisation by Amount / Type (gaussian when 0) | Historical | |
| Probability and limits | Historical (Pit/Tim limits) / Independent design (per series, all kinds) | |
| WOBBLE (?) and DRIFT (~) cells | Reconstruction | Interpretation of the two auto-randomise symbols. |
| Program changes on Start | Historical | Option. |
| Takes: last nine performances, exported as MIDI files | Historical (nine performances) / Modern extension (SMF export) | |
| Global Start / Pause / Continue / Stop semantics | Modern extension | Explicit design for use with external sequencers. |
| MIDI Clock out with Start / Stop / Continue / Song Position | Modern extension | Fingers documented sync with external devices; direction unknown. |
| External MIDI Clock input (SYNC EXT) with Start / Stop / Continue | Modern extension | Interoperability with hardware; not a reconstruction of Fingers' sync. |
| Seeded, repeatable randomness | Modern extension | |
| Performance memories 1-9 | Modern extension | |
| Legato option for monophonic lines | Independent design | |
| Series tools: rotate, retrograde, offset values | Modern extension | Editing conveniences on the material. |
| Web MIDI device handling, panic, note-pairing safety | Independent design | |
| Audio preview | Modern extension | A listener on the MIDI stream, never the source of truth. |
| Project format, autosave, JSON import/export | Independent design | Not compatible with any original format. |
| Horizontal strips, head tabs, note assembly readout, feeler field | Independent design | Not modelled on original screens. |
| Contextual help line and help panel | Independent design | Responds to the reviewers' complaints about jargon. |
| MIDI-AX mouse gestures, holds, sliders | Not implemented | Researched; see MIDI-AX.md. |

## Demonstration material

The five demos in `src/demos/demos.ts` (First Contact, Phase Garden,
Clockwork, Drift, Four Lanes) were composed for Feelers. They are not derived
from any original Fingers or MIDI-AX example file, preset or tutorial.

## Prior projects

Feelers is the third project in a small collection of software archaeology
experiments, after emmm (inspired by Intelligent Music's M) and FrakMC
(inspired by Hugh McDowell's Fractal Music Composer). No code was copied from
either.
