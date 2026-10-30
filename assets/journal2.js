/* Tamhas Trading - Journal v2 screens: Review (day/week/month summaries + reflections), Setup (custom fields, labels, templates,
   saved filters) and trade comparison. Plugs into the journal through TTJournalExt. All numbers come from the trades you entered. */
(function () {
  'use strict';
  var EXT = window.TTJournalExt, J2 = window.TTJournal2Core, C = window.TTJournalCore, U = window.TTUI, ST = window.TTStore;
  if (!EXT || !J2 || !U || !ST) return;
  var esc = U.esc, DASH = '—';
  var R = { kind: 'week', key: null, doc: null, docKey: null, busy: false, saved: [] };
  var LAB = [['tags', 'Tags'], ['emotions', 'Emotions'], ['mistakeTags', 'Mistake tags']];

  function m(c, plus) { return c == null ? DASH : C.fmtMoney(c, plus); }
  function fmtRange(p) { var f = EXT.ctx.fmtDate; return p.kind === 'day' ? f(p.from) : p.kind === 'month' ? new Date(p.from + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : f(p.from) + ' – ' + f(p.to); }
  function period() { if (!R.key) R.key = J2.periodOf(R.kind, EXT.ctx.todayKey()).key; var d = R.kind === 'month' ? R.key + '-01' : R.key; return J2.periodOf(R.kind, d); }
  function docId(p) { return 'rev-' + p.kind + '-' + p.key; }
  function loadReview() {
    var p = period(), id = docId(p); R.docKey = id;
    return ST.get(id).then(function (d) { if (R.docKey === id) R.doc = d || null; return ST.list('review'); }).then(function (l) { R.saved = l.sort(function (a, b) { return b.pkey < a.pkey ? -1 : 1; }); });
  }

  /* ---------- Review ---------- */
  function listBars(items, cls) {
    if (!items.length) return '<p class="note" style="margin:0">None recorded in this period.</p>';
    var max = items[0].n;
    return '<ul class="ui-list">' + items.slice(0, 6).map(function (x) { return '<li><span>' + esc(x.label) + '</span><span class="lb-bar"><i class="' + cls + '" style="width:' + Math.max(6, Math.round(x.n / max * 100)) + '%"></i></span><b>' + x.n + '</b></li>'; }).join('') + '</ul>';
  }
  function reviewHtml(ctx) {
    var p = period(), basis = ctx.effBasis(), st = J2.reviewStats(ctx.rows(), p, basis), d = R.doc || {};
    var h = '<div class="panel"><div class="seg" role="radiogroup" aria-label="Review period">' + J2.KINDS.map(function (k) {
      return '<label class="seg-i"><input type="radio" name="rv-kind" value="' + k + '"' + (R.kind === k ? ' checked' : '') + '><span>' + k.toUpperCase() + '</span></label>'; }).join('') + '</div>' +
      '<div class="rv-nav"><button type="button" class="chip" data-act="rv-prev" aria-label="Previous period">‹</button><b>' + esc(fmtRange(p)) + '</b><button type="button" class="chip" data-act="rv-next" aria-label="Next period">›</button><button type="button" class="chip" data-act="rv-now">NOW</button></div></div>';
    if (!st.trades) return h + U.empty('No trades in this period', 'Pick another period, or log trades to see a summary. You can still write a reflection below.') + reflectionHtml(p, d);
    h += '<div class="ui-grid g3">' + U.stat('P&L (' + basis + ')', m(st.totalCents, true), st.counted + ' counted trades', st.totalCents > 0 ? 'pos' : st.totalCents < 0 ? 'neg' : '', basis === 'net' ? 'After fees. Only closed trades with fees entered count.' : 'Before fees. Every closed trade counts.') +
      U.stat('Win rate', st.winRate == null ? DASH : U.fmtPct(st.winRate), st.wins + 'W · ' + st.losses + 'L' + (st.breakeven ? ' · ' + st.breakeven + 'BE' : '')) +
      U.stat('Average R', st.avgR == null ? DASH : ctx.fmtR(st.avgR), st.rCount ? st.rCount + ' trades with a stop' : 'needs stops entered') +
      U.stat('Trades', String(st.trades), st.openOrPartial ? st.openOrPartial + ' open or partial (not counted)' : U.plural(st.tradingDays, 'trading day')) +
      U.stat('Followed rules', (st.rules.yes + st.rules.no) ? st.rules.yes + ' / ' + (st.rules.yes + st.rules.no) : DASH, st.rules.unknown ? st.rules.unknown + ' not recorded' : 'of recorded trades') +
      U.stat('Average grade', st.avgGrade == null ? DASH : gradeLabel(st.avgGrade), st.gradedCount ? st.gradedCount + ' graded' : 'no grades yet') + '</div>';
    if (st.excludedNoFees) h += '<div class="ui-banner warn">' + U.plural(st.excludedNoFees, 'closed trade') + ' left out of net P&amp;L because fees were not entered. Switch to gross in Analytics, or add the fees.</div>';
    if (st.avgWinCents != null || st.avgLossCents != null) h += '<p class="note">Average winner ' + m(st.avgWinCents, true) + ' · average loser ' + m(st.avgLossCents, true) + (st.bestDay ? ' · best day ' + esc(ctx.fmtDate(st.bestDay.date)) + ' ' + m(st.bestDay.cents, true) + ' · worst day ' + esc(ctx.fmtDate(st.worstDay.date)) + ' ' + m(st.worstDay.cents, true) : '') + '</p>';
    if (st.days.length > 1) h += '<div class="panel"><h2>Daily P&amp;L</h2>' + U.barChart({ bars: st.days.map(function (x) { return { label: x.date.slice(5), value: x.cents }; }), yFormat: function (v) { return U.fmtMoneyShort(v); }, alt: 'Daily profit and loss for the period' }) + '</div>';
    h += '<div class="panel"><h2>Mistakes</h2>' + listBars(st.mistakes, 'bad') + '</div><div class="panel"><h2>Emotions</h2>' + listBars(st.emotions, '') + '</div>' + (st.tags.length ? '<div class="panel"><h2>Tags</h2>' + listBars(st.tags, '') + '</div>' : '');
    return h + reflectionHtml(p, d);
  }
  function gradeLabel(x) { var g = ['F', 'D', 'C', 'B', 'A']; return g[Math.round(x)] + ' <small>(' + x.toFixed(1) + '/4)</small>'; }
  function reflectionHtml(p, d) {
    function ta(id, label, ph) { return '<label for="' + id + '">' + label + '</label><textarea id="' + id + '" rows="3" maxlength="1500" placeholder="' + ph + '">' + esc(d[id.slice(3)] || '') + '</textarea>'; }
    return '<div class="panel"><h2>Your ' + p.kind + ' review</h2>' + ta('rv-went', 'What went well?', 'Rules you kept, good decisions…') + ta('rv-improve', 'What needs work?', 'Patterns you want to change…') + ta('rv-focus', 'Focus for the next ' + p.kind, 'One or two specific things') +
      '<button type="button" class="btn wide" data-act="rv-save" style="margin-top:12px">SAVE REVIEW</button>' + (d.updatedAt ? '<p class="note">Last saved ' + esc(new Date(d.updatedAt).toLocaleString()) + '.</p>' : '') + '</div>' +
      (R.saved.length ? '<div class="panel"><h2>Saved reviews</h2><ul class="ui-list">' + R.saved.slice(0, 12).map(function (x) { return '<li><button type="button" class="linkbtn" data-act="rv-open" data-k="' + esc(x.pkind) + '" data-v="' + esc(x.pkey) + '">' + esc(x.pkind.toUpperCase() + ' · ' + x.pkey) + '</button><span class="note" style="margin:0">' + esc((x.went || x.improve || x.focus || '').slice(0, 50)) + '</span></li>'; }).join('') + '</ul></div>' : '');
  }
  function saveReview() {
    var p = period(), g = function (id) { var e = document.getElementById(id); return e ? e.value.trim().slice(0, 1500) : ''; };
    var doc = { id: docId(p), kind: 'review', type: 'journal', pkind: p.kind, pkey: p.key, went: g('rv-went'), improve: g('rv-improve'), focus: g('rv-focus'), createdAt: R.doc && R.doc.createdAt };
    if (!doc.createdAt) delete doc.createdAt;
    ST.save(doc).then(function (d) { R.doc = d; return loadReview(); }).then(function () { EXT.ctx.toast('Review saved.'); EXT.ctx.render(); }).catch(function () { EXT.ctx.toast('Could not save the review.', true); });
  }

  /* ---------- Setup ---------- */
  function setupHtml(ctx) {
    var S = ctx.state, h = '';
    h += '<div class="panel"><h2>Custom fields</h2><p class="note" style="margin-top:0">Extra things to record on every trade, such as market bias or news day. They appear in the trade form. Removing a field never deletes values already saved on trades.</p>' +
      (S.fields.length ? '<ul class="ui-list">' + S.fields.map(function (f) { return '<li><span><b>' + esc(f.label) + '</b> <span class="ui-badge">' + esc(f.type) + '</span>' + (f.type === 'choice' ? '<div class="note" style="margin:2px 0 0">' + esc(f.choices.join(', ')) + '</div>' : '') + '</span><button type="button" class="btn ghost sm" data-act="cf-del" data-id="' + esc(f.id) + '">REMOVE</button></li>'; }).join('') + '</ul>' : '<p class="note">No custom fields yet.</p>') +
      '<button type="button" class="chip" data-act="cf-add">+ ADD A FIELD</button></div>';
    h += '<div class="panel"><h2>Tags, emotions and mistake tags</h2><p class="note" style="margin-top:0">Rename a label to fix a typo, or rename it to an existing label to merge them. This updates every trade that uses it.</p>';
    var any = false;
    LAB.forEach(function (l) {
      var items = J2.countLabels(ctx.rows(), l[0]); if (!items.length) return; any = true;
      h += '<h3 class="sub">' + l[1] + '</h3><ul class="ui-list">' + items.map(function (x) { return '<li><span>' + esc(x.label) + ' <small class="note">' + U.plural(x.n, 'trade') + '</small></span><span><button type="button" class="btn ghost sm" data-act="lab-ren" data-f="' + l[0] + '" data-v="' + esc(x.label) + '">RENAME</button> <button type="button" class="btn ghost sm" data-act="lab-del" data-f="' + l[0] + '" data-v="' + esc(x.label) + '">REMOVE</button></span></li>'; }).join('') + '</ul>';
    });
    if (!any) h += '<p class="note">Labels you add to trades will be listed here.</p>';
    h += '</div>';
    h += '<div class="panel"><h2>Trade templates</h2>' + (S.templates.length ? '<ul class="ui-list">' + S.templates.map(function (t) { return '<li><span><b>' + esc(t.name) + '</b><div class="note" style="margin:2px 0 0">' + esc(Object.keys(t.data || {}).join(', ') || 'empty') + '</div></span><button type="button" class="btn ghost sm" data-act="tpl-del" data-id="' + esc(t.id) + '">DELETE</button></li>'; }).join('') + '</ul>' : '<p class="note" style="margin-top:0">None yet. Fill in a New trade form and use SAVE AS TEMPLATE.</p>') + '</div>';
    h += '<div class="panel"><h2>Saved filters</h2>' + (S.saved.length ? '<ul class="ui-list">' + S.saved.map(function (f) { return '<li><span><b>' + esc(f.name) + '</b><div class="note" style="margin:2px 0 0">' + esc(Object.keys(f.filter || {}).join(', ')) + '</div></span><button type="button" class="btn ghost sm" data-act="sf-del" data-id="' + esc(f.id) + '">DELETE</button></li>'; }).join('') + '</ul>' : '<p class="note" style="margin-top:0">None yet. Set filters on the Entries tab and press SAVE THESE.</p>') + '</div>';
    return h;
  }
  function addField() {
    var S = EXT.ctx.state;
    U.dialog({ title: 'New custom field', ok: 'ADD', fields: [{ name: 'label', label: 'Name', max: 40, placeholder: 'e.g. Market bias' },
      { name: 'type', label: 'Type', type: 'select', options: [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'choice', label: 'Pick one from a list' }, { value: 'yesno', label: 'Yes / No' }] },
      { name: 'choices', label: 'Options (only for a list)', max: 300, placeholder: 'Bull, Bear, Neutral', hint: 'Separate with commas.' }],
      validate: function (v) { var r = J2.validateFieldDef(v, S.fields); return r.ok ? null : r.errors[0]; } }).then(function (v) {
      if (!v) return; var r = J2.validateFieldDef(v, S.fields);
      return ST.save({ kind: 'field', type: r.def.type, label: r.def.label, choices: r.def.choices }).then(function () { return EXT.ctx.loadDocs(); }).then(function () { EXT.ctx.toast('Field added.'); EXT.ctx.render(); });
    }).catch(function () { EXT.ctx.toast('Could not add the field.', true); });
  }
  function relabel(field, from, to) {
    var res = J2.renameLabel(EXT.ctx.state.trades, field, from, to);
    return EXT.ctx.updateTrades(res.trades).then(function (ok) { if (!ok) { EXT.ctx.toast('Could not save (browser storage blocked). Nothing was changed.', true); return; } EXT.ctx.toast(U.plural(res.changed, 'trade') + ' updated' + (res.failed.length ? ', ' + res.failed.length + ' could not be changed' : '') + '.', res.failed.length > 0); EXT.ctx.render(); });
  }
  function removeDoc(id, kind, msg) { return ST.remove(id, kind).then(function () { return EXT.ctx.loadDocs(); }).then(function () { EXT.ctx.toast(msg); EXT.ctx.render(); }).catch(function () { EXT.ctx.toast('Could not delete.', true); }); }

  /* ---------- Compare ---------- */
  function compareHtml(ctx) {
    var S = ctx.state, ids = S.compare || [], rows = ctx.rows(), picked = ids.map(function (id) { return rows.filter(function (r) { return r.t.id === id; })[0]; }).filter(Boolean);
    var back = '<div class="ui-sec"><h2>Compare trades</h2><button type="button" class="btn ghost sm" data-act="cmp-back">‹ BACK TO ENTRIES</button></div>';
    if (picked.length < 2) return back + U.empty('Pick 2 to 4 trades', 'Use SELECT on the Entries tab, tick the trades, then COMPARE.');
    var cols = J2.compare(picked);
    function row(label, fn) { return '<tr><th scope="row">' + label + '</th>' + cols.map(function (c) { var v = fn(c); return '<td' + (v && v.cls ? ' class="' + v.cls + '"' : '') + '>' + (v && v.html != null ? v.html : v == null ? DASH : esc(v)) + '</td>'; }).join('') + '</tr>'; }
    var pnl = function (k) { return function (c) { return c[k] == null ? null : { html: esc(m(c[k], true)), cls: ctx.clsOf(c[k]) }; }; };
    return back + '<div class="panel"><div class="ui-table-wrap"><table class="ui-table cmp"><thead><tr><th></th>' + cols.map(function (c) { return '<th><button type="button" class="linkbtn" data-act="cmp-open" data-id="' + esc(c.id) + '">' + esc(ctx.fmtDate(c.date)) + '</button></th>'; }).join('') + '</tr></thead><tbody>' +
      row('Contract', function (c) { return c.side.toUpperCase() + ' ' + c.contracts + ' × ' + c.contract; }) + row('Entry (avg)', function (c) { return c.entryAvg + (c.fills > 1 ? ' (' + c.fills + ' fills)' : ''); }) + row('Stop', function (c) { return c.stop; }) + row('Exit (avg)', function (c) { return c.avgExit; }) + row('Status', function (c) { return c.status; }) +
      row('Gross P&L', pnl('grossCents')) + row('Fees', function (c) { return c.feesCents == null ? 'not entered' : m(c.feesCents); }) + row('Net P&L', pnl('netCents')) + row('Risk at stop', function (c) { return c.riskCents == null ? null : m(c.riskCents); }) + row('Realized R', function (c) { return c.r == null ? null : ctx.fmtR(c.r); }) +
      row('Strategy', function (c) { return c.strategy; }) + row('Session', function (c) { return c.session; }) + row('Grade', function (c) { return c.grade; }) + row('Followed rules', function (c) { return c.followedRules === true ? 'Yes' : c.followedRules === false ? 'No' : null; }) +
      row('Tags', function (c) { return c.tags.join(', ') || null; }) + row('Emotions', function (c) { return c.emotions.join(', ') || null; }) + row('Mistakes', function (c) { return c.mistakeTags.join(', ') || null; }) + '</tbody></table></div></div>';
  }

  /* ---------- events ---------- */
  function bind(el) {
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act'), ctx = EXT.ctx, S = ctx.state;
      switch (a) {
        case 'rv-prev': case 'rv-next': R.key = J2.shiftPeriod(period(), a === 'rv-next' ? 1 : -1).key; R.doc = null; loadReview().then(ctx.render); break;
        case 'rv-now': R.key = null; R.doc = null; loadReview().then(ctx.render); break;
        case 'rv-save': saveReview(); break;
        case 'rv-open': R.kind = b.getAttribute('data-k'); R.key = b.getAttribute('data-v'); R.doc = null; loadReview().then(ctx.render); window.scrollTo(0, 0); break;
        case 'cf-add': addField(); break;
        case 'cf-del': U.confirm('Remove this field?', 'It disappears from the trade form. Values already saved on trades are kept in your data and backups.', 'REMOVE', true).then(function (y) { if (y) removeDoc(b.getAttribute('data-id'), 'field', 'Field removed.'); }); break;
        case 'tpl-del': U.confirm('Delete this template?', 'Trades created from it are not affected.', 'DELETE', true).then(function (y) { if (y) removeDoc(b.getAttribute('data-id'), 'template', 'Template deleted.'); }); break;
        case 'sf-del': U.confirm('Delete this saved filter?', '', 'DELETE', true).then(function (y) { if (y) removeDoc(b.getAttribute('data-id'), 'filter', 'Saved filter deleted.'); }); break;
        case 'lab-ren': (function () { var f = b.getAttribute('data-f'), v = b.getAttribute('data-v'); U.dialog({ title: 'Rename "' + v + '"', body: 'Use an existing label\'s name to merge them.', ok: 'RENAME', fields: [{ name: 'to', label: 'New name', value: v, max: 30 }], validate: function (x) { return C.cleanLabels([x.to], 1).length ? null : 'Type a name.'; } }).then(function (x) { if (x) relabel(f, v, C.cleanLabels([x.to], 1)[0]); }); })(); break;
        case 'lab-del': (function () { var f = b.getAttribute('data-f'), v = b.getAttribute('data-v'); U.confirm('Remove "' + v + '" from all trades?', 'The label is taken off every trade that has it. The trades themselves are kept.', 'REMOVE', true).then(function (y) { if (y) relabel(f, v, ''); }); })(); break;
        case 'cmp-back': ctx.go('entries'); break;
        case 'cmp-open': ctx.openTrade(b.getAttribute('data-id')); break;
      }
    });
    el.addEventListener('change', function (ev) { var t = ev.target; if (t.name === 'rv-kind') { R.kind = t.value; R.key = null; R.doc = null; loadReview().then(EXT.ctx.render); } });
  }
  var host = document.querySelector('#view-journal');
  if (host) bind(host);

  EXT.tabs.push({ id: 'review', label: 'REVIEW', html: reviewHtml, after: function () { if (R.docKey !== docId(period())) loadReview().then(EXT.ctx.render); } });
  EXT.tabs.push({ id: 'setup', label: 'SETUP', html: setupHtml });
  EXT.tabs.push({ id: 'compare', label: 'COMPARE', hidden: true, html: compareHtml });
  loadReview().catch(function () {}).then(function () { if (EXT.ctx && EXT.ctx.state.loaded && !EXT.ctx.state.editing) EXT.ctx.render(); });
})();
