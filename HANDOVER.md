# Handover: linking the extension to the employer dashboard

> **Status, 2026-09-21, from the extension side, after `implement-bridge-user` was rebased
> onto this.** Left as written below; these points are now out of date:
>
> - **§2, the export button: built.** JSON and Markdown, announced, named like the monitor's
>   files. `toReport()` is kept as the one conversion; the panel's `buildReport()` composes
>   it per step (`bridge-user.md` §6.7, "One step or many"). A one-step export is the same
>   JSON the monitor writes; `npm run test:e2e` checks that on `/`, `/?v=2` and `/?v=3`.
> - **§4's numbers still hold** for `http://localhost:8765/`: 5 barriers, 4 blocking. The
>   monitor's output for all three versions matches `fixtures/reports/` key for key.
> - **§5, the scanner bug: fixed.** A `<label for>` no longer hides an unreachable file
>   input, so `?v=3` could be labelled the ordinary way. It still works as it is.
> - **The applicant demo page moved to `apply.html`.** `index.html` is yours again, exactly
>   as you committed it. The two had collided: mine already had a CV uploader, so your v3
>   regression would not have registered as new.
> - **`extension/lib/` is still plain DOM code**, with one optional probe: `lib/dom.ts` uses
>   `chrome.dom` to open closed shadow roots when it exists, and falls back to open roots in
>   the monitor's ordinary page.

For whoever owns the extension side. Written from the business side after building the
monitor and dashboard on `feature/business-dashboard`.

**The whole link is one JSON file.** The side panel's "Export barrier report" button and the
monitor both produce the same shape; the dashboard loads it and can't tell which made it.
The format is [`bridge-user.md`](bridge-user.md) §6.7 and that section owns it — change it
there, not in the dashboard.

Right now only the monitor produces reports, because the export button isn't built. That
button is the missing half.

---

## 1. What changed in your files

Pull this branch before editing any of them.

| File | Change | Why |
|---|---|---|
| `bridge-user.md` §6.7 | `label` now required on field barriers, `selector` dropped, `pageBarriers` added, `pagePath` defined as pathname only | The old example couldn't be compared across scans — see §3 below |
| `extension/lib/report.ts` | **New.** `toReport(ScanResult)` builds the §6.7 report | Both producers need this exact conversion; it belongs with the producer, not in my folder |
| `extension/test/fixtures/acme/index.html` | `?v=2` and `?v=3` variants added | The dashboard needs a fix and a regression to detect |

`test/fixtures/acme` **v1 is untouched** — no query string gives you byte-for-byte the page
you had. `npm run test:e2e` was 23/23 before and after; re-run it if you don't believe me.

`?v=2` rebuilds the education dropdown as a labelled native `<select>`. `?v=3` adds a
drag-and-drop CV uploader on top of that.

---

## 2. Building the export button

`toReport()` is already written and typechecked. It takes the `ScanResult` you already hold
in `entrypoints/sidepanel/main.ts` (the `scan` variable, line ~33) and returns the report.

**This sketch is untested** — I didn't wire it up, because it's your file. Treat it as a
starting point, not something known to run.

`entrypoints/sidepanel/index.html`, as a new section:

```html
<section aria-labelledby="export-h">
  <h2 id="export-h">Barrier report</h2>
  <p id="export-help">Accessibility failures only. No answers, nothing that identifies you.</p>
  <button type="button" id="export" aria-describedby="export-help">Export barrier report</button>
</section>
```

`entrypoints/sidepanel/main.ts`:

```ts
import { toReport } from '../../lib/report';

function exportReport() {
  if (!scan) { announce('Nothing to export yet. Scan the page first.'); return; }

  const report = toReport(scan);
  const slug = `${report.portal}${report.pagePath}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = report.generatedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  const n = report.barriers.length + report.pageBarriers.length;
  announce(`Barrier report exported. ${n} ${n === 1 ? 'barrier' : 'barriers'}.`);
}

