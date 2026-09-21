// The barrier report: bridge-user.md §6.7, which owns the format.
//
// One ScanResult, flattened into what leaves the browser. Both producers use this — the
// side panel's "Export barrier report" and the monitor in ../../monitor — so one scanned
// page produces one report whichever side scanned it.
//
// The dashboard declares this shape again, as a consumer validating untrusted input rather
// than a producer building it. §6.7 is the contract between them, not either declaration.

import type { ScanResult, Severity } from './types';

export interface ReportBarrier {
  rule: string;
  severity: Severity;
  /** The field's label. Absent on page-level barriers, which belong to no field. */
  label?: string;
  /** Barrier.message, renamed at the boundary: spoken to the applicant, read by the employer. */
  impact: string;
}

export interface BarrierReport {
  portal: string;
  pagePath: string;
  generatedAt: string;
  barriers: ReportBarrier[];
  pageBarriers: ReportBarrier[];
}

/**
 * Carries no field values and no applicant identity — only which rules fired, on which
 * labelled field, and what it means for the user.
 *
 * `pagePath` drops the query string: the dashboard identifies a form across time by
 * portal + pagePath, and a job posting's identity is in its path on every portal measured
 * in §11. See §6.7.
 */
export function toReport(scan: ScanResult): BarrierReport {
  const url = new URL(scan.url);
  return {
    portal: url.host,
    pagePath: url.pathname,
    generatedAt: scan.scannedAt,
    barriers: scan.fields.flatMap((f) =>
      f.barriers.map((b): ReportBarrier => ({
        rule: b.rule, severity: b.severity, label: f.label, impact: b.message,
      }))),
    pageBarriers: scan.pageBarriers.map((b): ReportBarrier => ({
      rule: b.rule, severity: b.severity, impact: b.message,
    })),
  };
}
