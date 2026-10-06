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
| `profiles`, `admins` | display name; admin allow-list. |
| `track_summaries` view | one row per track for the homepage; never includes code. `security_invoker`. |

Times are server-side epoch milliseconds. A trigger bumps `tracks.updated_at` on each new release. v1's table is kept as `tracks_legacy`.

## Security model

- The anon key is public. Safety comes from **Row Level Security**: everyone reads; signed-in users insert only as themselves; only the track owner can add releases or edit name/description (column-level `update (name, description)` grant); owner or admin deletes; comment authors or admins delete comments.
- All user text is rendered with `textContent`; there is no `innerHTML` on user data (tested).
- The list views never download codes; a release's code is fetched only when selected.
- The repo contains no file-deletion code.

## Tests

- `tests/api.mjs`: api.js against a fake Supabase client (mapping, errors, writes refused when signed out, auth, install states).
- `tests/run.mjs`: Playwright (Chromium) drives the real page against `tests/mock-backend.js`. Covers home filtering/sorting, release defaults and deep links, comments, owner/admin controls, add/edit/delete, new track, live updates, XSS, 390px layout, dark mode, auth flows.
- Chromium: set `CHROMIUM=/path/to/chrome` if Playwright's own browser is not installed.
- Mock options (`window.__MOCK__`): `me`, `isAdmin`, `seed`, `names`, `auth`, `failCode`, `failList`, `noBackend`.

## Common changes

- **New field on releases**: add the column and any check in `schema.sql`, map it in `releaseOf` and the insert in `addRelease` (api.js), add a form field in `releaseFields` and display it in `renderPanel` (app.js), extend `tests/mock-backend.js`.
- **Limits** live in `MAX` in app.js and as `check` constraints in SQL; keep them in sync.
