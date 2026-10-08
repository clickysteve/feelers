# Design language

Feelers is one of a family of independent browser MIDI instruments, with
emmm, FrakMC and ANVIL. The aim is **same designer, same instrument family,
different instrument**: someone moving between them should feel at home
with the shared conventions, while each instrument keeps an interface shaped
by its own musical model. The historical sources inform Feelers' musical
behaviour; they do not dictate its look.

This page records the conventions Feelers follows, the ones it introduces
for the collection, and what is Feelers' own. It was written after comparing
the emmm and FrakMC repositories (October 2026). ANVIL had no interface code
to compare yet.

## What the siblings already share

From emmm (1-bit Macintosh lineage) and FrakMC (Atari GEM lineage):

- paper and ink as the two base colours; 1px ink frames on everything;
- square corners; hard, unblurred offset shadows (1-2px);
- "on" and "selected" shown by **inverting** ink and paper;
- no hover decoration, no eased animation (blinks are stepped);
- a top bar with transport / device state, and a status or hint line;
- in-app dialogs and messages instead of browser `alert` / `confirm`;
- browser preferences under a dotted `<app>.` localStorage prefix;
- project files named `<name>.<app>.json`.

## Shared conventions Feelers adopts or introduces

These are proposed for the whole collection (and for ANVIL):

| Area | Convention |
| --- | --- |
| **Palette roles** | Interfaces draw only with semantic CSS custom properties. The shared roles keep emmm's names and meanings: `desktop` (behind the panels), `paper` (panels), `ink` (frames and text), `dim` (secondary text, guides), `activity` (playing / running / MIDI activity), `selection` (the current selection and focus). Each instrument adds its own roles (Feelers: four feeler identities, `transform`, `warning`). Derived colours (rules, wells, washes) are computed from roles with `color-mix`, never hard-coded. |
| **Palette system** | Built-in palettes are never edited (editing makes a named copy). Custom palettes, import / export as `{format: "<app>-palette", version, name, colors}`, lenient hex parsing, contrast warnings against paper that never change a colour. Stored as a browser preference (`<app>.palette.selected`, `<app>.palette.custom`), never in a project. Each instrument should read its siblings' palette files by the shared role names (Feelers reads emmm's). |
| **Built-in palette ids** | `classic` (1-bit ink on paper), `dark`, `colour`, plus the instrument's own default. Feelers' default is `feelers`, its warm paper look. |
| **Frames and states** | 1px ink frames for controls and panels; a 2px hard shadow for panels and primary transport buttons; "on" = ink fill with paper text (or the role colour with paper text); disabled = 40 % opacity; focus = 1px dotted ink outline. |
| **Warnings** | A `warning` role (ink in 1-bit palettes). PANIC has a 2px border in the warning colour and bold text, as in FrakMC. A lost external clock blinks with a stepped animation, as in emmm. |
| **Transport** | START / PAUSE (CONTINUE) / STOP as the first group; the playing state fills START with `activity`. |
| **MIDI and sync** | MIDI output select, CLOCK out toggle and PANIC grouped together; SYNC INT / EXT as a segmented pair with a status chip (WAITING, CLOCK, RUNNING, STOPPED, LOST) and the measured tempo shown as information only. |
| **Segmented controls** | Mutually exclusive choices are adjacent buttons sharing borders (INT / EXT, AS WRITTEN / LEGATO / MONO, G / OWN / OFF, nearest / down / up). |
| **Extensions** | Anything that goes beyond the instrument's historical model is labelled `EXT` in a small dashed tag, so the historical core stays identifiable without a global "classic / extended" switch. |
| **Help** | Every control carries a one-line explanation shown in the status line on hover or focus; a help panel explains the model in plain words. |
| **Files and storage** | `<name>.<app>.json` projects with `{format, version, savedAt, project}`; older versions migrate on load and say what changed. |

## Feelers' own identity

Feelers' central idea is **several independent read heads moving through
shared musical material**. The Series Bank and its heads are the visual
centre of gravity:

- Columns are horizontal strips of elements. Each line's heads are numbered
  tabs in the line's colour on the element they read: filled when live,
  outlined when waiting. Several tabs on one element show convergence;
  tabs spread over a column show divergence.
- Control elements are small marks on their element (rest and randomise
  bottom left, Skip bottom right, a struck-through value when skipped). A
  Loop fills its own slot in ink. An End of Series leaves a gap and a heavy
  right edge, so a column's separate series can be read at a glance. A linked
  column ends with an arrow naming the column it continues into.
- Each line panel reads from source to output: the head rows show the value
  each head read (`hold` when a Rest held it, `*` when randomised), and the
  NOTE row shows what was played.

### Showing transformation (Scale Mode)

The principle: **the system may transform the pitch, but it must show the
musician what it transformed and what actually played.**

- In a line panel a moved note reads `C#4 → D4 +1`: the source in `dim`, the
  arrow and the boxed change in the `transform` colour, the output in the
  line's colour. An unchanged note shows only its name.
- In the bank, a Pitch element that the current lens would move keeps its
  stored name, gains a `transform` underline and shows the change (`+1`,
  `−2`) in its top-right corner, the place the head tabs leave free. Nothing
  else changes size or weight, so the bank does not become a second
  sequencer.
- The lens (G, 1-4) chooses whose scale the bank shows: the global one, or a
  line's own scale after its transposition. Changing root, scale, direction
  or inheritance redraws the marks at once.
- In 1-bit palettes, where every role is ink, the underline and the corner
  number still carry the information without colour.

## Palette roles (Feelers)

| Role | CSS | Used for |
| --- | --- | --- |
| Desktop | `--desktop` | page background |
| Paper | `--paper` | panels, cells (with `--well`, a lighter mix) |
| Ink | `--ink` | frames, text, Loop slots, inverted panels (field log, status line) |
| Dim | `--dim` | labels, guides, held and blank values, source pitch |
| Feeler 1-4 | `--l1` ... `--l4` | head tabs, line panels, field traces |
| Activity | `--activity` | START while playing, clock RUNNING |
| Selection | `--selection` | selected element, STORE, RESTORE active |
| Transform | `--xform` | Scale Mode marks and readouts |
| Warning | `--warn` | PANIC, lost clock, MIDI errors |

The monitor canvas reads the same roles at each frame, so a palette change
applies everywhere at once.
