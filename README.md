# Polytrack Codes

A small site for sharing Polytrack track codes, organised like a code-hosting repo:

- **Home**: a grid of track cards (name, description, difficulty, rating, latest stable and dev version, release and comment counts). Search; filter by channel, game version, difficulty or **how recently the track was updated** (today / this week / this month); sort by recently updated, newest, name, most releases, **top rated** or **hardest first**.
- **Track page**: the track name and description, a **release picker** (every game version the creator published), the code with a Copy button, release history, and comments.
- **Releases**: instead of posting a new track per game version, the creator opens their track and clicks **Add a release**. Each release is marked **Stable** or **Dev**. Dev releases carry a warning and are never the default when a stable one exists.
- **Difficulty**: the creator picks Easy, Medium, Hard, Expert or Extreme when creating a track (and can change it later).
- **Ratings**: instead of five stars, a track is rated on a road of **four checkpoints and a finish line** (scores 1 to 5; the finish line is the best score, "Flawless"). One rating per person, changeable, tap your score again to remove it. You can't rate your own track.
- **Announcements and popups**: admins get an **Announce** button on the home page to broadcast a popup (obnoxious, party, warning, good news or plain). Everyone sees each one once, live if they are already on the site. All popups on the site (toasts, alerts, confirmations, announcements) go through one small `window.Popups` API.
- **Accounts**: email + password. Anyone can browse and copy; signing in lets you create tracks and comment.

Static site (GitHub Pages) + Supabase (Postgres, Auth, Realtime). No build step.

## Documents

| File | Read it when |
| --- | --- |
| [SETUP.md](SETUP.md) | Deploying for the first time, or **upgrading from v1** (the single-table version). |
| [ANNOUNCING.md](ANNOUNCING.md) | You want to send an announcement or use the popups from code. |
| [DEVELOPER.md](DEVELOPER.md) | Changing the code: architecture, data model, security model, tests. |

## Quick start (local)

```bash
cp config.example.js config.js   # fill in your Supabase URL and anon key
python3 -m http.server 8000      # then open http://localhost:8000
```

## Tests

```bash
npm install
npm test        # api.mjs (34 unit checks) then run.mjs (68 browser checks)
```

Browser tests run against an in-memory mock backend, so they need no network and no Supabase project.

## Layout

```
index.html  styles.css  app.js  api.js  popups.js  config.js
supabase/schema.sql        database, grants, security policies
tests/                     api.mjs, run.mjs, mock-backend.js
```
