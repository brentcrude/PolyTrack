// Playwright checks for index.html, run against the mock runtime in mock-claude.js.
// Usage:  node tests/run.mjs        (needs: npm i playwright)
// Uses pre-installed chromium from /opt/pw-browsers if available
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + '/' : import.meta.url);
const { chromium } = require('playwright');
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const page_html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const mock_js = readFileSync(path.join(here, 'mock-claude.js'), 'utf8');

const SEED = [
  { name: 'Hairpin Alley', code: 'AAA111', version: '0.5.2', channel: 'stable', notes: 'Tight', authorId: 'u_other', createdAt: 1000 },
  { name: 'Dev Sprint', code: 'BBB222', version: '0.6.0-dev3', channel: 'dev', notes: '', authorId: 'u_me', createdAt: 3000 },
  { name: 'Long Loop', code: 'CCC333', version: '0.10.1', channel: 'stable', notes: 'Wide', authorId: 'u_other', createdAt: 2000 },
];

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// Try to use pre-installed chromium from /opt/pw-browsers
let launchOptions = {};
const preinstalledChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (existsSync(preinstalledChromium)) {
  launchOptions.executablePath = preinstalledChromium;
  console.log('Using pre-installed Chromium from', preinstalledChromium);
}

const browser = await chromium.launch(launchOptions);

async function open(opts, viewport = { width: 1200, height: 900 }, dark = false) {
  const ctx = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u === 'http://polytrack.test/') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">' + page_html });
    }
    if (u.startsWith('https://fonts.')) return route.abort();
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript('window.__MOCK__ = ' + JSON.stringify(opts));
  await page.addInitScript(mock_js);
  await page.goto('http://polytrack.test/');
  await page.waitForSelector('#list .card, #list .empty:not(:has(h3:text("Loading")))');
  return { page, ctx, errors };
}

