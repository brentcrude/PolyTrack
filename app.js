/* Polytrack Codes: pages and behaviour.
 * All data access goes through window.polytrack (see api.js); nothing here knows about Supabase.
 *
 * Routes (hash based, so it works on any static host and links are shareable):
 *   #/                       all tracks
 *   #/new                    create a track with its first release
 *   #/t/<id>                 a track (defaults to its newest stable release)
 *   #/t/<id>/r/<releaseId>   a track, showing one specific release
 */
(function () {
  'use strict';

  const MAX = { name: 60, desc: 500, notes: 1000, ver: 24, comment: 2000, code: 200000 };
  const VER_RE = /^[A-Za-z0-9][A-Za-z0-9._+\- ]{0,23}$/;
  const $ = (id) => document.getElementById(id);

  const S = {
    api: null, auth: null, me: { id: null, isAdmin: false },
    view: null, nav: 0, firstRoute: true,
    home: { tracks: [], loaded: false, channel: 'all', version: 'all', q: '', sort: 'updated' },
    track: null, refresh: null,
    pending: null, pendingTimer: null, feedTimer: null, toastTimer: null
  };

  /* ---------- helpers ---------- */
  function h(tag, props) {
    const el = document.createElement(tag);
    const p = props || {};
    Object.keys(p).forEach((k) => {
      const v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return el;
  }

  function naturalCompare(a, b) {
    const pa = String(a).toLowerCase().split(/(\d+)/), pb = String(b).toLowerCase().split(/(\d+)/);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] === undefined ? '' : pa[i], y = pb[i] === undefined ? '' : pb[i];
      if (x === y) continue;
      if (/^\d+$/.test(x) && /^\d+$/.test(y)) return parseInt(x, 10) - parseInt(y, 10);
      return x < y ? -1 : 1;
    }
    return 0;
  }

  const channelLabel = (c) => (c === 'dev' ? 'Dev release' : 'Stable');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const relLabel = (r) => 'v' + r.gameVersion + ' ' + channelLabel(r.channel);

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function setBanner(msg) {
    const b = $('banner');
    b.textContent = msg || '';
    b.hidden = !msg;
  }

  function legacyCopy(text) {
    const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function copyCode(text, btn) {
    const done = (ok) => {
      toast(ok ? 'Code copied' : 'Copy failed. Open the code and select it.');
      if (ok && btn) {
        const old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = old; }, 1500);
      }
    };
    try {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(legacyCopy(text)));
    } catch (e) {
      done(legacyCopy(text));
    }
  }

  function store(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* storage may be blocked */ } }
  function recall(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

  // Fill every [data-author] under root with the author's display name.
  function fillNames(root, ids) {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length || !S.api) return;
    S.api.profiles(uniq).then((ps) => {
      root.querySelectorAll('[data-author]').forEach((n) => {
        const p = ps[n.getAttribute('data-author')];
        n.textContent = p && p.isMe ? 'you' : (p && p.name) || 'Someone';
      });
    }, () => { /* names stay as placeholders */ });
  }
  const authorSpan = (id) => h('span', { 'data-author': id || '', text: id ? '…' : 'Someone' });

  // Two-tap delete: the first tap arms the button, the second (within 4 s) confirms.
  function deleteButton(key, label, rerender, onConfirm) {
    const armed = S.pending === key;
    const b = h('button', {
      class: 'btn small danger' + (armed ? ' confirm' : ''), type: 'button',
      text: armed ? 'Confirm delete' : 'Delete', 'aria-label': (armed ? 'Confirm delete ' : 'Delete ') + label
    });
    b.addEventListener('click', () => {
      if (S.pending !== key) {
        S.pending = key;
        rerender();
        clearTimeout(S.pendingTimer);
        S.pendingTimer = setTimeout(() => { if (S.pending === key) { S.pending = null; rerender(); } }, 4000);
        return;
      }
      S.pending = null;
      b.disabled = true;
      onConfirm();
    });
    return b;
  }

  function emptyCard(title, text, action) {
    return h('div', { class: 'empty' }, h('h3', { text: title }), h('p', { text }), action || null);
  }

  /* ---------- forms ---------- */
  function field(label, control) {
    const extra = [].slice.call(arguments, 2);
    return h('div', { class: 'field' }, h('label', { for: control.id, text: label }), control, extra);
  }

  function setErr(p, input, msg) {
    p.textContent = msg || '';
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function channelSeg(name) {
    return h('fieldset', {},
      h('legend', { class: 'lab', text: 'Release channel' }),
      h('div', { class: 'seg' },
        h('label', {}, h('input', { type: 'radio', name, value: 'stable', checked: true }), h('span', { class: 's-stable', text: 'Stable' })),
        h('label', {}, h('input', { type: 'radio', name, value: 'dev' }), h('span', { class: 's-dev', text: 'Dev release' }))
      ),
      h('p', { class: 'hint', text: 'Choose Dev when the code was built on a pre-release game version.' })
    );
  }

  // The version / channel / code / notes fields shared by "new track" and "add a release".
  function releaseFields(idp, known) {
    const version = h('input', { type: 'text', id: idp + '-version', maxlength: MAX.ver, autocomplete: 'off', list: idp + '-versions', placeholder: 'e.g. 0.6.0 or a dev build label' });
    const datalist = h('datalist', { id: idp + '-versions' });
    const eVersion = h('p', { class: 'err', role: 'alert' });
    const code = h('textarea', { id: idp + '-code', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', placeholder: 'Paste the code exported from the game' });
    const eCode = h('p', { class: 'err', role: 'alert' });
    const count = h('p', { class: 'count', text: '0 characters' });
    const notes = h('textarea', { id: idp + '-notes', class: 'short', maxlength: MAX.notes, placeholder: 'What is in this release? (optional)' });
    const seg = channelSeg(idp + '-channel');
    const radios = () => seg.querySelectorAll('input[type="radio"]');

    const setKnown = (list) => { datalist.textContent = ''; list.forEach((v) => datalist.append(h('option', { value: v }))); };
    setKnown(known || []);

    const lastVersion = recall('pt-version');
    if (lastVersion) version.value = lastVersion;
    if (recall('pt-channel') === 'dev') seg.querySelector('input[value="dev"]').checked = true;

    code.addEventListener('input', () => {
      const n = code.value.trim().length;
      count.textContent = n.toLocaleString() + ' character' + (n === 1 ? '' : 's');
    });

    const el = h('div', {},
      field('Game version', version, datalist, h('p', { class: 'hint', text: 'Use the version number the game shows.' }), eVersion),
      seg,
      field('Track code', code, eCode, count),
      field('Release notes (optional)', notes)
    );

    return {
      el, setKnown,
      read() {
        return { gameVersion: version.value.trim(), channel: seg.querySelector('input:checked').value, code: code.value.trim(), notes: notes.value.trim() };
      },
      validate() {
        const v = this.read();
        let ok = true;
        if (!v.gameVersion) { setErr(eVersion, version, 'Enter the game version.'); ok = false; }
        else if (!VER_RE.test(v.gameVersion)) { setErr(eVersion, version, 'Use letters, numbers, dots, dashes or plus signs, up to ' + MAX.ver + ' characters.'); ok = false; }
        else setErr(eVersion, version, '');
        if (!v.code) { setErr(eCode, code, 'Paste the track code.'); ok = false; }
        else if (v.code.length > MAX.code) { setErr(eCode, code, 'This code is over ' + MAX.code.toLocaleString() + ' characters, which is too long to store.'); ok = false; }
        else setErr(eCode, code, '');
        return ok;
      },
      codeError(msg) { setErr(eCode, code, msg); },
      remember() { const v = this.read(); store('pt-version', v.gameVersion); store('pt-channel', v.channel); },
      reset() {
        code.value = ''; notes.value = ''; count.textContent = '0 characters';
        setErr(eVersion, version, ''); setErr(eCode, code, '');
      },
      focus() { version.focus(); },
      disable(b) { [version, code, notes].forEach((x) => { x.disabled = b; }); radios().forEach((r) => { r.disabled = b; }); }
    };
  }

  function releaseErrorMessage(e) {
    const c = e && e.code;
    if (c === 'duplicate') return 'This track already has a release with this exact code.';
    if (c === 'forbidden') return 'Only the track’s owner can publish releases. Sign in with the owner’s account.';
    if (c === 'invalid') return 'The server rejected this release. Check the version, code and notes lengths.';
    if (c === 'not_found') return 'This track no longer exists.';
    return 'Could not publish the release. Try again in a moment.';
  }

  /* ---------- home ---------- */
  function homeVersions() {
    const seen = {};
    S.home.tracks.forEach((t) => t.gameVersions.forEach((v) => { seen[v] = true; }));
    return Object.keys(seen).sort((a, b) => naturalCompare(b, a));
  }

  function visibleTracks() {
    const H = S.home, q = H.q.trim().toLowerCase();
    const out = H.tracks.filter((t) => {
      if (H.channel === 'stable' && !t.latestStable) return false;
      if (H.channel === 'dev' && !t.latestDev) return false;
      if (H.version !== 'all' && t.gameVersions.indexOf(H.version) === -1) return false;
      if (q && (t.name + ' ' + t.description).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    out.sort((a, b) => {
      if (H.sort === 'created') return b.createdAt - a.createdAt;
      if (H.sort === 'name') return a.name.localeCompare(b.name);
      if (H.sort === 'releases') return b.releaseCount - a.releaseCount || b.updatedAt - a.updatedAt;
      return b.updatedAt - a.updatedAt;
    });
    return out;
  }

  function trackCard(t) {
    const tags = h('div', { class: 'tags' });
    if (t.latestStable) tags.append(h('span', { class: 'pill stable', text: 'Stable v' + t.latestStable }));
    if (t.latestDev) tags.append(h('span', { class: 'pill dev', text: 'Dev v' + t.latestDev }));
    if (!t.latestStable && !t.latestDev) tags.append(h('span', { class: 'pill plain', text: 'No releases yet' }));
    return h('li', { class: 'tcard' },
      h('h3', {}, h('a', { href: '#/t/' + encodeURIComponent(t.id), text: t.name })),
      t.description ? h('p', { class: 'desc', text: t.description }) : h('p', { class: 'desc none', text: 'No description.' }),
      tags,
      h('div', { class: 'meta' }, 'by ', authorSpan(t.authorId), ' · ' + plural(t.releaseCount, 'release') + ' · ' + plural(t.commentCount, 'comment') + ' · updated ' + fmtDate(t.updatedAt))
    );
  }

  function showHome() {
    const H = S.home, v = S.view;
    const title = h('h2', { class: 'page-title', text: 'Tracks' });
    const stats = h('p', { class: 'stats', id: 'h-stats' });
    const list = h('ul', { class: 'tracks', id: 'tracks' });
    const labels = { all: 'All', stable: 'Stable', dev: 'Dev' };
    const chips = ['all', 'stable', 'dev'].map((c) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-home-chan': c, 'aria-pressed': String(H.channel === c), text: labels[c] });
      b.addEventListener('click', () => { H.channel = c; syncChips(); renderTracks(); });
      return b;
    });
    const syncChips = () => chips.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-home-chan') === H.channel)));

    const q = h('input', { type: 'search', id: 'h-q', placeholder: 'Search track names and descriptions', 'aria-label': 'Search tracks' });
    q.value = H.q;
    q.addEventListener('input', () => { H.q = q.value; renderTracks(); });
    const vsel = h('select', { id: 'h-version', 'aria-label': 'Filter by game version' });
    vsel.addEventListener('change', () => { H.version = vsel.value; renderTracks(); });
    const sort = h('select', { id: 'h-sort', 'aria-label': 'Sort order' },
      h('option', { value: 'updated', text: 'Recently updated' }),
      h('option', { value: 'created', text: 'Newest tracks' }),
      h('option', { value: 'name', text: 'Name A to Z' }),
      h('option', { value: 'releases', text: 'Most releases' }));
    sort.value = H.sort;
    sort.addEventListener('change', () => { H.sort = sort.value; renderTracks(); });

    function renderVersionSelect() {
      const vs = homeVersions();
      if (H.version !== 'all' && vs.indexOf(H.version) === -1) H.version = 'all';
      vsel.textContent = '';
      vsel.append(h('option', { value: 'all', text: 'All game versions' }));
      vs.forEach((x) => vsel.append(h('option', { value: x, text: 'v' + x })));
      vsel.value = H.version;
    }

    function clearFilters() {
      H.channel = 'all'; H.version = 'all'; H.q = ''; H.sort = 'updated';
      q.value = ''; sort.value = 'updated';
      syncChips(); renderVersionSelect(); renderTracks();
    }

    function renderTracks() {
      list.textContent = '';
      const t = H.tracks;
      stats.textContent = H.loaded
        ? plural(t.length, 'track') + ' · ' + plural(t.reduce((n, x) => n + x.releaseCount, 0), 'release') + ' · ' +
          t.filter((x) => x.latestStable).length + ' with a stable release · ' + t.filter((x) => x.latestDev).length + ' with a dev release'
        : '';
      if (!H.loaded) { list.append(h('li', { class: 'empty' }, h('h3', { text: 'Loading tracks' }), h('p', { text: 'Fetching the latest list.' }))); return; }
      if (!t.length) {
        list.append(h('li', {}, emptyCard('No tracks yet', 'Create a track, publish a release for the game version it was built on, and it appears here for everyone.',
          h('a', { class: 'btn ghost small', href: '#/new', text: 'Create the first track' }))));
        return;
      }
      const rows = visibleTracks();
      if (!rows.length) {
        const b = h('button', { class: 'btn ghost small', type: 'button', text: 'Clear filters' });
        b.addEventListener('click', clearFilters);
        list.append(h('li', {}, emptyCard('Nothing matches', 'No track fits these filters.', b)));
        return;
      }
      rows.forEach((x) => list.append(trackCard(x)));
      fillNames(list, rows.map((x) => x.authorId));
    }

    v.append(
      h('div', { class: 'head-row' }, title, h('a', { class: 'btn small', href: '#/new', text: 'New track' })),
      stats,
      h('div', { class: 'tools' }, h('div', { class: 'chan', role: 'group', 'aria-label': 'Release channel filter' }, chips), q, vsel, sort),
      list
    );
    renderVersionSelect();

    async function load() {
      const token = S.nav;
      try {
        const rows = await S.api.listTracks();
        if (token !== S.nav) return;
        H.tracks = rows; H.loaded = true; setBanner('');
      } catch (e) {
        if (token !== S.nav) return;
        H.loaded = true;
        setBanner('Could not load the tracks. Reload to try again.');
      }
      renderVersionSelect();
      renderTracks();
    }
    S.refresh = load;
    renderTracks();
    load();
    focusHeading(title);
  }

  /* ---------- new track ---------- */
  function showNew() {
    const v = S.view;
    const title = h('h2', { class: 'page-title', text: 'New track' });
    v.append(h('a', { class: 'crumb', href: '#/', text: '← All tracks' }), h('div', { class: 'head-row' }, title));
    focusHeading(title);
    if (!S.me.id) {
      v.append(emptyCard('Sign in to create a track', 'Create an account or sign in with the box at the top of the page. Browsing and copying never need one.'));
      return;
    }

    const name = h('input', { type: 'text', id: 'n-name', maxlength: MAX.name, autocomplete: 'off', placeholder: 'Name your track' });
    const eName = h('p', { class: 'err', role: 'alert' });
    const desc = h('textarea', { id: 'n-desc', class: 'short', maxlength: MAX.desc, placeholder: 'What is this track like? Length, difficulty, theme (optional)' });
    const rel = releaseFields('n', []);
    const submit = h('button', { class: 'btn', type: 'submit', id: 'n-submit', text: 'Create track' });
    const form = h('form', { class: 'form', novalidate: true },
      field('Track name', name, eName),
      field('Description', desc),
      h('h3', { class: 'form-title', text: 'First release' }),
      rel.el,
      h('div', { class: 'submit-row' }, submit)
    );
    v.append(form);

    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const nm = name.value.trim();
      let ok = true;
      if (!nm) { setErr(eName, name, 'Give the track a name.'); ok = false; } else setErr(eName, name, '');
      if (!rel.validate()) ok = false;
      if (!ok) return;
      busy = true; submit.disabled = true; submit.textContent = 'Creating…';
      let created = null;
      try {
        created = await S.api.createTrack({ name: nm.slice(0, MAX.name), description: desc.value.trim().slice(0, MAX.desc) });
        await S.api.addRelease(created.id, rel.read());
        rel.remember();
        toast('Track created');
        location.hash = '#/t/' + encodeURIComponent(created.id);
      } catch (err) {
        if (created) {
          toast('Track created, but the first release failed. Add it from the track page.');
          location.hash = '#/t/' + encodeURIComponent(created.id);
        } else if (err && err.code === 'forbidden') {
          setErr(eName, name, 'You need to be signed in to create a track.');
        } else {
          setErr(eName, name, 'Could not create the track. Try again in a moment.');
        }
      }
      busy = false; submit.disabled = false; submit.textContent = 'Create track';
    });
  }

  /* ---------- track page ---------- */
  function showMissing(title, text) {
    S.view.textContent = '';
    const hd = h('h2', { class: 'page-title', text: title });
    S.view.append(h('a', { class: 'crumb', href: '#/', text: '← All tracks' }), h('div', { class: 'head-row' }, hd), emptyCard(title, text));
    focusHeading(hd);
  }

  async function showTrack(rt, token) {
    const v = S.view;
    v.append(h('p', { class: 'loading', text: 'Loading track…' }));
    let track;
    try {
      track = await S.api.getTrack(rt.id);
    } catch (e) {
      if (token !== S.nav) return;
      v.textContent = '';
      setBanner('Could not load this track. Reload to try again.');
      return;
    }
    if (token !== S.nav) return;
    v.textContent = '';
    if (!track) { showMissing('Track not found', 'It may have been deleted, or the link is wrong.'); return; }
    buildTrack(track, rt, token);
  }

  function buildTrack(track, rt, token) {
    const root = h('div', { class: 'track-page' });
    const T = S.track = {
      id: track.id, root, track, releases: [], comments: [], loaded: false,
      selectedId: null, wanted: rt.rid, wantedMissing: false, chan: 'all',
      code: {}, loadingCode: null, expanded: false
    };
    const isOwner = () => !!S.me.id && T.track.authorId === S.me.id;
    const canManage = () => isOwner() || S.me.isAdmin;
    const alive = () => token === S.nav && S.track === T;
    const relById = (id) => T.releases.find((r) => r.id === id) || null;

    const head = h('section', { class: 'thead', 'aria-label': 'Track' });
    const editBox = h('div', { class: 'panel-box', hidden: true });
    const addBox = h('div', { class: 'panel-box', hidden: true });
    const relBar = h('div', { class: 'rel-bar' });
    const panel = h('div', { class: 'rel-panel', id: 'rel-panel' });
    const history = h('ul', { class: 'history', id: 'history' });
    const historyTitle = h('h3', { class: 'section-title' });
    const commentsTitle = h('h3', { class: 'section-title' });
    const commentList = h('ul', { class: 'comments', id: 'comments' });
    const commentBox = h('div', {});

    root.append(
      h('a', { class: 'crumb', href: '#/', text: '← All tracks' }),
      head, editBox, addBox,
      h('h3', { class: 'section-title', text: 'Release' }), relBar, panel,
      historyTitle, history,
      commentsTitle, commentList, commentBox
    );
    S.view.append(root);

    /* -- selection -- */
    const defaultFor = (chan) => {
      const list = T.releases.filter((r) => chan === 'all' || r.channel === chan);
      return (list.find((r) => r.channel === 'stable') || list[0] || {}).id || null;
    };
    function chooseSelection() {
      if (T.selectedId && relById(T.selectedId)) return;
      T.wantedMissing = false;
      if (T.wanted) {
        const w = relById(T.wanted);
        if (w) {
          if (T.chan !== 'all' && w.channel !== T.chan) T.chan = 'all'; // a linked release is never hidden by the filter
          T.selectedId = w.id;
          return;
        }
        T.wantedMissing = true;
      }
      T.selectedId = defaultFor(T.chan);
    }
    function select(id, replaceUrl) {
      T.selectedId = id; T.wanted = id; T.wantedMissing = false; T.expanded = false;
      if (replaceUrl && id) { try { window.history.replaceState(null, '', '#/t/' + encodeURIComponent(T.id) + '/r/' + encodeURIComponent(id)); } catch (e) { /* ignore */ } }
      renderBar(); renderPanel(); renderHistory(); syncCommentSelect(true);
    }
    T.onRoute = (rid) => {
      if (rid && relById(rid)) { select(rid, false); return; }
      T.wanted = rid;
      T.selectedId = null; chooseSelection();
      renderBar(); renderPanel(); renderHistory(); syncCommentSelect(true);
    };

    /* -- header -- */
    function renderHead() {
      head.textContent = '';
      const t = T.track;
      document.title = t.name + ' · Polytrack Codes';
      const title = h('h2', { class: 'page-title', id: 't-name', text: t.name });
      head.append(title);
      head.append(t.description ? h('p', { class: 'desc', id: 't-desc', text: t.description }) : h('p', { class: 'desc none', id: 't-desc', text: 'No description.' }));
      head.append(h('div', { class: 'meta' }, 'by ', authorSpan(t.authorId), ' · created ' + fmtDate(t.createdAt) + ' · updated ' + fmtDate(t.updatedAt)));
      const actions = h('div', { class: 'actions' });
      if (isOwner()) {
        const edit = h('button', { class: 'btn small plain', type: 'button', id: 'edit-btn', text: 'Edit track', 'aria-expanded': String(!editBox.hidden) });
        edit.addEventListener('click', () => { editBox.hidden ? openEdit() : (editBox.hidden = true, renderHead()); });
        const add = h('button', { class: 'btn small', type: 'button', id: 'add-btn', text: 'Add a release', 'aria-expanded': String(!addBox.hidden) });
        add.addEventListener('click', () => { addBox.hidden = !addBox.hidden; renderHead(); if (!addBox.hidden && T.addForm) T.addForm.focus(); });
        actions.append(add, edit);
      }
      if (canManage()) {
        actions.append(deleteButton('track:' + T.id, 'track', renderHead, async () => {
          try { await S.api.deleteTrack(T.id); toast('Track deleted'); location.hash = '#/'; }
          catch (e) { toast('Could not delete that track.'); renderHead(); }
        }));
      }
      if (actions.children.length) head.append(actions);
      fillNames(head, [t.authorId]);
    }

    function openEdit() {
      editBox.hidden = false;
      editBox.textContent = '';
      const name = h('input', { type: 'text', id: 'e-name', maxlength: MAX.name, autocomplete: 'off' });
      name.value = T.track.name;
      const eName = h('p', { class: 'err', role: 'alert' });
      const desc = h('textarea', { id: 'e-desc', class: 'short', maxlength: MAX.desc });
      desc.value = T.track.description;
      const save = h('button', { class: 'btn', type: 'submit', text: 'Save changes' });
      const cancel = h('button', { class: 'btn plain', type: 'button', text: 'Cancel' });
      cancel.addEventListener('click', () => { editBox.hidden = true; renderHead(); });
      const form = h('form', { class: 'form', novalidate: true },
        h('h3', { class: 'form-title', text: 'Edit track' }),
        field('Track name', name, eName), field('Description', desc),
        h('div', { class: 'submit-row' }, save, cancel));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nm = name.value.trim();
        if (!nm) { setErr(eName, name, 'Give the track a name.'); return; }
        setErr(eName, name, '');
        save.disabled = true;
        try {
          await S.api.updateTrack(T.id, { name: nm.slice(0, MAX.name), description: desc.value.trim().slice(0, MAX.desc) });
          editBox.hidden = true; toast('Track updated');
          await load();
        } catch (err) {
          setErr(eName, name, err && err.code === 'forbidden' ? 'Only the track’s owner can edit it.' : 'Could not save. Try again in a moment.');
        }
        save.disabled = false;
      });
      editBox.append(form);
      renderHead();
      name.focus();
    }

    /* -- release picker -- */
    function releaseOption(r) {
      let label = 'v' + r.gameVersion + ' · ' + channelLabel(r.channel) + ' · ' + fmtDate(r.createdAt);
      const newest = (ch) => (T.releases.find((x) => x.channel === ch) || {}).id;
      if (r.id === newest('stable')) label += ' · latest stable';
      else if (r.id === newest('dev')) label += ' · latest dev';
      return label;
    }

    function renderBar() {
      relBar.textContent = '';
      const labels = { all: 'All', stable: 'Stable', dev: 'Dev' };
      const chips = h('div', { class: 'chan', role: 'group', 'aria-label': 'Release channel filter' });
      ['all', 'stable', 'dev'].forEach((c) => {
        const b = h('button', { class: 'chip', type: 'button', 'data-rel-chan': c, 'aria-pressed': String(T.chan === c), text: labels[c] });
        b.addEventListener('click', () => {
          T.chan = c;
          const sel = relById(T.selectedId);
          if (!sel || (c !== 'all' && sel.channel !== c)) {
            const id = defaultFor(c);
            if (id) { select(id, true); return; }
            // Nothing in this channel: show the empty state rather than a release the filter hides.
            T.selectedId = null; T.wanted = null; T.expanded = false;
            renderBar(); renderPanel(); renderHistory(); syncCommentSelect(true);
            return;
          }
          renderBar();
        });
        chips.append(b);
      });
      const list = T.releases.filter((r) => T.chan === 'all' || r.channel === T.chan);
      const sel = h('select', { id: 'rel-select', 'aria-label': 'Choose a release' });
      if (!list.length) { sel.append(h('option', { value: '', text: T.releases.length ? 'No releases in this channel' : 'No releases yet' })); sel.disabled = true; }
      else list.forEach((r) => sel.append(h('option', { value: r.id, text: releaseOption(r) })));
      if (list.length && list.some((r) => r.id === T.selectedId)) sel.value = T.selectedId;
      sel.addEventListener('change', () => { if (sel.value) select(sel.value, true); });
      relBar.append(chips, sel);
    }

    /* -- selected release -- */
    function ensureCode(r) {
      if (T.code[r.id] !== undefined || T.loadingCode === r.id) return;
      T.loadingCode = r.id;
      S.api.getRelease(r.id).then((full) => { T.code[r.id] = full && typeof full.code === 'string' ? full.code : null; }, () => { T.code[r.id] = null; })
        .then(() => { if (T.loadingCode === r.id) T.loadingCode = null; if (alive() && T.selectedId === r.id) renderPanel(); });
    }

    function renderPanel() {
      panel.textContent = '';
      panel.className = 'rel-panel';
      const r = relById(T.selectedId);
      if (!r) {
        panel.append(h('p', { class: 'hint', text: T.releases.length
          ? 'No release matches this channel.'
          : (isOwner() ? 'No releases yet. Use “Add a release” to publish the first one.' : 'This track has no releases yet.') }));
        return;
      }
      panel.classList.add(r.channel);
      panel.append(h('div', { class: 'rel-top' },
        h('div', { class: 'tags' },
          h('span', { class: 'pill ' + r.channel, text: channelLabel(r.channel) }),
          h('span', { class: 'pill ver', text: 'v' + r.gameVersion })),
        h('span', { class: 'meta', text: 'published ' + fmtDate(r.createdAt) + ' · ' + r.codeLength.toLocaleString() + ' chars' })));
      if (T.wantedMissing) panel.append(h('p', { class: 'notice', role: 'status', text: 'That release no longer exists. Showing the latest instead.' }));
      if (r.channel === 'dev') {
        panel.append(h('p', { class: 'notice dev', id: 'dev-notice', role: 'note',
          text: 'Dev release. This code was built on a pre-release game version (v' + r.gameVersion + ') and may not load on the stable game.' }));
      }
      if (r.notes) panel.append(h('p', { class: 'notes', text: r.notes }));

      const code = T.code[r.id];
      const actions = h('div', { class: 'actions' });
      if (code === undefined) {
        panel.append(h('p', { class: 'code', id: 'code-block', text: 'Loading code…' }));
        ensureCode(r);
        actions.append(h('button', { class: 'btn small', type: 'button', disabled: true, text: 'Copy code' }));
      } else if (code === null) {
        panel.append(h('p', { class: 'notice', role: 'alert', text: 'Could not load this code.' }));
        const retry = h('button', { class: 'btn small', type: 'button', text: 'Retry' });
        retry.addEventListener('click', () => { T.code[r.id] = undefined; renderPanel(); });
        actions.append(retry);
      } else {
        panel.append(h('p', { class: 'code' + (T.expanded ? ' full' : ''), id: 'code-block', text: code }));
        const copy = h('button', { class: 'btn small', type: 'button', id: 'copy-btn', text: 'Copy code' });
        copy.addEventListener('click', () => copyCode(code, copy));
        const toggle = h('button', { class: 'btn small plain', type: 'button', 'aria-expanded': String(T.expanded), 'aria-controls': 'code-block', text: T.expanded ? 'Collapse' : 'Show full code' });
        toggle.addEventListener('click', () => { T.expanded = !T.expanded; renderPanel(); });
        actions.append(copy, toggle);
      }
      if (canManage()) {
        actions.append(deleteButton('rel:' + r.id, 'release v' + r.gameVersion, renderPanel, async () => {
          try { await S.api.deleteRelease(r.id); toast('Release deleted'); T.selectedId = null; T.wanted = null; await load(); }
          catch (e) { toast('Could not delete that release.'); renderPanel(); }
        }));
      }
      panel.append(actions);
    }

    function renderHistory() {
      historyTitle.textContent = 'All releases (' + T.releases.length + ')';
      history.textContent = '';
      if (!T.releases.length) { history.hidden = true; return; }
      history.hidden = false;
      T.releases.forEach((r) => {
        const a = h('a', { href: '#/t/' + encodeURIComponent(T.id) + '/r/' + encodeURIComponent(r.id), 'aria-current': String(r.id === T.selectedId) },
          h('span', { class: 'pill ' + r.channel, text: channelLabel(r.channel) }),
          h('span', { class: 'pill ver', text: 'v' + r.gameVersion }),
          h('span', { class: 'snip', text: r.notes || 'No release notes' }),
          h('span', { class: 'meta', text: fmtDate(r.createdAt) }));
        history.append(h('li', {}, a));
      });
    }

    /* -- add a release -- */
    function knownVersions() {
      const seen = {};
      T.releases.forEach((r) => { seen[r.gameVersion] = true; });
      return Object.keys(seen).sort((a, b) => naturalCompare(b, a));
    }
    function ensureAddForm() {
      if (!isOwner()) return;
      if (T.addForm) { T.addForm.setKnown(knownVersions()); return; }
      const rel = T.addForm = releaseFields('add', knownVersions());
      const submit = h('button', { class: 'btn', type: 'submit', id: 'add-submit', text: 'Publish release' });
      const form = h('form', { class: 'form', novalidate: true },
        h('h3', { class: 'form-title', text: 'Add a release' }),
        h('p', { class: 'hint', text: 'A release is this track on one game version. Add a new one when the game updates or you fix the track.' }),
        rel.el, h('div', { class: 'submit-row' }, submit));
      let busy = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy || !rel.validate()) return;
        busy = true; submit.disabled = true; submit.textContent = 'Publishing…';
        try {
          const made = await S.api.addRelease(T.id, rel.read());
          rel.remember(); rel.reset();
          addBox.hidden = true;
          toast('Release published');
          T.wanted = made && made.id; T.selectedId = null; T.expanded = false;
          await load();
          if (T.selectedId) { try { window.history.replaceState(null, '', '#/t/' + encodeURIComponent(T.id) + '/r/' + encodeURIComponent(T.selectedId)); } catch (err) { /* ignore */ } }
        } catch (err) {
          rel.codeError(releaseErrorMessage(err));
        }
        busy = false; submit.disabled = false; submit.textContent = 'Publish release';
      });
      addBox.append(form);
    }

    /* -- comments -- */
    function renderComments() {
      commentsTitle.textContent = 'Comments (' + T.comments.length + ')';
      commentList.textContent = '';
      if (!T.comments.length) { commentList.append(h('li', { class: 'hint', text: 'No comments yet.' })); return; }
      T.comments.forEach((c) => {
        const rel = c.releaseId ? relById(c.releaseId) : null;
        const mine = !!S.me.id && c.authorId === S.me.id;
        const head2 = h('div', { class: 'comment-head' },
          h('div', { class: 'tags' }, h('span', { class: 'who' }, authorSpan(c.authorId)),
            rel ? h('span', { class: 'pill ' + rel.channel, text: 'on ' + relLabel(rel) }) : null),
          h('span', { class: 'meta', text: fmtDate(c.createdAt) }));
        const li = h('li', { class: 'comment' }, head2, h('p', { class: 'comment-body', text: c.body }));
        if (mine || S.me.isAdmin) {
          li.append(h('div', { class: 'actions' }, deleteButton('c:' + c.id, 'comment', renderComments, async () => {
            try { await S.api.deleteComment(c.id); toast('Comment deleted'); await load(); }
            catch (e) { toast('Could not delete that comment.'); renderComments(); }
          })));
        }
        commentList.append(li);
      });
      fillNames(commentList, T.comments.map((c) => c.authorId));
    }

    let cSelect = null, cBody = null, cTouched = false;
    function syncCommentSelect(force) {
      if (!cSelect) return;
      const prev = cSelect.value;
      cSelect.textContent = '';
      cSelect.append(h('option', { value: '', text: 'General (whole track)' }));
      T.releases.forEach((r) => cSelect.append(h('option', { value: r.id, text: relLabel(r) })));
      const want = force || !cTouched ? (T.selectedId || '') : prev;
      cSelect.value = T.releases.some((r) => r.id === want) ? want : '';
      if (force) cTouched = false;
    }

    function buildCommentForm() {
      commentBox.textContent = '';
      if (!S.me.id) {
        commentBox.append(h('p', { class: 'hint', id: 'c-signin', text: 'Sign in with the box at the top of the page to leave a comment.' }));
        return;
      }
      cBody = h('textarea', { id: 'c-body', maxlength: MAX.comment, placeholder: 'Leave a comment, bug report or tip' });
      cSelect = h('select', { id: 'c-release', 'aria-label': 'Which release is this about?' });
      cSelect.addEventListener('change', () => { cTouched = true; });
      const eC = h('p', { class: 'err', role: 'alert' });
      const send = h('button', { class: 'btn', type: 'submit', id: 'c-submit', text: 'Comment' });
      const form = h('form', { class: 'form comment-form', novalidate: true },
        field('Comment', cBody, eC),
        h('div', { class: 'comment-row' },
          h('div', { class: 'grow' }, h('label', { class: 'lab', for: 'c-release', text: 'About' }), cSelect), send));
      let busy = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const body = cBody.value.trim();
        if (!body) { setErr(eC, cBody, 'Write something first.'); return; }
        setErr(eC, cBody, '');
        busy = true; send.disabled = true;
        try {
          await S.api.addComment(T.id, { releaseId: cSelect.value || null, body: body.slice(0, MAX.comment) });
          cBody.value = ''; toast('Comment posted');
          await load();
        } catch (err) {
          setErr(eC, cBody, err && err.code === 'forbidden' ? 'You need to be signed in to comment.' : 'Could not post the comment. Try again in a moment.');
        }
        busy = false; send.disabled = false;
      });
      commentBox.append(form);
      syncCommentSelect(true);
    }

    /* -- loading -- */
    async function load() {
      try {
        const [t2, releases, comments] = await Promise.all([S.api.getTrack(T.id), S.api.listReleases(T.id), S.api.listComments(T.id)]);
        if (!alive()) return;
        if (!t2) { showMissing('Track not found', 'This track was deleted.'); return; }
        T.track = t2; T.releases = releases; T.comments = comments; T.loaded = true;
        setBanner('');
        if (T.selectedId && !relById(T.selectedId)) T.selectedId = null;
        chooseSelection();
        renderHead(); renderBar(); renderPanel(); renderHistory(); renderComments();
        ensureAddForm(); syncCommentSelect(false);
      } catch (e) {
        if (!alive()) return;
        setBanner('Could not load this track. Reload to try again.');
      }
    }

    S.refresh = load;
    buildCommentForm();
    renderHead(); renderBar(); renderPanel(); renderHistory(); renderComments();
    panel.replaceChildren(h('p', { class: 'loading', text: 'Loading releases…' }));
    load();
    focusHeading(head.querySelector('h2'));
  }

  /* ---------- routing ---------- */
  function focusHeading(el) {
    if (!el || S.firstRoute) return;
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (!parts.length) return { name: 'home' };
    if (parts[0] === 'new' && parts.length === 1) return { name: 'new' };
    if (parts[0] === 't' && parts[1]) return { name: 'track', id: parts[1], rid: parts[2] === 'r' && parts[3] ? parts[3] : null };
    return { name: 'missing' };
  }

  function route() {
    const rt = parseHash();
    if (rt.name === 'track' && S.track && S.track.id === rt.id && S.view.contains(S.track.root)) { S.track.onRoute(rt.rid); return; }
    const token = ++S.nav;
    S.refresh = null; S.track = null; S.pending = null;
    document.title = 'Polytrack Codes';
    S.view.textContent = '';
    setBanner('');
    if (!S.firstRoute) window.scrollTo(0, 0);
    if (rt.name === 'home') showHome();
    else if (rt.name === 'new') showNew();
    else if (rt.name === 'track') showTrack(rt, token);
    else showMissing('Page not found', 'There is nothing at this address.');
    S.firstRoute = false;
  }

  /* ---------- sign in ---------- */
  function setupAuth() {
    const auth = S.auth;
    if (!auth) return;
    const form = $('auth-form'), who = $('auth-who'), msg = $('auth-msg');
    auth.user().then((u) => {
      if (u) { who.hidden = false; $('auth-label').textContent = 'Signed in' + (u.email ? ' as ' + u.email : '') + '.'; }
      else form.hidden = false;
    });
    let mode = 'in';
    const setMode = (m) => {
      mode = m;
      const up = m === 'up';
      $('auth-name').hidden = !up;
      $('auth-pass').setAttribute('autocomplete', up ? 'new-password' : 'current-password');
      $('auth-submit').textContent = up ? 'Create account' : 'Sign in';
      $('auth-mode').textContent = up ? 'Already have an account? Sign in' : 'New here? Create an account';
      msg.textContent = '';
    };
    $('auth-mode').addEventListener('click', () => setMode(mode === 'in' ? 'up' : 'in'));
    const done = () => { (auth.reload || (() => location.reload()))(); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('auth-email').value.trim(), pass = $('auth-pass').value, name = $('auth-name').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Enter a valid email address.'; return; }
      if (mode === 'up' && !name) { msg.textContent = 'Pick a display name so people know who shared a track.'; return; }
      if (pass.length < 8) { msg.textContent = 'Use a password of at least 8 characters.'; return; }
      $('auth-submit').disabled = true;
      msg.textContent = mode === 'up' ? 'Creating your account…' : 'Signing in…';
      const p = mode === 'up' ? auth.signUp(email, pass, name) : auth.signIn(email, pass);
      p.then((r) => {
        if (r && r.needsConfirm) { msg.textContent = 'Account created. Check your email and confirm it, then sign in.'; return; }
        done();
      }, (err) => {
        msg.textContent = err && err.message ? err.message : 'Something went wrong. Try again.';
      }).then(() => { $('auth-submit').disabled = false; });
    });
    $('auth-out').addEventListener('click', () => { auth.signOut().then(() => location.reload()); });
  }

  /* ---------- start ---------- */
  async function start() {
    S.view = $('view');
    const pt = window.polytrack;
    if (!pt) {
      const msg = window.__backendError || 'This site is not connected to a backend yet. See SETUP.md.';
      setBanner(msg);
      S.view.append(emptyCard('Not connected', msg));
      return;
    }
    S.api = pt.api; S.auth = pt.auth;
    try { S.me = await S.api.me(); } catch (e) { /* stay signed out */ }
    setupAuth();
    window.addEventListener('hashchange', route);
    S.api.subscribe(() => {
      clearTimeout(S.feedTimer);
      S.feedTimer = setTimeout(() => { if (S.refresh) S.refresh(); }, 300);
    });
    route();
  }

  start();
})();
