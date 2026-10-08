# Project file format (version 1)

Feelers projects are JSON. Files use the extension `.feelers.json`. The same
format is used for browser autosave and the browser library.

```json
{
  "format": "feelers.project",
  "version": 1,
  "savedAt": "2026-10-08T12:00:00.000Z",
  "project": { }
}
```

`format` must be exactly `"feelers.project"`. A file with a higher `version`
than the running Feelers understands is refused with a message; older versions
are migrated (version 1 is the first).

## `project`

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string (80) | Project name. |
| `notes` | string (4000) | Free text. |
| `tempo` | number 10-400 | BPM. |
| `seed` | integer 0-2^32-1 | Random seed; Start reseeds with it. |
| `options.clockOut` | boolean | Send MIDI clock and transport messages. |
| `options.programOnStart` | boolean | Send line program changes on Start. |
| `options.shiftEdit` | boolean | Time edits compensate the next time value. |
| `series` | Series[] | The bank. Always repaired to contain T1-T4, P1-P4, V1-V4, A1-A4. |
| `lines` | LineConfig[4] | The four lines. |
| `snapshots` | (Snapshot or null)[9] | Performance memories. |

### Series

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `T1`... `A4`. Unique. |
| `kind` | `"time"`, `"pitch"`, `"velocity"`, `"artic"` | |
| `name` | string | Display name. |
| `cells` | Cell[] (max 64) | |
| `rand.amount` | number 0-127 | Random step size. |
| `rand.type` | integer 0-12 | 0 gaussian, n multiples 1..n of amount. |
| `rand.prob` | number 0-100 | Percent chance per read of a flagged cell. |
| `lo`, `hi` | integers in the kind's range | Limits applied to every value read. |

Value ranges: time 1-999 (ticks, 24 per quarter), pitch 0-127 (MIDI note),
velocity 0-127, artic 1-400 (percent of the time value).

### Cell

| JSON | Meaning |
| --- | --- |
| `{"t":"v","v":60}` | Value. Optional `"r":1` (wobble) or `"r":2` (drift). |
| `{"t":"rest"}` | Rest. |
| `{"t":"skip"}` | Skip the next value. |
| `{"t":"open"}` | Loop start. |
| `{"t":"close","n":3}` | Loop end; section plays n (1-999) times. |
| `{"t":"end"}` | End of series. |
| `{"t":"link"}` | Continue into the next series of the same kind. |

### LineConfig

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string (24) | |
| `channel` | 1-16 | MIDI channel. |
| `program` | 0-127 or null | Program change. |
| `transpose` | -48..48 | Semitones. |
| `velOffset` | -127..127 | Added to velocities. |
| `timeScale` | 0.05-16 | Time adjust multiplier. |
| `delay` | 0-9999 | Entry delay in ticks after Start. |
| `legato` | boolean | Allow overlap with the next note. |
| `mute` | boolean | |
| `heads.time` / `.pitch` / `.velocity` / `.artic` | `{series, start, startDir}` | Series id of the matching kind, start cell (0-based), start direction (1 or -1). |

### Snapshot

```json
{
  "tempo": 104,
  "lines": [
    {
      "heads": { "time": { "series": "T1", "pos": 2, "dir": 1 }, "pitch": {}, "velocity": {}, "artic": {} },
      "paused": false, "mute": false, "transpose": 0, "velOffset": 0, "timeScale": 1
    }
  ]
}
```

## Repair rules on load

Unknown fields are dropped. Numbers are clamped to range. Invalid cells are
removed. Series with an unknown kind are dropped; duplicate ids keep the first.
Missing standard series are added with one neutral value. A head pointing at a
missing series or a series of the wrong kind is moved to the first series of
its kind. Missing lines are created with default settings.

## Original formats

No documentation of the Fingers or MIDI-AX file formats was found (MIDI-AX
loads a `DEFAULT.CMB` file according to TAMW; its structure is unknown).
Feelers does not read or write original formats.
