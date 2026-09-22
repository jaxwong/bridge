# BRIDGE monitor

Scans a list of application form URLs with the BRIDGE scanner and writes one barrier report
per URL per run — [`../bridge-business.md`](../bridge-business.md) §6.2.

```bash
npm install

node run.mjs urls.txt                    # scan every URL in a file
node run.mjs --url '<URL>'               # scan one public job-application URL

npm test                                 # argument parsing (no browser, no network)
```

One pass, then it exits. In production this runs on a schedule; for the hackathon it is run
by hand.

## Scanning one URL

```bash
node run.mjs --url 'https://boards.greenhouse.io/example/jobs/1234567'
```

Quote the URL: a job posting URL often contains `?` and `&`, which the shell would otherwise
interpret. `--url=<URL>` works too. One URL per invocation — the monitor refuses two, an
unknown option, or a `--url` mixed with a file, rather than guessing which was meant.

Only `http` and `https` are accepted. `file:`, `data:` and `javascript:` URLs are refused,
because those would read the local disk or run the argument rather than fetch a page.

The output is the same report JSON as the `urls.txt` workflow, in the same place, and loads
into the dashboard the same way:

```bash
node run.mjs --url 'https://boards.greenhouse.io/example/jobs/1234567'
# -> ../reports/boards-greenhouse-io-example-jobs-1234567/2026-09-22T06-15-52Z.json

cd ../dashboard && npm run dev      # http://localhost:5173, then pick that file
```

## Automated WCAG 2.2 A/AA findings

Each finding carries the success criteria its rule maps to, the conformance level, and
whether the detection needs a person to confirm it. The mapping table is
[`../extension/lib/wcag.ts`](../extension/lib/wcag.ts), which maps a rule only after reading
that rule's implementation in `scan.ts`. A rule that cannot be mapped confidently carries no
criterion, and the dashboard shows "No WCAG mapping recorded" rather than a guess.

**These are automated findings, not a conformance result.** BRIDGE does not certify WCAG
compliance and does not replace testing with real assistive technology. **Human review is
required for a WCAG conformance claim.**

## It does not reimplement the scanner

`extension/lib/` is plain DOM code that uses no `chrome.*` API anywhere, so `run.mjs`
bundles `scanPage()` and `toReport()` straight out of the extension with esbuild and injects
the bundle into the page. Every rule the monitor reports is the rule the applicant's
extension reports, because it is the same source file. There is no second copy of the rules
to drift.

It does not load the built extension. There is nothing to load it for: the side panel, the
message plumbing and ACT are all about a person filling a form in, and the monitor only
reads.

## It only ever reads

SCAN only. It never fills a field, never clicks, never submits. It does not even open custom
dropdowns to enumerate their options — the extension does that for TRANSLATE
([`../bridge-user.md`](../bridge-user.md) §6.3), but the barrier report carries no options,
so the monitor has no reason to touch a real employer's page at all.

That is enforced structurally as well as by intent: any non-GET document request is aborted,
so a form submission cannot leave the browser even if a page script tries one by itself. If
that ever fires, the URL fails loudly rather than producing a report. Data fetches are left
alone so single-page forms still render.

## Output

```
reports/<slug>/<timestamp>.json
```

The slug is derived from the report's own `portal` + `pagePath`, so it always agrees with
how the dashboard groups forms. The dashboard does not read either the slug or the file
name — it reads `portal` and `pagePath` from inside the file — so the layout is for humans
and for the filesystem only.

## Failures are loud

Each URL is bounded: 30s to navigate, 15s for a form control to appear, then 1.5s to settle.
Any of these fails that URL, writes nothing, and lets the run continue to the rest. The
process exits non-zero if any URL failed.

| Condition | What you see |
|---|---|
| Unreachable, or an HTTP error | `the page returned HTTP 404 Not Found` |
| Expired posting, or no form on the page | `no form controls appeared within 15s` |
| Login-gated | `the page has a password field, so it is a sign-in or account-creation page` |
| The page tried to submit itself | `the page tried to submit while being scanned, and was stopped` |
| Bad arguments | the reason, then the usage text; exit code 2 |

**Login-gated URLs are reported, never entered.** A password field means a sign-in or
account-creation page rather than a public application form, so the URL fails instead of
being scanned. The monitor carries no stored credentials and never signs in; forms behind a
login are outside what it can see (`bridge-business.md` §5). Workday applications begin with
account creation, so they fail here by design.

Writing a report for a page whose form never appeared would be worse than writing nothing:
a form with zero barriers on the dashboard reads as *this one is fine*. An expired posting
has to be noticed the morning of the demo, not on stage.

## urls.txt

One URL per line; blank lines and `#` comments ignored. The Acme fixture needs a server:

```bash
python3 -m http.server 8765 -d extension/test/fixtures/acme
```

Scan the Acme versions on **separate runs** — v1, then v2 after the "fix", then v3 after the
"regression". All three in one pass would write three scans of one form seconds apart, and
the comparison the dashboard shows would be meaningless.
