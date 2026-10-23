# iPhone Shortcut: Moxfield → Commander Tracker

Web pages can't read Moxfield (the browser's CORS rule), but Apple's Shortcuts app can, from the phone itself. This Shortcut fetches a user's public decks and copies them; the app then takes them with **Players & decks → your name → 📋 Paste decks from the Shortcut**.

One person with an iPhone builds it once (about 10 minutes) and shares its iCloud link; everyone else installs it with one tap. Put the iCloud link in `SHORTCUT_URL` in `js/app.js` so the app shows a "Get the Shortcut" button.

## Build it

Action names are as in the English Shortcuts app.

1. **Shortcuts** app → **+**. Name it **Moxfield → Commander Tracker**.
2. **Ask for Input**: input type **Text**, prompt *Moxfield username*.
3. **URL**: `https://api2.moxfield.com/v2/decks/search?authorUserNames=` + the **Provided Input** variable + `&pageNumber=1&pageSize=100&sortType=updated&sortDirection=descending`
4. **Get Contents of URL**: Show More → Headers → `Accept` = `application/json`.
5. **Get Dictionary Value**: Value for key `data` in **Contents of URL**.
6. **Text**: `CT-MOXFIELD-1 ` + **Provided Input**. Then **Add to Variable** `Export`.
7. **Repeat with Each** over **Dictionary Value**, and inside:
   1. **Get Dictionary Value**: Value for key `publicId` in **Repeat Item**.
   2. **URL**: `https://api2.moxfield.com/v3/decks/all/` + **Dictionary Value**.
   3. **Get Contents of URL** with the same `Accept: application/json` header.
   4. **Get Text from Input** (input: **Contents of URL**).
   5. **Add to Variable** `Export`.
   6. **Wait** 1 second.
8. After **End Repeat**: **Combine Text** of `Export` with **Custom** separator `@@CT@@`.
9. **Copy to Clipboard** (**Combined Text**).
10. **Show Notification**: *Copied! Open Commander Tracker → your player → Paste decks from the Shortcut.*
11. Run it once; tap **Allow** for api2.moxfield.com.
12. **⋯ → Share → Copy iCloud Link**, and send the link around.

## What it produces

`CT-MOXFIELD-1 <username>` followed by each deck's raw Moxfield JSON, separated by `@@CT@@`. `Decks.fromShortcutText` in `js/decks.js` reads it and keeps only decks by that username.
