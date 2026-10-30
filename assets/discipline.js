/* Tamhas Trading - Discipline: trading plan, pre/post-trade checklists, routines, daily reflections, goals and a transparent
   discipline score. Process, not profit. Everything is saved on this device (and in backups). */
(function () {
  'use strict';
  var root = document.getElementById('dsRoot'); if (!root) return;
  var D = window.TTDisciplineCore, A = window.TTAnalyticsCore, C = window.TTJournalCore, U = window.TTUI, DB = window.TTDB, ST = window.TTStore;
  var esc = U.esc, TABS = [['today', 'TODAY'], ['plan', 'PLAN'], ['lists', 'LISTS'], ['reflect', 'REFLECT'], ['goals', 'GOALS'], ['score', 'SCORE']];
  var S = { loaded: false, err: null, tab: 'today', rows: [], plan: null, defs: [], routines: [], runs: [], rruns: [], refs: [], goals: [], open: null, openAns: {}, openTrade: null, msg: null, listDraft: null, planDraft: null, planErr: null, refDate: null, refDraft: null, refErr: null, goalErr: null, goalDraft: null, period: 'week', editList: null };
  var STARTERS = {
    pre: { name: 'Before I enter', type: 'pre', itemsText: '*I know my stop price before I enter\n*My risk is within my plan\n*This is one of my planned setups\nI checked the news calendar\nI am calm and focused' },
    post: { name: 'After the trade', type: 'post', itemsText: 'I followed my entry rules\nI followed my exit rules\nI recorded the trade and a note\nI know what I would do differently' },
    routine: { name: 'Morning routine', type: 'routine', itemsText: 'Review my plan and rules\nCheck the economic calendar\nDecide today\'s max risk and max trades\nNote how I feel before I start' }
  };
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function nowHM() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), ST.list('plan'), ST.list('checklist'), ST.list('routine'), ST.list('reflection'), ST.list('goal')]); }).then(function (r) {
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); }); S.rows = C.analyze(ok);
      S.plan = r[1].filter(function (x) { return x.id === 'plan-main'; })[0] || null;
      S.defs = r[2].filter(function (x) { return x.type === 'def'; }).sort(function (a, b) { return a.createdAt - b.createdAt; }); S.runs = r[2].filter(function (x) { return x.type === 'run'; });
      S.routines = r[3].filter(function (x) { return x.type === 'def'; }).sort(function (a, b) { return a.createdAt - b.createdAt; }); S.rruns = r[3].filter(function (x) { return x.type === 'run'; });
      S.refs = r[4].filter(function (x) { return x.date; }).sort(function (a, b) { return b.date < a.date ? -1 : 1; }); S.goals = r[5].filter(function (x) { return x.metric; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
      S.loaded = true; S.err = null;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function ctx() {
    var pre = S.defs.filter(function (d) { return d.listType === 'pre'; }), preIds = {}; pre.forEach(function (d) { preIds[d.id] = d; });
    var pr = S.runs.filter(function (r) { return preIds[r.defId]; }).map(function (r) { return { date: r.date, ready: D.runStats(preIds[r.defId], r.answers).ready }; });
    return { plan: S.plan, hasPreList: pre.length > 0, preRuns: pr, reflections: S.refs.map(function (r) { return { date: r.date }; }) };
  }
  function basis() { return S.rows.some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross'; }
  function save(doc) { return ST.save(doc).catch(function (e) { U.toast('Could not save. Nothing was changed.', true); throw e; }); }
  function checkRow(it, on, attr) { return '<label class="ui-chk"><input type="checkbox" ' + attr + '="' + esc(it.id) + '"' + (on ? ' checked' : '') + '><span>' + esc(it.text) + (it.required ? ' <small class="note" style="margin:0">required</small>' : '') + '</span></label>'; }
  function field(id, label, val, ph, mode, area) { return '<label for="' + id + '">' + label + '</label>' + (area ? '<textarea id="' + id + '" rows="' + area + '" placeholder="' + esc(ph || '') + '">' + esc(val) + '</textarea>' : '<input id="' + id + '" type="text" inputmode="' + (mode || 'text') + '" autocomplete="off" placeholder="' + esc(ph || '') + '" value="' + esc(val) + '">'); }
  function errBox(list) { return list && list.length ? '<div class="ui-banner bad" role="alert">' + list.map(esc).join('<br>') + '</div>' : ''; }

  /* ---------- today ---------- */
  function todayHtml() {
    var t = today(), h = '', trades = S.rows.filter(function (r) { return r.t.date === t; }), pm = S.plan && S.plan.maxTradesPerDay;
    h += '<div class="ui-grid">' + U.stat('Trades today', String(trades.length), pm ? 'plan allows ' + pm : 'no limit in your plan', pm && trades.length > pm ? 'neg' : '') + U.stat('Reflection', S.refs.some(function (r) { return r.date === t; }) ? 'Saved' : 'Not yet', S.refs.some(function (r) { return r.date === t; }) ? '' : 'in the REFLECT tab') + '</div>';
    if (pm && trades.length > pm) h += '<div class="ui-banner warn">You have taken more trades today than your plan allows (' + pm + '). Worth a pause and a note in your reflection.</div>';
    if (!S.defs.length && !S.routines.length) return h + U.empty('Build your routine', 'Create a pre-trade checklist, a post-trade review or a daily routine in the LISTS tab. They are yours to edit.', '<button type="button" class="btn" data-act="ds-tab" data-t="lists">GO TO LISTS</button>');
    S.routines.forEach(function (r) {
      var run = S.rruns.filter(function (x) { return x.defId === r.id && x.date === t; })[0], ans = (run && run.answers) || {}, st = D.runStats(r, ans);
      h += '<div class="panel"><div class="ui-sec" style="margin:0 0 6px"><h2 style="margin:0">' + esc(r.name) + '</h2><span class="ui-badge ' + (st.complete ? 'good' : '') + '">' + st.done + '/' + st.total + '</span></div>' + r.items.map(function (it) { return checkRow(it, ans[it.id] === true, 'data-rt="' + esc(r.id) + '" data-it'); }).join('') + '</div>';
    });
    S.defs.filter(function (d) { return d.listType === 'pre'; }).forEach(function (d) {
      var runsToday = S.runs.filter(function (x) { return x.defId === d.id && x.date === t; }), readyN = runsToday.filter(function (x) { return D.runStats(d, x.answers).ready; }).length, open = S.open === d.id && !S.openTrade;
      h += '<div class="panel"><div class="ui-sec" style="margin:0 0 6px"><h2 style="margin:0">' + esc(d.name) + '</h2><span class="ui-badge">' + U.plural(runsToday.length, 'run') + ' today</span></div>' + (open ? runPanel(d) : '<button type="button" class="btn wide" data-act="ds-run" data-id="' + esc(d.id) + '">RUN BEFORE A TRADE</button>' + (runsToday.length ? '<p class="note">' + readyN + ' of ' + runsToday.length + ' ready today.</p>' : '')) + '</div>';
    });
    var posts = S.defs.filter(function (d) { return d.listType === 'post'; });
    if (posts.length) {
      h += '<div class="panel"><h2>Review today\'s trades</h2>' + (trades.length ? trades.map(function (r) {
        return '<div class="m-row" style="margin-bottom:8px"><div><b>' + esc(r.t.side.toUpperCase() + ' ' + r.t.contracts + ' × ' + r.t.contract) + '</b> <small class="note">' + esc(r.t.time || '') + '</small></div></div>' + posts.map(function (d) {
          var done = S.runs.some(function (x) { return x.defId === d.id && x.tradeId === r.t.id; }), open = S.open === d.id && S.openTrade === r.t.id;
          return open ? runPanel(d, r.t.id) : '<button type="button" class="chip" data-act="ds-run" data-id="' + esc(d.id) + '" data-trade="' + esc(r.t.id) + '">' + (done ? '✓ ' : '') + esc(d.name.toUpperCase()) + '</button>'; }).join(' '); }).join('<hr class="hr">') : '<p class="note" style="margin:0">No trades logged today.</p>') + '</div>';
    }
    return h;
  }
  function runPanel(d, tradeId) {
    var st = D.runStats(d, S.openAns);
    return '<div class="runpanel" aria-live="polite">' + d.items.map(function (it) { return checkRow(it, S.openAns[it.id] === true, 'data-ra'); }).join('') + '<p class="note" id="runStat">' + runStatText(d) + '</p><div class="ui-row"><button type="button" class="btn" data-act="ds-run-save" data-id="' + esc(d.id) + '"' + (tradeId ? ' data-trade="' + esc(tradeId) + '"' : '') + '>SAVE</button><button type="button" class="btn ghost" data-act="ds-run-cancel">CANCEL</button></div></div>';
  }
  function runStatText(d) { var st = D.runStats(d, S.openAns); return st.ready ? (st.complete ? '<b style="color:var(--good)">All done.</b>' : '<b style="color:var(--good)">Ready.</b> ' + (st.total - st.done) + ' optional left.') : '<b style="color:var(--warn-text)">Not ready:</b> ' + (st.requiredTotal - st.requiredDone) + ' required ' + ((st.requiredTotal - st.requiredDone) === 1 ? 'item' : 'items') + ' left.'; }

  /* ---------- plan ---------- */
  function planHtml() {
    var p = S.planDraft || (S.plan ? { name: S.plan.name, markets: S.plan.markets, sessions: S.plan.sessions, setups: S.plan.setups, notes: S.plan.notes, entryRulesText: D.itemsToText(S.plan.entryRules), exitRulesText: D.itemsToText(S.plan.exitRules), dontRulesText: D.itemsToText(S.plan.dontRules), maxTradesPerDay: S.plan.maxTradesPerDay == null ? '' : S.plan.maxTradesPerDay, maxRisk: S.plan.maxRiskCents == null ? '' : (S.plan.maxRiskCents / 100).toString() } : {});
    return '<div class="panel ui-form"><h2>My trading plan</h2><p class="note" style="margin-top:0">Write the rules you want to be held to. They are yours; nothing is assumed. Put each rule on its own line.</p>' +
      field('pl-name', 'Plan name', p.name || '', 'My trading plan') + field('pl-markets', 'Markets / contracts I trade', p.markets || '', 'e.g. NQ and MNQ only') + field('pl-sessions', 'When I trade', p.sessions || '', 'e.g. New York open, first 2 hours') + field('pl-setups', 'Setups I take', p.setups || '', 'e.g. Opening range breakout, VWAP pullback') +
      field('pl-entry', 'Entry rules (one per line)', p.entryRulesText || '', 'Wait for the retest\nStop placed before entry', 'text', 4) + field('pl-exit', 'Exit rules', p.exitRulesText || '', 'Take half at 1R\nTrail behind structure', 'text', 4) + field('pl-dont', 'I will NOT…', p.dontRulesText || '', 'Add to a loser\nTrade after two losses in a row', 'text', 4) +
      '<div class="fgrid"><div>' + field('pl-mt', 'Max trades per day', p.maxTradesPerDay == null ? '' : p.maxTradesPerDay, 'blank = no limit', 'numeric') + '</div><div>' + field('pl-mr', 'Max risk per trade ($)', p.maxRisk || '', 'blank = none', 'decimal') + '</div></div>' + field('pl-notes', 'Notes', p.notes || '', '', 'text', 3) +
      errBox(S.planErr) + '<button type="button" class="btn wide" data-act="ds-plan-save" style="margin-top:12px">SAVE PLAN</button>' + (S.plan ? '<p class="note">Last saved ' + esc(new Date(S.plan.updatedAt).toLocaleString()) + '. Your max trades per day feeds the discipline score.</p>' : '') + '</div>';
  }
  function savePlan() {
    var g = function (id) { return document.getElementById(id).value; }, raw = { name: g('pl-name'), markets: g('pl-markets'), sessions: g('pl-sessions'), setups: g('pl-setups'), notes: g('pl-notes'), entryRulesText: g('pl-entry'), exitRulesText: g('pl-exit'), dontRulesText: g('pl-dont'), maxTradesPerDay: g('pl-mt'), maxRisk: g('pl-mr'), entryRules: S.plan && S.plan.entryRules, exitRules: S.plan && S.plan.exitRules, dontRules: S.plan && S.plan.dontRules };
    S.planDraft = { name: raw.name, markets: raw.markets, sessions: raw.sessions, setups: raw.setups, notes: raw.notes, entryRulesText: raw.entryRulesText, exitRulesText: raw.exitRulesText, dontRulesText: raw.dontRulesText, maxTradesPerDay: raw.maxTradesPerDay, maxRisk: raw.maxRisk };
    var v = D.validatePlan(raw); if (!v.ok) { S.planErr = v.errors; render(); return; } S.planErr = null;
    save(Object.assign({ id: 'plan-main', kind: 'plan', createdAt: S.plan && S.plan.createdAt }, v.plan)).then(function () { S.planDraft = null; return load(); }).then(function () { U.toast('Plan saved.'); render(); }).catch(function () {});
  }

  /* ---------- lists ---------- */
  var LT = { pre: 'Pre-trade checklist', post: 'Post-trade review', routine: 'Routine' };
  function listsHtml() {
    var h = '', all = S.defs.map(function (d) { return { d: d, type: d.listType }; }).concat(S.routines.map(function (d) { return { d: d, type: 'routine' }; }));
    h += '<div class="panel"><h2>Your lists</h2>' + (all.length ? '<ul class="ui-list">' + all.map(function (x) { return '<li style="flex-wrap:wrap"><span><b>' + esc(x.d.name) + '</b> <span class="ui-badge">' + esc(LT[x.type]) + '</span><div class="note" style="margin:2px 0 0">' + U.plural(x.d.items.length, 'item') + '</div></span><span><button type="button" class="btn ghost sm" data-act="ds-list-edit" data-id="' + esc(x.d.id) + '" data-type="' + x.type + '">EDIT</button> <button type="button" class="btn ghost sm" data-act="ds-list-del" data-id="' + esc(x.d.id) + '" data-type="' + x.type + '">DELETE</button></span></li>'; }).join('') + '</ul>' : '<p class="note" style="margin-top:0">No lists yet. Start from a suggestion below (you can change every line) or write your own.</p>') + '</div>';
    var e = S.editList, dr = S.listDraft || (e ? { name: e.name, type: e.type, itemsText: D.itemsToText(e.items) } : { name: '', type: 'pre', itemsText: '' });
    h += '<div class="panel ui-form"><h2>' + (e ? 'Edit list' : 'New list') + '</h2>' + field('ls-name', 'Name', dr.name, 'e.g. Before I enter') + '<label for="ls-type">Type</label><select id="ls-type"' + (e ? ' disabled' : '') + '>' + Object.keys(LT).map(function (k) { return '<option value="' + k + '"' + (dr.type === k ? ' selected' : '') + '>' + LT[k] + '</option>'; }).join('') + '</select>' +
      field('ls-items', 'Items (one per line; start a line with * to make it required)', dr.itemsText, '*I know my stop\nI checked the news', 'text', 6) + errBox(S.msg) +
      '<div class="ui-row" style="margin-top:12px"><button type="button" class="btn" data-act="ds-list-save">' + (e ? 'SAVE CHANGES' : 'ADD LIST') + '</button>' + (e ? '<button type="button" class="btn ghost" data-act="ds-list-cancel">CANCEL</button>' : '') + '</div>' +
      (!e ? '<h3 class="sub">Suggestions</h3><div class="chips">' + Object.keys(STARTERS).map(function (k) { return '<button type="button" class="chip" data-act="ds-starter" data-k="' + k + '">+ ' + esc(LT[k].toUpperCase()) + '</button>'; }).join('') + '</div><p class="note">Suggestions only fill the form above. Nothing is saved until you press ADD LIST.</p>' : '') + '</div>';
    return h;
  }
  function saveList() {
    var name = document.getElementById('ls-name').value, type = document.getElementById('ls-type').value, text = document.getElementById('ls-items').value, e = S.editList;
    S.listDraft = { name: name, type: type, itemsText: text }; var v = D.validateList({ name: name, itemsText: text }, e && e.items); if (!v.ok) { S.msg = v.errors; render(); return; } S.msg = null;
    var doc = e ? Object.assign({}, e, { name: v.name, items: v.items }) : (type === 'routine' ? { kind: 'routine', type: 'def', name: v.name, items: v.items } : { kind: 'checklist', type: 'def', listType: type, name: v.name, items: v.items });
    save(doc).then(function () { S.listDraft = null; S.editList = null; return load(); }).then(function () { U.toast('List saved.'); render(); }).catch(function () {});
  }

  /* ---------- reflect ---------- */
  function reflectHtml() {
    var date = S.refDate || today(), cur = S.refDraft || S.refs.filter(function (r) { return r.date === date; })[0] || {};
    function sc(id, label, v) { return '<label for="' + id + '">' + label + '</label><select id="' + id + '"><option value="">—</option>' + [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (String(v) === String(n) ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>'; }
    return '<div class="panel ui-form"><h2>Daily reflection</h2><label for="rf-date">Date</label><input id="rf-date" type="date" value="' + esc(date) + '" max="' + today() + '">' +
      '<div class="fgrid"><div>' + sc('rf-mood', 'Mood (1–5)', cur.mood) + '</div><div>' + sc('rf-focus', 'Focus (1–5)', cur.focus) + '</div></div>' + sc('rf-plan', 'How well did I follow my plan? (1–5)', cur.planFollowed) +
      field('rf-well', 'What went well?', cur.wentWell || '', '', 'text', 3) + field('rf-struggle', 'Where did I struggle?', cur.struggled || '', '', 'text', 3) + field('rf-lesson', 'One lesson', cur.lesson || '', '', 'text', 2) + field('rf-tom', 'Focus for tomorrow', cur.tomorrow || '', '', 'text', 2) + errBox(S.refErr) +
      '<button type="button" class="btn wide" data-act="ds-ref-save" style="margin-top:12px">SAVE REFLECTION</button></div>' +
      (S.refs.length ? '<div class="panel"><h2>Recent reflections</h2><ul class="ui-list">' + S.refs.slice(0, 10).map(function (r) { return '<li><button type="button" class="linkbtn" data-act="ds-ref-open" data-d="' + esc(r.date) + '">' + esc(r.date) + '</button><span class="note" style="margin:0">' + esc((r.lesson || r.wentWell || r.struggled || '').slice(0, 50)) + (r.planFollowed ? ' · plan ' + r.planFollowed + '/5' : '') + '</span></li>'; }).join('') + '</ul></div>' : '');
  }
  function saveRef() {
    var g = function (id) { return document.getElementById(id).value; }, raw = { date: g('rf-date'), mood: g('rf-mood'), focus: g('rf-focus'), planFollowed: g('rf-plan'), wentWell: g('rf-well'), struggled: g('rf-struggle'), lesson: g('rf-lesson'), tomorrow: g('rf-tom') };
    S.refDraft = raw; S.refDate = raw.date; var v = D.validateReflection(raw); if (!v.ok) { S.refErr = v.errors; render(); return; } S.refErr = null;
    var old = S.refs.filter(function (r) { return r.date === raw.date; })[0];
    save(Object.assign({ id: 'ref-' + raw.date, kind: 'reflection', createdAt: old && old.createdAt }, v.reflection)).then(function () { S.refDraft = null; return load(); }).then(function () { U.toast('Reflection saved.'); render(); }).catch(function () {});
  }

  /* ---------- goals ---------- */
  function goalsHtml() {
    var c = ctx(), t = today(), b = basis(), dr = S.goalDraft || { metric: 'pnl', period: 'month', target: '', title: '' };
    var h = '<div class="panel"><h2>My goals</h2>' + (S.goals.length ? S.goals.map(function (g) {
      var p = D.goalProgress(g, S.rows, c, t, b), M = D.METRICS.filter(function (m) { return m.id === g.metric; })[0], unit = M.unit, fmt = function (v) { return v == null ? '—' : unit === 'money' ? C.fmtMoney(Math.round(v)) : unit === 'pct' ? v.toFixed(1).replace(/\.0$/, '') + '%' : String(Math.round(v * 10) / 10); }, ft = unit === 'money' ? C.fmtMoney(g.target) : unit === 'pct' ? g.target + '%' : String(g.target);
      var cls = p.status === 'met' ? 'good' : p.status === 'missed' ? 'bad' : '', lab = p.status === 'met' ? (M.dir === 'max' ? 'KEPT SO FAR' : 'MET') : p.status === 'missed' ? 'MISSED' : p.status === 'nodata' ? 'NO DATA' : 'IN PROGRESS';
      return '<div class="panel" style="margin:10px 0"><div class="ui-sec" style="margin:0 0 6px"><b>' + esc(g.title) + '</b><span class="ui-badge ' + cls + '">' + lab + '</span></div><div class="note" style="margin:0 0 6px">' + esc(M.label) + ' · ' + (M.dir === 'max' ? 'at most ' : 'at least ') + esc(ft) + ' · this ' + (g.period === '30d' ? 'rolling 30 days' : g.period) + '</div>' +
        (p.pct != null ? U.meter(p.pct, p.status === 'missed' ? 'bad' : p.status === 'met' ? '' : '') + '<div class="note">Now ' + esc(fmt(p.value)) + ' of ' + esc(ft) + '</div>' : '<div class="note">' + esc(p.text || '') + '</div>') + '<button type="button" class="btn ghost sm" data-act="ds-goal-del" data-id="' + esc(g.id) + '">DELETE</button></div>'; }).join('') : '<p class="note" style="margin-top:0">No goals yet. Process goals (rules, trades per day, reflections) usually matter more than profit goals.</p>') + '</div>';
    h += '<div class="panel ui-form"><h2>New goal</h2><label for="gl-metric">What to measure</label><select id="gl-metric">' + D.METRICS.map(function (m) { return '<option value="' + m.id + '"' + (dr.metric === m.id ? ' selected' : '') + '>' + esc(m.label) + '</option>'; }).join('') + '</select>' +
      '<label for="gl-period">Period</label><select id="gl-period">' + [['week', 'This week'], ['month', 'This month'], ['30d', 'Rolling 30 days']].map(function (x) { return '<option value="' + x[0] + '"' + (dr.period === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
      field('gl-target', 'Target (dollars, percent or a number, depending on the goal)', dr.target, 'e.g. 500, 80 or 3', 'decimal') + field('gl-title', 'Name (optional)', dr.title, '') + errBox(S.goalErr) + '<button type="button" class="btn wide" data-act="ds-goal-add" style="margin-top:12px">ADD GOAL</button></div>';
    return h;
  }
  function addGoal() {
    var raw = { metric: document.getElementById('gl-metric').value, period: document.getElementById('gl-period').value, target: document.getElementById('gl-target').value, title: document.getElementById('gl-title').value }; S.goalDraft = raw;
    var v = D.validateGoal(raw); if (!v.ok) { S.goalErr = v.errors; render(); return; } S.goalErr = null;
    save(Object.assign({ kind: 'goal' }, v.goal)).then(function () { S.goalDraft = null; return load(); }).then(function () { U.toast('Goal added.'); render(); }).catch(function () {});
  }

  /* ---------- score ---------- */
  function scoreHtml() {
    var t = today(), c = ctx(), rg = D.periodRange(S.period, t), sc = D.score(S.rows, c, rg), b = D.band(sc.score), wk = D.weekly(S.rows, c, t, 8);
    var h = '<div class="chips">' + [['week', 'THIS WEEK'], ['month', 'THIS MONTH'], ['30d', 'LAST 30 DAYS']].map(function (x) { return '<button type="button" class="chip' + (S.period === x[0] ? ' on' : '') + '" data-act="ds-period" data-p="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="panel" style="text-align:center"><small class="note" style="letter-spacing:.14em">DISCIPLINE SCORE</small><div class="pnl-value" style="font-size:54px;margin:6px 0">' + (sc.score == null ? '—' : sc.score) + '</div>' + (b ? '<span class="ui-badge ' + (sc.score >= 85 ? 'good' : sc.score >= 65 ? '' : sc.score >= 40 ? 'warn' : 'bad') + '">' + b.toUpperCase() + '</span>' : '') +
      '<p class="note">' + (sc.score == null ? esc(sc.note || 'No trades in this period yet.') : 'From ' + sc.used + ' of ' + sc.total + ' habits that could be measured, over ' + U.plural(sc.trades, 'trade') + ' on ' + U.plural(sc.days, 'day') + '. Profit is never part of this score.') + '</p></div>';
    h += '<div class="panel"><h2>What it is made of</h2><ul class="ui-list">' + sc.components.map(function (x) {
      return '<li style="flex-wrap:wrap"><span>' + esc(x.label) + '<div class="note" style="margin:2px 0 0">' + esc(x.help) + '</div></span><b>' + (x.value == null ? '—' : Math.round(x.value * 100) + '%') + '</b>' + (x.value != null ? '<div style="flex-basis:100%">' + U.meter(x.value * 100, x.value < 0.5 ? 'bad' : x.value < 0.8 ? 'warn' : '') + '</div>' : '<div class="note" style="flex-basis:100%;margin:0">Not measured: ' + esc(notMeasured(x.id)) + '</div>') + '</li>'; }).join('') + '</ul><p class="note">The score is the plain average of the habits that could be measured. It is a mirror of your process, not a prediction.</p></div>';
    h += '<div class="panel"><h2>Last 8 weeks</h2>' + (wk.some(function (w) { return w.score != null; }) ? U.barChart({ bars: wk.map(function (w) { return { label: w.from.slice(5), value: w.score, cls: 'pos', tip: w.from + ': ' + (w.score == null ? 'no data' : w.score) }; }), yFormat: function (v) { return String(Math.round(v)); }, alt: 'Weekly discipline score' }) : '<p class="note" style="margin:0">Builds as you log trades.</p>') + '</div>';
    var P = A.prepare(S.rows, { from: rg.from, to: rg.to }, basis()), mc = D.mistakeCosts(P.inc);
    h += '<div class="panel"><h2>Mistake analysis</h2>' + (mc.rows.length ? '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Mistake</th><th>Trades</th><th>P&amp;L</th><th>Avg</th></tr></thead><tbody>' + mc.rows.map(function (r) { return '<tr><td style="text-align:left">' + esc(r.label) + '</td><td>' + r.n + '</td><td class="' + U.cls(r.totalCents) + '">' + C.fmtMoney(r.totalCents, true) + '</td><td class="' + U.cls(r.expectancyCents) + '">' + C.fmtMoney(Math.round(r.expectancyCents), true) + '</td></tr>'; }).join('') + (mc.without ? '<tr><td style="text-align:left"><i>No mistake recorded</i></td><td>' + mc.without.n + '</td><td class="' + U.cls(mc.without.totalCents) + '">' + C.fmtMoney(mc.without.totalCents, true) + '</td><td class="' + U.cls(mc.without.expectancyCents) + '">' + C.fmtMoney(Math.round(mc.without.expectancyCents), true) + '</td></tr>' : '') + '</tbody></table></div><p class="note">A trade with two mistake tags appears in both rows. This shows association in your own trades, not proof of cause, and small counts are noisy.</p>' : '<p class="note" style="margin:0">Tag mistakes on your trades (Journal) and they are summarised here with what they cost.</p>') + '</div>';
    return h;
  }
  function notMeasured(id) { return { rules: 'no trade has "followed rules" answered', stops: 'no trades in this period', size: 'needs 3 or more trades with stops', limit: 'set max trades per day in your plan', journal: 'no trades in this period', pre: 'create a pre-trade checklist (LISTS tab)', reflect: 'starts counting once you save a reflection' }[id] || ''; }

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; } if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var body = S.tab === 'plan' ? planHtml() : S.tab === 'lists' ? listsHtml() : S.tab === 'reflect' ? reflectHtml() : S.tab === 'goals' ? goalsHtml() : S.tab === 'score' ? scoreHtml() : todayHtml();
    var y = window.scrollY; root.innerHTML = '<div class="chips jtabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" class="chip' + (S.tab === t[0] ? ' on' : '') + '" data-act="ds-tab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' + body; window.scrollTo(0, y);
  }
  function findList(id, type) { return (type === 'routine' ? S.routines : S.defs).filter(function (x) { return x.id === id; })[0]; }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (a === 'ds-tab') { S.tab = b.getAttribute('data-t'); S.open = null; render(); window.scrollTo(0, 0); }
    else if (a === 'ds-run') { S.open = id; S.openTrade = b.getAttribute('data-trade') || null; S.openAns = {}; render(); }
    else if (a === 'ds-run-cancel') { S.open = null; S.openTrade = null; render(); }
    else if (a === 'ds-run-save') { var d = findList(id, 'pre'), tid = b.getAttribute('data-trade') || ''; if (!d) return; var ans = D.cleanAnswers(d, S.openAns); save({ kind: 'checklist', type: 'run', defId: d.id, date: today(), time: nowHM(), answers: ans, tradeId: tid }).then(function () { S.open = null; S.openTrade = null; return load(); }).then(function () { U.toast('Saved.'); render(); }).catch(function () {}); }
    else if (a === 'ds-plan-save') savePlan();
    else if (a === 'ds-starter') { S.listDraft = Object.assign({}, STARTERS[b.getAttribute('data-k')]); S.editList = null; render(); }
    else if (a === 'ds-list-save') saveList();
    else if (a === 'ds-list-cancel') { S.editList = null; S.listDraft = null; S.msg = null; render(); }
    else if (a === 'ds-list-edit') { var t = b.getAttribute('data-type'), l = findList(id, t); if (l) { S.editList = Object.assign({ type: t }, l); S.listDraft = null; render(); window.scrollTo(0, document.body.scrollHeight); } }
    else if (a === 'ds-list-del') { var tt = b.getAttribute('data-type'); U.confirm('Delete this list?', 'Past runs are kept in your backups but no longer shown.', 'DELETE', true).then(function (y) { if (y) ST.remove(id, tt === 'routine' ? 'routine' : 'checklist').then(load).then(function () { U.toast('List deleted.'); render(); }); }); }
    else if (a === 'ds-ref-save') saveRef();
    else if (a === 'ds-ref-open') { S.refDate = b.getAttribute('data-d'); S.refDraft = null; render(); window.scrollTo(0, 0); }
    else if (a === 'ds-goal-add') addGoal();
    else if (a === 'ds-goal-del') U.confirm('Delete this goal?', '', 'DELETE', true).then(function (y) { if (y) ST.remove(id, 'goal').then(load).then(function () { render(); }); });
    else if (a === 'ds-period') { S.period = b.getAttribute('data-p'); render(); }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-ra') !== null) { var d = findList(S.open, 'pre'); if (!d) return; S.openAns[t.getAttribute('data-ra')] = t.checked; var st = document.getElementById('runStat'); if (st) st.innerHTML = runStatText(d); return; }
    if (t.getAttribute('data-rt') !== null) {
      var rid = t.getAttribute('data-rt'), it = t.getAttribute('data-it'), r = findList(rid, 'routine'); if (!r) return; var td = today(), run = S.rruns.filter(function (x) { return x.defId === rid && x.date === td; })[0], ans = Object.assign({}, run && run.answers); if (t.checked) ans[it] = true; else delete ans[it];
      save({ id: 'rr-' + rid + '-' + td, kind: 'routine', type: 'run', defId: rid, date: td, answers: D.cleanAnswers(r, ans), createdAt: run && run.createdAt }).then(load).then(render).catch(function () { render(); }); return;
    }
    if (t.id === 'rf-date') { S.refDate = t.value; S.refDraft = null; S.refErr = null; render(); }
  });
  function refresh() { return load().then(render); }
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'discipline') refresh(); });
  window.addEventListener('tt:journal-changed', function () { if (S.loaded && document.getElementById('view-discipline').classList.contains('active')) refresh(); });
  if (window.TTNav) window.TTNav.addHub({ id: 'discipline', title: 'Discipline', text: 'Plan, checklists, routines, reflections, goals and your discipline score.', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>' });
  window.TTDisciplineUI = { state: S, reload: refresh };
})();
