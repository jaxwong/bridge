// ACT + VERIFY: spec §4.3, §4.4, §6.3. Every strategy here passed against a live portal
// in probe/ (§11). Every write is followed by a read-back FROM THE DOM.

import { accName, clean, sleep } from './dom';
import type { FieldHandle } from './scan';
import type { FillResult } from './types';

const OPTION_SEL = '[role=option],[class*=option],li';

/** Re-find an element a framework may have replaced since SCAN. */
export function resolve(el: Element, selector: string): Element | null {
  if (el.isConnected) return el;
  try { return document.querySelector(selector); } catch { return null; }
}

function mouse(el: Element, types: string[]) {
  for (const t of types) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
}

const matches = (text: string, value: string) => {
  const a = text.toLowerCase(), b = value.toLowerCase();
  return a === b || a.startsWith(b) || a.includes(b);
};

// --- custom dropdowns ---------------------------------------------------------------
// Options usually do not exist until the widget is opened (every react-select on
// Greenhouse, §6.3), so they are found as the option-like elements that APPEAR on open.

async function openAndCollect(el: Element): Promise<{ options: Element[]; close: () => Promise<void> }> {
  const before = new Set(document.querySelectorAll(OPTION_SEL));
  mouse(el, ['mousedown', 'mouseup']);
  await sleep(300);
  const owns = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
  const menu = owns ? document.getElementById(owns) : null;
  const pool = menu ? [...menu.querySelectorAll(OPTION_SEL)] : [...document.querySelectorAll(OPTION_SEL)].filter((o) => !before.has(o));
  const options = pool.filter((o) => (o as HTMLElement).offsetParent !== null && clean(o.textContent));
  return {
    options,
    close: async () => {
      if (options.some((o) => o.isConnected && (o as HTMLElement).offsetParent !== null)) {
        mouse(el, ['mousedown', 'mouseup']);
        await sleep(200);
      }
    },
  };
}

export async function harvestOptions(el: Element): Promise<string[]> {
  const { options, close } = await openAndCollect(el);
  const texts = options.map((o) => clean(o.textContent));
  await close();
  return texts;
}

/** What the page now shows as the selection. A custom combobox rarely keeps it on the
 *  element that was written to; react-select renders it in a sibling node. */
function comboboxValue(el: Element): string {
  if (el instanceof HTMLInputElement && el.value) return el.value;
  let node: Element | null = el;
  for (let d = 0; d < 4 && node; d++) {
    const shown = node.querySelector('[class*=single-value],[class*=singleValue],[class*=value]');
    if (shown && clean(shown.textContent)) return clean(shown.textContent);
    node = node.parentElement;
  }
  return el instanceof HTMLInputElement ? '' : clean(el.textContent);
}

// --- read-back ---------------------------------------------------------------------

export function readValue(h: FieldHandle): string {
  const el = resolve(h.el, h.selector);
  if (!el) return '';
  switch (h.kind) {
    case 'select': {
      const s = el as HTMLSelectElement;
      return s.selectedIndex >= 0 ? clean(s.options[s.selectedIndex].text) : '';
    }
    case 'radio-group': {
      const opts = (h.optionEls || []).map((o, i) => resolve(o, h.optionSelectors![i])).filter(Boolean) as Element[];
      const checked = opts.find((o) => {
        const native = o instanceof HTMLInputElement ? o : o.querySelector('input[type=radio]') as HTMLInputElement | null;
        return native ? native.checked : o.getAttribute('aria-checked') === 'true';
      });
      if (!checked) return '';
      // Visible text, not aria-label: the aria-label may be the question (LinkedIn).
      return clean(checked.textContent) || accName(checked).name;
    }
    case 'checkbox': {
      const native = el instanceof HTMLInputElement ? el : el.querySelector('input') as HTMLInputElement | null;
      const on = native ? native.checked : el.getAttribute('aria-checked') === 'true';
      return on ? 'checked' : 'not checked';
    }
    case 'file': {
      const files = (el as HTMLInputElement).files;
      return files && files.length ? files[0].name : '';
    }
    case 'combobox':
      return comboboxValue(el);
    default:
      return (el as HTMLInputElement).value ?? '';
  }
}

