# Wordle Wars

The family's monthly Wordle competition: https://wordlewars.reevesrestorations.com (public, no login). Lowest total guesses for the month wins; a missed day counts as 7 once the day is over.

## How it runs (since Nov 22, 2026)

- **Hosting:** Cloudflare Pages project `wordle-wars`, built from this repo. A push to `main` publishes in about a minute; other branches get preview addresses (`<branch>.wordle-wars.pages.dev`), but previews use the live database, so don't push preview branches until a separate preview database is set up in `wrangler.toml` (`[env.preview]`). Settings live in `wrangler.toml`; the one secret, `WW_KEY`, is set in the Pages dashboard (Production and Preview).
- **Page:** `public/index.html` (one file: styles and script inline). It reloads itself when the app comes back after 30 minutes away, so home-screen copies pick up new code. Icons and manifest sit beside it; `public/_headers` sets security headers and caching.
- **Data:** Cloudflare D1 database `wordle-wars`, tables in `schema.sql` (players, scores, adjustments, champions, talk, history). Every change lands in `history` with what changed.
- **API:** `functions/api/[[path]].js`. The page POSTs `{args:[...]}` to `/api/<name>`: getData, saveScore, saveTalk, removeScore, addPlayer, setReminder. Same rules and answer shapes the old Apps Script had, all checked on the server. Key-protected (header `x-key` = `WW_KEY`): `GET /api/remind` (who still needs tonight's reminder email), `POST /api/admin/import` and `GET /api/admin/compare` (used once to copy the old sheet in and prove the two matched row for row; import now refuses because the site is live).
- **8 PM reminder emails:** still sent from Golden's Gmail by the Apps Script "Wordle Wars" in Drive (copy in `apps-script/Code.gs`), which now asks `/api/remind` who to email. Its Script Properties: `WW_KEY` and `MODE=moved` (any old copy of the page that tries to save is told the game moved). Upgrade path: a proper email service (e.g. Resend) sending from a reevesrestorations.com address, then the script can be retired.
- **Claude's access:** the read-only `wordle_query` tool on the Golden To-Dos connector (reeves-restorations repo, `timer/src/mcp.js`). The Wordle Wars daily recap task uses it; its rules are the Drive doc "Wordle Wars: Daily Recap Rules".
- **Old sheet:** "ARCHIVED Wordle Wars Scores" in Drive, locked read-only. History only.
- **CNAME:** left over from the GitHub Pages days so the old github.io link still forwards here.

## Play tab: practice Wordle (since Nov 25, 2026)

Our own Wordle inside the app. Anyone can play as many practice games as they like; practice never touches the scoreboard. "Today's Wordle" (the one game a day that counts) is coming December 1 with sign-in (email code and Google), a kick button for Golden, and approval for new accounts.

- **Answers stay on the server.** `practiceStart` picks a word and stores it in the `practice` table; `practiceGuess` checks a guess and returns only the colors (g right spot, y elsewhere, x not in it); the answer is sent back only when the game ends. `practiceGet` restores a game after a reload. Games older than 2 days are deleted when a new one starts.
- **Word lists:** `lib/words.js` (server only, never in `public/`). `ANSWERS` (about 1,600) is the public Wordle list filtered to words most US adults know and use today: common in modern spoken English (OpenSubtitles frequency), then hand-checked; no names, slang, plurals, archaic or vulgar words. `ALLOWED` (about 14,900) is every word accepted as a guess. To add or drop an answer, edit the `ANSWERS` string.

## Accounts and today's Wordle (since Nov 25, 2026)

- **The new way vs the old way.** Old way: typing your guess count on the Log tab. New way: playing today's Wordle on the Play tab, which logs the score itself. Nov 25 to 30 is a test run of the new way: its games live in the `daily` table and show as a separate "New way test run" board with no crown, while the old way still decides November. From Dec 1 (`CUTOVER` in both `functions/api/[[path]].js` and `public/index.html`) a finished game is also written into `scores`, so the normal board, champions and recap use it, and the old Log tab refuses any day from Dec 1 on (it stays open on Dec 1 only so Nov 30 can still be logged, then disappears and Play takes its green spot).
- **Sign-in:** email code (sent by Resend from noreply@reevesrestorations.com; secret `RESEND_API_KEY` in the Pages dashboard) or Continue with Google (`GOOGLE_CLIENT_ID` in `wrangler.toml`, the "Wordle Wars site" client in the Google Cloud project "Wordle Wars", id local-tracker-515816-f0, published to production). A session is a year-long HttpOnly cookie; only its SHA-256 is stored (`sessions`). Codes are hashed, last 10 minutes, 5 tries, one a minute per email and 10 an hour per network (`codes`).
- **Approval:** a new account (`accounts`) is pending until Golden approves it. An email that matches a player's reminder email links to that player automatically; goldenreeves34@gmail.com is the admin. Pending accounts can play practice but not today's Wordle.
- **Admin page** (Play tab, "Admin", Golden only): approve an account as an existing player (keeps their history) or a new player, or deny/kick. A kick blocks that email for good and wipes that player's scores, games, trash talk and row.
- **Today's word:** a fixed shuffle of `ANSWERS` seeded by the secret `WW_KEY`, one word per day starting Nov 25, no repeats until the list runs out (about 4.4 years). Editing `ANSWERS` or changing `WW_KEY` reshuffles the days after that change. Practice never hands out any of the next 30 days' words.
- **Anti-cheat:** the answer never leaves the server until the game ends; a guess only counts if nothing else wrote to that game in between, so firing many guesses at once can't reveal extra colors.
- **Trash talk** from Dec 1 is posted on the Board by signed-in players (`talkPost`).
- `public/privacy.html` is the privacy page Google's sign-in setup links to.

## Changing things

- Adding a past champion: insert a row into `champions` (month `yyyy-mm`, players as a comma list of ids, total) in the D1 console.
- Schema changes: add the SQL to `schema.sql` and run it in the D1 console in the same step.
- Backups: D1 Time Travel keeps 30 days.
