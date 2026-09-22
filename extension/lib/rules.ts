// The barrier rule catalog: spec §6.2. The one owner of what a rule is.
//
// A rule's severity and its WCAG 2.2 success criteria are decided here and nowhere else.
// scan.ts and the side panel emit a rule by id through barrier(); toReport() derives the
// WCAG fields of the §6.7 export from this table. Plain data, no wxt import, so it runs
// wherever lib/ runs.
//
// BRIDGE reports **automated WCAG 2.2 A/AA accessibility findings**. It does not certify
// WCAG compliance, does not make anyone legally compliant, and does not replace human
// accessibility testing. **Human review is required for a WCAG conformance claim.**
//
// A rule carries criteria only if the success criterion fails *every* time that rule fires,
// given what the rule actually tests in lib/scan.ts. Where the implementation cannot tell
// a failure from a conforming pattern, the rule is left unmapped and the dashboard shows
// "No WCAG mapping recorded" rather than a guess. A wrong criterion on a report an
// employer takes to procurement is worse than no criterion at all.
//
// Every mapping below names the line in scan.ts it was read from.

import type { Barrier, Severity } from './types';

export type RuleId =
  | 'missing-label' | 'label-placeholder-only' | 'custom-dropdown-no-role' | 'not-keyboard-operable'
  | 'group-not-labelled' | 'options-identically-named' | 'drag-drop-only' | 'upload-unnamed'
  | 'modal-without-dialog-role' | 'captcha' | 'cross-origin-frame-unreachable'
  | 'target-too-small' | 'low-contrast';

export type WcagLevel = 'A' | 'AA';

interface Mapping {
  /** Success-criterion numbers, e.g. "4.1.2". No "WCAG" prefix, no title. */
  wcag: string[];
  /**
   * True when the detection is a heuristic that a human should confirm before the finding
   * is relied on. Distinct from the conformance disclaimer, which applies to every finding
   * regardless of this flag.
   */
  reviewRequired: boolean;
  /** Why this criterion, tied to what the rule actually tests. */
  rationale: string;
}

interface Rule {
  severity: Severity;
  /** Null when the rule is deliberately unmapped; the reason is in the comment beside it. */
  mapping: Mapping | null;
}

/** Every criterion a rule here can cite, in WCAG order, with its conformance level. */
const LEVEL_OF: Record<string, WcagLevel> = {
  '1.3.1': 'A',   // Info and Relationships
  '1.4.3': 'AA',  // Contrast (Minimum)
  '2.1.1': 'A',   // Keyboard
  '2.5.3': 'A',   // Label in Name
  '2.5.8': 'AA',  // Target Size (Minimum)
  '3.3.2': 'A',   // Labels or Instructions
  '4.1.2': 'A',   // Name, Role, Value
};

