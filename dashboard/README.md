# BRIDGE dashboard

The employer side of [`../bridge-business.md`](../bridge-business.md) §6.4: load barrier
reports, list the forms they cover, and show what changed since each form's previous scan.

A static page. No server, no accounts, no database. Plain TypeScript and native HTML —
the same choice the extension's side panel made, for the same reason.

```bash
npm install
npm run dev          # Vite dev server
npm run build        # -> dist/, a static page
npm test             # compare logic against ../fixtures/reports
npm run test:a11y    # builds, then drives the real page with axe-core
npm run typecheck
```

## Loading reports

`npm run dev`, then choose report files with the file picker. Dragging files onto the box
also works — as an addition, never as the only way in. A drag-drop-only uploader is one of
the barriers this product exists to report, so it could hardly be the way into the
dashboard.

Loading is additive: pick files, pick more, they accumulate. That matters because the
monitor writes one directory per form and a file dialog opens on one directory at a time.
The same scan picked twice is still one scan.

Reports are grouped into forms by `portal` + `pagePath` **read from inside the file**, not
from its name: a file picker hands over a name and no directory.

## What it shows

Per form, the newest scan's barrier counts by severity, and the comparison with the scan
before it: resolved, still open, new. New is the alert — the barrier that was not there
last time. A form we have scanned only once shows everything as open and nothing as new;
a first scan has no history to have regressed from.

Every barrier shows its rule, its severity as a word, the field it is on, and the
plain-language impact sentence the scanner wrote.

## Accessibility

Zero axe violations is a requirement here, not a target. `npm run test:a11y` runs axe over
the empty state, the form list, the detail view and the load-error state, and fails the
build on any violation. It also checks the things axe cannot: that opening a form moves
focus to its heading, that Back returns focus to the row it came from, and that every
interactive control is a native focusable element.

What it does **not** cover is what a screen reader actually says. That needs a person —
see [`../probe/screen-reader-testing.md`](../probe/screen-reader-testing.md). The NVDA pass
is still outstanding.

## Numbers on the page

Only counts measured from loaded reports: forms, scans, barriers by severity, and the
size of each comparison bucket. There are no illustrative statistics anywhere, including
in the pitch copy, and the pricing section deliberately carries no figure — that belongs
on a slide where it can be defended.
