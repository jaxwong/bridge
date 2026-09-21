// End-to-end: the built extension, the Acme Careers page, and the side panel driven as an
// ordinary page pointed at the test tab (spec §8). Covers SCAN -> TRANSLATE -> ACT -> VERIFY.
// Not covered here, by design: sidePanel.open(), focus moving into the panel, and anything
// a screen reader hears. Those are manual (probe/screen-reader-testing.md).

import { chromium } from 'playwright';
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
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, page.url());
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });
  return { page, panel, tabId };
}
/** Waits until the panel's one live region says something matching `re`; returns the text. */
async function spoken(panel, re) {
  await panel.waitForFunction((src) => new RegExp(src, 'i').test(document.getElementById('live').textContent), re.source, { timeout: 10000 });
  return panel.textContent('#live');
}
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
  // in three versions (?v=2, ?v=3), scanned by the monitor.
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
  await spoken(panel, /Full name: Z\. Wei\. Confirmed on the page\. Next: Phone/);
  check('one-question mode: a confirmed answer advances to the next question',
    (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 2 of 13' &&
    await panel.evaluate(() => document.activeElement?.tagName) === 'INPUT');

  // Most of this run answers questions out of order, so it uses the full list. The
  // default, one question at a time, has its own section below.
  await panel.getByLabel('Full list').check();

  // --- SCAN -------------------------------------------------------------------------
  const summary = await panel.textContent('#summary');
  check('SCAN finds 13 questions: 12 in the page, 1 in the same-origin iframe', /^13 questions found/.test(summary), summary);
  const barriers = await panel.textContent('#barriers');
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
  // Page order: the question after "Full name" is Phone.
  const focusedLabel = await panel.evaluate(() => {
    const a = document.activeElement;
    return a?.id ? document.querySelector(`label[for="${a.id}"]`)?.textContent || '' : '';
  });
  check('focus moves to the NEXT question on the page after an answer', /Phone/.test(focusedLabel), focusedLabel);

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
  await panel.getByLabel('Phone').fill('+65 8000 0000');
  await panel.getByRole('button', { name: 'Write Phone to page' }).click();
  await status('Phone').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('re-rendered field: found again by name and written', await page.inputValue('.rerendered input[name=phone]') === '+65 8000 0000',
    await status('Phone').textContent());

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
  check('the failure is announced', /Could not fill Notice period/.test(await panel.textContent('#live')));

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
    ['Zheng Wei', '+65 8000 0000', "Bachelor's", 'Years of experience: 2', ': No', 'Language skills: English', '01/10/2026', 'resume.pdf', 'privacy notice: checked', 'Referral code: ACME-42']
      .every((t) => verified.includes(t)), verified.replace(/\s+/g, ' '));
  check('VERIFY reports the discarded field as empty', /Notice period: empty/.test(verified));
  await panel.waitForTimeout(150);
  check('VERIFY summary is announced', /Your application contains/.test(await panel.textContent('#live')));

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
    !/Zheng|8000 0000|Bachelor|resume\.pdf|ACME-42|01\/10\/2026/.test(JSON.stringify(proxyRequests)));
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
    const [dl] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export barrier report as JSON' }).click()]);
    const report = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    check('export: labels are the page-derived ones, never the inferred name',
      report.barriers.some((b) => b.rule === 'missing-label' && b.label === 'Unlabelled select') &&
      !JSON.stringify(report).includes('Preferred office'), report.barriers.map((b) => b.label).join(' | '));
  }

  // --- never submits ----------------------------------------------------------------
  check('BRIDGE did not submit the form', (await page.textContent('#result')) === '');

  // --- the panel itself is accessible (§6.6) ----------------------------------------
  await panel.evaluate(AXE);
  const axe = await panel.evaluate(async () => (await window.axe.run(document)).violations
    .map((v) => `${v.id} (${v.nodes.length})`));
  check('side panel: zero axe violations', axe.length === 0, axe.join(', ') || 'none');

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
    check('conditional fields: what was typed in the panel survives the rescan', await panel.getByLabel('Email address').inputValue() === 'zw@example.com');

    await page.getByRole('button', { name: 'Next' }).click();
    said = await spoken(panel, /Step 2 of 3/);
    check('modal: Next is announced, the page itself says nothing', /Step 2 of 3: Additional questions\./.test(said), said);
    check('modal: an answer typed but never written is reported lost', /before Email address was written/.test(said), said);
    check('modal: the questions are the new step\'s', /sponsorship/.test(await panel.locator('#questions').textContent()) &&
      !(await panel.locator('#questions').textContent()).includes('Email address'));
    check('modal: the unnamed resume upload is a usability barrier, not a blocking one',
      /Usability: The upload button has no label/.test(await panel.textContent('#barriers')));

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
    await pressForward(tabId);
    said = await spoken(panel, /Step 3 of 3/);
    check('forward command: second press presses Next, and the new step is announced', /Step 3 of 3: Work experience/.test(said), said);
    check('modal: step 3 announced', /Step 3 of 3: Work experience/.test(said), said);
    const opts = await panel.getByLabel(/Notice period/).locator('option').allTextContents();
    check('modal: dropdown options on a later step are harvested', opts.includes('One month'), opts.join(' | '));
    await panel.getByRole('button', { name: 'Write resume.pdf, chosen earlier, to page' }).click();
    await page.waitForFunction(() => document.getElementById('portfolio-name').textContent === 'resume.pdf', null, { timeout: 5000 }).catch(() => {});
    check('CV reuse: the file chosen on step 2 is written on step 3 without asking again', await page.textContent('#portfolio-name') === 'resume.pdf');

    await pressForward(tabId);
    await spoken(panel, /BRIDGE never submits for you\. Press Alt\+Shift\+S again to put the Submit application button in reach/);
    await pressForward(tabId);
    said = await spoken(panel, /submits your application, so BRIDGE does not press it/);
    check('forward command: a button that submits is selected on the page, never pressed, and the way to it is said',
      await pageFocus(page) === 'Submit application' && /until you hear Submit application, then press Enter/.test(said), said);
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
    check('session: filled fields are recorded by key, never by value',
      session?.steps.find((r) => r.index === 2)?.filledFieldIds.length === 1 && !/resume\.pdf|zw@example/.test(JSON.stringify(session)));

    const [dl] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export barrier report as JSON' }).click()]);
    const report = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    check('export: §6.7 shape, grouped by step', report.portal === 'localhost:8765' && report.pagePath === '/modal.html' &&
      report.steps?.length === 3 && Array.isArray(report.barriers), Object.keys(report).join(','));
    check('export: every field barrier has rule, severity, a non-empty label, impact, and no selector',
      report.barriers.length > 0 && report.barriers.every((b) => b.rule && b.severity && typeof b.label === 'string' && b.label && b.impact && !('selector' in b) && !('field' in b)));
    check('export: page barriers are their own list, keyed by rule alone',
      Array.isArray(report.pageBarriers) && report.pageBarriers.some((b) => b.rule === 'upload-unnamed') &&
      report.pageBarriers.every((b) => b.rule && b.severity && b.impact && !('label' in b)) &&
      report.steps.every((st) => Array.isArray(st.pageBarriers)));
    check('export: the visa question\'s barrier is on step 2',
      report.steps[1].barriers.some((b) => b.rule === 'options-identically-named' && /sponsorship/.test(b.label)));
    check('export: no applicant data', !/resume\.pdf|zw@example|Zheng/.test(JSON.stringify(report)));
    const [md] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export barrier report as Markdown' }).click()]);
    check('export: Markdown twin', /^# Accessibility barrier report: localhost:8765\/modal\.html/.test(readFileSync(await md.path(), 'utf8')));
  });

  // =====================================================================================
  // Multi-step, Workday's shape: every step a full navigation that destroys the content script.
  // =====================================================================================
  await section('full-navigation journey', async () => {
    const { page, panel, tabId } = await open('steps/1.html');
    let said = await spoken(panel, /Step 1 of 3/);
    check('full-nav: the journey is read from the page\'s stepper', /Step 1 of 3: My Information\. Next: My Experience\./.test(said), said);
    await panel.getByLabel('First name').fill('Zheng Wei');
    await page.getByRole('button', { name: 'Save and Continue' }).click();
    said = await spoken(panel, /Step 2 of 3/);
    check('full-nav: the new page is announced without reopening the panel', /Step 2 of 3: My Experience\. Next: Review\./.test(said), said);
    check('full-nav: the unwritten answer from the destroyed step is reported lost', /before First name was written/.test(said), said);
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
    await spoken(panel, /put the Submit button in reach/);
    await pressForward(tabId);
    said = await spoken(panel, /so BRIDGE does not press it/);
    check('full-nav: forward command selects Submit on the last step and does not press it', await pageFocus(page) === 'Submit', said);
    check('full-nav: BRIDGE did not submit', (await page.textContent('#result')) === '');
  });

  // =====================================================================================
  // Uploaders: a label names an input, it does not make it reachable (spec §6.2).
  // =====================================================================================
  await section('uploaders', async () => {
    // The query string is how the employer demo versions one form (Acme ?v=2, ?v=3).
    const { page, panel } = await open('uploaders.html?v=3');
    const listed = await panel.locator('#barriers li').allTextContents();
    check('uploader: labelled but out of the tab order is still drag-drop-only',
      listed.filter((t) => /can only be used by dragging/.test(t)).length === 1, JSON.stringify(listed));
    check('uploader: the accessible patterns (tab stop, or a focusable label) report nothing',
      listed.length === 1, JSON.stringify(listed));
    // Ground truth for the rule, from real key presses: which uploaders can Tab reach?
    await page.locator('#who').focus();
    const stops = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('for') || 'none')); }
    check('uploader: real Tab presses agree with the rule', stops.join() === 'cv-b,cv-c,none', stops.join());
    const [dl] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export barrier report as JSON' }).click()]);
    const report = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    check('export: pagePath is the pathname only, so ?v=2 and ?v=3 compare as one form', report.pagePath === '/uploaders.html', report.pagePath);
    check('export: a one-step form has pageBarriers, no steps, and no step numbers',
      report.pageBarriers.length === 1 && report.pageBarriers[0].rule === 'drag-drop-only' && !('steps' in report) && !('step' in report.pageBarriers[0]),
      JSON.stringify(report).slice(0, 300));
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
    check('no forward button: VERIFY still reads back, and does not invent a button', /BRIDGE never submits\. Press the page's own submit button/.test(said), said);
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
      const { panel } = await open(query);
      await panel.getByLabel('Full list').check();
      const [dl] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export barrier report as JSON' }).click()]);
      const r = JSON.parse(readFileSync(await dl.path(), 'utf8'));
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
    check('a one-step export is the same shape the monitor writes: no steps, no step numbers',
      !('steps' in v1.r) && v1.r.barriers.every((b) => !('step' in b)));
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

  await section('a forward button that does not advance', async () => {
    const { page, panel, tabId } = await open('stuck.html');
    await pressForward(tabId);
    await spoken(panel, /BRIDGE presses the Next button/);
    await pressForward(tabId);
    await spoken(panel, /BRIDGE pressed the Next button/);
    await pressForward(tabId);   // an impatient second press must not press Next again
    const said = await spoken(panel, /has not moved on/);
    check('the page refuses the step: BRIDGE says the page has not moved on', /has not moved on since BRIDGE pressed Next/.test(said), said);
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
