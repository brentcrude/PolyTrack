// Unit tests for adapter.js against a fake Supabase client. No browser, no network.
// Usage: node tests/adapter.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { create, install, toDoc, toRow, mapError } = createRequire(import.meta.url)('../adapter.js');

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// Minimal in-memory stand-in for the parts of supabase-js the adapter calls.
function fakeClient({ user = null, admins = [], profiles = {}, tracks = [], failInsert = null } = {}) {
  const calls = { inserted: [], deleted: [], removedChannels: 0 };
  let session = user ? { user: { id: user, email: user + '@x.co' } } : null;
  let feedHandler = null;
  const rows = tracks.slice();
  const builder = (table) => {
    const q = { _f: {}, _op: 'select' };
    const run = () => {
      if (q._op === 'insert') {
        if (failInsert) return { error: failInsert };
        calls.inserted.push(q._row); rows.push({ id: 'n' + rows.length, author_id: user, ...q._row });
        if (feedHandler) setTimeout(feedHandler, 0);
        return { error: null };
      }
      if (q._op === 'delete') { calls.deleted.push(q._f.id); return { error: null }; }
      if (table === 'tracks') return { data: rows.slice().sort((a, b) => b.created_at - a.created_at).slice(0, q._lim || 1e9), error: null };
      if (table === 'profiles') return { data: Object.entries(profiles).filter(([id]) => (q._in || []).includes(id)).map(([id, name]) => ({ id, name })), error: null };
      if (table === 'admins') return { data: admins.includes(q._f.user_id) ? { user_id: q._f.user_id } : null, error: null };
    };
    Object.assign(q, {
      select() { return q; }, order() { return q; }, limit(n) { q._lim = n; return q; },
      eq(k, v) { q._f[k] = v; return q; }, in(_k, v) { q._in = v; return q; },
      insert(row) { q._op = 'insert'; q._row = row; return q; }, delete() { q._op = 'delete'; return q; },
      maybeSingle() { return q; },
      then(ok, bad) { return Promise.resolve(run()).then(ok, bad); }
    });
    return q;
  };
  return {
    calls, rows,
    auth: { getSession: () => Promise.resolve({ data: { session } }), onAuthStateChange() {}, signInWithPassword: (a) => { calls.pw = a; return Promise.resolve(a.password === 'bad' ? { error: { message: 'Invalid login credentials' } } : { error: null }); },
      signUp: (a) => { calls.signup = a; return Promise.resolve({ data: { session: a.options.data.name === 'Pending' ? null : { user: { id: 'new' } } }, error: a.password === 'dup' ? { message: 'User already registered' } : null }); }, signOut: () => Promise.resolve({}) },
    from: builder,
    channel() { const c = { on(_e, _f, fn) { feedHandler = fn; return c; }, subscribe() { return c; } }; return c; },
    removeChannel() { calls.removedChannels = ++calls.removedChannels; }
  };
}

const ROW = { id: 'r1', name: 'Alley', code: 'AAA', version: '0.5.2', channel: 'stable', notes: null, author_id: 'u1', created_at: '1000' };

console.log('Mapping');
await check('rows map to the page\'s document shape and back', () => {
  assert.deepEqual(toDoc(ROW), { name: 'Alley', code: 'AAA', version: '0.5.2', channel: 'stable', notes: '', authorId: 'u1', createdAt: 1000 });
  assert.deepEqual(toRow({ name: 'A', code: 'B', version: '1', channel: 'dev', notes: '', createdAt: 5, authorId: 'spoof' }),
    { name: 'A', code: 'B', version: '1', channel: 'dev', notes: '', created_at: 5 });
});
await check('author id is never taken from the page (the database sets it)', () => {
  assert.equal('author_id' in toRow({ authorId: 'spoof' }), false);
});
await check('errors map to the codes the page handles', () => {
  assert.equal(mapError({ code: '42501' }).code, 'invalid_argument');
  assert.equal(mapError({ code: '23505' }).code, 'already_exists');
  assert.equal(mapError({ code: 'x' }).code, 'unknown');
});

console.log('Reading');
await check('onSnapshot delivers docs newest first and refreshes on realtime changes', async () => {
  const c = fakeClient({ tracks: [ROW, { ...ROW, id: 'r2', code: 'BBB', created_at: '2000' }] });
  const { claude } = create(c);
  const db = await claude.use('db');
  const seen = [];
  const off = db.collection('tracks').orderBy('createdAt', 'desc').limit(500).onSnapshot((s) => seen.push(s.docs.map((d) => d.id)));
  await tick(); await tick();
  assert.deepEqual(seen[0], ['r2', 'r1']);
  const docs = await new Promise((res) => db.collection('tracks').onSnapshot((s) => res(s.docs)));
  assert.equal(docs[0].data().code, 'BBB');
  off();
});
await check('signed-out visitors can still read', async () => {
  const { claude } = create(fakeClient({ tracks: [ROW] }));
  const db = await claude.use('db');
  const n = await new Promise((res) => db.collection('tracks').onSnapshot((s) => res(s.size)));
  assert.equal(n, 1);
});

