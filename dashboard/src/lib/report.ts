// The barrier report as the BRIDGE extension's buildReport() produces it.
// The format is defined in bridge-user.md §6.7 and owned there; this file only reads it.

export type Severity = 'blocking' | 'usability' | 'ok';

export type WcagLevel = 'A' | 'AA';

export interface ReportBarrier {
  rule: string;
  severity: Severity;
  /** The field's label. Present on `barriers`, absent on `pageBarriers`, which belong to no field. */
  label?: string;
  /** One plain sentence: what a screen reader user cannot do. Shown to the employer as-is. */
  impact: string;
  /** The scanner rule's suggested fix, shown as-is. Optional: reports from before it existed have none. */
  fix?: string;

  // --- Automated WCAG 2.2 A/AA findings, all optional.
  // A report written before these existed is still valid and still loads; its findings
  // simply carry no mapping. A rule the producer could not map confidently omits them too,
  // and the dashboard shows "No WCAG mapping recorded" rather than inventing one here.
  // These are automated findings. Human review is required for a WCAG conformance claim.
  /** Success-criterion numbers, e.g. ["4.1.2"]. */
  wcag?: string[];
  /** The most stringent level among `wcag`: "AA" if any criterion is AA, else "A". */
  wcagLevel?: WcagLevel;
  /** True when a scanner produced the finding rather than a person. */
  automated?: boolean;
  /** True when the detection is heuristic and a person should confirm it. */
  reviewRequired?: boolean;
}

/**
 * What a report's criterion numbers refer to, and the criteria its producer can fail. A
 * criterion not in `checked` was never tested, so its absence from the findings is not a
 * pass. Optional: reports exported before it existed carry none.
 */
export interface Standard {
  name: string;
  version: string;
  level: WcagLevel;
  checked: string[];
}

export interface BarrierReport {
  /** Host of the scanned page, port included. */
  portal: string;
  /** Pathname only — no query string. §6.7 explains why. */
  pagePath: string;
  generatedAt: string;
  standard?: Standard;
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
const WCAG_LEVELS: WcagLevel[] = ['A', 'AA'];
/** e.g. "4.1.2", "1.3.1". Guideline-level numbers like "4.1" are rejected as imprecise. */
const CRITERION = /^\d+\.\d+\.\d+$/;

/**
 * A form's identity across time: where it lives, not when it was scanned. Reports are
 * grouped by this rather than by anything outside the report, which carries its own
 * identity (bridge-business.md §6.4).
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
  if (b.fix !== undefined) {
    if (typeof b.fix !== 'string' || !b.fix) fail(source, `${where} (${b.rule}) has a "fix" that is not a non-empty sentence`);
    out.fix = b.fix;
  }

  // The WCAG fields are optional, so absence is never an error. Present-but-malformed is:
  // a criterion number shown next to a finding is the part an employer would quote, and a
  // silently dropped or half-parsed one is worse than a rejected file.
  if (b.wcag !== undefined) {
    if (!Array.isArray(b.wcag) || b.wcag.length === 0) {
      fail(source, `${where} (${b.rule}) has a "wcag" that is not a non-empty array`);
    }
    for (const c of b.wcag) {
      if (typeof c !== 'string' || !CRITERION.test(c)) {
        fail(source, `${where} (${b.rule}) has WCAG criterion ${JSON.stringify(c)}, expected a number like "4.1.2"`);
      }
    }
    out.wcag = b.wcag as string[];
  }
  if (b.wcagLevel !== undefined) {
    if (!WCAG_LEVELS.includes(b.wcagLevel as WcagLevel)) {
      fail(source, `${where} (${b.rule}) has wcagLevel ${JSON.stringify(b.wcagLevel)}, expected "A" or "AA"`);
    }
    out.wcagLevel = b.wcagLevel as WcagLevel;
  }
  for (const flag of ['automated', 'reviewRequired'] as const) {
    if (b[flag] === undefined) continue;
    if (typeof b[flag] !== 'boolean') fail(source, `${where} (${b.rule}) has "${flag}" that is not true or false`);
    out[flag] = b[flag] as boolean;
  }
  return out;
}

/**
 * Validate one report at the page's boundary. It says what is wrong with the report by its
 * source name instead of failing later inside compare.
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

  const report: BarrierReport = {
    portal: r.portal as string,
    pagePath: r.pagePath as string,
    generatedAt: r.generatedAt as string,
    barriers: (r.barriers as unknown[]).map((b, i) => parseBarrier(b, source, `barriers[${i}]`, true)),
    pageBarriers: (r.pageBarriers as unknown[]).map((b, i) => parseBarrier(b, source, `pageBarriers[${i}]`, false)),
  };
  if (r.standard !== undefined) report.standard = parseStandard(r.standard, source);
  return report;
}

/** Optional, so absence is never an error. Present-but-malformed is: it is what the page quotes as the standard. */
function parseStandard(raw: unknown, source: string): Standard {
  if (typeof raw !== 'object' || raw === null) fail(source, `"standard" is ${raw === null ? 'null' : typeof raw}, expected an object`);
  const s = raw as Record<string, unknown>;
  for (const k of ['name', 'version'] as const) {
    if (typeof s[k] !== 'string' || !s[k]) fail(source, `"standard.${k}" is missing`);
  }
  if (!WCAG_LEVELS.includes(s.level as WcagLevel)) {
    fail(source, `"standard.level" is ${JSON.stringify(s.level)}, expected "A" or "AA"`);
  }
  if (!Array.isArray(s.checked) || s.checked.length === 0) fail(source, '"standard.checked" is not a non-empty array');
  for (const c of s.checked) {
    if (typeof c !== 'string' || !CRITERION.test(c)) {
      fail(source, `"standard.checked" holds ${JSON.stringify(c)}, expected a number like "4.1.2"`);
    }
  }
  return { name: s.name as string, version: s.version as string, level: s.level as WcagLevel, checked: s.checked as string[] };
}

/**
 * Group loaded reports into forms, each form's scans oldest first, forms ordered by portal
 * then path.
 *
 * One form scanned at one instant is one scan, however many times it is handed in.
 * Without that, the same report twice would compare a scan against itself and report a
 * form as unchanged while hiding the previous scan it should have been compared with.
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
