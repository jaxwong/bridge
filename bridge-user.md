# BRIDGE: User spec

An accessibility compatibility layer for inaccessible job applications.

This spec covers the applicant side: the extension. The employer side (business model, monitor,
dashboard) is in [`bridge-business.md`](bridge-business.md).

**Competition focus:** Stage 2, Job Search & Application
**Form factor:** Chrome / Edge extension (Manifest V3)
**Timeline:** 3-day hackathon

---

## 1. Problem

A visually impaired candidate can be fully qualified for a role and still be unable to apply independently because the application itself is inaccessible: unlabelled fields, mouse-only widgets, drag-and-drop uploaders, focus traps, visually dependent content.

Screen readers can read accessible pages. They cannot make a badly built control operable.

## 2. Goals and non-goals

### Goals (MVP)

- Tell the applicant, before they start, which parts of the current application page they will not be able to operate.
- Give them an accessible way to fill those parts through their existing screen reader.
- Write their input into the real page, then verify it landed by reading it back from the page.
- Keep the applicant in control: BRIDGE never submits unintentionally. It submits only when the applicant, having heard the page read back, tells it to and confirms (§6.5).
- Produce an exportable barrier report (accessibility failures only, no applicant data) for the employer side ([`bridge-business.md`](bridge-business.md)).

### Non-goals

