/* Tamhas Trading - experience layer logic (pure functions, no DOM): profile and preferences, feature catalog, ranked search,
   favorites and recents, personalised ordering, greetings, what's-new notes and a plain-language glossary.
   Personalisation is stored locally only. Nothing here invents data. */
(function (root) {
  'use strict';
  function str(v) { return v == null ? '' : String(v); }
  var DENSITY = ['comfortable', 'compact'];
  var MAX_FAV = 8, MAX_RECENT = 6;

  /* One entry per screen. cat groups the More hub; keys are extra search words. */
  var CATALOG = [
    { id: 'home', title: 'Dashboard', text: 'Your daily overview.', cat: 'start', keys: 'home overview today' },
    { id: 'calc', title: 'Risk calculator', text: 'How many contracts fit your risk range.', cat: 'trade', keys: 'contracts size stop loss points position quick calculator' },
    { id: 'journal', title: 'Trade journal', text: 'Log trades, calendar, notes and backups.', cat: 'trade', keys: 'log trade entry diary calendar backup export csv screenshots new trade' },
    { id: 'import', title: 'Import trades', text: 'Bring in a CSV from your broker, with preview and undo.', cat: 'trade', keys: 'csv upload broker tradovate history migrate' },
    { id: 'risk', title: 'Risk center', text: 'Position sizing, exposure and limits you set yourself.', cat: 'trade', keys: 'exposure limits daily loss max risk scenarios streak reward ratio' },
    { id: 'analytics', title: 'Analytics', text: 'Win rate, expectancy, drawdown, heatmaps and more.', cat: 'review', keys: 'performance stats statistics equity curve profit factor charts' },
    { id: 'insights', title: 'Insights', text: 'Plain observations from your own trades. No AI.', cat: 'review', keys: 'patterns mistakes review summary overtrading' },
    { id: 'discipline', title: 'Discipline', text: 'Plan, checklists, routines, reflections and goals.', cat: 'review', keys: 'plan checklist routine reflection goals score rules habit journal mood' },
    { id: 'strategy', title: 'Strategy lab', text: 'Define strategies, backtest by hand, compare and simulate.', cat: 'review', keys: 'backtest monte carlo simulate compare setups forward test' },
    { id: 'accounts', title: 'Accounts', text: 'Prop firm and personal accounts, drawdown and payouts.', cat: 'money', keys: 'prop firm apex topstep drawdown payout balance trailing' },
    { id: 'money', title: 'Money', text: 'Fees, payouts, deposits and profit after costs.', cat: 'money', keys: 'fees expenses subscriptions payouts deposits net profit ledger' },
    { id: 'intel', title: 'Market intel', text: 'Economic calendar, events and market sessions.', cat: 'market', keys: 'news calendar fomc cpi events sessions' },
    { id: 'health', title: 'System health', text: 'Check your saved data, storage and backups.', cat: 'system', keys: 'integrity repair storage quarantine problems' },
    { id: 'help', title: 'Help and glossary', text: 'Plain-language explanations and keyboard shortcuts.', cat: 'system', keys: 'learn explain what is r multiple expectancy drawdown shortcuts keyboard guide tour' },
    { id: 'settings', title: 'Settings', text: 'Name, theme, layout, sessions and privacy.', cat: 'system', keys: 'profile name theme dark light compact preferences privacy reset' }
  ];
  var CATS = [['start', 'Start'], ['trade', 'Trade'], ['review', 'Review and improve'], ['money', 'Money'], ['market', 'Market'], ['system', 'System']];
  /* Things you can do or change, found by search. view = where it lives; act = optional action keyword handled by the UI. */
  var EXTRAS = [
    { id: 'x-newtrade', title: 'Log a new trade', text: 'Open the trade form.', view: 'journal', act: 'new-trade', keys: 'add entry record' },
    { id: 'x-name', title: 'Change my name', text: 'Update the name used in greetings.', view: 'settings', act: 'focus-name', keys: 'profile display greeting' },
    { id: 'x-theme', title: 'Switch light or dark theme', text: 'Appearance settings.', view: 'settings', act: 'theme', keys: 'dark light mode appearance' },
    { id: 'x-compact', title: 'Compact or comfortable layout', text: 'Change how dense screens are.', view: 'settings', act: 'personalize', keys: 'density spacing display mode' },
    { id: 'x-tour', title: 'Replay the welcome tour', text: 'See the quick tour of the main tools again.', view: 'home', act: 'tour', keys: 'onboarding intro walkthrough' },
    { id: 'x-startpage', title: 'Choose my start page', text: 'Pick which screen opens first.', view: 'settings', act: 'personalize', keys: 'default page home' },
    { id: 'x-widgets', title: 'Customize my dashboard', text: 'Show, hide and reorder dashboard sections.', view: 'home', act: 'customize', keys: 'widgets layout home' },
    { id: 'x-backup', title: 'Download a backup', text: 'Save a copy of your data.', view: 'journal', act: 'backup', keys: 'export save copy restore' },
    { id: 'x-sessions', title: 'Edit market session windows', text: 'Change session start and end times.', view: 'settings', act: 'sessions', keys: 'london new york asia times' },
    { id: 'x-whatsnew', title: "What's new", text: 'Recent improvements.', view: 'help', act: 'whatsnew', keys: 'updates changelog release' },
    { id: 'x-shortcuts', title: 'Keyboard shortcuts', text: 'Move around faster on a computer.', view: 'help', act: 'shortcuts', keys: 'keys hotkeys' }
  ];
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

  function defaults() { return { v: 1, name: '', interests: [], density: 'comfortable', startPage: 'home', onboarded: false, tourSeen: false, favorites: [], recents: [], widgets: defaultWidgets(), goalNote: '', goalDate: '', whatsNewSeen: 0, lastView: 'home', lastSeen: 0, recentCalc: null }; }
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

  var WHATS_NEW = [
    { id: 7, date: '2026-10-29', title: 'A more personal dashboard', items: ['Greeting by name, favorites, recently used tools and a customizable dashboard.', 'Search anything with Ctrl or Cmd + K, or the search button.', 'A short optional tour, a help page with plain-language explanations, and compact layout.'] },
    { id: 6, date: '2026-10-29', title: 'Insights, health check and strategy lab', items: ['Rule-based insights from your own trades (no AI).', 'System health check for your saved data.', 'Strategy lab with manual backtests, comparisons and Monte Carlo.'] },
    { id: 5, date: '2026-10-28', title: 'Discipline, risk center, analytics', items: ['Trading plan, checklists, reflections and goals.', 'Position sizing, exposure and limits that you set.', 'Deeper analytics with sample-size labels.'] }
  ];
  var GLOSSARY = [
    { term: 'R multiple', text: 'Profit or loss measured in units of what you risked. If you risk $100 and make $250, that is +2.5R. It lets you compare trades of different sizes.' },
    { term: 'Expectancy', text: 'The average result per trade. Positive means your trades have averaged a gain. It is only meaningful with enough trades, and past averages do not guarantee future ones.' },
    { term: 'Win rate', text: 'Winning trades divided by all trades. A high win rate can still lose money if the losses are bigger than the wins.' },
    { term: 'Profit factor', text: 'Total gains divided by total losses. Above 1.0 means gains outweighed losses over the period.' },
    { term: 'Drawdown', text: 'How far you have fallen from your highest point. Max drawdown is the biggest such fall. Prop firms often limit it.' },
    { term: 'Trailing drawdown', text: 'A drawdown limit that rises with your account high, so the floor moves up as you profit. Check your firm\'s exact rule.' },
    { term: 'Sample size', text: 'How many trades a statistic is based on. Small samples swing wildly, so the app labels them and shows a range.' },
    { term: '95% range', text: 'A range that would contain the true value about 95 times out of 100 if your trades were a fair sample. Wide ranges mean you cannot be sure yet.' },
    { term: 'Stop', text: 'The price where you exit a losing trade. Recording it lets the app work out your planned risk and R.' },
    { term: 'Planned risk', text: 'What you would lose if the stop is hit: distance to the stop times the dollar value per point times contracts.' },
    { term: 'Net and gross', text: 'Gross is before fees; net is after fees. Net needs fees entered on each trade.' },
    { term: 'Monte Carlo', text: 'Reshuffling your own past results many times to see how much luck alone could change the outcome. It is not a forecast.' },
    { term: 'Contract (point value)', text: 'Each futures contract moves a fixed dollar amount per point. NQ is $20 per point, MNQ is $2.' }
  ];
  var SHORTCUTS = [['Ctrl/Cmd + K or /', 'Search everything'], ['?', 'Show shortcuts'], ['G then H', 'Dashboard'], ['G then J', 'Journal'], ['G then R', 'Risk calculator'], ['G then A', 'Analytics'], ['G then S', 'Settings'], ['N', 'Log a new trade'], ['Esc', 'Close any pop-up']];
  var TOUR = [
    { view: 'home', title: 'Your dashboard', text: 'Today\'s trading, your favorites and recent tools live here. Tap CUSTOMIZE to show, hide or reorder sections.' },
    { view: 'calc', title: 'Risk calculator', text: 'Enter a stop distance and your dollar range to see how many contracts fit. Your last settings are remembered.' },
    { view: 'journal', title: 'Trade journal', text: 'Log trades in under a minute. Everything feeds your analytics, insights and discipline score.' },
    { view: 'more', title: 'Everything else', text: 'Analytics, accounts, strategy lab and more are grouped here. Star a tool to pin it to your dashboard.' },
    { view: 'home', title: 'Search from anywhere', text: 'Press Ctrl or Cmd + K, or tap the search button at the top, then type what you want.' }
  ];

  var api = { CATALOG: CATALOG, CATS: CATS, EXTRAS: EXTRAS, INTERESTS: INTERESTS, WIDGETS: WIDGETS, WHATS_NEW: WHATS_NEW, GLOSSARY: GLOSSARY, SHORTCUTS: SHORTCUTS, TOUR: TOUR, MAX_FAV: MAX_FAV, MAX_RECENT: MAX_RECENT, defaults: defaults, cleanPrefs: cleanPrefs, cleanName: cleanName, cleanWidgets: cleanWidgets, pushRecent: pushRecent, toggleFavorite: toggleFavorite, moveWidget: moveWidget, prioritize: prioritize, entry: entry, search: search, greeting: greeting };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTExperienceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
