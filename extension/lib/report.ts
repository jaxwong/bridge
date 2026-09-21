// The barrier report: bridge-user.md §6.7, which owns the format.
//
// toReport() flattens one ScanResult into what leaves the browser. Both producers use it —
// the side panel's "Export barrier report" and the monitor in ../../monitor — so one scanned
// page produces one report whichever side scanned it. buildReport() is the side panel's
// view of a whole application: toReport() of every step the applicant reached, combined.
//
// The dashboard declares this shape again, as a consumer validating untrusted input rather
// than a producer building it. §6.7 is the contract between them, not either declaration.
//
// Carries no field values and no applicant identity — only which rules fired, on which
// labelled field, and what it means for the user. There is deliberately no selector.

import type { ApplicationSession, BarrierReport, ReportBarrier, ReportPageBarrier, ScanResult } from './types';

/**
 * `pagePath` drops the query string: the dashboard identifies a form across time by
 * portal + pagePath, and a job posting's identity is in its path on every portal measured
 * in §11. `impact` is Barrier.message, renamed at the boundary: spoken to the applicant,
 * read by the employer.
 */
export function toReport(scan: Pick<ScanResult, 'url' | 'scannedAt' | 'fields' | 'pageBarriers'>): BarrierReport {
  const url = new URL(scan.url);
  return {
    portal: url.host,
    pagePath: url.pathname,
    generatedAt: scan.scannedAt,
    barriers: scan.fields.flatMap((f) =>
      f.barriers.map((b): ReportBarrier => ({ rule: b.rule, severity: b.severity, label: f.label, impact: b.message }))),
    pageBarriers: scan.pageBarriers.map((b): ReportPageBarrier => ({ rule: b.rule, severity: b.severity, impact: b.message })),
  };
}

/**
 * One application, every step reached. A one-step application is exactly toReport() of
 * that step, so it is byte-for-byte what the monitor writes for the same page. With more
 * steps, the two flat lists hold every step's barriers (each tagged with its `step`), the
 * form is identified by its FIRST step's path, `generatedAt` is the most recent scan, and
 * `steps[]` keeps the grouping. Consumers that do not know `steps` or `step` ignore them.
 */
export function buildReport(session: ApplicationSession): BarrierReport {
  const steps = [...session.steps].sort((a, b) => a.index - b.index);
  const parts = steps.map((s) => ({ step: s, report: toReport(s.scan) }));
  if (parts.length === 1) return parts[0].report;

  const tagged = parts.map(({ step, report }) => ({
    index: step.index,
    label: step.label,
    pagePath: report.pagePath,
    barriers: report.barriers.map((b) => ({ ...b, step: step.index })),
    pageBarriers: report.pageBarriers.map((b) => ({ ...b, step: step.index })),
  }));
  return {
    portal: parts[0].report.portal,
    pagePath: parts[0].report.pagePath,
    generatedAt: parts.map((p) => p.report.generatedAt).sort().at(-1)!,
    barriers: tagged.flatMap((s) => s.barriers),
    pageBarriers: tagged.flatMap((s) => s.pageBarriers),
    steps: tagged,
  };
}

/** Same stem as the monitor's files (monitor/run.mjs), so reports from both sort together. */
export function reportFileStem(r: BarrierReport): string {
  const slug = `${r.portal}${r.pagePath}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
  return `${slug}-${r.generatedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}`;
}

export function reportMarkdown(r: BarrierReport): string {
  const line = (b: ReportBarrier | ReportPageBarrier) =>
    `- **${b.severity}** \`${b.rule}\`${'label' in b ? ` on "${b.label}"` : ''}: ${b.impact}`;
  const list = (page: ReportPageBarrier[], field: ReportBarrier[], none: string) =>
    (page.length + field.length ? [...page, ...field].map(line).join('\n') : none);
  const total = r.barriers.length + r.pageBarriers.length;
  const body = r.steps
    ? r.steps.map((s) => `## Step ${s.index}: ${s.label}\n\n${list(s.pageBarriers, s.barriers, 'No barriers found on this step.')}`).join('\n\n')
    : list(r.pageBarriers, r.barriers, 'No barriers found.');
  return `# Accessibility barrier report: ${r.portal}${r.pagePath}\n\nGenerated ${r.generatedAt} by BRIDGE. ` +
    `${total} barrier${total === 1 ? '' : 's'}. Contains no applicant data.\n\n${body}\n`;
}