console.log('Writing');
await check('add inserts the row when signed in', async () => {
  const c = fakeClient({ user: 'u1' });
  const db = await create(c).claude.use('db');
  await db.collection('tracks').add({ name: 'N', code: 'C', version: '1', channel: 'dev', notes: '', createdAt: 9, authorId: 'spoof' });
  assert.equal(c.calls.inserted.length, 1);
  assert.equal(c.calls.inserted[0].created_at, 9);
});
await check('add is refused locally when signed out', async () => {
  const c = fakeClient({});
  const db = await create(c).claude.use('db');
  await assert.rejects(db.collection('tracks').add({ name: 'N', code: 'C', version: '1', channel: 'dev', createdAt: 1 }), { code: 'invalid_argument' });
  assert.equal(c.calls.inserted.length, 0);
});
await check('a database refusal comes back as a page-friendly error', async () => {
  const db = await create(fakeClient({ user: 'u1', failInsert: { code: '42501' } })).claude.use('db');
  await assert.rejects(db.collection('tracks').add({ name: 'N', code: 'C', version: '1', channel: 'dev', createdAt: 1 }), { code: 'invalid_argument' });
});
await check('doc().delete deletes by id', async () => {
  const c = fakeClient({ user: 'u1' });
  const db = await create(c).claude.use('db');
  await db.doc('tracks/abc').delete();
  assert.deepEqual(c.calls.deleted, ['abc']);
});

console.log('Users');
await check('signed-in user: id, can write, not admin', async () => {
  const u = await create(fakeClient({ user: 'u1' })).claude.use('user');
  assert.equal((await u.me()).id, 'u1');
  assert.equal(await u.can('data.write'), true);
  assert.equal(await u.canEdit(), false);
});
await check('admins can edit', async () => {
  const u = await create(fakeClient({ user: 'u1', admins: ['u1'] })).claude.use('user');
  assert.equal(await u.canEdit(), true);
});
await check('signed-out: no id, cannot write', async () => {
  const u = await create(fakeClient({})).claude.use('user');
  assert.equal((await u.me()).id, null);
  assert.equal(await u.can('data.write'), false);
});
await check('profiles resolves names, marks me, blanks unknown ids', async () => {
  const u = await create(fakeClient({ user: 'u1', profiles: { u1: 'Me', u2: 'Zed' } })).claude.use('user');
  const p = await u.profiles(['u1', 'u2', 'ghost']);
  assert.equal(p.u1.isMe, true); assert.equal(p.u2.name, 'Zed'); assert.equal(p.u2.isMe, false); assert.equal(p.ghost.name, '');
});
await check('signIn uses email and password', async () => {
  const c = fakeClient({});
  await create(c).auth.signIn('a@b.co', 'secret123');
  assert.deepEqual(c.calls.pw, { email: 'a@b.co', password: 'secret123' });
});
await check('signIn rejects with the backend message on bad credentials', async () => {
  await assert.rejects(create(fakeClient({})).auth.signIn('a@b.co', 'bad'), { message: 'Invalid login credentials' });
});
await check('signUp passes the display name as user metadata and reports a ready session', async () => {
  const c = fakeClient({});
  const r = await create(c).auth.signUp('a@b.co', 'secret123', 'Zed');
  assert.equal(c.calls.signup.options.data.name, 'Zed');
  assert.deepEqual(r, { needsConfirm: false });
});
await check('signUp reports when email confirmation is still required', async () => {
  assert.deepEqual(await create(fakeClient({})).auth.signUp('a@b.co', 'secret123', 'Pending'), { needsConfirm: true });
});
await check('signUp rejects duplicates', async () => {
  await assert.rejects(create(fakeClient({})).auth.signUp('a@b.co', 'dup', 'Zed'), { message: 'User already registered' });
});

console.log('Install');
await check('leaves the Claude runtime alone', () => {
  const w = { claude: { use() {} } };
  assert.equal(install(w), 'claude'); assert.equal(w.__auth, undefined);
});
await check('reports an unconfigured backend with a helpful message', () => {
  const w = { POLYTRACK_CONFIG: { supabaseUrl: 'YOUR-PROJECT-URL', supabaseAnonKey: 'YOUR-ANON-KEY' } };
  assert.equal(install(w), 'unconfigured'); assert.match(w.__backendError, /config\.js/);
});
await check('reports a missing library', () => {
  const w = { POLYTRACK_CONFIG: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' } };
  assert.equal(install(w), 'nolib');
});
await check('installs when configured and the library is present', () => {
  const w = { POLYTRACK_CONFIG: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }, supabase: { createClient: () => fakeClient({}) } };
  assert.equal(install(w), 'supabase'); assert.ok(w.claude.use); assert.ok(w.__auth.signIn);
});

console.log(process.exitCode ? '\nSome checks failed.' : `\nAll ${passed} adapter checks passed.`);
