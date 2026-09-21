// Barrier report: spec §6.7. The contract with the employer dashboard and monitor
// (bridge-business.md §6). Accessibility failures only: no field values, no applicant
// identity. The compare key is `rule` + `field`; there is deliberately no selector.

import type { ApplicationSession, BarrierReport, ReportBarrier, StepRecord } from './types';

function barriersOf(step: StepRecord, withStep: boolean): ReportBarrier[] {
  const tag = withStep ? { step: step.index } : {};
  return [
    ...step.scan.pageBarriers.map((b) => ({ rule: b.rule, severity: b.severity, field: null, impact: b.message, ...tag })),
    ...step.scan.fields.flatMap((f) => f.barriers.map((b) => ({ rule: b.rule, severity: b.severity, field: f.label, impact: b.message, ...tag }))),
  ];
}

export function buildReport(session: ApplicationSession): BarrierReport {
  const steps = [...session.steps].sort((a, b) => a.index - b.index);
  const many = steps.length > 1;
  const first = new URL(steps[0].url);
  const report: BarrierReport = {
    portal: first.host,
    pagePath: first.pathname,
    generatedAt: new Date().toISOString(),
    barriers: steps.flatMap((s) => barriersOf(s, many)),
  };
  if (many) {
    report.steps = steps.map((s) => ({ index: s.index, label: s.label, pagePath: new URL(s.url).pathname, barriers: barriersOf(s, true) }));
  }
  return report;
}

export function reportMarkdown(r: BarrierReport): string {
  const line = (b: ReportBarrier) => `- **${b.severity}** \`${b.rule}\`${b.field ? ` on "${b.field}"` : ''}: ${b.impact}`;
  const body = r.steps
    ? r.steps.map((s) => `## Step ${s.index}: ${s.label}\n\n${s.barriers.length ? s.barriers.map(line).join('\n') : 'No barriers found on this step.'}`).join('\n\n')
    : (r.barriers.length ? r.barriers.map(line).join('\n') : 'No barriers found.');
  return `# Accessibility barrier report: ${r.portal}${r.pagePath}\n\nGenerated ${r.generatedAt} by BRIDGE. ` +
    `${r.barriers.length} barrier${r.barriers.length === 1 ? '' : 's'}. Contains no applicant data.\n\n${body}\n`;
}