- Applying on the user's behalf, auto-filling from a profile, or writing answers.
- Fixing the page for all users (that is the employer's job; BRIDGE reports it).
- Mobile support. Chrome on Android has no extensions; desktop-first is explicit.
- Anything employer-facing beyond the report export. That is [`bridge-business.md`](bridge-business.md).
- Scanning steps of a multi-page application that have not been reached yet (see §6.5). BRIDGE reads the page's own step indicator to describe the journey; it does not fetch ahead.

## 3. Users

| User | Needs |
|---|---|
| Blind / low-vision applicant using NVDA, JAWS, or Narrator | Know what's broken up front; fill every field without sighted help; confirm what will be submitted |
| Employer / recruitment platform (see [`bridge-business.md`](bridge-business.md)) | A concrete list of barriers in their application journey and why each blocks candidates |

## 4. User flow

```
Land on application page
  → BRIDGE detects known ATS domain, announces barrier count via live region
  → User presses Alt+Shift+B → side panel opens, focus moves to it
SCAN      side panel lists fields and barriers, grouped by severity
TRANSLATE user answers each field in the side panel with native controls
ACT       BRIDGE writes each answer into the real page control
VERIFY    BRIDGE re-reads every value from the page DOM and reads it back
  → User presses Submit on the real page themselves
```

BRIDGE works on **any** page. What differs by site is whether it runs by itself:

| Tier | Mechanism | Behaviour |
|---|---|---|
| Built-in ATS list | Static `host_permissions` + declared content scripts | Scans on load and announces the barrier count. Also reaches an ATS iframe embedded in a company careers page |
| Any page, on demand | `activeTab`, granted by the Alt+Shift+B shortcut | Scans when the user asks. Silent until then |
| User-added site | `optional_host_permissions` + `chrome.permissions.request` + `chrome.scripting.registerContentScripts` | "Always enable BRIDGE on this site" in the side panel. From then on behaves like the built-in list |

No `<all_urls>`: its install warning, *"Read and change all your data on all websites"*, is the
wrong first impression for a tool asking blind applicants to trust it, and scanning every
page would announce barriers on pages that are not applications.

Why the third tier matters. Per Chrome's documentation, `activeTab` access **survives
same-origin navigation but is revoked on cross-origin navigation**, and it covers the main
frame's origin only. So on a portal outside the list, a single-sign-on detour or a redirect
to the employer's own ATS silently disconnects BRIDGE mid-application, and the user would
have to press the shortcut again. Adding the site removes that. Even on the same origin, a
full page load discards an injected content script, so the service worker reports each
completed load (`tabs.onUpdated`) and the side panel re-prepares the frames and rescans,
which re-injects while `activeTab` still holds.

Chrome's permission prompt appears when the user adds a site. Include it in the NVDA pass.

### 4.1 SCAN

Output shown in the side panel:

```
Application pre-check
23 fields detected
4 accessibility barriers
  Blocking   Experience slider is not keyboard operable
  Blocking   CV uploader requires drag and drop
  Usability  Education dropdown has no accessible label
  OK         Submit button is accessible
```

Each item is a focusable list entry. Activating it jumps to that field's TRANSLATE control.

### 4.2 TRANSLATE

Each page control gets a native, correctly labelled equivalent in the side panel:

| Page control | Side panel control |
|---|---|
| Custom / visual slider | `<input type="number">` with min, max, step from the widget |
| Div-based dropdown | Native `<select>` with the extracted options |
| Drag-and-drop uploader | Native `<input type="file">` |
| Custom date picker | Native `<input type="date">` |
| Unlabelled text input | `<input>` with the inferred label, marked "label inferred" |

Two modes: **one question at a time** (default, conversational) and **full list** (for users who want to review everything).

### 4.3 ACT

Write the value into the real page control, then immediately read the control's value back from the DOM. If it doesn't match, mark the field **"Could not fill: may need sighted help"** and say so. Never fail silently.

See §6.3 for per-control strategies.

### 4.4 VERIFY

Triggered when the user reaches the end of the list or requests it.

- Re-read every mapped field **from the page DOM**, not from BRIDGE's own state. This is what catches ACT failures and anything the page reset (e.g. a framework re-render).
- Read back as a structured summary: "Your application contains: Name, Zheng Wei. Years of experience, 2. CV, resume.pdf. 1 field could not be filled: Start date."
- Then the way forward. **Changed 2026-09-21 after testing by hand:** Chrome does not let the page take keyboard focus from the side panel, so BRIDGE cannot "move focus to Submit". A button that only moves on (Next, Continue) is pressed by BRIDGE on the second Alt+Shift+S. Submitting is never done by the shortcut: the panel offers its own "Submit my application" button, which asks for confirmation. See §6.5.

On a multi-step application this runs **before every forward move**, not only at the end,
and `Alt+Shift+S` presses Continue on every step but the last, where it moves to the panel's submit button. Once
Continue is pressed the previous step's DOM is gone and read-back is no longer possible.
See §6.5.

## 5. Architecture

```
┌──────────────── Chrome ────────────────┐
│                                        │
│  Side panel (extension page)           │   Proxy (FastAPI, 1 endpoint)
│   UI, TRANSLATE controls, VERIFY       │──→  POST /infer-labels
│        │  chrome.tabs.sendMessage      │        │
│        ▼  (per frameId)                │        ▼
│  Content scripts (all frames)          │   Vision-capable LLM
│   SCAN, ACT, DOM read-back             │
│        ▲                               │
│  Service worker                        │
│   shortcuts, ATS detection, routing    │
└────────────────────────────────────────┘
```

### 5.1 Ownership

| Component | Owns | Does not own |
|---|---|---|
| Content script | Everything about the page: field discovery, barrier detection, writing values, reading values | UI, network calls |
| Side panel | UI state, user's pending answers until ACT confirms them, the decision that the page moved to a new step (§6.5), the session in `chrome.storage.session` | Truth about what's on the page |
| Service worker | Shortcut handling, opening the panel, injecting the content script, answering "which frames may BRIDGE run in", registering user-added sites | Page or UI state |
| Proxy | API key, request shaping, stripping anything that isn't structure | Any persistence |

**Source of truth for field values is the page DOM.** The side panel holds a pending value only until ACT reads it back successfully.

### 5.2 Stack

- TypeScript, Manifest V3, built with WXT (handles side panel, content scripts, and reload during dev)
- Side panel UI: plain HTML + minimal Preact. Native elements only, no component library.
- `axe-core` bundled into the content script for standard rule checks
- Proxy: FastAPI, single endpoint, holds the LLM API key. No database. The model is
  DeepSeek V4.1 Flash (`deepseek-flash`, text and image input) through the OpenAI-format
  endpoint at `https://api.deepseek.com`; the key is `DEEPSEEK_API_KEY`.

### 5.3 Manifest essentials

```json
{
  "manifest_version": 3,
  "permissions": ["sidePanel", "activeTab", "scripting", "storage"],
  "host_permissions": [
    "https://*.myworkdayjobs.com/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "https://jobs.ashbyhq.com/*",
    "https://*.vietnamworks.com/*",
    "https://www.linkedin.com/*",
    "http://localhost/*"
  ],
  "optional_host_permissions": ["https://*/*"],
  "commands": {
    "open-bridge":   { "suggested_key": { "default": "Alt+Shift+B" } },
    "focus-submit":  { "suggested_key": { "default": "Alt+Shift+S" } }
  },
  "content_scripts": [{
    "matches": ["<same as host_permissions>"],
    "js": ["content.js"],
    "all_frames": true,
    "match_about_blank": true
  }]
}
```

No `<all_urls>`; see the tiers in §4. User-added sites are registered at runtime with
`chrome.scripting.registerContentScripts` after `chrome.permissions.request` succeeds, which
must be called from a user gesture (a button in the side panel). `debugger` permission is
**not** in the MVP (see §6.3 fallbacks).

## 6. Components

### 6.1 Data model

```ts
type ControlKind =
  | "text" | "textarea" | "select" | "combobox" | "radio-group" | "checkbox-group"
  | "checkbox" | "file" | "slider" | "date" | "unknown";

type Severity = "blocking" | "usability" | "ok";

interface Barrier {
  rule: string;
  severity: Severity;
  message: string;          // spoken to the user as-is
}

interface FieldDescriptor {
  id: string;               // positional within one scan of one frame, e.g. "f3"
  kind: ControlKind;
  label: string;
  labelSource: "aria" | "label-element" | "nearby-text" | "none";
  required: boolean;
  options?: string[];       // select / groups / custom dropdown (harvested by opening it)
  range?: { min: number; max: number; step: number };   // sliders that publish one
  barriers: Barrier[];
}

interface ScanResult {
  url: string;
  scannedAt: string;
  fields: FieldDescriptor[];
  pageBarriers: Barrier[];  // not tied to a field, e.g. CAPTCHA
  stepHint: StepHint | null;
  heading: string;          // the step's own name: the last heading before its first field
  iframeOrigins: string[];  // visible cross-origin iframes; the panel reports unreachable ones
}
```

`StepHint` is as in §6.5. The authoritative definitions are in `extension/lib/types.ts`.

There is no selector and no frame id in a `FieldDescriptor`. The element, its path and its
name-and-ordinal stay in the content script as a `FieldHandle`; they never leave the page.
The side panel adds the frame and a rescan-stable key
(`${frameId}|${kind}|${label}|${ordinal}`) to each field it merges, because positional ids
shift when a conditional field appears.

### 6.2 SCAN: barrier rules

| Rule | Severity | Detection |
|---|---|---|
| `missing-label` | usability | axe-core `label`, `aria-input-field-name` |
| `not-keyboard-operable` | blocking | Element looks interactive (`cursor: pointer`, known widget class patterns, custom slider thumb) but has no focusable descendant and no ARIA role |
| `drag-drop-only` | blocking | File input is **out of the tab order** — `tabindex=-1`, `disabled`, `display:none`, `visibility:hidden` or `inert` — and has no keyboard trigger. A `<label for>` names the input but is not a tab stop, so it only counts as a trigger when the label itself (or a button inside it) is focusable. Visually hidden is *not* out of the tab order; that is the standard accessible pattern. Known limit: a separate button that opens the input from script cannot be recognised statically |
| `upload-unnamed` | usability | File input is keyboard-reachable but has no accessible name, so it is heard only as a generic file button |
| `focus-trap` | blocking | **Not detectable by SCAN.** Scripted Tab presses do not move focus, so tab order can only be observed from real keypresses. Checked manually with `bridge.watchTab()` in `probe/`. Note that focus looping from a dialog's last control back to its first is *correct* modal behaviour, not a trap |
| `custom-dropdown-no-role` | blocking | Div/ul-based option list with no `listbox` / `combobox` roles |
| `captcha` | blocking (page) | Known CAPTCHA iframes / widgets. BRIDGE cannot solve these; it tells the user in advance |
| ~~`closed-shadow-root`~~ | retired | Content scripts can open closed roots with `chrome.dom.openOrClosedShadowRoot`. SCAN and ACT pierce every shadow root, so a field inside one is offered like any other. Verified on the fixture's closed root |
| `cross-origin-frame-unreachable` | blocking (page) | A visible cross-origin iframe whose origin is not among the frames Chrome lets BRIDGE run in. Derived in the side panel: the top frame lists iframe origins, the service worker lists reachable frames |
| `modal-without-dialog-role` | blocking (page) | A visible popup containing form controls, with no `role="dialog"` / `role="alertdialog"` / `aria-modal` on it or any ancestor. Nothing announces it opened |
| `group-not-labelled` | blocking | Radios in one group, or two or more checkboxes sharing a `name`, with no `fieldset`+`legend` and no `role="group"`/`radiogroup"` carrying a name. The question itself is unreachable |
| `label-placeholder-only` | usability | The only name comes from `placeholder`. It vanishes on input and several screen readers skip it |
| `options-identically-named` | blocking | Two or more options in one group compute to the **same** accessible name. `aria-label` overrides element contents, so a question stamped onto every option erases "Yes" and "No" |

Heuristics run first. The LLM is only used to **infer labels and options** for fields where heuristics produce nothing useful.

**Skip `aria-hidden` subtrees before evaluating anything.** They are invisible to a screen
reader, so they are neither fields to offer nor barriers to report. Omitting this check
produced 7 false `missing-label` barriers on the Greenhouse fixture — all of them
react-select's hidden `required` input, which exists only to trigger native form
validation. With the check in place that form reports zero field-level barriers, which is
correct. A tool that cries wolf about a well-built form is worse than no tool: it trains
the user to ignore it, and it makes the §6.7 employer report indefensible.

### 6.3 ACT: write strategies

| Control | Primary | Fallback | Status |
|---|---|---|---|
| Text / textarea (incl. React) | Native value setter from `HTMLInputElement.prototype`, then dispatch `input` and `change` | Focus + `document.execCommand("insertText")` | **verified** on Greenhouse and LinkedIn |
| Native `<select>` | Set `value`, dispatch `change` | None needed | — |
| Custom dropdown | Synthetic `mousedown` + `mouseup` on the control, wait for options, same on the option matching the text | None that works — see below | **verified** on Greenhouse (react-select) |
| Native range | Native value setter + `input` / `change` | None needed | — |
| Custom slider | Chosen by shape, never by failure: `input[type=range]` → native setter; focusable `role="slider"` → Home, then ArrowRight × n; anything else → pointer and mouse events at the x-coordinate for the value on the track | None | pointer strategy **verified on the fixture only**; no real portal in §11 had a slider |
| Uploader (incl. drag-and-drop) | Build a `File`, set `input.files` from a `DataTransfer`, dispatch `change` | Dispatch `dragenter` / `dragover` / `drop` carrying the `DataTransfer` on the drop zone | **verified** on Greenhouse and Ashby; fallback unverified |
| Date picker | Find the underlying input, native setter + events. A text input is written in the order its placeholder asks for (`dd/mm/yyyy`), `type=date` as ISO | Stretch: drive the calendar UI | **verified on the fixture only** |

**Synthetic events are good enough.** The `isTrusted: false` risk did not materialise on
any portal measured in §11, across three unrelated component layers: React, react-select,
and LinkedIn's own library. React's synthetic event system does not check `isTrusted`, and
react-select — the most common custom dropdown in the ATS world — opens, enumerates and
selects from untrusted `mousedown`. `chrome.debugger` stays out of the MVP.

**The keyboard fallback for dropdowns does not work.** Synthetic `ArrowDown` on a
react-select combobox leaves `aria-expanded="false"`; the library's handler does not fire.
Click is not the primary strategy with a keyboard safety net — it is the only strategy.
If a widget ignores synthetic mouse events, ACT fails and the field is reported as
**"Could not fill: may need sighted help"**.

**Options do not exist until the widget is opened.** Every one of the 13 react-select
dropdowns on the Greenhouse fixture returns zero options to a DOM query while closed.
`FieldDescriptor.options` therefore cannot be populated by reading; SCAN has to open each
custom dropdown, harvest the options, and close it again. That makes SCAN a phase with
timing and failure modes, not a parse — budget for it. It also means §6.4's LLM payload
can only carry `options` for widgets SCAN successfully opened.

**Uploaders: the primary and fallback are the other way round from what the drag-and-drop
framing suggests.** `input.value` cannot be set from script in any browser on any OS, and
no extension or OS API changes that. But a `File` constructed in the page and assigned via
`DataTransfer` is accepted — this is pure web platform and behaves identically on macOS,
Windows, Linux and ChromeOS. It worked on both portals with real uploaders, including
Ashby, whose visible affordance is a drop zone. Reach for the synthetic `drop` only when a
widget reads `e.dataTransfer` and never looks at `input.files`.

**Every write is followed by a read-back.** Mismatch → field marked as failed, user told.

**File transfer:** the user picks the CV in the side panel. The panel reads it as base64 and sends `{ name, type, data }` to the content script (runtime messages are JSON, `File` objects don't cross), which reconstructs the `File`.

Hold those bytes in `chrome.storage.session` for the life of the application so the user
picks the CV once rather than once per step — a six-step Workday application would
otherwise ask six times. `storage.session` is memory-only and cleared when the browser
closes. Never `storage.local`, and never near the proxy: under §6.4 this is applicant data.

**Why the side panel's own file input is the whole trick.** A native `<input type="file">`
is already accessible: a screen reader announces it as a button, Enter opens the **OS file
picker**, and Finder and the Windows common dialog are both fully navigable with
VoiceOver, NVDA, JAWS and Narrator. Uploading is a solved problem for blind users. The
barrier is only ever that the page destroyed the control — Ashby's file input is 1px wide,
`tabindex="-1"` and has no accessible name, leaving a drop zone as the sole affordance.
BRIDGE is not inventing an accessible upload; it is restoring the one the site removed, by
offering a correctly labelled native input and injecting the resulting bytes.

**Known limit:** synthetic events have `isTrusted: false` and some widget libraries ignore
them. This did not bite on any portal in §11, so `chrome.debugger` + CDP
`Input.dispatchMouseEvent` stays out of the MVP — it adds an install warning and a "being
debugged" banner. Revisit only if a target portal proves to need it.

### 6.4 LLM label inference

Request to proxy:

```json
{
  "fields": [{
    "id": "0:form>div[3]>div[2]",
    "kind": "select",
    "nearbyText": ["Education", "Highest level completed"],
    "options": ["Secondary", "Diploma", "Bachelor's", "Master's", "PhD"],
    "cropPng": "<base64, optional>"
  }]
}
```

Response: `{ id, label, confidence }[]`. Labels from the LLM are always shown as **"label inferred"** so the user knows it's a guess.

**Privacy rule:** only structure goes to the proxy (nearby text, options, roles, a cropped screenshot of the control). Scan happens before the user types anything, so crops contain no answers. **Field values never leave the device.**

### 6.5 Multi-step applications

Most applications are one page. Greenhouse, Lever and Ashby all render the whole form at
once. **Workday is the multi-step case**, so this is one adapter's worth of work, not a
general rewrite.

#### What the page will tell you

Workday publishes the entire journey on step 1, before the user has entered anything:

```
current step 1 of 6  Create Account/Sign In
        step 2 of 6  My Information
        step 3 of 6  My Experience
        step 4 of 6  Application Questions
        step 5 of 6  Voluntary Disclosures
        step 6 of 6  Review
```

So BRIDGE can honestly say *"this application has 6 steps, you are on 2, next is My
Experience"* without scanning anything it has not reached. Read the page's own stepper —
`[data-automation-id=progressBar]` on Workday, otherwise `aria-current="step"`, a
`role="progressbar"`, or a `Step N of M` text match. When none is found, say "step 2,
total number of steps unknown" and leave it at that.

Note that step 1 is **account creation**, so the session has to survive a sign-in detour
and, on some tenants, an SSO round trip to another origin.

#### The content script will be destroyed

Clicking "Apply Manually" on Workday triggers a **full document navigation**, not a
client-side route change. An instrumented page confirmed it: everything on `window` was
gone afterwards. So:

> The content script owns nothing that must outlive a step. It is disposable and
> re-derives everything from the DOM on load. Continuity lives in the service worker and
> the side panel, which survive page navigation.

This is already the §5.1 ownership split — it just has to be enforced rather than assumed.

#### One detector for three kinds of transition

Steps change by full navigation (Workday), by SPA route change, or by an in-place DOM swap
with no URL change at all (LinkedIn Easy Apply). Rather than three code paths, decide from
the form's contents — but **the page's own step index outranks any heuristic**:

```ts
// 1. Scope to the region that actually swaps. A modal wins over the form: on
//    LinkedIn the search page behind the dialog never goes away.
//    Two traps, both found by measurement:
//    - `<dialog>` has an implicit dialog role but NO role attribute, so
//      '[role=dialog]' misses it. LinkedIn Easy Apply uses a native <dialog>.
//    - A page can hold a dialog with no controls at all (Greenhouse has a banner
//      like this), so prefer the narrowest candidate that actually contains controls.
const scope = () => {
  const candidates = [
    ...document.querySelectorAll('dialog[open]'),
    ...document.querySelectorAll('[role=dialog][aria-modal="true"]'),
    ...document.querySelectorAll('dialog'),
    ...document.querySelectorAll('[role=dialog]'),
    ...document.querySelectorAll('form'),
  ];
  return candidates.find(el => countVisibleControls(el) > 0) || document.body;
};

// 2. A Set, keyed on accessible name where there is one. Ten identically-keyed
//    radios are one signal, not ten.
const fingerprint = () => new Set(
  [...scope().querySelectorAll(SEL)]
    .filter(e => e.offsetParent !== null)
    .map(e => `${e.tagName}:${e.type || e.getAttribute('role') || ''}:${e.getAttribute('aria-label') || e.name || e.id || ''}`)
);

const jaccard = (a, b) =>
  [...a].filter(k => b.has(k)).length / (new Set([...a, ...b]).size || 1);

// 3. Decide.
const indexMoved = nowStepIndex !== null && prevStepIndex !== null && nowStepIndex !== prevStepIndex;
const verdict = indexMoved          ? 'new-step'        // the page said so
              : jaccard(prev, now) < 0.4 ? 'new-step'   // inferred
              : 'fields-changed';
```

**As built.** The content script does not decide. It watches the document with one
debounced `MutationObserver` and tells the side panel only *that* the form changed, when
the set of `kind:label` pairs or the step index differs from the last scan. A full
navigation needs no watcher: the service worker reports the page load. Either way the
panel rescans and makes the one decision above, comparing the previous scan with the new
one. `history.pushState` is not patched: content scripts run in an isolated world and
cannot intercept the page's calls, and every route change mutates the DOM anyway. A change
that lands while BRIDGE is itself touching the page (reading a dropdown, writing an answer)
is compared once that work ends, not dropped.

Record which basis produced each verdict (`step-index` vs `field-similarity`). When the
heuristic and the index disagree, the index is right and the threshold needs tuning.

**Both refinements came from a measured failure**, not from theory. Against LinkedIn Easy
Apply the naive version — fingerprinting `document`, counting duplicates with
`Array.filter` — measured a genuine Contact-info → Resume transition as **0.63 similar and
classified it "same step"**. Two compounding causes:

- Fingerprinting the whole document counted the page *behind* the modal. LinkedIn's search
  boxes and nav persist across every step, so they inflate similarity on every comparison.
- `now.filter(k => prev.includes(k)).length` counts duplicates, and the resume step renders
  ten radios that fingerprint identically. The ratio exceeded what the previous field set
  could possibly match.

Scoping to the dialog and comparing sets drops that transition to **0.0 similar**. The step
index caught it regardless, which is the argument for reading the stepper first.

**The similarity heuristic still earns its keep** for the conditional-field case — "you
answered Yes, three new fields appeared" — which happens within a step and has no index to
read. It is the fallback, not the primary signal.

#### Session state

Keyed by `tabId` in `chrome.storage.session` (memory-only, cleared on browser close):

```ts
interface ApplicationSession {
  tabId: number;
  origin: string;
  steps: StepRecord[];        // one per step reached
  currentStepIndex: number;
  journey?: { index: number; total: number; labels: string[] };  // from the page's stepper
  startedAt: string;
}

interface StepRecord {
  index: number;
  url: string;
  label: string;              // "My Experience", from the stepper or the page heading
  scan: ScanResult;
  status: "current" | "completed";
  filledFieldIds: string[];   // ids only — never values
}
```

The session goes dormant, not destroyed, when the tab leaves the origin: that is usually an
SSO detour, not an abandoned application. The side panel does not reload on page
navigation, so its UI state stays continuous on its own.

#### Announce every step change

On a `new-step` event the panel announces the new position through its live region:
"Step 2 of 4: Resume", using `stepHint.index` / `total` and the step's heading. If there's no
index, it says "New step: Resume". Measured on LinkedIn Easy Apply: the page itself says
nothing when the step changes (§11), so this is the one piece of orientation a screen reader
user gets. Announce once per transition, not per mutation: `fields-changed` events stay quiet
unless a conditional field actually appeared.

#### VERIFY runs per step

**This is a change to §4.4.** Once the user presses Continue, the previous step's DOM is
gone and read-back is impossible. So VERIFY fires before *each* forward move, not once at
the end. Generalise `Alt+Shift+S` from "focus Submit" to **"the primary forward
action"** — Continue on steps 1..n-1, Submit on step n — and gate it behind that step's
VERIFY.

**BRIDGE never submits unintentionally. It presses Continue, and it submits on the user's
confirmed instruction** (decided 2026-09-21). The original rule was "BRIDGE never presses
it", with the shortcut moving keyboard focus to the button. The rule's purpose is that the
applicant decides, knowing what the page holds; whose finger lands on Enter is not the point. Measured by
hand on Chrome 154: nothing moves keyboard focus from the side panel to the page. Not
`focus()` in the page, not `tabs.update`, not `windows.update`, not closing the panel.
Chrome's pane key does, in four presses on the test machine, and the count depends on the
user's toolbars. Four chords per step is not a usable flow, so:

- A forward button whose name does not say submit, apply or send is **pressed by BRIDGE** on
  the second Alt+Shift+S. The user stays in the panel, the new step is announced, and focus
  goes to its first question. The page side owns this rule and refuses to click a submitting
  name whatever the panel asks.
- A button that submits is **never pressed by the shortcut**. While the step's read-back is
  current, the panel shows **"Submit my application"**; the second Alt+Shift+S only moves
  focus to it. Activating it asks "Submit your application to <site>? N questions are empty.
  This cannot be undone.", with focus on Cancel. Only "Yes, submit now" sends `bridge/submit`.
  Any write, step change or reload withdraws the button until the step is read back again.
- Two locks, one on each side. The panel has a single path to `bridge/submit`, the confirm
  button's handler. The page side presses only a button whose name says it submits, so that
  message cannot press Next, and `bridge/forward-action` cannot press Submit.
- A submit the page rejects (a required answer missing) changes nothing the panel can see, so
  it falls under the three-second rule below. The pane key, Command+Option+Down arrow on
  macOS, is named there as the way to hear the page's own message. (F6 on Windows and Linux,
  from Chrome's documentation, not tried.)
- The gate closes the moment BRIDGE presses, so a second impatient press reads back again
  instead of skipping a step. If the step has not changed three seconds after the press,
  BRIDGE says the page has not moved on.
- Known risk: a button named only "Continue" that in fact submits would be pressed. Names
  are all BRIDGE has to go on.

The barrier report (§6.7) then accumulates across every step the user walked, grouped by
step. That is the honest and considerably stronger version of "analyses the entire
application journey".

#### Out of scope

Do not pre-fetch later steps. Fetching the next URL without session state returns nothing
useful, and POSTing to advance the wizard is submitting on the user's behalf — barred by
§2 and by the promise BRIDGE makes to the applicant.

### 6.6 Side panel accessibility requirements

BRIDGE is useless if BRIDGE itself is inaccessible.

- Native HTML elements only. Proper `<h1>`–`<h3>` structure so users can navigate by heading.
- One `aria-live="polite"` region for status ("Slider set to 2 years", "Could not fill Start date").
- Visible and programmatic focus management: focus moves into the panel on open, to the next question after each answer.
- Zero axe violations on the panel.
- Tested end to end with NVDA on Windows before demo.

Test it the way a user experiences it: **with the screen off.** VoiceOver's Screen Curtain
(Control + Option + Shift + F11) or NVDA on a blanked display. Testing while sighted lets you orient
visually and will pass a panel that is not usable. Method and checklist in
`probe/screen-reader-testing.md`.

VoiceOver on macOS is the fast loop during development, but it is **indicative, not
conclusive**: NVDA behaves differently and is what the requirement above names. A barrier
found in VoiceOver is real; passing VoiceOver does not discharge the NVDA pass.

### 6.7 Barrier report (employer side, MVP)

"Export barrier report" in the side panel produces Markdown + JSON. The monitor in
[`bridge-business.md`](bridge-business.md) §6.2 writes the same JSON, so one scanned page
produces one report whichever side produced it:

```json
{
  "portal": "boards.greenhouse.io",
  "pagePath": "/acme/jobs/12345",
  "generatedAt": "2026-09-24T10:00:00Z",
  "barriers": [
    { "rule": "drag-drop-only", "severity": "blocking",
      "label": "CV upload",
      "impact": "A screen reader user cannot attach a CV." }
  ],
  "pageBarriers": [
    { "rule": "captcha", "severity": "blocking",
      "impact": "A screen reader user cannot verify they are not a bot." }
  ]
}
```

It is a projection of one `ScanResult` (§6.1), flattened:

| Report | Comes from |
|---|---|
| `portal` | `location.host` of the scanned page, port included |
| `pagePath` | `location.pathname`. **The query string is excluded** — see below |
| `generatedAt` | `ScanResult.scannedAt` |
| `barriers[]` | Every `FieldDescriptor.barriers` entry, in page order, each carrying its field's `label` |
| `barriers[].impact` | `Barrier.message`. The same sentence, renamed at the boundary: it is spoken to the applicant and read by the employer |
| `pageBarriers[]` | `ScanResult.pageBarriers`, which belong to no field and so carry no `label` |

Fields with no barriers do not appear. The report carries no field values, no applicant
identity, and no `stepHint`.

**`label` is required on every `barriers[]` entry, and there is no `selector`.** The
dashboard compares two scans of the same form by `rule` + `label` for field-level barriers
and by `rule` alone for `pageBarriers` (`bridge-business.md` §6.1). A generated selector
changes whenever the vendor ships a release, which would report every barrier as
simultaneously resolved and new; `FieldDescriptor` has no `selector` to emit in any case.
An earlier draft of this example carried one. A producer may add `selector` for a human
reading the JSON, but nothing may key on it.

**Why `pagePath` drops the query string.** The comparison groups reports by
`portal` + `pagePath`, so that is the identity of a form across time. Postings on the
portals in §11 put the job in the path. It also lets the Acme fixture's `?v=2` / `?v=3`
(`bridge-business.md` §6.5) stand in for the same form changing between scans, which is
the employer demo.

**One step or many.** The table above is `toReport()` in `extension/lib/report.ts`, the one
conversion both producers use. The side panel's export is `buildReport()`: for an
application with a single step it is exactly `toReport()` of that step, so it is the same
JSON the monitor writes for the same page. When the applicant reached more than one step
(§6.5), the two flat lists hold every step's barriers, each with a `step` number; the form
is identified by its **first** step's `pagePath`; `generatedAt` is the most recent step's
scan; and `steps: [{ index, label, pagePath, barriers, pageBarriers }]` keeps the grouping.
A consumer that does not know `steps` or `step` ignores them, and the dashboard does.

**`label` is always the name the page itself yields**, never one from label inference
(§6.4): a model may word it differently on the next run, and the compare key must not move.

**Two known differences between the producers**, both because the monitor runs in an
ordinary page with no extension API: it cannot see inside a *closed* shadow root, and it
cannot know which cross-origin frames the extension may reach, so
`cross-origin-frame-unreachable` appears only in the side panel's export.

The side panel also writes the Markdown twin, for a person to paste into an email. Both
files are named like the monitor's: `<portal-and-path-slug>-<timestamp>`.

Sending the report anywhere is a manual user action in the MVP. This format is the contract
with the employer dashboard and monitor in [`bridge-business.md`](bridge-business.md) §6;
change it here, not there.

## 7. Test fixtures

Demos against real portals are fragile. Build **"Acme Careers"**, a deliberately inaccessible React application form served from `localhost`, containing exactly the barriers in the pitch:

- Years-of-experience slider with no role and no keyboard support
- Drag-and-drop-only CV uploader
- Education dropdown built from divs, no label
- Date picker with a focus trap
- A normal accessible Submit button

Note that the fixture's barriers should now be chosen to *match what real portals
actually do* (§11), not what is easiest to build. Of the five barriers listed above, the
drag-and-drop uploader and the unlabelled dropdown are real and common; a keyboard-dead
custom slider was not found on any portal measured. Keep it — it demos well and slider
widgets do exist in the wild — but do not let it crowd out the two barriers that turned up
on real applications and are not in the list at all: a **popup that is not a dialog**, and
**checkbox groups whose question has no programmatic name**.

The fixture also needs a **multi-step mode**, or §6.5 has nothing to be tested against:

- an in-place step swap inside a native `<dialog>` with a "1/3 pages" indicator (LinkedIn's shape)
- a full-page-navigation variant with a "step 1 of 3" stepper (Workday's shape)
- on one step, a Yes/No radio group whose options both carry the question as `aria-label`
  (`options-identically-named`, the headline LinkedIn finding)
- a dropdown whose options are only rendered after it is opened (react-select's shape)

Plus at least **one real portal** posting for credibility. Never submit to a real employer
during testing; stop at VERIFY. `probe/` scans live portals without submitting and is the
tool for keeping §11 honest as postings expire.

## 8. Build plan (tonight, full scope)

Status at the start of the night, measured on branch `implement-bridge-user`:

- `npm run typecheck` exit 0; `npm run test:e2e` 23/23, zero axe violations on the panel.
- Built: SCAN with most §6.2 rules, option harvesting, text / native select / custom
  dropdown / radio / checkbox / file writes, DOM read-back, VERIFY, one live region,
  Alt+Shift+B, explicit `tabId` for headless driving.
- A scratch run proved the file path works inside the extension with an Ashby-shaped
  uploader and a 1.2 MB file (written, rendered by the page, read back, 831 ms).
- Not built: every §8 day-2 and day-3 item, Alt+Shift+S, on-load announcement, per-frame
  routing, one-question mode, CV reuse across steps, export, "always enable", proxy.

Everything below was built in this order, each step ending with `npm run typecheck` and
`npm run test:e2e` green and a commit.

**Status: 8.1 to 8.7 are done.** `npm run test:e2e` is 130/130, typecheck is clean, the panel
has zero axe violations. What remains is §8.8, which needs a person.

| Step | Commit | Verified by |
|---|---|---|
| 8.1 fixture v2, SCAN/ACT breadth | `2014eb6` | e2e |
| 8.2 frames, reload | `f237056` | e2e |
| 8.3 multi-step, 8.4 panel features | `515a5f9` | e2e, except "always enable" (needs a real click) |
| 8.5 proxy and label inference | `27c99ea`, `7e60ffb` | proxy tests 16/16; e2e against a labelled stub; one live DeepSeek call with a crop (200, correct label); one live extension → proxy → DeepSeek call (200). The panel's own screenshot crop needs `activeTab` and is in §8.8 |
| 8.6 live portal | `d31d643` | the built extension on the live GitLab Greenhouse posting, §11 |
| Audit against AGENTS.md | `d2ecb6e` | five defects reproduced, fixed test-first; `edge.html`, `unnamed-a/b.html` |

**Found by the audit and deliberately not changed**, because each needs a decision or a
refactor rather than a patch:

- **The "BRIDGE is busy" guard is a timer**, not a structure: a counter with a 600 ms tail,
  on top of the fixed waits in `lib/act.ts` (300 ms for a dropdown to open, 400 ms before
  read-back). A slow page can outrun them. Failure is loud ("Could not fill", or a dropdown
  offered as free text), never silent.
- **A session never ends.** It is keyed by tab and origin, so a second application on the
  same site in the same tab is recorded into the first one's steps, and the exported report
  mixes them. Needs a rule for "a new application started" that Back-to-step-1 does not trip.
- **One live region, last writer wins.** A write confirmation that lands after VERIFY
  replaces the read-back summary before it may have been heard.
- **A content-script handler that throws** is turned into "BRIDGE cannot read this page"
  by `send()`. Verified twice by temporarily restoring a bug; no handler throws on any
  fixture any more, so no permanent test pins it.

### Decisions this plan makes

These change earlier sections. They are listed once here so nothing is silent.

- **`closed-shadow-root` is retired.** Content scripts can call
  `chrome.dom.openOrClosedShadowRoot(el)`, which returns closed roots too. SCAN and ACT
  pierce every shadow root, open or closed, so a field inside one is offered like any
  other and there is nothing to warn about. Step 1 verifies the API on a closed root in
  the fixture; if it returns null there, the rule comes back as specified in §6.2.
- **Slider strategy is chosen by shape, not by failure.** `input[type=range]` → native
  setter. Focusable `role="slider"` → Home then ArrowRight × n. Anything else → pointer
  events at the x-coordinate for the value. A failed write is reported, never retried
  with a different strategy (AGENTS.md §2).
- **No `history.pushState` patch.** Content scripts run in an isolated world and cannot
  intercept the page's `history` calls. Every SPA route change mutates the DOM, so the
  debounced `MutationObserver` is the one source; it records `basis: "url-change"` when
  `location.href` differs from the previous evaluation. §6.5's three sources collapse to
  two: script load and mutation.
- **Export key is `rule` + `label`, no selector, page barriers in their own list.** Resolves
  `bridge-business.md` §6.1; the shape is §6.7. `FieldDescriptor` carries no selector, and generated selectors are not stable
  across releases.
- **Alt+Shift+S is gated by VERIFY, in the panel.** First press on a step runs VERIFY
  and announces the summary plus what the second press will do. The second press asks the
  content script to press the forward action if it only moves on; if it submits, the press
  moves focus to the panel's own submit button instead (§6.5). The manual pass settled the open question: `el.focus()` in the page
  does not take keyboard focus away from the side panel.
- **On-load announcement only on application pages.** The built-in tier's content script
  announces the barrier count from an injected, visually hidden status region, and only
  when §6.5's `formScope()` finds a dialog or form with at least two controls. Otherwise
  a LinkedIn search page would announce on every load.
- **Frames are discovered by asking Chrome, with no registry.** The service worker runs a
  one-line script with `allFrames: true`; it executes only where the extension has
  permission, and each result carries its `frameId`. That list *is* the set of reachable
  frames, so there is nothing to keep in sync and nothing to go stale. No `webNavigation`
  permission (it adds a browsing-history install warning). This replaced the first draft of
  this plan, in which each frame announced itself and the service worker kept a map.
- **The panel is the one decider of a step change.** See §6.5, "As built".
- **Field ids become `${frameId}:f${n}`**, and each field gets a rescan-stable key. The
  panel routes `fill` and `read-back` per frame.
- **A field with nothing to infer from is not sent for label inference.** With no picture,
  no options and no nearby text the model answers "Text field", measured live. BRIDGE's
  own "Unlabelled text" is more honest.

### 8.1 Fixture v2 and SCAN/ACT breadth, single page

Build, in `extension/test/fixtures/acme/index.html` and `lib/`:

- Fixture additions: years-of-experience slider (div, no role, no tab stop, `data-min`
  / `data-max` / `data-step`, value set by pointer on the track); CV uploader in Ashby's
  shape (1 px, `tabindex="-1"`, unnamed, drop zone as the visible affordance, renders the
  filename from `input.files`); custom date picker with an underlying text input; a
  "Language skills" checkbox group with no `fieldset`/`legend` (Lever's shape); a
  newsletter popup with an email field and no dialog role, off to one side; a
  `<acme-consent>` custom element holding a labelled checkbox in a **closed** shadow root;
  a same-origin iframe with one labelled field and a `http://127.0.0.1` iframe with one
  field (cross-origin and outside `host_permissions`). The discarded-write field is
  renamed "Notice period" so "Earliest start date" can be the date picker.
- SCAN: kinds `slider`, `date`, `checkbox-group`; `range` from `aria-valuemin/max/now`,
  `min/max/step` or `data-*`; checkbox grouping by shared `name` with `group-not-labelled`;
  shadow-root piercing; `role="progressbar"` in `stepHint`; no field-level `missing-label`
  for file inputs (the page rule already covers them, they were counted twice); a
  combobox whose text has not changed since SCAN reads back as empty (today the
  untouched fixture dropdown reads back as "Select…").
- ACT: slider by shape (above); date via the underlying input and the native setter;
  checkbox group by clicking each option into the wanted state; re-resolution by
  selector, then by accessible name plus ordinal among controls of the same kind, then
  "Could not fill".

Verify, all in `test/e2e.mjs`: each new barrier is listed; slider set to 2 moves the
page's thumb and reads back 2; CV written and rendered; date read back; two languages
checked, one unchecked; the shadow-root checkbox offered and written; the popup reported
as `modal-without-dialog-role`; a field the fixture re-renders after 500 ms is still
filled via the name-and-ordinal path; the untouched dropdown reads back as empty.

Paths. Happy: the counts in §9 come from this run. Failure: a widget that ignores the
pointer or key events reports "Could not fill" and VERIFY shows it empty; the suite
asserts that shape on the discard field, not on the slider. Edge: `openOrClosedShadowRoot`
missing or null → rule restored per the decision above; a slider with no discoverable
range → panel shows a plain number input and ACT reports "Could not fill: no range".

### 8.2 Frames

Build: the service worker answers "which frames may BRIDGE run in" by running a one-line
script with `allFrames: true` (see the decision above; there is no registry); the panel
scans every such frame and merges results, top frame first; `fill` / `read-back` carry the
frame; `cross-origin-frame-unreachable` derived in the panel from the top frame's visible
iframe origins minus the reachable frames; on `tabs.onUpdated` status `complete` the
service worker broadcasts `bridge/page-loaded`, and the panel re-prepares the frames and
rescans when the document is a new one.

Verify: the same-origin iframe's field appears in the panel and is filled and read back;
the 127.0.0.1 iframe produces exactly one `cross-origin-frame-unreachable`; reloading the
fixture makes the panel rescan without a click.

Paths. Happy: two frames, one barrier. Failure: a frame that never says hello (script
blocked by CSP) is reported unreachable, not silently skipped. Edge: an iframe that is
`display:none` is ignored; an `about:blank` iframe inherits the parent origin and says
hello via `match_about_blank`.

### 8.3 Multi-step

Build. Fixture: `modal.html` in LinkedIn's shape (a native `<dialog>`, "1/3 pages",
in-place swap, no URL change, a Yes/No on step 1 that reveals two fields when Yes, the
visa radios on step 2, a react-select-shaped dropdown on step 3, Back / Next / Submit)
and `steps/1.html`, `2.html`, `3.html` in Workday's shape (a
`[data-automation-id=progressBar]` stepper naming all three steps, "step 1 of 3",
Continue as a full navigation, Submit on 3). Extension: the §6.5 detector in the content
script (scope, fingerprint, Jaccard, step index outranks similarity, `basis` recorded);
`bridge/step-changed` and `bridge/fields-changed` to the panel; `ApplicationSession` in
`chrome.storage.session` keyed by `tabId` with one `StepRecord` per step and
`filledFieldIds` only; the panel announces "Step 2 of 3: Resume" or "New step: Resume",
rescans, and resets the VERIFY gate; the `focus-submit` command wired through the
service worker to the panel; `bridge/focus-forward` in the content script finds the
forward action (submit type first, then a button or link named Submit / Continue / Next /
Apply / Review, last in DOM order), scrolls it into view, focuses it and returns its
name and whether it submits.

Verify, both shapes: after Next the panel's live region holds "Step 2 of 3" and the new
step's questions replace the old ones; answering Yes on step 1 announces "2 new
questions" without a step announcement; first Alt+Shift+S press runs VERIFY and presses
nothing; second press presses Next and the new step is announced, and on the last step
moves focus to the panel's submit button, which no number of shortcut presses activates;
Cancel submits nothing; a write withdraws the offer; "Yes, submit now" submits once; the page
side refuses to submit through a button that does not say submit; a Next that refuses
to advance is reported, and is not pressed twice; the session holds three `StepRecord`s with no values; the
form is never submitted by the test.

Paths. Happy: three announced transitions in each shape. Failure: the content script is
destroyed by the Workday-shape navigation and the panel's pending answer for that step is
discarded with "the page moved on; step 1 can no longer be read back". Edge: a
transition with no stepper (`stepHint` null) announces "New step" and the position as
"total number of steps unknown"; Back to a previous step is a step change too and is
announced; a `fields-changed` verdict with nothing new is silent.

### 8.4 Panel features

Build: one-question-at-a-time mode as the default with "Question 2 of 8", Next and
Previous, auto-advance on a confirmed write, and a full-list toggle; CV bytes stored in
`chrome.storage.session` after the first confirmed write, so a later file question
offers "Write resume.pdf, chosen earlier, to page" beside the file input; "Export barrier
report" producing JSON per §6.7 (with a required `label`, a separate `pageBarriers` list and, when the session has more than
one step, `steps[]` grouping) and a Markdown twin, downloaded from the panel; "Always
enable BRIDGE on this site", shown only when the origin is not in the built-in list,
calling `permissions.request` synchronously inside the click and then asking the service
worker to `registerContentScripts`; the on-load announcement per the decision above.

Verify: both modes render the same questions; a write in one-question mode moves focus
to the next question's control; a second file question on `modal.html` step 3 shows the
reuse button and writes the stored CV; the exported JSON parses, has no field values
and no identity, and its keys match `bridge-business.md` §6.1; the fixture page's
injected status region reads "BRIDGE found N barriers on this form" about a second after
load. `permissions.request` needs a user gesture that headless cannot supply; it is
covered by hand in §8.9.

Paths. Happy: the demo runs in one-question mode. Failure: none is handled for the
download itself. A page cannot observe whether the browser saved a file, so a clipboard
fallback could never be triggered reliably and was not built; the download is checked by
hand in §8.8. Edge: a stored CV from another tab is not offered (keyed by
tab); export with zero barriers still produces a file, saying so.

### 8.5 Proxy and label inference

Build: `proxy/` (FastAPI, one endpoint, per §6.4; being built now in isolation) and the
panel client: for fields whose `labelSource` is `none`, the panel captures the visible
tab, crops each field's rectangle (returned by SCAN) into a PNG, POSTs
`{ id, kind, nearbyText, options, cropPng }` to `http://localhost:8000/infer-labels`, and
relabels those questions "label inferred". Field values never go: SCAN runs before any
answer exists, and the crop is taken at SCAN time.

Verify: the proxy's own tests; an e2e run against a stub proxy on port 8000 (a 20-line
Node server, labelled as a test stub) that returns fixed labels for the ids it receives,
asserting the request carries no field values and the panel shows the returned labels
as inferred. The live model call is verified only once `DEEPSEEK_API_KEY` is set; it is
listed as unverified until then. Two things only that live call can settle: DeepSeek's
docs do not say whether image input works together with JSON output mode, and they warn
that JSON mode "may occasionally return empty content". The proxy returns 502 for empty
or unparseable output and never retries, so both land on the failure path below.

Paths. Happy: the fixture's one unlabelled field gets a label. Failure: proxy down →
one live-region sentence, "label inference unavailable", and the field keeps its
"Unlabelled text" name; no retry. Edge: zero fields with `labelSource: none` → no
request at all.

### 8.6 Live portal

Run `probe/run.js --preset greenhouse` to confirm the posting is live, then `probe/act.js`,
which fills and stops at read-back. Nothing is submitted. If the posting has expired,
swap it from the board API per `probe/README.md`. Result pasted into §11.

### 8.7 Docs

README v0 limits removed; §4, §6.1, §6.2, §6.3, §6.5 and §10 updated to match the
decisions above; `bridge-business.md` §6.1 marked settled.

### 8.8 Stays with a human

These cannot be done by the build and are not claimed by it. **Step-by-step instructions
for each, with what to expect, what to write down and what each failure means, are in
[`manual-checks.md`](manual-checks.md).**

1. **Focus spike.** Answered for the keyboard on 2026-09-21 (§10). Still to do: what VoiceOver
   speaks when the panel opens.
2. **Alt+Shift+S from the keyboard.** Done 2026-09-21: the shortcut fires, and `el.focus()`
   in the page does not pull keyboard focus out of the side panel, so the design changed
   (§6.5). Still to do by hand: the new behaviour, in `manual-checks.md` check 2.
3. **The screenshot crop.** `captureVisibleTab` needs the `activeTab` grant of a real
   Alt+Shift+B. With the proxy running, open the fixture, press the shortcut, and expect
   the third question to become "LinkedIn profile URL (label inferred)" and Diagnostics to
   say "2 labels inferred".
4. **"Always enable BRIDGE on this site"** and Chrome's permission prompt, on any https
   site outside the built-in list, with the screen reader on.
5. **The exported file actually saves** from the real side panel.
6. **VoiceOver pass with Screen Curtain** on the fixture and the panel
   (`probe/screen-reader-testing.md`).
7. **NVDA pass** on Windows. Not possible on this machine tonight; the video says
   "tested with VoiceOver; NVDA pending" until it is done.
8. **LinkedIn Easy Apply by hand**: the visa question answered through BRIDGE.
9. **Recording** per §9. QuickTime does not capture VoiceOver speech; use OBS with system
   audio or keep the caption panel on screen.

### 8.9 Order of the night

8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6 → 8.7, then the human list. The proxy directory is
built in parallel from the start because nothing depends on it until 8.5.

## 9. Demo script

Acme Careers is `apply.html` in `extension/test/fixtures/acme`, served as
`http://localhost:8765/apply.html`. (`index.html` there is the employer demo's small form in
three versions; see `bridge-business.md` §6.5.) VoiceOver on, Screen
Curtain on for the applicant beats, caption panel visible for the camera. Nothing here
uses a slider strategy or a widget that was not found on a real portal, except the
slider itself, kept because it demos well (§7).

1. Open Acme Careers. Tab through the form. The education dropdown is never reached, the
   Yes/No options both say the visa question, the CV control is not there at all.
2. BRIDGE's status region says "BRIDGE found 12 accessibility barriers on this form. Press
   Alt+Shift+B to open BRIDGE." The panel then says 13: the extra one is the cross-origin
   frame, which only the panel can know is unreachable.
   Press it. The panel opens, announces "13 questions found. 13 accessibility barriers, 9
   blocking", and asks the first question.
3. Answer "Full name". BRIDGE confirms from the page and moves to the next question.
4. "Highest education completed, label inferred": choose Bachelor's. Split screen: the
   page's dropdown shows Bachelor's.
5. The visa question, now a real group: choose No. The page's radio is checked.
6. Years of experience: type 2. The page's slider thumb moves.
7. CV: choose a file in the panel's native picker. The drop zone shows resume.pdf.
8. "Notice period": BRIDGE says "Could not fill: may need sighted help" because the page
   discards it. Say the line: BRIDGE never claims a success it did not read back.
9. VERIFY: "Your application contains: Full name, Zheng Wei. …  1 question is empty:
   Notice period." Press Alt+Shift+S again; focus lands on "Submit my application" in the
   panel. Press it: BRIDGE asks "Submit your application to localhost:8765? 1 question is
   empty. This cannot be undone." and puts focus on Cancel. Choose "Yes, submit now". BRIDGE
   says it pressed Submit application as you confirmed, then "Application received". Say the
   line: BRIDGE never submits unless you tell it to, after reading everything back.
10. Multi-step, 20 seconds: open `modal.html`, press Easy Apply, answer step 1, press
    Alt+Shift+S twice. BRIDGE reads the step back, presses Next, and says "Step 2 of 3:
    Additional questions". The page itself says nothing.
11. Export barrier report. Hand over to the employer demo, `bridge-business.md` §7.

## 10. Risks and open questions

| Risk | Status | Mitigation |
|---|---|---|
| Widgets ignore untrusted events | **retired** | Measured across §11: synthetic mouse events drive react-select and React inputs. `debugger` stays out of the MVP |
| Cross-origin iframes (common on Workday) | live | Confirmed on Workday, Lever, Ashby and LinkedIn. Host permissions for supported origins; otherwise report `cross-origin-frame-unreachable` |
| Multi-step applications | **built** | §6.5. Workday publishes its whole 6-step journey up front, so the "entire application journey" claim holds — sourced from the page's stepper, not from scanning ahead |
| Page re-renders wipe BRIDGE's writes | live | VERIFY reads from DOM, so this surfaces as a failed field instead of a silent error |
| LLM infers a wrong label | live | Always marked "label inferred"; user can hear the nearby text themselves |
| CAPTCHA at the end | live | Present on **every** real portal measured. Detected in SCAN and announced up front; out of scope to solve |
| Custom dropdown options unreadable until opened | new | SCAN must open each widget to enumerate. Adds timing and failure modes to SCAN (§6.3) |
| Barrier detection cries wolf | new | Skip `aria-hidden` subtrees (§6.2). A false blocking barrier on a well-built form discredits both the tool and the employer report |
| Login wall before the form | new | VietnamWorks blocks at step zero. BRIDGE reports and locates it; see the credential note below |

**Credentials are not in scope.** The VietnamWorks barrier is an unlabelled sign-in popup,
so "fixing" it means BRIDGE handling an email and password. That is a far heavier trust
proposition than writing `2` into a years-of-experience field, and it breaks the clean
privacy story in §6.4. BRIDGE **reports and locates** the login barrier — "a sign-in dialog
opened, it is not announced, the username field is here" — and leaves filling it to the
user's password manager. Say this out loud in the pitch; it reads as judgement, not as a gap.

**Open questions**
- ~~Which real portal do we target on day 3?~~ **Greenhouse for the live demo** — every ACT
  strategy already passes there, it is one page, and the DOM is stable. **VietnamWorks for
  the barrier story**, where the failure is starkest. Workday appears as a screenshot of
  its 6-step journey, not as a live demo: account creation is step 1 and cannot be
  demonstrated against a real employer.
- Do judges need to install it themselves? If yes, submit an unlisted Chrome Web Store build on day 1.
- Is conversational voice input (speech-to-text in the panel) worth it, or does the screen reader's own input suffice? Default: skip.
- ~~Is LinkedIn Easy Apply worth supporting?~~ **Yes, and it is measured** (§11). Its controls
  work and BRIDGE can fill every type it uses; its labelling and step transitions do not. The
  identically-named Yes/No on the visa question is the headline demo.
- ~~Can an extension move keyboard focus into its side panel?~~ **Only by showing it, measured
  by hand** on Chrome 154, macOS, 2026-09-21. After Alt+Shift+B opens the panel, Tab moves
  inside it. A panel that is already open cannot take focus from the page: `window.focus()` in
  the panel was tried and did nothing. So Alt+Shift+B closes an open panel and shows it again.
  The panel reloads, and answers typed but not written are lost. Checked by hand the same
  day: the panel reopens and Tab moves inside it. F6 does nothing on macOS;
  Cmd+Option+Down arrow reaches the panel in four presses.
- ~~Can a content script's `focus()` take keyboard focus *out of* the side panel?~~ **No, measured
  by hand** on Chrome 154, macOS, 2026-09-21, and neither can any extension API tried. §6.5
  records the design that follows from it.

## 11. Portal findings (measured)

Measured 2026-09-21 against live postings with `probe/`. Read-only page loads; no
accounts, no credentials, nothing submitted. Postings expire — re-run `probe/` rather than
trusting these numbers indefinitely.

| Portal | Rendering | Steps | Field barriers | Page barriers |
|---|---|---|---|---|
| Greenhouse (GitLab) | server-rendered + React | 1 | **0** | CAPTCHA, cross-origin frame |
| Lever (Palantir) | server-rendered | 1 | 6 | 4 × `group-not-labelled`, hCaptcha, cross-origin frames |
| Ashby (Cohere) | pure SPA | 1 | 2 | `drag-drop-only`, reCAPTCHA, cross-origin frame |
| Workday (NVIDIA) | SPA + hard navs | **6** | — (behind sign-in) | cross-origin frame |
| VietnamWorks | SPA | 1 + login wall | 3 | **`modal-without-dialog-role`** |
| LinkedIn Easy Apply | SPA, in-place modal | **4** | **0** on step 1 | cross-origin frames |

### The built extension on live Greenhouse

2026-09-21, the unpacked build driven headlessly against the GitLab posting, one page load,
nothing submitted:

```
22 questions found. 2 accessibility barriers, 2 blocking.   (CAPTCHA, reCAPTCHA frame)
SCAN took 6.7 s   (13 react-select dropdowns opened, read and closed)
Country dropdown: 244 options harvested
First Name  -> "On the page: Test"
Country     -> "On the page: +1"     (the widget shows the dial code, see probe/README)
```

Noticed and not fixed: both file inputs compute to the accessible name **"Attach"**, so
BRIDGE lists two questions called "Attach" (Resume/CV and Cover Letter). The group label
that tells them apart is not part of the input's name. It is the same defect a screen
reader user hears, and a candidate for the employer report.

### What actually works

| Strategy | Result |
|---|---|
| React text input via prototype value setter | **PASS** — survived re-render on Greenhouse |
| Custom dropdown via synthetic `mousedown` | **PASS** — opened, enumerated 3 options, selected, read back on Greenhouse react-select |
| Custom dropdown via synthetic keyboard | **FAIL** — `aria-expanded` stayed `false` |
| File upload via `DataTransfer` → `input.files` | **PASS** on Greenhouse *and* Ashby; page rendered the filename both times |
| File upload via synthetic `drop` | unverified — the one attempt resolved the wrong element as the drop zone |

### Notes per portal

**Greenhouse — the best demo target.** Zero field-level barriers once `aria-hidden`
subtrees are skipped; the form is genuinely well built, and its uploader is a real labelled
`input[type=file]`. The drag-and-drop uploader in the pitch is an **Ashby** barrier, not a
Greenhouse one. All 13 dropdowns are react-select and expose no options while closed.

**Lever — the best barrier for the employer story.** The Palantir form contains **0
`<fieldset>`, 0 `role="group"`, 0 `aria-labelledby`**. A 33-checkbox group asking "Language
Skill(s)" has no programmatic name at all, so a screen reader announces "English, checkbox,
required" and the question itself is unreachable. Text fields are fine — they use implicit
label wrapping.

**Workday — the multi-step reference.** Publishes all six step names on step 1 (§6.5).
"Apply Manually" is a full document navigation, which destroys the content script. Every
element carries `data-automation-id`, giving stable selectors across all tenants — worth an
adapter keyed on those. Its own stepper is six `<label>` elements with no associated
control, each carrying `aria-live="polite"`: six live regions that can all fire on one
re-render. Put that in the barrier report.

**VietnamWorks — the starkest barrier found.** Clicking Apply opens a login wall that is
not a dialog:

```
elements with role=dialog or aria-modal on page:  0
focusable elements still reachable BEHIND popup:  150
username input:  aria-label=null placeholder="" label[for]=false wrapped=false
password input:  aria-label=null placeholder="" label[for]=false wrapped=false
```

Neither credential field has an accessible name by any mechanism. Focus does move into the
popup, but it lands on an unnamed input, so a screen reader announces roughly *"edit,
blank"* — no indication that a login wall appeared or what it wants. The applicant cannot
get through the front door. Failure at step zero, on a major regional board, reproducible
in two clicks.

**LinkedIn — mostly a router, and the best-built form measured.** Across 20 jobs over 5
queries and regions: **9 offsite, 7 onsite (Easy Apply), 4 indeterminate.** An initial
6/6-offsite sample was biased toward large-company engineering roles. So roughly half of
LinkedIn traffic lands on an ATS BRIDGE already handles.

**Easy Apply, measured by hand** in a logged-in browser with the console probe (it is
behind a login and must not be automated — see `probe/README.md`):

- **4 steps**, published as `1/4 pages` in the modal. Third portal with a readable journey
  indicator, which is what makes "read the stepper" the general strategy rather than a
  Workday special case. Note the phrasing: a `Step N of M` regex alone misses it.
- Step 1 (Contact info): **5 fields, 0 barriers.** Labels properly associated.
- Both dropdowns are **native `<select>`** with options enumerable while closed (1 and
  249 respectively). No synthetic-event work needed — this is the one control type that
  needs nothing from §6.3.
- The step transition fires with **no URL change**, via `MutationObserver` only. The
  in-place-swap branch of the detector is load-bearing here, and this is the run that
  found the two bugs described in §6.5.
- LinkedIn's modals carry `role="dialog"`, `aria-modal="true"` and `aria-labelledby`.

**Walked end to end, 2026-09-21**, on two employers' Easy Apply flows (Univers, 4 steps;
Binance, **10 steps**) with the console probe. Nothing submitted.

Confirmed:

- **`group-not-labelled` on steps 2 and 3**, two instances on step 3. The same failure as
  Lever (§11), on LinkedIn's own form. Step 2 is the resume radio list.
- **The resume uploader is `upload-unnamed`, not `drag-drop-only`.** An earlier draft of
  this section reported `drag-drop-only` from step 2 onward. That came from a rule bug which
  treated "visually hidden" as "unreachable". The Binance file input is `tabIndex=0`, so it
  is in the tab order and a keyboard user can reach it. What it lacks is an accessible name.
  That is a usability barrier, not a blocking one. Re-scan Univers with the fixed rule to
  confirm it matches.
- **Step count varies enormously by employer** — 4 vs 10 for the same flow. BRIDGE cannot
  assume a short journey, and ten unannounced transitions is a different problem from four.
- **Focus never moves into the new step.** Transitions left focus either on the `Next`
  button or on `BODY` (the no-focus state). Either way the user is not taken to the new
  content.
- The modal is a **native `<dialog>`**, not `[role=dialog]` — see §6.5.
- **Step 3 uses `div[role="radio"]` wrapping a native `input[type=radio]`.** The ARIA
  wrapper carries the accessible name; the native input inside it computes to no name at
  all. Two `group-not-labelled` barriers fire on this step, one per question
  (sponsorship, work authorisation).
- **Writes land on it.** `click` on the wrapper's native input sets `checked` and reads
  back. Confirmed after fixing a probe routing bug that had sent ARIA radios to the
  combobox strategy — the first `ACT FAIL` here was the probe's fault, not LinkedIn's.

**The strongest finding in the whole survey**, verified directly from the DOM rather than
inferred:

```
text: 'Yes', ariaLabel: 'Will you now or in the future require sponsorship for employment visa status?'
text: 'No',  ariaLabel: 'Will you now or in the future require sponsorship for employment visa status?'
fieldset: legend null, aria-label null, aria-labelledby null
```

`aria-label` overrides element contents, so **both options compute to the same accessible
name** and the words "Yes" and "No" are never spoken.

**Confirmed by ear**, VoiceOver on macOS, 2026-09-21: each option announces the question and
its position — "1 of 2", "2 of 2" — and never its label. Worth noting how that sounds to a
sighted tester: the question is there, the count is there, and it seems to mostly work.
You can see that option 1 is Yes. A blind applicant is guessing, on a visa question. A screen reader user hears the same
sentence twice and has no way to tell the options apart. The question is unanswerable
without sighted help — and it is the work-authorisation question.

Note how it happened: the fieldset has no legend, and someone compensated by stamping the
question onto every option's `aria-label`. The group gained a name; the options lost
theirs. This is not neglect, it is a well-intentioned fix that inverted itself — which is
exactly the class of defect that survives internal review, because the page looks correct
and the code looks conscientious.

**What BRIDGE does about it.** TRANSLATE offers a correctly built native group — a
`fieldset` with the question as its `legend` and options named "Yes" and "No" — and ACT
writes the choice back by clicking the real control, a strategy already verified on these
exact elements. An unanswerable question becomes answerable. That is the demo.

Re-run with correct dialog scoping gave `similarity: 0` on both step transitions, so with
the right scope the heuristic agrees with the step index rather than depending on it.

**This run validated reading the stepper as ground truth.** A scoping bug (below) inflated
every similarity score. Against the 0.4 threshold, similarity alone would have classified
three of five real step changes as "same step". All five were caught by `basis=step-index`.
The heuristic is genuinely the fallback; the page's own step indicator is the signal.

Caveats on the numbers: barriers were counted document-wide while the scope bug was live,
so some may belong to the search page behind the modal, and focus was sampled at a
debounced mutation rather than after settling. Both are resolved by re-running.

**Dropdowns, 2026-09-21 (Binance step 4, VoiceOver):**

- **Operable once focused.** The native `<select>`s change value with the arrow keys, and
  VoiceOver announces "Yes" / "No" as the value changes. The control itself is fine.
- **LinkedIn's focus trap only acts at the edges.** A logged run of real Tab presses showed
  the page did *not* intercept Tab in the middle of the form. It intercepted only on the last
  control, looping focus back to the close button. That is correct modal behaviour. It rules
  out the suspected cause, a trap that leaves dropdowns out of its list.
- **Tab reaches them. Not a barrier.** A logged run of real Tab presses went through the whole
  dialog in order, close button → both selects → both textareas → Back → Next, with nothing
  skipped and no interception except the loop at the end. The earlier reports of Tab skipping
  a dropdown (macOS and Windows) were not reproduced. The most likely explanation is the
  loop-around itself: pressing Tab on Next jumps focus to the top of the dialog, past every
  field, which looks and sounds like skipping. The tool made the same mistake before it was
  fixed. The Windows report stays open until it is re-run from the control *before* a dropdown.

**Step transitions are silent** (VoiceOver, Univers, 2026-09-21). After Next, no step name,
number or total is announced. The user discovers the new step only by reaching new fields.
"1/4 pages" is on screen throughout but isn't spoken when the step changes. That makes it
a usability barrier rather than a blocking one: the user can go on, but loses their place,
and on Binance's 10 steps that happens ten times. (VoiceOver not confirming the button press
itself is normal screen reader behaviour and is not a finding.)

