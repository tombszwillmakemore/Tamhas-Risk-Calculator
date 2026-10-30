/* Playwright wrapper for the test suites: marks the welcome screen as already seen so older suites are not blocked by it.
   The welcome experience itself is tested in x1e2e.js, which uses the real `playwright` module directly. */
const pw = require('playwright');
const init = () => { try { if (!localStorage.getItem('tt.profile.v1')) localStorage.setItem('tt.profile.v1', JSON.stringify({ onboarded: true, tourSeen: true })); } catch (e) { /* storage blocked */ } };
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (o) => { const b = await launch(o); const nc = b.newContext.bind(b), np = b.newPage.bind(b);
  b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(init); return c; };
  b.newPage = async (...a) => { const p = await np(...a); await p.context().addInitScript(init); return p; }; return b; };
module.exports = pw;
