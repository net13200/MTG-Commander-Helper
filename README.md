# Commander Tracker

A Commander (EDH) life tracker for our playgroup that turns every game night into a shared history: who won, with what, and how. Built from the *Commander Tracker PRD v1.1*. It covers **Phase 1 (MVP)** and **Phase 2 (group layer)**.

Static site, no build step. It installs as an app (PWA) and works fully offline.

## Run it

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly also works, but offline install needs it served over http(s). Any static host (GitHub Pages, Netlify, …) is enough.

## What's in the MVP

- **Tracker for 2–6 players**: tiles face each seat (portrait and landscape layouts), tap ±1, long-press repeats, and changes batch into one log entry after 1.5 s.
- **Commander damage** per source commander (Partner/Background get two), entered once and applied to life too; your own commander counts. 21 from one commander, 10 poison or 0 life flags the player and offers to eliminate them, unless they have "can't lose".
- **Poison, Monarch, the Initiative, commander tax** (+2 per cast), custom counters (energy, experience, rad, anything), "can't lose" / "can't win".
- **Turns**: random or chosen first player, active-player marker, round counter, optional turn timer, dim-between-turns.
- **Attribution**: after a life loss a "from whom?" strip appears on that tile; one tap, never blocking (automatic in 1v1).
- **Action log with undo**: multi-step undo, and tapping any log entry reverts or restores it. Notes with quick tags.
- **Eliminations** record who knocked whom out and how (combat, commander damage, poison, alt-win, concede).
- **Players and decks**: persistent profiles (name, color, avatar), guests by name that can be merged into a profile later, decks with commander(s), color identity, bracket and decklist. Commander search and color identity come from Scryfall when online.
- **Match history**: saved automatically at game end with seats, decks, first player, rounds, duration, full damage matrix, eliminations, winner and win type, notes and the log. Games played without the tracker can be logged afterward.
- **Stats**: win rate per player and per deck, wins by turn order and by seat, average rounds and minutes, most damage dealt and most knockouts.
- **Never lose a game**: state is saved after every action, so a reload or crash resumes mid-game. Keep-awake is on by default.
- **Hebrew and English** with full right-to-left layout; card names stay in English.

## Phase 2 (group layer)

- **Deck import**: paste an export from Moxfield, Archidekt or any site (always works), or import a Moxfield link through the import proxy (below).
- **Deck check** against Scryfall: card count, banned or not-legal cards, cards outside the color identity, Game Changers (Scryfall's flag), mass land denial, extra turns, tutors and well-known two-card combos (a partial list), plus an **estimated bracket** with the reasons. It's labeled as an estimate; the owner sets the final bracket.
- **Deck versions**: when a list changes it becomes a new version, and saved games stay linked to the version that was played.
- **Commander art on tiles** from Scryfall, cached for offline play (can be turned off in Settings).
- **Pre-game balance check** in setup: warns when one deck's bracket or win rate is far above the rest of the pod.
- **Rivalries**: head-to-head records between players and between decks, nemesis and favorite target, and the group's top rivalries.
- **Game recaps**: a short story of each game from its log (swing round, first knockout, comeback, kingmaker, notes), shareable to WhatsApp.
- **Seasons**: calendar quarters with standings and an awards screen (champion, most damage, most knockouts, best deck); stats can be filtered by season.

### Moxfield import proxy

Moxfield has no official public API, and its Cloudflare protection blocks requests coming straight from a browser. URL import therefore goes through a small proxy that answers `GET /moxfield/decks/{id}`. That's the same contract as `proxy-server.py` in [Mulligan](https://github.com/net13200/Mulligan), so either proxy works. Two options are in `proxy/`:

- `moxfield-proxy.py`: run it on a computer (`pip install requests`, then `python3 proxy/moxfield-proxy.py`) and set **Settings → Moxfield import proxy** to `http://localhost:3001` in the app on that computer.
- `cloudflare-worker.js`: deploy it as a free Cloudflare Worker and use its `https://….workers.dev` URL on phones and tablets. Moxfield may still refuse requests from Workers; if so, use the Python proxy or paste the list.

Without a proxy, use Moxfield's **More → Export → Copy plain text** and paste it into the decklist.

## Not yet (later phases in the PRD)

- Shared cloud history across phones (Supabase/Firebase). Until then, data lives on the device; use **Settings → Backup** to export/import.
- Achievements (proposed in the PRD, waiting on the group).
- Planechase, Archenemy, drag-to-attribute gestures, multi-device sync.

## Code

| File | Role |
| --- | --- |
| `js/game.js` | Game engine: state is derived by replaying an event log, so undo is just marking an event reverted. Seat layouts. |
| `js/stats.js` | Stats, rivalries and seasons from saved matches. |
| `js/decks.js` | Decklist parsing, Moxfield import, Scryfall lookups, deck check and bracket estimate. |
| `js/recap.js` | Game recap writer. |
| `js/store.js` | localStorage persistence (playgroup data and the live game kept separately). |
| `js/i18n.js` | English and Hebrew strings. |
| `js/app.js` | UI: views, the game board, modals. |
| `sw.js` | Offline cache for the app shell. |

Tests (engine, stats, deck tools, recaps and translation coverage): `node --test test/*.test.js`

## Legal

Commander Tracker is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data via [Scryfall](https://scryfall.com/docs/api).
