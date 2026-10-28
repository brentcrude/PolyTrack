# Announcements and popups

## Sending an announcement (admins)

1. Be an admin (SETUP.md step 6) and sign in.
2. On the home page click **Announce**.
3. Write a headline (required) and a message (optional), choose a style and when it should disappear, then:
   - **Preview** shows the popup only to you and is never recorded as seen.
   - **Send to everyone** publishes it. People already on the site get it within a moment; everyone else gets it when they next open the site. Each browser shows it once.
4. The **Sent announcements** list under the form shows what is live. Click a row's delete button twice (the first tap arms it) to withdraw one.

| Style | Look and behaviour |
| --- | --- |
| Obnoxious (`loud`, default) | Red kerb stripe, shakes and flashes, cannot be closed with Escape, a backdrop click or an X: only its button. |
| Party (`party`) | Confetti. |
| Warning (`warn`), Good news (`success`), Plain notice (`info`) | Calm; Escape, backdrop click and X all close them. |

With "reduce motion" turned on in the visitor's system there is no shaking, flashing or confetti.

Announcements are remembered per browser (`localStorage` key `pt-seen-announcements`), so a visitor who clears site data or switches device sees them again. Expired announcements are never shown.

## Using popups from code (`popups.js`)

```js
Popups.toast('Saved');                                   // small message at the bottom
await Popups.alert('Heads up', 'Maintenance at 9pm');    // resolves when closed
if (await Popups.confirm('Delete it?', 'This cannot be undone', { yes: 'Delete', no: 'Keep' })) { /* ... */ }
const pick = await Popups.show({
  title: 'Which one?', body: 'Choose.', style: 'party',
  actions: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b', primary: true }]
});                                                      // 'a' / 'b', or null if dismissed
Popups.announce({ id: 'unique-id', title: 'Hi', body: '...', style: 'loud' }); // once per browser
Popups.clear();                                          // drop the queue and close the open one
```

- Options for `show`: `title`, `body`, `style` (`info` default, `success`, `warn`, `party`, `loud`), `badge` (label text; default per style), `actions`, `dismissible` (default false only for `loud`).
- Popups queue and show one at a time. They are native `<dialog>` elements, so focus is trapped and returned by the browser.
- Text is always set with `textContent`; HTML in titles or bodies is shown literally.
- `confirm` resolves `true` only when the confirm button is clicked (X, Escape and backdrop give `false`).

## Turning it on (one-time)

1. Run `supabase/update-announcements.sql` in the Supabase SQL editor (safe to re-run; it only adds the `announcements` table).
2. Upload `index.html`, `popups.js`, `app.js`, `api.js`, `styles.css`. Do not overwrite `config.js`.
3. Hard-refresh.

If the SQL has not been run, the site simply shows no announcements, and **Send** reports that the SQL needs running.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No Announce button | You are not signed in, or not in `public.admins`. |
| "Only admins can announce" | Same: add yourself to `public.admins` (SETUP.md step 6). |
| "Could not send" | `update-announcements.sql` has not been run yet. |
| Nobody sees it | It has expired, they have already seen it in that browser, or the page is the old cached one (hard-refresh). |
