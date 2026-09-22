# BRIDGE dashboard

The employer side of [`../bridge-business.md`](../bridge-business.md) §6.4: load barrier
reports, list the forms they cover, and show what changed since each form's previous scan.

A static page. No server, no accounts, no database. Plain TypeScript and native HTML —
the same choice the extension's side panel made, for the same reason.

```bash
npm install
npm run dev          # Vite dev server
npm run build        # -> dist/, a static page
npm test             # compare logic against ../fixtures/reports
npm run test:a11y    # builds, then drives the real page with axe-core
npm run typecheck
```

## Loading reports

`npm run dev`, then choose report files with the file picker. Dragging files onto the box
also works — as an addition, never as the only way in. A drag-drop-only uploader is one of
the barriers this product exists to report, so it could hardly be the way into the
dashboard.

Loading is additive: pick files, pick more, they accumulate. That matters because the
monitor writes one directory per form and a file dialog opens on one directory at a time.
The same scan picked twice is still one scan.

Reports are grouped into forms by `portal` + `pagePath` **read from inside the file**, not
from its name: a file picker hands over a name and no directory.

## What it shows

Per form, the newest scan's barrier counts by severity, and the comparison with the scan
before it: resolved, still open, new. New is the alert — the barrier that was not there
last time. A form we have scanned only once shows everything as open and nothing as new;
a first scan has no history to have regressed from.

Every barrier shows its rule, its severity as a word, the field it is on, and the
plain-language impact sentence the scanner wrote.

## Automated WCAG 2.2 A/AA findings

> **These are automated WCAG 2.2 A/AA accessibility findings.** They are not a conformance
> decision and not a legal opinion. BRIDGE does not certify WCAG compliance and does not
> replace testing with real assistive technology. **Human review is required for a WCAG
> conformance claim.** That sentence is on the page itself, not only here.

Where a report records them, each finding shows its success criteria and conformance level
beside it, and the detail view opens with a summary of the newest scan's findings by level
and by criterion.

The dashboard does not decide those mappings. It displays what the report already carries.
The table lives with the producer, in [`../extension/lib/wcag.ts`](../extension/lib/wcag.ts),
because a criterion is a property of the scanner rule and the rule is the extension's. A
rule that could not be mapped confidently carries no criterion and displays as **"No WCAG
mapping recorded"** — the dashboard never fills that gap with a guess.

Findings whose detection is heuristic rather than read straight from the DOM are marked
**"Human review required"**. That flag is about the finding being a true positive; the
conformance disclaimer above applies to every finding regardless.

**Older reports still load.** The WCAG fields are optional, so a report exported before they
existed is still valid — its findings simply display as unmapped. Re-scan to get mappings.
`../fixtures/reports/` is kept as that back-compatibility corpus; `../fixtures/reports-wcag/`
is a real capture from the current monitor.

## Accessibility

Zero axe violations is a requirement here, not a target. `npm run test:a11y` runs axe over
the empty state, the form list, the detail view and the load-error state, and fails the
build on any violation. It also checks the things axe cannot: that opening a form moves
focus to its heading, that Back returns focus to the row it came from, and that every
interactive control is a native focusable element.

It also checks that no sentence on the page claims compliance, certification or legal
standing — every mention of those has to be a denial.

What it does **not** cover is what a screen reader actually says. That needs a person —
see [`../probe/screen-reader-testing.md`](../probe/screen-reader-testing.md). The NVDA pass
is still outstanding.

## Numbers on the page

Only counts measured from loaded reports: forms, scans, barriers by severity, the size of
each comparison bucket, and the WCAG tallies, which are counted from the criteria the
reports themselves carry. There are no illustrative statistics anywhere, including
in the pitch copy, and the pricing section deliberately carries no figure — that belongs
on a slide where it can be defended.
