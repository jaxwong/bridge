# BRIDGE: Business spec

> **Status, 2026-09-22 — the employer side no longer scans.** This spec is left as written
> below, but these parts no longer describe the code:
>
> - **§2, §3, §5 and §6.2 describe a monitor** that took a list of posting URLs and scanned
>   them on a schedule. It has been removed. There is no monitor package, no local API and
>   no employer-initiated scanning anywhere in the repo.
> - **Reports now reach the dashboard one way only:** the applicant scans a form in their own
>   browser with the extension, exports a JSON report, and a business user loads that file.
>   Nothing is automatic and nothing is fetched.
> - **§6.3 (compare) and §6.4 (dashboard) still hold**, including the `rule` + label key and
>   the resolved / still open / new buckets.
> - **§6.5's fixture versions still exist** in `extension/test/fixtures/acme`, now used for
>   the extension's own tests and for the dashboard's fixtures.
>
> The offer in §2 rests on continuous coverage the monitor provided. Whether the business
> case survives on reports that arrive only from applicants is a product question this note
> does not answer. What the dashboard can and cannot see is in
> [`dashboard/README.md`](dashboard/README.md).

The employer side of BRIDGE: who pays, for what, and what we build to demo it.

The applicant side (the extension) is [`bridge-user.md`](bridge-user.md). The applicant is the
hero of the pitch; this spec answers "how does it make money?" and must not replace that story.

**Timeline:** 3-day hackathon, about 36 hours left when this was written (2026-09-21)
**Form factor:** a monitor script plus a static dashboard page. No backend, no accounts.

---

## 1. Problem (the buyer's)

An application form that passed an accessibility review does not stay accessible. The ATS
vendor ships UI changes every few weeks, and every employer on the platform adds its own
screening questions, branding, embedded assessments and third-party widgets. Any of these can
lock out screen-reader users, and nobody notices until a candidate gives up or a lawyer writes.

Enterprise and government buyers also ask the vendor for current proof of accessibility (an
accessibility conformance report, or VPAT) before they buy.

## 2. Customer and offer

**Customer:** ATS vendors (Greenhouse, Lever, Workday and similar). One vendor fixing one
component fixes it for every employer on the platform. Individual employers are a later market.

**Offer: hosted monitoring, paid monthly.**

