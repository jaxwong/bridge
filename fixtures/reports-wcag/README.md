# Barrier reports carrying automated WCAG 2.2 findings

Reports in the `bridge-user.md` §6.7 format, captured from the BRIDGE scanner against
`extension/test/fixtures/acme` at `?v=1`, `?v=2` and `?v=3` after `toReport()` began
attaching the WCAG fields. Not hand-written.

They exist so the dashboard's tests exercise **mapped** findings against real producer
output. [`../reports/`](../reports/) is the counterpart: reports written before those fields
existed, which must still load and must display as "No WCAG mapping recorded".

The findings themselves are identical to `../reports/` key for key. The only difference is
the added `wcag`, `wcagLevel`, `automated` and `reviewRequired` fields.

## Regenerating

**Not possible right now.** These were captured from the panel's manual export, which has
been removed in favour of sending the report to the employer automatically on submit. That
send is not built yet, so nothing currently produces a report file.

What they contain is still correct: `extension/test/e2e.mjs` builds the report for these
exact fixture pages with the same `buildReport()` and asserts the same barriers, so a
mismatch would fail the suite rather than sit here unnoticed.

Restore a regeneration recipe here once the automated send exists.

## What these are not

**Automated WCAG 2.2 A/AA accessibility findings.** Not a conformance result, not a
statement that any form does or does not conform, and not a substitute for testing with real
assistive technology. **Human review is required for a WCAG conformance claim.**

A rule appears with a criterion only where `extension/lib/wcag.ts` records one, and that file
maps a rule only after reading its implementation in `extension/lib/scan.ts`.
`modal-without-dialog-role` and `captcha` are deliberately unmapped and show as "No WCAG
mapping recorded" — see the rationale in `extension/lib/wcag.ts`.
