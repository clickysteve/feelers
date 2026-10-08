# Project file format (version 2)

Feelers projects are JSON. Files use the extension `.feelers.json`. The same
format is used for browser autosave and the browser library.

```json
{
  "format": "feelers.project",
  "version": 2,
  "savedAt": "2026-10-08T12:00:00.000Z",
  "project": { }
}
```

`format` must be exactly `"feelers.project"`. A file with a higher `version`
than the running Feelers understands is refused with a message. Version 1
files are converted on load (below).

Palettes are **not** part of a project; they are a browser preference
(`feelers.palette.*` in localStorage, see [DESIGN.md](DESIGN.md)).

## `project`

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string (80) | Project name. |
| `notes` | string (4000) | Free text. Conversion notes are appended here. |
| `tempo` | number 10-400 | BPM. |
| `seed` | integer 0-2^32-1 | Random seed; Start reseeds with it. |
| `options.clockOut` | boolean | Send MIDI clock and transport messages. |
| `options.programOnStart` | boolean | Send line program changes on Start. |
| `options.shiftEdit` | boolean | Time edits compensate the next time value. |
| `columns` | Column[] (max 32) | The score. Always repaired to contain T1-T4, P1-P4, V1-V4, S1-S4. Order matters: Column Link goes to the next column of the same kind in this order. |
| `random` | `{time, pitch, velocity, artic}` of RandomSettings | Randomisation per kind. |
| `minTime` | integer 1-999 | Minimum Time for randomised Time values. |
| `pitchLimit` | integer 0-127 | Pitch Limit (semitones beyond each Pitch series' range at Start). |
| `scale` | `{on, root, scale, dir}` | Global Scale Mode. |
| `lines` | LineConfig[4] | The four lines. |
| `snapshots` | (Snapshot or null)[9] | Performance memories. |

### Column

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string (16) | `T1`... `S4`, or another unique id. |
| `kind` | `"time"`, `"pitch"`, `"velocity"`, `"artic"` | `artic` is S/L. |
| `name` | string (24) | Display name. |
| `link` | boolean | Column Link to the next column of the same kind (wrapping). |
| `els` | El[] (max 16) | Elements, top to bottom. |
| `rand` | ColumnRandom (optional) | Feelers extension: this column's own randomisation, replacing its kind's. |

Value ranges: time 1-999 (ticks, 24 per quarter), pitch 0-127 (MIDI note),
velocity 0-127, S/L 1-64 (sixteenths of the next time value).

### El (element)

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | number or `null` | The value; `null` for a blank element or a Loop. |
| `loop` | integer 0-999 (optional) | A Loop element: repeat count, 0 = forever. Rest and randomise marks are not allowed on a Loop. |
| `end` | `true` (optional) | End of Series after this element. |
| `skip` | `true` (optional) | Skip this element. |
| `rest` | `"R"` or `"r"` (optional) | Rest (only Time and this head advance) or rest (all advance). |
| `ar` | `1`, `2` or `3` (optional) | Auto-randomise: 1 = `?`, 2 = `¿` (both keep the change), 3 = WOBBLE (extension; never kept). |

Example: `{"v": 61, "skip": true}`, `{"v": null, "loop": 2}`,
`{"v": 64, "ar": 1, "end": true}`.

### RandomSettings and ColumnRandom

| Field | Type | Meaning |
| --- | --- | --- |
| `amount` | number 0-127 | Size of a random change. |
| `type` | integer 0-12 | 0 gaussian (average change about `amount`); n: multiples 1..n of `amount`. |
| `p1`, `p2`, `pw` | number 0-100 | Probabilities for `?`, `¿` and WOBBLE elements. |
| `lo`, `hi` | integers (ColumnRandom only, optional) | Bounds for randomised values of this column. |

### LineConfig

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string (24) | |
| `channel` | 1-16 | MIDI channel. |
| `program` | 0-127 or null | Program change. |
| `transpose` | -48..48 | Semitones. |
| `velOffset` | -127..127 | Added to velocities. |
| `timeScale` | 0.05-16 | Time adjust multiplier (Fingers' Tm / 16). |
| `delay` | 0-9999 | Entry delay in ticks after Start. |
| `overlap` | `"written"`, `"legato"`, `"mono"` | How the line's notes may overlap. |
| `mute` | boolean | |
| `scale` | `{mode, root, scale, dir}` | `mode`: `"global"`, `"own"` or `"off"`; the rest is used for `"own"`. |
| `heads.time` / `.pitch` / `.velocity` / `.artic` | `{col, start, startDir}` | Column of the matching kind, start element (0-based), start direction (1 or -1). |

Scale ids: `chromatic`, `major`, `minor`, `harmonic-minor`, `melodic-minor`,
`dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`, `major-pent`,
`minor-pent`, `blues`, `whole-tone`, `dim-wh`, `dim-hw`. `root` is a pitch
class 0-11 (0 = C). `dir` is `"nearest"`, `"down"` or `"up"`.

### Snapshot

```json
{
  "tempo": 104,
  "lines": [
    {
      "heads": { "time": { "col": "T1", "pos": 2, "dir": 1 }, "pitch": {}, "velocity": {}, "artic": {} },
      "paused": false, "mute": false, "transpose": 0, "velOffset": 0, "timeScale": 1
    }
  ]
}
```

`pos` is the element of the note the line last played (for Time: that note's
own Time value).

## Repair rules on load

Unknown fields are dropped. Numbers are clamped to range. Invalid elements are
removed; a column keeps its first 16. Columns with an unknown kind are
dropped; duplicate ids keep the first. Missing standard columns are added
with one neutral value. A head pointing at a missing column or a column of the
wrong kind is moved to the first column of its kind. Unknown scale ids,
overlap modes and directions fall back to their defaults (Scale Mode off).

## Migrating version 1 projects

Version 1 (Feelers before the historical audit) stored series of up to 64
*cells*, with control elements as cells of their own. On load
(`src/persistence/migrate.ts`):

| v1 | v2 |
| --- | --- |
| Value cell | Element with the same value. Articulation percent becomes S/L: round(percent x 16 / 100), 1-64. |
| `r: 2` (DRIFT) | `ar: 1` (`?`, the change is kept), probability from the series. |
| `r: 1` (WOBBLE) | `ar: 3` (WOBBLE), probability from the series. |
| SKIP cell | `skip` on the value it used to jump. |
| REST in Pitch / Velocity / Artic | A blank element with `rest: "r"`. |
| REST in Time | `rest: "r"` on the Time value read before the silent note, so the same note is silent. |
| `[ ... ]n` at the start of a series, or after another loop | The body, then a Loop element with count n - 1. |
| Other bracket loops (mid-series, nested) | Written out in full (up to 48 elements; beyond that a Loop element, with a note). |
| END | `end` on the last active element; dormant cells stay below it as a separate series. |
| LINK | `link` on the column. |
| Series longer than 16 elements | Continue in added columns (`P1a`, ...), linked in. |
| Per-series `rand` and `lo` / `hi` | A per-column `rand`, with `lo` / `hi` as bounds for randomised values. Gaussian amounts are divided by sqrt(pi/2) so the spread is unchanged. Stored values outside the old limits are set to the limit they always played at. |
| `legato` | `overlap: "legato"`, else `"mono"`. |
| Time head start | One element earlier: v1 read a note's Time value as the gap *after* it, v2 as the gap *before* it. |
| (new) | `scale` off, line scales `global`, Pitch Limit 127, Minimum Time 1. |

The result plays the same notes as v1: the test suite compares migrated
projects with note streams recorded from the v1 engine
(`tests/fixtures/v1-golden.json`), including skips, time rests, every kind of
loop, END, delays, time adjust, reversed heads and randomisation.

Two differences are inherent and reported:

- **LINK** now follows Fingers' Column Link: the linked columns form one
  series, so after the last of them a head returns to the top of the first.
  In v1 a head that had linked into a series stayed there.
- **Loops** follow Fingers: heads moving backwards ignore them.

Every difference is listed in a note appended to the project notes, and the
status line says the project was converted.

## Original formats

Original Fingers `.FIN` files have been examined for structure only
([HISTORICAL_AUDIT.md](HISTORICAL_AUDIT.md), section 6). Feelers does not read
or write them yet; an importer for user-supplied files is planned (audit
batch 3). No original files are distributed.