- The vendor gives us the posting URLs for their customers' forms.
- Our monitor scans them on a schedule and compares each scan with the last one.
- The vendor gets a dashboard, an alert when a new barrier appears ("Acme's form gained a
  blocking barrier after Tuesday"), and reports to hand to buyers.
- The vendor runs nothing.

What they pay for is not the scanning code, which is easy to copy. It is:

1. **Ongoing coverage** of forms that change constantly.
2. **Proof** that stays current, for procurement and compliance (European Accessibility Act,
   ADA).
3. **Real-user data** (roadmap): opt-in reports from BRIDGE users about failures a crawler
   cannot see, such as a field that throws away what was typed. Competitors can copy a crawler,
   not this.

**Pitch line:** "Vendors pay a monthly subscription; we monitor their customers' live
application forms and alert them the moment a change locks out screen-reader users."

**Not the offer:**

- A one-off audit. That is a single fee, and the form breaks again next release.
- "We fix your form for you." That is consulting and does not scale.
- An overlay that patches the page for everyone. The accessibility community rejects overlay
  products, and judges who know the field will too.
- A pre-release check the vendor runs in its own build pipeline. Valid, but a different
  product. At most one line on the roadmap slide.

## 3. Why a subscription and not a one-off fee

The objection: "what makes a form accessible doesn't change, so they fix it once and cancel."

The rules change slowly (WCAG 2.2 in 2023). The forms change constantly:

- Vendor releases regress: a redesigned date picker or upload widget can break keyboard access
  after the last review passed.
- Employer customizations keep adding barriers the vendor does not control. This is the
  strongest answer: the vendor's own components can be clean while their customers' live
  forms are broken.
- Conformance reports are expected to reflect the current product, so the proof recurs.

## 4. Goals and non-goals

### Goals (hackathon)

- A monitor that scans a list of form URLs with BRIDGE's real scanner and writes one barrier
  report per URL per run.
- A dashboard that loads those reports and shows, for each form, its barriers and what changed
  since the previous scan: resolved, still open, new.
- A demo where a fix and then a regression both show up in the dashboard, from real scans.

### Non-goals

- The "are you a user or a business?" landing page. The demo opens on a real form.
- Showing the extension install. It is loaded unpacked before the demo.
- Signup, accounts, billing, pricing in the app, daily notification quotas. Pricing is one slide.
- A server or a real schedule. Cron runs the monitor in production; in the demo we run it by hand.
- Collecting data from BRIDGE users. The report leaves the browser only by a manual user action
  (`bridge-user.md` §6.7). Opt-in real-user reports are roadmap only.
- Filling in or submitting forms we do not own (see §9).
- Any number we did not measure. No "37 candidates blocked this week". Counts of scans,
  forms and barriers are real; use those.

## 5. How monitoring works

```
URL list ──> monitor (Playwright + BRIDGE scanner) ──> one report JSON per URL per run
                                                              │
                        dashboard <── compare with previous report for the same URL
                  (resolved / still open / new)
```

The scanner already exists. `scanPage()` (`extension/lib/scan.ts`) is plain DOM code, and
`extension/test/e2e.mjs` already runs the built extension in headless Chromium with
Playwright. The monitor is that setup pointed at a list of URLs, writing reports instead of
asserting.

Where the URLs come from:

- **Public job boards.** Greenhouse and Lever postings and most careers pages open without a
  login.
- **The vendor.** In production, the vendor supplies its customers' posting URLs. Whether a
  vendor exposes a public API for listing postings has **not been verified**; check before
  naming one on a slide.

What the monitor can and cannot see:

| Can see | Cannot see |
|---|---|
| Structural barriers on the first step of a public form: every rule in `scan.ts` (`missing-label`, `custom-dropdown-no-role`, `drag-drop-only`, `options-identically-named`, ...) | Forms behind a login (LinkedIn Easy Apply, many Workday applications) |
| | Later steps of a multi-step form, which need fields filled to reach |
| | Failures that only appear in real use, such as a write the page throws away |

The right-hand column is what the vendor-run check and opt-in real-user reports would add. Say
so if a judge asks.

## 6. Components

### 6.1 Report input

The monitor and the dashboard read the barrier report format defined in `bridge-user.md` §6.7.
That spec owns the format; change it there, not here.

To compare two scans, the dashboard needs a key that stays the same across form versions.
**Key: `rule` + field label.** An earlier §6.7 example carried a `selector`, but
`FieldDescriptor` (`extension/lib/types.ts`) has none, and generated selectors change
between releases anyway. Barriers that belong to the page rather than a field
(`pageBarriers`, e.g. `captcha`) use `rule` alone.

**Settled.** §6.7 now requires `label` on every field-level barrier, drops `selector`, and
defines `pageBarriers` and the `ScanResult` -> report mapping. Forms are identified across
time by `portal` + `pagePath`, with the query string excluded, which is what lets the §6.5
`?v=` fixtures stand in for one form changing between scans. Hand-written reports in this
shape are in `fixtures/reports/`; the dashboard is built against them.

**From the extension side, after both branches met.** The side panel's export is built
(`buildReport()` in `extension/lib/report.ts`, composed from the same `toReport()` the
monitor uses). Three things the dashboard should expect from it: a multi-step application
adds `steps[]` and a `step` number per barrier, which `parseReport` ignores; two fields
with the same label and rule share one key (live Greenhouse names both file inputs
"Attach"); and `cross-origin-frame-unreachable` comes only from the side panel, so an
export and a monitor scan of the same page can differ by that one page barrier.

### 6.2 Monitor

- **Input:** a file of URLs.
- **Output:** one report per URL per run, in a folder the dashboard reads. The file name
  carries the URL and the scan time.
- **Runs:** SCAN only. It never fills a field, never clicks forward, never submits.
- **Open:** whether it loads the built extension (as `e2e.mjs` does) or injects a bundled
  `scanPage()`. Pick whichever is simpler once the §6.7 export exists.

### 6.3 Compare

For each URL, compare the newest report with the one before it, by the §6.1 key:

- **Resolved:** in the previous report, not in the newest.
- **Still open:** in both.
- **New:** in the newest only. This is the alert.

The first scan of a URL has nothing to compare with; everything shows as open, not new.

### 6.4 Dashboard

A static page. No server, no login.

- Load reports with a normal file picker (`<input type="file" multiple>`). Drag and drop may be
  offered in addition, never alone: a drag-drop-only uploader is one of the barriers we demo.
- List forms. For each: barrier count by severity, and the §6.3 comparison with the previous
  scan.
- For each barrier: severity, the rule, and the impact sentence ("A screen reader user cannot
  attach a CV").
- The dashboard must itself be accessible: keyboard operable, labelled, tested with a screen
  reader and with axe (`axe-core` is already a dev dependency of the extension). An
  inaccessible dashboard sinks the whole pitch.

### 6.5 Fixture versions

The demo needs a form that changes. Add versions of Acme Careers
(`extension/test/fixtures/acme`), selected by query string:

| Version | Change | Expected in dashboard |
|---|---|---|
| v1 (default) | Today's fixture | Baseline: the custom education dropdown, the sponsorship radios, ... |
| `?v=2` | Education dropdown rebuilt as a labelled native `<select>` | Its barriers (`custom-dropdown-no-role`, `missing-label`, `not-keyboard-operable`) resolved |
| `?v=3` | v2 plus a drag-and-drop-only CV uploader: "the employer added a CV upload" | `drag-drop-only` shows as new |

v1 must stay what `e2e.mjs` tests. Plus at least one real public posting (Greenhouse) in the
URL list, for credibility.

## 7. Demo script

Continues from step 7 of `bridge-user.md` §9, after the applicant has finished. About 60 to 90
seconds.

1. **Export.** The applicant exports the barrier report from the side panel. "The candidate
   got through. The employer still doesn't know their form is broken."
2. **Baseline.** Run the monitor on Acme v1 and the real Greenhouse posting. Load the reports.
   The dashboard lists each form's barriers with impact.
3. **Fix.** "Acme fixes their dropdown." Run the monitor on v2. The dropdown barriers show as
   resolved.
4. **Regression.** "Next week the employer adds a CV upload." Run the monitor on v3. A new
   blocking barrier is flagged since the last scan.
5. **Close.** Pitch line (§2). "In production this runs nightly across every form on the
   platform."

## 8. Build plan

**Before anything else:** agree the report format and the §6.1 key, and write one sample
report by hand. The dashboard is built against the sample while the export and monitor are
built.

**Extension side**
- Barrier report export (`bridge-user.md` §6.7). The README lists it as not built yet
- Acme v2 and v3 (§6.5)
- Monitor script (§6.2)

**Web side**
- Dashboard (§6.4): load reports, list forms and barriers
- Compare (§6.3)
- Keyboard, screen reader and axe pass on the dashboard
- Landing copy and one pricing slide

**Before the demo:** run the §7 script end to end on the demo machine; record a fallback video.

## 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| The business story takes over the pitch | Applicant demo first; business section at most 90 seconds (§7) |
| A judge asks where a number came from | Show only measured counts (§4) |
| Scanning a real employer's form creates a draft or trips bot detection | Monitor runs SCAN only on the first step (§6.2); at most one or two real URLs in the demo |
| Real posting expires before the demo | Re-run the monitor on the morning of the demo; pick a replacement posting if it fails |
| Compare key mismatches across versions (label text changed) | Label text is kept identical between v1, v2 and v3 for fields that are not the point of the change |
| Real-user reports raise privacy questions | Roadmap only, opt-in, no field values or identity (same rules as `bridge-user.md` §6.7) |
| Vendor posting APIs | Not verified. Say "vendors supply their URLs" unless checked |
