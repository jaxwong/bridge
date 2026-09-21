#!/usr/bin/env node
/**
 * Validates the ACT write strategies from spec §6.3 against a live portal.
 *
 * The question this answers: synthetic events carry isTrusted:false. Do real
 * widget libraries ignore them? If they do, BRIDGE needs chrome.debugger and the
 * install warning that comes with it. Every write is followed by a read-back from
 * the DOM, which is exactly what VERIFY does.
 *
 *   node act.js            # runs against Greenhouse
 *   node act.js --url <u>  # any page with a react-select and a file input
 *
 * Fills fields but never submits.
 */
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_ = flag('--url', 'https://job-boards.greenhouse.io/gitlab/jobs/8556658002');

const ok = (b) => (b ? 'PASS' : 'FAIL');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // --- 1. React-controlled text input -------------------------------------
  // Assigning .value directly is swallowed by React's value tracker; going
  // through the prototype setter makes React observe the change.
  const t1 = await page.evaluate(async () => {
    const el = document.querySelector('input[type=text]:not([aria-hidden=true])');
    if (!el) return { skipped: true };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'Zheng Wei');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    return { readBack: el.value, field: el.id || el.name };
  });
  console.log('1. react text input via prototype setter');
  console.log(`   field=${t1.field} read-back=${JSON.stringify(t1.readBack)} -> ${ok(t1.readBack === 'Zheng Wei')}`);

  // --- 2. Custom dropdown: open, enumerate, pick, read back ----------------
  for (const mode of ['mouse', 'keyboard']) {
    const r = await page.evaluate(async (mode) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const combos = [...document.querySelectorAll('[role=combobox]')].filter((e) => e.offsetParent !== null);
      // skip phone country-code pickers: they render a dial code, not the option text
      const input = combos.find((e) => !/phone|country.?code/i.test(e.id + ' ' + (e.getAttribute('aria-label') || ''))) || combos[0];
      if (!input) return { skipped: true };
      let ctrl = input;
      while (ctrl && !/select__control/.test(ctrl.className || '')) ctrl = ctrl.parentElement;
      const container = ctrl ? ctrl.parentElement : input.parentElement;
      const opts = () => {
        const id = input.getAttribute('aria-controls');
        const menu = id ? document.getElementById(id) : container.querySelector('[class*=menu]');
        return menu ? [...menu.querySelectorAll('[role=option],[class*=option]')] : [];
      };

      if (mode === 'mouse') {
        (ctrl || input).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
        (ctrl || input).dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      } else {
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
      }
      await sleep(700);
      const found = opts();
      const target = found[found.length - 1];
      if (target && mode === 'mouse') {
        for (const t of ['mousedown', 'mouseup', 'click']) {
          target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
        }
      } else if (target) {
        for (let i = 1; i < found.length; i++) {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
          await sleep(40);
        }
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      await sleep(800);
      const sv = container.querySelector('[class*=single-value]');
      return {
        expanded: input.getAttribute('aria-expanded'),
        optionCount: found.length,
        options: found.map((o) => o.textContent.trim()).slice(0, 6),
        picked: target && target.textContent.trim(),
        readBack: sv ? sv.textContent.trim() : null,
      };
    }, mode);
    console.log(`\n2${mode === 'mouse' ? 'a' : 'b'}. custom dropdown via synthetic ${mode}`);
    if (r.skipped) { console.log('   no combobox on page, skipped'); continue; }
    console.log(`   aria-expanded=${r.expanded} options=${r.optionCount} ${JSON.stringify(r.options)}`);
    const related = !!r.readBack && !!r.picked &&
      (r.readBack === r.picked || r.picked.includes(r.readBack) || r.readBack.includes(r.picked));
    console.log(`   picked=${JSON.stringify(r.picked)} read-back=${JSON.stringify(r.readBack)} -> ${ok(related)}`);
    if (mode === 'mouse') await page.reload({ waitUntil: 'domcontentloaded' }), await page.waitForTimeout(5000);
  }

  // --- 3. File upload ------------------------------------------------------
  // input.value cannot be set from script on any browser or OS. But a File built
  // in-page and handed over via DataTransfer is accepted — no OS-specific code.
  const b64 = Buffer.from('%PDF-1.4 bridge probe fixture\n').toString('base64');
  const t3 = await page.evaluate(async (b64) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const inp = document.querySelector('input[type=file]');
    if (!inp) return { skipped: true };
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([arr], 'bridge-probe.pdf', { type: 'application/pdf' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2500);
    return { filesLen: inp.files.length, uiShowsName: document.body.innerText.includes('bridge-probe.pdf') };
  }, b64);
  console.log('\n3. file upload via DataTransfer on the file input');
  if (t3.skipped) console.log('   no file input, skipped');
  else console.log(`   input.files=${t3.filesLen} page rendered the filename=${t3.uiShowsName} -> ${ok(t3.uiShowsName)}`);

  await browser.close();
})();
