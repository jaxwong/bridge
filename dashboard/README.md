# BRIDGE dashboard

The employer side of BRIDGE. It loads accessibility reports that applicants exported from
the BRIDGE extension, shows what each form is doing to the people using it, and compares
each report with the last one for the same form.

A static page. No server, no backend, no accounts, no database, and **no scanning of its
own** — it receives reports, it does not go and fetch them. Plain TypeScript and native
HTML, the same choice the extension's side panel made, for the same reason.

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run build        # -> dist/, a static page
npm test             # parsing and comparison against ../fixtures
npm run test:a11y    # builds, then drives the real page with axe-core
npm run typecheck
```

## Where the reports come from

```
applicant reaches a job application form
  -> BRIDGE extension scans it, in their browser
  -> applicant chooses "Export barrier report"
  -> the JSON lands in their downloads
  -> a business user loads it here
```

Nothing is automatic. A report exists only because an applicant asked for one, and it
reaches this dashboard only because someone loaded the file. The dashboard never contacts a
job site, never scans anything, and has no network calls at all.

## Loading reports

`npm run dev`, then choose report files with the file picker. Dragging files onto the box
also works — as an addition, never as the only way in. A drag-drop-only uploader is one of
the barriers this product exists to report, so it could hardly be the way into the
dashboard.

Loading is **additive**: pick files, pick more, they accumulate. Several reports for one
form are what makes a history, and the history is what the comparison needs.

Reports are grouped into forms by `portal` + `pagePath` **read from inside the file**, not
from its name: a file picker hands over a name and no directory. The same report loaded
twice is still one report.

## What it shows

Per form, the newest report's finding counts by severity, and the comparison with the report
before it: **resolved**, **still open**, **new**. New is the alert — a barrier that was not
in the previous report. A form reported on only once shows everything as open and nothing as
new; a first report has no history to have regressed from.

Every finding shows its rule, its severity as a word, the field it is on, and the
plain-language impact sentence the scanner wrote.

## Automated WCAG 2.2 A/AA findings

> **Automated WCAG 2.2 A/AA accessibility findings. Human review is required for a WCAG
> conformance claim.**
>
> They are not a conformance decision and not a legal opinion. BRIDGE does not certify WCAG
> compliance, does not make anyone legally compliant, does not claim a form is accessible,
> and does not replace testing with real assistive technology. That wording is on the page
> itself, not only here.

Where a report records them, each finding shows its success criteria and conformance level,
and the detail view opens with a summary of the newest report's findings by level and by
criterion.

The dashboard does not decide those mappings. It displays what the report already carries.
The table lives with the producer, in [`../extension/lib/wcag.ts`](../extension/lib/wcag.ts),
because a criterion is a property of the scanner rule and the rule is the extension's. A rule
that could not be mapped confidently carries no criterion and displays as **"No WCAG mapping
recorded"** — the dashboard never fills that gap with a guess.

Findings whose detection is heuristic rather than read straight from the DOM are marked
**"Human review required"**. That flag is about the finding being a true positive; the
disclaimer above applies to every finding regardless.

**Older reports still load.** The WCAG fields are optional, so a report exported before they
existed is still valid — its findings simply display as unmapped. Re-export to get mappings.
`../fixtures/reports/` is kept as that back-compatibility corpus;
`../fixtures/reports-wcag/` carries the fields.

## What the reports contain

Findings only. No answers, no CV or its contents, no credentials, and nothing identifying
the applicant — the format is defined in `bridge-user.md` §6.7 and carries no field values.
The dashboard validates every file at the boundary and names the file if it is not a report.

## Accessibility

Zero axe violations is a requirement here, not a target. `npm run test:a11y` runs axe over
the empty state, the form list, the detail view and the load-error state, and fails the build
on any violation. It also checks the things axe cannot: that opening a form moves focus to
its heading, that Back returns focus to the row it came from, and that every interactive
control is a native focusable element.

It also checks that no sentence on the page claims compliance, certification or legal
standing — every mention of those has to be a denial.

What it does **not** cover is what a screen reader actually says. That needs a person — see
[`../probe/screen-reader-testing.md`](../probe/screen-reader-testing.md). The NVDA pass is
still outstanding.

## Numbers on the page

Only counts measured from loaded reports: forms, reports, findings by severity, the size of
each comparison bucket, and the WCAG tallies, which are counted from the criteria the reports
themselves carry. There are no illustrative statistics anywhere, and the pricing text
deliberately carries no figure.
