// The monitor: bridge-business.md §6.2. Loads each URL in headless Chromium, runs the
// BRIDGE scanner against it, and writes one barrier report per URL per run.
//
//   node run.mjs urls.txt
//
// The scanner is not reimplemented here. extension/lib/ is plain DOM code with no use of
// any chrome.* API, so scanPage() and toReport() are bundled straight out of the extension
// and injected. Every rule the monitor reports is the rule the applicant's extension
// reports, because it is the same source file.
//
// SCAN only. It never fills a field, never clicks anything, never submits. It does not even
// open custom dropdowns to enumerate their options — the extension does that for TRANSLATE
// (spec §6.3), but the barrier report carries no options, so the monitor has no reason to
// touch a real employer's page at all.

import { ArgError, USAGE, parseArgs } from './args.mjs';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.resolve(here, '../reports');

// Ceilings on every external call, stated once. A posting that has expired, moved behind a
// login, or gone slow fails that URL and the run continues.
const NAV_TIMEOUT = 30_000;
const CONTROL_TIMEOUT = 15_000;
/** After the first control appears, give a framework time to finish rendering the rest. */
const SETTLE_MS = 1_500;

const CONTROLS = 'input,select,textarea,[role=combobox],[role=radio],[role=checkbox]';
/** A password field means a sign-in or account-creation page, not a public application
 *  form. BRIDGE never signs in, so the URL is reported rather than scanned. */
const PASSWORD = 'input[type=password]';

/** Directory name for a form. Derived from the report, so it always matches the grouping
 *  the dashboard does — which reads portal and pagePath from inside the file, not from here. */
const slugOf = (report) =>
  `${report.portal}${report.pagePath}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';

/** ISO with the colons taken out, so the name is a legal file name everywhere. */
const stampOf = (iso) => iso.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

async function readUrls(file) {
  const text = await readFile(file, 'utf8');
  const urls = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (urls.length === 0) throw new Error(`${file} lists no URLs`);
  for (const u of urls) {
    // Validate every URL before opening a browser, rather than failing one at a time later.
    try { new URL(u); } catch { throw new Error(`${file}: "${u}" is not a URL`); }
  }
  return urls;
}

/** The extension's scanner, bundled for injection. Built once per run. */
async function buildScanner() {
  const built = await esbuild.build({
    stdin: {
      contents: [
        "import { scanPage } from '../extension/lib/scan';",
        "import { toReport } from '../extension/lib/report';",
        // scanPage() also returns element handles for ACT. They stay in the page; only the
        // report, which is plain JSON, crosses back out.
        'window.__bridgeReport = () => toReport(scanPage().result);',
      ].join('\n'),
      resolveDir: here,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  });
  return built.outputFiles[0].text;
}

async function scanOne(context, scanner, url) {
  const page = await context.newPage();
  const submissions = [];
  try {
    // A form submission is a non-GET document request. Nothing here interacts with the page,
    // so this can only fire if a page script tries to submit by itself — and then it is
    // stopped rather than trusted. Data fetches (XHR/fetch POSTs) are left alone so SPAs
    // still render.
    await page.route('**/*', (route) => {
      const request = route.request();
      if (request.resourceType() === 'document' && request.method() !== 'GET') {
        submissions.push(`${request.method()} ${request.url()}`);
        return route.abort();
      }
      return route.continue();
    });

    const response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    if (response && !response.ok()) {
      throw new Error(`the page returned HTTP ${response.status()} ${response.statusText()}`);
    }

    // No controls means no form was reached: an expired posting, a login wall, or a render
    // that never finished. Writing a report anyway would put a form with zero barriers on
    // the dashboard, which reads as "this one is fine".
    await page.waitForSelector(CONTROLS, { timeout: CONTROL_TIMEOUT, state: 'attached' })
      .catch(() => { throw new Error(`no form controls appeared within ${CONTROL_TIMEOUT / 1000}s — expired posting, a login wall, or a page that never finished rendering`); });
    await page.waitForTimeout(SETTLE_MS);

    // Scanning the sign-in page and filing it as the employer's application form would put
    // a wrong report on the dashboard. bridge-business.md §5 lists forms behind a login as
    // out of what the monitor can see, so this is reported, never worked around.
    if (await page.locator(PASSWORD).count() > 0) {
      throw new Error('the page has a password field, so it is a sign-in or account-creation page rather than a public application form — BRIDGE never signs in');
    }

    await page.evaluate(scanner);
    const report = await page.evaluate(() => window.__bridgeReport());

    if (submissions.length) {
      throw new Error(`the page tried to submit while being scanned, and was stopped: ${submissions.join(', ')}`);
    }
    return report;
  } finally {
    await page.close();
  }
}

// --- run -------------------------------------------------------------------------------

let parsedArgs;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof ArgError)) throw e;
  console.error(`${e.message}\n\n${USAGE}`);
  process.exit(2);
}

const urls = parsedArgs.mode === 'url' ? [parsedArgs.url] : await readUrls(path.resolve(parsedArgs.file));
const scanner = await buildScanner();
console.log(`Scanning ${urls.length} ${urls.length === 1 ? 'URL' : 'URLs'} with the BRIDGE scanner. SCAN only — nothing is filled in or submitted.\n`);

const browser = await chromium.launch();
const context = await browser.newContext();
const failures = [];
let written = 0;

try {
  for (const url of urls) {
    try {
      const report = await scanOne(context, scanner, url);
      const dir = path.join(REPORTS, slugOf(report));
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${stampOf(report.generatedAt)}.json`);
      await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
      written += 1;
      const blocking = [...report.barriers, ...report.pageBarriers].filter((b) => b.severity === 'blocking').length;
      console.log(`  ok    ${url}`);
      console.log(`        ${report.barriers.length} field + ${report.pageBarriers.length} page barriers, ${blocking} blocking`);
      console.log(`        -> ${path.relative(process.cwd(), file)}`);
    } catch (e) {
      failures.push({ url, reason: e.message });
      console.log(`  FAIL  ${url}`);
      console.log(`        ${e.message}`);
    }
  }
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n${written} of ${urls.length} scanned. Reports in ${path.relative(process.cwd(), REPORTS)}/`);
if (failures.length) {
  // Loud on purpose. A posting that expired between the last run and the demo has to be
  // noticed now, not on stage (bridge-business.md §9).
  console.error(`\n${failures.length} URL${failures.length === 1 ? '' : 's'} produced no report:`);
  for (const f of failures) console.error(`  ${f.url}\n    ${f.reason}`);
  process.exit(1);
}
