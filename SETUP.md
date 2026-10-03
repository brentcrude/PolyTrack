# Self-hosting setup (Supabase + GitHub Pages)

Takes about 10 minutes and costs nothing. You will end up with a public site where anyone can browse and copy codes, and signed-in people can share them.

## 1. Create the backend

1. Sign up at https://supabase.com and click **New project** (any name, any region; save the database password somewhere, you will not need it again here).
2. Wait for the project to finish provisioning.
3. Open **SQL Editor -> New query**, paste all of `supabase/schema.sql`, and click **Run**. It is safe to run twice.
4. Open **Authentication -> URL Configuration** and set **Site URL** to the address your site will have (for GitHub Pages: `https://YOUR-USER.github.io/YOUR-REPO/`). Add the same address under **Redirect URLs**. Use the full address with `https://`, and add a second entry ending in `**` (for example `https://YOUR-USER.github.io/YOUR-REPO/**`).
5. Open **Project Settings -> API** and copy the **Project URL** and the **anon public** key.

6. Open **Authentication -> Sign In / Providers -> Email** and turn **Confirm email** **off**. Leave **Enable Email provider** on. With confirmation off, creating an account and signing in with a password send no email at all, so Supabase's low built-in email rate limit never comes into play. The trade-off is that nobody proves their address is real, which is fine for a codes site. Optionally raise **Minimum password length** to 8 to match the page.

Password reset is not built in (it needs email). If someone forgets their password, reset it for them under **Authentication -> Users**. If you later want self-service reset, add your own SMTP provider under **Authentication -> Emails -> SMTP Settings** so the email limit stops mattering.

## 2. Connect the page

Edit `config.js` and paste the two values:

```js
window.POLYTRACK_CONFIG = {
  supabaseUrl: 'https://abcdxyz.supabase.co',
  supabaseAnonKey: 'eyJ...'
};
```

The anon key is meant to be public. Never paste the `service_role` key anywhere in this folder.

## 3. Publish

1. Create a GitHub repo and upload `index.html`, `adapter.js` and `config.js` (the `tests`, `supabase` and docs files are optional).
2. **Settings -> Pages -> Build and deployment**: source **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the site is live at the address you used in step 1.4.

Any static host works the same way (Netlify, Cloudflare Pages, a folder on your own server).

## 4. Make yourself an admin (optional)

Admins can delete any code. Create an account on the live site first, then run this in the SQL Editor:

```sql
insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
```

Reload the site and the delete button appears on every card.

## How it works

`adapter.js` presents Supabase to the page through the same small `db` and `user` interface the page was first written against, so `index.html` has no Supabase-specific code. When the page is opened inside Claude, the adapter steps aside and the Claude runtime is used instead.

| Question | Answer |
| --- | --- |
| Who can read codes? | Everyone, signed in or not. |
| Who can add? | Signed-in users, and only as themselves (`author_id` is set by the database, not the page). |
| Who can delete? | The author, or anyone listed in `admins`. Enforced by Row Level Security, so editing the page cannot bypass it. |
| Duplicates? | The page warns and names the original; a unique index on the code is the backstop. |
| Names? | Stored once in `profiles`, taken from the create-account form, and looked up when rendering. |
| Live updates? | Supabase Realtime triggers a reload of the list whenever a code changes. |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Banner says "not connected to a backend yet" | `config.js` still has the placeholder values. |
| Banner says it could not load the Supabase library | The CDN was blocked or offline; reload, or self-host `supabase.min.js` next to the page. |
| `requested path is invalid` | Redirect URLs (step 1.4) are missing `https://` or the `**` entry. Only matters if you turn confirmation emails back on. |
| "Account created. Check your email and confirm it" | **Confirm email** is still on (step 1.6). Turn it off, or confirm via the email. |
| "email rate limit exceeded" | Confirmation emails are on and the limit was hit. Turn **Confirm email** off (step 1.6). |
| "Invalid login credentials" | Wrong email or password. Accounts made earlier with email links have no password: reset one under **Authentication -> Users**. |
| Sharing says "This account can browse and copy codes but not share them" | The database refused the write: you are signed out, or the schema was not run. |
| Codes load but never update live | Re-run `schema.sql`; the last block enables Realtime for the table. |
