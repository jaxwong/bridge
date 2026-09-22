# BRIDGE: manual checks

The seven checks the automated suite cannot do (`bridge-user.md` §8.8). Do them in this
order: each one uses the setup of the one before. Allow about two hours in total.

Every check ends with **Write down** and **If it fails**. "Tell Claude" means paste the
quoted text back into the session; most failures here have a known, small fix.

| # | Check | Time | Blocks the video? |
|---|---|---|---|
| 1 | Keyboard focus and the panel | done | Yes |
| 2 | Alt+Shift+S presses Next; submitting needs your confirmation | 10 min | Yes |
| 3 | Screenshot crop for label inference | 10 min | Yes, if the demo shows inference |
| 4 | "Always enable BRIDGE on this site" | 10 min | No |
| 5 | Export saves a file | 5 min | Yes, it hands over to the employer demo |
| 6 | VoiceOver pass with Screen Curtain | 60 min | Yes |
| 7 | LinkedIn Easy Apply by hand | 20 min | No |

**Status, 2026-09-22.** Check 1 is done, including what VoiceOver speaks on open. A phone
number in a spoken confirmation was heard digit by digit, by hand. Check 2 changed the
design twice (BRIDGE now presses Next, and submits only after a confirmation in the panel),
and a first pass by hand found three more things, all fixed and covered by the suite but
not yet re-run by hand: the forward press is also a button; a read-back straight after a
Yes that reveals questions was missing them, and the gate stayed open; Back gave a blank
step. Steps 3, 5 and 8 below are the ones to repeat. Checks 3 to 7 have not been started.

On a Mac, **Alt is the Option key**. So Alt+Shift+B is Option+Shift+B.

---

## 0. Setup, once

Three terminals, all from the repo root. The repo Makefile wraps these same commands:
`make build`, `make serve`, `make proxy` — and `make test` runs every automated user-side
check before a manual pass.

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
3. "Check the answers, then press Continue or get Submit ready" should show Alt+Shift+S.
4. If either is blank, click its pencil and press the keys yourself.

**The three test pages:**

| Page | URL | Shape |
|---|---|---|
| Acme single page | `http://localhost:8765/apply.html` | every barrier on one form |
| Acme employer demo | `http://localhost:8765/`, `/?v=2`, `/?v=3` | one small form in three versions, for the monitor and dashboard. Not used by these checks |
| Acme dialog | `http://localhost:8765/modal.html` | LinkedIn Easy Apply: steps swap in place |
| Acme journey | `http://localhost:8765/steps/1.html` | Workday: each step is a full page load |
| Acme stuck | `http://localhost:8765/stuck.html` | a Next button that refuses to advance |

Always use `localhost`, not `127.0.0.1`. The single page embeds a `127.0.0.1` frame on
purpose, as the frame BRIDGE is not allowed to reach.

**Where Diagnostics is.** At the very bottom of the side panel there is a collapsed
**Diagnostics** section. Scroll the panel down with the mouse wheel and click the word
**Diagnostics** to expand it, then read what BRIDGE recorded. The same lines are in the
panel's console: right-click the panel, Inspect.

---

## 1. Keyboard focus and the panel

**Done on 2026-09-21 and 2026-09-22, Chrome 154 on macOS.**

What was found, by hand:

| Question | Answer |
|---|---|
| Does a panel opened by Alt+Shift+B take keyboard focus? | **Yes.** Tab moves inside the panel. Focus starts on the "BRIDGE" heading, which swallows typed letters, so Tab is the way to tell |
| Can a panel that is already open take focus back from the page? | **No**, not by any call BRIDGE can make. So Alt+Shift+B now closes an open panel and shows it again, which does take focus. Checked by hand: it reopens and Tab moves inside it |
| Can the page take focus from the panel? | **No.** See check 2, which changed the design because of it |
| Chrome's own pane key | F6 does nothing on macOS. Cmd+Option+Down arrow, or Up, reaches the other pane in four presses. Nothing in BRIDGE depends on it |
| What does VoiceOver say when the panel opens? | **The whole panel once, top to bottom, in order** (2026-09-22, with the fixes on `main`). Nothing is announced over the reading |

