// ACT + VERIFY: spec §4.3, §4.4, §6.3. Every strategy here passed against a live portal
// in probe/ (§11). Every write is followed by a read-back FROM THE DOM.

import { clean, sleep } from './dom';
import { optionText, refind, refindOptions, type FieldHandle } from './scan';
import type { FillResult } from './types';

const OPTION_SEL = '[role=option],[class*=option],li';

const nativeInput = (o: Element) => (o instanceof HTMLInputElement ? o : o.querySelector<HTMLInputElement>('input'));
const isOn = (o: Element) => nativeInput(o)?.checked ?? o.getAttribute('aria-checked') === 'true';

function mouse(el: Element, types: string[]) {
  for (const t of types) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
}

/** The option the user asked for: exact text first, so "Man" never lands on "Woman"; then
 *  a prefix, then a substring, for a page whose option text carries extras. */
function bestMatch<T>(items: T[], text: (item: T) => string, value: string): T | undefined {
  const v = value.toLowerCase();
  const texts = items.map((item) => text(item).toLowerCase());
  for (const ok of [(a: string) => a === v, (a: string) => a.startsWith(v), (a: string) => a.includes(v)]) {
    const i = texts.findIndex(ok);
    if (i >= 0) return items[i];
  }
  return undefined;
}

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
function comboboxText(el: Element): string {
  if (el instanceof HTMLInputElement && el.value) return el.value;
  let node: Element | null = el;
  for (let d = 0; d < 4 && node; d++) {
    const shown = node.querySelector('[class*=single-value],[class*=singleValue],[class*=value]');
    if (shown && clean(shown.textContent)) return clean(shown.textContent);
    node = node.parentElement;
  }
  return el instanceof HTMLInputElement ? '' : clean(el.textContent);
}

/** "Select…" is not an answer. When the options are known, text that is none of them is
 *  a placeholder and the field is empty; VERIFY must not read it out as a value. */
function comboboxValue(h: FieldHandle, el: Element): string {
  const shown = comboboxText(el);
  if (!h.options?.length) return shown;
  const a = shown.toLowerCase();
  return h.options.some((o) => { const b = o.toLowerCase(); return a === b || a.includes(b) || b.includes(a); }) ? shown : '';
}

function sliderValue(el: Element): string {
  if (el instanceof HTMLInputElement) return el.value;
  const shown = el.querySelector('[class*=value]');
  return el.getAttribute('aria-valuenow') ?? (el as HTMLElement).dataset.value ?? (shown ? clean(shown.textContent) : '');
}

