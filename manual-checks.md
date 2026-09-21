# BRIDGE: manual checks

The seven checks the automated suite cannot do (`bridge-user.md` §8.8). Do them in this
order: each one uses the setup of the one before. Allow about two hours in total.

Every check ends with **Write down** and **If it fails**. "Tell Claude" means paste the
quoted text back into the session; most failures here have a known, small fix.

| # | Check | Time | Blocks the video? |
|---|---|---|---|
| 1 | Focus spike | 10 min | Yes |
| 2 | Alt+Shift+S from a real keyboard | 10 min | Yes |
| 3 | Screenshot crop for label inference | 10 min | Yes, if the demo shows inference |
| 4 | "Always enable BRIDGE on this site" | 10 min | No |
| 5 | Export saves a file | 5 min | Yes, it hands over to the employer demo |
| 6 | VoiceOver pass with Screen Curtain | 60 min | Yes |
| 7 | LinkedIn Easy Apply by hand | 20 min | No |

On a Mac, **Alt is the Option key**. So Alt+Shift+B is Option+Shift+B.

---

## 0. Setup, once

Three terminals, all from the repo root.

**Terminal A, build the extension:**

```bash
cd extension
npm install
npm run build
```

**Terminal B, serve the test pages.** Leave it running.

```bash
cd extension
python3 -m http.server 8765 -d test/fixtures/acme
```

**Terminal C, the label-inference proxy.** Only needed for check 3. Leave it stopped for
every other check, and especially for check 7.

```bash
cd proxy
uv run --env-file ../.env uvicorn main:app --port 8000
```

**Load the extension in Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode**, top right.
3. Click **Load unpacked** and choose `extension/.output/chrome-mv3`.
4. If BRIDGE was already loaded from an earlier build, click its **reload** arrow instead.

**Check both shortcuts are bound.** Chrome only applies a suggested shortcut when an
extension is first installed, so a shortcut added in a later build is often left blank.

1. Open `chrome://extensions/shortcuts`.
2. Under BRIDGE, "Open BRIDGE" should show Alt+Shift+B.
3. "Check the answers, then move to Continue or Submit" should show Alt+Shift+S.
4. If either is blank, click its pencil and press the keys yourself.

**The three test pages:**

| Page | URL | Shape |
|---|---|---|
| Acme single page | `http://localhost:8765/apply.html` | every barrier on one form |
| Acme employer demo | `http://localhost:8765/`, `/?v=2`, `/?v=3` | one small form in three versions, for the monitor and dashboard. Not used by these checks |
| Acme dialog | `http://localhost:8765/modal.html` | LinkedIn Easy Apply: steps swap in place |
| Acme journey | `http://localhost:8765/steps/1.html` | Workday: each step is a full page load |

Always use `localhost`, not `127.0.0.1`. The single page embeds a `127.0.0.1` frame on
purpose, as the frame BRIDGE is not allowed to reach.

**Where Diagnostics is.** At the very bottom of the side panel there is a collapsed
**Diagnostics** section. Scroll the panel down with the mouse wheel and click the word
**Diagnostics** to expand it, then read what BRIDGE recorded. The same lines are in the
panel's console: right-click the panel, Inspect.

---

## 1. Focus spike

**Question:** when Alt+Shift+B opens the panel, does keyboard focus move into it?
Chrome's documentation does not say. The answer decides the first spoken line of the demo.

There are two cases, and they can have different answers. Run both.

**Case A, the panel is closed.** This is the demo's opening.

1. Open `http://localhost:8765/apply.html`. **Close the side panel** with its X if it is open.
   Pressing the shortcut while the panel is already open shows nothing new, so it says
   nothing about what happens on open.
2. Click once inside the page's **Full name** field, so focus is clearly in the page.
3. Press **Alt+Shift+B**. Do not touch the mouse again. Wait for the panel to finish scanning.
4. Press **Tab** once, then type `abc`.
5. Look at where focus went. BRIDGE puts focus on its own "BRIDGE" heading when it opens,
   and a heading swallows typed letters, so typing alone cannot tell the two cases apart.
   Tab can:
   - **Panel has focus:** the focus ring moves to the first button in the panel's barrier
     list, and the letters go nowhere.
   - **Page has focus:** the ring moves to the page's Phone field, and `abc` appears in it.
   **Result, 2026-09-21, Chrome 154 on macOS: the panel has focus.**