console.log('Desktop, seeded');
{
  const { page, ctx, errors } = await open({ seed: SEED });

  await check('renders all seeded cards, newest first', async () => {
    const names = await page.locator('.card h3').allTextContents();
    assert.deepEqual(names, ['Dev Sprint', 'Long Loop', 'Hairpin Alley']);
  });
  await check('stats count codes, channels and versions', async () => {
    assert.equal(await page.textContent('#st-total'), '3');
    assert.equal(await page.textContent('#st-stable'), '2');
    assert.equal(await page.textContent('#st-dev'), '1');
    assert.equal(await page.textContent('#st-ver'), '3');
  });
  await check('channel pills carry a text label', async () => {
    const pills = await page.locator('.pill.dev, .pill.stable').allTextContents();
    assert.ok(pills.includes('Dev release') && pills.includes('Stable'));
  });
  await check('author names resolve, own entries say "you"', async () => {
    const metas = await page.locator('.meta').allTextContents();
    assert.ok(metas.some((m) => m.startsWith('by you')), metas.join('|'));
    assert.ok(metas.some((m) => m.startsWith('by Another Driver')), metas.join('|'));
  });
  await check('version dropdown is sorted naturally, high to low', async () => {
    const opts = await page.locator('#vsel option').allTextContents();
    assert.deepEqual(opts, ['All versions', '0.10.1', '0.6.0-dev3', '0.5.2']);
  });
  await check('channel filter: Dev', async () => {
    await page.click('[data-chan="dev"]');
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Dev Sprint']);
    await page.click('[data-chan="all"]');
  });
  await check('version filter', async () => {
    await page.selectOption('#vsel', '0.5.2');
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Hairpin Alley']);
    await page.selectOption('#vsel', 'all');
  });
  await check('search matches name, notes and code', async () => {
    await page.fill('#q', 'wide');
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Long Loop']);
    await page.fill('#q', 'bbb222');
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Dev Sprint']);
    await page.fill('#q', 'zzzz');
    assert.equal(await page.locator('.empty h3').textContent(), 'Nothing matches');
    await page.click('.empty button');
    assert.equal(await page.locator('.card').count(), 3);
  });
  await check('sort by name', async () => {
    await page.selectOption('#sort', 'name');
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Dev Sprint', 'Hairpin Alley', 'Long Loop']);
    await page.selectOption('#sort', 'new');
  });
  await check('copy button copies the full code', async () => {
    await page.locator('.card', { hasText: 'Hairpin Alley' }).getByRole('button', { name: /Copy code/ }).click();
    assert.equal(await page.evaluate('window.__copied'), 'AAA111');
  });
  await check('show full code toggles', async () => {
    const card = page.locator('.card', { hasText: 'Hairpin Alley' });
    await card.getByRole('button', { name: 'Show full code' }).click();
    assert.ok(await page.locator('.card', { hasText: 'Hairpin Alley' }).locator('.code.full').count());
  });
  await check('submit validates required fields', async () => {
    await page.click('#submit');
    assert.match(await page.textContent('#e-name'), /name/i);
    assert.match(await page.textContent('#e-code'), /code/i);
    assert.match(await page.textContent('#e-version'), /version/i);
  });
  await check('bad version string is rejected', async () => {
    await page.fill('#f-name', 'X'); await page.fill('#f-code', 'ZZZ'); await page.fill('#f-version', '!!bad');
    await page.click('#submit');
    assert.match(await page.textContent('#e-version'), /letters, numbers/i);
  });
  await check('share a new dev code and see it listed', async () => {
    await page.fill('#f-name', 'Night Run');
    await page.fill('#f-code', 'DDD444');
    await page.fill('#f-version', '0.7.0-dev1');
    await page.click('.s-dev');
    await page.fill('#f-notes', 'Fresh');
    await page.click('#submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 4);
    assert.equal((await page.locator('.card h3').first().textContent()), 'Night Run');
    assert.equal(await page.inputValue('#f-code'), '');
  });
  await check('duplicate code is blocked and names the original', async () => {
    await page.fill('#f-name', 'Copycat'); await page.fill('#f-code', 'AAA111'); await page.fill('#f-version', '0.5.2');
    await page.click('#submit');
    assert.match(await page.textContent('#e-code'), /already shared as "Hairpin Alley"/);
    await page.fill('#f-code', '');
  });
  await check('version datalist suggests existing versions', async () => {
    const n = await page.locator('#version-list option').count();
    assert.ok(n >= 4);
  });
  await check('delete needs two clicks and removes own code', async () => {
    const card = page.locator('.card', { hasText: 'Dev Sprint' });
    await card.getByRole('button', { name: /^Delete/ }).click();
    await page.locator('.card', { hasText: 'Dev Sprint' }).getByRole('button', { name: /Confirm delete/ }).click();
    await page.waitForFunction(() => !document.body.textContent.includes('Dev Sprint'));
  });
  await check('cannot delete someone else\'s code', async () => {
    const card = page.locator('.card', { hasText: 'Long Loop' });
    assert.equal(await card.getByRole('button', { name: /Delete/ }).count(), 0);
  });
  await check('user text is rendered as text, not HTML', async () => {
    await page.fill('#f-name', '<img src=x onerror=window.__xss=1>');
    await page.fill('#f-code', 'XSS999'); await page.fill('#f-version', '1.0');
    await page.click('#submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length >= 4);
    assert.equal(await page.evaluate('window.__xss'), undefined);
  });
  await check('no uncaught page errors', async () => assert.deepEqual(errors, []));
  await ctx.close();
}

console.log('Empty store');
{
  const { page, ctx } = await open({ seed: [] });
  await check('shows designed empty state', async () => {
    assert.equal(await page.locator('.empty h3').textContent(), 'No codes shared yet');
  });
  await ctx.close();
}

console.log('Phone width');
{
  const { page, ctx } = await open({ seed: SEED }, { width: 390, height: 800 });
  await check('no horizontal scroll at 390px', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'overflow ' + over);
  });
  await check('compose panel hidden until toggled', async () => {
    assert.equal(await page.locator('#compose').isVisible(), false);
    await page.click('#compose-toggle');
    assert.equal(await page.locator('#compose').isVisible(), true);
  });
  await check('long unbroken code does not widen the page', async () => {
    await page.fill('#f-name', 'Huge');
    await page.fill('#f-code', 'Q'.repeat(5000));
    await page.fill('#f-version', '2.0');
    await page.click('#submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 4);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'overflow ' + over);
  });
  await ctx.close();
}

console.log('Dark theme');
{
  const { page, ctx } = await open({ seed: SEED }, undefined, true);
  await check('uses dark tokens when the OS is dark', async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(20, 24, 27)');
  });
  await ctx.close();
}

