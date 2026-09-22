// SCAN: spec §4.1, §6.2. Ported from probe/scan.js, scoped to the form (§6.5) so the page
// behind a modal does not leak into the field list.

import {
  CONTROLS, accName, ariaHidden, clean, cssPath, deepQueryAll, formScope, keyboardReachable,
  lightAnchor, nearbyText, queryPath, visible,
} from './dom';
import { barrier } from './rules';
import type { Barrier, ControlKind, FieldDescriptor, ScanResult, StepHint } from './types';

/** What the content script keeps so ACT can find the element again. Never leaves the page. */
export interface FieldHandle {
  kind: ControlKind;
  el: Element;
  selector: string;
  /** With `ordinal`, re-finds the control after a re-render changed its path (§8.1). */
  label: string;
  ordinal: number;
  /** Groups: one entry per option, in the same order as FieldDescriptor.options. */
  optionEls?: Element[];
  optionSelectors?: string[];
  /** Custom dropdowns: harvested options, so read-back can tell a selection from a placeholder. */
  options?: string[];
  range?: { min: number; max: number; step: number };
}

// Matched against whole WORDS of a class name, never substrings: "candidate", "update" and
// "validate" all contain "date", and "selected" contains "select".
const SLIDER_WORDS = new Set(['slider', 'range']);
const DATE_WORDS = new Set(['date', 'datepicker', 'calendar']);
const WIDGET_WORDS = new Set([...SLIDER_WORDS, ...DATE_WORDS, 'select', 'dropdown', 'combo', 'combobox', 'picker']);

/** "dropdown__value dateRange-input" -> dropdown, value, date, range, input */
function classWords(el: Element): string[] {
  const cls = typeof el.className === 'string' ? el.className : '';
  return cls.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
const hasWord = (el: Element, words: Set<string>) => classWords(el).some((w) => words.has(w));

/** Candidate controls inside the form, outermost only: an ARIA wrapper and the native
 *  input inside it are one control to the user (LinkedIn's radios). */
function candidates(scope: Element): Element[] {
  const set = new Set<Element>(deepQueryAll(scope, CONTROLS));

  // Custom widgets: look clickable, are named like a widget, contain no real control.
  deepQueryAll(scope, 'div,span,li').forEach((el) => {
    if (set.has(el) || !visible(el)) return;
    if (getComputedStyle(el).cursor !== 'pointer') return;
    if (!hasWord(el, WIDGET_WORDS)) return;
    if (el.querySelector(`${CONTROLS},[role],button,a[href]`)) return;
    set.add(el);
  });

  const all = [...set].filter((el) => {
    if (ariaHidden(el)) return false;
    if (el instanceof HTMLInputElement) {
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)) return false;
      // File inputs are usually visually hidden on purpose; include them regardless.
      if (el.type === 'file') return true;
    }
    return visible(el);
  });
  return all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
}

function kindOf(el: Element): ControlKind {
  const role = el.getAttribute('role') || '';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (role === 'radio' || (el instanceof HTMLInputElement && el.type === 'radio')) return 'radio-group';
  if (role === 'checkbox' || (el instanceof HTMLInputElement && el.type === 'checkbox')) return 'checkbox';
  if (role === 'slider' || (el instanceof HTMLInputElement && el.type === 'range')) return 'slider';
  if (el instanceof HTMLInputElement && el.type === 'file') return 'file';
  if (role === 'combobox') return 'combobox';
  if (el instanceof HTMLInputElement) return el.type === 'date' || hasWord(el, DATE_WORDS) ? 'date' : 'text';
  if (hasWord(el, SLIDER_WORDS)) return 'slider';
  if (hasWord(el, DATE_WORDS)) return 'date';
  if (hasWord(el, WIDGET_WORDS)) return 'combobox';
  return 'unknown';
}

/** The visible text of one option: what a sighted user reads as its label. */
function optionText(el: Element): string {
  const native = el instanceof HTMLInputElement ? el : el.querySelector('input');
  if (native?.id) {
    const l = (native.getRootNode() as Document | ShadowRoot).querySelector(`label[for="${CSS.escape(native.id)}"]`);
    if (l && clean(l.textContent)) return clean(l.textContent);
  }
  const own = clean(el.textContent);
  if (own) return own;
  const wrap = el.closest('label');
  if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
  return accName(el).name;
}

function groupName(container: Element | null): string {
  if (!container) return '';
  const legend = container.querySelector('legend');
  if (legend && clean(legend.textContent)) return clean(legend.textContent);
  return accName(container).name;
}

