# Developer guide

## Architecture

Vanilla JS, no build. Script order in `index.html`: `config.js` -> Supabase CDN -> `api.js` -> inline install -> `app.js`.

- **api.js** is the only code that knows about Supabase. It exposes `window.polytrack = { api, auth }` with camelCase objects. If `window.polytrack` already exists it does nothing, which is how tests inject a mock.
- **app.js** is the UI: hash router, views, forms. It talks only to `polytrack.api` and `polytrack.auth`.
- **styles.css**: design tokens, light and dark themes.

### Routes

| Hash | View |
| --- | --- |
| `#/` | home (track cards) |
| `#/new` | new track with its first release |
| `#/t/<trackId>` | track page, default release = newest stable, else newest dev |
| `#/t/<trackId>/r/<releaseId>` | deep link to a release |

Switching release replaces the URL (no history spam); changing the hash between releases of the same track updates in place without rebuilding the page (comment drafts survive).

## Data model (supabase/schema.sql)

| Table | Notes |
| --- | --- |
| `tracks` | name (1-60), description (<=500), author, created/updated ms. |
| `track_releases` | game_version, channel `stable`/`dev`, code (<=200000), notes, generated `code_length`. Unique per (track, md5(code)). |
| `comments` | optional `release_id` (set null if that release is deleted). |
| `ratings` | one row per (track, user): `score` 1 to 5 (checkpoints 1-4, finish line = 5). Owners cannot rate their own track (RLS). |
| `announcements` | title (1-80), body (<=1000), style (`info`/`success`/`warn`/`party`/`loud`, default `loud`), optional `expires_at` (ms). Everyone reads; only admins insert (as themselves) or delete. In the realtime publication. |
| `profiles`, `admins` | display name; admin allow-list. |
| `track_summaries` view | one row per track for the homepage; never includes code. Also carries `difficulty`, `rating_avg`, `rating_count`. `security_invoker`. |

`tracks.difficulty` is a nullable smallint 1-5 (Easy, Medium, Hard, Expert, Extreme), set by the creator; null = not set (older tracks).

Times are server-side epoch milliseconds. A trigger bumps `tracks.updated_at` on each new release. v1's table is kept as `tracks_legacy`.

## Ratings and difficulty

- The widget (`checkpointBar` in app.js) draws four round checkpoints and a chequered finish flag. Read-only on cards and the track summary; a keyboard-accessible radio group on the track page (arrows move, Enter picks, picking your current score clears it).
- `api.rateTrack` updates the caller's row, and inserts only if none existed. It deliberately avoids a one-call upsert: an upsert rewrites `track_id`/`user_id`, which the column-level grant (`update (score)`) correctly forbids.
- Home "Top rated" sorts by a smoothed average `(sum + 3*2) / (n + 2)` so a single 5 doesn't beat many good ratings; unrated tracks sort last. The card still shows the raw average.
- Recency filter compares `updatedAt` with now (24 h / 7 d / 30 d). `updated_at` is bumped by new releases.
- Ratings failing to load never breaks the track page; they just show as empty.

## Popups and announcements

- `popups.js` owns every popup (`window.Popups`; API and options in ANNOUNCING.md). It loads before app.js; app.js's `toast()` just calls `Popups.toast`, so the `#toast` element behaviour is unchanged.
- `checkAnnouncements()` (app.js) lists announcements, drops expired ones, and calls `Popups.announce` for each (oldest first). `Popups.announce` skips ids already in `localStorage` and never queues one twice. It runs at start and after every realtime event (debounced 300 ms). A failure (table missing, offline) is swallowed on purpose.
- `announcePanel()` is the admin UI on the home page; the database, not the UI, enforces admin-only writes (RLS `is_admin()`).
- Previews call `Popups.show` without an id, so they are never marked seen.
- Cards scroll internally (`max-height: 100dvh - 32px`), so long text cannot push the button off a phone screen.

## Security model

- The anon key is public. Safety comes from **Row Level Security**: everyone reads; signed-in users insert only as themselves; only the track owner can add releases or edit name/description (column-level `update (name, description)` grant); owner or admin deletes; comment authors or admins delete comments.
- Ratings: everyone reads; insert only as yourself and never on your own track; update only your own `score`; delete your own (or admin).
- Announcements: everyone reads; insert and delete require `is_admin()`; popups render text only.
- All user text is rendered with `textContent`; there is no `innerHTML` on user data (tested).
- The list views never download codes; a release's code is fetched only when selected.
- The repo contains no file-deletion code.

## Tests

- `tests/api.mjs`: api.js against a fake Supabase client (mapping, errors, writes refused when signed out, ratings update/insert/race, auth, install states).
- `tests/run.mjs` (includes a Popups section: queueing, Escape/backdrop rules, confetti and reduced motion, XSS, live arrival, phone fit, admin preview/send/delete): Playwright (Chromium) drives the real page against `tests/mock-backend.js`. Covers home filtering/sorting (channel, version, difficulty, recency, top rated, hardest), difficulty on create/edit, rating by mouse and keyboard, release defaults and deep links, comments, owner/admin controls, add/edit/delete, new track, live updates, XSS, 390px layout, dark mode, auth flows.
- Chromium: set `CHROMIUM=/path/to/chrome` if Playwright's own browser is not installed.
- Mock seed shape: `{ tracks, releases, comments, ratings, announcements }` (announcements: `{ id, title, body, style, createdAt, expiresAt }`; test hooks `__mock.addAnnouncement` + `__mock.emit`) (tracks may carry `difficulty`; ratings are `{ trackId, userId, score }`).
- Mock options (`window.__MOCK__`): `me`, `isAdmin`, `seed`, `names`, `auth`, `failCode`, `failList`, `noBackend`.

## Common changes

- **New field on releases**: add the column and any check in `schema.sql`, map it in `releaseOf` and the insert in `addRelease` (api.js), add a form field in `releaseFields` and display it in `renderPanel` (app.js), extend `tests/mock-backend.js`.
- **Limits** live in `MAX` in app.js and as `check` constraints in SQL; keep them in sync.
