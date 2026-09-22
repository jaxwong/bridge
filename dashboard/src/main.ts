// The employer dashboard: bridge-business.md §6.4. Static page, no server, no accounts.
// Native elements throughout — a dashboard for an accessibility product has to be operable
// by the people it is about, so every control here is a real one.

import { compareLatest, countBySeverity } from './lib/compare.ts';
import type { ComparedBarrier, Comparison } from './lib/compare.ts';
import { groupByForm, parseReport } from './lib/report.ts';
import type { BarrierReport, Form, Severity } from './lib/report.ts';
import { findingsOf, summariseWcag } from './lib/wcag.ts';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`markup is missing #${id}`);
  return node as T;
};

type Attrs = { class?: string; text?: string; [key: string]: string | undefined };

/** Build an element. Text always goes in as text, never as markup: barrier labels and
 *  impact sentences come out of somebody else's web page. */
function el(tag: string, attrs: Attrs = {}, children: (Node | string)[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k === 'class' ? 'class' : k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

const SEVERITY_WORD: Record<Severity, string> = {
  blocking: 'Blocking', usability: 'Usability', ok: 'OK',
};

const formTitle = (f: Form): string => `${f.portal}${f.pagePath}`;

const when = (iso: string): HTMLElement =>
  el('time', { datetime: iso, text: new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) });

// --- state ---------------------------------------------------------------------------
// Every report loaded so far, in load order. Forms are derived from it, never stored
// alongside it: two sources of truth for "what have we loaded" is how a dashboard starts
// disagreeing with itself.
let loaded: BarrierReport[] = [];
/** The form whose detail is open, so focus can go back to its row on the way out. */
let openedKey: string | null = null;

/** How many distinct scans we hold. Never `loaded.length`: the same file can be picked
 *  twice, and groupByForm is the one place that decides what counts as one scan. */
const totalScans = (forms: Form[]): number => forms.reduce((n, f) => n + f.scans.length, 0);

const announce = (message: string): void => { $('live').textContent = message; };

// --- loading -------------------------------------------------------------------------

async function readFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const failures: { name: string; reason: string }[] = [];
  const accepted: BarrierReport[] = [];

  for (const file of files) {
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      failures.push({ name: file.name, reason: `not valid JSON — ${(e as Error).message}` });
      continue;
    }
    try {
      accepted.push(parseReport(raw, file.name));
    } catch (e) {
      failures.push({ name: file.name, reason: (e as Error).message.replace(`${file.name} is not a BRIDGE barrier report: `, '') });
    }
  }

  // Counted by groupByForm rather than by how many files were handed in: the same report
  // can be picked twice and is still one report.
  const before = totalScans(groupByForm(loaded));
  loaded = [...loaded, ...accepted];
  const forms = groupByForm(loaded);
  const added = totalScans(forms) - before;
  const alreadyHeld = accepted.length - added;
  const scans = totalScans(forms);

  renderErrors(failures);
  render();

  // Every number here is counted from what was loaded. Nothing on this page is estimated.
  const parts: string[] = [];
  if (added) parts.push(`${added} ${added === 1 ? 'report' : 'reports'} loaded`);
  if (alreadyHeld) parts.push(`${alreadyHeld} ${alreadyHeld === 1 ? 'report was' : 'reports were'} already loaded`);
  if (failures.length) parts.push(`${failures.length} ${failures.length === 1 ? 'file' : 'files'} could not be read`);
  parts.push(`${forms.length} ${forms.length === 1 ? 'form' : 'forms'}, ${scans} ${scans === 1 ? 'scan' : 'scans'} in total`);
  announce(`${parts.join('. ')}.`);
}

function renderErrors(failures: { name: string; reason: string }[]): void {
  const box = $('load-errors');
  box.replaceChildren();
  box.hidden = failures.length === 0;
  if (failures.length === 0) return;
  box.append(el('h3', { text: failures.length === 1 ? 'One file could not be read' : `${failures.length} files could not be read` }));
  box.append(el('ul', {}, failures.map((f) =>
    el('li', {}, [el('strong', { text: f.name }), `: ${f.reason}`]))));
}

// --- form list -----------------------------------------------------------------------

function changeSummary(c: Comparison): string {
  if (!c.hasPrevious) return 'First scan — nothing to compare with yet';
  if (!c.new.length && !c.resolved.length) return `No change — ${c.stillOpen.length} still open`;
  const parts: string[] = [];
  if (c.new.length) parts.push(`${c.new.length} new`);
  if (c.resolved.length) parts.push(`${c.resolved.length} resolved`);
  parts.push(`${c.stillOpen.length} still open`);
  return parts.join(', ');
}

