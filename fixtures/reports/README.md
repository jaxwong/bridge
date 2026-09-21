# Sample barrier reports

Hand-written reports in the `bridge-user.md` §6.7 format, so the dashboard and the compare
logic can be built and tested before the monitor exists. **Nothing here came from a scan.**
They are replaced by real monitor output at `bridge-business.md` §8 "Before the demo"; until
then, treat every number in the dashboard built on them as fixture data, not measurement.

They are not guesses either: every `rule`, `severity` and `impact` string is copied from the
literal message `extension/lib/scan.ts` emits for that rule, and the Acme reports are what
`scanPage()` should produce against `extension/test/fixtures/acme/index.html` as it stands
today. That is the point of writing them by hand — when the monitor runs for real in Phase 5,
these files are the expected output, and a difference is a bug in one of the two.

## Layout

```
fixtures/reports/<slug>/<timestamp>.json
```

The same layout the monitor writes (`bridge-business.md` §6.2). The slug and the timestamp
are for humans and for the filesystem. **The dashboard does not parse either**: it groups
reports by `portal` + `pagePath` and orders them by `generatedAt`, both read from inside the
file. A file picker hands over `File.name` and no directory, so a filename could not carry
the grouping even if we wanted it to.

## The files

| File | Stands for | Field barriers | Page barriers |
|---|---|---|---|
| `localhost-8765/2026-09-21T09-00-00Z.json` | Acme v1, baseline | 5 | 0 |
| `localhost-8765/2026-09-22T09-00-00Z.json` | Acme v2, the dropdown fixed | 2 | 0 |
| `localhost-8765/2026-09-23T09-00-00Z.json` | Acme v3, a CV uploader added | 2 | 1 |
| `boards-greenhouse-io-example-jobs-0000000/…` | A real public posting | 0 | 1 |

Three scans of one form, a day apart, plus a second form scanned once. Between them they
cover every state the compare logic has to produce:

- **v1 → v2**: the three education-dropdown barriers *resolved*, the two visa barriers
  *still open*.
- **v2 → v3**: `drag-drop-only` *new*, the two visa barriers *still open*.
- **Greenhouse**: no previous report, so its one barrier is *open*, not *new*
  (`bridge-business.md` §6.3). A first scan must never read as a page full of regressions.
- **Greenhouse** also gives the dashboard a form with zero field-level barriers to render.

## Two things these files assume, which have to hold when the monitor runs

**Acme v3's file input must carry an `aria-label` and no `<label for>`.** `pageBarriers()`
in `scan.ts` skips any file input that has a `label[for]`, so an uploader labelled that way
reports no `drag-drop-only` at all and the regression demo shows nothing. With an
`aria-label` and `tabindex="-1"` it produces exactly one new barrier, which is the clean
version of the story. Worth saying to whoever writes the v3 fixture.

**The Greenhouse report is a stand-in.** `boards.greenhouse.io/example/jobs/0000000` is not
a real posting; the real URL goes into `monitor/urls.txt` in Phase 5 and its slug and
`pagePath` change accordingly. Its single `captcha` barrier is what `scan.ts` would emit
given the §11 finding that every real portal measured had one — `scan.ts` does not emit the
`cross-origin-frame-unreachable` that §11 also lists for Greenhouse, because that rule lives
in `probe/`, not in the shipped scanner. Do not put this file's contents on a slide.
