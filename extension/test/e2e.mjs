// End-to-end: the built extension, the Acme Careers page, and the side panel driven as an
// ordinary page pointed at the test tab (spec §8). Covers SCAN -> TRANSLATE -> ACT -> VERIFY.
// Not covered here, by design: sidePanel.open(), focus moving into the panel, and anything
// a screen reader hears. Those are manual (probe/screen-reader-testing.md).

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../.output/chrome-mv3');
const FIXTURE = readFileSync(path.join(here, 'fixtures/acme/index.html'));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = createServer((_q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(FIXTURE); });
await new Promise((r) => server.listen(8765, r));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  const page = await ctx.newPage();
  await page.goto('http://localhost:8765/');

  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost/*' }))[0]?.id);
  check('found the test tab', typeof tabId === 'number', `tabId=${tabId}`);

  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await panel.waitForFunction(() => !document.getElementById('summary').textContent.startsWith('Scanning'), null, { timeout: 15000 });

  // --- SCAN -------------------------------------------------------------------------
  const summary = await panel.textContent('#summary');
  check('SCAN finds 4 questions', /^4 questions found/.test(summary), summary);
  const barriers = await panel.textContent('#barriers');
  check('reports the identically-named Yes/No options', /sound identical/.test(barriers));
  check('reports the custom dropdown', /custom dropdown/.test(barriers));
  check('reports the dropdown is not keyboard operable', /cannot be reached with the keyboard/.test(barriers));

  // --- TRANSLATE --------------------------------------------------------------------
  // The page names both radio options with the question. The panel must name them Yes / No.
  const legend = await panel.locator('fieldset legend').first().textContent();
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
  await status('Full name').filter({ hasText: /On the page|Could not/ }).waitFor();
  check('text: written to the page', await page.inputValue('#name') === 'Zheng Wei');
  check('text: panel reports the DOM read-back', /On the page: Zheng Wei/.test(await status('Full name').textContent()));
  // Page order: the question after "Full name" is the education dropdown.
  const focusedLabel = await panel.evaluate(() => {
    const a = document.activeElement;
    return a?.id ? document.querySelector(`label[for="${a.id}"]`)?.textContent || '' : '';
  });
  check('focus moves to the NEXT question on the page after an answer', /Highest education/.test(focusedLabel), focusedLabel);

  await panel.getByLabel(/Highest education/).selectOption("Bachelor's");
  await panel.getByRole('button', { name: /Write Highest education/ }).click();
  await page.waitForFunction(() => document.querySelector('#edu').dataset.value, null, { timeout: 5000 }).catch(() => {});
  check('custom dropdown: written to the page', await page.textContent('.dropdown__value') === "Bachelor's");

  await panel.getByRole('radio', { name: 'No', exact: true }).check();
  await panel.getByRole('button', { name: /Write Will you now/ }).click();
  await page.waitForTimeout(700);
  check('visa radio: "No" checked on the page', await page.isChecked('#visa-no') && !(await page.isChecked('#visa-yes')));

  // A page that silently discards the write must produce a failure, never a success (§4.3).
  await panel.getByLabel('Earliest start date').fill('1 October 2026');
  await panel.getByRole('button', { name: 'Write Earliest start date to page' }).click();
  await status('Earliest start date').filter({ hasText: /On the page|Could not/ }).waitFor();
  const startStatus = await status('Earliest start date').textContent();
  check('a write the page discards is reported as a failure', /^Could not fill/.test(startStatus), startStatus);
  await panel.waitForTimeout(150);
  check('the failure is announced', /Could not fill Earliest start date/.test(await panel.textContent('#live')));

  // --- VERIFY -----------------------------------------------------------------------
  const order = await panel.locator('#questions .q').evaluateAll((qs) =>
    qs.map((q) => q.querySelector('label, legend')?.textContent?.slice(0, 20)));
  check('questions are asked in page order',
    /Full name/.test(order[0]) && /Highest/.test(order[1]) && /Will you/.test(order[2]) && /Earliest/.test(order[3]),
    order.join(' | '));
  await panel.getByRole('button', { name: 'Read back everything from the page' }).click();
  await panel.waitForFunction(() => document.querySelectorAll('#verify-results li').length > 0);
  const verified = await panel.locator('#verify-results').textContent();
  check('VERIFY reads every answer back from the page',
    verified.includes('Zheng Wei') && verified.includes("Bachelor's") && verified.includes('No'), verified.replace(/\s+/g, ' '));
  check('VERIFY reports the discarded field as empty', /Earliest start date: empty/.test(verified));
  await panel.waitForTimeout(150);
  check('VERIFY summary is announced', /Your application contains/.test(await panel.textContent('#live')));

  // --- never submits ----------------------------------------------------------------
  check('BRIDGE did not submit the form', (await page.textContent('#result')) === '');

  // --- the panel itself is accessible (§6.6) ----------------------------------------
  await panel.evaluate(AXE);
  const axe = await panel.evaluate(async () => (await window.axe.run(document)).violations
    .map((v) => `${v.id} (${v.nodes.length})`));
  check('side panel: zero axe violations', axe.length === 0, axe.join(', ') || 'none');
} finally {
  await ctx.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