**Case B, the panel is already open and focus is in the page.** This is how a user gets
back to the panel after working in the page.

6. Leave the panel open. Click in the page's **Full name** field. Press **Alt+Shift+B**.
   *Expect:* the panel closes and opens again, and rescans. An open panel cannot take
   keyboard focus from the page (measured 2026-09-21), only a panel that is being shown can,
   so the shortcut reopens it.
7. Without touching the mouse, press **Tab**, then type `abc`. Read the result the same way
   as step 5: the focus ring should move inside the panel.
   If focus stays in the page, the fallback is Chrome's own pane key on macOS:
   **Cmd+Option+Down arrow**, four presses (address bar, tabs, extensions, panel). F6 is
   Chrome's pane key on Windows and Linux only; on a Mac it does nothing.
8. Close the panel. Turn VoiceOver on (**Cmd+F5**). Repeat steps 2 and 3 of case A.
9. Listen to what is spoken when the panel opens.

**Write down**

- Case A, after Tab, focus was in: page / panel / neither.
- Case B, after Tab, focus was in: page / panel / neither. Whether Cmd+Option+arrows helped.
- What VoiceOver said when the panel opened.

**What the answer means**

| Result | What follows |
|---|---|
| Case A: Tab moves inside the panel, and VoiceOver reads "BRIDGE, heading level 1" then the summary | One keypress opens the demo. §4 stands as written |
| Case A: Tab moves in the page | Tell Claude. The opening flow needs a different design before recording |
| Case B: the panel does not reopen, or Tab still moves in the page | Tell Claude which. The way back is then Cmd+Option+Down arrow four times, and the panel has to say so |

Record the result in `bridge-user.md` §10, under the open question about panel focus.

---

## 2. Alt+Shift+S from a real keyboard

**Questions:** does the shortcut fire at all, and does focus really leave the side panel
and land on the page's button? The suite proved the logic by sending the same internal
message the shortcut sends. It could not press keys or observe real keyboard focus.

The command has a gate. The **first** press on a step reads everything back. Only the
**second** press moves focus. Any write in between closes the gate again.

1. Open `http://localhost:8765/apply.html` and press **Alt+Shift+B**.
2. Put focus **in the panel**, by whatever check 1 found works.
3. Press **Alt+Shift+S**.
4. Expect the live region at the top of the panel to say either "Nothing has been filled
   yet." or "Your application contains: …", ending with
   "Press Alt+Shift+S to move to the Submit application button."
5. Confirm focus did **not** move. It should still be in the panel.
6. Press **Alt+Shift+S** again.
7. Expect: "Focus is on the Submit application button on the page. Pressing it submits
   your application. BRIDGE never presses it."
8. The decisive test: without clicking anything, press **Enter**.
9. Look at the page. Under the Submit button it should now say
   **"Submitted (test page, nothing sent)."** That proves real keyboard focus was on the
   page's button. If that text does not appear, focus never left the panel.
10. Reload the page and repeat steps 3 to 9 with focus starting **in the page** instead.
11. Open `http://localhost:8765/modal.html`, click **Easy Apply**, and repeat steps 3 to 7.
    The button named should be **Next**, and the second announcement should say
    "Pressing it moves to the next step."

**Write down**

- First press: what was announced, and whether focus stayed put.
- Second press: what was announced.
- After Enter: did "Submitted (test page, nothing sent)." appear? From the panel? From the page?

**If it fails**

| Symptom | Cause and action |
|---|---|
| Nothing happens, or a text field gets an "Í" | The shortcut is not bound. Go back to `chrome://extensions/shortcuts` |
| The panel opens but nothing is announced | That press opened the panel, which was closed. Press again once it has finished scanning |
| Announcements are right but Enter does nothing on the page | `focus()` in the page cannot pull keyboard focus out of the side panel. Tell Claude. The move to the page then needs a different design, and §6.5 changes. F6 is not an answer on macOS |

