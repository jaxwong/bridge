# BRIDGE dashboard

The employer side of BRIDGE. It shows the accessibility reports BRIDGE produced on
applicants' forms, what each form is doing to the people using it, a suggested fix for each
barrier, and how each report compares with the last one for the same form.

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
  -> the report is sent to the employer when the applicant submits   (NOT BUILT)
  -> it shows here
```

The dashboard never contacts a job site, never scans anything, and has no network calls at
all.

## The demo seed: the only report this page shows

**The send is not built yet, so nothing reaches this page.** For the demo it opens on one
seeded report, [`src/demo-seed.json`](src/demo-seed.json), imported at build time. There is
no file upload: it was removed so the demo can switch straight from the applicant's window
to the employer's.

The seed is **not hand-written**. It is the report the BRIDGE scanner produces on the Acme
Careers applicant form (`extension/test/fixtures/acme/apply.html`), written by the
extension's e2e suite:

```bash
make demo-seed       # from the repo root: rewrites src/demo-seed.json from a real scan
```

Every other run of the e2e suite compares the seed with a fresh scan, ignoring only
`generatedAt`, and fails if they differ. A change to the form therefore cannot leave the
dashboard showing findings the form no longer has. Re-run `make demo-seed` on the morning of
a demo so the date on the page is recent.

The page passes the seed through `parseReport()` like any report. A seed that fails that
check stops the page at load, and `npm test` fails on it too.

Reports are grouped into forms by `portal` + `pagePath` read from inside the report. With
one seed there is one form and one scan, so the page shows everything as open and nothing as
resolved or new. The comparison code is unchanged and covered by `npm test`.

## What it shows

Per form, the newest report's finding counts by severity, and the comparison with the report
before it: **resolved**, **still open**, **new**. New is the alert — a barrier that was not
in the previous report. A form reported on only once shows everything as open and nothing as
new; a first report has no history to have regressed from.

Every finding shows its rule, its severity as a word, the field it is on, and the
plain-language impact sentence the scanner wrote.

**Suggested fix.** Each finding also shows the report's `fix`: one or two sentences saying
what to change. The dashboard does not decide it. It comes from the rule catalogue in
[`../extension/lib/rules.ts`](../extension/lib/rules.ts), one sentence per rule, and says
only what follows from what that rule tests. It is a suggestion, not a patch: the report
carries no page source to patch. Reports from before `fix` existed show no fix line.

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
The table lives with the producer, in [`../extension/lib/rules.ts`](../extension/lib/rules.ts),
because a criterion is a property of the scanner rule and the rule is the extension's. A rule
that could not be mapped confidently carries no criterion and displays as **"No WCAG mapping
recorded"** — the dashboard never fills that gap with a guess.

A report that carries a `standard` block also says which criteria its producer can fail, and
the summary repeats that list: "Measured against WCAG 2.2, Level AA. The scanner can fail 7
criteria: … Any other criterion was not checked." That sentence is what keeps a finding-free
report from reading as a pass.

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
