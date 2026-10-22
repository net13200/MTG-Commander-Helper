# Next version: plan and how the usage log decides it

The app now keeps a local **usage log** (Settings → Usage log). It counts events only, on the device, and leaves it only when someone taps Export or Share. After a few game nights, export it from each device that ran games and use it to settle the open questions below.

## What the log records

| Event | Meaning |
| --- | --- |
| `life:tap`, `life:jump5`, `life:jump10`, `life:swipe` | How life gets changed: ±1 halves, the ±5 / ±10 buttons, dragging the number |
| `life:editor`, `life:editor:set/lose/gain` | Tapping the number to open the editor, and which mode was applied |
| `attrib:player/paid/unknown:early/late` | "From whom?" answers, and whether they came while still counting (early) or after the pause (late) |
| `tap:<action>` | Every button, e.g. `tap:cmd`, `tap:panel`, `tap:undo`, `tap:nextTurn`, `tap:toggleFace`, `tap:randomDecks`, `tap:checkDeck` |
| `set:<setting>` | Settings and form fields changed |
| `view:<screen>` | Screens opened (stats, rivalries, seasons, history…) |
| `game:start:<n>p`, `game:end:<win type>` | Games played by pod size, and how they ended |
| `moxfield:receive:deck/profile`, `moxfield:sync` | Moxfield bookmark use |

## Questions the data should answer

1. **Life input.** If `life:swipe` or `life:editor` rival `life:tap`, make them more prominent (larger center, hint on first game). If `life:jump5` or `life:jump10` is rare, drop that button to declutter the tile.
2. **Attribution.** A high share of `attrib:unknown` or of `late` answers means the strip is still missed: consider drag-to-attribute (PRD Phase 3) or a larger strip.
3. **Commander damage.** If `tap:panel` is mostly followed by `tap:cmd`, put commander damage on the tile itself (tap a commander badge for +1) instead of in the panel.
4. **Face me vs. seats.** If `tap:toggleFace` is common, make "face me" the default when one person runs the app.
5. **Group features.** Low `view:rivalries` / `view:seasons` / `tap:shareRecap` means trim or merge those screens; high use means invest (season awards screen, achievements).
6. **Moxfield.** If `moxfield:receive` is rare, decks are mostly pasted: make paste the primary path in the deck screen.

## Backlog from game-night feedback (not yet built)

- Drag from one tile to another to deal damage (PRD Phase 3), if the editor and the "From whom?" strip aren't enough.
- Commander damage straight from the tile (tap a commander badge), skipping the panel.
- Multi-device play: each player on their own phone, synced (needs a backend, PRD Phase 3).
- Achievements (proposed in the PRD, waiting on the group).
