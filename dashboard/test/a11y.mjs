// The built dashboard, driven through its real file input, with axe on every view
// (bridge-business.md §6.4). Zero violations is the requirement, not a target.
//
// Run: npm run test:a11y   (builds first)
//
// Not covered here, by design: what a screen reader actually says. That needs a person —
// see ../../probe/screen-reader-testing.md.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const FIXTURES = path.resolve(here, '../../fixtures/reports');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const ACME = (day) => path.join(FIXTURES, `localhost-8765/2026-09-${day}T09-00-00Z.json`);
const WCAG_DIR = path.resolve(here, '../../fixtures/reports-wcag/localhost-8765');
const ENRICHED = readdirSync(WCAG_DIR).sort().map((f) => path.join(WCAG_DIR, f));
const GREENHOUSE = path.join(FIXTURES, 'boards-greenhouse-io-example-jobs-0000000/2026-09-21T09-00-00Z.json');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = readFileSync(path.join(DIST, rel));
    res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(8766, r));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8766/');

  const axeScan = async (label) => {
    await page.evaluate(AXE);
    // Naming the element matters more than counting: a contrast failure is unfixable from
    // a tally, and dark mode in particular fails on one token at a time.
    const violations = await page.evaluate(async () =>
      (await window.axe.run(document)).violations.flatMap((v) =>
        v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')} — ${(n.any[0]?.message || '').slice(0, 90)}`)));
    check(`axe: zero violations — ${label}`, violations.length === 0, violations.join(', ') || 'none');
  };

  // --- empty state ------------------------------------------------------------------
  check('opens with no reports and says so', /No reports loaded yet/.test(await page.textContent('#list-body')));
  check('shows no barrier counts before anything is loaded',
    (await page.locator('table').count()) === 0);

  const disclaimer = await page.locator('main > .disclaimer').textContent();
  check('states up front that findings are automated WCAG 2.2 A/AA, not a conformance result',
    /automated WCAG 2\.2 A\/AA accessibility findings/i.test(disclaimer) &&
    /not a conformance decision/i.test(disclaimer), disclaimer.replace(/\s+/g, ' ').trim());
  check('and that human review is required for a conformance claim',
    /Human review is required for a WCAG conformance claim/i.test(disclaimer));
  // Every sentence mentioning certification, compliance or legality must be a denial.
  // A bare keyword search would flag the disclaimer's own "does not certify".
  const claims = (await page.textContent('main'))
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /certif|complian|legal|guarantee/i.test(s))
    .filter((s) => !/\b(not|never|no|nothing)\b/i.test(s));
  check('no sentence on the page claims compliance, certification or legal standing',
    claims.length === 0, claims.join(' | ').slice(0, 200) || 'none');
  await axeScan('empty state');

  // --- loading through the real file input -------------------------------------------
  await page.setInputFiles('#reports', [ACME(21), ACME(22)]);
  await page.waitForSelector('table');
  check('loading is announced', /2 reports loaded\. 1 form, 2 scans in total\./.test(await page.textContent('#live')),
    await page.textContent('#live'));

  // Loading is additive: a second batch joins the first rather than replacing it. Several
  // reports for one form are what makes a history, so this is the property the whole
  // comparison rests on.
  await page.setInputFiles('#reports', [ACME(23), GREENHOUSE]);
  await page.waitForFunction(() => document.querySelector('caption')?.textContent.includes('4 scans'));
  check('a second batch adds to what is loaded instead of replacing it',
    /2 reports loaded\. 2 forms, 4 scans in total\./.test(await page.textContent('#live')),
    await page.textContent('#live'));
  check('the reports from the first batch are still there',
    (await page.locator('#list-body caption').textContent()).includes('from 4 scans'),
    await page.locator('#list-body caption').textContent());
  check('groups four reports into two forms', (await page.locator('#list-body tbody tr').count()) === 2);

  const acmeRow = page.locator('tbody tr', { hasText: 'localhost:8765' });
  check('the form list shows the newest scan\'s blocking count',
    (await acmeRow.locator('td').nth(1).textContent()) === '3',
    await acmeRow.locator('td').nth(1).textContent());
  check('the form list flags the regression against the previous scan',
    /1 new/.test(await acmeRow.locator('.change').textContent()),
    await acmeRow.locator('.change').textContent());
  check('a form scanned once reads as a first scan, not as all-new',
    /First scan/.test(await page.locator('tbody tr', { hasText: 'greenhouse' }).locator('.change').textContent()));
  await axeScan('form list');

  // --- detail, opened from the keyboard ----------------------------------------------
  await acmeRow.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail-view:not([hidden])');
  check('opening a form moves focus to its heading, not to the top of the page',
    await page.evaluate(() => document.activeElement?.id) === 'detail-h',
    await page.evaluate(() => document.activeElement?.id));
  check('the detail view names the form', (await page.textContent('#detail-h')) === 'localhost:8765/');
  check('the form list is hidden while the detail is open', await page.locator('#list-view').isHidden());

  const bucket = (heading) => page.locator('.bucket', { hasText: heading });
  check('the new barrier is listed under New, with its rule',
    /drag-drop-only/.test(await bucket('New since the previous scan').textContent()));
  check('New is counted in its heading',
    /New since the previous scan \(1\)/.test(await bucket('New since the previous scan').textContent()));
  check('the two visa barriers are under Still open',
    /Still open \(2\)/.test(await bucket('Still open').textContent()));
  check('the education-dropdown barriers are NOT resolved between the last two scans',
    /Resolved \(0\)/.test(await bucket('Resolved').textContent()));
  check('every barrier carries its plain-language impact',
    /can only be used by dragging a file onto it/.test(await bucket('New since the previous scan').textContent()));
  check('a page-level barrier says so instead of naming a field',
    /Affects the whole page/.test(await bucket('New since the previous scan').textContent()));
  check('a field-level barrier names its field',
    /Field: Will you now or in the future require sponsorship/.test(await bucket('Still open').textContent()));
  check('severity is a word, not only a colour',
    (await bucket('Still open').locator('.sev').first().textContent()) === 'Blocking');
  check('a legacy finding with no mapping says so rather than guessing a criterion',
    /No WCAG mapping recorded/.test(await bucket('Still open').textContent()));
  check('the summary reports a legacy scan as entirely unmapped',
    /0 of 3 findings map to a success criterion/.test(await page.textContent('.wcag-summary')),
    (await page.textContent('.wcag-summary')).replace(/\s+/g, ' ').slice(0, 120));
  await axeScan('form detail');

  // --- back returns focus where it came from -----------------------------------------
  await page.getByRole('button', { name: 'Back to all forms' }).click();
  await page.waitForSelector('#list-view:not([hidden])');
  check('Back returns focus to the row it was opened from',
    await page.evaluate(() => document.activeElement?.textContent) === 'localhost:8765/',
    await page.evaluate(() => document.activeElement?.textContent));

  // --- loading more files adds to what is there ---------------------------------------
  await page.setInputFiles('#reports', [ACME(21)]);
  await page.waitForFunction(() => document.getElementById('live').textContent.includes('already loaded'));
  check('re-loading a scan already held does not double-count it',
    (await page.locator('caption').textContent()).includes('from 4 scans'),
    await page.locator('caption').textContent());
  check('and says so rather than claiming a new report',
    /1 report was already loaded\. 2 forms, 4 scans in total\./.test(await page.textContent('#live')),
    await page.textContent('#live'));

  // --- a file that is not a report says which file, and why ---------------------------
  await page.setInputFiles('#reports', [{ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') }]);
  await page.waitForSelector('#load-errors:not([hidden])');
  const errors = await page.textContent('#load-errors');
  check('a file that is not a report is rejected by name', /notes\.json/.test(errors), errors.replace(/\s+/g, ' '));
  check('and says what was wrong with it', /"portal" is missing/.test(errors));
  check('the failure is announced', /1 file could not be read/.test(await page.textContent('#live')));
  check('one bad file does not discard the good ones', (await page.locator('#list-body tbody tr').count()) === 2);
  await axeScan('load error');

  // --- reports carrying WCAG findings --------------------------------------------------
  await page.reload();
  await page.setInputFiles('#reports', ENRICHED);
  await page.waitForSelector('table');
  // A report predating the WCAG fields and one carrying them describe the same form and
  // belong to the same history.
  await page.setInputFiles('#reports', [ACME(21)]);
  await page.waitForFunction(() => document.querySelector('caption')?.textContent.includes('4 scans'));
  check('a legacy report and WCAG-enriched ones load into one history for the same form',
    (await page.locator('#list-body tbody tr').count()) === 1 &&
    (await page.locator('#list-body caption').textContent()).includes('1 form'),
    await page.locator('#list-body caption').textContent());
  await page.locator('#list-body tbody tr').getByRole('button').click();
  await page.waitForSelector('#detail-view:not([hidden])');

  const summary = (await page.textContent('.wcag-summary')).replace(/\s+/g, ' ').trim();
  check('the summary counts findings by WCAG level',
    /3 of 3 findings map to a success criterion \(Level A: 3\)/.test(summary), summary.slice(0, 140));
  // v3's three findings cite four criteria between them: options-identically-named
  // carries both 4.1.2 and 2.5.3, so it appears under each.
  const criteria = await page.locator('.wcag-table tbody th[scope=row]').allTextContents();
  check('the summary breaks findings down by success criterion, numerically ordered',
    criteria.join(',') === '1.3.1,2.1.1,2.5.3,4.1.2', criteria.join(','));
  check('each criterion row names its level and the rule behind it',
    /2\.5\.3/.test(await page.locator('.wcag-table').textContent()) &&
    /options-identically-named/.test(await page.locator('.wcag-table').textContent()));
  check('the summary repeats that this is not a conformance decision',
    /Human review is required for a WCAG conformance claim/.test(summary));
  check('the summary names the standard and the criteria the scanner can fail, so silence is not a pass',
    /Measured against WCAG 2\.2, Level AA\. The scanner can fail 7 criteria: 1\.3\.1, 1\.4\.3, 2\.1\.1, 2\.5\.3, 2\.5\.8, 3\.3\.2, 4\.1\.2\. Any other criterion was not checked\./.test(summary),
    summary.slice(0, 220));

  const still = await page.locator('.bucket', { hasText: 'Still open' }).textContent();
  check('a mapped finding shows its level and criteria beside it',
    /WCAG 2\.2 Level A/.test(still) && /4\.1\.2, 2\.5\.3/.test(still), still.replace(/\s+/g, ' ').slice(0, 200));
  check('nothing in an enriched scan reads as unmapped',
    !/No WCAG mapping recorded/.test(still));
  check('the resolved/still-open/new comparison is unchanged by the WCAG fields',
    /Still open \(2\)/.test(still) &&
    /New since the previous scan \(1\)/.test(await page.locator('.bucket', { hasText: 'New since' }).textContent()));
  await axeScan('form detail with WCAG findings');

  // --- dark mode is a second set of colours, so it needs its own contrast pass ---------
  // The palette defines every token twice. axe only measures what is rendered, so a dark
  // theme that was never scanned is a theme whose contrast nobody checked.
  await page.emulateMedia({ colorScheme: 'dark' });
  // Let the new palette paint before measuring it.
  await page.waitForTimeout(200);
  await axeScan('form detail, dark mode');
  await page.getByRole('button', { name: 'Back to all forms' }).click();
  await page.waitForSelector('#list-view:not([hidden])');
  await axeScan('form list, dark mode');
  check('dark mode is the page\'s own palette, not a browser inversion',
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== 'rgb(247, 249, 252)',
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await page.emulateMedia({ colorScheme: 'light' });

  // --- the whole page is reachable from the keyboard ----------------------------------
  const reachable = await page.evaluate(() => {
    const focusable = [...document.querySelectorAll('a[href], button, input, [tabindex="0"]')]
      .filter((e) => !e.closest('[hidden]') && e.offsetParent !== null);
    return focusable.map((e) => e.tagName + ':' + (e.textContent?.trim().slice(0, 24) || e.type || ''));
  });
  check('every interactive control is a native focusable element',
    reachable.length > 0 && reachable.every((r) => /^(A|BUTTON|INPUT):/.test(r)),
    reachable.join(' | '));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
