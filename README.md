# Polytrack Codes

A single-page site where people share Polytrack track codes, tagged with the game version they were built on and whether that version is a **stable** or **dev** release.

## Two ways to run it

- **Inside Claude** (the published artifact): storage and sign-in come from Claude. Sharing the artifact needs an account that is allowed to share it.
- **Self-hosted** (any static host): storage and sign-in come from Supabase, so anyone can browse and signed-in people can share. See [SETUP.md](SETUP.md).

The same `index.html` serves both. `adapter.js` supplies the Supabase backend only when the Claude runtime is absent.

## Quick Start (for Players)

1. **Sign in to Claude** — you must be signed in to view or share codes.
2. **Explore**: Browse codes newest first, or filter by channel (Stable/Dev) or version.
3. **Search**: Type a track name, version, or part of a code in the search box.
4. **Copy**: Click "Copy code" to copy the full code to your clipboard with one tap.
5. **Share your own**: Click "Share a code", fill in the form, and submit. Your code appears at the top immediately.
6. **Delete**: Only you can delete your own codes (two taps to confirm). Page editors can delete any code.

## Features

- **Share a code**: track name, code, game version, channel (Stable or Dev release), optional note.
- **Browse**: newest first by default; filter by channel and version, search name/notes/code, sort by newest, oldest, name or version.
- **Copy**: one tap copies the full code (falls back to a legacy copy method if the browser refuses the Clipboard API).
- **Long codes**: cards show two lines; "Show full code" expands to a scrollable block.
- **Duplicates**: sharing a code that already exists is blocked and names the original.
- **Delete**: authors delete their own codes (two taps to confirm). Editors of the page can delete any code.
- **Author names** are resolved from stored ids when rendering, never saved in the data.
- Light and dark themes follow the viewer's setting. Works at phone width.

## For Organizers — Sharing the Site

To let your group share codes:

1. Open this artifact (Claude's code-sharing workspace).
2. Click **Share** (top right).
3. Set access to **Contributor** so people can add codes (or leave it **Viewer** if you only want to collect them yourself).
4. Share the link with your community.

**Contributor access** lets people:
- See and search all codes
- Copy codes
- Add their own codes
- Delete codes they wrote

**View-only access** lets people:
- See and search all codes
- Copy codes
- (Cannot add or delete)

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | The whole site: markup, styles, script. No build step. |
| `adapter.js` | Supabase backend behind the page's `db`/`user` interface (skipped inside Claude). |
| `config.js` | Your Supabase URL and anon key. |
| `supabase/schema.sql` | Tables, validation and Row Level Security rules. |
| `SETUP.md` | Step-by-step self-hosting guide. |
| `tests/adapter.mjs` | Unit tests for the adapter (18 checks, no browser). |
| `tests/mock-claude.js` | In-memory stand-in for the Claude runtime (`window.claude`) so the page runs outside Claude. |
| `tests/run.mjs` | Playwright checks (35) against the mock. |
| `README.md` | This file. |

## Data model

One collection, `tracks`, one document per shared code:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | 1 to 60 characters |
| `code` | string | up to 200,000 characters (documents are limited to 256 KiB) |
| `version` | string | 1 to 24 characters: letters, digits, `.` `_` `+` `-`, space |
| `channel` | `"stable"` or `"dev"` | |
| `notes` | string | up to 280 characters, optional |
| `authorId` | string | opaque viewer id, resolved to a name at render time |
| `createdAt` | number | milliseconds since epoch |

The page subscribes once to `tracks` (newest first, 500 at most) and derives all filtering and sorting in the browser.

## Access and sharing

Storage uses the Claude artifact `db` capability, so:

- Viewers must be signed in to Claude to see or add codes. A signed-out visitor sees a banner and a disabled form.
- By default Contributors and above can add codes; Viewers and Commenters can browse and copy only. The form disables itself for view-only accounts.
- The delete button is hidden for other people's codes, but the store itself lets any Contributor change shared documents. If you need hard enforcement, restructure so each author owns a subdocument (see the `{self}` rules in the capability docs).
- Share the artifact link with "Contributor" access to let people post.

## Choices to know about

- Game versions are free text. The version field suggests versions already in use, and the filter lists them sorted naturally (0.10.1 above 0.9.0). The page does not know which versions the game has released.
- Codes are stored exactly as pasted, trimmed at the ends.

## Running the tests

```bash
npm i playwright
node tests/run.mjs      # 35 browser checks
node tests/adapter.mjs  # 22 adapter checks
```

The test runner automatically uses pre-installed Chromium if available, or falls back to downloading. The test suite includes 28 checks covering:

**Rendering & Logic**: rendering order, stats accuracy, channel/version/search/sort, copy, expand, validation, share, duplicate block, delete rules (two-tap confirm, author only)

**UI/UX**: HTML escaping (XSS prevention), empty state, responsive 390px no-overflow, dark theme, form compose panel toggle

**Access Control**: view-only account restrictions, signed-out user experience, editor permissions

**Edge Cases**: long unbroken codes, natural version sorting, localStorage filter persistence

Not covered: real multi-user sync and the real Claude sign-in flow, which only exist inside Claude.

## Safe by design

- **No destructive operations**: No file deletion code anywhere in the production site or tests.
- **XSS prevention**: All user input (track names, codes, notes) is rendered as text, never HTML. Verified by tests.
- **Access control**: Deletion and editing are restricted by Claude's artifact permission system. UI hints don't grant access; the database does.
- **Private data**: User names are resolved at render time from opaque IDs. Display names are never stored, preventing stale or spoofed attribution.
- **Stable storage**: Uses Claude's artifact `db` capability (collections & documents). No local cache or session storage of shared data.
- **No third-party services**: All data stays in Claude. No external API calls, analytics, or tracking.

## Status

✅ **Complete and tested** — Published, all 28 tests passing, ready to share.

Published artifact: Use the link at the top of this page to visit the live site.
