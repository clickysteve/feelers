# Uncertainties

Everything below is unresolved, contradictory or inferred. Each item says what
Feelers does about it, so behaviour can be corrected when better evidence
appears. See [RESEARCH.md](RESEARCH.md) for why the evidence base is thin
(search excerpts only, no full texts, no running software).

## Source reliability

1. **All DOCUMENTED claims rest on search-engine excerpts** of MT88, MM89,
   TAMW, MyAtari03 and SOS01, not on the full texts. Summaries can merge or
   paraphrase sentences wrongly. Priority for re-verification: the P / Re
   controls, the "last nine performances", and the series control element
   list.
2. **MIDI-AX sources describing Fingers.** The "13 or 16 columns" figure and
   the lower-quarter control list come from texts about MIDI-AX. MIDI-AX is a
   later program; Fingers 1988 may differ. *Feelers:* uses 16 series (4 per
   kind), an independent choice that happens to match.

## Series and traversal

3. **The eight series control elements.** Only five functions are named or
   described (end, link, loop, skip, rest). The other three, the letters used
   on screen, and whether "rest" is a control element at all, are UNKNOWN.
   *Feelers:* implements the five, nothing invented in their place.
4. **Rest semantics.** UNKNOWN whether a rest consumes a step, applies to one
   parameter or the whole note, or how a rest in a Time series works.
   *Feelers:* see BEHAVIOUR section 4 (designed rule).
5. **Link semantics.** "Joins adjacent columns" is documented. Whether Link is
   placed at the end of a column, in which direction it works, and what
   reverse traversal does is UNKNOWN. *Feelers:* LINK cell anywhere; forward
   continues into the next series of the same kind; reverse re-enters the
   predecessor.
6. **End of Series.** Documented as splitting a column into two parts. Whether
   the part after END was a second independent series, and how icons reached
   it, is UNKNOWN. *Feelers:* cells after END are dormant (parked material),
   a simpler model; a strip cannot hold two series.
7. **Loops in reverse; nested loops.** UNKNOWN. *Feelers:* both supported with
   symmetric rules.
8. **Number and length of series; value ranges.** UNKNOWN. *Feelers:* 16
   series, up to 64 cells each; time 1-999 ticks; articulation 1-400 percent.
9. **Starting positions.** Whether icons could be given start cells other
   than the top is UNKNOWN. *Feelers:* each head has a start cell and
   direction.
10. **What direction reversal does at the turn.** UNKNOWN. *Feelers:* the head
    turns around on the cell last read (no repeat).

## Time and articulation

11. **Units of Tim.** UNKNOWN. Dr. T's Tunesmith counted 24 clocks per beat;
    KCS used its own resolution. *Feelers:* 24 ticks per quarter note
    (the MIDI clock resolution), fractional values allowed after time adjust.
12. **Units of S/L.** UNKNOWN (percentage, ticks, or a scale). *Feelers:*
    percentage of the note's time value.
13. **Overlapping notes in a monophonic Line.** UNKNOWN. *Feelers:* strict
    monophony by default, optional legato overlap; see BEHAVIOUR section 1.
14. **What "held up by a very long note" means for P.** It suggests a long
    Time value makes the Line wait. *Feelers:* NEXT cuts the wait.
15. **Re.** One excerpt says Re resets the Line so it starts again
    immediately. Whether it resets heads, loop counters or only timing is
    UNKNOWN. *Feelers:* resets all four heads and loop counters of one line.
16. **Advance/Delay units and live Adjust.** UNKNOWN. *Feelers:* ticks; 3
    ticks per press (24 with shift).

## Randomisation

17. **"?" versus inverted "?".** Two auto-randomise types are documented; the
    difference is UNKNOWN. *Feelers:* INFERRED as temporary (wobble) versus
    persistent (drift).
18. **The two probability columns.** UNKNOWN whether they are per element, per
    series, or one per auto-randomise type. *Feelers:* one probability per
    series.
19. **Where limits apply.** Pit and Tim limits are documented; Vel and S/L
    limits, and whether limits apply to non-random values, are UNKNOWN.
    *Feelers:* limits on every series, applied to every value read.
20. **Determinism.** Whether Fingers' randomness was repeatable is UNKNOWN.
    *Feelers:* seeded and repeatable from Start (a modern choice).

## Transport, sync and files

21. **Global transport.** Only Start is documented. Pause, Continue and Stop
    semantics are a modern, explicit design in Feelers.
22. **Sync direction.** "Synchronise with external sequencers or drum
    machines" most likely means following incoming MIDI clock (slave).
    *Feelers:* can send MIDI clock (INT) or follow incoming MIDI clock (EXT).
    Both are modern implementations, not reconstructions.
23. **"Last nine performances".** Whether these were recordings, parameter
    states or something else is UNKNOWN. *Feelers:* records takes (the notes
    played) and separately offers nine performance memories (states).
24. **File formats.** Nothing found about Fingers or MIDI-AX file formats
    (MIDI-AX loads a DEFAULT.CMB, per TAMW; contents UNKNOWN). Original-format
    import is not attempted.
25. **Mute.** Whether muted Lines keep advancing is UNKNOWN. *Feelers:* yes.

## MIDI-AX

26. **"Time division"** and **"linking to other lines"** in the MIDI-AX lower
    panel: meaning UNKNOWN; possibly MIDI-AX additions. Not implemented.
27. **How mouse gestures and Fingers interact** beyond "they can control each
    other through sliders": UNKNOWN. See [MIDI-AX.md](MIDI-AX.md).
