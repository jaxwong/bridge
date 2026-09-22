# Barrier reports carrying automated WCAG 2.2 findings

A real capture from `monitor/run.mjs` against `extension/test/fixtures/acme` at `?v=1`,
`?v=2` and `?v=3`, taken after `toReport()` began attaching WCAG fields. Not hand-written.

These exist so the dashboard's tests exercise **mapped** findings against real producer
output. [`../reports/`](../reports/) is kept exactly as it was and is now the
**back-compatibility corpus**: reports written before the WCAG fields existed, which must
still load and must display as "No WCAG mapping recorded".

The findings themselves are identical to `../reports/` key for key. The only difference is
the added `wcag`, `wcagLevel`, `automated` and `reviewRequired` fields — verified by
diffing the two with those keys stripped.

## What these are not

**Automated WCAG 2.2 A/AA accessibility findings.** Not a conformance result, not a
statement that any form does or does not conform, and not a substitute for testing with
real assistive technology. **Human review is required for a WCAG conformance claim.**

A rule appears with a criterion only where `extension/lib/wcag.ts` records one, and that
file maps a rule only after reading its implementation in `extension/lib/scan.ts`.
`modal-without-dialog-role` and `captcha` are deliberately unmapped and show as "No WCAG
mapping recorded" — see the rationale in `extension/lib/wcag.ts`.

## Regenerating

```bash
python3 -m http.server 8765 -d extension/test/fixtures/acme   # in another terminal
cd monitor
node run.mjs --url 'http://localhost:8765/'
node run.mjs --url 'http://localhost:8765/?v=2'
node run.mjs --url 'http://localhost:8765/?v=3'
cp ../reports/localhost-8765/*.json ../fixtures/reports-wcag/localhost-8765/
```

Timestamps are whenever the scan ran, so regenerating changes the file names. The dashboard
does not read file names — it groups by `portal` + `pagePath` from inside each file — so
that only matters to the person looking at the directory.
