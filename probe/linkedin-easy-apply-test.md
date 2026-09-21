# Test plan: LinkedIn Easy Apply

**Goal:** determine whether a blind applicant can complete a LinkedIn Easy Apply
application, and what BRIDGE must do where they cannot.

**Status:** step 1 of 4 measured (5 fields, 0 barriers, native `<select>`s). Steps 2–4 and
all announcement behaviour are unmeasured. This plan closes that gap.

Results go into `../bridge-spec.md` §11.

---

## Why both tools

`bridge.scan()` reports what is **in the DOM**. It is structurally blind to the things that
actually stop people in a modal wizard:

| Open question | Tool that can answer it |
|---|---|
| Is every field named? | probe |
| Does the resume radio list name its question? | probe |
| Do BRIDGE's writes land on LinkedIn's components? | probe (`bridge.fill`) |
| Is the step change announced after Continue? | **screen reader only** |
| Where does focus land after Continue? | **screen reader only** |
| Is `1/4 pages` spoken, or visual-only? | **screen reader only** |
| Are validation errors spoken? | **screen reader only** |

Four of seven need ears. Run both passes.

---

## Rules

- **Never click "Submit application."** Walk to the review step and stop.
- Pick a job you would never apply to.
- Close the modal with the X or Escape when done. LinkedIn offers to save a draft —
  **discard it**. Confirm nothing appeared in *My Jobs → Applied*.
- No automation against LinkedIn. This is hand-driven with DevTools open, which is you
  browsing your own session. Do not point Playwright at a logged-in LinkedIn.
- `bridge.fill()` never clicks submit or continue. You advance the form yourself.

---

## Setup

```bash
cd probe && node build-console.js        # regenerate from scan/scope/detector/act sources
```

1. Open an Easy Apply job while logged in.
2. DevTools → Console. Click **⊘** to clear.
3. Filter box: `-chrome-extension` (the leading minus excludes; other extensions on your
   profile flood the console otherwise). If it still floods, disable the offending
   extension at `chrome://extensions` — a misbehaving extension also mutates the DOM you
   are measuring.
4. Paste all of `console-snippet.js`. Type `allow pasting` first if Chrome objects.
5. Confirm you see `BRIDGE console probe active.`

```
bridge.scan()          scan now, print a report
bridge.fields()        list writable controls with their index
bridge.fill(what, value)  write to a control, read back from the DOM
                          'what' = part of the field name, or an index
bridge.steps()         every step transition seen so far
bridge.export()        copy(bridge.export()) when finished
```

---

## Pass 1 — structure (probe, no screen reader)

Do not click Easy Apply yet.

1. `bridge.scan()` — baseline with no modal open.
2. Click **Easy Apply**. Read the logged transition line without touching anything. Record:
   - `(no URL change)` or `(URL CHANGED)`
   - `basis=step-index` or `basis=field-similarity`
   - `scope=` — should be `dialog`. If it says `body`, the scope picker missed and every
     similarity number that follows is suspect.
3. For each of steps 1–4:

   | Do | Record |
   |---|---|
   | `bridge.scan()` | field count, barrier count, `stepHint` |
   | note any `group-not-labelled` | expected on the step 2 resume list |
   | note any `missing-label` | the field's name and tag |
   | `bridge.fields()` | the index table, for the ACT spike below |
   | click Continue | the transition line the detector logs |

4. At the review step, stop. `copy(bridge.export())` and paste it somewhere.

### The ACT spike — do this on step 1

**This is the highest-risk unknown.** Every ACT strategy so far was proven against
react-select and native `<select>`. LinkedIn uses neither; it has its own component
library. If writes do not land, BRIDGE cannot fix anything here, only report.

Target a control by **part of its name** — no index needed, nothing to look up:

```js
bridge.fill('Mobile', '91234567')      // text input
bridge.fill('Phone country', 'Singapore')  // native select
bridge.fill('resume_swe')              // radio or checkbox: no value, the click IS the write
```

If the fragment matches more than one control, it prints the candidates and does nothing.
`bridge.fields()` still prints the full table, and `bridge.fill(2, '...')` by index still
works — but indices renumber after every Next, so names are safer.

Expect `[ACT PASS] ... DOM read-back: "91234567"`. Try one of each kind present:

- a text input
- a native `<select>` (email address, phone country code)
- on step 2, a radio in the resume list

Record the strategy used and the read-back for each. **`ACT FAIL` here is the single most
important finding in this document** — it means §6.3 needs a LinkedIn-specific strategy.

---

## Pass 2 — announcements (screen reader)

Full method in `screen-reader-testing.md`. Short version: caption panel on
(Control + Option + Command + F10), and **Screen Curtain on**
(Control + Option + Shift + F11) for the Continue transitions specifically — that is where
"was anything announced?" is the entire question.

Reload the page first so the form starts clean.

1. `Tab` to the Easy Apply button and activate it. **Is the dialog announced?** Record the
   exact caption text, or `SILENCE`.
2. `Tab` through the step. For each control record what was spoken. Flag anything that is
   just `edit`, `button`, `blank`, or a bare value with no name.
3. Find the progress indicator. **Is `1/4 pages` spoken?** If you can reach it with
   `VO + →` but `Tab` skips it and nothing announces it on step change, it is visual-only —
   a barrier.
4. On step 2, `Tab` into the resume list. **Is the question announced, or only the
   filenames?** Hearing `resume_swe.pdf, radio button, 1 of 10` with no "Resume, required"
   is `group-not-labelled`.
5. Press Continue. **Listen.** Record: was the step change announced? Where did focus land?
   Silence plus lost focus is blocking — the user does not know the form moved.
6. Deliberately leave a required field empty and press Continue. **Is the error spoken?**
   Record where focus went.

---

## Recording template

```
STEP n — <name>            probe: N fields, M barriers, stepHint: <...>
  barriers      : <rules, or none>
  ACT           : <field> via <strategy> -> read-back <...> PASS/FAIL
  dialog announced : <caption text | SILENCE>
  fields announced : <anything unnamed>
  step announced   : <caption text | SILENCE>
  focus after Continue : <element | LOST>
  errors announced : <caption text | SILENCE | not tested>
```

---

## What each outcome means for BRIDGE

| Finding | Consequence |
|---|---|
| `ACT FAIL` on LinkedIn components | §6.3 needs a LinkedIn strategy. Highest priority — without it BRIDGE can only report |
| Step change silent | BRIDGE announces it via its own live region. Strong demo moment |
| Focus lost after Continue | BRIDGE restores focus. Blocking barrier, and a better demo than anything in §7 |
| `1/4 pages` visual-only | BRIDGE speaks the journey shape, as it does for Workday |
| Resume group unnamed | Same barrier as Lever, on a form millions use. Goes in the employer report |
| Everything announced correctly | Real result. BRIDGE adds little on LinkedIn — say so, and point at VietnamWorks and Ashby instead |

That last row is a legitimate outcome. Do not bend the findings: a tool that reports
barriers on a form that does not have them is worse than no tool, and the §6.7 employer
report has to survive an employer reading it.
