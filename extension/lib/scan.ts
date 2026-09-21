// SCAN: spec §4.1, §6.2. Ported from probe/scan.js, scoped to the form (§6.5) so the page
// behind a modal does not leak into the field list.

import {
  CONTROLS, accName, ariaHidden, clean, cssPath, formScope, keyboardReachable, nearbyText, visible,
} from './dom';
import type { Barrier, ControlKind, FieldDescriptor, ScanResult, StepHint } from './types';

/** What the content script keeps so ACT can find the element again. Never leaves the page. */
export interface FieldHandle {
  kind: ControlKind;
  el: Element;
  selector: string;
  /** Radio groups: one entry per option, in the same order as FieldDescriptor.options. */
  optionEls?: Element[];
  optionSelectors?: string[];
}

const CUSTOM_WIDGET_CLASS = /select|dropdown|combo|picker/i;

function barrier(rule: string, severity: Barrier['severity'], message: string): Barrier {
  return { rule, severity, message };
}

/** Candidate controls inside the form, outermost only: an ARIA wrapper and the native
 *  input inside it are one control to the user (LinkedIn's radios). */
function candidates(scope: Element): Element[] {
  const set = new Set<Element>(scope.querySelectorAll(CONTROLS));

  // Custom widgets: look clickable, are named like a dropdown, contain no real control.
  scope.querySelectorAll('div,span,li').forEach((el) => {
    if (set.has(el) || !visible(el)) return;
    if (getComputedStyle(el).cursor !== 'pointer') return;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!CUSTOM_WIDGET_CLASS.test(cls)) return;
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
  if (el instanceof HTMLInputElement && el.type === 'file') return 'file';
  if (role === 'combobox') return 'combobox';
  if (el instanceof HTMLInputElement) return 'text';
  if (CUSTOM_WIDGET_CLASS.test(typeof el.className === 'string' ? el.className : '')) return 'combobox';
  return 'unknown';
}

/** The visible text of one radio option — what a sighted user reads as its label. */
function optionText(el: Element): string {
  const native = el instanceof HTMLInputElement ? el : el.querySelector('input');
  if (native?.id) {
    const l = document.querySelector(`label[for="${CSS.escape(native.id)}"]`);
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
  const { name } = accName(container);
  return name;
}

function describeText(el: Element, kind: ControlKind, barriers: Barrier[]): Pick<FieldDescriptor, 'label' | 'labelSource'> {
  const n = accName(el);
  if (n.name && !n.fromPlaceholder) return { label: n.name, labelSource: n.source };
  if (n.fromPlaceholder) {
    barriers.push(barrier('label-placeholder-only', 'usability', `"${n.name}" is labelled only by placeholder text, which disappears once you type.`));
    return { label: n.name, labelSource: 'nearby-text' };
  }
  const inferred = nearbyText(el);
  barriers.push(barrier('missing-label', 'usability',
    `${inferred ? `"${inferred}"` : `A ${kind} field`} has no label on the page, so a screen reader does not announce it.`));
  return { label: inferred || `Unlabelled ${kind}`, labelSource: inferred ? 'nearby-text' : 'none' };
}

export function scanPage(): { result: ScanResult; handles: Map<string, FieldHandle> } {
  const scope = formScope();
  // Built unordered, then sorted into page order: native inputs, custom widgets and
  // radio groups are discovered in separate passes, and the panel must ask the questions
  // in the order the page does.
  const entries: { anchor: Element; field: Omit<FieldDescriptor, 'id'>; handle: FieldHandle }[] = [];
  const radioGroups = new Map<Element | string, Element[]>();

  for (const el of candidates(scope)) {
    const kind = kindOf(el);

    if (kind === 'radio-group') {
      const native = el instanceof HTMLInputElement ? el : el.querySelector('input[type=radio]');
      const key = el.closest('fieldset,[role=radiogroup],[role=group]') ||
        (native && (native as HTMLInputElement).name ? `name:${(native as HTMLInputElement).name}` : el);
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key)!.push(el);
      continue;
    }

    const barriers: Barrier[] = [];
    const { label, labelSource } = describeText(el, kind, barriers);
    const html = el as HTMLElement;

    if (kind === 'combobox' && !el.getAttribute('role')) {
      barriers.push(barrier('custom-dropdown-no-role', 'blocking',
        `"${label}" is a custom dropdown that a screen reader does not recognise as one.`));
    }
    if (kind !== 'file' && !keyboardReachable(html)) {
      barriers.push(barrier('not-keyboard-operable', 'blocking', `"${label}" cannot be reached with the keyboard.`));
    }

    const field: Omit<FieldDescriptor, 'id'> = {
      kind, label, labelSource,
      required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true',
      barriers,
    };
    if (el instanceof HTMLSelectElement) {
      field.options = [...el.options].map((o) => clean(o.text)).filter(Boolean);
    }
    entries.push({ anchor: el, field, handle: { kind, el, selector: cssPath(el) } });
  }

  // One field per radio group, asked as its question, with options named by their
  // visible text. This is what makes LinkedIn's visa question answerable: the page puts
  // the question into every option's aria-label, erasing "Yes" and "No" (spec §11).
  for (const [key, opts] of radioGroups) {
    const container = typeof key === 'string' ? null : (key instanceof Element && opts.includes(key) ? null : key as Element);
    const barriers: Barrier[] = [];
    const optionNames = opts.map((o) => accName(o).name).filter(Boolean);
    const sharedName = optionNames.length >= 2 && new Set(optionNames).size === 1 ? optionNames[0] : '';
    const question = groupName(container) || sharedName || (container ? nearbyText(container) : '') || nearbyText(opts[0]);

    if (!groupName(container)) {
      barriers.push(barrier('group-not-labelled', 'blocking',
        `The question "${question}" is not tied to its options, so a screen reader reads the options without it.`));
    }
    if (sharedName) {
      barriers.push(barrier('options-identically-named', 'blocking',
        `All ${opts.length} options for "${question}" sound identical to a screen reader. The words ${opts.map(optionText).map((t) => `"${t}"`).join(' and ')} are never spoken.`));
    }

    const field: Omit<FieldDescriptor, 'id'> = {
      kind: 'radio-group', label: question,
      labelSource: groupName(container) ? 'label-element' : sharedName ? 'aria' : 'nearby-text',
      required: opts.some((o) => o.getAttribute('aria-required') === 'true' ||
        (o.querySelector('input') as HTMLInputElement | null)?.required === true),
      options: opts.map(optionText),
      barriers,
    };
    entries.push({
      anchor: opts[0],
      field,
      handle: {
        kind: 'radio-group', el: container || opts[0], selector: cssPath(container || opts[0]),
        optionEls: opts, optionSelectors: opts.map(cssPath),
      },
    });
  }

  entries.sort((a, b) => (a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const fields: FieldDescriptor[] = [];
  const handles = new Map<string, FieldHandle>();
  entries.forEach(({ field, handle }, i) => {
    const id = `f${i}`;
    fields.push({ id, ...field });
    handles.set(id, handle);
  });

  return {
    result: {
      url: location.href,
      scannedAt: new Date().toISOString(),
      fields,
      pageBarriers: pageBarriers(),
      stepHint: stepHint(),
    },
    handles,
  };
}

function pageBarriers(): Barrier[] {
  const out: Barrier[] = [];

  document.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((inp) => {
    if (inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`)) return;
    if (!keyboardReachable(inp)) {
      out.push(barrier('drag-drop-only', 'blocking', 'The CV uploader can only be used by dragging a file onto it.'));
    } else if (!accName(inp).name) {
      out.push(barrier('upload-unnamed', 'usability', 'The upload button has no label, so it is announced only as a generic file button.'));
    }
  });

  document.querySelectorAll('[class*=popup],[class*=Popup],[class*=modal],[class*=Modal]').forEach((el) => {
    if (!visible(el) || ariaHidden(el)) return;
    if (el.closest('[role=dialog],[role=alertdialog],[aria-modal=true],dialog')) return;
    if (!el.querySelector('input,select,textarea')) return;
    out.push(barrier('modal-without-dialog-role', 'blocking', 'A popup opened on this page but is not announced as a dialog.'));
  });

  if (document.querySelector('iframe[src*=recaptcha],iframe[src*=hcaptcha],[class*=h-captcha],[class*=g-recaptcha]')) {
    out.push(barrier('captcha', 'blocking', 'This page has a CAPTCHA. BRIDGE cannot complete it, so you may need sighted help at that point.'));
  }
  return out;
}

function stepHint(): StepHint | null {
  const wd = document.querySelector('[data-automation-id=progressBar]');
  if (wd) {
    const items = [...wd.querySelectorAll('li')];
    const active = items.findIndex((li) => li.getAttribute('data-automation-id') === 'progressBarActiveStep');
    return { via: 'workday-progressBar', steps: items.map((li) => clean(li.textContent)), index: active + 1, total: items.length };
  }
  const current = document.querySelector('[aria-current=step]');
  if (current) return { via: 'aria-current=step', text: clean(current.textContent) };
  // Phrasings seen in the wild: Workday "step 1 of 6", LinkedIn "1/4 pages".
  const body = document.body.innerText;
  const m = body.match(/step\s+(\d+)\s+of\s+(\d+)/i)
    || body.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:pages?|steps?)/i)
    || body.match(/page\s+(\d+)\s*(?:of|\/)\s*(\d+)/i);
  if (m) return { via: 'text', text: m[0], index: +m[1], total: +m[2] };
  return null;
}
