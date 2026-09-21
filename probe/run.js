#!/usr/bin/env node
/**
 * Point SCAN at any URL and print what BRIDGE would find.
 *
 *   node run.js <url> [--click <selector>] [--wait <ms>] [--json] [--shot <file>]
 *   node run.js --preset greenhouse
 *
 * --click drives one step transition (e.g. an Apply button) and rescans after it,
 * which is how the multi-step behaviour gets exercised. Nothing is ever submitted.
 */
const { chromium } = require('playwright');
const { SCAN } = require('./scan.js');
const PRESETS = require('./targets.json');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function report(label, r) {
  const bad = r.fields.filter((f) => f.barriers.length);
  console.log('\n' + '='.repeat(72));
  console.log(label);
  console.log('='.repeat(72));
  console.log(`${r.fields.length} fields detected, ${bad.length} with barriers`);
  if (r.stepHint) console.log('step hint:', JSON.stringify(r.stepHint));
  if (r.pageBarriers.length) {
    console.log('\npage barriers:');
    for (const b of r.pageBarriers) console.log('  ', b.rule, '-', b.detail || b.name || b.src || '');
  }
  if (bad.length) {
    console.log('\nfields with barriers:');
    for (const f of bad) {
      console.log('  ', `${f.tag}${f.type ? `[${f.type}]` : ''}`.padEnd(16),
        `role=${f.role || '-'}`.padEnd(16), JSON.stringify(f.name.slice(0, 40)).padEnd(44), f.barriers.join(','));
    }
  }
  const combos = r.fields.filter((f) => f.role === 'combobox' || f.tag === 'select');
  if (combos.length) {
    console.log('\ndropdowns — options readable without opening the widget?');
    for (const f of combos) {
      console.log('  ', f.name.slice(0, 46).padEnd(48), `options=${f.optionsAvailable}`,
        f.optionsAvailable === 0 ? '  <- must be opened to enumerate' : '');
    }
  }
}

(async () => {
  let url = argv.find((a) => a.startsWith('http'));
  const preset = flag('--preset');
  if (preset) {
    const t = PRESETS[preset];
    if (!t) { console.error(`unknown preset "${preset}". known: ${Object.keys(PRESETS).join(', ')}`); process.exit(1); }
    url = t.url;
  }
  if (!url) { console.error('usage: node run.js <url> [--click <selector>] [--wait ms] [--json]'); process.exit(1); }

  const wait = +flag('--wait', preset ? PRESETS[preset].wait || 6000 : 6000);
  const click = flag('--click', preset ? PRESETS[preset].click : undefined);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();

  let hardNavs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) hardNavs++; });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(wait);

  const first = await page.evaluate(SCAN);
  if (has('--json')) console.log(JSON.stringify(first, null, 2));
  else report(`${preset || url}  (initial)`, first);

  if (click) {
    const navsBefore = hardNavs;
    console.log(`\n--> clicking ${click}  (navigation only; nothing is submitted)`);
    await page.click(click, { timeout: 20000 }).catch((e) => console.log('   click failed:', e.message.split('\n')[0]));
    await page.waitForTimeout(wait);
    console.log(`   hard navigations during transition: ${hardNavs - navsBefore}` +
      `  (>0 means the content script is destroyed and state must live in the service worker)`);
    const second = await page.evaluate(SCAN);
    if (has('--json')) console.log(JSON.stringify(second, null, 2));
    else report(`${preset || url}  (after click)`, second);
  }

  const shot = flag('--shot');
  if (shot) { await page.screenshot({ path: shot }); console.log('\nscreenshot ->', shot); }
  await browser.close();
})();
