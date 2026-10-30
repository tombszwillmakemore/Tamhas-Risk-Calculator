/* Tamhas Trading - experience layer logic (pure functions, no DOM): profile and preferences, feature catalog, ranked search,
   favorites and recents, personalised ordering, greetings, what's-new notes and a plain-language glossary.
   Personalisation is stored locally only. Nothing here invents data. */
(function (root) {
  'use strict';
  function str(v) { return v == null ? '' : String(v); }
  var DENSITY = ['comfortable', 'compact'];
  var MAX_FAV = 8, MAX_RECENT = 6;

  /* Derived from the feature registry (assets/registry-core.js) - the single source of truth. Do not hand-edit lists here. */
  var REG = (typeof module !== 'undefined' && module.exports) ? require('./registry-core.js') : root.TTRegistry;
  var CATALOG = REG.FEATURES.filter(function (f) { return f.kind === 'screen' && !f.virtual; }).map(function (f) { return { id: f.id, title: f.title, text: f.text, cat: f.cat, keys: f.keys, since: f.since }; });
  var CATS = REG.CATS;
  /* Things you can do or change, found by search. view = where it lives; act = optional action keyword handled by the UI. */
  var EXTRAS = REG.FEATURES.filter(function (f) { return f.kind === 'action' || f.virtual; }).map(function (f) { return { id: f.kind === 'action' ? f.id : 'x-' + f.id, title: f.title, text: f.text, view: f.virtual ? 'home' : f.view, act: f.act || f.id, keys: f.keys, since: f.since }; });
  var INTERESTS = [
    { id: 'risk', label: 'Position sizing and risk', pick: ['calc', 'risk'] },
    { id: 'journal', label: 'Journaling my trades', pick: ['journal', 'import'] },
    { id: 'review', label: 'Analyzing my performance', pick: ['analytics', 'insights'] },
    { id: 'discipline', label: 'Building discipline', pick: ['discipline', 'journal'] },
    { id: 'prop', label: 'Prop firm accounts', pick: ['accounts', 'money'] },
    { id: 'strategy', label: 'Testing strategies', pick: ['strategy', 'analytics'] },
    { id: 'news', label: 'Market events and sessions', pick: ['intel'] }
  ];
  var WIDGETS = [
    { id: 'continue', label: 'Continue where you left off' }, { id: 'actions', label: 'Quick actions' }, { id: 'today', label: "Today's trading" }, { id: 'pnl', label: "Today's P&L" },
    { id: 'favorites', label: 'Favorites' }, { id: 'quickrisk', label: 'Quick risk calculator' }, { id: 'week', label: 'This week' }, { id: 'recentTrades', label: 'Recent trades' },
    { id: 'recents', label: 'Recently used' }, { id: 'sessions', label: 'Market sessions' }, { id: 'next', label: 'Next event' }, { id: 'tools', label: 'All tools' }, { id: 'news', label: "What's new" }
  ];
  var DEFAULT_HIDDEN = [];     // every section is visible by default; ones with nothing to show simply render nothing

  function defaults() { return { v: 1, name: '', interests: [], density: 'comfortable', startPage: 'home', onboarded: false, tourSeen: false, favorites: [], recents: [], widgets: defaultWidgets(), goalNote: '', goalDate: '', whatsNewSeen: 0, toursSeen: [], lastView: 'home', lastSeen: 0, recentCalc: null }; }
  function defaultWidgets() { return WIDGETS.map(function (w) { return { id: w.id, visible: DEFAULT_HIDDEN.indexOf(w.id) < 0 }; }); }
  function cleanName(v) { return str(v).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24); }
  function validViewId(id) { return CATALOG.some(function (c) { return c.id === id; }); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function cleanWidgets(raw) {
    var known = {}, seen = {}; WIDGETS.forEach(function (w) { known[w.id] = 1; });
    var out = []; (Array.isArray(raw) ? raw : []).forEach(function (w) { if (w && known[w.id] && !seen[w.id]) { seen[w.id] = 1; out.push({ id: w.id, visible: w.visible !== false }); } });
    defaultWidgets().forEach(function (w) { if (!seen[w.id]) out.push(w); });   // any missing widget is added back so nothing disappears silently
    return out;
  }
  function cleanPrefs(raw) {
    var d = defaults(), r = raw && typeof raw === 'object' ? raw : {};
    d.name = cleanName(r.name); d.interests = uniq((Array.isArray(r.interests) ? r.interests : []).filter(function (i) { return INTERESTS.some(function (x) { return x.id === i; }); }));
    d.density = DENSITY.indexOf(r.density) >= 0 ? r.density : 'comfortable'; d.startPage = r.startPage === 'last' || validViewId(r.startPage) ? r.startPage : 'home';
    d.onboarded = r.onboarded === true; d.tourSeen = r.tourSeen === true;
    d.favorites = uniq((Array.isArray(r.favorites) ? r.favorites : []).filter(function (i) { return validViewId(i) && i !== 'home'; })).slice(0, MAX_FAV);
    d.recents = uniq((Array.isArray(r.recents) ? r.recents : []).filter(function (i) { return validViewId(i) && i !== 'home'; })).slice(0, MAX_RECENT);
    d.widgets = cleanWidgets(r.widgets); d.goalNote = str(r.goalNote).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
    d.goalDate = /^\d{4}-\d{2}-\d{2}$/.test(str(r.goalDate)) ? str(r.goalDate) : ''; if (!d.goalNote) d.goalDate = '';
    d.whatsNewSeen = Number.isInteger(r.whatsNewSeen) && r.whatsNewSeen >= 0 ? r.whatsNewSeen : 0; d.lastView = validViewId(r.lastView) ? r.lastView : 'home'; d.lastSeen = Number.isFinite(r.lastSeen) && r.lastSeen > 0 ? r.lastSeen : 0;
    d.toursSeen = uniq((Array.isArray(r.toursSeen) ? r.toursSeen : []).filter(function (i) { return REG.byId(i); })).slice(0, 40);
    var rc = r.recentCalc; d.recentCalc = rc && typeof rc === 'object' ? { entry: str(rc.entry).slice(0, 14), stop: str(rc.stop).slice(0, 14), risk: str(rc.risk).slice(0, 14), inst: str(rc.inst).slice(0, 10) } : null;
    return d;
  }

  /* ---------- favorites and recents ---------- */
  function pushRecent(list, id) { if (!validViewId(id) || id === 'home') return list.slice(); return [id].concat(list.filter(function (x) { return x !== id; })).slice(0, MAX_RECENT); }
  function toggleFavorite(list, id) {
    if (!validViewId(id) || id === 'home') return { list: list.slice(), changed: false };
    if (list.indexOf(id) >= 0) return { list: list.filter(function (x) { return x !== id; }), changed: true, added: false };
    if (list.length >= MAX_FAV) return { list: list.slice(), changed: false, full: true };
    return { list: list.concat([id]), changed: true, added: true };
  }
  function moveWidget(widgets, id, dir) { var a = widgets.slice(), i = a.findIndex(function (w) { return w.id === id; }), j = i + dir; if (i < 0 || j < 0 || j >= a.length) return a; var t = a[i]; a[i] = a[j]; a[j] = t; return a; }

  /* Order for the quick-access grid: your favorites first, then tools matching what you said you care about, then the rest. */
  function prioritize(prefs) {
    var ids = CATALOG.filter(function (c) { return c.id !== 'home' && c.id !== 'settings' && c.id !== 'help'; }).map(function (c) { return c.id; }), out = prefs.favorites.slice();
    prefs.interests.forEach(function (i) { var it = INTERESTS.filter(function (x) { return x.id === i; })[0]; if (it) it.pick.forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); }); });
    ids.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); return out;
  }
  function entry(id) { return CATALOG.filter(function (c) { return c.id === id; })[0] || null; }

  /* ---------- search ---------- */
  function tokens(q) { return str(q).toLowerCase().split(/[^a-z0-9&']+/).filter(Boolean); }
  function score(item, toks) {
    var title = item.title.toLowerCase(), text = item.text.toLowerCase(), keys = (item.keys || '').toLowerCase(), words = (title + ' ' + keys).split(/\s+/), total = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], s = 0;
      if (title === toks.join(' ')) s = 100; else if (title.indexOf(t) === 0) s = 80; else if (title.split(/\s+/).some(function (w) { return w.indexOf(t) === 0; })) s = 60;
      else if (words.some(function (w) { return w.indexOf(t) === 0; })) s = 45; else if (title.indexOf(t) >= 0 || keys.indexOf(t) >= 0) s = 30; else if (text.indexOf(t) >= 0) s = 15;
      if (!s) return 0; total += s;
    }
    var tw = title.split(/[^a-z0-9&']+/); if (toks.length > 1 && toks.every(function (t) { return tw.some(function (w) { return w.indexOf(t) === 0; }); })) total += 12 * toks.length;   // every word is in the title: prefer it
    return total / toks.length;
  }
  // Returns up to `limit` matches, best first. Every word you type must match something. Empty query -> the suggestion list.
  function search(query, limit, favorites) {
    limit = limit || 8; var toks = tokens(query), items = CATALOG.filter(function (c) { return c.id !== 'home'; }).map(function (c) { return { id: c.id, title: c.title, text: c.text, keys: c.keys, view: c.id, kind: 'screen', cat: c.cat }; }).concat(EXTRAS.map(function (x) { return { id: x.id, title: x.title, text: x.text, keys: x.keys, view: x.view, act: x.act, kind: 'action' }; }));
    var home = CATALOG[0]; items.unshift({ id: 'home', title: home.title, text: home.text, keys: home.keys, view: 'home', kind: 'screen', cat: 'start' });
    if (!toks.length) { var fav = favorites || []; var base = items.filter(function (i) { return i.kind === 'screen'; }); base.sort(function (a, b) { return (fav.indexOf(b.id) >= 0 ? 1 : 0) - (fav.indexOf(a.id) >= 0 ? 1 : 0); }); return base.slice(0, limit); }
    return items.map(function (i, ix) { return { i: i, s: score(i, toks), ix: ix }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s || (a.i.kind === 'screen' ? -1 : 1) - (b.i.kind === 'screen' ? -1 : 1) || a.ix - b.ix; }).slice(0, limit).map(function (x) { return x.i; });
  }

  /* ---------- greeting ---------- */
  function greeting(name, now, lastSeen) {
    var h = now.getHours(), part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late night', n = cleanName(name), first = !lastSeen;
    var line = (first ? 'Welcome' : 'Welcome back') + (n ? ', ' + n + '!' : '!');
    return { line: line, sub: part + (n ? '' : '') + '. ' + (first ? 'Everything here stays on this device.' : 'Here is your day at a glance.') };
  }

  var WHATS_NEW = REG.RELEASES.map(function (r) { return { id: r.id, version: r.version, date: r.date, title: r.title, items: r.items.concat(r.improvements || []), fixes: r.fixes || [], features: r.features || [] }; });
  var GLOSSARY = REG.GLOSSARY;
  var SHORTCUTS = REG.SHORTCUTS;
  var TOUR = REG.MAIN_TOUR.map(function (t) { var f = t.feature ? REG.byId(t.feature) : null; return { view: t.view || (f && !f.virtual ? f.view : 'home'), title: t.title, text: t.text, ring: t.ring || '', feature: t.feature || '' }; });

  var api = { CATALOG: CATALOG, CATS: CATS, EXTRAS: EXTRAS, INTERESTS: INTERESTS, WIDGETS: WIDGETS, WHATS_NEW: WHATS_NEW, GLOSSARY: GLOSSARY, SHORTCUTS: SHORTCUTS, TOUR: TOUR, MAX_FAV: MAX_FAV, MAX_RECENT: MAX_RECENT, defaults: defaults, cleanPrefs: cleanPrefs, cleanName: cleanName, cleanWidgets: cleanWidgets, pushRecent: pushRecent, toggleFavorite: toggleFavorite, moveWidget: moveWidget, prioritize: prioritize, entry: entry, search: search, greeting: greeting };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTExperienceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
