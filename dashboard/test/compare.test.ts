// Compare logic against the hand-written reports in fixtures/reports (bridge-business.md §6.3).
// Run: node --experimental-strip-types test/compare.test.ts
//
// The three Acme reports are one form on three days: baseline, the dropdown fixed, a CV
// uploader added. Every transition the dashboard can show is in here, plus the first scan
// of a second form, which must read as open rather than as a page of regressions.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, compareLatest, countBySeverity } from '../src/lib/compare.ts';
import { groupByForm, parseReport } from '../src/lib/report.ts';
import { findingsOf, summariseWcag } from '../src/lib/wcag.ts';
import type { BarrierReport } from '../src/lib/report.ts';
import type { ComparedBarrier } from '../src/lib/compare.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '../../fixtures/reports');

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const load = (rel: string): BarrierReport =>
  parseReport(JSON.parse(readFileSync(path.join(FIXTURES, rel), 'utf8')), rel);

const ACME = 'localhost-8765';
const v1 = load(`${ACME}/2026-09-21T09-00-00Z.json`);
const v2 = load(`${ACME}/2026-09-22T09-00-00Z.json`);
const v3 = load(`${ACME}/2026-09-23T09-00-00Z.json`);
const greenhouse = load('boards-greenhouse-io-example-jobs-0000000/2026-09-21T09-00-00Z.json');

const rules = (bs: ComparedBarrier[]) => bs.map((b) => b.rule).sort().join(',');

// --- the fixtures are what the scanner should produce -------------------------------
check('v1 baseline: 5 field barriers, 0 page barriers',
  v1.barriers.length === 5 && v1.pageBarriers.length === 0,
  `${v1.barriers.length} / ${v1.pageBarriers.length}`);
check('v1 counts by severity: 4 blocking, 1 usability',
  countBySeverity(v1).blocking === 4 && countBySeverity(v1).usability === 1,
  JSON.stringify(countBySeverity(v1)));

// --- v1 -> v2: Acme fixes the education dropdown ------------------------------------
const fixed = compare(v2, v1);
check('fix: the three education-dropdown barriers are resolved',
  rules(fixed.resolved) === 'custom-dropdown-no-role,missing-label,not-keyboard-operable',
  rules(fixed.resolved));
check('fix: the two visa barriers are still open',
  rules(fixed.stillOpen) === 'group-not-labelled,options-identically-named', rules(fixed.stillOpen));
check('fix: nothing is new', fixed.new.length === 0, rules(fixed.new));
check('fix: resolved barriers are reported blocking-first',
  fixed.resolved.map((b) => b.severity).join(',') === 'blocking,blocking,usability',
  fixed.resolved.map((b) => b.severity).join(','));

// --- v2 -> v3: the employer adds a drag-and-drop CV uploader ------------------------
const regressed = compare(v3, v2);
check('regression: drag-drop-only is flagged as new', rules(regressed.new) === 'drag-drop-only', rules(regressed.new));
check('regression: the new barrier is page-level and blocking',
  regressed.new[0]?.scope === 'page' && regressed.new[0]?.severity === 'blocking',
  `${regressed.new[0]?.scope} / ${regressed.new[0]?.severity}`);
check('regression: the visa barriers are still open, not re-reported as new',
  rules(regressed.stillOpen) === 'group-not-labelled,options-identically-named', rules(regressed.stillOpen));
check('regression: nothing is resolved', regressed.resolved.length === 0, rules(regressed.resolved));

// --- v1 -> v3: a fix and a regression seen in one comparison ------------------------
const skipped = compare(v3, v1);
check('v1 to v3: three resolved, two still open, one new',
  skipped.resolved.length === 3 && skipped.stillOpen.length === 2 && skipped.new.length === 1,
  `${skipped.resolved.length}/${skipped.stillOpen.length}/${skipped.new.length}`);

