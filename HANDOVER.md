# Handover: the extension-to-dashboard report handoff

How the applicant side and the business side connect, and what each owes the other.

**The whole link is one JSON file.** The format is [`bridge-user.md`](bridge-user.md) §6.7
and that section owns it — change it there, not in the dashboard. The dashboard reads that
JSON and nothing else; it does no scanning and makes no network call.

> **Open, as of 2026-09-22: nothing currently produces a report.** The panel's manual export
> button has been removed in favour of sending the report to the employer automatically when
> the applicant submits, and that send is not built yet. `buildReport()`, `toReport()`,
> `reportMarkdown()` and `reportFileStem()` in `extension/lib/report.ts` are untouched and
> still tested — they are what the send should call. Until it exists, the dashboard can only
> be fed from `fixtures/`.

---

## 1. The flow, end to end

```
1. The applicant reaches a job application form themselves, and BRIDGE scans it
   in their own browser.
2. The report is sent to the employer when the applicant submits the application.
   That send is being built separately; the manual export button has been removed.
3. A business user opens the dashboard.
4. They load one or more exported JSON reports through the file picker.
5. The dashboard shows the findings, their WCAG criteria, and what changed since
   the previous report for the same form.
```

Exact commands:

```bash
# Applicant side — build and load the extension
cd extension && npm install && npm run build
# chrome://extensions -> Developer mode -> Load unpacked -> extension/.output/chrome-mv3
# Open the application form, press Alt+Shift+B, scan.
# NOTE: there is currently no way to get a report out of the panel. The manual export was
# removed and the automated send is not built yet, so use the fixtures below instead.

# Business side — open the dashboard and load what was exported
cd dashboard && npm install && npm run dev      # http://localhost:5173
# "Load barrier reports" -> choose the exported .json file(s)
```

To try it without the extension, `fixtures/reports-wcag/localhost-8765/` holds three real
reports for one form: a baseline, a fix, and a regression. Load all three and the form list
shows `1 new, 2 still open`.

---

## 2. The report contract

`toReport()` in [`extension/lib/report.ts`](extension/lib/report.ts) builds it from one
`ScanResult`; `buildReport()` composes one per step for a multi-step application. It is the
only conversion, and the export is the only way a report leaves the browser.

```jsonc
{
  "portal": "boards.greenhouse.io",   // location.host, port included
  "pagePath": "/acme/jobs/12345",     // location.pathname — no query string
  "generatedAt": "2026-09-24T10:00:00Z",

  "barriers": [{                      // one per field-level finding
    "rule": "options-identically-named",
    "severity": "blocking",           // "blocking" | "usability" | "ok"
    "label": "Will you now or in the future require sponsorship…",
    "impact": "All 2 options … sound identical to a screen reader.",

    // Optional, all four. Absent means no mapping is recorded, not that none applies.
    "wcag": ["4.1.2", "2.5.3"],
    "wcagLevel": "A",                 // "A" | "AA" — the most stringent among `wcag`
    "automated": true,
    "reviewRequired": false           // true = heuristic detection, confirm by hand
  }],

  "pageBarriers": [{                  // findings belonging to no field, so no `label`
    "rule": "captcha", "severity": "blocking", "impact": "…"
  }],

  "steps": []                         // present only for a multi-step application
}
```

**Two rules the comparison depends on.**

`label` is required on every `barriers[]` entry. The dashboard compares two reports for the
same form by `rule` + `label` for field-level findings, and by `rule` alone for
`pageBarriers`. It deliberately does not key on a selector: generated selectors change
whenever a site ships a release, which would report a whole form as resolved and new on the
same day.

`pagePath` excludes the query string. Forms are identified across time by
`portal` + `pagePath`, so two reports for one posting line up as a history.

**Backward compatibility is not optional.** The four WCAG fields are optional, so a report
exported before they existed still loads, still groups and still compares. Its findings
display as "No WCAG mapping recorded". `fixtures/reports/` is kept as that corpus and the
dashboard's tests run against it.

The dashboard validates every loaded file at the boundary and names the file when something
is wrong with it, rather than failing later inside the comparison.

---

## 3. What a report must never contain

Findings only: which rule fired, on which labelled field, and one sentence about what it
means for the user.

- **No answers.** No field values of any kind.
- **No CV**, no file contents, and no file name the applicant chose.
- **No credentials.** BRIDGE does not handle sign-in; `bridge-user.md` §10 explains why.
- **No applicant identity** — no name, email, address, or anything derived from them.

The format carries no mechanism for any of it, and `toReport()` copies only `rule`,
`severity`, the field's `label`, and the impact message. `extension/test/e2e.mjs` asserts this
on a real export (`export: no applicant data`).

