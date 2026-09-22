// The barrier report: bridge-user.md §6.7, which owns the format.
//
// toReport() flattens one ScanResult into what leaves the browser. buildReport() is the
// side panel's view of a whole application: toReport() of every step the applicant reached,
// combined. The export is the only way a report leaves the browser, and it happens only
// when the applicant asks for it.
//
// The dashboard declares this shape again, as a consumer validating untrusted input rather
// than a producer building it. §6.7 is the contract between them, not either declaration.
//
// Carries no field values and no applicant identity — only which rules fired, on which
// labelled field, and what it means for the user. There is deliberately no selector.

// The .ts on './rules' is load-bearing: test/e2e.mjs imports this module directly in Node,
// which resolves value imports by exact path. Vite resolves it unchanged. './types' needs
// none — a type-only import is erased before resolution.
import { RULES, STANDARD, wcagFor, type RuleId } from './rules.ts';
import type { ApplicationSession, BarrierReport, Barrier, ReportBarrier, ReportPageBarrier, ScanResult } from './types';

/**
 * The automated WCAG 2.2 A/AA fields, for one barrier. `automated` is always true here:
 * everything this file builds came from the scanner. `wcag`, `wcagLevel` and
 * `reviewRequired` appear only when lib/rules.ts records a mapping for the rule — an
 * unmapped rule omits them entirely rather than carrying a guess, and the dashboard shows
 * "No WCAG mapping recorded".
 *
 * These findings are automated. Human review is required for a WCAG conformance claim.
 */
function wcagFields(rule: RuleId): Partial<ReportBarrier> {
  const m = wcagFor(rule);
  if (!m) return { automated: true };
  return { wcag: m.wcag, wcagLevel: m.wcagLevel, automated: true, reviewRequired: m.reviewRequired };
}

/**
 * `pagePath` drops the query string: the dashboard identifies a form across time by
 * portal + pagePath, and a job posting's identity is in its path on every portal measured
 * in §11. `impact` is Barrier.message, renamed at the boundary: spoken to the applicant,
 * read by the employer.
 */
export function toReport(scan: Pick<ScanResult, 'url' | 'scannedAt' | 'fields' | 'pageBarriers' | 'heading'>): BarrierReport {
  const url = new URL(scan.url);
  return {
    portal: url.host,
    pagePath: url.pathname,
    // The page's own heading, which is what the posting calls itself. Omitted rather than
    // guessed when the page has none.
    ...(scan.heading ? { postingTitle: scan.heading } : {}),
    // Scheme + host + path, so the dashboard can link to the form. The query string is
    // dropped here for the same reason it is dropped from pagePath.
    pageUrl: `${url.protocol}//${url.host}${url.pathname}`,
    generatedAt: scan.scannedAt,
    standard: STANDARD,
    barriers: scan.fields.flatMap((f) =>
      f.barriers.map((b: Barrier): ReportBarrier => ({
        rule: b.rule, severity: b.severity, label: f.label, impact: b.message, fix: RULES[b.rule].fix, ...wcagFields(b.rule),
      }))),
    pageBarriers: scan.pageBarriers.map((b: Barrier): ReportPageBarrier => ({
      rule: b.rule, severity: b.severity, impact: b.message, fix: RULES[b.rule].fix, ...wcagFields(b.rule),
    })),
  };
}

/**
 * One application, every step reached. A one-step application is exactly toReport() of
 * that step, so a single-step application exports exactly that. With more
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
    standard: STANDARD,
    barriers: tagged.flatMap((s) => s.barriers),
    pageBarriers: tagged.flatMap((s) => s.pageBarriers),
    steps: tagged,
  };
}

/** Names the file after the form and the moment, so exported reports sort together. */
export function reportFileStem(r: BarrierReport): string {
  const slug = `${r.portal}${r.pagePath}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
  return `${slug}-${r.generatedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}`;
}

export function reportMarkdown(r: BarrierReport): string {
  // WCAG numbers are stated as automated findings, never as a conformance result.
  const line = (b: ReportBarrier | ReportPageBarrier) =>
    `- **${b.severity}** \`${b.rule}\`${'label' in b ? ` on "${b.label}"` : ''}: ${b.impact}` +
    (b.wcag?.length ? ` _(WCAG ${b.wcagLevel} ${b.wcag.join(', ')})_` : ' _(no WCAG mapping recorded)_') +
    `\n  Suggested fix: ${b.fix}`;
  const list = (page: ReportPageBarrier[], field: ReportBarrier[], none: string) =>
    (page.length + field.length ? [...page, ...field].map(line).join('\n') : none);
  const total = r.barriers.length + r.pageBarriers.length;
  const body = r.steps
    ? r.steps.map((s) => `## Step ${s.index}: ${s.label}\n\n${list(s.pageBarriers, s.barriers, 'No barriers found on this step.')}`).join('\n\n')
    : list(r.pageBarriers, r.barriers, 'No barriers found.');
  return `# Accessibility barrier report: ${r.portal}${r.pagePath}\n\nGenerated ${r.generatedAt} by BRIDGE. ` +
    `${total} barrier${total === 1 ? '' : 's'}. Contains no applicant data.\n\n` +
    `These are automated ${r.standard.name} ${r.standard.version} A/AA accessibility findings. They are not a conformance ` +
    'result: human review is required for a WCAG conformance claim. BRIDGE can fail only these ' +
    `criteria: ${r.standard.checked.join(', ')}. Any other criterion was not checked.\n\n` +
    `${body}\n`;
}
