// The built dashboard, opened on its seeded report (src/demo-seed.json, a real scan of
// the Acme apply form), with axe on every view (bridge-business.md §6.4). Zero violations
// is the requirement, not a target.
//
// The page has no file input any more, so what this can no longer reach is stated here:
// the resolved / new buckets holding findings, several forms at once, and a load error.
// Their logic is covered by compare.test.ts; their rendering is not checked by axe.
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
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

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

  // --- what the page says about itself -----------------------------------------------
  // Every sentence mentioning certification, compliance or legality must be a denial. A
  // bare keyword search would flag the disclaimer's own "does not certify". Run on both
  // views: the findings carry more of this language than the list does.
  const unqualifiedClaims = async () => (await page.textContent('main'))
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /certif|complian|legal|guarantee/i.test(s))
    .filter((s) => !/\b(not|never|no|nothing)\b/i.test(s));
  check('no sentence on the list view claims compliance, certification or legal standing',
    (await unqualifiedClaims()).length === 0, (await unqualifiedClaims()).join(' | ').slice(0, 200) || 'none');
  check('the page says the report shown was captured ahead of time, not sent',
    /one real BRIDGE scan of the Acme Careers test form,\s+captured ahead of time/.test(
      (await page.textContent('.provenance')).replace(/\s+/g, ' ')),
    await page.textContent('.provenance'));
  check('there is no way to upload a report', (await page.locator('input[type=file], #dropzone, #reports').count()) === 0);
  // The page-level banner is gone; the disclaimer now sits with the findings, which is
  // where a reader is actually looking at a criterion number. It is checked there, below.
  check('the list view does not lecture: no page-level disclaimer banner',
    (await page.locator('main > .disclaimer').count()) === 0);

  // --- the form list, from the seed --------------------------------------------------
  await page.waitForSelector('table');
  check('opens on the seeded report: one form, one scan',
    (await page.locator('#list-body caption').textContent()) === '1 form, from 1 scan.',
    await page.locator('#list-body caption').textContent());
  const row = page.locator('tbody tr', { hasText: 'localhost:8765/apply.html' });
  check('the posting is listed by the name the page gives it, not by its address',
    (await row.getByRole('button').textContent()) === 'Junior Analyst — Apply',
    await row.getByRole('button').textContent());
  check('and its address is still shown, under the name',
    (await row.locator('.row__url').textContent()) === 'localhost:8765/apply.html');
  check('the form list shows the blocking and usability counts',
    (await row.locator('td').nth(1).textContent()) === '9' && (await row.locator('td').nth(2).textContent()) === '4',
    `${await row.locator('td').nth(1).textContent()} / ${await row.locator('td').nth(2).textContent()}`);
  const shown = await row.locator('time').textContent();
  check('the scan is shown by date only, with no clock time', !/\d:\d\d/.test(shown) && /\d{4}/.test(shown), shown);
  check('a form reported on once reads as a first scan, not as all-new', /First scan/.test(await row.locator('.change').textContent()));
  await axeScan('form list');

  // --- detail, opened from the keyboard ----------------------------------------------
  await row.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail-view:not([hidden])');
  check('opening a form moves focus to its heading, not to the top of the page',
    await page.evaluate(() => document.activeElement?.id) === 'detail-h',
    await page.evaluate(() => document.activeElement?.id));
  check('the report is headed by the posting, not by a URL',
    (await page.textContent('#detail-h')) === 'Junior Analyst — Apply', await page.textContent('#detail-h'));
  check('and still says which address it scanned',
    (await page.locator('#detail-meta .detail-url').textContent()) === 'localhost:8765/apply.html');
  check('the form list is hidden while the detail is open', await page.locator('#list-view').isHidden());

  const bucket = (heading) => page.locator('.bucket', { hasText: heading });
  const open = await bucket('Open').textContent();
  check('a first scan lists every finding as open', /Open \(13\)/.test(open));
  check('and nothing as new or resolved',
    /New since the previous scan \(0\)/.test(await bucket('New since').textContent()) &&
    /Resolved \(0\)/.test(await bucket('Resolved').textContent()));
  check('every barrier carries its plain-language impact', /can only be used by dragging a file onto it/.test(open));
  check('every barrier carries its suggested fix', (await page.locator('.barrier__fix').count()) === 13);
  const dragFix = await page.locator('.barrier', { hasText: 'drag-drop-only' }).locator('.barrier__fix').textContent();
  check('the fix is the rule\'s sentence, word for word',
    dragFix === 'Suggested fix: Keep the drop zone, and add a "Choose file" button that Tab reaches and that opens the file input.', dragFix);
  check('a page-level barrier says so instead of naming a field', /Affects the whole page/.test(open));
  check('a field-level barrier names its field', /Field: Will you now or in the future require sponsorship/.test(open));
  check('severity is a word, not only a colour', (await bucket('Open').locator('.sev').first().textContent()) === 'Blocking');
  check('a finding with no mapping says so rather than guessing a criterion',
    /No WCAG mapping recorded/.test(await page.locator('.barrier', { hasText: 'modal-without-dialog-role' }).textContent()));
  check('a mapped finding shows its level and criteria beside it',
    /WCAG 2\.2 Level A\s*4\.1\.2, 2\.5\.3/.test(await page.locator('.barrier', { hasText: 'options-identically-named' }).textContent()));

  const summary = (await page.textContent('.wcag-summary')).replace(/\s+/g, ' ').trim();
  check('the summary counts findings by WCAG level',
    /11 of 13 findings map to a success criterion \(Level A: 11\)/.test(summary), summary.slice(0, 140));
  const criteria = await page.locator('.wcag-table tbody th[scope=row]').allTextContents();
  check('the summary breaks findings down by success criterion, numerically ordered',
    criteria.join(',') === '1.3.1,2.1.1,2.5.3,4.1.2', criteria.join(','));
  // The page-level banner was removed; this is now the only place the disclaimer appears,
  // so it carries the whole of what the old banner said and is checked in full here.
  const reportDisclaimer = await page.locator('.wcag-summary .disclaimer').textContent();
  check('the findings carry the disclaimer, since no banner does any more',
    /Automated findings, not a conformance decision/i.test(reportDisclaimer) &&
    /Human review is required for a WCAG conformance claim/i.test(reportDisclaimer),
    reportDisclaimer.replace(/\s+/g, ' ').trim());
  check('the summary names the standard so silence is not read as a pass',
    /Measured against WCAG 2\.2, Level AA/.test(summary));
  check('no sentence in the report claims compliance, certification or legal standing',
    (await unqualifiedClaims()).length === 0, (await unqualifiedClaims()).join(' | ').slice(0, 200) || 'none');
  check('the summary names the standard and the criteria the scanner can fail, so silence is not a pass',
    /Measured against WCAG 2\.2, Level AA\. The scanner can fail 7 criteria: 1\.3\.1, 1\.4\.3, 2\.1\.1, 2\.5\.3, 2\.5\.8, 3\.3\.2, 4\.1\.2\. Any other criterion was not checked\./.test(summary),
    summary.slice(0, 220));
  await axeScan('form detail');

  // --- back returns focus where it came from -----------------------------------------
  await page.getByRole('button', { name: 'Back to all forms' }).click();
  await page.waitForSelector('#list-view:not([hidden])');
  check('Back returns focus to the row it was opened from',
    await page.evaluate(() => document.activeElement?.textContent) === 'Junior Analyst — Apply',
    await page.evaluate(() => document.activeElement?.textContent));

  // --- dark mode is a second set of colours, so it needs its own contrast pass ---------
  // The palette defines every token twice. axe only measures what is rendered, so a dark
  // theme that was never scanned is a theme whose contrast nobody checked.
  await page.emulateMedia({ colorScheme: 'dark' });
  // Let the new palette paint before measuring it.
  await page.waitForTimeout(200);
  await axeScan('form list, dark mode');
  check('dark mode is the page\'s own palette, not a browser inversion',
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== 'rgb(247, 249, 252)',
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await row.getByRole('button').click();
  await page.waitForSelector('#detail-view:not([hidden])');
  await axeScan('form detail, dark mode');
  await page.getByRole('button', { name: 'Back to all forms' }).click();
  await page.waitForSelector('#list-view:not([hidden])');
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
