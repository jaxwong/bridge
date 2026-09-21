// Compare two scans of one form: bridge-business.md §6.3.

import type { BarrierReport, ReportBarrier, Severity } from './report.ts';

/** Where a barrier lives. Field-level barriers carry a label; page-level ones cannot. */
export type BarrierScope = 'field' | 'page';

export interface ComparedBarrier extends ReportBarrier {
  scope: BarrierScope;
  /** Identity across scans. Never shown; never parsed back apart. */
  key: string;
}

export interface Comparison {
  /** In the previous scan, gone from the newest. */
  resolved: ComparedBarrier[];
  /** In both. On a form's first scan, everything lands here — an unknown history is not a clean one. */
  stillOpen: ComparedBarrier[];
  /** In the newest only. This is the alert. Empty on a first scan. */
  new: ComparedBarrier[];
  /** False when this is the form's first scan, so the UI can say "open" rather than "still open". */
  hasPrevious: boolean;
}

/**
 * A barrier's identity across form versions: the rule, plus the label of the field it is on.
 *
 * Not the selector. Generated selectors change whenever the vendor ships a release, which
 * would report every barrier on the form as resolved and reintroduced on the same day
 * (bridge-user.md §6.7). Page-level barriers belong to no field, so the rule is all there is.
 *
 * The scope is part of the key so that one rule reported at both levels — `drag-drop-only`
 * is page-level in scan.ts today — can never pair a field barrier with a page one.
 */
const keyOf = (b: ReportBarrier, scope: BarrierScope): string =>
  scope === 'field' ? `field|${b.rule}|${b.label ?? ''}` : `page|${b.rule}`;

/**
 * Every barrier in one report, by key.
 *
 * Two barriers can share a key within one scan: a page with two unlabelled file inputs
 * reports `drag-drop-only` once per input, and page barriers carry no label to tell them
 * apart. Keying them into a Map collapses them, which is what the employer wants to read —
 * one broken uploader pattern, not a count of the elements it is on.
 */
function index(report: BarrierReport): Map<string, ComparedBarrier> {
  const out = new Map<string, ComparedBarrier>();
  const add = (b: ReportBarrier, scope: BarrierScope) => {
    const key = keyOf(b, scope);
    out.set(key, { ...b, scope, key });
  };
  report.barriers.forEach((b) => add(b, 'field'));
  report.pageBarriers.forEach((b) => add(b, 'page'));
  return out;
}

const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, usability: 1, ok: 2 };

/** Blocking first, then by rule, then by label: the order the employer should read them in. */
const bySeverity = (a: ComparedBarrier, b: ComparedBarrier): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
  a.rule.localeCompare(b.rule) ||
  (a.label ?? '').localeCompare(b.label ?? '');

/**
 * `previous` is null for a form we have scanned only once. Everything then reads as open and
 * nothing as new: a first scan has no history to have regressed from, and flagging one as a
 * page of new barriers would cry wolf on every form the day it is added (§6.3).
 */
export function compare(newest: BarrierReport, previous: BarrierReport | null): Comparison {
  const now = index(newest);
  const before = previous ? index(previous) : new Map<string, ComparedBarrier>();

  const resolved: ComparedBarrier[] = [];
  const stillOpen: ComparedBarrier[] = [];
  const appeared: ComparedBarrier[] = [];

  for (const [key, barrier] of now) {
    // Report the newest wording, not the previous one: the impact sentence follows the
    // label the page shows today.
    (before.has(key) || !previous ? stillOpen : appeared).push(barrier);
  }
  for (const [key, barrier] of before) {
    if (!now.has(key)) resolved.push(barrier);
  }

  return {
    resolved: resolved.sort(bySeverity),
    stillOpen: stillOpen.sort(bySeverity),
    new: appeared.sort(bySeverity),
    hasPrevious: previous !== null,
  };
}

/** The comparison a form's newest scan deserves: against the scan before it, if there is one. */
export function compareLatest(scans: BarrierReport[]): Comparison {
  if (scans.length === 0) throw new Error('compareLatest needs at least one scan');
  return compare(scans[scans.length - 1], scans.length > 1 ? scans[scans.length - 2] : null);
}

/** Counts by severity for one scan, for the form list. Only ever what was measured. */
export function countBySeverity(report: BarrierReport): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocking: 0, usability: 0, ok: 0 };
  for (const b of [...report.barriers, ...report.pageBarriers]) counts[b.severity] += 1;
  return counts;
}
