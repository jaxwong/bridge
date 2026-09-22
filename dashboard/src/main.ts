// The employer dashboard: bridge-business.md §6.4. Static page, no server, no accounts.
// Native elements throughout — a dashboard for an accessibility product has to be operable
// by the people it is about, so every control here is a real one.

import { compareLatest, countBySeverity } from './lib/compare.ts';
import type { ComparedBarrier, Comparison } from './lib/compare.ts';
import { groupByForm, parseReport } from './lib/report.ts';
import type { BarrierReport, Form, Severity } from './lib/report.ts';
import { CRITERIA, findingsOf, summariseWcag } from './lib/wcag.ts';
import { initTheme } from './lib/theme.ts';
// DEMO STAND-IN. Nothing sends reports to this page yet, so it opens on one seeded report:
// a real BRIDGE scan of the Acme Careers test form (extension/test/fixtures/acme/apply.html),
// written by `make demo-seed` and kept equal to what the scanner reports by the extension's
// e2e suite. It is not hand-written, and it is the only report this page shows.
import seed from './demo-seed.json';

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

/** Where the form lives. Always available, and what identifies it across reports. */
const formUrl = (f: Form): string => `${f.portal}${f.pagePath}`;

/** What the posting calls itself, as the page gave it. A form whose page had no heading —
 *  and any report written before postingTitle existed — falls back to its address. */
const formTitle = (f: Form): string =>
  f.scans[f.scans.length - 1]?.postingTitle ?? formUrl(f);

// The date only, no clock time. The demo seed is captured ahead of time, so a clock time on
// stage would read as earlier than the submit the audience just watched. The full time stays
// in the datetime attribute.
const when = (iso: string): HTMLElement =>
  el('time', { datetime: iso, text: new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) });

// --- state ---------------------------------------------------------------------------
// Every report the page holds. Forms are derived from it, never stored alongside it: two
// sources of truth for "what do we hold" is how a dashboard starts disagreeing with itself.
// The seed goes through the same boundary check any report would; a seed that fails it is a
// programmer error and stops the page here, rather than rendering an empty list.
const loaded: BarrierReport[] = [parseReport(seed, 'demo-seed.json')];
/** The form whose detail is open, so focus can go back to its row on the way out. */
let openedKey: string | null = null;

/** How many distinct scans we hold. groupByForm is the one place that decides what counts as one scan. */
const totalScans = (forms: Form[]): number => forms.reduce((n, f) => n + f.scans.length, 0);

const announce = (message: string): void => { $('live').textContent = message; };

// --- form list -----------------------------------------------------------------------