function renderList(): void {
  const body = $('list-body');
  body.replaceChildren();
  const forms = groupByForm(loaded);

  if (forms.length === 0) {
    body.append(el('p', { class: 'empty', text: 'No reports loaded yet. Choose report files above to see what changed between scans.' }));
    return;
  }

  const head = el('tr', {}, [
    el('th', { scope: 'col', text: 'Form' }),
    el('th', { scope: 'col', text: 'Last scanned' }),
    el('th', { scope: 'col', text: 'Blocking' }),
    el('th', { scope: 'col', text: 'Usability' }),
    el('th', { scope: 'col', text: 'Since previous scan' }),
  ]);

  const rows = forms.map((form) => {
    const newest = form.scans[form.scans.length - 1];
    const counts = countBySeverity(newest);
    const comparison = compareLatest(form.scans);
    const open = el('button', { type: 'button', class: 'linkish', text: formTitle(form), 'data-form-key': form.key });
    open.addEventListener('click', () => openDetail(form.key));
    return el('tr', {}, [
      el('th', { scope: 'row' }, [open]),
      el('td', {}, [when(newest.generatedAt)]),
      el('td', { class: counts.blocking ? 'count count--blocking' : 'count', text: String(counts.blocking) }),
      el('td', { class: 'count', text: String(counts.usability) }),
      el('td', { class: comparison.new.length ? 'change change--new' : 'change', text: changeSummary(comparison) }),
    ]);
  });

  const scans = totalScans(forms);
  body.append(el('table', {}, [
    el('caption', { text: `${forms.length} ${forms.length === 1 ? 'form' : 'forms'}, from ${scans} ${scans === 1 ? 'scan' : 'scans'}.` }),
    el('thead', {}, [head]),
    el('tbody', {}, rows),
  ]));
}

// --- form detail ---------------------------------------------------------------------

/**
 * The WCAG line for one finding. A finding whose rule carries no recorded mapping says so
 * in words — the dashboard never infers a criterion the producer did not record.
 */
function wcagLine(b: ComparedBarrier): HTMLElement {
  if (!b.wcag?.length) {
    return el('p', { class: 'barrier__wcag barrier__wcag--none', text: 'No WCAG mapping recorded' });
  }
  const line = el('p', { class: 'barrier__wcag' }, [
    el('span', { class: 'wcag-badge', text: `WCAG 2.2 Level ${b.wcagLevel ?? 'A'}` }),
    ' ',
    el('span', { text: b.wcag.join(', ') }),
  ]);
  if (b.reviewRequired) line.append(' ', el('span', { class: 'flag', text: 'Human review required' }));
  return line;
}

function barrierItem(b: ComparedBarrier): HTMLElement {
  return el('li', { class: 'barrier' }, [
    el('p', { class: 'barrier__head' }, [
      el('span', { class: `sev sev--${b.severity}`, text: SEVERITY_WORD[b.severity] }),
      ' ',
      el('code', { text: b.rule }),
    ]),
    el('p', { class: 'barrier__where', text: b.scope === 'page' ? 'Affects the whole page' : `Field: ${b.label}` }),
    el('p', { class: 'barrier__impact', text: b.impact }),
    wcagLine(b),
  ]);
}

/**
 * Findings in the newest scan, counted by WCAG level and by success criterion. Counts only
 * — it says nothing about whether the form conforms, which no automated tool can decide.
 */
