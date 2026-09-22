// End-to-end: the built extension, the Acme Careers page, and the side panel driven as an
// ordinary page pointed at the test tab (spec §8). Covers SCAN -> TRANSLATE -> ACT -> VERIFY.
// Not covered here, by design: sidePanel.open(), focus moving into the panel, and anything
// a screen reader hears. Those are manual (probe/screen-reader-testing.md).

import { chromium } from 'playwright';
import { buildReport, reportMarkdown } from '../lib/report.ts';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../.output/chrome-mv3');
const FIXTURES = path.join(here, 'fixtures/acme');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// One listener, reached as localhost (in host_permissions) and as 127.0.0.1 (not).
const server = createServer((q, s) => {
  const rel = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/\/$/, '/index.html');
  const file = path.join(FIXTURES, rel);
  if (!file.startsWith(FIXTURES) || !existsSync(file)) { s.writeHead(404); s.end('not found'); return; }
  s.writeHead(200, { 'content-type': 'text/html' });
  s.end(readFileSync(file));
});
await new Promise((r) => server.listen(8765, r));

// TEST STUB of the label-inference proxy (proxy/main.py). It stands in for the real one so
// the suite never calls a model. It records what the panel sends and names every field
// "Preferred office". It is started part-way through, to cover "proxy not running" first.
const proxyRequests = [];
let proxyMode = 'ok'; // 'ok' | '502' | 'garbage' | 'wrong-shape'
const proxyStub = createServer((q, s) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (q.method === 'OPTIONS') { s.writeHead(204, cors); s.end(); return; }
  let body = '';
  q.on('data', (c) => { body += c; });
  q.on('end', () => {
    const { fields } = JSON.parse(body);
    proxyRequests.push(fields);
    if (proxyMode === '502') { s.writeHead(502, cors); s.end('{"detail":"model returned empty content"}'); return; }
    s.writeHead(200, { ...cors, 'content-type': 'application/json' });
    if (proxyMode === 'garbage') { s.end('<html>not json</html>'); return; }
    if (proxyMode === 'wrong-shape') { s.end(JSON.stringify({ labels: 'nope' })); return; }
    // Named after what was asked, so a name that reaches the wrong question is recognisable.
    const nameFor = (f) => (f.options?.includes('Hanoi') ? 'Preferred office' : 'Expected salary');
    s.end(JSON.stringify({ labels: fields.map((f) => ({ id: f.id, label: nameFor(f), confidence: 0.9 })) }));
  });
});

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

