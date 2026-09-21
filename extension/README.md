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

It loads the built extension, opens the side panel as an ordinary page pointed at the test
tab (`sidepanel.html?tabId=…`), and drives SCAN → TRANSLATE → ACT → VERIFY against
`test/fixtures/acme`. That page reproduces barriers measured on real portals: a custom
dropdown with no role, label or tab stop whose options exist only when open, and
LinkedIn's Yes/No radios that both carry the question as their accessible name. It also
has a field that throws away BRIDGE's write, to prove failures are reported rather than
hidden.

It does **not** cover opening the panel, focus handling, or anything a screen reader
says. Those need a person — see [`../probe/screen-reader-testing.md`](../probe/screen-reader-testing.md).

## v0 limits

- Top frame only. Per-frame routing for embedded ATS iframes is day 2.
- Full-list mode only; the one-question-at-a-time mode (§4.2) is not built yet.
- No step detector, no "Step N of M" announcements, no barrier report export yet.
- No "Always enable BRIDGE on this site" button yet (§4, third tier).
- Plain DOM rather than Preact in the panel. It is small enough not to need it.