/** Pages that take a date as text say which order they want in the placeholder. */
function formatDate(iso: string, el: HTMLInputElement): string {
  if (el.type === 'date') return iso;
  const [y, m, d] = iso.split('-');
  const ph = el.placeholder.toLowerCase();
  if (/^d+\W+m+\W+y+$/.test(ph)) return `${d}/${m}/${y}`;
  if (/^m+\W+d+\W+y+$/.test(ph)) return `${m}/${d}/${y}`;
  return iso;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // React tracks the last value it set; assigning .value directly is swallowed.
  // Going through the prototype setter makes React observe the change.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- read-back ---------------------------------------------------------------------

export function readValue(h: FieldHandle): string {
  const el = refind(h);
  if (!el) return '';
  switch (h.kind) {
    case 'select': {
      const s = el as HTMLSelectElement;
      return s.selectedIndex >= 0 ? clean(s.options[s.selectedIndex].text) : '';
    }
    case 'radio-group': {
      const checked = refindOptions(h).find((o) => o && isOn(o));
      if (!checked) return '';
      // Visible text, not aria-label: the aria-label may be the question (LinkedIn).
      return optionText(checked);
    }
    case 'checkbox-group':
      return refindOptions(h).filter((o): o is Element => !!o && isOn(o)).map(optionText).join(', ');
    case 'slider':
      return sliderValue(el);
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
      return comboboxValue(h, el);
    case 'date':
      return (el instanceof HTMLInputElement ? el : el.querySelector('input'))?.value ?? '';
    default:
      return (el as HTMLInputElement).value ?? '';
  }
}

// --- write -------------------------------------------------------------------------

export async function fill(fieldId: string, h: FieldHandle, value: string): Promise<FillResult> {
  const el = refind(h);
  if (!el) return { fieldId, ok: false, strategy: 'resolve', readBack: '', error: 'The field is no longer on the page.' };

  let strategy = '';
  let expected = value;

  try {
    switch (h.kind) {
      case 'select': {
        strategy = 'native select';
        const s = el as HTMLSelectElement;
        const opt = bestMatch([...s.options], (o) => clean(o.text), value);
        if (!opt) return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${value}".` };
        s.value = opt.value;
        s.dispatchEvent(new Event('input', { bubbles: true }));
        s.dispatchEvent(new Event('change', { bubbles: true }));
        expected = clean(opt.text);
        break;
      }
      case 'radio-group': {
        strategy = 'click';
        const target = bestMatch(refindOptions(h).filter((o): o is Element => !!o), optionText, value);
        if (!target) return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${value}".` };
        // Prefer the native input inside an ARIA wrapper: that is what the page's own
        // handler listens to (LinkedIn's div[role=radio] > input[type=radio]).
        const native = target instanceof HTMLInputElement ? target : target.querySelector('input[type=radio]');
        (native as HTMLElement || target as HTMLElement).click();
        if (native) strategy = 'click (native input inside ARIA wrapper)';
        expected = optionText(target);
        break;
      }
      case 'checkbox-group': {
        // `value` is a JSON array of the option texts that should end up checked.
        strategy = 'click each option into the wanted state';
        const wanted = JSON.parse(value) as string[];
        const opts = refindOptions(h);
        if (opts.some((o) => !o)) return { fieldId, ok: false, strategy, readBack: readValue(h), error: 'An option is no longer on the page.' };
        const unknown = wanted.filter((w) => !opts.some((o) => optionText(o!) === w));
        if (unknown.length) return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${unknown.join('", "')}".` };
        for (const o of opts as Element[]) {
          if (isOn(o) !== wanted.includes(optionText(o))) ((nativeInput(o) || o) as HTMLElement).click();
        }
        expected = (opts as Element[]).map(optionText).filter((t) => wanted.includes(t)).join(', ');
        break;
      }
      case 'slider': {
        const n = Number(value);
        if (!Number.isFinite(n)) return { fieldId, ok: false, strategy: 'slider', readBack: readValue(h), error: `"${value}" is not a number.` };
        // The strategy is chosen by the control's shape, never by a previous failure (§8).
        if (el instanceof HTMLInputElement) {
          strategy = 'native range setter';
          setNativeValue(el, String(n));
        } else if (el.getAttribute('role') === 'slider' && (el as HTMLElement).tabIndex >= 0) {
          strategy = 'keyboard (Home, then ArrowRight per step)';
          if (!h.range) return { fieldId, ok: false, strategy, readBack: readValue(h), error: 'The slider does not publish its range.' };
          (el as HTMLElement).focus();
          const key = (k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
          key('Home');
          for (let k = 0; k < Math.round((n - h.range.min) / h.range.step); k++) key('ArrowRight');
        } else {
          strategy = 'pointer on the track';
          if (!h.range) return { fieldId, ok: false, strategy, readBack: readValue(h), error: 'The slider does not publish its range.' };
          const track = el.querySelector('[class*=track]') || el;
          const r = track.getBoundingClientRect();
          const x = r.left + ((n - h.range.min) / (h.range.max - h.range.min)) * r.width;
          const at = { bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, button: 0 };
          // The order a real press produces: each pointer event, then its mouse twin.
          for (const [p, m] of [['pointerdown', 'mousedown'], ['pointermove', 'mousemove'], ['pointerup', 'mouseup']]) {
            track.dispatchEvent(new PointerEvent(p, { ...at, pointerId: 1, isPrimary: true }));
            track.dispatchEvent(new MouseEvent(m, at));
          }
        }
        expected = String(n);
        break;
      }
      case 'date': {
        strategy = 'underlying input, prototype value setter';
        const input = el instanceof HTMLInputElement ? el : el.querySelector('input');
        if (!input) return { fieldId, ok: false, strategy, readBack: readValue(h), error: 'The date picker has no text input to write to.' };
        expected = formatDate(value, input);
        setNativeValue(input, expected);
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
        const target = bestMatch(options, (o) => clean(o.textContent), value);
        if (!target) {
          await close();
          return { fieldId, ok: false, strategy, readBack: readValue(h), error: `No option matching "${value}".` };
        }
        expected = clean(target.textContent);
        mouse(target, ['mousedown', 'mouseup', 'click']);
        break;
      }
      case 'text':
      case 'textarea': {
        strategy = 'prototype value setter';
        setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, value);
        break;
      }
      case 'unknown':
        return { fieldId, ok: false, strategy: 'none', readBack: '', error: 'BRIDGE does not know how to operate this control.' };
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