// --- a form's first scan is not a page of regressions (§6.3) ------------------------
const first = compare(greenhouse, null);
check('first scan: the barrier is open, not new',
  first.stillOpen.length === 1 && first.new.length === 0 && first.resolved.length === 0,
  `${first.resolved.length}/${first.stillOpen.length}/${first.new.length}`);
check('first scan: hasPrevious is false so the UI can say "open", not "still open"',
  first.hasPrevious === false);
check('a form with a previous scan reports hasPrevious', compare(v2, v1).hasPrevious === true);

// --- an unchanged form reports no change --------------------------------------------
const unchanged = compare(v3, v3);
check('rescanning an unchanged form flags nothing',
  unchanged.new.length === 0 && unchanged.resolved.length === 0 && unchanged.stillOpen.length === 3,
  `${unchanged.resolved.length}/${unchanged.stillOpen.length}/${unchanged.new.length}`);

// --- the compare key is rule + label, not rule alone --------------------------------
const twoFields: BarrierReport = {
  ...v1,
  barriers: [
    { rule: 'missing-label', severity: 'usability', label: 'Phone number', impact: 'x' },
    { rule: 'missing-label', severity: 'usability', label: 'LinkedIn URL', impact: 'y' },
  ],
  pageBarriers: [],
};
const oneField: BarrierReport = { ...twoFields, barriers: [twoFields.barriers[0]] };
check('the same rule on two fields is two barriers, not one',
  compare(twoFields, oneField).new.length === 1 &&
  compare(twoFields, oneField).new[0].label === 'LinkedIn URL',
  compare(twoFields, oneField).new[0]?.label);
check('the same rule moving to a different field is one resolved and one new',
  compare(oneField, { ...twoFields, barriers: [twoFields.barriers[1]] }).resolved.length === 1);

// --- one rule reported twice in one scan is one barrier -----------------------------
// A page with two unlabelled file inputs reports drag-drop-only once per input, and page
// barriers carry no label to tell them apart.
const twoUploaders: BarrierReport = {
  ...v1,
  barriers: [],
  pageBarriers: [
    { rule: 'drag-drop-only', severity: 'blocking', impact: 'The CV uploader can only be used by dragging a file onto it.' },
    { rule: 'drag-drop-only', severity: 'blocking', impact: 'The CV uploader can only be used by dragging a file onto it.' },
  ],
};
const noUploader: BarrierReport = { ...twoUploaders, pageBarriers: [] };
check('a rule reported twice in one scan is one barrier',
  compare(twoUploaders, noUploader).new.length === 1,
  String(compare(twoUploaders, noUploader).new.length));
check('and one barrier when it is resolved, too',
  compare(noUploader, twoUploaders).resolved.length === 1,
  String(compare(noUploader, twoUploaders).resolved.length));

// --- grouping and ordering ----------------------------------------------------------
const forms = groupByForm([v3, greenhouse, v1, v2]);
check('reports group into two forms', forms.length === 2, forms.map((f) => f.key).join(' | '));
const acme = forms.find((f) => f.portal === 'localhost:8765')!;
check('scans of one form are ordered oldest first regardless of load order',
  acme.scans.map((s) => s.generatedAt.slice(8, 10)).join(',') === '21,22,23',
  acme.scans.map((s) => s.generatedAt).join(' '));
check('compareLatest compares the newest scan with the one before it',
  rules(compareLatest(acme.scans).new) === 'drag-drop-only');
check('compareLatest on a single scan reports nothing as new',
  compareLatest([greenhouse]).new.length === 0 && compareLatest([greenhouse]).hasPrevious === false);
check('the same file loaded twice is still one scan',
  groupByForm([v1, v2, v3, v2]).find((f) => f.portal === 'localhost:8765')!.scans.length === 3);

