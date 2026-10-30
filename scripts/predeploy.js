#!/usr/bin/env node
/* Pre-deploy gate. Runs the static checks and then EVERY unit and browser suite. Prints SAFE TO DEPLOY or DO NOT DEPLOY and exits non-zero on any failure.
   Usage: node scripts/predeploy.js          (everything)       node scripts/predeploy.js --quick   (static + pure-logic suites only, no browser) */
'use strict';
const cp = require('child_process'), path = require('path'); const root = path.join(__dirname, '..'); const quick = process.argv.includes('--quick');
function run(label, args) { process.stdout.write('\n== ' + label + ' ==\n'); const r = cp.spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env }); return r.status === 0; }
const steps = [['Static checks (references, offline cache, security, documents)', [path.join('tests', 'static.js')]], ['Test suites (' + (quick ? 'pure logic' : 'logic + browser') + ')', [path.join('tests', 'run.js')].concat(quick ? ['core'] : [])]];
let bad = 0; const t0 = Date.now(); for (const [l, a] of steps) if (!run(l, a)) bad++;
const secs = Math.round((Date.now() - t0) / 1000);
if (bad) { console.log('\n########  DO NOT DEPLOY  ########\n' + bad + ' check group(s) failed after ' + secs + 's. Fix them, or follow ROLLBACK.md if already deployed.'); process.exit(1); }
console.log('\n########  SAFE TO DEPLOY  ########\nAll automated checks passed in ' + secs + 's' + (quick ? ' (quick mode: browser suites skipped - run without --quick before merging).' : '.') + '\nReminder: real iPhone / installed-app / screen-reader checks are manual (see RELEASE-CHECKLIST.md).');