interface Labelled {
  label: string;
  labelSource: FieldDescriptor['labelSource'];
  problem: 'none' | 'placeholder-only' | 'missing';
  inferred: string;
}

function labelOf(el: Element, kind: ControlKind): Labelled {
  const n = accName(el);
  if (n.name && !n.fromPlaceholder) return { label: n.name, labelSource: n.source, problem: 'none', inferred: '' };
  if (n.fromPlaceholder) return { label: n.name, labelSource: 'nearby-text', problem: 'placeholder-only', inferred: '' };
  const inferred = nearbyText(el);
  return { label: inferred || `Unlabelled ${kind}`, labelSource: inferred ? 'nearby-text' : 'none', problem: 'missing', inferred };
}

function rangeOf(el: Element): FieldHandle['range'] {
  const num = (...names: string[]) => {
    for (const n of names) {
      const v = el.getAttribute(n);
      if (v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };
  const min = num('aria-valuemin', 'min', 'data-min');
  const max = num('aria-valuemax', 'max', 'data-max');
  if (min === null || max === null || max <= min) return undefined;
  return { min, max, step: num('step', 'data-step') ?? 1 };
}

/**
 * Re-find a control the framework replaced since SCAN (§8.1): the same node if it is
 * still attached, else the recorded path if it still leads to a control of the same kind
 * and name, else the nth control with that kind and name. Null means "Could not fill".
 */
export function refind(h: FieldHandle): Element | null {
  if (h.el.isConnected) return h.el;
  const same = (el: Element) => kindOf(el) === h.kind && labelOf(el, h.kind).label === h.label;
  const byPath = queryPath(h.selector);
  if (byPath && same(byPath)) return byPath;
  const matches = candidates(formScope()).filter(same);
  return matches[h.ordinal] ?? (matches.length === 1 ? matches[0] : null);
}

/** Group options keep their own node or path; a group that lost an option fails loudly in ACT. */
export function refindOptions(h: FieldHandle): (Element | null)[] {
  return (h.optionEls || []).map((o, i) => (o.isConnected ? o : queryPath(h.optionSelectors![i])));
}

export function scanPage(): { result: ScanResult; handles: Map<string, FieldHandle> } {
  const scope = formScope();
  // Built unordered, then sorted into page order: native inputs, custom widgets and
  // groups are discovered in separate passes, and the panel must ask the questions in
  // the order the page does.
  const entries: { anchor: Element; field: Omit<FieldDescriptor, 'id'>; handle: Omit<FieldHandle, 'ordinal'> }[] = [];
  const groups = new Map<Element | string, { kind: 'radio-group' | 'checkbox-group'; opts: Element[] }>();
  const all = candidates(scope);

  // Checkboxes sharing a name are one question (Lever's 33-box "Language Skill(s)", §11).
  const checkboxNames = new Map<string, number>();
  for (const el of all) {
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.name) {
      checkboxNames.set(el.name, (checkboxNames.get(el.name) || 0) + 1);
    }
  }

  for (const el of all) {
    const kind = kindOf(el);

    if (kind === 'radio-group') {
      const native = el instanceof HTMLInputElement ? el : el.querySelector<HTMLInputElement>('input[type=radio]');
      const key = el.closest('fieldset,[role=radiogroup],[role=group]') || (native?.name ? `radio:${native.name}` : el);
      if (!groups.has(key)) groups.set(key, { kind: 'radio-group', opts: [] });
      groups.get(key)!.opts.push(el);
      continue;
    }
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && (checkboxNames.get(el.name) || 0) >= 2) {
      const key = `checkbox:${el.name}`;
      if (!groups.has(key)) groups.set(key, { kind: 'checkbox-group', opts: [] });
      groups.get(key)!.opts.push(el);
      continue;
    }

    const barriers: Barrier[] = [];
    const named = labelOf(el, kind);
    const { label } = named;
    const html = el as HTMLElement;

    // An unnamed file input is already reported once, by the page rule below.
    if (kind !== 'file') {
      if (named.problem === 'placeholder-only') {
        barriers.push(barrier('label-placeholder-only', `"${label}" is labelled only by placeholder text, which disappears once you type.`));
      } else if (named.problem === 'missing') {
        barriers.push(barrier('missing-label',
          `${named.inferred ? `"${named.inferred}"` : `A ${kind} field`} has no label on the page, so a screen reader does not announce it.`));
      }
    }
    if (kind === 'combobox' && !el.getAttribute('role')) {
      barriers.push(barrier('custom-dropdown-no-role',
        `"${label}" is a custom dropdown that a screen reader does not recognise as one.`));
    }
    if (kind !== 'file' && !keyboardReachable(html)) {
      barriers.push(barrier('not-keyboard-operable', `"${label}" cannot be reached with the keyboard.`));
    }

    const field: Omit<FieldDescriptor, 'id'> = {
      kind, label, labelSource: named.labelSource,
      required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true',
      barriers,
    };
    if (el instanceof HTMLSelectElement) {
      field.options = [...el.options].map((o) => clean(o.text)).filter(Boolean);
    }
    const range = kind === 'slider' ? rangeOf(el) : undefined;
    if (range) field.range = range;
    entries.push({ anchor: el, field, handle: { kind, el, selector: cssPath(el), label, range } });
  }

  // One field per group, asked as its question, with options named by their visible
  // text. This is what makes LinkedIn's visa question answerable: the page puts the
  // question into every option's aria-label, erasing "Yes" and "No" (spec §11).
  for (const { kind, opts } of groups.values()) {
    const shared = opts[0].closest('fieldset,[role=radiogroup],[role=group]');
    const container = shared && opts.every((o) => shared.contains(o)) ? shared : null;
    const barriers: Barrier[] = [];
    // Only an explicit ARIA name can erase an option's own text; a wrapping <label> cannot.
    const ariaNames = opts.map((o) => o.getAttribute('aria-label')?.trim() || '').filter(Boolean);
    const sharedName = ariaNames.length === opts.length && opts.length >= 2 && new Set(ariaNames).size === 1 ? ariaNames[0] : '';
    const named = groupName(container);
    const question = named || sharedName || (container ? nearbyText(container) : '') || nearbyText(opts[0]) ||
      `Unlabelled ${kind === 'radio-group' ? 'choice' : 'checkboxes'}`;

    if (!named) {
      barriers.push(barrier('group-not-labelled',
        `The question "${question}" is not tied to its options, so a screen reader reads the options without it.`));
    }
    if (sharedName) {
      barriers.push(barrier('options-identically-named',
        `All ${opts.length} options for "${question}" sound identical to a screen reader. The words ${opts.map(optionText).map((t) => `"${t}"`).join(' and ')} are never spoken.`));
    }

    const anchor = container || opts[0];
    entries.push({
      anchor: opts[0],
      field: {
        kind, label: question,
        labelSource: named ? 'label-element' : sharedName ? 'aria' : 'nearby-text',
        required: opts.some((o) => o.getAttribute('aria-required') === 'true' ||
          (o instanceof HTMLInputElement ? o : o.querySelector('input'))?.required === true),
        options: opts.map(optionText),
        barriers,
      },
      handle: { kind, el: anchor, selector: cssPath(anchor), label: question, optionEls: opts, optionSelectors: opts.map(cssPath) },
    });
  }

  // Page order. A control inside a shadow root sorts where its host sits.
  entries.sort((a, b) => (lightAnchor(a.anchor).compareDocumentPosition(lightAnchor(b.anchor)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const fields: FieldDescriptor[] = [];
  const handles = new Map<string, FieldHandle>();
  const seen = new Map<string, number>();
  entries.forEach(({ field, handle }, i) => {
    const id = `f${i}`;
    const nameKey = `${handle.kind}:${handle.label}`;
    const ordinal = seen.get(nameKey) || 0;
    seen.set(nameKey, ordinal + 1);
    fields.push({ id, ...field });
    handles.set(id, { ...handle, ordinal });
  });

  return {
    result: {
      url: location.href,
      scannedAt: new Date().toISOString(),
      fields,
      pageBarriers: pageBarriers(),
      stepHint: stepHint(scope),
      heading: stepHeading(scope, entries[0]?.anchor),
      iframeOrigins: crossOriginIframes(),
    },
    handles,
  };
}

function pageBarriers(): Barrier[] {
  const out: Barrier[] = [];

  deepQueryAll<HTMLInputElement>(document, 'input[type=file]').forEach((inp) => {
    if (ariaHidden(inp)) return;
    const root = inp.getRootNode() as Document | ShadowRoot;
    // A label gives the input a name. It is not a tab stop, so it only rescues an
    // unreachable input if it was itself made a keyboard trigger. Treating any label[for]
    // as "accessible" hid a labelled drag-drop-only uploader completely.
    const label = inp.id ? root.querySelector<HTMLElement>(`label[for="${CSS.escape(inp.id)}"]`) : null;
    const labelIsTrigger = !!label && (keyboardReachable(label) ||
      [...label.querySelectorAll<HTMLElement>('button,[role=button],[tabindex]')].some(keyboardReachable));
    if (!keyboardReachable(inp)) {
      if (!labelIsTrigger) out.push(barrier('drag-drop-only', 'The CV uploader can only be used by dragging a file onto it.'));
    } else if (!accName(inp).name) {
      out.push(barrier('upload-unnamed', 'The upload button has no label, so it is announced only as a generic file button.'));
    }
  });

  document.querySelectorAll('[class*=popup],[class*=Popup],[class*=modal],[class*=Modal]').forEach((el) => {
    if (!visible(el) || ariaHidden(el)) return;
    if (el.closest('[role=dialog],[role=alertdialog],[aria-modal=true],dialog')) return;
    if (!el.querySelector('input,select,textarea')) return;
    out.push(barrier('modal-without-dialog-role', 'A popup opened on this page but is not announced as a dialog.'));
  });

  if (document.querySelector('iframe[src*=recaptcha],iframe[src*=hcaptcha],[class*=h-captcha],[class*=g-recaptcha]')) {
    out.push(barrier('captcha', 'This page has a CAPTCHA. BRIDGE cannot complete it, so you may need sighted help at that point.'));
  }
  return out;
}

function crossOriginIframes(): string[] {
  const origins = new Set<string>();
  document.querySelectorAll('iframe[src]').forEach((f) => {
    if (!visible(f) || ariaHidden(f)) return;
    // src is whatever the page wrote. One that does not parse loads nothing, so there is
    // no frame to report; it must not take the whole scan down.
    const src = (f as HTMLIFrameElement).src;
    if (!URL.canParse(src, location.href)) return;
    const origin = new URL(src, location.href).origin;
    if (origin !== location.origin && origin !== 'null') origins.add(origin);
  });
  return [...origins];
}

/** The step's name: the last heading before its first question. In a wizard dialog the
 *  first heading is the dialog's title ("Apply to Acme"); the step's own comes after it.
 *  Looked for in the whole document, not only the form: on Greenhouse no heading sits
 *  inside the form before its first field, and a LATER section's heading is not the name. */
function stepHeading(scope: Element, firstField: Element | undefined): string {
  const headings = [...document.querySelectorAll('h1,h2,h3,legend')].filter((h) => visible(h) && clean(h.textContent));
  const anchor = firstField ? lightAnchor(firstField) : scope;
  const before = headings.filter((h) => h.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING && !h.contains(anchor));
  const pick = before[before.length - 1] || headings[0];
  return pick ? clean(pick.textContent).slice(0, 120) : clean(document.title);
}

/** The page's own statement of where the user is. It outranks any heuristic (§6.5). */
function stepHint(scope: Element): StepHint | null {
  const wd = document.querySelector('[data-automation-id=progressBar]');
  if (wd) {
    const items = [...wd.querySelectorAll('li')];
    const active = items.findIndex((li) => li.getAttribute('data-automation-id') === 'progressBarActiveStep');
    return { via: 'workday-progressBar', steps: items.map((li) => clean(li.textContent)), index: active + 1, total: items.length };
  }
  const current = document.querySelector('[aria-current=step]');
  if (current) {
    const item = current.closest('li') || current;
    const siblings = item.parentElement ? [...item.parentElement.children].filter((c) => c.tagName === item.tagName) : [];
    const hint: StepHint = { via: 'aria-current=step', text: clean(current.textContent) };
    if (siblings.length > 1) {
      hint.index = siblings.indexOf(item) + 1;
      hint.total = siblings.length;
      hint.steps = siblings.map((c) => clean(c.textContent));
    }
    return hint;
  }
  // Phrasings seen in the wild: Workday "step 1 of 6", LinkedIn "1/4 pages". The form's
  // own region first, so pagination behind a modal is not mistaken for the journey.
  for (const text of [(scope as HTMLElement).innerText || '', document.body.innerText]) {
    const m = text.match(/step\s+(\d+)\s+of\s+(\d+)/i)
      || text.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:pages?|steps?)/i)
      || text.match(/page\s+(\d+)\s*(?:of|\/)\s*(\d+)/i);
    if (m) return { via: 'text', text: m[0], index: +m[1], total: +m[2] };
  }
  const bar = document.querySelector('[role=progressbar]');
  if (bar) {
    const text = bar.getAttribute('aria-valuetext') || bar.getAttribute('aria-label') || '';
    if (text) return { via: 'progressbar', text: clean(text) };
  }
  return null;
}
