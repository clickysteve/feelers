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

### Following an external clock (SYNC: INT / EXT)

- **INT** (default): Feelers sets the tempo and runs its own transport.
- **EXT**: Feelers follows 24 PPQN MIDI Clock from a MIDI input. Choose the
  input next to SYNC. Every incoming clock pulse (F8) advances Feelers by
  exactly one tick (24 per quarter note), so the device's clock, not a tempo
  estimate, drives every note and note-off.
  - **FA Start**: a fresh performance from the starting state (heads, loop
    counters and random seed reset), exactly like START.
  - **FC Stop**: stops and releases every note, keeping the position, heads
    and each line's remaining wait.
  - **FB Continue**: carries on from where FC stopped. Nothing is reset.
  - **F8 while stopped** never starts Feelers; it only updates the measured
    tempo.
  - **Status**: WAITING (no clock), CLOCK (clock, waiting for Start or
    Continue), RUNNING, STOPPED (after FC), LOST (clock vanished while
    running), NO INPUT. Beside it: pulses received and the last transport
    byte. **IN** shows the measured tempo, for information only; the BPM
    control is hidden because it does nothing while following.
  - **Clock loss**: if no pulse arrives for 0.5 s while running (or the input
    is unplugged or changed), Feelers releases all notes, holds its position
    and shows LOST. It never switches to internal clock and never keeps
    playing at a guessed tempo. The next pulse carries on from the held
    position; Start or Continue from the device work as usual.
  - **CLOCK out is off in EXT** so clock is never echoed back to its source.
  - Local START / PAUSE are disabled in EXT; local **STOP** still stops and
    resets (the device's next FA or FB starts it again). PANIC works as
    always. Switching INT / EXT stops and releases everything first.
  - Song Position Pointer is ignored: Continue resumes from where Feelers
    stopped.
- **Latency.** Under INT, notes are scheduled about 0.1 s ahead with exact
  timestamps. Under EXT, future pulses cannot be known, so each pulse releases
  only the events up to the next pulse: notes leave as the pulse arrives (plus
  browser input latency, typically a few milliseconds) and their timing
  jitter follows the incoming clock and the browser. Events between two
  pulses (from TIME× or articulation) are placed using the measured pulse
  period.

**Testing with a Hermod+ (or any clock source):** connect it by USB, choose
it as the EXT input and Feelers' MIDI output, press play on the Hermod+:
the status should go CLOCK → RUNNING and IN should show its tempo. Check
that changing the Hermod+ tempo is followed, that its stop gives STOPPED with
no stuck notes, and that its continue resumes while its start restarts.

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

`.github/workflows/pages.yml` type-checks, runs the unit and browser tests,
builds and deploys `dist/` to GitHub Pages on every push to `main` (pull
requests run the same checks without deploying). Pages must be set to
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

The build uses relative asset paths (Vite `base: './'`) and contains no
hostname, so the same files work at a domain root
(`https://feelers.allmyfriendsaresynths.com/`) and under a project path
(`https://clickysteve.github.io/feelers/`).

The custom domain is set in **Settings → Pages → Custom domain**, not by a
file in the repository: for Actions-based deployments GitHub ignores any
`CNAME` file. Once a custom domain is set, GitHub serves the project site
there and points the `github.io` project URL at it; that redirect is GitHub
platform behaviour, not something the app does.

## Licence

Feelers' independently written source code is licensed under the MIT License
(see [LICENSE](LICENSE)). This licence applies only to the original code and
other original material contained in this repository. It does not grant rights
in Dr. T's Fingers, MIDI-AX, their documentation, software, assets, trademarks,
or other third-party material. Product names mentioned in this repository
belong to their respective owners and are used only to identify them.

See [docs/PROVENANCE.md](docs/PROVENANCE.md) for what was historically
researched versus independently designed.
