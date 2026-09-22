// Checks that need layout and colour, not the accessibility tree: pointer target size
// (WCAG 2.2 2.5.8, AA) and text contrast (1.4.3, AA). Spec §6.2. Plain DOM, no dependency:
// axe-core would do both, but bundling 550 KB into a content script that loads on every
// job page is not worth two rules. Where a measurement cannot be trusted, the check
// returns null and nothing is reported; it never guesses.

import { CONTROLS, ariaHidden, clean, deepQueryAll, visible } from './dom';

// --- 2.5.8 Target Size (Minimum) ------------------------------------------------------

const MIN_TARGET = 24;

/** Everything a pointer can act on, for the spacing exception: a small target passes if
 *  nothing else is within reach of it. Measured once per scan. */
export function pointerTargets(): DOMRect[] {
  return deepQueryAll(document, `${CONTROLS},button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[tabindex]`)
    .filter((el) => visible(el) && !ariaHidden(el))
    .map((el) => el.getBoundingClientRect());
}

const undersized = (r: DOMRect) => r.width < MIN_TARGET || r.height < MIN_TARGET;

/**
 * The target is under 24 by 24 CSS pixels and no exception applies. Exceptions
 * implemented from the criterion's text: spacing (a 24px circle centred on it meets no
 * other target, nor the circle of another undersized target); user agent (a native
 * checkbox or radio the author left at its default appearance is sized by the browser);
 * inactive controls are not targets. "Inline" and "essential" do not arise for form controls.
 * Returns the measured size, rounded, or null.
 */
export function targetTooSmall(el: Element, others: DOMRect[]): { width: number; height: number } | null {
  if ((el as HTMLInputElement).disabled) return null;
  const r = el.getBoundingClientRect();
  if (!undersized(r)) return null;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') &&
      getComputedStyle(el).appearance !== 'none') return null;

  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const radius = MIN_TARGET / 2;
  const crowded = others.some((o) => {
    if (o.left === r.left && o.top === r.top && o.width === r.width && o.height === r.height) return false;
    if (undersized(o)) {
      const ox = o.left + o.width / 2;
      const oy = o.top + o.height / 2;
      return Math.hypot(ox - cx, oy - cy) < MIN_TARGET;
    }
    const dx = Math.max(o.left - cx, 0, cx - o.right);
    const dy = Math.max(o.top - cy, 0, cy - o.bottom);
    return Math.hypot(dx, dy) < radius;
  });
  return crowded ? { width: Math.round(r.width), height: Math.round(r.height) } : null;
}

// --- 1.4.3 Contrast (Minimum) ---------------------------------------------------------

type RGBA = [number, number, number, number];

/** Chrome computes sRGB colours as rgb()/rgba(). Anything else (wide gamut) is not measured. */
function parseColor(css: string): RGBA | null {
  const m = css.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/** `top` painted over `bottom`. */
function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3] + bottom[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
  return [ch(0), ch(1), ch(2), a];
}

/**
 * The colour behind an element: its ancestors' background colours composited, ending on
 * the white canvas. Null when a background image, a gradient or a translucent ancestor is
 * in the way, because the real colour then depends on pixels this cannot read.
 */
function backgroundBehind(el: Element): RGBA | null {
  let acc: RGBA = [0, 0, 0, 0];
  for (let node: Element | null = el; node; node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)) {
    const s = getComputedStyle(node);
    if (s.backgroundImage !== 'none' || Number(s.opacity) < 1) return null;
    const bg = parseColor(s.backgroundColor);
    if (!bg) return null;
    acc = over(acc, bg);
    if (acc[3] >= 1) return acc;
  }
  return over(acc, [255, 255, 255, 1]);
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratioOf(fg: RGBA, bg: RGBA): number {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 3:1 for large text (24px, or 18.66px bold), 4.5:1 otherwise. */
function required(s: CSSStyleDeclaration): number {
  const size = parseFloat(s.fontSize);
  const bold = parseInt(s.fontWeight, 10) >= 700;
  return size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
}

export interface Contrast {
  ratio: number;
  required: number;
}

/**
 * The contrast of an element's text against what is behind it, when below the minimum.
 * `pseudo` measures ::placeholder. Null when the text is empty, the control is disabled,
 * a colour cannot be read, or the ratio meets the minimum.
 */
export function lowContrast(el: Element, pseudo?: '::placeholder'): Contrast | null {
  if ((el as HTMLInputElement).disabled) return null;
  const text = pseudo ? (el as HTMLInputElement).placeholder : clean((el as HTMLInputElement).value ?? el.textContent);
  if (!text) return null;
  const s = getComputedStyle(el, pseudo);
  const fg = parseColor(s.color);
  const bg = backgroundBehind(el);
  if (!fg || !bg) return null;
  const ratio = ratioOf(fg, bg);
  const min = required(s);
  return ratio < min ? { ratio: Math.round(ratio * 10) / 10, required: min } : null;
}

/** The element whose text names the control: what a person reads, so what contrast is measured on. */
export function labelElement(el: Element): Element | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const first = lb.split(/\s+/).map((id) => root.getElementById(id)).find(Boolean);
    if (first) return first;
  }
  if (el.id) {
    const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) return l;
  }
  return el.closest('label');
}