// --- a picked file that is not a report says so, by name ----------------------------
const rejects = (label: string, raw: unknown, expect: RegExp) => {
  try {
    parseReport(raw, 'picked-file.json');
    check(label, false, 'no error thrown');
  } catch (e) {
    const msg = (e as Error).message;
    check(label, expect.test(msg), msg);
  }
};
rejects('rejects a file that is not an object', [1, 2], /picked-file\.json.*array/);
rejects('rejects a report with no pagePath', { portal: 'x', generatedAt: '2026-01-01T00:00:00Z', barriers: [], pageBarriers: [] }, /"pagePath" is missing/);
rejects('rejects a report with no pageBarriers array', { portal: 'x', pagePath: '/', generatedAt: '2026-01-01T00:00:00Z', barriers: [] }, /"pageBarriers" is missing/);
rejects('rejects an unparseable generatedAt', { portal: 'x', pagePath: '/', generatedAt: 'last Tuesday', barriers: [], pageBarriers: [] }, /not a date/);
rejects('rejects a field barrier with no label, which could not be compared',
  { portal: 'x', pagePath: '/', generatedAt: '2026-01-01T00:00:00Z', barriers: [{ rule: 'missing-label', severity: 'usability', impact: 'x' }], pageBarriers: [] },
  /barriers\[0\] \(missing-label\) has no "label"/);
rejects('rejects an unknown severity',
  { portal: 'x', pagePath: '/', generatedAt: '2026-01-01T00:00:00Z', barriers: [], pageBarriers: [{ rule: 'captcha', severity: 'critical', impact: 'x' }] },
  /expected one of blocking, usability, ok/);
check('a page barrier with no label is accepted, because page barriers have none',
  parseReport({ portal: 'x', pagePath: '/', generatedAt: '2026-01-01T00:00:00Z', barriers: [], pageBarriers: [{ rule: 'captcha', severity: 'blocking', impact: 'x' }] }, 'ok.json').pageBarriers.length === 1);

// --- automated WCAG 2.2 A/AA findings ------------------------------------------------
// The fixtures in fixtures/reports/ predate the WCAG fields and are kept exactly as they
// were: they are the back-compatibility corpus. fixtures/reports-wcag/ is a real capture
// from the current monitor.

const WCAG_DIR = path.resolve(here, '../../fixtures/reports-wcag/localhost-8765');
const enriched = readdirSync(WCAG_DIR).sort()
  .map((f) => parseReport(JSON.parse(readFileSync(path.join(WCAG_DIR, f), 'utf8')), f));
const [w1, w2, w3] = enriched;

// Legacy: a report written before these fields existed must still load, unchanged.
check('a legacy report with no WCAG fields still parses', v1.barriers.length === 5);
check('and carries no WCAG fields rather than invented ones',
  v1.barriers.every((b) => b.wcag === undefined && b.wcagLevel === undefined
    && b.automated === undefined && b.reviewRequired === undefined));
check('a legacy first scan still summarises, as entirely unmapped',
  summariseWcag(findingsOf(v1)).mapped === 0 && summariseWcag(findingsOf(v1)).unmapped === 5,
  JSON.stringify(summariseWcag(findingsOf(v1))));

// Enriched: the fields survive the round trip through the producer and the parser.
const identical = w1.barriers.find((b) => b.rule === 'options-identically-named')!;
check('an enriched report carries its success criteria',
  JSON.stringify(identical.wcag) === JSON.stringify(['4.1.2', '2.5.3']), JSON.stringify(identical.wcag));
check('and its level and automated flag',
  identical.wcagLevel === 'A' && identical.automated === true,
  `${identical.wcagLevel} / ${identical.automated}`);
check('a rule whose detection is heuristic is flagged for human review',
  w1.barriers.find((b) => b.rule === 'not-keyboard-operable')!.reviewRequired === true);
check('a rule read straight from the DOM is not',
  w1.barriers.find((b) => b.rule === 'group-not-labelled')!.reviewRequired === false);

const s1 = summariseWcag(findingsOf(w1));
check('every finding in the baseline scan maps to a criterion',
  s1.mapped === 5 && s1.unmapped === 0, `${s1.mapped} mapped / ${s1.unmapped} unmapped`);
