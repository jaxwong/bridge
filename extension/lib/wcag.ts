// WCAG 2.2 Level A/AA mapping for the scanner's rules.
//
// BRIDGE reports **automated WCAG 2.2 A/AA accessibility findings**. It does not certify
// WCAG compliance, does not make anyone legally compliant, and does not replace human
// accessibility testing. **Human review is required for a WCAG conformance claim.**
//
// A rule appears here only if the success criterion fails *every* time that rule fires,
// given what the rule actually tests in lib/scan.ts. Where the implementation cannot tell
// a failure from a conforming pattern, the rule is left out and the dashboard shows
// "No WCAG mapping recorded" rather than a guess. A wrong criterion on a report an
// employer takes to procurement is worse than no criterion at all.
//
// Every mapping below names the line in scan.ts it was read from.

export type WcagLevel = 'A' | 'AA';

interface Mapping {
  /** Success-criterion numbers, e.g. "4.1.2". No "WCAG" prefix, no title. */
  wcag: string[];
  /** The most stringent level among `wcag`: AA if any criterion is AA, else A. */
  wcagLevel: WcagLevel;
  /**
   * True when the detection is a heuristic that a human should confirm before the finding
   * is relied on. Distinct from the conformance disclaimer, which applies to every finding
   * regardless of this flag.
   */
  reviewRequired: boolean;
  /** Why this criterion, tied to what the rule actually tests. */
  rationale: string;
}

const LEVEL_OF: Record<string, WcagLevel> = {
  '1.3.1': 'A',   // Info and Relationships
  '2.1.1': 'A',   // Keyboard
  '2.5.3': 'A',   // Label in Name
  '3.3.2': 'A',   // Labels or Instructions
  '4.1.2': 'A',   // Name, Role, Value
};

