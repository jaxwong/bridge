# Demo rehearsal

Run this once tonight and once on demo morning. Tick each box, and note anything that looks wrong at the step
where you saw it.

## A. Set up (once per machine, about 5 minutes)

- [ ] 1. Stop anything on the test ports: stop `make serve` and `make proxy` with Ctrl+C in their terminals.
- [ ] 2. Refresh the seed and build the extension in one go, from the repo root:
  ```bash
  make demo-seed
  ```
  It must end with `214/214 passed`. This rewrites `dashboard/src/demo-seed.json` with today's date and rebuilds
  `extension/.output/chrome-mv3`.
- [ ] 3. Chrome → `chrome://extensions` → reload BRIDGE (the circular arrow). If it is not loaded yet: Developer mode →
  Load unpacked → `extension/.output/chrome-mv3`.
- [ ] 4. `chrome://extensions/shortcuts`: check that **Alt+Shift+B** and **Alt+Shift+S** are bound to BRIDGE.

## B. Start the servers (three terminals, leave them running)

- [ ] 5. Terminal 1: `make serve` (the Acme form on http://localhost:8765).
- [ ] 6. Terminal 2: `make proxy` (label inference; needs `.env`). **Optional.** Without it, BRIDGE says "Label
  inference is unavailable, so 2 questions have no name" and still works. With it, those two questions get names. The
  dashboard shows the same findings either way.
- [ ] 7. Terminal 3: `cd dashboard && npm run dev`, then open **http://localhost:5173** in a **separate Chrome window**.
  Check that it shows one row, `localhost:8765/apply.html`, with **9 blocking, 4 usability** and today's date.
  Leave that window behind the applicant window.

## C. The applicant part (window 1)

- [ ] 8. Open http://localhost:8765/apply.html ("Junior Analyst — Apply").
- [ ] 9. Press **Alt+Shift+B** to open the BRIDGE side panel. It should say "13 questions found. 13 accessibility
  barriers, 9 blocking."
  *Talking point:* the 9 here is the same 9 the employer will see.
- [ ] 10. Answer every question in the panel **except Referral code**, which stays empty. Notice period now keeps its
  answer; the version that throws it away is only at `apply.html?discard`, for the tests. **Full name is required**: if
  it is empty, the page refuses the submit and BRIDGE says the page has not moved on.
- [ ] 11. Press **Read back everything from the page**. Check that the answers read back correctly, and that exactly
  one question is empty: Referral code.
- [ ] 12. Press **Submit my application**, then **Yes, submit now**.
- [ ] 13. The page goes to the confirmation, and you hear/see "Application received".

## D. The employer part (window 2)

- [ ] 14. Switch to the dashboard window. *Narration:* "Acme subscribes to BRIDGE, so the report arrived when the
  application was submitted."
- [ ] 15. Press **localhost:8765/apply.html** in the table. Focus moves to the form's heading.
- [ ] 16. Scroll through the **Open (13)** list. Each finding shows its severity, rule, field, impact sentence,
  **Suggested fix** and WCAG criteria. Good ones to point at:
  - `drag-drop-only`: the CV uploader. "Keep the drop zone, and add a Choose file button…"
  - `custom-dropdown-no-role` on "Highest education completed": "Use a native select…"
  - `options-identically-named` on the sponsorship question
- [ ] 17. End on the summary box: "Measured against WCAG 2.2, Level AA… Human review is required for a WCAG conformance
  claim." Say "automated WCAG findings", never "compliant".

## E. What to watch for while rehearsing

- [ ] The date on the dashboard is today (redo step 2 if not).
- [ ] The fix sentences read well aloud. If any sounds wrong, change it in `extension/lib/rules.ts`, then redo step 2.
  The test fails until the seed matches again.
- [ ] Font size on the projector: zoom the dashboard window (Cmd +) before the demo, not during.
- [ ] The dashboard names the form `localhost:8765/apply.html`. That is the real address; say "Acme's application form".
- [ ] Don't open the file upload or the dashboard code for a judge. There is no send; the report on screen was captured
  ahead of time (the page says so at the bottom).

## F. Backup

- [ ] Record one full clean run (steps 8–17) as a video, in case something fails live.
- [ ] If the dashboard ever shows a blank page, the seed failed its check. Run `cd dashboard && npm test` to see why,
  then redo step 2.
