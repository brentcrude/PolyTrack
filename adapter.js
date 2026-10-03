/* Supabase adapter: gives the page the same small `window.claude` surface it was written
 * against (db.collection/doc, user.me/canEdit/can/profiles), backed by Supabase instead of
 * the Claude artifact runtime. index.html never knows the difference.
 *
 * Browser:  PolytrackAdapter.install(window)   (no-op when window.claude already exists)
 * Node:     const { create } = require('./adapter.js')   (used by tests/adapter.mjs)
 *
 * Table/column names are snake_case in Postgres and camelCase in the page; toDoc/toRow map them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolytrackAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toDoc(r) {
    return { name: r.name, code: r.code, version: r.version, channel: r.channel,
      notes: r.notes || '', authorId: r.author_id || '', createdAt: Number(r.created_at) || 0 };
  }
  function toRow(d) {
    return { name: d.name, code: d.code, version: d.version, channel: d.channel,
      notes: d.notes || '', created_at: d.createdAt };
  }
  // Map Postgres/PostgREST errors onto the codes the page already understands.
  function mapError(e) {
    var c = e && e.code;
    if (c === '42501') return { code: 'invalid_argument', message: 'not allowed' };
    if (c === '23505') return { code: 'already_exists', message: 'duplicate' };
    if (c === '23514') return { code: 'invalid_argument', message: 'rejected by validation' };
    return { code: 'unknown', message: (e && e.message) || 'request failed' };
  }

  function create(client) {
    var session = null;
    var adminCache = null;

    var ready = client.auth.getSession().then(function (r) {
      session = (r && r.data && r.data.session) || null;
    }, function () { session = null; });

    client.auth.onAuthStateChange(function (_evt, s) { session = s || null; adminCache = null; });

    function uid() { return session && session.user ? session.user.id : null; }

    function snapshotOf(rows) {
      var docs = rows.map(function (r) {
        return { id: r.id, exists: true, data: function () { return toDoc(r); }, metadata: {} };
      });
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: {} };
    }

    var db = {
      collection: function (name) {
        if (name !== 'tracks') throw new Error('unknown collection ' + name);
        var lim = 500;
        var q = {
          orderBy: function () { return q; },            // always newest first; the page re-sorts
          limit: function (n) { lim = n; return q; },
          onSnapshot: function (ok, fail) {
            var alive = true, chan = null;
            function load() {
              client.from('tracks').select('*').order('created_at', { ascending: false }).limit(lim)
                .then(function (r) {
                  if (!alive) return;
                  if (r.error) return fail && fail(mapError(r.error));
                  ok(snapshotOf(r.data || []));
                }, function (e) { if (alive && fail) fail(mapError(e)); });
            }
            load();
            try {
              chan = client.channel('tracks-feed')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, load)
                .subscribe();
            } catch (e) { /* realtime is a nicety; the list still loads */ }
            return function () { alive = false; if (chan) client.removeChannel(chan); };
          },
          add: function (d) {
            return ready.then(function () {
              if (!uid()) return Promise.reject({ code: 'invalid_argument', message: 'sign in first' });
              return client.from('tracks').insert(toRow(d));
            }).then(function (r) {
              if (r && r.error) return Promise.reject(mapError(r.error));
              return { id: null };
            });
          }
        };
        return q;
      },
      doc: function (path) {
        var id = String(path).split('/').pop();
        return {
          delete: function () {
            return client.from('tracks').delete().eq('id', id).then(function (r) {
              if (r.error) return Promise.reject(mapError(r.error));
            });
          }
        };
      }
    };

    function isAdmin() {
      if (adminCache) return adminCache;
      adminCache = ready.then(function () {
        if (!uid()) return false;
        return client.from('admins').select('user_id').eq('user_id', uid()).maybeSingle()
          .then(function (r) { return !!(r && r.data); }, function () { return false; });
      });
      return adminCache;
    }

    var user = {
      me: function () {
        return ready.then(isAdmin).then(function (admin) {
          return { id: uid(), name: '', isOwner: admin, canEdit: admin };
        });
      },
      canEdit: function () { return isAdmin(); },
      can: function () { return ready.then(function () { return !!uid(); }); },
      profiles: function (ids) {
        ids = [].concat(ids);
        return ready.then(function () {
          return client.from('profiles').select('id,name').in('id', ids);
        }).then(function (r) {
          var by = {};
          ((r && r.data) || []).forEach(function (p) { by[p.id] = p.name || ''; });
          var out = {};
          ids.forEach(function (id) { out[id] = { id: id, name: by[id] || '', isMe: id === uid() }; });
          return out;
        });
      }
    };

    var claude = {
      use: function (name) {
        if (name === 'db') return Promise.resolve(db);
        if (name === 'user') return Promise.resolve(user);
        return Promise.resolve(null);
      }
    };

    var auth = {
      ready: ready,
      user: function () { return ready.then(function () { return session ? session.user : null; }); },
      signIn: function (email, name) {
        return client.auth.signInWithOtp({
          email: email,
          options: { data: { name: name }, emailRedirectTo: (typeof location !== 'undefined' ? location.origin + location.pathname : undefined) }
        }).then(function (r) { if (r && r.error) return Promise.reject(r.error); });
      },
      signOut: function () { return client.auth.signOut(); }
    };

    return { claude: claude, auth: auth };
  }

  // Wire it into a browser window. Leaves an existing window.claude (the Claude runtime) alone.
  function install(win) {
    if (win.claude) return 'claude';
    var cfg = win.POLYTRACK_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || /YOUR[-_]/i.test(cfg.supabaseUrl + cfg.supabaseAnonKey)) {
      win.__backendError = 'This site is not connected to a backend yet. Fill in config.js (see SETUP.md).';
      return 'unconfigured';
    }
    if (!win.supabase || !win.supabase.createClient) {
      win.__backendError = 'Could not load the Supabase library. Check your connection and reload.';
      return 'nolib';
    }
    var made = create(win.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey));
    win.claude = made.claude;
    win.__auth = made.auth;
    return 'supabase';
  }

  return { create: create, install: install, toDoc: toDoc, toRow: toRow, mapError: mapError };
});