export const RULES: Record<RuleId, Rule> = {
  // scan.ts:195 — fires when accName() found no name by aria-labelledby, aria-label,
  // label[for], a wrapping <label>, title or placeholder. No mechanism produced a name.
  'missing-label': {
    severity: 'usability',
    mapping: {
      wcag: ['4.1.2'],
      reviewRequired: false,
      rationale:
        '4.1.2 requires a programmatically determinable name for every user interface component. ' +
        'The rule fires only after accName() has tried every naming mechanism and found none, so the ' +
        'control has no accessible name at all. 1.3.1 is deliberately NOT claimed: it would apply where a ' +
        'visible label exists but is not associated, and this rule does not distinguish that case from a ' +
        'control with no visible label either.',
    },
  },

  // scan.ts:193 — fires when the ONLY name came from the placeholder attribute
  // (accName returns fromPlaceholder: true).
  'label-placeholder-only': {
    severity: 'usability',
    mapping: {
      wcag: ['3.3.2'],
      reviewRequired: false,
      rationale:
        '3.3.2 requires labels or instructions when content requires user input. A placeholder is ' +
        'removed by the browser as soon as the field has a value, so the instruction is not persistently ' +
        'available. 4.1.2 is NOT claimed: placeholder does contribute to the accessible name, so a name ' +
        'is programmatically determinable and that criterion is not failed by this rule alone.',
    },
  },

  // scan.ts:200 — kindOf() classified the element as a combobox from its class words, and
  // it carries no role attribute at all.
  'custom-dropdown-no-role': {
    severity: 'blocking',
    mapping: {
      wcag: ['4.1.2'],
      reviewRequired: true,
      rationale:
        '4.1.2 requires that the role of a component be programmatically determinable. The element is ' +
        'operated as a dropdown but exposes no role, so assistive technology cannot announce what it is. ' +
        'Review required because the element is identified as a dropdown by its class words ' +
        '(hasWord(el, WIDGET_WORDS)), which is a naming convention rather than a semantic fact.',
    },
  },

  // scan.ts:204 — !keyboardReachable(el): tabIndex < 0, or disabled, or display:none /
  // visibility:hidden, or inside [inert].
  'not-keyboard-operable': {
    severity: 'blocking',
    mapping: {
      wcag: ['2.1.1'],
      reviewRequired: true,
      rationale:
        '2.1.1 requires all functionality to be operable through a keyboard interface. The control is ' +
        'not in the tab order and has no other keyboard affordance the scanner can see. Review required ' +
        'because keyboardReachable() is a static tabindex and computed-style test: it cannot observe real ' +
        'Tab traversal, and bridge-user.md §6.2 records that scripted key presses do not move focus, so ' +
        'tab order can only be confirmed by a person.',
    },
  },

  // scan.ts:235 — a radio or checkbox group whose container has no <legend> and whose
  // accName() is empty, checked across fieldset, [role=radiogroup] and [role=group].
  'group-not-labelled': {
    severity: 'blocking',
    mapping: {
      wcag: ['1.3.1'],
      reviewRequired: false,
      rationale:
        '1.3.1 requires that relationships conveyed through presentation be programmatically ' +
        'determinable. The question is visually associated with its options but the grouping carries no ' +
        'legend and no ARIA group name, so the relationship is not exposed. The rule checks every ' +
        'mechanism that could expose it before firing. 3.3.2 is NOT claimed: the visible question text is ' +
        'normally still present on the page, so instructions exist even though the association does not.',
    },
  },

  // scan.ts:239 — every option carries an explicit aria-label and all of them are
  // identical, so the shared name overrides each option's own visible text.
  'options-identically-named': {
    severity: 'blocking',
    mapping: {
      wcag: ['4.1.2', '2.5.3'],
      reviewRequired: false,
      rationale:
        '2.5.3 requires that the accessible name of a labelled component contain its visible label text. ' +
        'Each option displays its own text ("Yes", "No") while aria-label overrides that text with the ' +
        'question, so the visible label is absent from the accessible name. 4.1.2 is also failed: the ' +
        'options are components whose names no longer identify them, and two options sharing one name ' +
        'cannot be told apart. The rule reads aria-label directly and requires every option to carry the ' +
        'same one, so both conclusions follow from the DOM rather than from inference.',
    },
  },

  // scan.ts:299 — a file input that is not keyboardReachable and whose label[for], if any,
  // is not itself a keyboard trigger.
  'drag-drop-only': {
    severity: 'blocking',
    mapping: {
      wcag: ['2.1.1'],
      reviewRequired: false,
      rationale:
        '2.1.1 requires keyboard operability. The file input is out of the tab order and no ' +
        'keyboard-operable trigger points at it, so the upload cannot be started from the keyboard. ' +
        '2.5.7 Dragging Movements (AA, new in WCAG 2.2) is NOT claimed even though it is the obvious ' +
        'candidate: 2.5.7 is satisfied by any single-pointer alternative to dragging, and the rule tests ' +
        'only for a KEYBOARD trigger. A drop zone that also opens a file picker on click would fail 2.1.1 ' +
        'and pass 2.5.7, and the scanner cannot tell the two apart. Confirming 2.5.7 needs a person.',
    },
  },

  // scan.ts:301 — a file input that IS keyboard reachable but has no accessible name.
  'upload-unnamed': {
    severity: 'usability',
    mapping: {
      wcag: ['4.1.2'],
      reviewRequired: false,
      rationale:
        '4.1.2 requires a programmatically determinable name. The input is reachable but accName() ' +
        'returns nothing, so a screen reader announces only a generic file button with no indication of ' +
        'what it is for.',
    },
  },

  // scan.ts, via lib/visual.ts targetTooSmall(): the control's box is under 24 by 24 CSS
  // pixels, it is not a native checkbox or radio at its browser default, it is not
  // disabled, and a 24px circle centred on it meets another target or another undersized
  // target's circle.
  'target-too-small': {
    severity: 'usability',
    mapping: {
      wcag: ['2.5.8'],
      reviewRequired: false,
      rationale:
        '2.5.8 requires pointer targets of at least 24 by 24 CSS pixels unless an exception applies. The ' +
        'check measures the rendered box and implements the exceptions the criterion lists: spacing (the ' +
        '24px circle test, against every visible pointer target on the page), user agent (a native ' +
        'checkbox or radio with its default appearance is sized by the browser, not the author) and ' +
        'inactive controls. "Inline" and "essential" cannot apply to a form control. A finding therefore ' +
        'follows from geometry the criterion itself defines, so no review is required.',
    },
  },

  // scan.ts, via lib/visual.ts lowContrast(): the label text, the typed text or the
  // placeholder of a control measures under 4.5:1 (3:1 for large text) against the
  // composited colour of its ancestors' solid backgrounds.
  'low-contrast': {
    severity: 'usability',
    mapping: {
      wcag: ['1.4.3'],
      reviewRequired: true,
      rationale:
        '1.4.3 requires text contrast of at least 4.5:1, or 3:1 for large text. The check computes the ' +
        'WCAG relative-luminance ratio from the text colour and the colour composited from the element\'s ' +
        'ancestors\' background colours, and reports nothing where that colour cannot be read: a ' +
        'background image or gradient, a translucent ancestor, or a colour outside sRGB. Review required ' +
        'because it reads the cascade, not the pixels: an element painted over the text by position or ' +
        'z-index, or a text shadow, changes what a person sees and this cannot observe it.',
    },
  },

  // --- deliberately unmapped -------------------------------------------------------------

  // scan.ts:309. Detected by class-name substring ([class*=modal], [class*=popup]) plus
  // "contains a form control". That is a naming convention, not a semantic fact, and a
  // wrapper or backdrop div can trip it. The criterion is also contested: an undeclared
  // dialog is argued as 4.1.2 (role), as 1.3.1 (relationship), and as a focus-management
  // problem under 2.4.3, and the rule tests none of those directly. It remains a real,
  // reportable barrier.
  'modal-without-dialog-role': { severity: 'blocking', mapping: null },

  // scan.ts:313. The presence of a CAPTCHA is NOT a WCAG failure. The note on 1.1.1
  // Non-text Content explicitly contemplates conforming CAPTCHAs, provided a text
  // alternative describes the purpose and alternative modalities exist for different
  // disabilities. The rule only detects that a known CAPTCHA widget is on the page; it does
  // not test whether an audio or other alternative is offered, so no failure can be
  // asserted. 3.3.8 Accessible Authentication (AA, new in 2.2) is also not claimed: it
  // applies to authentication steps, and a CAPTCHA on a job application is not necessarily
  // one. Both need a person.
  captcha: { severity: 'blocking', mapping: null },

  // sidepanel/main.ts, from ScanResult.iframeOrigins. A visible cross-origin frame BRIDGE
  // has no content script in: a limit of the scan, not a defect of the page, so no
  // criterion can be claimed. Reported so the reader knows part of the form went unseen.
  'cross-origin-frame-unreachable': { severity: 'blocking', mapping: null },
};

/** The only way a barrier is made: the rule decides the severity, the caller supplies the sentence. */
export function barrier(rule: RuleId, message: string): Barrier {
  return { rule, severity: RULES[rule].severity, message };
}

/** The recorded criteria for a rule, with the most stringent level among them, or null when unmapped. */
export function wcagFor(rule: RuleId): { wcag: string[]; wcagLevel: WcagLevel; reviewRequired: boolean } | null {
  const m = RULES[rule].mapping;
  if (!m) return null;
  const wcagLevel: WcagLevel = m.wcag.some((c) => LEVEL_OF[c] === 'AA') ? 'AA' : 'A';
  return { wcag: m.wcag, wcagLevel, reviewRequired: m.reviewRequired };
}

/**
 * What a report's criterion numbers refer to, and which criteria a BRIDGE scan can fail.
 * `checked` is the whole of what the scanner reads of WCAG: a criterion not in it was never
 * tested, so its absence from a report's findings is not a pass.
 */
export const STANDARD = {
  name: 'WCAG' as const,
  version: '2.2' as const,
  level: 'AA' as const,
  checked: Object.keys(LEVEL_OF),
};