console.log('Access limits');
{
  let r = await open({ seed: SEED, canWrite: false });
  await check('view-only account cannot submit', async () => {
    assert.equal(await r.page.locator('#submit').isDisabled(), true);
    assert.match(await r.page.textContent('#submit-hint'), /View-only/);
  });
  await r.ctx.close();

  r = await open({ seed: SEED, noDb: true });
  await check('signed-out view shows a banner and disables the form', async () => {
    assert.match(await r.page.textContent('#banner'), /Sign in/);
    assert.equal(await r.page.locator('#submit').isDisabled(), true);
  });
  await r.ctx.close();

  r = await open({ seed: SEED, canEdit: true });
  await check('editors can delete anyone\'s code', async () => {
    const card = r.page.locator('.card', { hasText: 'Long Loop' });
    assert.equal(await card.getByRole('button', { name: /Delete/ }).count(), 1);
  });
  await r.ctx.close();
}

console.log('Sign-in (Supabase build)');
{
  let r = await open({ seed: SEED, me: null, canWrite: false, auth: { user: null } });
  await check('signed-out visitors can browse and see a sign-in form', async () => {
    assert.equal(await r.page.locator('.card').count(), 3);
    assert.equal(await r.page.locator('#auth-form').isVisible(), true);
    assert.match(await r.page.textContent('#submit-hint'), /Sign in above/);
  });
  await check('sign-in validates email and password length', async () => {
    await r.page.fill('#auth-email', 'nope'); await r.page.fill('#auth-pass', 'longenough1'); await r.page.click('#auth-submit');
    assert.match(await r.page.textContent('#auth-msg'), /valid email/);
    await r.page.fill('#auth-email', 'a@b.co'); await r.page.fill('#auth-pass', 'short'); await r.page.click('#auth-submit');
    assert.match(await r.page.textContent('#auth-msg'), /at least 8/);
  });
  await check('signing in sends email and password, then reloads', async () => {
    await r.page.fill('#auth-pass', 'longenough1'); await r.page.click('#auth-submit');
    await r.page.waitForFunction(() => window.__authCalls.includes('reload'));
    assert.deepEqual(await r.page.evaluate('window.__authCalls'), [{ mode: 'in', email: 'a@b.co', pass: 'longenough1' }, 'reload']);
  });
  await check('create-account mode asks for a display name and signs up', async () => {
    assert.equal(await r.page.locator('#auth-name').isVisible(), false);
    await r.page.click('#auth-mode');
    assert.equal(await r.page.locator('#auth-name').isVisible(), true);
    assert.equal(await r.page.textContent('#auth-submit'), 'Create account');
    await r.page.click('#auth-submit');
    assert.match(await r.page.textContent('#auth-msg'), /display name/);
    await r.page.fill('#auth-name', 'Zed'); await r.page.click('#auth-submit');
    await r.page.waitForFunction(() => window.__authCalls.filter((c) => c === 'reload').length === 2);
    const calls = await r.page.evaluate('window.__authCalls');
    assert.deepEqual(calls[2], { mode: 'up', email: 'a@b.co', pass: 'longenough1', name: 'Zed' });
  });
  await r.ctx.close();

  r = await open({ seed: SEED, me: null, canWrite: false, auth: { user: null, fail: true } });
  await check('a wrong password shows the backend\'s message and does not reload', async () => {
    await r.page.fill('#auth-email', 'a@b.co'); await r.page.fill('#auth-pass', 'longenough1'); await r.page.click('#auth-submit');
    await r.page.waitForFunction(() => /Invalid login/.test(document.getElementById('auth-msg').textContent));
    assert.equal((await r.page.evaluate('window.__authCalls')).includes('reload'), false);
  });
  await r.ctx.close();

  r = await open({ seed: SEED, me: null, canWrite: false, auth: { user: null, needsConfirm: true } });
  await check('when the project still requires confirmation, tell the user to check email', async () => {
    await r.page.click('#auth-mode');
    await r.page.fill('#auth-name', 'Zed'); await r.page.fill('#auth-email', 'a@b.co'); await r.page.fill('#auth-pass', 'longenough1');
    await r.page.click('#auth-submit');
    await r.page.waitForFunction(() => /confirm it/.test(document.getElementById('auth-msg').textContent));
    assert.equal((await r.page.evaluate('window.__authCalls')).includes('reload'), false);
  });
  await r.ctx.close();

  r = await open({ seed: SEED, auth: { user: { email: 'me@x.co' } } });
  await check('signed-in users see who they are, a sign-out link, and no form', async () => {
    assert.equal(await r.page.locator('#auth-form').isVisible(), false);
    assert.match(await r.page.textContent('#auth-who'), /me@x\.co/);
  });
  await r.ctx.close();

}

await browser.close();
console.log(process.exitCode ? '\nSome checks failed.' : `\nAll ${passed} checks passed.`);