function wcagSummarySection(newest: BarrierReport): HTMLElement {
  const s = summariseWcag(findingsOf(newest));
  const section = el('section', { class: 'wcag-summary' }, [
    el('h3', { text: 'Automated WCAG 2.2 findings in the newest scan' }),
  ]);

  // The producer says which criteria it can fail. Naming them is what stops "no finding"
  // from reading as "passed": every other criterion was simply never tested.
  if (newest.standard) {
    const { name, version, level, checked } = newest.standard;
    section.append(el('p', { class: 'wcag-checked' }, [
      `Measured against ${name} ${version}, Level ${level}. The scanner can fail ${checked.length} criteria: `,
      el('span', { text: checked.join(', ') }),
      '. Any other criterion was not checked.',
    ]));
  }

  if (s.total === 0) {
    section.append(el('p', { class: 'empty', text: 'This scan found no barriers, so there is nothing to map.' }));
    return section;
  }

  const levels = s.byLevel.length
    ? s.byLevel.map((l) => `Level ${l.level}: ${l.count}`).join(' · ')
    : 'none mapped';
  section.append(el('p', {}, [
    el('strong', { text: `${s.mapped} of ${s.total} findings map to a success criterion` }),
    ` (${levels}). ${s.unmapped} with no mapping recorded.`,
    s.reviewRequired ? ` ${s.reviewRequired} flagged for human review of the detection itself.` : '',
  ]));

  if (s.byCriterion.length) {
    section.append(el('table', { class: 'wcag-table' }, [
      el('caption', { text: 'Findings by success criterion. One finding citing two criteria is counted under each.' }),
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: 'Criterion' }),
        el('th', { scope: 'col', text: 'Level' }),
        el('th', { scope: 'col', text: 'Findings' }),
        el('th', { scope: 'col', text: 'From rules' }),
      ])]),
      el('tbody', {}, s.byCriterion.map((c) => el('tr', {}, [
        el('th', { scope: 'row', text: c.criterion }),
        el('td', { text: c.level }),
        el('td', { class: 'count', text: String(c.count) }),
        el('td', { text: c.rules.join(', ') }),
      ]))),
    ]));
  }

  section.append(el('p', { class: 'disclaimer', role: 'note' }, [
    el('strong', { text: 'Automated findings, not a conformance decision. ' }),
    'Human review is required for a WCAG conformance claim.',
  ]));
  return section;
}

function barrierSection(heading: string, empty: string, barriers: ComparedBarrier[], cls = ''): HTMLElement {
  const section = el('section', { class: `bucket ${cls}`.trim() }, [
    el('h3', { text: `${heading} (${barriers.length})` }),
  ]);
  section.append(barriers.length
    ? el('ul', { class: 'barriers' }, barriers.map(barrierItem))
    : el('p', { class: 'empty', text: empty }));
  return section;
}

function openDetail(key: string): void {
  const form = groupByForm(loaded).find((f) => f.key === key);
  if (!form) throw new Error(`no loaded form with key ${key}`);

  openedKey = key;
  const newest = form.scans[form.scans.length - 1];
  const previous = form.scans.length > 1 ? form.scans[form.scans.length - 2] : null;
  const comparison = compareLatest(form.scans);

  $('detail-h').textContent = formTitle(form);

  const meta = $('detail-meta');
  meta.replaceChildren(
    `${form.scans.length} ${form.scans.length === 1 ? 'scan' : 'scans'} loaded. Newest `,
    when(newest.generatedAt),
    previous ? ', compared with ' : ', with no earlier scan to compare against.',
  );
  if (previous) meta.append(when(previous.generatedAt), '.');

  const body = $('detail-body');
  body.replaceChildren(
    wcagSummarySection(newest),
    barrierSection('New since the previous scan', comparison.hasPrevious
      ? 'Nothing new in this scan.'
      : 'A first scan has nothing to compare with, so nothing is reported as new.',
      comparison.new, 'bucket--new'),
    barrierSection(comparison.hasPrevious ? 'Still open' : 'Open', 'No barriers.', comparison.stillOpen),
    barrierSection('Resolved', comparison.hasPrevious
      ? 'Nothing was resolved since the previous scan.'
      : 'Nothing to compare with yet.', comparison.resolved, 'bucket--resolved'),
  );

  $('list-view').hidden = true;
  $('detail-view').hidden = false;
  $('detail-h').focus();
  announce(`${formTitle(form)}. ${changeSummary(comparison)}.`);
}

function closeDetail(): void {
  $('detail-view').hidden = true;
  $('list-view').hidden = false;
  // Back to the row the reader came from, not to the top of the page. Re-found by key
  // rather than held as a node: loading more files while the detail was open rebuilds the
  // table, and a focus() call on a discarded node silently does nothing.
  const row = openedKey === null ? null
    : document.querySelector<HTMLElement>(`[data-form-key="${CSS.escape(openedKey)}"]`);
  (row ?? $('list-h')).focus();
  openedKey = null;
}

function render(): void {
  renderList();
}

// --- wiring ---------------------------------------------------------------------------

const input = $<HTMLInputElement>('reports');
input.addEventListener('change', () => {
  const files = [...(input.files ?? [])];
  // Cleared so the same file can be chosen again, e.g. after a newer export replaced it.
  input.value = '';
  void readFiles(files);
});

// Drag and drop as an addition to the file input, never instead of it (§6.4).
const dropzone = $('dropzone');
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('loader--over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('loader--over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('loader--over');
  void readFiles([...(e.dataTransfer?.files ?? [])]);
});

$('back').addEventListener('click', closeDetail);

render();
