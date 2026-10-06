/* Data layer for Polytrack Codes: everything the page knows about Supabase lives here.
 *
 * Browser:  PolytrackApi.install(window)   sets window.polytrack = { api, auth }
 *           (does nothing if window.polytrack already exists, which is how the tests inject a mock)
 * Node:     const { create } = require('./api.js')   (used by tests/api.mjs)
 *
 * The page works with camelCase objects; Postgres uses snake_case. trackOf/summaryOf/releaseOf/commentOf map. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolytrackApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var num = function (v) { return Number(v) || 0; };
  function trackOf(r) {
    return { id: r.id, name: r.name, description: r.description || '', authorId: r.author_id,
      createdAt: num(r.created_at), updatedAt: num(r.updated_at) };
  }
  function summaryOf(r) {
    var t = trackOf(r);
    t.releaseCount = num(r.release_count); t.commentCount = num(r.comment_count);
    t.latestStable = r.latest_stable || null; t.latestDev = r.latest_dev || null;
    t.gameVersions = r.game_versions || [];
    return t;
  }
  function releaseOf(r) {
    var o = { id: r.id, trackId: r.track_id, gameVersion: r.game_version, channel: r.channel === 'dev' ? 'dev' : 'stable',
      notes: r.notes || '', codeLength: num(r.code_length), authorId: r.author_id, createdAt: num(r.created_at) };
    if (typeof r.code === 'string') o.code = r.code;
    return o;
  }
  function commentOf(r) {
    return { id: r.id, trackId: r.track_id, releaseId: r.release_id || null, authorId: r.author_id,
      body: r.body, createdAt: num(r.created_at) };
  }

  // Postgres / PostgREST errors -> the few codes the page handles.
  function mapError(e) {
    var c = e && e.code;
    if (c === '42501') return { code: 'forbidden', message: 'not allowed' };
    if (c === '23505') return { code: 'duplicate', message: 'duplicate' };
    // 22P02 = "not a valid uuid", which just means a link to something that cannot exist.
    if (c === '23514' || c === '22001' || c === '22P02') return { code: 'invalid', message: 'rejected by validation' };
    if (c === '23503') return { code: 'not_found', message: 'not found' };
    return { code: 'unknown', message: (e && e.message) || 'request failed' };
  }

  var RELEASE_LIST_COLS = 'id,track_id,game_version,channel,notes,code_length,author_id,created_at';
  var TRACK_COLS = 'id,name,description,author_id,created_at,updated_at';

  function create(client) {
    var session = null, adminCache = null;
    var ready = client.auth.getSession().then(function (r) {
      session = (r && r.data && r.data.session) || null;
    }, function () { session = null; });
    client.auth.onAuthStateChange(function (_evt, s) { session = s || null; adminCache = null; });
    var uid = function () { return session && session.user ? session.user.id : null; };

    // Resolve with data, or reject with a mapped error.
    function run(q) {
      return Promise.resolve(q).then(function (r) {
        if (r && r.error) return Promise.reject(mapError(r.error));
        return r ? r.data : null;
      }, function (e) { return Promise.reject(mapError(e)); });
    }
    function signedIn() {
      return ready.then(function () {
        if (!uid()) return Promise.reject({ code: 'forbidden', message: 'sign in first' });
      });
    }
    // A malformed id (not a uuid) just means "no such thing".
    function orMissing(p) {
      return p.then(null, function (e) { return e && e.code === 'invalid' ? null : Promise.reject(e); });
    }
    function isAdmin() {
      if (adminCache) return adminCache;
      adminCache = ready.then(function () {
        if (!uid()) return false;
        return client.from('admins').select('user_id').eq('user_id', uid()).maybeSingle()
          .then(function (r) { return !!(r && r.data); }, function () { return false; });
      });
      return adminCache;
    }

    var api = {
      me: function () { return ready.then(isAdmin).then(function (a) { return { id: uid(), isAdmin: a }; }); },

      listTracks: function () {
        return run(client.from('track_summaries').select('*').order('updated_at', { ascending: false }).limit(500))
          .then(function (rows) { return (rows || []).map(summaryOf); });
      },
      getTrack: function (id) {
        return orMissing(run(client.from('tracks').select(TRACK_COLS).eq('id', id).maybeSingle()))
          .then(function (r) { return r ? trackOf(r) : null; });
      },
      createTrack: function (v) {
        return signedIn().then(function () {
          return run(client.from('tracks').insert({ name: v.name, description: v.description || '' }).select('id').single());
        }).then(function (r) { return { id: r.id }; });
      },
      updateTrack: function (id, v) {
        return signedIn().then(function () {
          return run(client.from('tracks').update({ name: v.name, description: v.description || '' }).eq('id', id));
        }).then(function () {});
      },
      deleteTrack: function (id) { return run(client.from('tracks').delete().eq('id', id)).then(function () {}); },

      listReleases: function (trackId) {
        return orMissing(run(client.from('track_releases').select(RELEASE_LIST_COLS)
          .eq('track_id', trackId).order('created_at', { ascending: false })))
          .then(function (rows) { return (rows || []).map(releaseOf); });
      },
      getRelease: function (id) {
        return orMissing(run(client.from('track_releases').select('*').eq('id', id).maybeSingle()))
          .then(function (r) { return r ? releaseOf(r) : null; });
      },
      addRelease: function (trackId, v) {
        return signedIn().then(function () {
          return run(client.from('track_releases').insert({
            track_id: trackId, game_version: v.gameVersion, channel: v.channel, code: v.code, notes: v.notes || ''
          }).select('id').single());
        }).then(function (r) { return { id: r.id }; });
      },
      deleteRelease: function (id) { return run(client.from('track_releases').delete().eq('id', id)).then(function () {}); },

      listComments: function (trackId) {
        return orMissing(run(client.from('comments').select('*').eq('track_id', trackId).order('created_at', { ascending: true })))
          .then(function (rows) { return (rows || []).map(commentOf); });
      },
      addComment: function (trackId, v) {
        return signedIn().then(function () {
          return run(client.from('comments').insert({ track_id: trackId, release_id: v.releaseId || null, body: v.body }).select('id').single());
        }).then(function (r) { return { id: r.id }; });
      },
      deleteComment: function (id) { return run(client.from('comments').delete().eq('id', id)).then(function () {}); },

      profiles: function (ids) {
        ids = [].concat(ids);
        return ready.then(function () {
          return run(client.from('profiles').select('id,name').in('id', ids));
        }).then(function (rows) {
          var by = {}, out = {};
          (rows || []).forEach(function (p) { by[p.id] = p.name || ''; });
          ids.forEach(function (id) { out[id] = { id: id, name: by[id] || '', isMe: id === uid() }; });
          return out;
        });
      },

      // Calls fn whenever any track, release or comment changes. Returns an unsubscribe function.
      subscribe: function (fn) {
        var chan = null;
        try {
          chan = client.channel('polytrack-feed');
          ['tracks', 'track_releases', 'comments'].forEach(function (t) {
            chan = chan.on('postgres_changes', { event: '*', schema: 'public', table: t }, fn);
          });
          chan.subscribe();
        } catch (e) { /* live updates are a nicety; the page still works without them */ }
        return function () { if (chan) client.removeChannel(chan); };
      }
    };

    var auth = {
      user: function () { return ready.then(function () { return session ? session.user : null; }); },
      signIn: function (email, password) {
        return client.auth.signInWithPassword({ email: email, password: password })
          .then(function (r) { if (r && r.error) return Promise.reject(r.error); });
      },
      // Resolves { needsConfirm: true } when the project still requires email confirmation (no session yet).
      signUp: function (email, password, name) {
        return client.auth.signUp({ email: email, password: password, options: { data: { name: name } } })
          .then(function (r) {
            if (r && r.error) return Promise.reject(r.error);
            return { needsConfirm: !(r && r.data && r.data.session) };
          });
      },
      signOut: function () { return client.auth.signOut(); }
    };

    return { api: api, auth: auth };
  }

  function install(win) {
    if (win.polytrack) return 'existing';
    var cfg = win.POLYTRACK_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || /YOUR[-_]/i.test(cfg.supabaseUrl + cfg.supabaseAnonKey)) {
      win.__backendError = 'This site is not connected to a backend yet. Fill in config.js (see SETUP.md).';
      return 'unconfigured';
    }
    if (!win.supabase || !win.supabase.createClient) {
      win.__backendError = 'Could not load the Supabase library. Check your connection and reload.';
      return 'nolib';
    }
    win.polytrack = create(win.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey));
    return 'supabase';
  }

  return { create: create, install: install, mapError: mapError,
    trackOf: trackOf, summaryOf: summaryOf, releaseOf: releaseOf, commentOf: commentOf };
});