---

## 3. Screenshot crop for label inference

**Question:** does the panel's own screenshot-and-crop work under the `activeTab` grant that
only a real shortcut press gives? Already proven separately: the proxy reads a crop
correctly, and the extension reaches DeepSeek through the proxy. What is unproven is
`captureVisibleTab` plus the crop inside the panel.

1. Start the proxy in Terminal C. Wait for "Application startup complete".
2. Open `http://localhost:8765/apply.html` in a **fresh tab**. Keep that tab in front.
3. Open the panel with **Alt+Shift+B**. That press is what grants `activeTab` for this
   tab. The toolbar icon should grant it too, but only the shortcut is the path the demo
   uses, so test that one.
4. Watch the page. It will scroll by itself twice while BRIDGE photographs two controls.
5. Within about five seconds, switch the panel to **Full list** and look at questions 3 and 4.
6. Expect question 3 to read something like **"LinkedIn profile URL (label inferred)"** and
   question 4 **"Preferred office (label inferred)"**. The words come from the model, so
   small differences are fine. Before inference both say "Unlabelled … (label inferred)".
7. Open **Diagnostics**. Under "Label inference" expect **"2 labels inferred"** and no line
   containing "no crop".
8. Look at Terminal C. Expect a line like
   `infer-labels request: fields=2 crops=2 ids=[...]` followed by `response: labels=2`.
   The log must show only ids and counts, never text.

**Then check the privacy rule**, that a field holding an answer is never photographed:

9. On the page, type anything into the unlabelled box under the "LinkedIn profile URL" picture.
10. Close the side panel and open it again with **Alt+Shift+B**.
11. In Diagnostics expect `no crop (control is filled or not visible)` and
    `not sent (nothing to infer from)` for that field, and Terminal C to show `fields=1`.

**Write down**

- The two inferred labels, word for word.
- The "Label inference" lines from Diagnostics.
- The request line from Terminal C, both times.

**If it fails**

| Symptom | Cause and action |
|---|---|
| Spoken: "Label inference is unavailable … not reachable" | The proxy is not running, or something else holds port 8000 |
| Diagnostics: `no crop (Error: Either the '<all_urls>' or 'activeTab' permission is required.)` | The panel was not opened by the shortcut on this tab, or the tab has since navigated to another site. Close the panel and reopen it with Alt+Shift+B |
| Diagnostics: `no crop (not the top frame of the visible tab)` | The Acme tab was not the one in front when the panel scanned |
| Any other `no crop (Error: …)` | Copy the whole line and tell Claude |
| The label is wrong or is a fragment | The crop rectangle is off. Tell Claude the label you got. Screen scaling is the usual cause |

Stop the proxy when you are done (Ctrl+C in Terminal C).

---

## 4. "Always enable BRIDGE on this site"

**Question:** does Chrome's permission prompt appear from the side panel, and does the site
then behave like the built-in list? Headless Chrome cannot click that prompt.

Use `https://httpbin.org/forms/post`. It is a plain https form on a site outside BRIDGE's
built-in list, and submitting it harms nothing. The button is only offered on **https**
sites, so it never appears on the localhost pages.

1. Open `https://httpbin.org/forms/post`.
2. Press **Alt+Shift+B**. BRIDGE scans using the one-time grant of the shortcut.
3. Expect the pre-check to list the form's questions.
4. Under the barrier list, next to "Scan the page again", find
   **"Always enable BRIDGE on this site"**.
5. Activate it. Chrome shows a prompt: BRIDGE wants to read and change your data on
   httpbin.org.
6. Click **Deny** first.
7. Expect: "BRIDGE was not enabled on this site. Nothing changed." The button stays.
8. Activate the button again and click **Allow**.
9. Expect: "BRIDGE is now always enabled on httpbin.org. It will scan this site's
   application pages as they load." The button disappears.
