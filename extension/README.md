# BRIDGE extension

The Chrome extension described in [`../bridge-user.md`](../bridge-user.md). Built with WXT
(Manifest V3). SCAN and ACT are ported from [`../probe/`](../probe/), where every strategy
was first tested against a live job portal.

```bash
npm install
npm run build        # -> .output/chrome-mv3
npm run test:e2e     # builds, then runs the end-to-end test headlessly
npm run typecheck
npm run dev          # WXT dev mode with reload
```

## Load it in Chrome

1. `npm run build`
2. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose
   `extension/.output/chrome-mv3`
3. Serve the test page: `python3 -m http.server 8765 -d test/fixtures/acme`, then open
   `http://localhost:8765`
4. Press **Alt+Shift+B**. If Chrome says the shortcut is taken, set it at
   `chrome://extensions/shortcuts`

## Day-1 spike: does focus move into the side panel?

The spec (§4) assumes that opening the panel moves keyboard focus into it. Chrome's
documentation does not say whether an extension can do that, and nothing automated can
answer it. Please run this by hand:

1. Load the extension and open the Acme page as above. Click once in the page's
   "Full name" field so focus is in the page.
2. Press **Alt+Shift+B**.
3. **Without touching the mouse**, start typing. Where do the characters go — into the
   page's field, or nowhere?
4. Open **Diagnostics** at the bottom of the panel and read the lines. "panel has keyboard
   focus: yes/no" is the answer. They are also in the panel's console: right-click the
   panel → Inspect.
5. If focus stayed in the page, press **F6** repeatedly (on a Mac, **Fn+F6**). Chrome uses it
   to cycle focus between the address bar, the page and other panes. Note whether it ever
   lands in the panel, and after how many presses.
6. Repeat with a screen reader on. What is spoken when the panel opens?

Record the answers in spec §10. If focus does not move, §4's opening flow changes: BRIDGE
would announce "BRIDGE is open. Press F6 to reach it" from the page instead.

## What the end-to-end test covers

`npm run test:e2e` loads the built extension, opens the side panel as an ordinary page
pointed at a test tab (`sidepanel.html?tabId=…`), and drives it against the pages in
`test/fixtures/acme`. 98 checks:

- `index.html`: every barrier in spec §6.2 that a page can show, each write strategy in
  §6.3 including the pointer-only slider, the Ashby-shaped uploader, a checkbox group, a
  custom date picker, a field inside a closed shadow root, a field the page re-renders at a
  new path, a field inside a same-origin iframe, an unreachable `127.0.0.1` iframe, a field
  that throws the write away, a full page reload, both answer modes, the on-load
  announcement, and zero axe violations on the panel.
- `modal.html`: LinkedIn Easy Apply's shape. Steps swapped in place inside a native
  `<dialog>`, conditional fields, step announcements, the Alt+Shift+S gate, CV reuse on a
  later step, the session in `storage.session`, and the exported report.
- `steps/1.html` to `3.html`: Workday's shape. Every step a full navigation that destroys
  the content script.
- `uploaders.html`: three file inputs that differ only in whether a keyboard can reach
  them. The rule's verdicts are checked against real Tab presses.
- Label inference against a **stub** of the proxy on port 8000, clearly labelled in the
  test, including the check that nothing the applicant entered is in the request. The suite
  fails at startup if something else is already listening on 8000, so stop the real proxy
  first.

It does **not** cover: opening the panel with the shortcut, where keyboard focus goes,
anything a screen reader says, Chrome's permission prompt for "Always enable BRIDGE on
this site", the screenshot crop for label inference (it needs the `activeTab` grant of a
real shortcut press), or whether the exported file lands on disk. Those need a person; the
list is in spec §8.8, and the method in
[`../probe/screen-reader-testing.md`](../probe/screen-reader-testing.md).

## Label inference

Fields that nothing on the page names are sent to the proxy in [`../proxy/`](../proxy/)
at `http://localhost:8000`. Without it running, BRIDGE says once that label inference is
unavailable and carries on with "Unlabelled text".

```bash
cd ../proxy && uv run --env-file ../.env uvicorn main:app --port 8000
```

## Known limits

- The on-load announcement counts what the top frame can see. The panel may report one
  more barrier: a cross-origin frame that only it can know is unreachable.
- A slider that does not publish a range (`aria-valuemin/max`, `min/max` or `data-min/max`)
  is offered as a plain number and reported as "Could not fill".
- Group options are re-found by their own path only. A framework that re-renders a radio
  group at a new path produces "Could not fill", never a wrong write.
- Subframe fields are listed after the top frame's, not interleaved in visual order.
