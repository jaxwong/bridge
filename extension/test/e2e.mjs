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

try {
  const { page, panel, tabId } = await open('');
  check('found the test tab', typeof tabId === 'number', `tabId=${tabId}`);

  // --- on load, before the panel is opened (§4, built-in tier) ------------------------
  await page.waitForFunction(() => document.getElementById('bridge-announcement')?.textContent, null, { timeout: 5000 });
  const onLoad = await page.textContent('#bridge-announcement');
  check('the page itself announces the barrier count on load', /^BRIDGE found \d+ accessibility barriers on this form\. Press Alt\+Shift\+B/.test(onLoad), onLoad);

  // --- one question at a time is the default (§4.2) -----------------------------------
  check('one-question mode: exactly one question is shown', await panel.locator('#questions .q:visible').count() === 1);
  check('one-question mode: it says where you are', (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 1 of 11');
  await panel.getByRole('button', { name: 'Next question' }).click();
  check('one-question mode: Next shows the second question and focuses its control',
    (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 2 of 11' &&
    await panel.evaluate(() => document.activeElement?.closest('.q')?.querySelector('h3')?.textContent) === 'Question 2 of 11');
  await panel.getByRole('button', { name: 'Previous question' }).click();
  await panel.getByLabel('Full name').fill('Z. Wei');
  await panel.getByRole('button', { name: 'Write Full name to page' }).click();
  await spoken(panel, /Full name: Z\. Wei\. Confirmed on the page\. Next: Phone/);
  check('one-question mode: a confirmed answer advances to the next question',
    (await panel.locator('#questions .q:visible h3').textContent()) === 'Question 2 of 11' &&
    await panel.evaluate(() => document.activeElement?.tagName) === 'INPUT');

  // Most of this run answers questions out of order, so it uses the full list. The
  // default, one question at a time, has its own section below.
  await panel.getByLabel('Full list').check();

  // --- SCAN -------------------------------------------------------------------------
  const summary = await panel.textContent('#summary');
  check('SCAN finds 11 questions: 10 in the page, 1 in the same-origin iframe', /^11 questions found/.test(summary), summary);
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
  const expectedOrder = ['Full name', 'Phone', 'Highest', 'Years of', 'Will you', 'Language', 'Earliest', 'Drag and', 'Notice', 'I agree', 'Referral'];
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

  // --- never submits ----------------------------------------------------------------
  check('BRIDGE did not submit the form', (await page.textContent('#result')) === '');

  // --- the panel itself is accessible (§6.6) ----------------------------------------
  await panel.evaluate(AXE);
  const axe = await panel.evaluate(async () => (await window.axe.run(document)).violations
    .map((v) => `${v.id} (${v.nodes.length})`));
  check('side panel: zero axe violations', axe.length === 0, axe.join(', ') || 'none');

  // --- a full page load (§4): the content script is gone, the panel notices by itself ---
  await page.reload();
  await panel.waitForFunction(() => /page reloaded/.test(document.getElementById('live').textContent), null, { timeout: 15000 });
  check('reload: the panel rescans without being asked and says so', true);
  check('reload: confirmations of the old document are cleared', await panel.locator('#questions .status.ok').count() === 0);
  check('reload: what the user typed in the panel is kept', await panel.getByLabel('Full name').inputValue() === 'Zheng Wei');
  await panel.getByRole('button', { name: 'Write Full name to page' }).click();
  await status('Full name').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('reload: the fresh content script takes writes', await page.inputValue('#name') === 'Zheng Wei');

  // =====================================================================================
  // Multi-step, LinkedIn's shape: a native <dialog>, steps swapped in place, no URL change.
  // =====================================================================================
  {
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

    // Alt+Shift+S: the first press reads back, only the second moves focus (§6.5).
    await page.evaluate(() => document.activeElement?.blur());
    await pressForward(tabId);
    said = await spoken(panel, /Press Alt\+Shift\+S to move to the Next button/);
    check('forward command: first press runs VERIFY and names the button', /Your application contains: .*resume\.pdf/.test(said), said);
    check('forward command: first press does not move focus', await pageFocus(page) !== 'Next');
    await pressForward(tabId);
    said = await spoken(panel, /Focus is on the Next button/);
    check('forward command: second press focuses Next', await pageFocus(page) === 'Next', said);
    check('forward command: it says what pressing does, and that BRIDGE will not', /moves to the next step\. BRIDGE never presses it/.test(said));

    await page.getByRole('button', { name: 'Next' }).click();
    said = await spoken(panel, /Step 3 of 3/);
    check('modal: step 3 announced', /Step 3 of 3: Work experience/.test(said), said);
    const opts = await panel.getByLabel(/Notice period/).locator('option').allTextContents();
    check('modal: dropdown options on a later step are harvested', opts.includes('One month'), opts.join(' | '));
    await panel.getByRole('button', { name: 'Write resume.pdf, chosen earlier, to page' }).click();
    await page.waitForFunction(() => document.getElementById('portfolio-name').textContent === 'resume.pdf', null, { timeout: 5000 }).catch(() => {});
    check('CV reuse: the file chosen on step 2 is written on step 3 without asking again', await page.textContent('#portfolio-name') === 'resume.pdf');

    await pressForward(tabId);
    await spoken(panel, /move to the Submit application button/);
    await pressForward(tabId);
    said = await spoken(panel, /Focus is on the Submit application button/);
    check('forward command: on the last step it targets Submit and says it submits',
      await pageFocus(page) === 'Submit application' && /Pressing it submits your application\. BRIDGE never presses it/.test(said), said);
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
    check('export: every barrier has rule, severity, field, impact and no selector',
      report.barriers.length > 0 && report.barriers.every((b) => b.rule && b.severity && 'field' in b && b.impact && !('selector' in b)));
    check('export: the visa question\'s barrier is on step 2',
      report.steps[1].barriers.some((b) => b.rule === 'options-identically-named' && /sponsorship/.test(b.field)));
    check('export: no applicant data', !/resume\.pdf|zw@example|Zheng/.test(JSON.stringify(report)));
    const [md] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export barrier report as Markdown' }).click()]);
    check('export: Markdown twin', /^# Accessibility barrier report: localhost:8765\/modal\.html/.test(readFileSync(await md.path(), 'utf8')));
  }

  // =====================================================================================
  // Multi-step, Workday's shape: every step a full navigation that destroys the content script.
  // =====================================================================================
  {
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
    await page.getByRole('button', { name: 'Save and Continue' }).click();
    await spoken(panel, /Step 3 of 3: Review/);
    await pressForward(tabId);
    await spoken(panel, /move to the Submit button/);
    await pressForward(tabId);
    said = await spoken(panel, /Focus is on the Submit button/);
    check('full-nav: forward command reaches Submit on the last step', await pageFocus(page) === 'Submit', said);
    check('full-nav: BRIDGE did not submit', (await page.textContent('#result')) === '');
  }
} finally {
  await ctx.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
