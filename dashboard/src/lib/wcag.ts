// Summarising automated WCAG 2.2 A/AA findings for one scan.
//
// This file counts what a report already says. It does not decide which criterion a rule
// maps to — that belongs to the producer (extension/lib/rules.ts), which reads the rule's
// implementation. A finding that arrives with no mapping is reported as unmapped here and
// shown as "No WCAG mapping recorded", never guessed at.
//
// The result is a count of automated findings, not a conformance result. Human review is
// required for a WCAG conformance claim.

import type { BarrierReport, ReportBarrier, WcagLevel } from './report.ts';

export interface CriterionCount {
  criterion: string;
  level: WcagLevel;
  count: number;
  /** Which scanner rules produced findings against this criterion, for the detail view. */
  rules: string[];
}

export interface WcagSummary {
  /** Findings that carry at least one criterion, counted once each by their level. */
  byLevel: { level: WcagLevel; count: number }[];
  /** Findings counted once per criterion, so one finding can appear under two criteria. */
  byCriterion: CriterionCount[];
  mapped: number;
  /** Findings whose rule has no recorded mapping. Real barriers, simply not mapped. */
  unmapped: number;
  /** Findings the producer flagged as needing a person to confirm the detection. */
  reviewRequired: number;
  total: number;
}

/** "1.3.1" before "2.1.1" before "2.5.3" — numerically, not as text. */
function byCriterionNumber(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const isMapped = (b: ReportBarrier): boolean => !!b.wcag && b.wcag.length > 0;

/** Every finding in one scan, field-level and page-level alike. */
export const findingsOf = (report: BarrierReport): ReportBarrier[] =>
  [...report.barriers, ...report.pageBarriers];

export function summariseWcag(findings: ReportBarrier[]): WcagSummary {
  const levels = new Map<WcagLevel, number>();
  const criteria = new Map<string, CriterionCount>();
  let mapped = 0;
  let reviewRequired = 0;

  for (const b of findings) {
    if (b.reviewRequired) reviewRequired += 1;
    if (!isMapped(b)) continue;
    mapped += 1;

    // A finding counts once at its level even when it cites two criteria.
    const level: WcagLevel = b.wcagLevel ?? 'A';
    levels.set(level, (levels.get(level) ?? 0) + 1);

    for (const criterion of b.wcag!) {
      const entry = criteria.get(criterion) ?? { criterion, level, count: 0, rules: [] };
      entry.count += 1;
      if (!entry.rules.includes(b.rule)) entry.rules.push(b.rule);
      criteria.set(criterion, entry);
    }
  }

  return {
    byLevel: (['A', 'AA'] as WcagLevel[])
      .filter((l) => levels.has(l))
      .map((l) => ({ level: l, count: levels.get(l)! })),
    byCriterion: [...criteria.values()].sort((a, b) => byCriterionNumber(a.criterion, b.criterion)),
    mapped,
    unmapped: findings.length - mapped,
    reviewRequired,
    total: findings.length,
  };
}