Sending a report anywhere is a manual user action. The applicant exports it; what happens to
it next is their decision.

---

## 4. Automated WCAG 2.2 A/AA findings

**Automated WCAG 2.2 A/AA accessibility findings. Human review is required for a WCAG
conformance claim.**

BRIDGE does not certify WCAG compliance, does not make anyone legally compliant, does not
claim a form is accessible, and does not replace human accessibility testing. Use that
wording everywhere — in the UI, in the Markdown export, in the pitch. The dashboard's
accessibility test fails the build if any sentence on the page mentions compliance,
certification or legal standing without a negation.

The reason is not only caution. An automated scan reads a fraction of WCAG; most criteria
need a person. A report that reads as a pass would be wrong about the thing that matters most
to the applicant.

[`extension/lib/wcag.ts`](extension/lib/wcag.ts) holds the mapping table. Each entry names the
line in `scan.ts` it was read from and carries a written rationale. A rule is mapped only
where the criterion fails every time that rule fires.

| Rule | Criteria | Level | Review |
|---|---|---|---|
| `missing-label` | 4.1.2 | A | — |
| `label-placeholder-only` | 3.3.2 | A | — |
| `custom-dropdown-no-role` | 4.1.2 | A | yes |
| `not-keyboard-operable` | 2.1.1 | A | yes |
| `group-not-labelled` | 1.3.1 | A | — |
| `options-identically-named` | 4.1.2, 2.5.3 | A | — |
| `drag-drop-only` | 2.1.1 | A | — |
| `upload-unnamed` | 4.1.2 | A | — |
| `modal-without-dialog-role` | *unmapped* | — | — |
| `captcha` | *unmapped* | — | — |

Two rules are deliberately unmapped and should stay that way unless someone does the work:

- **`modal-without-dialog-role`** is detected by class-name substring (`[class*=modal]`), a
  naming convention rather than a semantic fact, and the criterion is contested between
  4.1.2, 1.3.1 and focus management under 2.4.3. It is still reported as a barrier.
- **`captcha`** is not a WCAG failure at all. The note on 1.1.1 contemplates conforming
  CAPTCHAs given a text alternative and alternative modalities; the rule only detects that a
  widget is present.

Two near-misses that will come up:

- **2.5.7 Dragging Movements (AA)** is not claimed for `drag-drop-only`. 2.5.7 is satisfied by
  any single-pointer alternative to dragging; the rule tests only for a **keyboard** trigger.
  A drop zone that also opens a file picker on click fails 2.1.1 and passes 2.5.7, and the
  scanner cannot tell them apart.
- **3.3.8 Accessible Authentication (AA)** is not claimed for `captcha`, because it applies to
  authentication steps and a CAPTCHA on a job application is not necessarily one.

**Every criterion currently mapped is Level A.** That is the honest result of not guessing.
If AA findings are wanted, those two are where the work is.

---

## 5. Limitations, and what needs a person

**On coverage**

- Automated rules catch a fraction of WCAG. Most criteria — meaning, order, context, whether
  an error message actually helps — cannot be judged by a script.
- The dashboard only knows about forms someone applied to with BRIDGE and then chose to
  export. It is not a survey of a platform, and a form's absence here means nothing.
- A report describes one applicant's journey at one moment. Two applicants on the same form
  can legitimately produce different findings if they took different paths through it.

**On the findings themselves**

- The WCAG mappings are a reading of each rule's implementation, not an audited table. No
  accessibility specialist has reviewed them. The rationale strings exist so a reviewer can
  disagree with a specific one.
- `reviewRequired` findings (`custom-dropdown-no-role`, `not-keyboard-operable`) come from
  heuristics — a class-word match, and a static `tabindex`/computed-style test. Neither can
  observe real Tab traversal; `bridge-user.md` §6.2 records that scripted key presses do not
  move focus.
- `focus-trap` is not detectable by SCAN at all and is never reported.

**Unverified**

- **No NVDA pass on the dashboard.** axe is clean across every view and the tests cover focus
  movement and keyboard operation, but nobody has listened to it.
- **No real public posting has been through the whole flow** end to end, extension export to
  dashboard. The local Acme fixture has, in all three versions.
- **`bridge-user.md` §6.7 is stale.** It owns the report format, still describes a second
  producer that no longer exists, and does not mention the four WCAG fields. It is the
  extension owner's file and should be updated by whoever owns it.
- **`bridge-business.md` is stale** in the same way: §2, §5 and §6.2 describe employer-side
  monitoring of URLs, which this repo no longer does. A note at the top of that file records
  the change; the spec's substance has not been rewritten.
