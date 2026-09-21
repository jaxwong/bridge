// Data model: spec §6.1.

export type ControlKind =
  | 'text' | 'textarea' | 'select' | 'combobox' | 'radio-group' | 'checkbox-group'
  | 'checkbox' | 'file' | 'slider' | 'date' | 'unknown';

export type Severity = 'blocking' | 'usability' | 'ok';

export interface Barrier {
  rule: string;
  severity: Severity;
  /** Spoken to the user as-is. */
  message: string;
}

export interface FieldDescriptor {
  id: string;
  kind: ControlKind;
  label: string;
  /** 'llm' is only ever set by the side panel, after label inference (§6.4). */
  labelSource: 'aria' | 'label-element' | 'nearby-text' | 'none' | 'llm';
  required: boolean;
  /** Choices, in page order. Radio groups use each option's visible text, not its aria-label. */
  options?: string[];
  /** Sliders. Absent when the widget publishes no range; ACT then cannot place a value. */
  range?: { min: number; max: number; step: number };
  barriers: Barrier[];
}

export interface StepHint {
  via: 'workday-progressBar' | 'aria-current=step' | 'text' | 'progressbar';
  index?: number;
  total?: number;
  text?: string;
  steps?: string[];
}

export interface ScanResult {
  url: string;
  scannedAt: string;
  fields: FieldDescriptor[];
  pageBarriers: Barrier[];
  stepHint: StepHint | null;
  /** The step's own heading, for "Step 2 of 4: Resume" (§6.5). */
  heading: string;
  /** Origins of visible cross-origin iframes. The panel reports the ones BRIDGE has no
   *  content script in as cross-origin-frame-unreachable (§6.2). */
  iframeOrigins: string[];
}

export interface FillResult {
  fieldId: string;
  ok: boolean;
  strategy: string;
  /** What the page DOM holds after the write. Never BRIDGE's own state. */
  readBack: string;
  error?: string;
}

export interface ReadBackResult {
  fieldId: string;
  label: string;
  value: string;
  found: boolean;
}

// --- session state, spec §6.5. Held by the side panel in chrome.storage.session. ---

export interface StepRecord {
  index: number;
  url: string;
  /** "My Experience", from the page's stepper or the step's heading. */
  label: string;
  scan: Pick<ScanResult, 'url' | 'scannedAt' | 'fields' | 'pageBarriers' | 'stepHint'>;
  status: 'current' | 'completed';
  /** Keys of the fields BRIDGE confirmed on the page. Never values. */
  filledFieldIds: string[];
}

export interface ApplicationSession {
  tabId: number;
  origin: string;
  steps: StepRecord[];
  currentStepIndex: number;
  journey?: { index: number; total: number; labels: string[] };
  startedAt: string;
}

// --- barrier report, spec §6.7. The contract with bridge-business.md. ---

/** A barrier on one field. `rule` + `label` is the key the dashboard compares scans by,
 *  so `label` is always present and always the page-derived one, never an inferred name. */
export interface ReportBarrier {
  rule: string;
  severity: Severity;
  label: string;
  impact: string;
  /** Present only when the application has more than one step. */
  step?: number;
}

/** A barrier on the page as a whole (CAPTCHA, unreachable frame). Keyed by `rule` alone. */
export type ReportPageBarrier = Omit<ReportBarrier, 'label'>;

export interface BarrierReport {
  portal: string;
  /** Pathname only, no query string: Acme ?v=2 and ?v=3 are the same form over time. */
  pagePath: string;
  generatedAt: string;
  barriers: ReportBarrier[];
  pageBarriers: ReportPageBarrier[];
  steps?: { index: number; label: string; pagePath: string; barriers: ReportBarrier[]; pageBarriers: ReportPageBarrier[] }[];
}
