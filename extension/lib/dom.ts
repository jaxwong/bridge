// DOM primitives shared by SCAN and ACT. Ported from probe/, where each rule here was
// found by measurement against a live portal (spec §6.2, §6.5, §11).

import { browser } from 'wxt/browser';

export const CONTROLS =
  'input,select,textarea,[role=combobox],[role=checkbox],[role=radio],[role=slider],[role=spinbutton]';

export const clean = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();

export function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
}

/** Invisible to a screen reader, so neither a field to offer nor a barrier to report. */
export const ariaHidden = (el: Element): boolean => !!el.closest('[aria-hidden="true"]');

/**
 * The shadow root of an element, open OR closed. Content scripts may open closed roots
 * (chrome.dom), so a field inside one is reachable like any other (spec §8, decisions).
 */
export function shadowOf(el: Element): ShadowRoot | null {
  return el instanceof HTMLElement ? browser.dom.openOrClosedShadowRoot(el) : null;
}

/** querySelectorAll that also descends into every shadow root under `root`. */
export function deepQueryAll<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  const out = [...root.querySelectorAll<T>(selector)];
  for (const el of root.querySelectorAll('*')) {
    const sr = shadowOf(el);
    if (sr) out.push(...deepQueryAll<T>(sr, selector));
  }
  return out;
}

/** The element's nearest ancestor-or-self in the light DOM: what orders it on the page. */
export function lightAnchor(el: Element): Element {
  let node = el;
  for (let root = node.getRootNode(); root instanceof ShadowRoot; root = node.getRootNode()) node = root.host;
  return node;
}

/**
 * In the tab order. Not the same as visible: a visually hidden but focusable input is the
 * standard accessible pattern (spec §6.2, drag-drop-only).
 */
export function keyboardReachable(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return el.tabIndex >= 0 && !(el as HTMLInputElement).disabled &&
    s.display !== 'none' && s.visibility !== 'hidden' && !el.closest('[inert]');
}

function countControls(root: Element): number {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)]
    .filter((e) => e.offsetParent !== null)
    .filter((e) => !(e instanceof HTMLInputElement && ['hidden', 'submit', 'button', 'reset'].includes(e.type)))
    .length;
}

/**
 * The region holding the application form: the narrowest dialog or form that actually
 * contains controls. `<dialog>` is matched by tag because its dialog role is implicit
 * (LinkedIn), and control-less dialogs are skipped (Greenhouse has one). Spec §6.5.
 */
export function formScope(): Element {
  const candidates = [
    ...document.querySelectorAll('dialog[open]'),
    ...document.querySelectorAll('[role=dialog][aria-modal="true"]'),
    ...document.querySelectorAll('dialog'),
    ...document.querySelectorAll('[role=dialog]'),
    ...document.querySelectorAll('[aria-modal="true"]'),
    ...document.querySelectorAll('form'),
  ].filter((el) => (el as HTMLElement).offsetParent !== null || (el instanceof HTMLDialogElement && el.open));
  return candidates.find((el) => countControls(el) > 0) || document.body;
}

export type NameSource = 'aria' | 'label-element' | 'nearby-text' | 'none';

/** A subset of accname: enough to decide whether, and how, a control is named. */
export function accName(el: Element): { name: string; source: NameSource; fromPlaceholder: boolean } {
  // ids and label[for] are scoped to the tree the element lives in, which may be a shadow root.
  const root = el.getRootNode() as Document | ShadowRoot;
  const byIds = (ids: string) => ids.split(/\s+/)
    .map((id) => root.getElementById(id)).filter(Boolean).map((n) => clean(n!.textContent)).join(' ');

  const lb = el.getAttribute('aria-labelledby');
  if (lb) { const t = byIds(lb); if (t) return { name: t, source: 'aria', fromPlaceholder: false }; }
  const al = el.getAttribute('aria-label');
  if (al && al.trim()) return { name: al.trim(), source: 'aria', fromPlaceholder: false };
  if (el.id) {
    const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l && clean(l.textContent)) return { name: clean(l.textContent), source: 'label-element', fromPlaceholder: false };
  }
  const wrap = el.closest('label');
  if (wrap && clean(wrap.textContent)) return { name: clean(wrap.textContent), source: 'label-element', fromPlaceholder: false };
  const title = el.getAttribute('title');
  if (title) return { name: title, source: 'aria', fromPlaceholder: false };
  const ph = (el as HTMLInputElement).placeholder;
  if (ph) return { name: ph, source: 'aria', fromPlaceholder: true };
  return { name: '', source: 'none', fromPlaceholder: false };
}

/**
 * For a control with no accessible name: the nearest preceding visible text, so the
 * side panel can still ask the question. Always presented as "label inferred" (§6.4).
 */
export function nearbyText(el: Element): string {
  let node: Element | null = el;
  for (let depth = 0; depth < 4 && node; depth++) {
    let sib = node.previousElementSibling;
    while (sib) {
      const t = clean(sib.textContent);
      if (t && !sib.querySelector(CONTROLS)) return t.slice(0, 160);
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

const SHADOW_HOP = ' >>> ';

function pathWithinRoot(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 12) {
    if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const same = [...parent.children].filter((c) => c.tagName === node!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return parts.join(' > ');
}

/** A path that re-finds the element after a re-render replaces it. Shadow roots are
 *  crossed with " >>> ": host path, then the path inside that host's root. */
export function cssPath(el: Element): string {
  const root = el.getRootNode();
  const own = pathWithinRoot(el);
  return root instanceof ShadowRoot ? `${cssPath(root.host)}${SHADOW_HOP}${own}` : own;
}

export function queryPath(path: string): Element | null {
  let scope: ParentNode = document;
  let found: Element | null = null;
  for (const segment of path.split(SHADOW_HOP)) {
    found = scope.querySelector(segment);
    if (!found) return null;
    const sr = shadowOf(found);
    if (sr) scope = sr;
  }
  return found;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
