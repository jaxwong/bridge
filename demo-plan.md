# Demo plan: employer dashboard opens on a seeded report with suggested fixes

Status: **steps 1–3 built on branch `demo-seeded-report` (uncommitted). Step 4, the rehearsal, needs you.**
Changes from the plan as written below:
- The seed is the first scan of `apply.html`, not a capture after fill. That scan is the one the e2e suite already
  checks every barrier against. Barriers are structural, so filling in the form does not change them.
- The seed is written by `make demo-seed` (the e2e suite with `WRITE_DEMO_SEED=1`), not by a throwaway script, so the
  command survives the session.
- The page's "What this demo does not do" paragraph said reports arrive because someone loaded them. That became false,
  so it now says the report shown was captured ahead of time. It is at the bottom of the page, not a banner.

## The demo

1. The applicant fills in and submits Acme Careers' form (`extension/test/fixtures/acme/apply.html`) with BRIDGE.
2. Switch windows to the dashboard. It already shows Acme's form, with a report received from an applicant.
   Narration: "Acme subscribes to BRIDGE, so the report arrived when the application was submitted."
3. Open Acme's form. Each finding shows its field, its impact, its WCAG criteria and a **suggested fix**.
4. The demo ends there.

Needs running: the built extension, `make serve`, `cd dashboard && npm run dev`. No proxy for the report.

## What "seeded" means here

The seed is **one real report from the real scanner**, captured from `apply.html` and checked into the dashboard. It is
not written by hand. An e2e check fails if the form and the seed ever disagree. So what the dashboard shows is exactly
what BRIDGE finds on the form the audience just watched, and the counts on the page are real (`bridge-business.md` §4).

What is **not** real, and is labelled so in the code and the README: the send. Nothing travels from the extension to the
dashboard. The dashboard shows the same capture every time it opens.

## Decisions (overrule any)

| # | Decision | Why |
|---|---|---|
| D1 | The seed is a real capture, not hand-written. | Same code either way. It cannot drift from the form, and it answers "is that real?" |
| D2 | The file upload is removed completely: the input, drag and drop, `readFiles()`, the load-error display, and the "Load barrier reports" section. | Your call. The dashboard then has exactly one input, the seed. |
| D3 | The seed still goes through `parseReport()` at startup, and a bad seed crashes loudly. | It is the dashboard's one boundary check on the report shape. A broken seed is a programmer error, so it should crash, not show an empty list. |
| D4 | No "demo data" note on the page itself. The label goes in the file name (`demo-seed.json`), a comment at the import and the README. | A banner would undercut the window switch. The content is a real scan. Say if you want a small on-page note anyway. |
| D5 | The extension is unchanged. It does not announce "report sent". | Nothing is sent, so the applicant must not be told it was. |
| D6 | Suggested fixes: one per rule in `extension/lib/rules.ts`, carried as `fix` on each finding. The dashboard displays the fix and does not decide it. | `rules.ts` is the one owner of what a rule is. Called "suggested fix", never "patch": the report has no page source to diff. |
| D7 | `fix` is optional to the dashboard parser. | `fixtures/reports/` stays loadable in `compare.test.ts`. |
| D8 | The seed has no `received.html` step. It is captured after fill and before submit. | Otherwise it gets an empty "Step 2: Application received". The panel records the confirmation page into the same session. |
| D9 | `fixtures/reports-wcag/` is not regenerated. | Its only reader is `compare.test.ts`, and a pre-`fix` report is a valid report (D7). |

## Build order

Each step ends with its checks passing. I branch off `main` first and will not commit; you reword and commit.

### 1. Fix text in the rule catalogue
- `extension/lib/rules.ts`: add `fix: string` to `Rule`. All 13 entries are required by `Record<RuleId, Rule>`.
- `extension/lib/types.ts` `ReportBarrier`: add `fix: string`. `extension/lib/report.ts`: `toReport()` copies it,
  and `reportMarkdown()` adds a `Suggested fix:` line under each finding.
- `bridge-user.md` §6.7: `fix` in the example and the table.
- e2e (the existing report section, which uses `buildReport()`): every finding carries exactly its rule's fix.

### 2. Capture the seed
- A scratch Playwright script, using the method e2e already uses (`buildReport()` over the session in `storage.session`):
  open `apply.html`, scan, fill the answers the demo uses, stop before submit, and write
  `dashboard/src/demo-seed.json`.
- The e2e suite gets a new check: `buildReport()` of `apply.html` equals the seed, ignoring `generatedAt`. The form and
  the seed can then never drift apart silently.
