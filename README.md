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

## Changing things

- Adding a past champion: insert a row into `champions` (month `yyyy-mm`, players as a comma list of ids, total) in the D1 console.
- Schema changes: add the SQL to `schema.sql` and run it in the D1 console in the same step.
- Backups: D1 Time Travel keeps 30 days.
