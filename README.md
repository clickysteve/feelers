# Feelers

**Put out the Feelers.**

Feelers is a browser-based interactive MIDI composition instrument. Four
monophonic lines reach out into a bank of parameter series. Every note is
assembled on the spot from four independently moving read heads, one each on
a **Time**, **Pitch**, **Velocity** and **Articulation** series. Because the
series have different lengths, directions and control elements, the
combinations keep evolving, and you steer them while they play: rewrite
material, reverse heads, loop, skip, transpose, pause, mute and push lines out
of phase.

It is the third of a small collection of software archaeology experiments,
after *emmm* (Intelligent Music's M) and *FrakMC* (Hugh McDowell's Fractal
Music Composer), and is inspired by Emile Tobenfeld's **Dr. T's Fingers**
(Atari ST, 1988) and its successor **MIDI-AX**.

> Feelers is an independent browser-based interactive MIDI composition
> instrument inspired by the musical concepts explored in Dr. T's Fingers and
> MIDI-AX, developed by Emile Tobenfeld. Feelers is not an official port or
> continuation of either application and is not affiliated with or endorsed by
> Emile Tobenfeld or any historical publisher or distributor. Feelers is
> independently implemented and does not distribute the original software or
> its associated assets.

## Quick start

1. Open Feelers in Chrome, Edge, Opera or Firefox (Web MIDI). Safari runs it
   with the audio preview only.
2. Choose your output under **MIDI** (the browser will ask for permission).
   No hardware? Click **♪ PREVIEW** for the built-in synth.
3. Press **▶ START** (or Space). The default setup, *First Contact*, starts
   playing four lines on MIDI channels 1-4.
4. Watch the numbered tabs move across the series bank: each line has one tab
   on a Time, Pitch, Velocity and Articulation strip. The **NOTE** row in each
   line panel shows the four values that made the note you just heard.
5. Play with it:
   - Click a pitch cell and press ↑ / ↓, or type a note name and Enter.
   - Click **→** beside a head to reverse it.
   - Set **TIME×** on one line to 1.5, or nudge it to 1.010, and listen to it
     drift.
   - **PAUSE**, **MUTE**, **NEXT**, **STEP**, **RESET** and **REV** act on one
     line; **TRANS** and **VEL±** transpose it.
   - Put **END**, **LINK**, **SKIP**, **REST** or loop brackets into a series
     from the edit bar.
   - Press **STORE** then **1** to keep the performance state; press **1** to
     return to it.
6. **☰ PROJECT** holds the demos, saving, JSON export/import, options, and the
   last nine takes as MIDI files. Hover over anything for an explanation in
   the bottom line; **?** opens the full guide.

### Keyboard

| Key | Action |
| --- | --- |
| Space | Start / Pause / Continue |
| Esc | Deselect, then Stop |
| 1-9, Shift+1-9 | Recall / store performance memory |
| ← → | Move the cell selection |
| ↑ ↓ (Shift) | Change the selected value (by an octave / 10) |
| Enter | Type a value |
| R S E L [ ] V | Make the cell REST, SKIP, END, LINK, loop start, loop end, value |
| Insert / Delete | Insert / delete a cell |

## Demos

All written for Feelers (none derived from original material):

- **First Contact**: series of different lengths interlock; 3:2 bells.
- **Phase Garden**: one melody at four speeds a hair apart.
- **Clockwork**: loops, skips, rests, END and LINK.
- **Drift**: seeded randomisation that wanders and replays identically.
- **Four Lanes**: gate-friendly setup for MIDI-to-CV modules, clock on.

## Hardware: Mac, browser, USB MIDI, modular

- Each line sends on its own channel (default 1-4). Set them per line.
- **CLOCK** sends MIDI Clock (24 PPQN) with Start (FA), Stop (FC), Continue
  (FB) and Song Position 0 on Stop. Pause sends Stop, Continue sends Continue.
  Clock and transport are separate kinds of message; Feelers sends both when
  CLOCK is on and neither when it is off.
- Articulation is the gate length (percent of the note's time value). With
  **LEGATO** off a line is strictly monophonic: each gate closes before the
  next opens, which suits CV/gate interfaces. With LEGATO on, notes overlap
  briefly so mono voices can glide.
- For a Squarp Hermod+ (or similar MIDI-to-CV module): put its tracks on
  channels 1-4, set it to follow external MIDI clock if you want its
  sequencer or LFOs in time, and try the *Four Lanes* demo.
- **PANIC** releases every note and sends All Notes Off and All Sound Off on
  all 16 channels. Stop also releases every note.
- If the interface is unplugged mid-performance, Feelers keeps playing
  silently, says so, and reattaches when it returns.

Tested only against a simulated Web MIDI device; no physical MIDI hardware
has been tested yet. Reports welcome.

## Documentation

- [docs/RESEARCH.md](docs/RESEARCH.md): history, sources, findings, and how
  reliable they are.
- [docs/BEHAVIOUR.md](docs/BEHAVIOUR.md): the musical model, historical
  versus implemented.
- [docs/UNCERTAINTIES.md](docs/UNCERTAINTIES.md): what is unknown or inferred.
- [docs/PROVENANCE.md](docs/PROVENANCE.md): what is historical, reconstructed,
  designed or new.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, scheduler, MIDI,
  persistence, UI.
- [docs/FORMAT.md](docs/FORMAT.md): the project file format.
- [docs/MIDI-AX.md](docs/MIDI-AX.md): MIDI-AX research and a future
  Performance Mode.
- [docs/ROADMAP.md](docs/ROADMAP.md): what remains.

## Development

Requires Node 20 or newer.

```sh
npm install
npm run dev          # local dev server
npm test             # unit tests (Vitest)
npm run typecheck
npm run build        # production build in dist/
npm run test:e2e     # browser tests (Playwright; builds must exist: run npm run build first)
npm run check        # all of the above
```

The browser tests inject a simulated Web MIDI device; no hardware is needed.
If Playwright has no browser installed, run `npx playwright install chromium`
or set `FEELERS_CHROMIUM` to a Chromium executable.

## Deployment

`.github/workflows/pages.yml` type-checks, tests, builds and deploys `dist/`
to GitHub Pages on every push to `main`. Enable it once in the repository
settings: **Pages → Build and deployment → Source: GitHub Actions**. The build
uses relative paths, so it works from any Pages URL.

## Licence

Code: MIT (see [LICENSE](LICENSE)). The notice above applies to the
relationship with the historical software.