10. **Prove it stuck.** Close the side panel. Reload the page. Do not press the shortcut.
    Wait two seconds: the announcement is written one second after the page settles.
11. Open DevTools on the page (Cmd+Option+J) and run:

    ```js
    document.getElementById('bridge-announcement')?.textContent
    ```

12. Expect "BRIDGE found N accessibility barriers on this form. Press Alt+Shift+B to open
    BRIDGE." That text only exists if BRIDGE's content script ran on load, by itself.
13. Open `chrome://extensions`, BRIDGE, **Details**, **Site access**. `httpbin.org` should
    be listed.
14. Turn VoiceOver on and repeat steps 1 to 9 on a different https form. Listen to whether
    Chrome's prompt is announced and whether Allow and Deny can be reached by keyboard.

**Write down**

- Did the prompt appear? Its exact wording.
- The text from step 11.
- With VoiceOver: was the prompt announced, and could you answer it without the mouse?

**If it fails**

| Symptom | Cause and action |
|---|---|
| The button is not there | The site is http, already granted, or in the built-in list |
| Spoken: "BRIDGE could not be enabled on this site. Error: This function must be called during a user gesture" | Tell Claude. The click handler lost the gesture |
| Step 11 returns `undefined` after Allow | The content script was not registered. Tell Claude, with any error from the service worker console (`chrome://extensions`, BRIDGE, "service worker") |

**Clean up:** in BRIDGE's Details, Site access, remove httpbin.org.

---

## 5. Export saves a file

**Question:** does a download started inside the side panel actually land on disk? The
suite proved the content of the report. It ran the panel as an ordinary tab, not as a
real side panel.

1. Open `http://localhost:8765/modal.html` and press **Alt+Shift+B**.
2. Click **Easy Apply** on the page. Wait for "Step 1 of 3".
3. Click **Next** on the page. Wait for "Step 2 of 3". This gives the report two steps.
4. In the panel, scroll to **Barrier report**.
5. Activate **"Export barrier report as JSON"**.
6. Expect: "Barrier report saved as localhost-8765-modal-html-….json. N barriers. It contains
   none of your answers and nothing about you."
7. Open your Downloads folder. The file name starts with `localhost-8765-modal-html-`, the
   same naming the monitor uses.
8. Open the file and check:
   - `portal` is `localhost:8765` and `pagePath` is `/modal.html`.
   - `steps` has two entries, each with its own `barriers`.
   - Step 2's `barriers` contains `options-identically-named` with the visa question as `label`.
   - Step 2's `pageBarriers` contains `upload-unnamed`, with no `label`.
   - No barrier has a `selector`.
   - Nothing you typed appears anywhere in the file.
9. Activate **"Export barrier report as Markdown"** and check that a `.md` file lands too.
10. If the employer dashboard exists by now, load the JSON into it
    (`bridge-business.md` §6.4).

**Write down**

- Both file names, as they appear on disk.
- Whether the announcement was spoken.

**If it fails**

Nothing lands in Downloads, or Chrome asks something unexpected: tell Claude. A page cannot
detect a blocked download, so the fix is to move the save into the service worker with
Chrome's downloads API. That adds one permission to the manifest.

---

## 6. VoiceOver pass with Screen Curtain

**Question:** can someone who cannot see the screen complete the form through BRIDGE?
This is the pass that decides whether the product works. Method and key reference are in
`probe/screen-reader-testing.md`. This section is the BRIDGE-specific script.

### Before you start

1. **System Settings, Keyboard, turn on Keyboard navigation.** Without it Tab skips
   dropdowns and buttons, and good controls look broken.
2. **Cmd+F5** turns VoiceOver on.
3. **Control+Option+Cmd+F10** opens the caption panel. Every announcement appears as text
   you can screenshot. Keep it on for the whole pass.
4. Do one run **with the screen on** to learn the flow. Findings from this run do not count.
5. **Control+Option+Shift+F11** turns on Screen Curtain. The display goes black. Every
   finding below comes from a run with the curtain on.

If a function-key shortcut does nothing, add **Fn**.

### Run A: the single page, following §9

