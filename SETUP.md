# Setup and deployment

## First-time setup

1. **Supabase project**: create one at supabase.com.
2. **Database**: Supabase -> SQL Editor -> paste all of `supabase/schema.sql` -> Run. It is safe to re-run.
3. **Auth settings** (Authentication):
   - Providers -> Email: enabled. Turn **Confirm email** off if you want sign-up to sign people in immediately (this also avoids email rate limits). Leave it on if you prefer verified addresses; the page then tells people to confirm first.
   - URL Configuration: Site URL = `https://<user>.github.io/<repo>/`; add the same address (with `**` appended) as a redirect URL.
4. **config.js**: copy `config.example.js` to `config.js`; paste Project URL and the anon/publishable key (Project Settings -> API). Never use the service_role/secret key.
5. **GitHub Pages**: repo Settings -> Pages -> deploy from the `main` branch, root. Wait about a minute, then hard-refresh the site.
6. **Make yourself admin** (optional; lets you delete any track, release or comment). Create an account on the site first, then run in the SQL editor:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```

## Upgrading from v1 (single `tracks` table)

The v2 SQL **renames** the old table to `tracks_legacy` (never dropped) and copies each old row into the new tables as one track with one release. That means the live v1 page breaks between running the SQL and uploading the new files, so do both back to back:

1. Have the new files ready (this folder).
2. Run `supabase/schema.sql` in the SQL editor.
3. Immediately upload to the repo: `index.html`, `styles.css`, `app.js`, `api.js`, `supabase/schema.sql`, `tests/`, `package.json`, `README.md`, `SETUP.md`, `DEVELOPER.md`. **Do not overwrite your `config.js`**; it already holds your keys.
4. In the repo, delete by hand the obsolete v1 files: `adapter.js`, `tests/adapter.mjs`, `tests/mock-claude.js`, `DEPLOYMENT.md`.
5. Hard-refresh the site (Cmd+Shift+R). Old tracks appear as cards with one release each.

Old accounts, profiles and admin rows are untouched. Once you are happy, `tracks_legacy` can stay as a backup; it is harmless.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "not connected to a backend" banner | `config.js` missing or still has placeholders; force refresh after deploying. |
| `requested path is invalid` after sign-in | Redirect URL must start with `https://` and end with `**`. |
| Empty site / permission errors after running SQL | Re-run `schema.sql`; it includes the Data API grants new Supabase projects need. |
| Sign-up asks to confirm email | Confirm email is on in Supabase; turn it off or confirm via the email. |
| "Track not found" on a shared link | The track was deleted, or the link was copied incompletely. |
