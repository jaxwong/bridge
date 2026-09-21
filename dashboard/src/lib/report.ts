// The barrier report as it arrives from the monitor or from the extension's export.
// The format is defined in bridge-user.md §6.7 and owned there; this file only reads it.

export type Severity = 'blocking' | 'usability' | 'ok';

export interface ReportBarrier {
  rule: string;
  severity: Severity;
  /** The field's label. Present on `barriers`, absent on `pageBarriers`, which belong to no field. */
  label?: string;
  /** One plain sentence: what a screen reader user cannot do. Shown to the employer as-is. */
  impact: string;
}

export interface BarrierReport {
  /** Host of the scanned page, port included. */
  portal: string;
  /** Pathname only — no query string. §6.7 explains why. */
  pagePath: string;
  generatedAt: string;
  barriers: ReportBarrier[];
  pageBarriers: ReportBarrier[];
}

/** One form, with every scan of it we have been given, oldest first. */
export interface Form {
  key: string;
  portal: string;
  pagePath: string;
  scans: BarrierReport[];
}

const SEVERITIES: Severity[] = ['blocking', 'usability', 'ok'];

/**
 * A form's identity across time: where it lives, not when it was scanned. Reports are
 * grouped by this rather than by file name, because a file picker hands over a name and
 * no directory (bridge-business.md §6.4).
 */
export const formKey = (r: Pick<BarrierReport, 'portal' | 'pagePath'>): string => `${r.portal}${r.pagePath}`;

function fail(source: string, detail: string): never {
  throw new Error(`${source} is not a BRIDGE barrier report: ${detail}`);
}

function parseBarrier(raw: unknown, source: string, where: string, needsLabel: boolean): ReportBarrier {
  if (typeof raw !== 'object' || raw === null) fail(source, `${where} is ${raw === null ? 'null' : typeof raw}, expected an object`);
  const b = raw as Record<string, unknown>;

  if (typeof b.rule !== 'string' || !b.rule) fail(source, `${where} has no "rule"`);
  if (typeof b.impact !== 'string' || !b.impact) fail(source, `${where} (${b.rule}) has no "impact" sentence`);
  if (!SEVERITIES.includes(b.severity as Severity)) {
    fail(source, `${where} (${b.rule}) has severity ${JSON.stringify(b.severity)}, expected one of ${SEVERITIES.join(', ')}`);
  }
  // The compare key is rule + label (§6.7). A field-level barrier without one cannot be
  // tracked across scans, so it is rejected at the boundary rather than silently dropped.
  if (needsLabel && (typeof b.label !== 'string' || !b.label)) {
    fail(source, `${where} (${b.rule}) has no "label" — field-level barriers are compared by rule + label`);
  }

  const out: ReportBarrier = { rule: b.rule, severity: b.severity as Severity, impact: b.impact };
  if (typeof b.label === 'string' && b.label) out.label = b.label;
  return out;
}

/**
 * Validate one loaded file. Anything a person can pick in a file dialog reaches this, so it
 * reports what is wrong with the file by name instead of failing later inside compare.
 */
export function parseReport(raw: unknown, source: string): BarrierReport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(source, `the file holds ${Array.isArray(raw) ? 'an array' : raw === null ? 'null' : `a ${typeof raw}`}, expected an object`);
  }
  const r = raw as Record<string, unknown>;

  for (const k of ['portal', 'pagePath', 'generatedAt'] as const) {
    if (typeof r[k] !== 'string' || !r[k]) fail(source, `"${k}" is missing`);
  }
  if (Number.isNaN(Date.parse(r.generatedAt as string))) {
    fail(source, `"generatedAt" is ${JSON.stringify(r.generatedAt)}, which is not a date`);
  }
  for (const k of ['barriers', 'pageBarriers'] as const) {
    if (!Array.isArray(r[k])) fail(source, `"${k}" is ${r[k] === undefined ? 'missing' : 'not an array'}`);
  }

  return {
    portal: r.portal as string,
    pagePath: r.pagePath as string,
    generatedAt: r.generatedAt as string,
    barriers: (r.barriers as unknown[]).map((b, i) => parseBarrier(b, source, `barriers[${i}]`, true)),
    pageBarriers: (r.pageBarriers as unknown[]).map((b, i) => parseBarrier(b, source, `pageBarriers[${i}]`, false)),
  };
}

/**
 * Group loaded reports into forms, each form's scans oldest first, forms ordered by portal
 * then path.
 *
 * One form scanned at one instant is one scan, however many times its file was picked.
 * Without that, loading the same file twice would compare a scan against itself and report
 * a form as unchanged while hiding the previous scan it should have been compared with —
 * and picking files twice is normal here, because the monitor writes one directory per
 * form and a file dialog opens on one directory at a time.
 */
export function groupByForm(reports: BarrierReport[]): Form[] {
  const forms = new Map<string, Form>();
  const seen = new Set<string>();
  for (const r of reports) {
    const key = formKey(r);
    if (seen.has(`${key}@${r.generatedAt}`)) continue;
    seen.add(`${key}@${r.generatedAt}`);
    let form = forms.get(key);
    if (!form) {
      form = { key, portal: r.portal, pagePath: r.pagePath, scans: [] };
      forms.set(key, form);
    }
    form.scans.push(r);
  }
  for (const form of forms.values()) {
    form.scans.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  }
  return [...forms.values()].sort((a, b) => a.key.localeCompare(b.key));
}