Open `http://localhost:8765/apply.html`. For each step write down what was spoken, or screenshot the
caption panel.

1. **The page on its own.** Tab through the form without BRIDGE.
   *Expect:* the education dropdown and the slider are never reached, both visa options
   speak the question and never "Yes" or "No", and the CV control is never reached.
   *This is the "before" footage for the demo.*
2. **On load.** Reload and wait two seconds without pressing anything.
   *Expect:* "BRIDGE found 12 accessibility barriers on this form. Press Alt+Shift+B to open BRIDGE."
   *If silent:* the page's live region is not being spoken. Tell Claude.
3. **Open.** Press **Alt+Shift+B**.
   *Expect:* "BRIDGE, heading level 1", then "13 questions found. 13 accessibility
   barriers, 9 blocking."
4. **Find your way by heading.** **Control+Option+U** opens the rotor. Choose Headings.
   *Expect:* BRIDGE; Application pre-check; Questions; Question 1 of 13; Check what the
   page contains; Barrier report.
5. **The barrier list.** Tab through it.
   *Expect:* each field barrier is a button that speaks its severity and sentence.
   Activating one moves you to that question.
6. **"How to answer".**
   *Expect:* a group named "How to answer" with two radio buttons, "One question at a
   time" selected.
7. **One question at a time.** Tab from the mode group onward.
   *Expect:* only **one** question is reachable. The other twelve must not be spoken at all.
8. **Full name.** Type a name. Tab to **"Write Full name to page"**. Press Space.
   *Expect:* "Full name: … Confirmed on the page. Next: Phone." and focus on the Phone box.
9. Use **"Next question"** to reach each of these. Write down the announced name and role.

   | Question | Panel control | Listen for |
   |---|---|---|
   | Highest education completed | pop-up button | "(label inferred)" is spoken. Five options |
   | Years of experience | number field | whether 0 to 10 is announced |
   | The visa question | radio group | the question is spoken as the group's name, the options as **"Yes"** and **"No"** |
   | Language skills | checkbox group | the group's name is "Language skills" |
   | Earliest start date | date field | Chrome's date field has three parts. Note whether you could set all three |
   | CV, "Drag and drop your CV here" | file button | Space opens the macOS file picker. Note whether you could choose a file with the curtain on |
   | Notice period | text field | after Write: **"Could not fill Notice period."** plus the reason |
   | I agree to the privacy notice | checkbox | |

10. **VERIFY.** Activate "Read back everything from the page".
    *Expect:* "Your application contains: …", then the empty questions by name, then
    "Press Alt+Shift+S to move to the Submit application button."
11. **Forward.** Press **Alt+Shift+S** twice, as in check 2.

### Run B: step changes, the most important question of the pass

Open `http://localhost:8765/modal.html` and open BRIDGE.

1. Move focus **into the page** and activate **Easy Apply**.
2. **Listen.** "Step 1 of 3: Contact info. 3 questions found…" comes from the *panel's* live
   region while your focus is in the *page*.
3. Activate **Next** on the page. Listen for "Step 2 of 3: Additional questions."
4. Do it once more with your focus **in the panel**, pressing Next with the mouse.

Write down, for each case: **was the step change spoken?**

VoiceOver may not speak a live region in a pane that does not have focus. If the step
change is silent while focus is in the page, that is the single most valuable finding of
this pass. Tell Claude. The fix is to make the same announcement from the status region
BRIDGE already injects into the page.

5. On step 1, choose **Yes** for the referral question on the page.
   *Expect:* "2 new questions appeared: Referrer name, Referrer email."

### Run C: the full-page journey

Open `http://localhost:8765/steps/1.html`, open BRIDGE, then activate **Save and Continue**
on the page. Expect "Step 2 of 3: My Experience. Next: Review." with nothing reopened.

### What counts as a failure

| You hear | It means |
|---|---|
| "edit text, blank" or "button" with no name | A control in the panel has no label. Ours to fix |
| Silence after a write | The confirmation was not spoken |
| The same sentence for two different buttons | Identical accessible names, the defect we report on other people's forms |
| Focus lands somewhere you did not expect | Note where. Focus management is ours to fix |
| A question you cannot answer with the curtain on | Blocking. Note which and why |