$('export').addEventListener('click', exportReport);
```

Two things worth keeping:

- **Announce it.** You already have `announce()` and a live region; an export that gives a
  screen reader user no confirmation is the kind of thing this product exists to complain
  about.
- **§6.7 says Markdown *and* JSON.** I only built the JSON side, because that's what the
  dashboard reads. The Markdown version — for a human to paste into an email to the
  employer — is still unwritten and is a nice-to-have, not a blocker.

---

## 3. The one rule that will silently break the link

**Every field-level barrier must carry the field's `label`.**

The dashboard compares two scans of the same form by `rule` + `label`. That's what lets it
say a barrier is *still open* rather than *resolved and then reintroduced*. Page-level
barriers (`pageBarriers`) have no field, so they key on `rule` alone.

It deliberately does **not** key on a selector — generated selectors change whenever the
site ships a release, which would report an entire form as resolved and new on the same day.
`FieldDescriptor` has no selector to emit anyway.

`toReport()` gets this right on its own. It only matters if you hand-build a report
somewhere. If a field barrier arrives without a label, the dashboard rejects the whole file
and names it — it won't quietly drop the barrier.

Also: **`pagePath` excludes the query string.** Forms are identified across time by
`portal` + `pagePath`, so `?v=2` and `?v=3` read as the same form scanned later. That's
what makes the demo work.

---

## 4. Checking that it actually links up

Once the button exists:

```bash
# 1. Serve the fixture and open it with the extension loaded
python3 -m http.server 8765 -d extension/test/fixtures/acme

# 2. Scan, then click Export barrier report. A .json lands in Downloads.