check('findings are counted once each by level',
  JSON.stringify(s1.byLevel) === JSON.stringify([{ level: 'A', count: 5 }]), JSON.stringify(s1.byLevel));
check('a finding citing two criteria is counted under each',
  s1.byCriterion.find((c) => c.criterion === '2.5.3')!.count === 1 &&
  s1.byCriterion.find((c) => c.criterion === '4.1.2')!.count === 3,
  s1.byCriterion.map((c) => `${c.criterion}x${c.count}`).join(' '));
check('criteria are ordered numerically, not as text',
  s1.byCriterion.map((c) => c.criterion).join(',') === '1.3.1,2.1.1,2.5.3,4.1.2',
  s1.byCriterion.map((c) => c.criterion).join(','));
check('each criterion names the rules that produced it',
  s1.byCriterion.find((c) => c.criterion === '2.1.1')!.rules.join(',') === 'not-keyboard-operable');

// An unmapped rule stays a real finding; it is never dropped and never given a guess.
const withCaptcha: BarrierReport = {
  ...w1,
  barriers: [],
  pageBarriers: [{ rule: 'captcha', severity: 'blocking', impact: 'x', automated: true }],
};
const sc = summariseWcag(findingsOf(withCaptcha));
check('an unmapped finding is counted as unmapped, not discarded',
  sc.total === 1 && sc.mapped === 0 && sc.unmapped === 1, JSON.stringify(sc));
check('and contributes no level and no criterion',
  sc.byLevel.length === 0 && sc.byCriterion.length === 0);

// The comparison is the product. Adding WCAG fields must not move a single barrier.
const legacyFix = compare(v2, v1);
const enrichedFix = compare(w2, w1);
const enrichedRegress = compare(w3, w2);
check('WCAG fields do not change what is resolved',
  rules(enrichedFix.resolved) === rules(legacyFix.resolved), rules(enrichedFix.resolved));
check('WCAG fields do not change what is still open',
  rules(enrichedFix.stillOpen) === rules(legacyFix.stillOpen));
check('WCAG fields do not change what is new',
  rules(enrichedRegress.new) === 'drag-drop-only' && enrichedRegress.resolved.length === 0,
  rules(enrichedRegress.new));
check('the compare key is still rule + label, and ignores the WCAG fields',
  compare({ ...w1, barriers: w1.barriers.map((b) => ({ ...b, wcag: ['9.9.9'], wcagLevel: 'AA' as const })) }, w1)
    .new.length === 0);

// Malformed WCAG data is rejected by name. A criterion number shown to an employer is the
// part they would quote, so a half-parsed one is worse than a refused file.
const withBarrier = (extra: Record<string, unknown>) => ({
  portal: 'x', pagePath: '/', generatedAt: '2026-01-01T00:00:00Z',
  barriers: [{ rule: 'missing-label', severity: 'usability', label: 'Name', impact: 'x', ...extra }],
  pageBarriers: [],
});
rejects('rejects a wcag that is not an array', withBarrier({ wcag: '4.1.2' }), /not a non-empty array/);
rejects('rejects an empty wcag array', withBarrier({ wcag: [] }), /not a non-empty array/);
rejects('rejects a guideline number in place of a criterion', withBarrier({ wcag: ['4.1'] }), /expected a number like "4\.1\.2"/);
rejects('rejects a prose criterion', withBarrier({ wcag: ['WCAG 4.1.2 Name, Role, Value'] }), /expected a number like/);
rejects('rejects an unknown conformance level', withBarrier({ wcag: ['4.1.2'], wcagLevel: 'AAA' }), /expected "A" or "AA"/);
rejects('rejects a non-boolean automated flag', withBarrier({ automated: 'yes' }), /"automated" that is not true or false/);
rejects('rejects a non-boolean reviewRequired flag', withBarrier({ reviewRequired: 1 }), /"reviewRequired" that is not true or false/);
check('a barrier with no WCAG fields at all is still accepted',
  parseReport(withBarrier({}), 'ok.json').barriers[0].wcag === undefined);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
