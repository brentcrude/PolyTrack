/* Test shim: stands in for the claude.ai runtime (window.claude) so index.html can run
 * outside Claude. Implements just the surface the page uses: db (collection/doc/add/set/
 * delete/orderBy/limit/onSnapshot) and user (me/canEdit/can/profiles). Documents live in
 * memory; options come from window.__MOCK__ (set by the test before load). */
(function () {
  var opts = window.__MOCK__ || {};
  var docs = {};            // path -> body
  var listeners = [];       // {col, fn}
  var seq = 0;

  (opts.seed || []).forEach(function (d, i) { docs['tracks/seed' + i] = d; });

  function snapDoc(path) {
    return { id: path.split('/').pop(), exists: true, data: function () { return docs[path]; }, metadata: {} };
  }
  function colDocs(col) {
    return Object.keys(docs).filter(function (p) { return p.indexOf(col + '/') === 0 && p.split('/').length === 2; });
  }
  function emit() {
    listeners.forEach(function (l) {
      var paths = colDocs(l.col).sort(function (a, b) { return (docs[b].createdAt || 0) - (docs[a].createdAt || 0); });
      l.fn({ docs: paths.map(snapDoc), size: paths.length, empty: !paths.length, docChanges: function () { return []; }, metadata: {} });
    });
  }

  var db = {
    collection: function (col) {
      var q = {
        orderBy: function () { return q; },
        limit: function () { return q; },
        onSnapshot: function (fn) {
          var l = { col: col, fn: fn };
          listeners.push(l);
          setTimeout(emit, 0);
          return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
        },
        add: function (data) {
          if (opts.rejectWrites) return Promise.reject({ code: 'invalid_argument', message: 'denied' });
          var path = col + '/n' + (++seq);
          docs[path] = JSON.parse(JSON.stringify(data));
          setTimeout(emit, 0);
          return Promise.resolve({ id: path });
        },
        doc: function (id) { return db.doc(col + '/' + id); }
      };
      return q;
    },
    doc: function (path) {
      return {
        delete: function () { delete docs[path]; setTimeout(emit, 0); return Promise.resolve(); }
      };
    }
  };

  var me = opts.me === undefined ? 'u_me' : opts.me;
  var names = Object.assign({ u_me: 'Test Driver', u_other: 'Another Driver' }, opts.names || {});
  var user = {
    me: function () { return Promise.resolve({ id: me, name: names[me] || '', isOwner: false, canEdit: !!opts.canEdit }); },
    canEdit: function () { return Promise.resolve(!!opts.canEdit); },
    can: function () { return Promise.resolve(opts.canWrite === undefined ? true : opts.canWrite); },
    profiles: function (ids) {
      var out = {};
      [].concat(ids).forEach(function (id) { out[id] = { id: id, name: names[id] || '', isMe: id === me }; });
      return Promise.resolve(out);
    }
  };

  window.claude = {
    use: function (name) {
      if (name === 'db') return Promise.resolve(opts.noDb ? null : db);
      if (name === 'user') return Promise.resolve(user);
      return Promise.resolve(null);
    }
  };

  // Optional sign-in stub (what adapter.js provides on the Supabase build).
  if (opts.auth) {
    window.__authCalls = [];
    window.__auth = {
      user: function () { return Promise.resolve(opts.auth.user || null); },
      signIn: function (email, pass) {
        window.__authCalls.push({ mode: 'in', email: email, pass: pass });
        return opts.auth.fail ? Promise.reject({ message: 'Invalid login credentials' }) : Promise.resolve();
      },
      signUp: function (email, pass, name) {
        window.__authCalls.push({ mode: 'up', email: email, pass: pass, name: name });
        return Promise.resolve({ needsConfirm: !!opts.auth.needsConfirm });
      },
      reload: function () { window.__authCalls.push('reload'); },
      signOut: function () { window.__authCalls.push('out'); return Promise.resolve(); }
    };
  }

  // Clipboard stub so copy can be asserted in headless Chromium.
  window.__copied = null;
  try {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } },
      configurable: true
    });
  } catch (e) { /* ignore */ }
})();
