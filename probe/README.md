# probe

Validates BRIDGE's SCAN and ACT logic against **live job portals**, from Node, before
any of it ships inside the extension.

`scan.js` is the real thing: the same dependency-free function the content script will
run. Everything else is harness.

```bash
npm install
npx playwright install chromium

node run.js --preset greenhouse          # scan a known target
node run.js --preset workday             # scan, click through one step, rescan
node run.js <any-url> --click <selector> # anything else
node act.js                              # do the write strategies actually work?
```

`run.js --click` drives one step transition and rescans after it. It reports how many
**hard navigations** happened, which is the thing that decides where session state has
to live.

## Presets

| Preset | Portal | Why it's here |
|---|---|---|
| `greenhouse` | GitLab | Cleanest real form. Every ACT strategy passes. |
| `lever` | Palantir | Checkbox/radio groups with no programmatic name. |
| `ashby` | Cohere | Drag-drop uploader; 1px, `tabindex=-1`, unnamed file input. |
| `workday` | NVIDIA | Multi-step. Publishes its whole 6-step journey up front. |
| `vietnamworks` | — | Login wall that is not a dialog. The starkest barrier found. |
| `linkedin` | JPMorganChase | Mostly routes offsite to another ATS. |

Job postings expire. When a preset 404s, swap the URL in `targets.json` — for
Greenhouse and Lever the board APIs list live ones:

```bash
curl -s https://boards-api.greenhouse.io/v1/boards/gitlab/jobs | head -c 400
curl -s "https://api.lever.co/v0/postings/palantir?mode=json" | head -c 400
```

## Pages you should not automate

Anything behind a login — LinkedIn Easy Apply above all — gets inspected by hand, not
driven by Playwright. Automating LinkedIn breaches their User Agreement and puts a real
account at risk of restriction. Use the console probe instead: it is you browsing your own
session with DevTools open, which is not automation.

```bash
node build-console.js     # regenerates console-snippet.js from scan.js
```

Paste `console-snippet.js` into DevTools on the page. Chrome may make you type
`allow pasting` into the console first.

```
bridge.scan()     scan now, print a report
bridge.steps()    every step transition the detector has seen
bridge.export()   copy(bridge.export()) for the write-up
bridge.stop()     detach the observers
```

It carries the §6.5 step detector, so it logs each transition live with the overlap ratio,
whether the URL changed, and where focus went. Against a synthetic in-place swap it
discriminates correctly (overlap 0 → `NEW STEP`; overlap 0.75 → `same step, fields
changed`). That validates the logic, **not** any real portal's DOM.

## Rules of engagement

These are real employers' hiring systems.

- **Never submit.** Stop at read-back. `run.js` only ever clicks what you pass to
  `--click`; `act.js` fills fields and stops.
- **No accounts, no credentials, no login.** Findings behind a login wall are out of
  scope for the probe — test those in your own logged-in browser instead.
- Keep the request volume low. This is a handful of page loads, not a crawler.

## Caveats on the numbers

- `act.js` test 2a usually resolves to a phone country-code widget, which renders its
  selection as a dial code (`+263`) rather than the option text. The assertion allows
  that. A scoped run against a plain choice dropdown gives a cleaner result.
- The synthetic-`drop` fallback has **not** been fairly tested — the one attempt
  resolved the wrong element as the drop zone. Treat it as unverified, not as failed.
- Easy Apply on LinkedIn is behind a login, so none of it was measured.

## Test plans

- [`linkedin-easy-apply-test.md`](linkedin-easy-apply-test.md) — the outstanding one:
  can a blind applicant complete an Easy Apply application?
- [`screen-reader-testing.md`](screen-reader-testing.md) — method for the listening pass.

## The probe is half the test

`scan.js` reports what is in the DOM. It cannot tell you what a user is *told* — a silent
step transition and a visual-only progress bar both look fine to it. See
[`screen-reader-testing.md`](screen-reader-testing.md) for the other half.

Findings are written up in [`../bridge-spec.md`](../bridge-spec.md) §11.