The reopen reloads and rescans the panel, but it costs no answers (since 2026-09-22):
everything typed in the panel is kept as a draft in session storage and put back if the
page is still on the same step, and BRIDGE says "Back in BRIDGE. Your answers are kept.
You were on question N of M." Everything written is on the page and is read back from
there. Only a draft from a step the page has since left is dropped, which was always
the rule for unwritten answers.

**To repeat the check after any change to the shortcuts**

1. Open `http://localhost:8765/apply.html`. Close the side panel with its X.
2. Click in the page's **Full name** field. Press **Alt+Shift+B**, wait for the scan, then
   press **Tab**. *Expect:* the focus ring is on the panel's "Scan the page again" button.
   If `abc` typed now lands in the page's Phone field, focus stayed in the page: tell Claude.
3. Leave the panel open. Type into a panel question box without writing it. Click in the
   page's **Full name** again. Press **Alt+Shift+B**, then **Tab**.
   *Expect:* the panel closes, reopens and rescans; the focus ring is inside it; what you
   typed is back in its box; VoiceOver users hear "Back in BRIDGE. Your answers are kept…".

4. Close the panel. Turn VoiceOver on (**Cmd+F5**). Click in **Full name**, press
   **Alt+Shift+B**, and listen. *Expect:* "BRIDGE, heading level 1"; with VoiceOver's
   default settings it then reads the whole panel once, in order — the summary is heard
   there, once, and nothing is announced over the reading. **Control** stops it (check 6,
   "Before you start", explains the setting).

Reopening with saved answers, under VoiceOver, is check 6 Run D.

---

## 2. Alt+Shift+S from a real keyboard

**Settled on 2026-09-21, Chrome 154 on macOS:** the shortcut fires, and nothing moves
keyboard focus from the side panel to the page. Not `focus()` in the page, not the tabs or
windows APIs, not closing the panel. Chrome's pane key does, in four presses. So the design
changed (`bridge-user.md` §6.5): BRIDGE presses a Next or Continue button itself. It submits
only from its own "Submit my application" button, after a confirmation. The shortcut never
submits. This check is now about that behaviour.

The command has a gate. The **first** press on a step reads everything back. Only the
**second** press acts. Any write in between closes the gate again.

1. Rebuild and reload the extension. Close the side panel. Open
   `http://localhost:8765/modal.html` and activate **Easy Apply** on the page, as a user
   already on the page would.
2. Press **Alt+Shift+B**. Focus is now in the panel. Do not touch the mouse from here.
3. Press **Alt+Shift+S**. *Expect:* "Nothing has been filled yet." or "Your application
   contains: …", ending "Press Alt+Shift+S again and BRIDGE presses the Next button, which
   moves to the next step. The same press is a button after this read-back." The page must
   still show step 1. With VoiceOver on, press it while VoiceOver is still reading the
   panel out: *expect* the reading to stop and the read-back to be spoken at once (it is
   now assertive; news from the page, like a step change, still waits its turn). Note
   whether the reading resumes afterwards. Tab forward from "Read back everything from the page": *expect* a
   button **"Press the Next button on the page"** right after the list. It is there only
   while the read-back is current; on step 3 it is "Submit my application" instead.
4. Press **Alt+Shift+S** again. *Expect:* the page moves to step 2, BRIDGE says "Step 2 of 3:
   Additional questions. …", and focus is on the first question in the panel.
5. Repeat steps 3 and 4 to reach step 3, but first answer something on each step: on step 1
   write an email address and type a phone number without writing it, on step 2 write the
   visa answer. Then activate **"Go back to the previous step"** in the panel. *Expect:*
   "BRIDGE pressed the Back button on the page.", then "Step 2 of 3: Additional questions. …
   What you typed here before is back in the panel.", the visa choice ticked in the panel
   and still selected on the page. Go back once more: *expect* the same sentence for step 1,
   the email and the phone number both back in their boxes, and a read-back saying the
   page holds the email and "Mobile phone number" is empty. Press **Alt+Shift+S** twice per
   step to return to step 3. (On step 1, the same button says it could not find a Back or
   Previous button.)
   Also, on step 1: choose **Yes** for the referral question in the panel, write it, and
   press **Alt+Shift+S** at once. *Expect:* the read-back lists "Referrer name" and
   "Referrer email" among the empty questions, and they are now questions in the panel.
   Then choose **No** on the page itself: *expect* the "Press the Next button" button to
   disappear, so the next Alt+Shift+S reads back rather than pressing Next.