const MAPPINGS: Record<string, Mapping> = {
  // scan.ts:198 — fires when accName() found no name by aria-labelledby, aria-label,
  // label[for], a wrapping <label>, title or placeholder. No mechanism produced a name.
  'missing-label': {
    wcag: ['4.1.2'],
    wcagLevel: 'A',
    reviewRequired: false,
    rationale:
      '4.1.2 requires a programmatically determinable name for every user interface component. ' +
      'The rule fires only after accName() has tried every naming mechanism and found none, so the ' +
      'control has no accessible name at all. 1.3.1 is deliberately NOT claimed: it would apply where a ' +
      'visible label exists but is not associated, and this rule does not distinguish that case from a ' +
      'control with no visible label either.',
  },

  // scan.ts:196 — fires when the ONLY name came from the placeholder attribute
  // (accName returns fromPlaceholder: true).
  'label-placeholder-only': {
    wcag: ['3.3.2'],
    wcagLevel: 'A',
    reviewRequired: false,
    rationale:
      '3.3.2 requires labels or instructions when content requires user input. A placeholder is ' +
      'removed by the browser as soon as the field has a value, so the instruction is not persistently ' +
      'available. 4.1.2 is NOT claimed: placeholder does contribute to the accessible name, so a name ' +
      'is programmatically determinable and that criterion is not failed by this rule alone.',
  },

  // scan.ts:203 — kindOf() classified the element as a combobox from its class words, and
  // it carries no role attribute at all.
  'custom-dropdown-no-role': {
    wcag: ['4.1.2'],
    wcagLevel: 'A',
    reviewRequired: true,
    rationale:
      '4.1.2 requires that the role of a component be programmatically determinable. The element is ' +
      'operated as a dropdown but exposes no role, so assistive technology cannot announce what it is. ' +
      'Review required because the element is identified as a dropdown by its class words ' +
      '(hasWord(el, WIDGET_WORDS)), which is a naming convention rather than a semantic fact.',
  },

  // scan.ts:207 — !keyboardReachable(el): tabIndex < 0, or disabled, or display:none /
  // visibility:hidden, or inside [inert].
  'not-keyboard-operable': {
    wcag: ['2.1.1'],
    wcagLevel: 'A',
    reviewRequired: true,
    rationale:
      '2.1.1 requires all functionality to be operable through a keyboard interface. The control is ' +
      'not in the tab order and has no other keyboard affordance the scanner can see. Review required ' +
      'because keyboardReachable() is a static tabindex and computed-style test: it cannot observe real ' +
      'Tab traversal, and bridge-user.md §6.2 records that scripted key presses do not move focus, so ' +
      'tab order can only be confirmed by a person.',
  },

  // scan.ts:238 — a radio or checkbox group whose container has no <legend> and whose
  // accName() is empty, checked across fieldset, [role=radiogroup] and [role=group].
  'group-not-labelled': {
    wcag: ['1.3.1'],
    wcagLevel: 'A',
    reviewRequired: false,
    rationale:
      '1.3.1 requires that relationships conveyed through presentation be programmatically ' +
      'determinable. The question is visually associated with its options but the grouping carries no ' +
      'legend and no ARIA group name, so the relationship is not exposed. The rule checks every ' +
      'mechanism that could expose it before firing. 3.3.2 is NOT claimed: the visible question text is ' +
      'normally still present on the page, so instructions exist even though the association does not.',
  },

  // scan.ts:242 — every option carries an explicit aria-label and all of them are
  // identical, so the shared name overrides each option's own visible text.
  'options-identically-named': {
    wcag: ['4.1.2', '2.5.3'],
    wcagLevel: 'A',
    reviewRequired: false,
    rationale:
      '2.5.3 requires that the accessible name of a labelled component contain its visible label text. ' +
      'Each option displays its own text ("Yes", "No") while aria-label overrides that text with the ' +
      'question, so the visible label is absent from the accessible name. 4.1.2 is also failed: the ' +
      'options are components whose names no longer identify them, and two options sharing one name ' +
      'cannot be told apart. The rule reads aria-label directly and requires every option to carry the ' +
      'same one, so both conclusions follow from the DOM rather than from inference.',
  },

  // scan.ts:302 — a file input that is not keyboardReachable and whose label[for], if any,
  // is not itself a keyboard trigger.
  'drag-drop-only': {
    wcag: ['2.1.1'],
    wcagLevel: 'A',
    reviewRequired: false,
    rationale:
      '2.1.1 requires keyboard operability. The file input is out of the tab order and no ' +
      'keyboard-operable trigger points at it, so the upload cannot be started from the keyboard. ' +
      '2.5.7 Dragging Movements (AA, new in WCAG 2.2) is NOT claimed even though it is the obvious ' +
      'candidate: 2.5.7 is satisfied by any single-pointer alternative to dragging, and the rule tests ' +
      'only for a KEYBOARD trigger. A drop zone that also opens a file picker on click would fail 2.1.1 ' +
      'and pass 2.5.7, and the scanner cannot tell the two apart. Confirming 2.5.7 needs a person.',
  },

  // scan.ts:304 — a file input that IS keyboard reachable but has no accessible name.
  'upload-unnamed': {
    wcag: ['4.1.2'],
    wcagLevel: 'A',
    reviewRequired: false,
    rationale:
      '4.1.2 requires a programmatically determinable name. The input is reachable but accName() ' +
      'returns nothing, so a screen reader announces only a generic file button with no indication of ' +
      'what it is for.',
  },

  // --- deliberately unmapped -------------------------------------------------------------
  //
  // 'modal-without-dialog-role' (scan.ts:312). Detected by class-name substring
  // ([class*=modal], [class*=popup]) plus "contains a form control". That is a naming
  // convention, not a semantic fact, and a wrapper or backdrop div can trip it. The
  // criterion is also contested: an undeclared dialog is argued as 4.1.2 (role), as 1.3.1
  // (relationship), and as a focus-management problem under 2.4.3, and the rule tests none
  // of those directly. Left unmapped; it remains a real, reportable barrier.
  //
  // 'captcha' (scan.ts:316). The presence of a CAPTCHA is NOT a WCAG failure. The note on
  // 1.1.1 Non-text Content explicitly contemplates conforming CAPTCHAs, provided a text
  // alternative describes the purpose and alternative modalities exist for different
  // disabilities. The rule only detects that a known CAPTCHA widget is on the page; it does
  // not test whether an audio or other alternative is offered, so no failure can be
  // asserted. 3.3.8 Accessible Authentication (AA, new in 2.2) is also not claimed: it
  // applies to authentication steps, and a CAPTCHA on a job application is not necessarily
  // one. Both need a person.
};

/** The recorded mapping for a rule, or null when the rule is deliberately unmapped. */
export function wcagFor(rule: string): Mapping | null {
  return MAPPINGS[rule] ?? null;
}

/** Documented rationale per rule, for the handover doc and for anyone auditing the table. */
export const WCAG_RATIONALE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(MAPPINGS).map(([rule, m]) => [rule, m.rationale])),
);

export { LEVEL_OF as WCAG_LEVELS };
export type { Mapping as WcagMapping };
