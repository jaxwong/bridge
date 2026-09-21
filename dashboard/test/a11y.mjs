// The built dashboard, driven through its real file input, with axe on every view
// (bridge-business.md §6.4). Zero violations is the requirement, not a target.
//
// Run: npm run test:a11y   (builds first)
//
// Not covered here, by design: what a screen reader actually says. That needs a person —
// see ../../probe/screen-reader-testing.md.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const FIXTURES = path.resolve(here, '../../fixtures/reports');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const ACME = (day) => path.join(FIXTURES, `localhost-8765/2026-09-${day}T09-00-00Z.json`);
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
    const violations = await page.evaluate(async () =>
      (await window.axe.run(document)).violations.map((v) => `${v.id} x${v.nodes.length}`));
    check(`axe: zero violations — ${label}`, violations.length === 0, violations.join(', ') || 'none');
  };

  // --- empty state ------------------------------------------------------------------
  check('opens with no reports and says so', /No reports loaded yet/.test(await page.textContent('#list-body')));
  check('shows no barrier counts before anything is loaded',
    (await page.locator('table').count()) === 0);
  await axeScan('empty state');

  // --- loading through the real file input -------------------------------------------
  await page.setInputFiles('#reports', [ACME(21), ACME(22), ACME(23), GREENHOUSE]);
  await page.waitForSelector('table');
  check('loading is announced', /4 reports loaded\. 2 forms, 4 scans in total\./.test(await page.textContent('#live')),
    await page.textContent('#live'));
  check('groups four reports into two forms', (await page.locator('tbody tr').count()) === 2);

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
  check('one bad file does not discard the good ones', (await page.locator('tbody tr').count()) === 2);
  await axeScan('load error');

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
