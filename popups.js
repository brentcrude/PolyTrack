/* Unified popups for Polytrack Codes. One small API for every kind of popup:
 *
 *   Popups.show({ title, body, style, actions, dismissible, badge })  -> Promise<value of the clicked action, or null if dismissed>
 *   Popups.alert(title, body, opts)                                   -> Promise
 *   Popups.confirm(title, body, { yes, no, style })                   -> Promise<boolean>
 *   Popups.toast(message)                                             -> small non-blocking message (the #toast element)
 *   Popups.announce({ id, title, body, style })                       -> a broadcast popup; remembered per browser once closed
 *   Popups.clear()                                                    -> drop everything queued and close the open popup
 *
 * Styles: 'info' (default), 'success', 'warn', 'party' (confetti), 'loud' (shakes, flashes, and can only be closed with
 * its button, not Escape or a backdrop click). Pass dismissible:true/false to override that default.
 *
 * Popups queue and show one at a time. They are native <dialog> elements (focus trap, Escape and backdrop handled by the
 * browser), text is always set with textContent (never HTML), and all motion is off under prefers-reduced-motion. */
(function () {
  'use strict';

  var STYLES = ['info', 'success', 'warn', 'party', 'loud'];
  var BADGES = { info: 'Notice', success: 'Good news', warn: 'Warning', party: 'Party time', loud: 'Attention' };
  var SEEN_KEY = 'pt-seen-announcements';

  var queue = [], current = null, uid = 0, toastTimer = null;
  var queuedAnnouncements = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var reduced = function () {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  };

  /* ---- remembering which announcements this browser has already seen ---- */
  function readSeen() {
    try { var v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function hasSeen(id) { return readSeen().indexOf(id) !== -1; }
  function markSeen(id) {
    try {
      var s = readSeen();
      if (s.indexOf(id) === -1) s.push(id);
      localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-200)));
    } catch (e) { /* storage may be blocked: the popup just shows again next visit */ }
  }

  /* ---- the dialog ---- */
  function normalise(o) {
    o = o || {};
    var style = STYLES.indexOf(o.style) !== -1 ? o.style : 'info';
    var actions = (o.actions && o.actions.length ? o.actions : [{ label: 'Got it', value: true, primary: true }]).map(function (a) {
      return { label: String(a.label === undefined ? 'OK' : a.label), value: a.value === undefined ? true : a.value, primary: !!a.primary };
    });
    if (!actions.some(function (a) { return a.primary; })) actions[actions.length - 1].primary = true;
    return {
      title: String(o.title === undefined ? '' : o.title),
      body: String(o.body === undefined ? '' : o.body),
      style: style,
      badge: o.badge === undefined ? BADGES[style] : o.badge,
      actions: actions,
      dismissible: o.dismissible === undefined ? style !== 'loud' : !!o.dismissible
    };
  }

  function confetti() {
    var wrap = el('div', 'confetti');
    wrap.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 44; i++) {
      var p = el('span');
      p.style.setProperty('--x', ((i * 37) % 100) + '%');
      p.style.setProperty('--d', ((i * 13) % 30) / 10 + 's');
      p.style.setProperty('--t', 2.4 + ((i * 7) % 18) / 10 + 's');
      p.style.setProperty('--h', ((i * 47) % 360) + '');
      wrap.append(p);
    }
    return wrap;
  }

  function pump() {
    if (current || !queue.length) return;
    var item = queue.shift();
    var o = item.o;
    current = item;
    var id = 'popup-title-' + (++uid);

    var dlg = el('dialog', 'popup popup-' + o.style);
    dlg.setAttribute('aria-labelledby', id);
    var card = el('div', 'popup-card');
    if (o.badge) card.append(el('span', 'popup-badge', o.badge));
    var title = el('h2', 'popup-title', o.title);
    title.id = id;
    card.append(title);
    if (o.body) card.append(el('p', 'popup-body', o.body));

    var actions = el('div', 'popup-actions');
    var primary = null;
    o.actions.forEach(function (a) {
      var b = el('button', 'btn' + (a.primary ? '' : ' plain'), a.label);
      b.type = 'button';
      b.addEventListener('click', function () { finish(item, a.value); });
      if (a.primary) primary = b;
      actions.append(b);
    });
    card.append(actions);

    if (o.dismissible) {
      var x = el('button', 'popup-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', function () { finish(item, null); });
      card.append(x);
    }
    if (o.style === 'party' && !reduced()) dlg.append(confetti());
    dlg.append(card);

    // Escape and backdrop clicks close only dismissible popups.
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); if (o.dismissible) finish(item, null); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && o.dismissible) finish(item, null); });

    item.dlg = dlg;
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    if (primary) primary.focus();
  }

  function finish(item, value) {
    if (current !== item) return;
    current = null;
    try { item.dlg.close(); } catch (e) { /* not open */ }
    item.dlg.remove();
    item.resolve(value);
    pump();
  }

  /* ---- public API ---- */
  function show(opts) {
    return new Promise(function (resolve) {
      queue.push({ o: normalise(opts), resolve: resolve, dlg: null });
      pump();
    });
  }

  function alertPopup(title, body, opts) {
    return show(Object.assign({}, opts, { title: title, body: body }));
  }

  function confirmPopup(title, body, opts) {
    opts = opts || {};
    return show({
      title: title, body: body, style: opts.style || 'warn', badge: opts.badge,
      actions: [{ label: opts.no || 'Cancel', value: false }, { label: opts.yes || 'OK', value: true, primary: true }]
    }).then(function (v) { return v === true; });
  }

  function toast(message) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  // A broadcast popup. With an id it is shown once per browser (remembered when closed) and never queued twice.
  function announce(a) {
    a = a || {};
    var id = a.id || null;
    if (id && hasSeen(id)) return Promise.resolve(null);
    if (id && queuedAnnouncements[id]) return queuedAnnouncements[id];
    var p = show({ title: a.title, body: a.body, style: a.style || 'loud', badge: a.badge === undefined ? 'Announcement' : a.badge, actions: a.actions });
    if (id) {
      queuedAnnouncements[id] = p;
      p.then(function () { markSeen(id); delete queuedAnnouncements[id]; });
    }
    return p;
  }

  function clear() {
    var waiting = queue.splice(0);
    waiting.forEach(function (i) { i.resolve(null); });
    if (current) finish(current, null);
  }

  window.Popups = {
    show: show, alert: alertPopup, confirm: confirmPopup, toast: toast, announce: announce, clear: clear,
    isOpen: function () { return !!current; }, styles: STYLES.slice(), hasSeen: hasSeen
  };
})();