Give Claude the list. Fix, rebuild, reload the extension, run the pass again.

### NVDA

Spec §6.6 names NVDA on Windows, and this machine cannot run it. Until that pass is done,
the video and the pitch say: **"tested with VoiceOver on macOS; the NVDA pass is pending."**
Passing VoiceOver does not discharge it. The NVDA notes are in `probe/screen-reader-testing.md`.

---

## 7. LinkedIn Easy Apply by hand

**Question:** does the built extension do on the real thing what it does on the fixture:
announce silent step changes, and turn the visa question into an answerable group?

**Rules. These are not optional.**

- Your own logged-in browser, by hand. No scripts, no Playwright. Automating LinkedIn
  breaches its User Agreement and risks your account (`probe/README.md`).
- **Never press Submit application.** Stop at the read-back.
- **Stop the proxy first** (Terminal C, Ctrl+C). With it running, BRIDGE would send a
  picture of any unlabelled control on your logged-in LinkedIn page to DeepSeek. With it
  stopped, BRIDGE says once that label inference is unavailable, and nothing leaves the machine.
- Use a posting you would not mind having a saved draft on.

**Steps**

1. Stop the proxy.
2. On LinkedIn, search jobs with the **Easy Apply** filter on. §11 walked Univers (4 steps)
   and Binance (10 steps). Any posting whose flow asks about visa sponsorship will do.
3. Open the job and press **Alt+Shift+B**. LinkedIn is in the built-in list, so no
   permission prompt is expected.
4. Click **Easy Apply** on the page.
5. Expect BRIDGE to announce "Step 1 of N: Contact info", or whatever that step's own
   heading is, and to list only the dialog's fields. The job search box behind the dialog
   must **not** be listed.
6. Do not retype your contact details. Activate "Read back everything from the page" and
   check that BRIDGE reads the prefilled values **from the page**.
7. Click **Next** on the page. Expect "Step 2 of N: …". Note each step's announcement.
8. Keep going until the step with
   *"Will you now or in the future require sponsorship for employment visa status?"*
9. In the panel, check:
   - The barrier list shows **"All 2 options for … sound identical to a screen reader. The
     words "Yes" and "No" are never spoken."**
   - The question is a group whose name is the question, with options **Yes** and **No**.
10. Choose an answer in the panel and activate its **Write** button.
11. Expect "… Confirmed on the page", and the matching radio selected in LinkedIn's dialog.
12. With VoiceOver on, Tab to the same two radios in LinkedIn's own dialog and listen. That
    is the "before". The panel's group is the "after". This pair is the headline demo.
13. Activate "Read back everything from the page".
14. **Stop here.** Close the dialog with its X and choose **Discard**.
15. In the panel, export the barrier report as JSON. Open the file and confirm it contains
    no answers, no name and no email.

**Write down**

- The posting's employer and its number of steps.
- Each step's announcement, word for word.
- Whether the search box behind the dialog leaked into the question list.
- Whether the write landed on the visa radios.
- The "Scan (…)" lines from Diagnostics, one per step: each records the verdict and what
  it was based on (`step-index` or `field-similarity`).
- Anything announced as "Could not fill".

**If it fails**

| Symptom | Cause and action |
|---|---|
| The panel lists the search page's fields, not the dialog's | The dialog was not recognised as the form. In DevTools, copy the dialog's opening tag (its tag name, `role`, `aria-modal`) and tell Claude |
| No announcement on Next | Open Diagnostics. If there is no new "Scan (form-changed)" line, the change was never detected. If there is one saying `verdict=fields-changed`, copy that line: the step index was not read |
| "Could not fill" on the visa radios | Copy the reason. §11 verified this exact write with the probe, so this would be a regression |
| LinkedIn shows a "something went wrong" banner or logs you out | Stop. Do not retry. Tell Claude what you did just before |

Add what you found to `bridge-user.md` §11, dated.