function changeSummary(c: Comparison): string {
  if (!c.hasPrevious) return 'No earlier report';
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

  const head = el('tr', {}, [
    el('th', { scope: 'col', text: 'Job posting' }),
    el('th', { scope: 'col', text: 'Last checked' }),
    el('th', { scope: 'col', text: 'Blocking' }),
    el('th', { scope: 'col', text: 'Usability' }),
    el('th', { scope: 'col', text: 'Since last report' }),
  ]);

  const rows = forms.map((form) => {
    const newest = form.scans[form.scans.length - 1];
    const counts = countBySeverity(newest);
    const comparison = compareLatest(form.scans);
    const open = el('button', { type: 'button', class: 'linkish', text: formTitle(form), 'data-form-key': form.key });
    open.addEventListener('click', () => openDetail(form.key));
    return el('tr', {}, [
      // The posting names itself; its address is what identifies it, kept underneath.
      el('th', { scope: 'row' }, [open, el('span', { class: 'row__url', text: formUrl(form) })]),
      el('td', {}, [when(newest.generatedAt)]),
      el('td', { class: counts.blocking ? 'count count--blocking' : 'count', text: String(counts.blocking) }),
      el('td', { class: 'count', text: String(counts.usability) }),
      el('td', { class: comparison.new.length ? 'change change--new' : 'change', text: changeSummary(comparison) }),
    ]);
  });

  // Counted from the reports on the page, never estimated: postings tracked, findings
  // open across their newest reports, how many of those block someone outright, and how
  // many distinct success criteria they touch.
  const newest = forms.map((f) => f.scans[f.scans.length - 1]);
  const allFindings = newest.flatMap((r) => findingsOf(r));
  const criteria = new Set(allFindings.flatMap((b) => b.wcag ?? []));
  const stat = (value: string, label: string, mod = '') =>
    el('div', { class: `stat ${mod}`.trim() }, [
      el('p', { class: 'stat__value', text: value }),
      el('p', { class: 'stat__label', text: label }),
    ]);
  body.append(el('div', { class: 'stats' }, [
    stat(String(forms.length), forms.length === 1 ? 'Posting tracked' : 'Postings tracked'),
    stat(String(allFindings.length), 'Open findings'),
    stat(String(allFindings.filter((b) => b.severity === 'blocking').length), 'Blocking', 'stat--blocking'),
    stat(String(criteria.size), 'WCAG criteria affected'),
  ]));

  const scans = totalScans(forms);
  body.append(el('table', {}, [
    el('caption', { text: `${forms.length} ${forms.length === 1 ? 'posting' : 'postings'}, from ${scans} ${scans === 1 ? 'report' : 'reports'}.` }),
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

/**
 * One finding, ordered the way the person who has to fix it reads it: what is affected,
 * what it does to someone, what to do about it — and only then the rule id and criteria,
 * which are for whoever files the ticket rather than for whoever decides it matters.
 */
function barrierItem(b: ComparedBarrier): HTMLElement {
  return el('li', { class: 'barrier' }, [
    el('p', { class: 'barrier__head' }, [
      el('span', { class: `sev sev--${b.severity}`, text: SEVERITY_WORD[b.severity] }),
      el('span', { class: 'barrier__where', text: b.scope === 'page' ? 'Affects the whole page' : `Field: ${b.label}` }),
    ]),
    el('p', { class: 'barrier__impact', text: b.impact }),
    // Decided by the scanner's rule catalogue and carried in the report; the dashboard only
    // shows it. Reports from before `fix` existed have none, and show no line.
    ...(b.fix ? [el('p', { class: 'barrier__fix' }, [el('strong', { text: 'Suggested fix: ' }), b.fix])] : []),
    el('div', { class: 'barrier__meta' }, [el('code', { text: b.rule }), wcagLine(b)]),
  ]);
}

/**
 * How the form stands against the guidelines BRIDGE checks.
 *
 * Every criterion the scanner reads is listed, not only the ones with findings. A table of
 * four failing numbers answered "what did you find"; it did not answer "how does my form
 * do", and it left the seven-criteria caveat as a run-on sentence nobody reads. Listing all
 * of them makes the limit of the check visible instead of stated: what is on this table is
 * what was looked at, and anything absent from it was never tested.
 *
 * "No findings" is not "passes", which is what the disclaimer below the table is for.
 */
function wcagSummarySection(newest: BarrierReport): HTMLElement {
  const findings = findingsOf(newest);
  const s = summariseWcag(findings);
  const section = el('section', { class: 'wcag-summary' }, [
    el('h3', { text: 'Accessibility check summary' }),
  ]);

  if (s.total === 0) {
    section.append(el('p', { class: 'empty', text: 'This report found no barriers, so there is nothing to map.' }));
    return section;
  }

  const blocking = findings.filter((b) => b.severity === 'blocking').length;
  const usability = findings.filter((b) => b.severity === 'usability').length;
  section.append(el('p', { class: 'summary-lead' }, [
    el('strong', { text: `${s.total} ${s.total === 1 ? 'finding' : 'findings'} on this form` }),
    ' — ',
    el('strong', { class: 'lead-blocking', text: `${blocking} blocking` }),
    ` and ${usability} usability.`,
  ]));

  // The producer says which criteria it can fail. Naming them all is what stops "no
  // finding" from reading as "passed": every other criterion was simply never tested.
  const checked = newest.standard?.checked ?? s.byCriterion.map((c) => c.criterion);
  if (newest.standard) {
    const { name, version, level } = newest.standard;
    section.append(el('p', { class: 'wcag-checked' }, [
      `Measured against ${name} ${version}, Level ${level}. BRIDGE checks the `,
      el('span', { text: String(checked.length) }),
      ' success criteria below. A criterion that is not on this list was not tested, so its absence from a report is not a pass.',
    ]));
  }

  const found = new Map(s.byCriterion.map((c) => [c.criterion, c]));
  section.append(el('table', { class: 'wcag-table' }, [
    el('caption', { text: 'Findings by success criterion. One finding citing two criteria is counted under each.' }),
    el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: 'Success criterion' }),
      el('th', { scope: 'col', text: 'Level' }),
      el('th', { scope: 'col', text: 'Findings' }),
      el('th', { scope: 'col', text: 'From rules' }),
    ])]),
    el('tbody', {}, checked.map((id) => {
      const hit = found.get(id);
      const meta = CRITERIA[id];
      return el('tr', { class: hit ? 'crit crit--hit' : 'crit crit--clear' }, [
        el('th', { scope: 'row' }, [
          el('span', { class: 'crit__id', text: id }),
          ...(meta ? [el('span', { class: 'crit__name', text: meta.name })] : []),
        ]),
        el('td', { text: meta?.level ?? hit?.level ?? '' }),
        el('td', { class: 'count', text: hit ? String(hit.count) : '0' }),
        el('td', hit ? {} : { class: 'crit__none' }, [hit ? hit.rules.join(', ') : 'No findings']),
      ]);
    })),
  ]));

  const tail: string[] = [];
  if (s.unmapped) tail.push(`${s.unmapped} ${s.unmapped === 1 ? 'finding is' : 'findings are'} not mapped to a criterion`);
  if (s.reviewRequired) tail.push(`${s.reviewRequired} need a person to confirm the detection`);
  if (tail.length) section.append(el('p', { class: 'wcag-tail', text: `${tail.join('. ')}.` }));

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

  // The address as a link, so the reader can open the form they are being told about.
  // Reports without a pageUrl — older ones, or a scheme we would not link — show the
  // address as plain text instead of a dead link.
  const meta = $('detail-meta');
  const address = newest.pageUrl
    ? el('a', { class: 'detail-url', href: newest.pageUrl, rel: 'noreferrer' }, [formUrl(form)])
    : el('span', { class: 'detail-url', text: formUrl(form) });
  meta.replaceChildren(address, ' · Last checked ', when(newest.generatedAt));
  if (previous) meta.append(', compared with ', when(previous.generatedAt));

  const body = $('detail-body');
  // With nothing to compare against there is no "new" and no "resolved" — only findings.
  // Rendering both as empty sections put two zeroes at the top of a first report and said
  // nothing. They appear as soon as there is an earlier report to compare with.
  body.replaceChildren(
    wcagSummarySection(newest),
    ...(comparison.hasPrevious
      ? [
        barrierSection('New since the previous report', 'Nothing new in this report.', comparison.new, 'bucket--new'),
        barrierSection('Still open', 'No barriers.', comparison.stillOpen),
        barrierSection('Resolved', 'Nothing was resolved since the previous report.', comparison.resolved, 'bucket--resolved'),
      ]
      : [barrierSection('Open', 'No barriers.', comparison.stillOpen)]),
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
  // rather than held as a node, so it survives the table being rebuilt.
  const row = openedKey === null ? null
    : document.querySelector<HTMLElement>(`[data-form-key="${CSS.escape(openedKey)}"]`);
  (row ?? $('list-h')).focus();
  openedKey = null;
}

function render(): void {
  renderList();
}

// --- wiring ---------------------------------------------------------------------------

$('back').addEventListener('click', closeDetail);
initTheme($('theme-toggle'), $('theme-toggle-label'));

render();