6. On step 3 press **Alt+Shift+S** twice. *Expect after the second press:* "Focus is on the
   Submit my application button in BRIDGE. Pressing it asks you to confirm before anything
   is sent." Press **Alt+Shift+S** a few more times: the page must **never** show "Submitted".
7. Press **Space** on "Submit my application". *Expect:* "Submit your application to
   localhost:8765? N questions on this step are empty: <their names>. This cannot be
   undone.", with focus on **Cancel**. The empty questions are named, and "on this step"
   is said because read-back cannot see the steps the page has already replaced — use
   "Go back to the previous step" to re-check those.
   Press Space: "Nothing was submitted." Press "Submit my application" again, Tab back to
   **"Yes, submit now"**, press Space. *Expect:* "BRIDGE pressed the Submit application button
   on the page, as you confirmed.", and the page shows "Submitted (test page, nothing sent)."
   (`modal.html` shows that line in place. `apply.html` goes to an "Application received" page.)
8. Open `http://localhost:8765/stuck.html`, whose Next button refuses to advance. Press
   **Alt+Shift+B**, then **Alt+Shift+S** twice. *Expect:* "BRIDGE pressed the Next button on
   the page.", and three seconds later "The page has not moved on since BRIDGE pressed Next. …"

**Write down**

- Whether each second press moved the page on, and what was announced.
- On step 3: that nothing was submitted until you chose "Yes, submit now".
- Whether the confirmation question was spoken, and where focus was.

**If it fails**

| Symptom | Cause and action |
|---|---|
| Nothing happens, or a text field gets an "Í" | The shortcut is not bound. Go back to `chrome://extensions/shortcuts` |
| The panel opens but nothing is announced | That press opened the panel, which was closed. Press again once it has finished scanning |
| The second press announces "BRIDGE pressed…" but the page does not move | Tell Claude, with the page and the button's name |
| The page shows "Submitted" without your "Yes, submit now" | Stop. Tell Claude. That breaks the one rule BRIDGE must never break |

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
4. Next to "Scan the page again", find
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
| Nothing is spoken after Deny or Allow | Open **Diagnostics** at the bottom of the panel: an "Always enable" line records `denied`, `granted` or the error, so you can tell "not announced" apart from "the click did nothing". Chrome's prompt takes focus out of the panel, and a live region is only spoken while its document holds focus — the panel now takes focus back before it speaks. If it is still silent with that line present, the announcement is reaching the live region and the screen reader is not picking it up; say so |

**Clean up:** in BRIDGE's Details, Site access, remove httpbin.org.

---

## 5. Export saves a file — **removed, nothing to run**

The side panel no longer has an export button. Sending the report to the employer becomes
automatic once the applicant submits, and that send is being built separately; when it
exists it needs its own check here.

The report itself is unchanged and still covered: `npm run test:e2e` builds it with the
same `buildReport()` the panel used and asserts its §6.7 shape, that page barriers are
keyed by rule alone, that labels are the page-derived ones, and that nothing the applicant
typed appears anywhere in it.

What is **not** covered any more, and was the only reason this check existed: whether a
download started inside a real side panel lands on disk. Nothing downloads from the panel
today, so there is nothing to lose. If the automated send ever writes a file, restore this.

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
4. **Decide about automatic reading.** By default VoiceOver reads a newly loaded web page
   from the top until something interrupts it, and the side panel is a web page. So opening
   BRIDGE speaks the heading, the summary, and then every question. **Control**
   stops it. To turn it off: VoiceOver Utility (**Control+Option+Fn+F8**), Web, General,
   untick **"Automatically speak the webpage"**. Write down which setting the pass used.
   Do part of one run with it on, because that is what a new user hears.