- To refresh the timestamp on demo morning, re-run the script. The command goes in the dashboard README.

### 3. Dashboard: the seed in, the upload out
- `dashboard/src/main.ts`: remove `readFiles()`, `renderErrors()`, the input and drop-zone wiring. At startup:
  `loaded = [parseReport(seed, 'demo-seed.json')]`, then `render()`. `barrierItem()` gets a "Suggested fix" line,
  set as text, below the impact.
- `dashboard/index.html`: remove the "Load barrier reports" section and the "No reports loaded yet" empty state.
- `dashboard/src/style.css`: remove the `.loader`, `.file-label` and `.errors` rules if nothing else uses them (grep first).
- `dashboard/src/lib/report.ts` `parseBarrier()`: optional `fix`, and a present non-string is rejected.
- `dashboard/test/compare.test.ts`: `fix` parses, a malformed `fix` is rejected, and `fixtures/reports/` is unchanged.
- `dashboard/test/a11y.mjs`: rewritten around the seeded page. It checks 0 axe violations on the list and on the detail
  view, focus moving to the heading and back to the row, the fix line present, and the no-compliance-claim sentence check.
- `dashboard/README.md` and the `bridge-business.md` status note: the dashboard shows one seeded report, and there is no upload.

### 4. Rehearsal
The demo above, end to end, on the real build. Re-capture the seed that morning.

## What this gives up (stated, not hidden)
- **Coverage.** `a11y.mjs` today loads Acme v1/v2/v3 and Greenhouse through the picker, and runs axe over the
  resolved / still open / new view and the load-error state. With one seed, the page never shows a "resolved" or
  "new" bucket and has no error state. The comparison **logic** stays covered by `compare.test.ts`. Its **rendering**
  is no longer checked by axe.
- **The product claim.** The dashboard no longer receives reports at all. The pitch line "the report arrives when the
  application is submitted" describes the roadmap, not the build. That is fine to say in a pitch. Don't show the
  dashboard code to a judge as the delivery mechanism.
- `fixtures/reports/`, `fixtures/reports-wcag/` and `compare.ts` stay. They are still used by the tests and by the page.

## Draft fix lines (for you to edit: this is what the audience reads)

Each line says only what follows from what that rule actually tests.

| Rule | Suggested fix |
|---|---|
| `missing-label` | Give the field a visible `<label for="…">` that names it, or point `aria-labelledby` at the visible question. |
| `label-placeholder-only` | Add a visible `<label>`. A placeholder disappears as soon as the applicant types, so it cannot be the only name. |
| `custom-dropdown-no-role` | Use a native `<select>` with a `<label for="…">`. If it must stay custom, give it `role="combobox"`, `aria-expanded` and a `role="listbox"` of options. |
| `not-keyboard-operable` | Make it reachable with Tab: use a native control, or remove the `tabindex="-1"`, `inert` or hiding that takes it out of the tab order. |
| `group-not-labelled` | Wrap the options in a `<fieldset>` whose `<legend>` is the question. |
| `options-identically-named` | Remove the shared `aria-label` from each option so each is named by its own text ("Yes", "No"). Put the question in the group's `<legend>`. |
| `drag-drop-only` | Keep the drop zone, and add a "Choose file" button that Tab reaches and that opens the file input. |
| `upload-unnamed` | Give the file input a `<label for="…">` that says what to upload, such as "CV (PDF or Word)". |
| `target-too-small` | Make the control at least 24 by 24 CSS pixels, or space it so a 24px circle around it touches no other control. |
| `low-contrast` | Raise the text contrast to at least 4.5:1 (3:1 for large text). This changes your colours, so you pick the shade. |
| `modal-without-dialog-role` | Use a `<dialog>` opened with `showModal()`, or give the popup `role="dialog"`, `aria-modal="true"` and a name from its heading. |
| `captcha` | Offer a way through that needs no sight and no puzzle, such as an audio option or a check with no challenge. |
| `cross-origin-frame-unreachable` | Not a defect: BRIDGE could not look inside this embedded frame from another site. Check that part by hand. |

## Out of scope
- Any real send (proxy endpoint, on-submit hook, `reports/` folder). The previous version of this plan had it. It is dropped.
- The subscriber check, accounts, applying fixes, re-scanning.

## Verification I will report
Exact commands and output: `make typecheck`, `make test-extension`,
`cd dashboard && npm run typecheck && npm test && npm run test:a11y`, and the step 4 rehearsal.
Anything I could not check gets listed as unchecked.
