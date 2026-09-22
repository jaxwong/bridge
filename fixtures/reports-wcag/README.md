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

These come from the extension's own export, which is the only producer now:

1. `python3 -m http.server 8765 -d extension/test/fixtures/acme`
2. Load the built extension, open `http://localhost:8765/` (and `?v=2`, `?v=3`)
3. Scan, then **Export barrier report as JSON** from the side panel
4. Drop the files into `localhost-8765/`

Timestamps are whenever the scan ran, so regenerating changes the file names. The dashboard
does not read file names — it groups by `portal` + `pagePath` from inside each file — so
that only matters to the person looking at the directory.

## What these are not

**Automated WCAG 2.2 A/AA accessibility findings.** Not a conformance result, not a
statement that any form does or does not conform, and not a substitute for testing with real
assistive technology. **Human review is required for a WCAG conformance claim.**

A rule appears with a criterion only where `extension/lib/wcag.ts` records one, and that file
maps a rule only after reading its implementation in `extension/lib/scan.ts`.
`modal-without-dialog-role` and `captcha` are deliberately unmapped and show as "No WCAG
mapping recorded" — see the rationale in `extension/lib/wcag.ts`.
