// Data model: spec §6.1.

export type ControlKind =
  | 'text' | 'textarea' | 'select' | 'combobox' | 'radio-group'
  | 'checkbox' | 'file' | 'unknown';

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
  labelSource: 'aria' | 'label-element' | 'nearby-text' | 'none';
  required: boolean;
  /** Choices, in page order. Radio groups use each option's visible text, not its aria-label. */
  options?: string[];
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