/** A fixture page plus a side panel pointed at it. The panel runs as an ordinary tab (§8). */
async function open(pathname) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:8765/${pathname}`);
  // The LAST matching tab: sections never close their pages, so a second visit to the
  // same fixture URL must not bind the new panel to an earlier section's stale tab.
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).filter((t) => t.url === u).at(-1)?.id, page.url());
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });
  return { page, panel, tabId };
}
/** Waits until either live region says something matching `re`; returns that region's text. */
async function spoken(panel, re) {
  const hit = await panel.waitForFunction((src) => {
    const r = new RegExp(src, 'i');
    return ['live-now', 'live'].map((id) => document.getElementById(id).textContent).find((t) => r.test(t)) || false;
  }, re.source, { timeout: 10000 });
  return hit.jsonValue();
}
/**
 * The barrier report for a tab, built from the session the panel stored.
 *
 * The panel no longer has an export button — an automated send to the employer replaces it
 * — so the report is built here from the same `buildReport()` the panel used. The report
 * itself is unchanged, which is the point: these checks still describe §6.7's contract.
 */
async function reportFor(tabId) {
  const stored = await sw.evaluate(() => chrome.storage.session.get(null));
  const key = Object.keys(stored).find((k) => k.startsWith(`session:${tabId}:`));
  if (!key) throw new Error(`no session stored for tab ${tabId}`);
  return buildReport(stored[key]);
}


/** Everything the panel currently holds in both regions, for a detail or a "nothing was said". */
const heard = (panel) => panel.evaluate(() => ['live-now', 'live'].map((id) => document.getElementById(id).textContent).filter(Boolean).join(' | '));
/** Which region holds a sentence: 'reply' (assertive, interrupts: the answer to the user's own
 *  command) or 'news' (polite, waits: what the page did). Null when neither says it. */
const regionOf = (panel, re) => panel.evaluate((src) => {
  const r = new RegExp(src, 'i');
  if (r.test(document.getElementById('live-now').textContent)) return 'reply';
  if (r.test(document.getElementById('live').textContent)) return 'news';
  return null;
}, re.source);
/** Alt+Shift+S cannot be pressed headlessly. This is the message the service worker sends for it. */
const pressForward = (tabId) => sw.evaluate((id) => chrome.runtime.sendMessage({ type: 'bridge/command-forward', tabId: id }), tabId);
const pageFocus = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName);

/** One failure must not hide every later result: a section that throws is one FAIL. */
async function section(name, fn) {
  try { await fn(); } catch (e) { check(`${name}: ran to completion`, false, String(e).split('\n').slice(0, 3).join(' ')); }
}
/** For waits that ARE the assertion: a timeout is a FAIL, not a crash. */
const arrives = (promise) => promise.then(() => true, () => false);

try {
  await section('single page', async () => {
  // apply.html is the applicant demo page. index.html belongs to the employer demo: one form
  // in three versions (?v=2, ?v=3), which the dashboard fixtures were exported from.
  const { page, panel, tabId } = await open('apply.html');
  check('found the test tab', typeof tabId === 'number', `tabId=${tabId}`);

  // --- label inference, proxy not running (§6.4 failure path) --------------------------
  const down = await spoken(panel, /Label inference is unavailable/);
  // Heard by hand with VoiceOver: "TypeError: Failed to fetch" is noise to an applicant.
  check('proxy down: the raw exception goes to Diagnostics, not into the spoken sentence',
    !/TypeError/.test(down) && /TypeError/.test(await panel.textContent('#diag')), `${down} | diag: ${(await panel.textContent('#diag')).slice(-160)}`);
  check('proxy down: said once, in plain words, and the question keeps a usable name',
    /so 2 questions have no name/.test(down) && (await panel.locator('#questions').textContent()).includes('Unlabelled text (label inferred)'), down);

  // --- on load, before the panel is opened (§4, built-in tier) ------------------------
  await page.waitForFunction(() => document.getElementById('bridge-announcement')?.textContent, null, { timeout: 5000 });
  const onLoad = await page.textContent('#bridge-announcement');
  check('the page itself announces the barrier count on load', /^BRIDGE found \d+ accessibility barriers on this form\. Press Alt\+Shift\+B/.test(onLoad), onLoad);

  // --- one question at a time is the default (§4.2) -----------------------------------
  check('one-question mode: exactly one question is shown', await panel.locator('#questions .q:visible').count() === 1);
  check('one-question mode: it says where you are', (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 1 of 13');
  await panel.getByRole('button', { name: 'Next question' }).click();
  check('one-question mode: Next shows the second question and focuses its control',
    (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 2 of 13' &&
    await panel.evaluate(() => document.activeElement?.closest('.q')?.querySelector('h3')?.textContent) === 'Question 2 of 13');
  await panel.getByRole('button', { name: 'Previous question' }).click();
  await panel.getByLabel('Full name').fill('Z. Wei');
  await panel.getByRole('button', { name: 'Write Full name to page' }).click();
  await spoken(panel, /Full name: Z\. Wei\. Confirmed on the page\. Press Next question for Phone/);
  check('one-question mode: a confirmed answer stays put, so the confirmation is heard before anything new',
    (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 1 of 13' &&
    await panel.evaluate(() => document.activeElement?.textContent) === 'Write Full name to page');

  // Most of this run answers questions out of order, so it uses the full list. The
  // default, one question at a time, has its own section below.
  await panel.getByLabel('Full list').check();

  // --- SCAN -------------------------------------------------------------------------
  const summary = await panel.textContent('#summary');
  check('SCAN finds 13 questions: 12 in the page, 1 in the same-origin iframe', /^13 questions found/.test(summary), summary);
  // Barriers are detected exactly as before but never rendered in the panel: the applicant
  // hears only the count in the summary; the sentences below exist only in the exported
  // report, which is where the detection checks now read them.
  check('the panel renders no barrier text', !/Blocking:|Usability:/.test(await panel.textContent('main')), await panel.textContent('main'));
  const scanReport = await reportFor(tabId);
  const barriers = [...scanReport.pageBarriers, ...scanReport.barriers].map((b) => b.impact).join('\n');
  check('reports the identically-named Yes/No options', /sound identical/.test(barriers));
  check('reports the custom dropdown', /custom dropdown/.test(barriers));
  check('reports the dropdown is not keyboard operable', /"Highest education completed" cannot be reached with the keyboard/.test(barriers));
  check('reports the slider is not keyboard operable', /"Years of experience" cannot be reached with the keyboard/.test(barriers));
  check('reports the drag-and-drop-only uploader', /can only be used by dragging/.test(barriers));
  check('reports the unnamed uploader once, not twice', !/Drag and drop your CV here" has no label/.test(barriers));
  check('reports the checkbox group with no question', /"Language skills" is not tied to its options/.test(barriers));
  check('reports the popup that is not a dialog', /not announced as a dialog/.test(barriers));
  check('reports the one frame it cannot reach, by host',
    (barriers.match(/cannot reach/g) || []).length === 1 && /frame from 127\.0\.0\.1:8765 that BRIDGE cannot reach/.test(barriers));
  check('a labelled checkbox group of one is not a group barrier', !/privacy notice" is not tied/.test(barriers));
  // The two rules lib/rules.ts leaves unmapped both fire on this page: they carry no
  // criterion rather than a guess, while every mapped finding beside them carries its own.
  const findings = [...scanReport.barriers, ...scanReport.pageBarriers];
  const unmapped = findings.filter((b) => ['modal-without-dialog-role', 'cross-origin-frame-unreachable'].includes(b.rule));
  check('an unmapped rule carries no criteria rather than a guess',
    unmapped.length === 2 && unmapped.every((b) => b.automated === true && !('wcag' in b) && !('wcagLevel' in b) && !('reviewRequired' in b)),
    unmapped.map((b) => b.rule).join(','));
  check('every other finding on the page carries its criteria',
    findings.filter((b) => !unmapped.includes(b)).every((b) => b.wcag?.length && b.wcagLevel === 'A' && typeof b.reviewRequired === 'boolean'));

  // Before anything is written: a custom dropdown showing "Select…" is empty, not answered.
  await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
  await panel.waitForFunction(() => document.querySelectorAll('#verify-results li').length > 0);
  check('VERIFY reads an untouched custom dropdown as empty, not as its placeholder',
    /Highest education completed: empty/.test(await panel.locator('#verify-results').textContent()));

  // --- TRANSLATE --------------------------------------------------------------------
  // The page names both radio options with the question. The panel must name them Yes / No.
  const legend = await panel.locator('#questions fieldset legend').first().textContent();
  check('visa question becomes a real group with the question as legend', /sponsorship/.test(legend), legend);
  check('options are named Yes and No, not the question',
    await panel.getByRole('radio', { name: 'Yes', exact: true }).count() === 1 &&
    await panel.getByRole('radio', { name: 'No', exact: true }).count() === 1);

  const eduOptions = await panel.getByLabel(/Highest education/).locator('option').allTextContents();
  check('custom dropdown options harvested by opening it', eduOptions.includes("Bachelor's"), eduOptions.join(' | '));
  check('inferred label is marked as inferred', (await panel.locator('label', { hasText: 'Highest education' }).textContent()).includes('(label inferred)'));
  check('the page dropdown was closed again after harvesting', await page.locator('.dropdown__menu').count() === 0);

  // --- ACT + read-back --------------------------------------------------------------
  await panel.getByLabel('Full name').fill('Zheng Wei');
  await panel.getByRole('button', { name: 'Write Full name to page' }).click();
  const status = (q) => panel.locator('.q', { hasText: q }).locator('.status');
  await status('Full name').filter({ hasText: /On the page: Zheng Wei|Could not/ }).waitFor();
  check('text: written to the page', await page.inputValue('#name') === 'Zheng Wei');
  check('text: panel reports the DOM read-back', /On the page: Zheng Wei/.test(await status('Full name').textContent()));
  // Focus never moves on a write: the confirmation must be heard before anything new is
  // spoken, and a screen reader speaks whatever receives focus first.
  check('focus stays on the Write button after an answer',
    await panel.evaluate(() => document.activeElement?.textContent) === 'Write Full name to page',
    await panel.evaluate(() => document.activeElement?.textContent));

  await panel.getByLabel(/Highest education/).selectOption("Bachelor's");
  await panel.getByRole('button', { name: /Write Highest education/ }).click();
  await page.waitForFunction(() => document.querySelector('#edu').dataset.value, null, { timeout: 5000 }).catch(() => {});
  check('custom dropdown: written to the page', await page.textContent('.dropdown__value') === "Bachelor's");

  await panel.getByRole('radio', { name: 'No', exact: true }).check();
  await panel.getByRole('button', { name: /Write Will you now/ }).click();
  await page.waitForTimeout(700);
  check('visa radio: "No" checked on the page', await page.isChecked('#visa-no') && !(await page.isChecked('#visa-yes')));

  // Filling "Full name" made the page replace the phone field with a new node at a new
  // path. BRIDGE has to find it again by kind and name (§8.1).
  await panel.getByLabel('Phone').fill('96759836');
  await panel.getByRole('button', { name: 'Write Phone to page' }).click();
  await status('Phone').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('re-rendered field: found again by name and written', await page.inputValue('.rerendered input[name=phone]') === '96759836',
    await status('Phone').textContent());
  check('phone: spoken digit by digit, never as a quantity; the page and the visible status keep the real value',
    /Phone: 9 6 7 5 9 8 3 6\. Confirmed on the page/.test(await spoken(panel, /Phone: 9 6 7 5 9 8 3 6/)) &&
    /On the page: 96759836/.test(await status('Phone').textContent()));

  check('slider: the range is a description, never min/max (VoiceOver speaks those as a percentage)',
    await panel.locator('#questions input[type=number][max]').count() === 0 &&
    (await panel.locator('#questions .q', { hasText: 'Years of experience' }).locator('.note').textContent()) === 'From 0 to 10.');
  await panel.getByLabel(/Years of experience/).fill('2');
  await panel.getByRole('button', { name: /Write Years of experience/ }).click();
  await status('Years of experience').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('slider: pointer strategy sets the page value', await page.getAttribute('#exp', 'data-value') === '2', await status('Years of experience').textContent());
  check('slider: the thumb moved', await page.locator('.slider__thumb').evaluate((t) => t.style.left) === '20%');

  const langs = panel.locator('fieldset', { hasText: 'Language skills' });
  await langs.getByRole('checkbox', { name: 'English' }).check();
  await langs.getByRole('checkbox', { name: 'Mandarin' }).check();
  await panel.getByRole('button', { name: /Write Language skills/ }).click();
  await status('Language skills').filter({ hasText: /On the page|Could not/ }).waitFor();
  const langState = () => page.locator('input[name=lang]').evaluateAll((els) => els.map((e) => e.checked).join());
  check('checkbox group: English and Mandarin ticked on the page', await langState() === 'true,false,true', await status('Language skills').textContent());
  await langs.getByRole('checkbox', { name: 'Mandarin' }).uncheck();
  await panel.getByRole('button', { name: /Write Language skills/ }).click();
  await page.waitForFunction(() => !document.querySelector('input[name=lang][value=zh]').checked, null, { timeout: 5000 }).catch(() => {});
  check('checkbox group: a second write unticks what was removed', await langState() === 'true,false,false');

  await panel.getByLabel('Earliest start date').fill('31/10/2026');
  await panel.getByRole('button', { name: 'Write Earliest start date to page' }).click();
  check('date: a wrong format is refused at the panel, named, and nothing reaches the page',
    /Type Earliest start date as year-month-day/.test(await spoken(panel, /year-month-day/)) &&
    await page.inputValue('#start-date') === '');

  await panel.getByLabel('Earliest start date').fill('2026-10-01');
  await panel.getByRole('button', { name: 'Write Earliest start date to page' }).click();
  await status('Earliest start date').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('date: written in the order the page asks for', await page.inputValue('#start-date') === '01/10/2026', await status('Earliest start date').textContent());

  await panel.locator('#questions input[type=file]').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(300_000, 65) });
  await panel.locator('.q:has(input[type=file])').getByRole('button', { name: /^Write/ }).click();
  await panel.locator('.q:has(input[type=file]) .status').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('uploader: the page received and rendered the file', await page.textContent('#cv-name') === 'resume.pdf');

  await panel.getByLabel('I agree to the privacy notice').check();
  await panel.getByRole('button', { name: /Write I agree/ }).click();
  await status('I agree to the privacy notice').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('closed shadow root: the checkbox inside it was ticked', await page.getAttribute('acme-consent', 'data-checked') === 'true',
    await status('I agree to the privacy notice').textContent());

  await panel.getByLabel('Referral code').fill('ACME-42');
  await panel.getByRole('button', { name: 'Write Referral code to page' }).click();
  await status('Referral code').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('iframe: the field inside the same-origin frame was written',
    await page.frameLocator('#frame-same').locator('#referral').inputValue() === 'ACME-42', await status('Referral code').textContent());

  // A page that silently discards the write must produce a failure, never a success (§4.3).
  await panel.getByLabel('Notice period').fill('One month');
  await panel.getByRole('button', { name: 'Write Notice period to page' }).click();
  await status('Notice period').filter({ hasText: /On the page|Could not/ }).waitFor();
  const noticeStatus = await status('Notice period').textContent();
  check('a write the page discards is reported as a failure', /^Could not fill/.test(noticeStatus), noticeStatus);
  await panel.waitForTimeout(150);
  check('the failure is announced', /Could not fill Notice period/.test(await heard(panel)));
  check('a write confirmation answers the user\'s command: assertive', await regionOf(panel, /Could not fill Notice period/) === 'reply');

  // --- VERIFY -----------------------------------------------------------------------
  const order = await panel.locator('#questions .q').evaluateAll((qs) =>
    qs.map((q) => q.querySelector('label, legend')?.textContent?.slice(0, 14)));
  const expectedOrder = ['Full name', 'Phone', 'Unlabelled', 'Unlabelled', 'Highest', 'Years of', 'Will you', 'Language', 'Earliest', 'Drag and', 'Notice', 'I agree', 'Referral'];
  check('questions are asked in page order, shadow-root field included',
    expectedOrder.every((t, i) => (order[i] || '').startsWith(t)), order.join(' | '));
  await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
  await panel.waitForFunction(() => /Zheng Wei/.test(document.getElementById('verify-results').textContent));
  const verified = await panel.locator('#verify-results').textContent();
  check('VERIFY reads every answer back from the page',
    ['Zheng Wei', '96759836', "Bachelor's", 'Years of experience: 2', ': No', 'Language skills: English', '01/10/2026', 'resume.pdf', 'privacy notice: checked', 'Referral code: ACME-42']
      .every((t) => verified.includes(t)), verified.replace(/\s+/g, ' '));
  check('VERIFY reports the discarded field as empty', /Notice period: empty/.test(verified));
  await panel.waitForTimeout(150);
  check('VERIFY summary is announced', /Your application contains/.test(await heard(panel)));
  // Two regions (§6.6): the answer to the user's own command interrupts (assertive), so a
  // read-back is heard at once and not after the whole panel has been read out; news from
  // the page waits its turn (polite), so it never cuts off the field just reached.
  check('the read-back answers the user\'s command: assertive', await regionOf(panel, /Your application contains/) === 'reply');

  // --- label inference with the proxy up (§6.4). Runs AFTER answers are on the page, so
  // the privacy rule is tested for real: nothing the applicant entered may be in the request.
  await new Promise((r) => proxyStub.listen(8000, '127.0.0.1', r));
  await panel.getByRole('button', { name: 'Scan the page again' }).click();
  check('inference: the unlabelled dropdown is renamed and marked as inferred',
    await arrives(panel.locator('#questions label', { hasText: 'Preferred office (label inferred)' }).waitFor({ timeout: 10000 })));
  check('inference: its Write button uses the new name',
    await panel.getByRole('button', { name: 'Write Preferred office to page' }).count() === 1);
  const sent = proxyRequests[0];
  check('inference: one request, carrying the dropdown and its options', proxyRequests.length === 1 && sent.length === 1 &&
    sent[0].kind === 'select' && sent[0].options.join() === 'Singapore,Hanoi,Kuala Lumpur', JSON.stringify(sent).slice(0, 200));
  // A picture needs the activeTab grant of a real Alt+Shift+B press, which headless Chrome
  // cannot give. With no picture and no options there is nothing to infer from.
  check('inference: a field with nothing to infer from is not sent, and keeps its honest name',
    (await panel.locator('#diag').textContent()).includes('not sent (nothing to infer from)') &&
    await panel.locator('#questions label', { hasText: 'Unlabelled text (label inferred)' }).count() === 1);
  check('inference: the request carries structure only, none of the answers on the page',
    !/Zheng|96759836|Bachelor|resume\.pdf|ACME-42|01\/10\/2026/.test(JSON.stringify(proxyRequests)));
  // The privacy rule itself (§6.4): a control may be photographed only while it is empty.
  const rect = (fieldId) => sw.evaluate(({ id, fieldId }) => chrome.tabs.sendMessage(id, { type: 'bridge/rect', fieldId }, { frameId: 0 }), { id: tabId, fieldId });
  const before = await rect('f3');
  check('privacy: an empty control yields a crop rectangle', !!before && before.width > 0 && before.dpr > 0, JSON.stringify(before));
  await panel.getByLabel(/Preferred office/).selectOption('Hanoi');
  await panel.getByRole('button', { name: 'Write Preferred office to page' }).click();
  await status('Preferred office').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('inference: the renamed question still writes to the right field', await page.locator('select[name=office]').inputValue() === 'Hanoi');
  check('privacy: once it holds an answer, the same control is refused a rectangle', (await rect('f3')) === null);
  await panel.getByRole('button', { name: 'Scan the page again' }).click();
  await spoken(panel, /questions found/);
  check('inference: an inferred name is kept across rescans without asking again', proxyRequests.length === 1 &&
    await panel.locator('#questions label', { hasText: 'Preferred office (label inferred)' }).count() === 1);

  // The dashboard keys on rule + label, so the report must not pick up a name that a model
  // made up and could word differently tomorrow.
  {
    const report = await reportFor(tabId);
    check('report: labels are the page-derived ones, never the inferred name',
      report.barriers.some((b) => b.rule === 'missing-label' && b.label === 'Unlabelled select') &&
      !JSON.stringify(report).includes('Preferred office'), report.barriers.map((b) => b.label).join(' | '));
  }

  // --- never submits ----------------------------------------------------------------
  check('BRIDGE did not submit the form', (await page.textContent('#result')) === '');

  // --- the panel itself is accessible (§6.6) ----------------------------------------
  // Naming the element beats counting: a contrast failure cannot be fixed from a tally.
  const axeViolations = async () => {
    await panel.evaluate(AXE);
    return panel.evaluate(async () => (await window.axe.run(document)).violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')} — ${(n.any[0]?.message || '').slice(0, 80)}`)));
  };
  const axe = await axeViolations();
  check('side panel: zero axe violations', axe.length === 0, axe.join(' ; ') || 'none');

  // The panel defines every colour twice, for light and dark. axe measures what is
  // rendered, so a dark theme that is never scanned is a theme nobody checked.
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.waitForTimeout(200);
  const axeDark = await axeViolations();
  check('side panel: zero axe violations in dark mode', axeDark.length === 0, axeDark.join(' ; ') || 'none');
  await panel.emulateMedia({ colorScheme: 'light' });

  // --- a full page load (§4): the content script is gone, the panel notices by itself ---
  await page.reload();
  check('reload: the panel rescans without being asked and says so',
    await arrives(panel.waitForFunction(() => /page reloaded/.test(document.getElementById('live').textContent), null, { timeout: 15000 })));
  check('reload: confirmations of the old document are cleared', await panel.locator('#questions .status.ok').count() === 0);
  check('reload: what the user typed in the panel is kept', await panel.getByLabel('Full name').inputValue() === 'Zheng Wei');
  await panel.getByRole('button', { name: 'Write Full name to page' }).click();
  await status('Full name').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('reload: the fresh content script takes writes', await page.inputValue('#name') === 'Zheng Wei');

  });

  // =====================================================================================
  // Multi-step, LinkedIn's shape: a native <dialog>, steps swapped in place, no URL change.
  // =====================================================================================
  await section('dialog wizard', async () => {
    const { page, panel, tabId } = await open('modal.html');
    check('modal: a search page with one field makes no on-load announcement',
      (await page.textContent('#bridge-announcement')) === '');
    await page.getByRole('button', { name: 'Easy Apply' }).click();
    let said = await spoken(panel, /Step 1 of 3/);
    check('modal: opening the dialog is announced as step 1, from "1/3 pages"', /Step 1 of 3: Contact info\. 3 questions found/.test(said), said);
    check('modal: the search box behind the dialog is not offered', !(await panel.locator('#questions').textContent()).includes('Search jobs'));

    await panel.getByLabel('Email address').fill('zw@example.com');
    await page.getByLabel('Yes').check();
    said = await spoken(panel, /new questions appeared/);
    check('conditional fields: announced as new questions, not as a step', /^2 new questions appeared: Referrer name, Referrer email\.$/.test(said), said);
    check('news from the page waits its turn: polite', await regionOf(panel, /new questions appeared/) === 'news');
    check('conditional fields: what was typed in the panel survives the rescan', await panel.getByLabel('Email address').inputValue() === 'zw@example.com');

    await page.getByRole('button', { name: 'Next' }).click();
    said = await spoken(panel, /Step 2 of 3/);
    check('modal: Next is announced, the page itself says nothing', /Step 2 of 3: Additional questions\./.test(said), said);
    check('a step change is news from the page: polite', await regionOf(panel, /Step 2 of 3/) === 'news');
    check('modal: an answer typed but never written is reported lost', /before Email address was written; that answer is not on the page\./.test(said), said);
    check('modal: the questions are the new step\'s', /sponsorship/.test(await panel.locator('#questions').textContent()) &&
      !(await panel.locator('#questions').textContent()).includes('Email address'));
    await panel.getByLabel('Full list').check();
    await panel.locator('#questions input[type=file]').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(50_000, 65) });
    await panel.locator('.q:has(input[type=file])').getByRole('button', { name: /^Write/ }).click();
    await page.waitForFunction(() => document.getElementById('resume-name').textContent === 'resume.pdf', null, { timeout: 5000 }).catch(() => {});
    check('modal: resume written on step 2', await page.textContent('#resume-name') === 'resume.pdf');
    await spoken(panel, /Resume: resume\.pdf\. Confirmed on the page/);

    // Alt+Shift+S: the first press reads back, only the second acts (§6.5). Chrome does not
    // let the page take keyboard focus from the side panel (measured by hand), so BRIDGE
    // presses a Next or Continue button itself. It never presses a button that submits.
    await pressForward(tabId);
    said = await spoken(panel, /Press Alt\+Shift\+S again and BRIDGE presses the Next button/);
    check('forward command: first press runs VERIFY and names the button', /Your application contains: .*resume\.pdf/.test(said), said);
    check('forward command: first press does not press Next', /Step 2 of 3/.test(await panel.textContent('#journey')), await panel.textContent('#journey'));
    check('submit: not offered on a step whose forward button only moves on', await panel.locator('#submit-app').isHidden());
    await pressForward(tabId);
    said = await spoken(panel, /Step 3 of 3/);
    check('forward command: second press presses Next, and the new step is announced', /Step 3 of 3: Work experience/.test(said), said);
    check('modal: step 3 announced', /Step 3 of 3: Work experience/.test(said), said);
    const opts = await panel.getByLabel(/Notice period/).locator('option').allTextContents();
    check('modal: dropdown options on a later step are harvested', opts.includes('One month'), opts.join(' | '));
    await panel.getByRole('button', { name: 'Write resume.pdf, chosen earlier, to page' }).click();
    await page.waitForFunction(() => document.getElementById('portfolio-name').textContent === 'resume.pdf', null, { timeout: 5000 }).catch(() => {});
    check('CV reuse: the file chosen on step 2 is written on step 3 without asking again', await page.textContent('#portfolio-name') === 'resume.pdf');

    // Submitting (§6.5): only the user's own confirmation in the panel can do it. The shortcut
    // reads back, then moves focus to the panel's button. It never presses anything.
    const panelFocus = () => panel.evaluate(() => document.activeElement?.id);
    const submitted = async () => (await page.textContent('#result')) !== '';
    check('submit: not offered before this step has been read back', await panel.locator('#submit-app').isHidden());
    await pressForward(tabId);
    said = await spoken(panel, /Press Alt\+Shift\+S again to move to the Submit my application button in BRIDGE/);
    check('submit: offered once the step is read back and its forward button submits', await panel.locator('#submit-app').isVisible(), said);
    await pressForward(tabId);
    said = await spoken(panel, /Focus is on the Submit my application button/);
    check('submit: the shortcut only moves focus to the panel button, and says it will ask first',
      await panelFocus() === 'submit-app' && /asks you to confirm/.test(said) && !(await submitted()), said);
    await pressForward(tabId);
    await pressForward(tabId);
    check('submit: no number of shortcut presses submits', !(await submitted()));

    await panel.click('#submit-app');
    said = await spoken(panel, /Submit your application to localhost/);
    check('submit: the button asks first, names the site, the step scope, and each empty question by name',
      await panelFocus() === 'submit-cancel' && /cannot be undone/.test(said) &&
      /\d+ questions? on this step (is|are) empty: [A-Z]/.test(said) && !(await submitted()), said);
    await panel.click('#submit-cancel');
    said = await spoken(panel, /Nothing was submitted/);
    check('submit: Cancel submits nothing, closes the question, and returns focus',
      !(await submitted()) && await panel.locator('#submit-confirm').isHidden() && await panelFocus() === 'submit-app', said);

    await panel.getByLabel(/Notice period/).selectOption('One month');
    await panel.getByRole('button', { name: /^Write Notice period/ }).click();
    await spoken(panel, /Notice period: One month\. Confirmed/);
    check('submit: a write after the read-back withdraws the offer until the step is read back again', await panel.locator('#submit-app').isHidden());
    check('modal: BRIDGE did not submit', (await page.textContent('#result')) === '');

    await page.getByRole('button', { name: 'Back' }).click();
    said = await spoken(panel, /Step 2 of 3/);
    check('modal: Back is a step change too', /Step 2 of 3: Additional questions/.test(said), said);

    const stored = await sw.evaluate(() => chrome.storage.session.get(null));
    const sessionKey = Object.keys(stored).find((k) => k.startsWith(`session:${tabId}:`));
    const session = stored[sessionKey];
    check('session: one record per step reached, in storage.session', session?.steps.length === 3 && session.journey?.total === 3,
      session?.steps.map((r) => `${r.index}:${r.label}:${r.status}`).join(' | '));
    check('session: step 2 is current again after Back', session?.currentStepIndex === 2 && session.steps.find((r) => r.index === 2)?.status === 'current');
    await pressForward(tabId);
    await spoken(panel, /BRIDGE presses the Next button/);
    await pressForward(tabId);
    await spoken(panel, /Step 3 of 3/);
    await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
    await panel.locator('#submit-app').waitFor({ state: 'visible' });
    await panel.click('#submit-app');
    await panel.click('#submit-yes');
    said = await spoken(panel, /BRIDGE pressed the Submit application button/);
    check('submit: confirmed by the user, BRIDGE presses the page\'s submit button and says so',
      await arrives(page.waitForFunction(() => document.getElementById('result').textContent.startsWith('Submitted'), null, { timeout: 5000 })), said);

    check('session: filled fields are recorded by key, never by value',
      session?.steps.find((r) => r.index === 2)?.filledFieldIds.length === 1 && !/resume\.pdf|zw@example/.test(JSON.stringify(session)));

    const report = buildReport(session);
    check('report: §6.7 shape, grouped by step', report.portal === 'localhost:8765' && report.pagePath === '/modal.html' &&
      report.steps?.length === 3 && Array.isArray(report.barriers), Object.keys(report).join(','));
    check('report: every field barrier has rule, severity, a non-empty label, impact, and no selector',
      report.barriers.length > 0 && report.barriers.every((b) => b.rule && b.severity && typeof b.label === 'string' && b.label && b.impact && !('selector' in b) && !('field' in b)));
    check('report: page barriers are their own list, keyed by rule alone',
      Array.isArray(report.pageBarriers) && report.pageBarriers.some((b) => b.rule === 'upload-unnamed') &&
      report.pageBarriers.every((b) => b.rule && b.severity && b.impact && !('label' in b)) &&
      report.steps.every((st) => Array.isArray(st.pageBarriers)));
    check('report: the unnamed resume upload is a usability barrier, not a blocking one',
      report.pageBarriers.some((b) => b.rule === 'upload-unnamed' && b.severity === 'usability' && /has no label/.test(b.impact)),
      JSON.stringify(report.pageBarriers));
    check('report: the visa question\'s barrier is on step 2',
      report.steps[1].barriers.some((b) => b.rule === 'options-identically-named' && /sponsorship/.test(b.label)));
    check('report: no applicant data', !/resume\.pdf|zw@example|Zheng/.test(JSON.stringify(report)));
    // The WCAG fields come from lib/rules.ts. A report says which standard its numbers
    // refer to and which criteria the scanner can fail; every finding is marked automated;
    // a mapped rule carries its criteria. (Unmapped rules are checked on apply.html above.)
    const every = [...report.barriers, ...report.pageBarriers];
    check('report: names the standard and the criteria BRIDGE checks',
      report.standard?.name === 'WCAG' && report.standard.version === '2.2' && report.standard.level === 'AA' &&
      report.standard.checked.join(',') === '1.3.1,1.4.3,2.1.1,2.5.3,2.5.8,3.3.2,4.1.2', JSON.stringify(report.standard));
    check('report: every finding is marked automated', every.length > 0 && every.every((b) => b.automated === true));
    check('report: a mapped rule carries its criteria and level',
      every.filter((b) => b.rule === 'options-identically-named').every((b) => b.wcag?.join(',') === '4.1.2,2.5.3' && b.wcagLevel === 'A' && b.reviewRequired === false) &&
      every.some((b) => b.rule === 'options-identically-named'));
    check('report: Markdown twin', /^# Accessibility barrier report: localhost:8765\/modal\.html/.test(reportMarkdown(report)));
  });

  // =====================================================================================
  // Multi-step, Workday's shape: every step a full navigation that destroys the content script.
  // =====================================================================================
  await section('full-navigation journey', async () => {
    const { page, panel, tabId } = await open('steps/1.html');
    // Opening announces nothing (the freshly loaded panel is read once, in order), so the
    // journey is checked where a reader finds it: rendered above the summary.
    const journey = await panel.textContent('#journey');
    check('full-nav: the journey is read from the page\'s stepper', /Step 1 of 3: My Information\. Next: My Experience\./.test(journey), journey);
    let said;
    await panel.getByLabel('First name').fill('Zheng Wei');
    await page.getByRole('button', { name: 'Save and Continue' }).click();
    said = await spoken(panel, /Step 2 of 3/);
    check('full-nav: the new page is announced without reopening the panel', /Step 2 of 3: My Experience\. Next: Review\./.test(said), said);
    check('full-nav: the unwritten answer from the destroyed step is reported lost', /before First name was written/.test(said), said);
    // Alt+Shift+B reloads the panel; a draft from a step the page has left must not come back.
    await panel.reload();
    await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });
    check('drafts: an answer typed on step 1 does not haunt step 2 after a panel reload',
      await panel.evaluate(() => [...document.querySelectorAll('#questions input, #questions textarea')]
        .filter((i) => i.type === 'text' || i.tagName === 'TEXTAREA').every((i) => i.value === '')));
    await panel.getByLabel('Full list').check();
    await panel.getByLabel('Job title').fill('Analyst');
    await panel.getByRole('button', { name: 'Write Job title to page' }).click();
    await spoken(panel, /Job title: Analyst\. Confirmed/);
    check('full-nav: the fresh content script on step 2 takes writes', await page.inputValue('#title') === 'Analyst');
    await pressForward(tabId);
    await spoken(panel, /BRIDGE presses the Save and Continue button/);
    await pressForward(tabId);
    check('full-nav: BRIDGE presses Save and Continue, and the page it loads is announced', await arrives(spoken(panel, /Step 3 of 3: Review/)));
    await pressForward(tabId);
    await spoken(panel, /move to the Submit my application button in BRIDGE/);
    await pressForward(tabId);
    said = await spoken(panel, /Focus is on the Submit my application button/);
    check('full-nav: on the last step the shortcut offers the panel\'s submit button', await panel.evaluate(() => document.activeElement?.id) === 'submit-app', said);
    check('full-nav: BRIDGE did not submit', (await page.textContent('#result')) === '');
  });

  // =====================================================================================
  // Uploaders: a label names an input, it does not make it reachable (spec §6.2).
  // =====================================================================================
  await section('uploaders', async () => {
    // The query string is how the employer demo versions one form (Acme ?v=2, ?v=3).
    const { page, panel, tabId } = await open('uploaders.html?v=3');
    // Give a would-be scan announcement (60 ms debounce) time to land before asserting silence.
    await new Promise((r) => setTimeout(r, 300));
    check('opening the panel announces nothing: the panel itself is read once, top to bottom',
      (await heard(panel)) === '', await heard(panel));
    const report = await reportFor(tabId);
    const listed = [...report.pageBarriers, ...report.barriers].map((b) => b.impact);
    check('uploader: labelled but out of the tab order is still drag-drop-only',
      listed.filter((t) => /can only be used by dragging/.test(t)).length === 1, JSON.stringify(listed));
    check('uploader: the accessible patterns (tab stop, or a focusable label) report nothing',
      listed.length === 1, JSON.stringify(listed));
    // Ground truth for the rule, from real key presses: which uploaders can Tab reach?
    await page.locator('#who').focus();
    const stops = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('for') || 'none')); }
    check('uploader: real Tab presses agree with the rule', stops.join() === 'cv-b,cv-c,none', stops.join());
    check('report: pagePath is the pathname only, so ?v=2 and ?v=3 compare as one form', report.pagePath === '/uploaders.html', report.pagePath);
    check('report: a one-step form has pageBarriers, no steps, and no step numbers',
      report.pageBarriers.length === 1 && report.pageBarriers[0].rule === 'drag-drop-only' && !('steps' in report) && !('step' in report.pageBarriers[0]),
      JSON.stringify(report).slice(0, 300));
  });

  // =====================================================================================
  // Going back a step: the panel presses the page's own Back button, mirror of forward.
  // =====================================================================================
  await section('going back a step', async () => {
    const { page, panel } = await open('modal.html');
    await page.getByRole('button', { name: 'Easy Apply' }).click();
    check('back: the dialog step is announced', await arrives(spoken(panel, /Step 1 of 3/)), await heard(panel));
    await panel.getByRole('button', { name: 'Go back to the previous step' }).click();
    check('back: a step with no Back button is said honestly',
      await arrives(spoken(panel, /could not find a Back or Previous button/)), await heard(panel));
    await page.getByRole('button', { name: 'Next' }).click();
    check('back: step 2 reached', await arrives(spoken(panel, /Step 2 of 3/)), await heard(panel));
    // Answers written on step 2 and one typed but not written, before going back.
    await panel.getByLabel('Full list').check();
    const visa = panel.locator('fieldset', { hasText: 'sponsorship' });
    await visa.getByRole('radio', { name: 'No', exact: true }).check();
    await panel.getByRole('button', { name: /Write Will you now/ }).click();
    await spoken(panel, /Confirmed on the page/);
    await panel.locator('#questions input[type=file]').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1000, 65) });
    await panel.getByRole('button', { name: 'Go back to the previous step' }).click();
    check('back: the press is announced', await arrives(spoken(panel, /BRIDGE pressed the Back button on the page/)), await heard(panel));
    check('back: the page returns to the previous step and the change is announced',
      await arrives(spoken(panel, /Step 1 of 3/)), await heard(panel));
    check('back: nothing was submitted by going back', (await page.textContent('#result')) === '');

    // The user's report: Back "restarts the form". Two owners: the page keeps its own
    // answers (as a real wizard does; the fixture now does too), and the panel keeps what
    // was typed on the step, so a revisit shows both rather than a blank slate.
    await panel.getByLabel('Email address').fill('zw@example.com');
    await panel.getByRole('button', { name: 'Write Email address to page' }).click();
    await spoken(panel, /Email address: zw@example\.com\. Confirmed/);
    await panel.getByLabel('Mobile phone number').fill('96759836'); // typed, never written
    await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
    let said = await spoken(panel, /Press Alt\+Shift\+S again and BRIDGE presses the Next button/);
    check('forward button: offered after the read-back, named after the page\'s own button',
      /The same press is a button after this read-back\.$/.test(said) &&
      await panel.getByRole('button', { name: 'Press the Next button on the page' }).isVisible(), said);
    check('forward button: not offered on a step whose forward button submits (that one is Submit my application)',
      await panel.locator('#submit-app').isHidden());
    await panel.getByRole('button', { name: 'Press the Next button on the page' }).click();
    said = await spoken(panel, /Step 2 of 3/);
    check('forward button: pressing it presses Next on the page, and the new step is announced', /Step 2 of 3: Additional questions/.test(said), said);
    check('forward button: withdrawn once the page moved on', await panel.locator('#press-forward').isHidden());
    check('forward button: the unwritten answer is reported, and kept', /before Mobile phone number was written; that answer is not on the page/.test(said), said);
    check('revisit: step 2 shows what was chosen there before',
      /What you typed here before is back in the panel\.$/.test(said) && await visa.getByRole('radio', { name: 'No', exact: true }).isChecked(), said);
    check('revisit: the page kept its own answer on step 2', await page.isChecked('#visa-no'));
    check('revisit: files are not drafted', await panel.locator('#questions input[type=file]').evaluate((i) => i.files.length) === 0);

    await panel.getByRole('button', { name: 'Go back to the previous step' }).click();
    said = await spoken(panel, /Step 1 of 3/);
    check('revisit: back on step 1, the typed and the written answer are both back in the panel',
      /What you typed here before is back in the panel\./.test(said) &&
      await panel.getByLabel('Email address').inputValue() === 'zw@example.com' &&
      await panel.getByLabel('Mobile phone number').inputValue() === '96759836', said);
    check('revisit: the page kept the written email', await page.inputValue('#email') === 'zw@example.com');
    check('revisit: the panel starts the step at question 1, in one-question mode too',
      await panel.evaluate(() => document.activeElement?.closest('.q')?.querySelector('h3')?.textContent) === 'Question 1 of 3');
    await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
    await panel.waitForFunction(() => /zw@example/.test(document.getElementById('verify-results').textContent));
    check('revisit: read-back shows the page still holds the email, and the never-written phone as empty',
      /Email address: zw@example\.com/.test(await panel.textContent('#verify-results')) && /Mobile phone number: empty/.test(await panel.textContent('#verify-results')));
  });

  // =====================================================================================
  // Questions that appear within a step, and the gate over the forward press (§6.5).
  // =====================================================================================
  await section('conditional questions and the gate', async () => {
    const { page, panel, tabId } = await open('modal.html?conditional');
    await page.getByRole('button', { name: 'Easy Apply' }).click();
    await spoken(panel, /Step 1 of 3/);
    await panel.getByLabel('Full list').check();
    // The user's report: Yes written from the panel, then read back at once. The two
    // questions it revealed are on the page, but the page's watcher has not fired yet.
    await panel.getByRole('radio', { name: 'Yes', exact: true }).check();
    await panel.getByRole('button', { name: /^Write Were you referred/ }).click();
    await spoken(panel, /Confirmed on the page/);
    await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
    let said = await spoken(panel, /Your application contains/);
    const listed = await panel.locator('#verify-results li').allTextContents();
    check('read-back straight after a revealing write lists the revealed questions',
      listed.some((t) => /^Referrer name: empty/.test(t)) && listed.some((t) => /^Referrer email: empty/.test(t)), listed.join(' | '));
    check('…and names them among the empty ones', /empty: .*Referrer name, Referrer email/.test(said), said);
    check('…and the panel now offers them as questions', await panel.getByLabel('Referrer name').count() === 1);
    // The watcher's own rescan lands next and finds the same questions: the gate stays open.
    await panel.waitForFunction(() => document.querySelectorAll('#diag dt').length >= 3);
    await panel.waitForTimeout(1500);
    check('the same questions seen again do not close the gate', await panel.locator('#press-forward').isVisible());

    // Questions going away is a change of the page too: the read-back no longer describes it.
    await page.getByLabel('No').check();
    await panel.waitForFunction(() => document.querySelectorAll('#questions .q').length === 3, null, { timeout: 8000 });
    check('questions leaving the step close the gate', await panel.locator('#press-forward').isHidden());
    await pressForward(tabId);
    said = await spoken(panel, /Nothing has been filled yet|Your application contains/);
    check('the next shortcut press reads back instead of pressing Next', /Step 1 of 3/.test(await panel.textContent('#journey')), said);
    await page.getByLabel('Yes').check();
    // (The polite region still holds "2 new questions appeared" from the read-back's own
    // rescan, so wait for the questions themselves, not the sentence.)
    await panel.waitForFunction(() => document.querySelectorAll('#questions .q').length === 5, null, { timeout: 8000 });
    check('questions appearing close the gate', await panel.locator('#press-forward').isHidden(), await heard(panel));
    check('modal: BRIDGE did not move on or submit', /Step 1 of 3/.test(await panel.textContent('#journey')) && (await page.textContent('#result')) === '');
  });

  // =====================================================================================
  // Drafts: Alt+Shift+B reopens (and so reloads) the panel; typed answers must survive.
  // =====================================================================================
  await section('drafts survive a panel reload', async () => {
    const { panel } = await open('apply.html');
    await panel.getByLabel('One question at a time').check();
    await panel.getByRole('button', { name: 'Next question' }).click();
    await panel.getByLabel('Phone').fill('96759836');
    await new Promise((r) => setTimeout(r, 500)); // the debounced draft save (300 ms)
    await panel.reload();
    await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });
    const said = await spoken(panel, /Back in BRIDGE/);
    check('reopen: says the answers are kept and where the user was',
      /^Back in BRIDGE\. Your answers are kept\. You were on question 2 of 13\.$/.test(said), said);
    check('reopen: the typed, unwritten answer is back in its box', await panel.getByLabel('Phone').inputValue() === '96759836');
    check('reopen: one-question mode shows the question the user was on',
      (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 2 of 13');

    // The reported bug: in the full list the user moves by Tab, not the pager, and the
    // reopened panel claimed "question 1" no matter where they were.
    await panel.getByLabel('Full list').check();
    await panel.getByLabel('Notice period').fill('2 months');
    await new Promise((r) => setTimeout(r, 500));
    await panel.reload();
    await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });
    const again = await spoken(panel, /Back in BRIDGE/);
    check('reopen: in the full list, the position is the question the user was really on',
      /You were on question 11 of 13\./.test(again), again);
    check('reopen: earlier drafts and the later one are all back',
      await panel.getByLabel('Phone').inputValue() === '96759836' &&
      await panel.getByLabel('Notice period').inputValue() === '2 months');
  });

  // =====================================================================================
  // Failure and edge cases (AGENTS.md §7). Each check names the behaviour, not the code.
  // =====================================================================================
  await section('edge cases', async () => {
    const { page, panel, tabId } = await open('edge.html');
    await panel.getByLabel('Full list').check();
    const names = await panel.locator('#questions .name').allTextContents();
    check('a malformed iframe src does not take the scan down', names.some((n) => n === 'Full name'), (await panel.textContent('#summary')));
    check('clickable divs whose class merely CONTAINS "date" are not fields',
      !names.some((n) => /candidate|Why we ask|Update your profile/.test(n)), names.join(' | '));
    check('an unlabelled input does not borrow the neighbouring field\'s label',
      names.filter((n) => /^Full name/.test(n)).length === 1 && names.includes('Unlabelled text (label inferred)'), names.join(' | '));

    const city = () => panel.locator('.q', { hasText: 'City' }).locator('option').allTextContents();
    check('dependent dropdown: first scan reads Singapore\'s cities', (await city()).join() === 'Choose an answer,Jurong,Tampines', (await city()).join());
    await page.selectOption('#country', 'Vietnam');
    await panel.getByRole('button', { name: 'Scan the page again' }).click();
    check('dependent dropdown: a rescan reads the options the page offers NOW',
      await arrives(panel.waitForFunction(() => /Hanoi/.test(document.getElementById('questions').textContent), null, { timeout: 8000 })), (await city()).join());

    const q = (label) => panel.locator('.q', { hasText: label });
    const write = async (label, fillIn) => {
      await fillIn(q(label));
      await q(label).getByRole('button', { name: /^Write/ }).click();
      await q(label).locator('.status').filter({ hasText: /On the page|Could not/ }).waitFor();
      return q(label).locator('.status').textContent();
    };
    check('a dropdown that ignores synthetic events is offered as free text, with a note',
      await q('Team').locator('input[type=text]').count() === 1 && /could not read this dropdown/.test(await q('Team').textContent()));
    const team = await write('Team', (el) => el.locator('input').fill('Platform'));
    check('…and writing to it fails loudly rather than pretending', /^Could not fill.*No option matching "Platform"/.test(team), team);
    // A refusal decided in the page is an answer, not a lost connection. Saying "lost
    // contact" would send the user to reload a page that is working.
    check('…and a refusal from the page is not reported as lost contact', !/Lost contact|failed in the page/.test(team), team);

    const conf = await write('Confidence', (el) => el.locator('input').fill('70'));
    check('slider shape 1, input[type=range]: native setter', await page.inputValue('#confidence') === '70', conf);
    const volume = await write('Volume', (el) => el.locator('input').fill('3'));
    check('slider shape 2, focusable role=slider: Home then ArrowRight', await page.getAttribute('#volume', 'aria-valuenow') === '3', volume);
    const rating = await write('Rating', (el) => el.locator('input').fill('3'));
    check('slider shape 3 with no published range: refused with the reason, and nothing else',
      rating === 'Could not fill: may need sighted help. The slider does not publish its range.', rating);
    const dob = await write('Date of birth', (el) => el.locator('input').fill('1999-12-31'));
    check('date: type=date is written as ISO', await page.inputValue('#dob') === '1999-12-31', dob);
    const from = await write('Available from', (el) => el.locator('input').fill('2026-10-01'));
    check('date: a text input asking mm/dd/yyyy gets month first', await page.inputValue('#from') === '10/01/2026', from);

    await pressForward(tabId);
    let said = await spoken(panel, /Your application contains/);
    check('no forward button: VERIFY still reads back, and does not invent a button', /BRIDGE found no Continue or Submit button on this step\.$/.test(said), said);
    await pressForward(tabId);
    said = await spoken(panel, /could not find/);
    check('no forward button: the second press says so', /BRIDGE could not find a Continue or Submit button/.test(said), said);

    await page.close();
    await q('Full name').locator('input').fill('X');
    await q('Full name').getByRole('button', { name: /^Write/ }).click();
    await q('Full name').locator('.status').filter({ hasText: /Could not|On the page/ }).waitFor();
    const lost = await q('Full name').locator('.status').textContent();
    check('the tab is gone: the write fails loudly', /^Could not fill.*Lost contact with the page/.test(lost), lost);
  });

  await section('target size and contrast', async () => {
    // targets.html: each 2.5.8 and 1.4.3 case beside its nearest passing case, so a
    // finding proves the measurement and its absence proves the exception (§6.2).
    const { panel, tabId } = await open('targets.html');
    const r = await reportFor(tabId);
    const byRule = (rule) => r.barriers.filter((b) => b.rule === rule);
    const small = byRule('target-too-small');
    check('2.5.8: three 16px radios two pixels apart are one target-size barrier on the group',
      small.some((b) => /Preferred contact/.test(b.label) && /only 16 by 16 pixels/.test(b.impact)), JSON.stringify(small));
    check('2.5.8: two 18px inputs stacked with no gap fail, each on its own',
      small.filter((b) => ['Nickname', 'Pronouns'].includes(b.label)).length === 2 && small.every((b) => /only (\d+ by 18|16 by 16) pixels/.test(b.impact)),
      small.map((b) => b.impact).join(' | '));
    check('2.5.8: an 18px input with nothing within reach passes by the spacing exception',
      !small.some((b) => b.label === 'Referral code'));
    check('2.5.8: a native checkbox at its browser default is sized by the browser, not the author',
      !small.some((b) => /job alerts/.test(b.label)) && small.length === 3, small.map((b) => b.label).join(','));
    const faint = byRule('low-contrast');
    check('1.4.3: a #999 label on white is 2.8 to 1 and reported on its field',
      faint.some((b) => b.label === 'Email address' && /The label of "Email address" is hard to read: its contrast is 2.8 to 1, below the 4.5 to 1 minimum\./.test(b.impact)), JSON.stringify(faint));
    check('1.4.3: a #bbb placeholder is measured as the field\'s text',
      faint.some((b) => b.label === 'Website' && /Text in "Website".*1\.9 to 1/.test(b.impact)));
    check('1.4.3: #777 at 24px is large text and passes at 3 to 1', !faint.some((b) => b.label === 'Phone number'));
    check('1.4.3: text over a gradient is not measured rather than guessed', !faint.some((b) => b.label === 'Notes') && faint.length === 2,
      faint.map((b) => b.label).join(','));
    check('both new rules export as Level AA findings, contrast flagged for review and size not',
      [...small, ...faint].every((b) => b.wcagLevel === 'AA') && small.every((b) => b.wcag.join() === '2.5.8' && b.reviewRequired === false) &&
      faint.every((b) => b.wcag.join() === '1.4.3' && b.reviewRequired === true));
  });

  await section('label inference failures and page identity', async () => {
    const before = proxyRequests.length;
    proxyMode = '502';
    const { page, panel } = await open('unnamed-a.html');
    let said = await spoken(panel, /Label inference is unavailable/);
    check('proxy answers 502: one plain sentence, the question keeps its honest name',
      /proxy answered 502/.test(said) && (await panel.locator('#questions').textContent()).includes('Unlabelled select'), said);
    for (const [mode, expected] of [['garbage', /not valid JSON/], ['wrong-shape', /not in the expected shape/]]) {
      proxyMode = mode;
      await panel.getByRole('button', { name: 'Scan the page again' }).click();
      said = await spoken(panel, expected);
      check(`proxy reply is ${mode}: reported, not swallowed`, /Label inference is unavailable/.test(said), said);
      if (mode === 'garbage') check('proxy reply is garbage: the raw exception goes to Diagnostics, not into the spoken sentence',
        !/SyntaxError/.test(said) && /SyntaxError/.test(await panel.textContent('#diag')), said);
    }
    proxyMode = 'ok';
    await panel.getByRole('button', { name: 'Scan the page again' }).click();
    check('proxy recovers: the dropdown on page A is named for ITS options',
      await arrives(panel.locator('#questions .name', { hasText: 'Preferred office (label inferred)' }).waitFor({ timeout: 8000 })));

    await page.click('#go');
    said = await spoken(panel, /New step/);
    check('a step change with no stepper says so, and does not invent a total', /^New step: About the role\. Total number of steps unknown\./.test(said), said);
    check('page B\'s dropdown gets its own name, never page A\'s',
      await arrives(panel.locator('#questions .name', { hasText: 'Expected salary (label inferred)' }).waitFor({ timeout: 8000 })) &&
      !(await panel.locator('#questions').textContent()).includes('Preferred office'),
      (await panel.locator('#questions .name').allTextContents()).join(' | '));
    check('…and that took a request of its own', proxyRequests.length - before >= 5, `${proxyRequests.length - before} requests`);
  });

  await section('employer demo fixture', async () => {
    // fixtures/reports/ and the dashboard demo depend on these three scans of ONE form.
    const rules = async (query) => {
      const { panel, tabId } = await open(query);
      await panel.getByLabel('Full list').check();
      const r = await reportFor(tabId);
      return { r, keys: [...r.barriers.map((b) => `${b.rule}|${b.label}`), ...r.pageBarriers.map((b) => b.rule)].sort() };
    };
    const v1 = await rules(''), v2 = await rules('?v=2'), v3 = await rules('?v=3');
    check('v1, v2 and v3 are one form: same portal and pagePath, no query string',
      [v1, v2, v3].every((v) => v.r.portal === 'localhost:8765' && v.r.pagePath === '/'));
    check('v1: the dropdown\'s three barriers and the visa question\'s two', v1.keys.length === 5 &&
      v1.keys.filter((k) => /Highest education/.test(k)).length === 3 && v1.keys.filter((k) => /sponsorship/.test(k)).length === 2, v1.keys.join(' ; '));
    check('v2 (the fix): the dropdown\'s barriers are gone, nothing new', v2.keys.length === 2 && v2.keys.every((k) => v1.keys.includes(k)), v2.keys.join(' ; '));
    check('v3 (the regression): exactly one new barrier, drag-drop-only on the page',
      v3.keys.filter((k) => !v2.keys.includes(k)).join() === 'drag-drop-only', v3.keys.join(' ; '));
    check('a one-step report carries no steps and no step numbers',
      !('steps' in v1.r) && v1.r.barriers.every((b) => !('step' in b)));
    check('every version states the standard, and the fixture\'s findings all map to a criterion',
      [v1, v2, v3].every((v) => v.r.standard?.version === '2.2' &&
        [...v.r.barriers, ...v.r.pageBarriers].every((b) => b.automated === true && b.wcag?.length && b.wcagLevel === 'A')));
  });

  await section('no page to work on', async () => {
    // Without ?tabId= the panel takes the active tab, which here is the panel itself: an
    // extension page, where no content script can run.
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    const said = await spoken(panel, /BRIDGE cannot read this page/);
    check('a page BRIDGE may not run in: said plainly, no questions invented',
      /cannot read this page/.test(said) && await panel.locator('#questions .q').count() === 0, said);
  });

  await section('always enable: the prompt outcome reaches the user', async () => {
    // Chrome's permission prompt is browser UI and cannot be answered headlessly, which is
    // why manual check 4 exists. What IS testable is everything after it closes — and that
    // is where Deny was silent: the sentence went to #live while focus was still outside
    // this document, so nothing spoke it.
    const page = await ctx.newPage();
    await page.goto('http://localhost:8765/apply.html');
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());

    const panel = await ctx.newPage();
    await panel.addInitScript(() => {
      const install = () => {
        if (!globalThis.chrome?.permissions) return false;
        globalThis.chrome.permissions.request = () => Promise.resolve(false);
        return true;
      };
      if (!install()) document.addEventListener('DOMContentLoaded', install);
    });
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
    await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });

    // The button is offered on https only, and the fixture is http, so it is revealed here
    // rather than waited for. The handler under test is the same one either way.
    await panel.evaluate(() => { document.getElementById('always-enable').hidden = false; });
    await panel.getByRole('button', { name: 'Always enable BRIDGE on this site' }).click();

    const said = await spoken(panel, /was not enabled on this site/);
    check('deny: the outcome is announced, not silent',
      /BRIDGE was not enabled on this site\. Nothing changed\./.test(said), said);
    check('deny: focus is back in the panel, on the button that was pressed, so the live region is heard',
      await panel.evaluate(() => document.activeElement?.id) === 'always-enable',
      await panel.evaluate(() => document.activeElement?.id));
    check('deny: the button stays, because nothing changed',
      await panel.locator('#always-enable').isVisible());
    check('deny: the outcome is also written to Diagnostics, so a silent run can still be diagnosed',
      /denied/.test(await panel.textContent('#diag')));
  });

  await section('user-added site registration', async () => {
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=0`);
    const register = () => panel.evaluate(() => chrome.runtime.sendMessage({ type: 'bridge/register-site', origin: 'https://example.com' }));
    const first = await register();
    const second = await register();
    const registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    check('register-site: registers one all-frames content script for the origin, and a second call is a no-op',
      first?.ok && second?.ok && registered.length === 1 && registered[0].matches.join() === 'https://example.com/*' && registered[0].allFrames === true,
      JSON.stringify({ first, second, registered }));
  });

  await section('submitting the single page', async () => {
    // open() finds its tab by URL, and the first section's apply.html tab is still open.
    const { page, panel } = await open('apply.html?submitting');
    const confirmSubmit = async () => {
      await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
      await panel.locator('#submit-app').waitFor({ state: 'visible' });
      await panel.click('#submit-app');
      await panel.click('#submit-yes');
    };
    // Full name is required and empty, so the browser blocks the submit and says so only visually.
    await confirmSubmit();
    let said = await spoken(panel, /has not moved on/);
    check('a confirmed submit the page rejects: nothing was sent, and BRIDGE says the page has not moved on',
      (await page.textContent('#result')) === '' && /has not moved on since BRIDGE pressed Submit application/.test(said), said);
    check('a confirmed submit the page rejects: the offer is withdrawn until the page is read back again', await panel.locator('#submit-app').isHidden());

    await panel.getByLabel('Full name').fill('Zheng Wei');
    await panel.getByRole('button', { name: 'Write Full name to page' }).click();
    await spoken(panel, /Full name: Zheng Wei\. Confirmed/);
    await confirmSubmit();
    said = await spoken(panel, /Application received/);
    check('a confirmed submit the page accepts: the page\'s confirmation is what the user hears', /Application received/.test(said), said);
    check('a confirmed submit the page accepts: the page was submitted', page.url().endsWith('/received.html'), page.url());
    await panel.waitForTimeout(3500);
    check('a confirmed submit the page accepts: BRIDGE does not then claim the page stayed', !/has not moved on/.test(await heard(panel)), await heard(panel));
  });

  await section('a forward button that does not advance', async () => {
    const { page, panel, tabId } = await open('stuck.html');
    const asked = await panel.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'bridge/submit' }, { frameId: 0 }), tabId);
    check('the page side refuses to submit through a button that does not say submit', asked === null && await page.textContent('#clicks') === '0', JSON.stringify(asked));
    await pressForward(tabId);
    await spoken(panel, /BRIDGE presses the Next button/);
    await pressForward(tabId);
    await spoken(panel, /BRIDGE pressed the Next button/);
    check('"BRIDGE pressed Next" answered the command: assertive', await regionOf(panel, /BRIDGE pressed the Next button/) === 'reply');
    await pressForward(tabId);   // an impatient second press must not press Next again
    const said = await spoken(panel, /has not moved on/);
    check('the page refuses the step: BRIDGE says the page has not moved on', /has not moved on since BRIDGE pressed Next/.test(said), said);
    check('"has not moved on" comes three seconds later, unbidden: polite, and the read-back reply beside it is untouched',
      await regionOf(panel, /has not moved on/) === 'news' && await regionOf(panel, /Nothing has been filled yet|Your application contains/) === 'reply');
    check('a press straight after pressing Next reads back instead of pressing twice', await page.textContent('#clicks') === '1', await page.textContent('#clicks'));
  });
} finally {
  await ctx.close();
  server.close();
  proxyStub.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