// --- write -------------------------------------------------------------------------

export async function fill(fieldId: string, h: FieldHandle, value: string): Promise<FillResult> {
  const el = resolve(h.el, h.selector);
  if (!el) return { fieldId, ok: false, strategy: 'resolve', readBack: '', error: 'The field is no longer on the page.' };

  let strategy = '';
  let expected = value;

  try {
    switch (h.kind) {
      case 'select': {
        strategy = 'native select';
        const s = el as HTMLSelectElement;
        const opt = [...s.options].find((o) => matches(clean(o.text), value));
        if (!opt) return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${value}".` };
        s.value = opt.value;
        s.dispatchEvent(new Event('input', { bubbles: true }));
        s.dispatchEvent(new Event('change', { bubbles: true }));
        expected = clean(opt.text);
        break;
      }
      case 'radio-group': {
        strategy = 'click';
        const opts = (h.optionEls || []).map((o, i) => resolve(o, h.optionSelectors![i]));
        const i = opts.findIndex((o) => o && matches(clean(o.textContent) || accName(o).name, value));
        if (i < 0) return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${value}".` };
        const target = opts[i]!;
        // Prefer the native input inside an ARIA wrapper: that is what the page's own
        // handler listens to (LinkedIn's div[role=radio] > input[type=radio]).
        const native = target instanceof HTMLInputElement ? target : target.querySelector('input[type=radio]');
        (native as HTMLElement || target as HTMLElement).click();
        if (native) strategy = 'click (native input inside ARIA wrapper)';
        expected = clean(target.textContent) || value;
        break;
      }
      case 'checkbox': {
        strategy = 'click';
        const want = /^(true|checked|yes|on)$/i.test(value);
        if ((readValue(h) === 'checked') !== want) {
          const native = el instanceof HTMLInputElement ? el : el.querySelector('input');
          ((native || el) as HTMLElement).click();
        }
        expected = want ? 'checked' : 'not checked';
        break;
      }
      case 'file': {
        // input.value cannot be set from script on any OS; a File assigned via
        // DataTransfer can (§6.3). `value` is JSON {name, type, data(base64)}.
        strategy = 'DataTransfer -> input.files';
        const { name, type, data } = JSON.parse(value) as { name: string; type: string; data: string };
        const bin = atob(data);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name, { type }));
        (el as HTMLInputElement).files = dt.files;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        expected = name;
        break;
      }
      case 'combobox': {
        // Synthetic mouse only: synthetic keyboard does not open react-select (§6.3).
        strategy = 'synthetic mouse (open, pick option)';
        const { options, close } = await openAndCollect(el);
        const target = options.find((o) => matches(clean(o.textContent), value));
        if (!target) {
          await close();
          return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${value}".` };
        }
        expected = clean(target.textContent);
        mouse(target, ['mousedown', 'mouseup', 'click']);
        break;
      }
      default: {
        // React tracks the last value it set; assigning .value directly is swallowed.
        // Going through the prototype setter makes React observe the change.
        strategy = 'prototype value setter';
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } catch (e) {
    return { fieldId, ok: false, strategy, readBack: readValue(h), error: String(e) };
  }

  await sleep(400);
  const readBack = readValue(h);
  // Exact for controls that hold the value itself. Fuzzy only where the page renders the
  // selection in its own words: react-select shows "+263" for "Zimbabwe +263".
  const fuzzy = h.kind === 'combobox' || h.kind === 'radio-group';
  const a = readBack.toLowerCase(), b = expected.toLowerCase();
  const ok = !!readBack && (a === b || (fuzzy && (a.includes(b) || b.includes(a))));
  return { fieldId, ok, strategy, readBack };
}
