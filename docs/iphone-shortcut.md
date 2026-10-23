# iPhone Shortcut: Moxfield → Commander Tracker

Web pages can't read Moxfield (the browser's CORS rule), but Apple's Shortcuts app can, from the phone itself. This Shortcut fetches a user's public decks and copies them; the app then takes them with **Players & decks → your name → 📋 Paste decks from the Shortcut**.

One person with an iPhone builds it once (about 10 minutes) and shares its iCloud link; everyone else installs it with one tap. Put the iCloud link in `SHORTCUT_URL` in `js/app.js` so the app shows a "Get the Shortcut" button.

## Build it

Action names are as in the English Shortcuts app. Add each action by typing its name in the search box at the bottom of the editor.

1. **Shortcuts** app → **+**. Name it **Moxfield**.
2. **Ask for Input** (asks for the username).
3. **Text**: paste `https://api2.moxfield.com/v2/decks/search?pageNumber=1&pageSize=100&sortType=updated&sortDirection=descending&authorUserNames=` and, with the keyboard still open, tap **Ask for Input** in the bar above it so the variable ends the same line. (Use **Text**, not **URL**: the URL action splits it into separate addresses.)
4. **Get Contents of URL** (of **Text**).
5. **Get Dictionary Value**: key `data`.
6. **Repeat with Each** item in **Dictionary Value**, and inside it:
   1. **Get Dictionary Value**: key `publicId` in **Repeat Item**.
   2. **Text**: `https://api2.moxfield.com/v3/decks/all/` followed by the **Dictionary Value** variable.
   3. **Get Contents of URL** (of **Text**).
   4. **Add to Variable** `Decks`.
   5. **Wait** 1 second (Moxfield limits how fast it can be asked).
7. After **End Repeat**: **Combine Text** of `Decks` with **Custom** separator `@@CT@@`.
8. **Copy to Clipboard**.
9. Run it once and tap **Allow** for moxfield.com.
10. Press and hold the Shortcut → **Share** → **Copy iCloud Link**, and send the link around.

## What it produces

Each deck's raw Moxfield JSON, separated by `@@CT@@` (optionally preceded by a `CT-MOXFIELD-1 <username>` line, which makes the app keep only decks by that username). `Decks.fromShortcutText` in `js/decks.js` reads it.
