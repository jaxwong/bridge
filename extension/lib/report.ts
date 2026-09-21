// Barrier report: spec §6.7. The contract with the employer dashboard and monitor
// (bridge-business.md §6). Accessibility failures only: no field values, no applicant
// identity. Field barriers are keyed by `rule` + `label`, page barriers by `rule` alone;
// there is deliberately no selector.

import type { ApplicationSession, BarrierReport, ReportBarrier, ReportPageBarrier, StepRecord } from './types';

function fieldBarriers(step: StepRecord, withStep: boolean): ReportBarrier[] {
  const tag = withStep ? { step: step.index } : {};
  return step.scan.fields.flatMap((f) => f.barriers.map((b) => ({ rule: b.rule, severity: b.severity, label: f.label, impact: b.message, ...tag })));
}

function pageBarriers(step: StepRecord, withStep: boolean): ReportPageBarrier[] {
  const tag = withStep ? { step: step.index } : {};
  return step.scan.pageBarriers.map((b) => ({ rule: b.rule, severity: b.severity, impact: b.message, ...tag }));
}

export function buildReport(session: ApplicationSession): BarrierReport {
  const steps = [...session.steps].sort((a, b) => a.index - b.index);
  const many = steps.length > 1;
  const first = new URL(steps[0].url);
  const report: BarrierReport = {
    portal: first.host,
    pagePath: first.pathname,
    generatedAt: new Date().toISOString(),
    barriers: steps.flatMap((s) => fieldBarriers(s, many)),
    pageBarriers: steps.flatMap((s) => pageBarriers(s, many)),
  };
  if (many) {
    report.steps = steps.map((s) => ({
      index: s.index, label: s.label, pagePath: new URL(s.url).pathname,
      barriers: fieldBarriers(s, true), pageBarriers: pageBarriers(s, true),
    }));
  }
  return report;
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
