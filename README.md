# Commander Tracker

A Commander (EDH) life tracker for our playgroup that turns every game night into a shared history: who won, with what, and how. Built from the *Commander Tracker PRD v1.1*. It covers **Phase 1 (MVP)** and **Phase 2 (group layer)**.

Static site, no build step. It installs as an app (PWA) and works fully offline.

## Run it

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly also works, but offline install needs it served over http(s). Any static host (GitHub Pages, Netlify, …) is enough.

## What's in the MVP

- **Tracker for 2–6 players**: tiles face each seat (portrait and landscape layouts), or all face the person holding the device ("face me", with the turn bar at the bottom). Every control does what it shows on a plain tap: the left half of a tile is −1, the right half +1, and the −10 −5 / +5 +10 buttons jump by that much; tap the life total to type or set it, or drag it up or down to count. Changes batch into one log entry after 1.5 s. During games the screen is locked to landscape (or portrait, or off, in Settings), so turning or flipping the phone on the table doesn't spin the board; "Turn 180°" in the game menu flips it on purpose.
- **Commander damage** per source commander (Partner/Background get two), entered once and applied to life too; your own commander counts. Each commander gets its own badge on the tile. If someone else controls a commander, "Dealt by" credits the damage and the knockout to them while 21 still counts per commander. 21 from one commander, 10 poison or 0 life flags the player and offers to eliminate them, unless they have "can't lose". Each tile has a row of the opponents' commander icons: tap one for +1 commander damage from it (corrections in the ⋯ panel or with undo).
- **Poison, Monarch, the Initiative, commander tax** (+2 per cast), custom counters (energy, experience, rad, anything; a custom counter added for one player is offered to everyone and remembered for later games), "can't lose" / "can't win".
- **Turns**: random or chosen first player, active-player marker, round counter, optional turn timer, dim-between-turns.
- **Attribution**: as soon as life drops, a "from whom?" strip appears on that tile; one tap, never blocking. "Paid" marks life paid as a cost, which doesn't count as damage. In 1v1 the opponent is preselected.
- **Action log with undo**: multi-step undo, and tapping any log entry reverts or restores it. Notes with quick tags.
- **Eliminations** record who knocked whom out and how (combat, commander damage, poison, alt-win, concede).
- **Players and decks**: persistent profiles (name, color, avatar), guests by name that can be merged into a profile later, decks with commander(s), color identity, bracket and decklist. Commander search and color identity come from Scryfall when online. Decks can be picked at random at setup. Each commander shows its card art as its icon, or an emoji chosen in the deck.
- **Match history**: saved automatically at game end with seats, decks, first player, rounds, duration, full damage matrix, eliminations, winner and win type, notes and the log. Games played without the tracker can be logged afterward.
- **Stats**: win rate per player and per deck, wins by turn order and by seat, average rounds and minutes, most damage dealt and most knockouts.
- **Never lose a game**: state is saved after every action, so a reload or crash resumes mid-game. Keep-awake is on by default.
- **Hebrew and English** with full right-to-left layout; card names stay in English.

## Phase 2 (group layer)

- **Deck import**: paste an export from Moxfield, Archidekt or any site, paste straight from the clipboard, or send a deck from Moxfield with the one-tap bookmark (below).
- **Deck check** against Scryfall: card count, banned or not-legal cards, cards outside the color identity, Game Changers (Scryfall's flag), mass land denial, extra turns, tutors and well-known two-card combos (a partial list), plus an **estimated bracket** with the reasons. It's labeled as an estimate; the owner sets the final bracket.
- **Deck versions**: when a list changes it becomes a new version, and saved games stay linked to the version that was played.
- **Commander art on tiles** from Scryfall, cached for offline play (can be turned off in Settings).
- **Pre-game balance check** in setup: warns when one deck's bracket or win rate is far above the rest of the pod.
- **Rivalries**: head-to-head records between players and between decks, nemesis and favorite target, and the group's top rivalries.
- **Game recaps**: a short story of each game from its log (swing round, first knockout, comeback, kingmaker, notes), shareable to WhatsApp.
- **Seasons**: calendar quarters with standings and an awards screen (champion, most damage, most knockouts, best deck); stats can be filtered by season.

### Importing from Moxfield

Moxfield has no official public API and doesn't let other sites read its decks, so the app can't fetch a deck by link on its own. There are two ways in, both without any proxy or server:

- **Paste from clipboard**: paste the deck link and tap Import. The app opens the deck on Moxfield; there, tap **More → Export → Copy plain text**, come back and tap **Paste from clipboard**.
- **One-tap bookmark and profile sync**: in **Settings → One-tap Moxfield import**, add the "Send to Commander Tracker" bookmark (drag it to the bookmarks bar, or copy its code into a bookmark on a phone). Tapped on a Moxfield deck page it sends that deck; tapped on a profile page (`moxfield.com/users/<name>`) it sends all of that user's public decks, and the app lists them to tick and sync, remembering the picks for next time ("Sync from Moxfield" on a player's page walks through it). The bookmark reads the decks on Moxfield's own page and hands them to the app in a new tab with `postMessage`, so nothing goes through a server. On iPhone/iPad it opens in Safari, which keeps its data apart from the Home Screen app, so use the clipboard there.

Everything is saved on the device: decks, games and the Scryfall card data used by deck checks (so checks work offline). Each deck can also be saved as a `.txt` decklist.

## Sharing players between phones

Players & decks → **Share players & decks** packs the chosen players, their decks and (optionally) the games they played into a link or a file to send on WhatsApp. Opening it on another phone adds them; people with the same name are merged, changed decks get a new version, and games are added once. No server is involved: the link carries the data itself (gzip-compressed, in the URL fragment).

## Usage log

Settings → Usage log counts which features get used (life taps vs. holds vs. swipes, attribution answers, screens, Moxfield use…), only on the device. Export or share it to plan the next version; see [ROADMAP.md](ROADMAP.md).

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
| `js/sound.js` | Synthesized "ouch" for commander damage. |
| `js/usage.js` | Local usage log. |
| `js/store.js` | localStorage persistence (playgroup data and the live game kept separately). |
| `js/i18n.js` | English and Hebrew strings. |
| `js/app.js` | UI: views, the game board, modals. |
| `sw.js` | Offline cache for the app shell. |

Tests (engine, stats, deck tools, recaps and translation coverage): `node --test test/*.test.js`

## Legal

Commander Tracker is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data via [Scryfall](https://scryfall.com/docs/api).