5. Do one run **with the screen on** to learn the flow. Findings from this run do not count.
6. **Control+Option+Shift+F11** turns on Screen Curtain. The display goes black. Every
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
   *Expect:* "BRIDGE found N accessibility barriers on this form. Press Alt+Shift+B to open BRIDGE."
   *If silent:* the page's live region is not being spoken. Tell Claude.
3. **Open.** Press **Alt+Shift+B**. The proxy is stopped for this run.
   *Expect:* "BRIDGE, heading level 1", then "13 questions found. N accessibility
   barriers, M blocking." Write down both barrier counts, from step 2 and from here. They
   may differ by one: the panel can see the `127.0.0.1` frame it cannot reach, and the
   page cannot. That explanation is unverified, so a difference is not a failure.
   *Also expect,* once: "Label inference is unavailable, so 2 questions have no name. The BRIDGE
   proxy at localhost:8000 is not reachable." *Fail if* you hear an exception such as "TypeError: Failed to
   fetch" (fixed in `fc82055`, not yet heard by ear).
4. **Find your way by heading.** **Control+Option+U** opens the rotor. Choose Headings.
   *Expect:* BRIDGE; Application pre-check; Questions; Question 1 of 13; Check what the
   page contains; Barrier report.
5. **No barrier list.** Tab from the summary onward.
   *Expect:* "Scan the page again" comes right after the summary. No barrier sentence is
   ever spoken in the panel; the barriers exist only in the exported report (2026-09-22).
6. **"How to answer".**
   *Expect:* the text "How to answer", then two radio buttons, "One question at a time"
   selected. No "group" wrapper is announced, and nothing is spoken twice.
7. **One question at a time.** Tab from the mode group onward.
   *Expect:* only **one** question is reachable. The other twelve must not be spoken at all.
8. **Full name.** Type a name. Tab to **"Write Full name to page"**. Press Space.
   *Expect:* "Full name: … Confirmed on the page. Press Next question for Phone." — heard
   in full, in that order, with focus staying on the Write button. Nothing about Phone is
   spoken before the confirmation.
9. Use **"Next question"** to reach each of these. Write down the announced name and role.

   | Question | Panel control | Listen for |
   |---|---|---|
   | Highest education completed | pop-up button | "(label inferred)" is spoken. Five options |
   | Years of experience | number field | its description "From 0 to 10", and the value spoken as the number itself — "4", never "40%" |
   | The visa question | radio group | the question is spoken as the group's name, the options as **"Yes"** and **"No"** |
   | Language skills | checkbox group | the group's name is "Language skills" |
   | Earliest start date | text field | *Expect:* its description says "Year-month-day, like 2026-10-31" — no stepper, no percentages. A wrong format is refused with that sentence |
   | CV, "Drag and drop your CV here" | file button | Space opens the macOS file picker. Note whether you could choose a file with the curtain on |
   | Notice period | text field | after Write: **"Could not fill Notice period."** plus the reason |
   | I agree to the privacy notice | checkbox | |

10. **VERIFY.** Activate "Read back everything from the page".
    *Expect:* "Your application contains: …", then the empty questions by name, then
    "BRIDGE submits only when you tell it to. Press Alt+Shift+S again to move to the Submit
    my application button in BRIDGE."
11. **Submit.** Press **Alt+Shift+S** again, then confirm, as in check 2 steps 6 and 7. With
    Full name written the page goes to "Application received". With it empty, BRIDGE says
    the page has not moved on.

### Run B: step changes, the most important question of the pass

Open `http://localhost:8765/modal.html` and open BRIDGE.

1. Move focus **into the page** and activate **Easy Apply**.
2. **Listen.** "Step 1 of 3: Contact info. 3 questions found…" comes from the *panel's* live
   region while your focus is in the *page*.
3. Activate **Next** on the page. Listen for "Step 2 of 3: Additional questions."
4. Do it once more with your focus **in the panel**, using **Alt+Shift+S** twice so BRIDGE
   presses Next. This is the path a real user takes.

Write down, for each case: **was the step change spoken?**