# 3. Run the dashboard
cd dashboard && npm run dev      # http://localhost:5173
```

Choose your exported file in the dashboard's file picker. You should see one form,
`localhost:8765/`, with **5 barriers, 4 blocking**, and *"First scan — nothing to compare
with yet"*. Click into it and the barriers should read exactly what your side panel showed.

If it's rejected, the error names your file and says what's wrong with it — that message is
the fastest debugging tool here.

For the full before/after, load `fixtures/reports/localhost-8765/` — three scans of one
form showing the fix and then the regression.

---

## 5. A scanner bug I worked around instead of fixing

`pageBarriers()` in `lib/scan.ts` returns early on any file input that has a `label[for]`:

```ts
document.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((inp) => {
  if (inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`)) return;
  if (!keyboardReachable(inp)) { /* drag-drop-only */ }
```

So a file input that is `tabindex="-1"` behind a drop zone — genuinely unreachable by
keyboard — reports **nothing at all** if someone also gave it a `<label for>`. That looks
wrong: being labelled doesn't make it operable.

I didn't change it. It's your file and it wasn't my task. But it's why the `?v=3` fixture
names its input with `aria-label` rather than `<label for>` — labelling it the obvious way
silences the exact barrier that version exists to demonstrate. If you fix the rule, `?v=3`
can be relabelled normally.

---

## 6. Still not done

*(As at the §7 change below: the export button is built. A real posting URL, the NVDA pass
and the fallback video are still open, and §7 adds more.)*

- **The export button** — the thing this document is about.
- **A real job posting in `monitor/urls.txt`.** It has a commented placeholder. A live
  Greenhouse posting needs to go in and be re-verified the morning of the demo; postings
  expire, and the monitor exits non-zero rather than writing an empty report that would read
  as "this form is fine".
- **NVDA pass on the dashboard.** It has zero axe violations across every view, and the
  tests check focus movement and keyboard operation, but nobody has listened to it.
- **Fallback demo video.**

---

## 7. Automated WCAG 2.2 A/AA findings

*Added 2026-09-22 from the business side, on `feat/wcag-business-monitoring`.*

### What BRIDGE now says, and what it must never say

BRIDGE reports **automated WCAG 2.2 A/AA accessibility findings**.

It does **not** certify WCAG compliance, does not make any company legally compliant, and
does not replace human accessibility testing. **Human review is required for a WCAG
conformance claim.** Those two phrasings are the wording to use everywhere — in the UI, in
the Markdown export, in the pitch, and in anything shown to a buyer. The dashboard's
accessibility test enforces it: it fails if any sentence on the page mentions compliance,
certification or legal standing without a negation.

The reason is not only legal caution. An automated scan reads a fraction of WCAG; most
criteria need a person. A report that reads as a pass would be wrong about the thing that
matters most to the applicant.

### Schema, extended compatibly

`ReportBarrier` in [`extension/lib/types.ts`](extension/lib/types.ts) gained four **optional**
fields, which `ReportPageBarrier` inherits. Nothing became required, so every report written
before this still parses and still compares exactly as it did.

```jsonc
{
  "rule": "options-identically-named",
  "severity": "blocking",
  "label": "Will you now or in the future require sponsorship…",
  "impact": "All 2 options … sound identical to a screen reader.",

  "wcag": ["4.1.2", "2.5.3"],   // success-criterion numbers; absent = no mapping recorded
  "wcagLevel": "A",             // "A" | "AA" — the most stringent among `wcag`
  "automated": true,            // a scanner produced this, not a person
  "reviewRequired": false       // true = the detection is heuristic, confirm it by hand
}
```

`toReport()` attaches them, so **both producers emit them automatically** — your export
button and the monitor alike. You do not have to do anything to opt in.

The dashboard validates them at the boundary: a present-but-malformed `wcag` (a guideline
number like `"4.1"`, prose, an empty array, an unknown level, a non-boolean flag) rejects
the file by name. Absent is always fine.

### The mapping table, and why it is short

[`extension/lib/wcag.ts`](extension/lib/wcag.ts) holds the table. Each entry names the line
in `scan.ts` it was read from and carries a written rationale. A rule is mapped **only** where
the criterion fails every time that rule fires, given what the rule actually tests.

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

Two rules are deliberately unmapped, and it matters that they stay that way unless someone
does the work to justify a change:

- **`modal-without-dialog-role`** is detected by class-name substring (`[class*=modal]`),
  which is a naming convention rather than a semantic fact, and the criterion is contested
  between 4.1.2, 1.3.1 and focus management under 2.4.3. It is still a real barrier and is
  still reported — it just carries no criterion.
- **`captcha`** is not a WCAG failure at all. The note on 1.1.1 contemplates conforming
  CAPTCHAs given a text alternative and alternative modalities, and the rule only detects
  that a widget is present, not whether those exist.

Two near-misses worth knowing, because they will come up:

- **2.5.7 Dragging Movements (AA, new in 2.2)** is *not* claimed for `drag-drop-only`, even
  though it looks like the obvious fit. 2.5.7 is satisfied by any single-pointer alternative
  to dragging; the rule only tests for a **keyboard** trigger. A drop zone that also opens a
  file picker on click fails 2.1.1 and passes 2.5.7, and the scanner cannot tell them apart.
- **3.3.8 Accessible Authentication (AA, new in 2.2)** is not claimed for `captcha`, because
  it applies to authentication steps and a CAPTCHA on a job application is not necessarily
  one.

Both need a person. If you want AA findings on the board, those two are where the work is —
**every criterion currently mapped is Level A**, which is the honest result, not a gap I
papered over.

### Scanning one URL and looking at it

```bash
# 1. Scan one public job-application URL. Quote it — postings contain ? and &.
cd monitor
node run.mjs --url 'https://boards.greenhouse.io/example/jobs/1234567'
# -> ../reports/<slug>/<timestamp>.json

# 2. Open the dashboard and pick that file
cd ../dashboard && npm run dev      # http://localhost:5173
```

The `urls.txt` workflow is unchanged: `node run.mjs urls.txt`.

For the local fixture, with `python3 -m http.server 8765 -d extension/test/fixtures/acme`
running in another terminal:

```bash
node run.mjs --url 'http://localhost:8765/'        # 5 findings, all mapped, all Level A
node run.mjs --url 'http://localhost:8765/?v=2'    # the fix
node run.mjs --url 'http://localhost:8765/?v=3'    # the regression
```

### What the monitor refuses

It reads pages. It never fills a field, clicks a control, submits a form, or attempts a
CAPTCHA, and it carries no credentials. Beyond intent, non-GET document requests are aborted,
so a submission cannot leave the browser even if a page script tries one.

**A page with a password field fails instead of being scanned** — that is a sign-in or
account-creation page, not a public application form, and BRIDGE never signs in. Workday
applications start with account creation, so they fail here by design. Unreachable, expired,
and no-form URLs each fail with their own message, write nothing, and exit non-zero.

### Unverified, and what needs a person

- **Every finding needs human review before any conformance claim.** That is the product
  position, not a caveat about this branch.
- **The mappings are my reading of each rule's implementation**, not an audited table. They
  have not been reviewed by an accessibility specialist. The rationale strings in
  `wcag.ts` exist so a reviewer can disagree with a specific one.
- **`reviewRequired` findings** (`custom-dropdown-no-role`, `not-keyboard-operable`) come
  from heuristics — a class-word match and a static `tabindex`/computed-style test. Neither
  can observe real Tab traversal; `bridge-user.md` §6.2 already records that scripted key
  presses do not move focus.
- **Only the local Acme fixture has been scanned** with the new `--url` command. No real
  public posting has been run through it, so `monitor/urls.txt` still has a commented
  placeholder and no real posting's findings have been seen.
- **No NVDA pass** on the dashboard, including the new WCAG summary and badges. axe is clean
  across all five views and the tests cover focus and keyboard operation, but nobody has
  listened to it.
- **`bridge-user.md` §6.7 has not been updated.** It owns the report format and now describes
  a schema missing these four fields. It is your file and it is actively edited, so I left it
  alone rather than collide — it should be updated by whoever owns it.
