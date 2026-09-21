# BRIDGE monitor

Scans a list of application form URLs with the BRIDGE scanner and writes one barrier report
per URL per run — [`../bridge-business.md`](../bridge-business.md) §6.2.

```bash
npm install
node run.mjs urls.txt
```

One pass, then it exits. In production this runs on a schedule; for the hackathon it is run
by hand.

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
A URL that 404s, times out, or shows no form controls fails that URL, writes nothing, and
the run continues to the rest. The process exits non-zero if any URL failed.

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