VoiceOver may not speak a live region in a pane that does not have focus. If the step
change is silent while focus is in the page, that is the single most valuable finding of
this pass. Tell Claude. The fix is to make the same announcement from the status region
BRIDGE already injects into the page.

5. On step 1, choose **Yes** for the referral question on the page.
   *Expect:* "2 new questions appeared: Referrer name, Referrer email."
6. **An answer left behind.** Reload `modal.html` and reopen BRIDGE on step 1. Type into a
   panel **text box** and **do not** press its Write button. (Only typed text and dropdown
   choices count as left behind; a chosen radio or checkbox is not reported.) Press **Alt+Shift+S** twice.
   *Expect:* "Step 2 of 3: … The page moved on before X was written; that answer is not
   on the page.", with X the question's name. Going back to step 1 brings it back into
   its box ("What you typed here before is back in the panel.").

### Run C: the full-page journey

Open `http://localhost:8765/steps/1.html`, open BRIDGE, then activate **Save and Continue**
on the page. Expect "Step 2 of 3: My Experience. Next: Review." with nothing reopened.

### Run D: leaving the panel and coming back

Alt+Shift+B on an open panel closes it and opens it again, and the reopened panel puts back
what you typed (check 1). On reopen, VoiceOver starts reading the panel from the top, and
BRIDGE announces "Back in BRIDGE…" at the same time. It is the one announcement BRIDGE
still makes on open. That is the same kind of overlap that once made the summary heard
three times, so listen closely here. Do it with **"Automatically speak the webpage"** on.

1. Open `http://localhost:8765/apply.html` and press **Alt+Shift+B**. Choose **Full list**.
2. Tab to question 11. Type into it and **do not** press Write.
3. Click in the page's **Full name** field. Press **Alt+Shift+B**.
   *Expect:* "Back in BRIDGE. Your answers are kept. You were on question 11 of 13.",
   heard in full, and what you typed is back in its box.
   Write down whether that sentence was spoken in full, was cut off, or broke into the
   top-to-bottom reading. Note where in the reading it came.
4. Repeat steps 2 and 3 in **One question at a time**, on question 3.
   *Expect:* "…You were on question 3 of 13.", and question 3 is the question shown.

### Dropdowns: is the hint true?

Each dropdown in the panel carries the note **"Up and down arrow keys move through the
answers."** VoiceOver's own hint for a pop-up button names Control-Option-Space and nothing
else, which makes a dropdown sound like it needs a chord; the note is there to say the
plain thing.

Nothing automated can confirm it. Headless Chromium on macOS opens the native popup on an
arrow key rather than moving the value, and there is no screen reader in that process.

1. Tab to **Highest education completed** in the panel.
2. Listen: after the name and "pop up button", the note should be read as its description.
3. Press **Down arrow**. Does the answer change, and is the new one spoken?
4. Press **Up arrow**. Does it go back?

**Write down** exactly what was spoken, and whether the arrows moved the answer without
you opening anything. If they did not — if the list opened instead, or nothing moved — the
note is **wrong on this platform and must be changed or removed**. A wrong instruction is
worse than none, especially one aimed at somebody who cannot see what happened.

Worth repeating on NVDA: arrow keys move a `<select>` directly on Windows, so the note is
expected to be straightforwardly true there.

---

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
- **Never press Submit application, and never activate BRIDGE's "Submit my application"
  button.** BRIDGE can now submit for real when told to. Stop at the read-back.
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
9. In the panel, check: the question is a group whose name is the question, with options
   **Yes** and **No**. (The panel shows no barrier sentences; the identically-named-options
   barrier is checked in the exported report at step 15.)
10. Choose an answer in the panel and activate its **Write** button.
11. Expect "… Confirmed on the page", and the matching radio selected in LinkedIn's dialog.
12. With VoiceOver on, Tab to the same two radios in LinkedIn's own dialog and listen. That
    is the "before". The panel's group is the "after". This pair is the headline demo.
13. Activate "Read back everything from the page".
14. **Stop here.** Close the dialog with its X and choose **Discard**.
15. In the panel, export the barrier report as JSON. Open the file and confirm it contains
    no answers, no name and no email, and that it carries the `options-identically-named`
    barrier for the visa question.

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
