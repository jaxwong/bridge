# Sample barrier reports — the back-compatibility corpus

Reports in the `bridge-user.md` §6.7 format, written **before** the WCAG fields existed.
They are kept exactly as they are, because their job is to prove that a report exported by
an older build of the extension still loads, still groups, and still compares.

In the dashboard they display as **"No WCAG mapping recorded"** on every finding, which is
the correct behaviour: the file does not record a mapping, so the dashboard does not invent
one. Re-export from a current build to get mappings.

## Layout

```
fixtures/reports/<slug>/<timestamp>.json
```

The slug and the timestamp are for humans and for the filesystem. **The dashboard does not
parse either**: it groups reports by `portal` + `pagePath` and orders them by `generatedAt`,
both read from inside the file. A file picker hands over `File.name` and no directory, so a
filename could not carry the grouping even if we wanted it to.

## The files

| File | Stands for | Field barriers | Page barriers |
|---|---|---|---|
| `localhost-8765/2026-09-21T09-00-00Z.json` | Acme v1, baseline | 5 | 0 |
| `localhost-8765/2026-09-22T09-00-00Z.json` | Acme v2, the dropdown fixed | 2 | 0 |
| `localhost-8765/2026-09-23T09-00-00Z.json` | Acme v3, a CV uploader added | 2 | 1 |
| `boards-greenhouse-io-example-jobs-0000000/…` | a second form, reported once | 0 | 1 |

Three reports for one form, a day apart, plus a second form reported once. Between them they
cover every state the comparison has to produce:

- **v1 → v2**: the three education-dropdown barriers *resolved*, the two visa barriers
  *still open*.
- **v2 → v3**: `drag-drop-only` *new*, the two visa barriers *still open*.
- **The second form**: no earlier report, so its one barrier is *open*, not *new*. A first
  report must never read as a page full of regressions.
- It also gives the dashboard a form with zero field-level barriers to render.

Every `rule`, `severity` and `impact` string is the literal message
`extension/lib/scan.ts` emits for that rule, against
`extension/test/fixtures/acme/index.html`.

## What these are not

**Automated WCAG 2.2 A/AA accessibility findings**, when a report carries them. Never a
conformance result, and never a statement that a form does or does not conform. **Human
review is required for a WCAG conformance claim.**

`boards.greenhouse.io/example/jobs/0000000` is not a real posting. Do not put its contents
on a slide.