**BRIDGE's fix is nearly free.** The §6.5 detector already fires on each step change and
reads `index` / `total` from the page's stepper, so the side panel announces
"Step 2 of 4: Resume" through its single live region. This is cheap and clearly audible,
and it belongs in the demo.

**Status of the modal-wizard questions** a label-and-role scan cannot answer on its own:

| Question | Answer |
|---|---|
| Is the step change announced? | **No** — by ear, VoiceOver |
| Where does focus go after Next? | Stays on Next, or drops to `BODY`. Never into the new step |
| Is "1/4 pages" spoken? | Not on step change. Whether it can be reached by reading is untested |
| Does the resume list name its question? | **No** — `group-not-labelled` |
| Do BRIDGE's writes land? | **Yes** — text, native select and ARIA radio all pass ACT with DOM read-back |
| Are validation errors spoken? | **Untested.** Needs an invalid step submitted and listened to |
| Tab skipping dropdowns (reported on Windows) | Not reproduced on macOS. Windows re-run pending, starting from the control *before* the dropdown |

Nothing was submitted.

**Positioning.** BRIDGE is assistive technology, not automation: the user drives every
action. Since 2026-09-21 BRIDGE presses Next, and Submit after a confirmation, but each press
is one explicit command from the user for that one button (§6.5), the way a screen reader or
a switch device activates a control for its user. That distinction matters on LinkedIn
specifically, which restricts automated access and has a history of acting against
extensions. Keep it true — nothing advances or submits on its own, no bulk apply, no
background activity — and say it plainly in the pitch.
